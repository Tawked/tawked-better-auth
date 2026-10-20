// Better Auth's e-mails through Tawked Email (early access): the verification link, the password reset
// link, and the emailOTP plugin's codes, in Arabic or English, each sent once under an Idempotency-Key
// so a retry never sends it twice. A code's key is random per send, never
// derived from the code (it is stored with the message), so a resend of the same code goes out.

import { Tawked } from '@tawked/sdk';

/** A Better Auth user, as the callbacks are given it. */
export interface EmailUser {
  id: string;
  email: string;
  name?: string | null;
  [key: string]: unknown;
}

/** What the emailOTP plugin sends a code for. */
export type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

/** One message: what Tawked sends. */
export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

/** The language of a message, or a function of the request that picks it. */
export type EmailLanguage = 'ar' | 'en' | 'auto' | ((request: Request | undefined) => 'ar' | 'en' | undefined);

/** Options of `tawkedEmail`. */
export interface TawkedEmailOptions {
  /**
   * The sender: an address on a domain your application verified in Tawked Email, or `{ name, address }`,
   * or `"Name <address>"`. Omit it for the domain's default sender.
   */
  from?: string | { name?: string; address: string };
  /** A Tawked API key with Tawked Email's send (`email:send`). Defaults to `TAWKED_API_KEY`. Server-side only. */
  apiKey?: string;
  /** Your own `Tawked` client instead of `apiKey` and `baseUrl`. */
  client?: Tawked;
  /** The API's address. Defaults to https://tawked.com. */
  baseUrl?: string;
  /** Partner keys only: the `external_id` of the client application that sends. */
  application?: string;
  /** `ar`, `en`, `auto` (the request's Accept-Language, else Arabic; the default) or a function of the request. */
  language?: EmailLanguage;
  /** Your product's name, said in the default messages ("…in {appName}"). */
  appName?: string;
  /** Your own words in place of the defaults, per message; return undefined to keep the default. */
  messages?: {
    verification?: (data: { user: EmailUser; url: string; language: 'ar' | 'en' }) => EmailContent | undefined;
    resetPassword?: (data: { user: EmailUser; url: string; language: 'ar' | 'en' }) => EmailContent | undefined;
    otp?: (data: { email: string; otp: string; type: OtpType; language: 'ar' | 'en' }) => EmailContent | undefined;
  };
  /** Called when Tawked refuses or cannot be reached, before the error is thrown to Better Auth. Never given the key. */
  onError?: (error: unknown, info: { message: 'verification' | 'reset-password' | 'otp'; to: string }) => void;
}

