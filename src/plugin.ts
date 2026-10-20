import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { phoneNumber, type PhoneNumberOptions } from 'better-auth/plugins/phone-number';
import { TAWKED_ERROR_CODES } from './error-codes.js';
import { isSaudiMobile, toSaudiE164 } from './phone.js';
import { createEngine, type TawkedVerifyOptions } from './verify.js';
import * as betterAuthApi from 'better-auth/api';

const { APIError } = betterAuthApi;

/**
 * Everything Better Auth's phone-number plugin takes, except what Tawked now does: Tawked makes,
 * sends and checks the code, so `sendOTP`, `verifyOTP` and `sendPasswordResetOTP` are the plugin's,
 * and the code's length, life and attempts (`otpLength`, `expiresIn`, `allowedAttempts`) are the
 * application's Verify settings in the Tawked console.
 */
export interface TawkedPhoneNumberOptions
  extends TawkedVerifyOptions,
    Omit<PhoneNumberOptions, 'sendOTP' | 'verifyOTP' | 'sendPasswordResetOTP' | 'otpLength' | 'expiresIn' | 'allowedAttempts'> {
  /**
   * Rewrite every phone number that reaches the plugin's endpoints to E.164 (`+9665XXXXXXXX`), so
   * `0512345678` and `+966 51 234 5678` are one user. Defaults to `true`.
   */
  normalizePhoneNumber?: boolean;
  /**
   * Password resets by phone (`requestPasswordReset` and `resetPassword`) with the code from Tawked.
   * Defaults to `true`. Only matters when users also have a password.
   */
  passwordReset?: boolean;
}

/** Better Auth's phone-number plugin, with Tawked's error codes beside its own. */
export type TawkedPhoneNumberPlugin = Omit<ReturnType<typeof phoneNumber>, 'hooks' | '$ERROR_CODES'> & {
  hooks: NonNullable<BetterAuthPlugin['hooks']>;
  $ERROR_CODES: ReturnType<typeof phoneNumber>['$ERROR_CODES'] & typeof TAWKED_ERROR_CODES;
};

/** The endpoints that carry `phoneNumber` in their body. */
const PHONE_PATHS = new Set([
  '/phone-number/send-otp',
  '/phone-number/verify',
  '/sign-in/phone-number',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
]);

const RESET_PATH = '/phone-number/reset-password';

/**
 * Phone number sign-in for Better Auth, with the code made, sent and checked by Tawked Verify.
 * It is Better Auth's own phone-number plugin (same endpoints, same client, same schema) with
 * Tawked in place of its code: `sendOTP` starts a Tawked verification and `verifyOTP` asks
 * Tawked whether the code is right.
 *
 * @example
 * betterAuth({ plugins: [tawkedPhoneNumber({ signUpOnVerification: { getTempEmail: (p) => `${p}@phone.example.com` } })] })
 */
export function tawkedPhoneNumber(options: TawkedPhoneNumberOptions = {}): TawkedPhoneNumberPlugin {
  const {
    apiKey: _apiKey,
    client: _client,
    baseUrl: _baseUrl,
    timeoutMs: _timeoutMs,
    maxRetries: _maxRetries,
    application: _application,
    lang: _lang,
    channel: _channel,
    autofill: _autofill,
    reference: _reference,
    clientIp: _clientIp,
    store: _store,
    onError: _onError,
    normalizePhoneNumber = true,
    passwordReset = true,
    ...phoneNumberOptions
  } = options;
  const engine = createEngine(options);

  const base = phoneNumber({
    phoneNumberValidator: (value) => isSaudiMobile(value),
    ...phoneNumberOptions,
    sendOTP: ({ phoneNumber: number }, ctx) => engine.send('sign-in', number, ctx),
    verifyOTP: ({ phoneNumber: number, code }, ctx) => engine.check('sign-in', number, code, ctx),
    ...(passwordReset
      ? { sendPasswordResetOTP: ({ phoneNumber: number }, ctx) => engine.send('password-reset', number, ctx) }
      : {}),
  } satisfies PhoneNumberOptions);

  const tawkedHook = {
    matcher: (ctx: { path?: string }) => typeof ctx.path === 'string' && PHONE_PATHS.has(ctx.path),
    handler: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      if (typeof body.phoneNumber !== 'string') return;
      let next = body;

      if (normalizePhoneNumber) {
        const e164 = toSaudiE164(body.phoneNumber);
        if (e164 && e164 !== body.phoneNumber) next = { ...next, phoneNumber: e164 };
      }

      if (passwordReset && ctx.path === RESET_PATH) {
        // Better Auth checks a reset against a code of its own, which it never sent anyone. Tawked
        // checks the code the user received; only then is Better Auth's own code put in its place.
        const number = next.phoneNumber as string;
        await engine.check('password-reset', number, typeof next.otp === 'string' ? next.otp : '', ctx);
        const row = await ctx.context.internalAdapter.findVerificationValue(`${number}-request-password-reset`);
        const own = typeof row?.value === 'string' ? row.value.split(':')[0] : undefined;
        if (!own) throw new APIError('BAD_REQUEST', { ...TAWKED_ERROR_CODES.OTP_NOT_FOUND });
        next = { ...next, otp: own };
      }

      if (next !== body) return { context: { body: next } };
    }),
  };

  return {
    ...base,
    hooks: {
      ...base.hooks,
      before: [...base.hooks.before, tawkedHook] as NonNullable<NonNullable<BetterAuthPlugin['hooks']>['before']>,
    },
    $ERROR_CODES: { ...base.$ERROR_CODES, ...TAWKED_ERROR_CODES },
  };
}
