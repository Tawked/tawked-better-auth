import * as betterAuthApi from 'better-auth/api';
import type { PhoneNumberOptions } from 'better-auth/plugins/phone-number';
import { Tawked, TawkedApiError, TawkedConnectionError } from '@tawked/sdk';
import { TAWKED_ERROR_CODES, type TawkedErrorCode } from './error-codes.js';
import { isSaudiMobile, toSaudiE164 } from './phone.js';
import { databaseStore, type EndpointContext, type VerificationStore } from './store.js';

const { APIError } = betterAuthApi;

/** How long a pending verification is kept: past Tawked's longest code life (15 minutes), so Tawked decides when a code expires. */
export const PENDING_TTL_SECONDS = 30 * 60;

export type Purpose = 'sign-in' | 'password-reset';

/** What `onError` is told besides the error itself. */
export interface TawkedErrorInfo {
  /** `send` (Tawked Verify's start) or `check`. */
  operation: 'send' | 'check';
  /** `sign-in` (also a number change and `requireVerification`) or `password-reset`. */
  purpose: Purpose;
  /** The number in E.164. */
  phoneNumber: string;
  /** The code the plugin answered the user with. */
  answeredWith: TawkedErrorCode;
}

/** The Tawked side of the plugin: the key, how codes are sent, and where pending verifications are kept. */
export interface TawkedVerifyOptions {
  /** A Tawked API key with Tawked Verify's send and check (`verify:send`, `verify:check`). Defaults to `TAWKED_API_KEY`. Server-side only. */
  apiKey?: string;
  /** Your own `Tawked` client instead of `apiKey`, `baseUrl`, `timeoutMs` and `maxRetries`. */
  client?: Tawked;
  /** The API's address. Defaults to https://tawked.com. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to the SDK's. */
  timeoutMs?: number;
  /** Retries of a send that failed on the network or a 5xx, under one Idempotency-Key. A check is never retried. Defaults to the SDK's (2). */
  maxRetries?: number;
  /** Partner keys only: the `external_id` of the client application that sends. */
  application?: string;
  /** The message's language: `ar` (Tawked's default), `en`, `auto` (the request's Accept-Language), or a function of the request. */
  lang?: 'ar' | 'en' | 'auto' | ((ctx: EndpointContext | undefined) => 'ar' | 'en' | undefined);
  /** `sms` (the default) or `whatsapp` (answers `unsupported_channel` until Tawked opens it for every account). */
  channel?: 'sms' | 'whatsapp';
  /** Which autofill lines the message carries: `web`, `android` or `none`. Omit it for every line the application has configured. */
  autofill?: 'web' | 'android' | 'none';
  /** Your own reference on each verification (1 to 64 printable characters), shown in the Tawked console. */
  reference?: string | ((phoneNumber: string, ctx: EndpointContext | undefined) => string | undefined);
  /**
   * Send the end user's IP address to Tawked (`client_ip`), so the application's per-IP limit applies.
   * `true` (the default) uses the address Better Auth resolves for the request (its `advanced.ipAddress`
   * settings); `false` sends none; a function returns your own.
   */
  clientIp?: boolean | ((ctx: EndpointContext | undefined) => string | null | undefined);
  /** Where the pending Tawked verification of each number is kept. Defaults to Better Auth's own verification table (`databaseStore()`). */
  store?: VerificationStore;
  /** Called on every failed call to Tawked, after it is logged. Never given the key. */
  onError?: (error: unknown, info: TawkedErrorInfo) => void;
}

type Hooks = Required<Pick<PhoneNumberOptions, 'sendOTP' | 'verifyOTP' | 'phoneNumberValidator'>>;

function fail(code: TawkedErrorCode, status: ConstructorParameters<typeof APIError>[0]): never {
  throw new APIError(status, { ...TAWKED_ERROR_CODES[code] });
}

/** Why a key or account refused, for the server's log (never shown to the end user). */
const SETUP_HINTS: Record<string, string> = {
  unauthorized: 'the API key was refused: check TAWKED_API_KEY',
  key_expired: 'the API key has expired: make a new one in the Tawked console',
  insufficient_scope: "the API key lacks Tawked Verify's send or check (verify:send, verify:check)",
  ip_not_allowed: "this server's IP address is not on the key's allowlist",
  account_not_active: 'the Tawked account is not active',
  application_paused: 'the application is paused in the Tawked console',
  insufficient_credits: 'the balance is empty: top up in the Tawked console',
  spend_cap_reached: "the application's daily spend cap is reached",
  sandbox_quota_exceeded: "the test key's 10 sends are used: switch to the live key",
  sandbox_unsupported_channel: 'a test key sends by SMS only',
  unsupported_channel: 'this channel is not enabled for the account',
  service_required: 'a partner key needs the `application` option',
  service_not_found: 'the `application` option names no application of this partner',
  live_key_required: 'this call needs the live key',
};

export function resolveClient(options: TawkedVerifyOptions): Tawked {
  if (options.client) return options.client;
  return new Tawked({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  });
}