/** The three callbacks, to put where Better Auth asks for them. */
export interface TawkedEmailCallbacks {
  /** For `emailVerification.sendVerificationEmail`. */
  sendVerificationEmail: (data: { user: EmailUser; url: string; token: string }, request?: Request) => Promise<void>;
  /** For `emailAndPassword.sendResetPassword`. */
  sendResetPassword: (data: { user: EmailUser; url: string; token: string }, request?: Request) => Promise<void>;
  /** For the emailOTP plugin's `sendVerificationOTP`. */
  sendVerificationOTP: (data: { email: string; otp: string; type: OtpType }, ctx?: unknown) => Promise<void>;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function html(language: 'ar' | 'en', before: string[], link?: { url: string; label: string }, after: string[] = []): string {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const paragraphs = (lines: string[]) => lines.map((p) => `<p>${escape(p)}</p>`).join('');
  const button = link ? `<p><a href="${escape(link.url)}">${escape(link.label)}</a></p><p dir="ltr">${escape(link.url)}</p>` : '';
  return `<div dir="${dir}" lang="${language}">${paragraphs(before)}${button}${paragraphs(after)}</div>`;
}

const IN = (language: 'ar' | 'en', appName?: string) => (appName ? (language === 'ar' ? ` في ${appName}` : ` in ${appName}`) : '');

/** The default words of each message, in Arabic and English. */
export const DEFAULT_MESSAGES = {
  verification(language: 'ar' | 'en', url: string, appName?: string): EmailContent {
    if (language === 'ar') {
      const lines = [`افتح الرابط أدناه لتأكيد بريدك الإلكتروني${IN(language, appName)}.`, 'إن لم تطلب ذلك فتجاهل هذه الرسالة.'];
      return { subject: 'أكّد بريدك الإلكتروني', text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: html(language, [lines[0]!], { url, label: 'تأكيد البريد' }, [lines[1]!]) };
    }
    const lines = [`Open the link below to confirm your email${IN(language, appName)}.`, 'If you did not ask for this, ignore this email.'];
    return { subject: 'Confirm your email', text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: html(language, [lines[0]!], { url, label: 'Confirm email' }, [lines[1]!]) };
  },
  resetPassword(language: 'ar' | 'en', url: string, appName?: string): EmailContent {
    if (language === 'ar') {
      const lines = [`افتح الرابط أدناه لاختيار كلمة مرور جديدة${IN(language, appName)}.`, 'إن لم تطلب إعادة تعيينها فتجاهل هذه الرسالة، وتبقى كلمة مرورك كما هي.'];
      return { subject: 'إعادة تعيين كلمة المرور', text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: html(language, [lines[0]!], { url, label: 'اختيار كلمة مرور جديدة' }, [lines[1]!]) };
    }
    const lines = [`Open the link below to choose a new password${IN(language, appName)}.`, 'If you did not ask to reset it, ignore this email: your password stays as it is.'];
    return { subject: 'Reset your password', text: `${lines[0]}\n\n${url}\n\n${lines[1]}`, html: html(language, [lines[0]!], { url, label: 'Choose a new password' }, [lines[1]!]) };
  },
  otp(language: 'ar' | 'en', otp: string, type: OtpType, appName?: string): EmailContent {
    const subjects = {
      ar: { 'sign-in': 'رمز الدخول', 'email-verification': 'رمز تأكيد البريد', 'forget-password': 'رمز إعادة تعيين كلمة المرور', 'change-email': 'رمز تغيير البريد' },
      en: { 'sign-in': 'Your sign-in code', 'email-verification': 'Your email confirmation code', 'forget-password': 'Your password reset code', 'change-email': 'Your email change code' },
    } as const;
    const subject = `${subjects[language][type] ?? subjects[language]['sign-in']}: ${otp}`;
    const lines = language === 'ar' ? [`رمزك${IN(language, appName)} هو ${otp}.`, 'لا تشاركه مع أحد. إن لم تطلبه فتجاهل هذه الرسالة.'] : [`Your code${IN(language, appName)} is ${otp}.`, 'Do not share it with anyone. If you did not ask for it, ignore this email.'];
    return { subject, text: lines.join('\n\n'), html: html(language, lines) };
  },
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function pickLanguage(option: EmailLanguage | undefined, request: Request | undefined): 'ar' | 'en' {
  if (option === 'ar' || option === 'en') return option;
  if (typeof option === 'function') return option(request) ?? 'ar';
  const accept = request?.headers.get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'ar';
}

function requestOf(ctx: unknown): Request | undefined {
  if (typeof Request !== 'undefined' && ctx instanceof Request) return ctx;
  const request = (ctx as { request?: unknown } | undefined)?.request;
  if (typeof Request !== 'undefined' && request instanceof Request) return request;
  const headers = (ctx as { headers?: unknown } | undefined)?.headers;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return new Request('http://localhost/', { headers });
  return undefined;
}

/**
 * Better Auth's e-mails through Tawked Email: the callbacks for `emailVerification.sendVerificationEmail`,
 * `emailAndPassword.sendResetPassword` and the emailOTP plugin's `sendVerificationOTP`. Each is sent once,
 * under an Idempotency-Key (the link's from its token, a code's fresh per send), in Arabic or English.
 *
 * Tawked Email is in early access: your account must be granted Email, and the sender's domain verified.
 *
 * @example
 * const email = tawkedEmail({ from: { name: 'متجر أكمي', address: 'no-reply@acme.sa' }, appName: 'متجر أكمي' });
 * betterAuth({
 *   emailVerification: { sendVerificationEmail: email.sendVerificationEmail },
 *   emailAndPassword: { enabled: true, sendResetPassword: email.sendResetPassword },
 *   plugins: [emailOTP({ sendVerificationOTP: email.sendVerificationOTP })],
 * });
 */
export function tawkedEmail(options: TawkedEmailOptions = {}): TawkedEmailCallbacks {
  let client = options.client;
  const tawked = () => (client ??= new Tawked({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) }));

  async function send(kind: 'verification' | 'reset-password' | 'otp', to: string, content: EmailContent, key: string): Promise<void> {
    const params = {
      to,
      subject: content.subject,
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
      ...(options.from ? { from: options.from } : {}),
      ...(options.application ? { application: options.application } : {}),
      tags: [{ name: 'better_auth', value: kind.replace('-', '_') }],
    };
    try {
      await tawked().email.messages.send(params as Parameters<Tawked['email']['messages']['send']>[0], { idempotencyKey: key });
    } catch (error) {
      try {
        options.onError?.(error, { message: kind, to });
      } catch {
        // An observer must never change the answer.
      }
      throw error;
    }
  }

  return {
    async sendVerificationEmail({ user, url, token }, request) {
      const language = pickLanguage(options.language, request);
      const content = options.messages?.verification?.({ user, url, language }) ?? DEFAULT_MESSAGES.verification(language, url, options.appName);
      await send('verification', user.email, content, `better-auth:verify:${await sha256(token)}`);
    },
    async sendResetPassword({ user, url, token }, request) {
      const language = pickLanguage(options.language, request);
      const content = options.messages?.resetPassword?.({ user, url, language }) ?? DEFAULT_MESSAGES.resetPassword(language, url, options.appName);
      await send('reset-password', user.email, content, `better-auth:reset:${await sha256(`${user.id}:${token}`)}`);
    },
    async sendVerificationOTP({ email, otp, type }, ctx) {
      const language = pickLanguage(options.language, requestOf(ctx));
      const content = options.messages?.otp?.({ email, otp, type, language }) ?? DEFAULT_MESSAGES.otp(language, otp, type, options.appName);
      // A fresh random key per send: the SDK's own retries reuse it, a resend of the same code is a new
      // message, and nothing stored with the message (the key) reveals the code.
      await send('otp', email, content, `better-auth:otp:${type}:${randomHex(20)}`);
    },
  };
}