function pendingKey(purpose: Purpose, phoneNumber: string): string {
  return `tawked-verify:${purpose}:${phoneNumber}`;
}

function resolveLang(options: TawkedVerifyOptions, ctx: EndpointContext | undefined): 'ar' | 'en' | undefined {
  const { lang } = options;
  if (typeof lang === 'function') return lang(ctx);
  if (lang !== 'auto') return lang;
  const header = ctx?.headers?.get('accept-language') ?? ctx?.request?.headers.get('accept-language') ?? '';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('en')) return 'en';
  if (first.startsWith('ar')) return 'ar';
  return undefined;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function looksLikeIp(value: string): boolean {
  return IPV4.test(value) || (/^[0-9a-f:.]+$/i.test(value) && value.includes(':') && value.length <= 45);
}

function resolveClientIp(options: TawkedVerifyOptions, ctx: EndpointContext | undefined): string | undefined {
  const { clientIp = true } = options;
  if (clientIp === false) return undefined;
  let ip: string | null | undefined;
  if (typeof clientIp === 'function') {
    ip = clientIp(ctx);
  } else if (ctx) {
    const getIP = (betterAuthApi as { getIP?: (req: Request | Headers, opts: unknown) => string | null }).getIP;
    const source = ctx.request ?? ctx.headers;
    if (getIP && source) {
      ip = getIP(source, ctx.context.options);
    } else {
      // Better Auth before 1.7 does not export getIP: read the headers it is told to trust.
      const ipOptions = ctx.context.options.advanced?.ipAddress;
      const headers = ctx.request?.headers ?? ctx.headers;
      if (headers && !ipOptions?.disableIpTracking) {
        for (const name of ipOptions?.ipAddressHeaders ?? ['x-forwarded-for']) {
          ip = headers.get(name)?.split(',')[0];
          if (ip) break;
        }
      }
    }
  }
  ip = ip?.trim();
  // A bad address would make Tawked refuse the whole send; leave it out instead.
  return ip && looksLikeIp(ip) ? ip : undefined;
}

/**
 * The Tawked side of Better Auth's phone-number plugin, as the three options it takes: `sendOTP`
 * starts a Tawked verification (Tawked makes and sends the code; Better Auth's own code is not
 * used), `verifyOTP` checks the code with Tawked, and `phoneNumberValidator` accepts Saudi mobile
 * numbers only. `tawkedPhoneNumber()` wraps this and also normalises numbers and handles password
 * resets; use this one to spread into `phoneNumber({ ... })` yourself.
 *
 * @example phoneNumber({ ...tawkedOTP({ apiKey: process.env.TAWKED_API_KEY }), signUpOnVerification })
 */
export function tawkedOTP(options: TawkedVerifyOptions = {}): Hooks {
  const engine = createEngine(options);
  return {
    sendOTP: ({ phoneNumber }, ctx) => engine.send('sign-in', phoneNumber, ctx),
    verifyOTP: ({ phoneNumber, code }, ctx) => engine.check('sign-in', phoneNumber, code, ctx),
    phoneNumberValidator: (phoneNumber) => isSaudiMobile(phoneNumber),
  };
}

export interface Engine {
  send(purpose: Purpose, phoneNumber: string, ctx?: EndpointContext): Promise<void>;
  /** True when Tawked verified the code; throws Better Auth's `APIError` for every other outcome. */
  check(purpose: Purpose, phoneNumber: string, code: string, ctx?: EndpointContext): Promise<true>;
}

export function createEngine(options: TawkedVerifyOptions): Engine {
  // Made on first use, so a missing key fails the request that needs it, not the server's start.
  let client: Tawked | undefined;
  const tawked = () => (client ??= resolveClient(options));
  const store = options.store ?? databaseStore();

  function report(
    error: unknown,
    info: TawkedErrorInfo,
    ctx: EndpointContext | undefined,
  ): void {
    const logger = ctx?.context.logger;
    if (error instanceof TawkedApiError) {
      const hint = SETUP_HINTS[error.code];
      const line = `Tawked Verify ${info.operation} refused (${error.status} ${error.code}${error.requestId ? `, request ${error.requestId}` : ''})${hint ? `: ${hint}` : ''}.`;
      if (info.answeredWith === 'PHONE_SIGN_IN_UNAVAILABLE' || info.answeredWith === 'OTP_SEND_FAILED') logger?.error(line);
      else logger?.info?.(line);
    } else {
      logger?.error(`Tawked Verify ${info.operation} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      options.onError?.(error, info);
    } catch {
      // An observer must never change the answer.
    }
  }

  function canonical(phoneNumber: string): string {
    return toSaudiE164(phoneNumber) ?? phoneNumber;
  }

  return {
    async send(purpose, raw, ctx) {
      const phoneNumber = canonical(raw);
      const reference = typeof options.reference === 'function' ? options.reference(phoneNumber, ctx) : options.reference;
      const lang = resolveLang(options, ctx);
      const clientIp = resolveClientIp(options, ctx);
      const params = {
        to: phoneNumber,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(lang ? { lang } : {}),
        ...(options.application ? { application: options.application } : {}),
        ...(options.autofill ? { autofill: options.autofill } : {}),
        ...(reference ? { reference } : {}),
        ...(clientIp ? { client_ip: clientIp } : {}),
      };

      let started: { id: string; expires_at: string };
      try {
        started = await tawked().verify.start(params as Parameters<Tawked['verify']['start']>[0]);
      } catch (error) {
        const answer = answerForSend(error);
        report(error, { operation: 'send', purpose, phoneNumber, answeredWith: answer.code }, ctx);
        fail(answer.code, answer.status);
      }
      await store.set(pendingKey(purpose, phoneNumber), { id: started.id, expiresAt: started.expires_at }, PENDING_TTL_SECONDS, ctx);
    },

    async check(purpose, raw, code, ctx) {
      const phoneNumber = canonical(raw);
      const key = pendingKey(purpose, phoneNumber);
      // Taken out first, so two checks racing on one code cannot both pass.
      const pending = await store.take(key, ctx);
      if (!pending) fail('OTP_NOT_FOUND', 'BAD_REQUEST');

      const typed = typeof code === 'string' ? code.trim() : '';
      if (typed === '') {
        await store.set(key, pending, PENDING_TTL_SECONDS, ctx);
        fail('INVALID_OTP', 'BAD_REQUEST');
      }

      let result: { verified: boolean; status: string; attempts_remaining?: number };
      try {
        result = await tawked().verify.check({
          id: pending.id,
          code: typed,
          ...(options.application ? { application: options.application } : {}),
        });
      } catch (error) {
        const answer = answerForCheck(error);
        report(error, { operation: 'check', purpose, phoneNumber, answeredWith: answer.code }, ctx);
        // Unless Tawked has no such verification, the code may still be good once the fault clears.
        if (answer.code !== 'OTP_NOT_FOUND') await store.set(key, pending, PENDING_TTL_SECONDS, ctx);
        fail(answer.code, answer.status);
      }

      if (result.verified && result.status === 'verified') return true;
      switch (result.status) {
        case 'invalid_code':
          if (result.attempts_remaining === undefined || result.attempts_remaining > 0) {
            await store.set(key, pending, PENDING_TTL_SECONDS, ctx);
            fail('INVALID_OTP', 'BAD_REQUEST');
          }
          fail('TOO_MANY_ATTEMPTS', 'FORBIDDEN');
        case 'too_many_attempts':
          fail('TOO_MANY_ATTEMPTS', 'FORBIDDEN');
        case 'expired':
          fail('OTP_EXPIRED', 'BAD_REQUEST');
        case 'failed':
          fail('OTP_DELIVERY_FAILED', 'BAD_REQUEST');
        default:
          // canceled, or anything newer than this package.
          fail('OTP_NOT_FOUND', 'BAD_REQUEST');
      }
    },
  };
}

type Status = ConstructorParameters<typeof APIError>[0];

function answerForSend(error: unknown): { code: TawkedErrorCode; status: Status } {
  if (error instanceof TawkedApiError) {
    switch (error.code) {
      case 'invalid_destination':
        return { code: 'INVALID_PHONE_NUMBER', status: 'BAD_REQUEST' };
      case 'invalid_request':
        return (error.apiMessage ?? '').includes('`to`')
          ? { code: 'INVALID_PHONE_NUMBER', status: 'BAD_REQUEST' }
          : { code: 'PHONE_SIGN_IN_UNAVAILABLE', status: 'SERVICE_UNAVAILABLE' };
      case 'sandbox_unverified_destination':
        return { code: 'PHONE_NUMBER_NOT_ALLOWED_IN_SANDBOX', status: 'FORBIDDEN' };
      case 'rate_limited':
      case 'ip_rate_limited':
      case 'too_many_requests':
        return { code: 'TOO_MANY_OTP_REQUESTS', status: 'TOO_MANY_REQUESTS' };
      case 'send_failed':
      case 'internal_error':
        return { code: 'OTP_SEND_FAILED', status: 'BAD_GATEWAY' };
    }
    if (error.status >= 500) return { code: 'OTP_SEND_FAILED', status: 'BAD_GATEWAY' };
    return { code: 'PHONE_SIGN_IN_UNAVAILABLE', status: 'SERVICE_UNAVAILABLE' };
  }
  if (error instanceof TawkedConnectionError) return { code: 'OTP_SEND_FAILED', status: 'BAD_GATEWAY' };
  return { code: 'PHONE_SIGN_IN_UNAVAILABLE', status: 'SERVICE_UNAVAILABLE' };
}

function answerForCheck(error: unknown): { code: TawkedErrorCode; status: Status } {
  if (error instanceof TawkedApiError) {
    if (error.code === 'not_found') return { code: 'OTP_NOT_FOUND', status: 'BAD_REQUEST' };
    if (error.code === 'too_many_requests') return { code: 'TOO_MANY_OTP_REQUESTS', status: 'TOO_MANY_REQUESTS' };
  }
  return { code: 'PHONE_SIGN_IN_UNAVAILABLE', status: 'SERVICE_UNAVAILABLE' };
}
