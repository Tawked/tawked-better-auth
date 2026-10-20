// The e-mail helpers: Better Auth's verification link, password reset link and emailOTP codes sent
// through Tawked Email, against the local mock (never a real e-mail).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { Tawked } from '@tawked/sdk';
import { tawkedEmail } from '../src/index.js';
import { emptyDb, LIVE_KEY, ORIGIN, post, startMock, type Mock } from './helpers.js';

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock.close());
beforeEach(() => mock.reset());

const user = { id: 'user_1', email: 'sara@example.com', name: 'سارة' };
const sends = () => mock.requests.filter((r) => r.path === '/v1/email/messages');
const client = () => new Tawked({ apiKey: LIVE_KEY, baseUrl: mock.url, maxRetries: 0 });

describe('tawkedEmail', () => {
  it('sends the verification link in Arabic by default, from the sender given, under a key made from the token', async () => {
    const email = tawkedEmail({ client: client(), from: { name: 'متجر أكمي', address: 'no-reply@acme.sa' }, appName: 'متجر أكمي' });
    await email.sendVerificationEmail({ user, url: 'https://acme.sa/verify?token=abc', token: 'abc' });
    const [request] = sends();
    const body = JSON.parse(request!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ to: 'sara@example.com', from: { name: 'متجر أكمي', address: 'no-reply@acme.sa' }, subject: 'أكّد بريدك الإلكتروني', tags: [{ name: 'better_auth', value: 'verification' }] });
    expect(body.text).toContain('https://acme.sa/verify?token=abc');
    expect(body.text).toContain('في متجر أكمي');
    expect(body.html).toContain('dir="rtl"');
    expect(request!.headers['idempotency-key']).toMatch(/^better-auth:verify:[0-9a-f]{40}$/);
    expect(request!.headers['idempotency-key']).not.toContain('abc');
  });

  it('the same link twice is one key: a retry never sends it twice', async () => {
    const email = tawkedEmail({ client: client() });
    await email.sendResetPassword({ user, url: 'https://acme.sa/reset?token=t1', token: 't1' });
    await email.sendResetPassword({ user, url: 'https://acme.sa/reset?token=t1', token: 't1' });
    const keys = sends().map((r) => r.headers['idempotency-key']);
    expect(keys[0]).toMatch(/^better-auth:reset:[0-9a-f]{40}$/);
    expect(keys[1]).toBe(keys[0]);
    await email.sendResetPassword({ user, url: 'https://acme.sa/reset?token=t2', token: 't2' });
    expect(sends().at(-1)!.headers['idempotency-key']).not.toBe(keys[0]);
  });

  it('follows Accept-Language for English, and takes a fixed language', async () => {
    const email = tawkedEmail({ client: client() });
    await email.sendResetPassword({ user, url: 'https://acme.sa/r', token: 'x' }, new Request('https://acme.sa', { headers: { 'accept-language': 'en-US,en;q=0.9' } }));
    expect(JSON.parse(sends().at(-1)!.body)).toMatchObject({ subject: 'Reset your password' });
    await tawkedEmail({ client: client(), language: 'en' }).sendVerificationEmail({ user, url: 'https://acme.sa/v', token: 'y' });
    expect(JSON.parse(sends().at(-1)!.body)).toMatchObject({ subject: 'Confirm your email' });
  });

  it('sends each emailOTP code with its own subject and the code', async () => {
    const email = tawkedEmail({ client: client() });
    for (const type of ['sign-in', 'email-verification', 'forget-password', 'change-email'] as const) {
      await email.sendVerificationOTP({ email: 'Sara@Example.com', otp: '482913', type });
      const body = JSON.parse(sends().at(-1)!.body) as { subject: string; text: string };
      expect(body.subject).toContain('482913');
      expect(body.text).toContain('482913');
      expect(sends().at(-1)!.headers['idempotency-key']).toMatch(new RegExp(`^better-auth:otp:${type}:[0-9a-f]{40}$`));
    }
    expect(new Set(sends().map((r) => JSON.parse(r.body).subject)).size).toBe(4);
  });

  it('gives each emailOTP send its own key, never derived from the code, so a resend goes out', async () => {
    const email = tawkedEmail({ client: client() });
    await email.sendVerificationOTP({ email: 'sara@example.com', otp: '482913', type: 'sign-in' });
    await email.sendVerificationOTP({ email: 'sara@example.com', otp: '482913', type: 'sign-in' });
    const [first, second] = sends().slice(-2).map((r) => r.headers['idempotency-key']!);
    expect(second).not.toBe(first);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sara@example.com:482913'));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    for (const key of [first!, second!]) expect(hash.startsWith(key.split(':').at(-1)!)).toBe(false);
  });

  it('takes your own words', async () => {
    const email = tawkedEmail({ client: client(), messages: { otp: ({ otp }) => ({ subject: `رمزك ${otp}`, text: `الرمز ${otp}` }) } });
    await email.sendVerificationOTP({ email: 'a@b.sa', otp: '111222', type: 'sign-in' });
    expect(JSON.parse(sends().at(-1)!.body)).toMatchObject({ subject: 'رمزك 111222', text: 'الرمز 111222' });
  });

  it('throws the API\'s error to Better Auth and tells onError, never with the key', async () => {
    const seen: unknown[] = [];
    const failing = new Tawked({ apiKey: LIVE_KEY, baseUrl: mock.url, maxRetries: 0, defaultHeaders: { 'x-mock-error': 'email_early_access' } });
    const email = tawkedEmail({ client: failing, onError: (error, info) => seen.push(info) });
    const error = await email.sendVerificationEmail({ user, url: 'https://acme.sa/v', token: 'z' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'email_early_access', status: 403 });
    expect(seen).toEqual([{ message: 'verification', to: 'sara@example.com' }]);
    expect(String((error as Error).message)).not.toContain(LIVE_KEY);
  });

  it('works inside a real Better Auth: the emailOTP plugin sends its code through Tawked', async () => {
    const email = tawkedEmail({ client: client(), language: 'ar' });
    const auth = betterAuth({
      baseURL: ORIGIN,
      secret: 'a-test-secret-that-is-long-enough-for-better-auth-0001',
      database: memoryAdapter(emptyDb()),
      emailAndPassword: { enabled: true, sendResetPassword: email.sendResetPassword },
      emailVerification: { sendVerificationEmail: email.sendVerificationEmail },
      plugins: [emailOTP({ sendVerificationOTP: email.sendVerificationOTP })],
    });
    const answer = await post(auth as unknown as Parameters<typeof post>[0], '/email-otp/send-verification-otp', { email: 'sara@example.com', type: 'sign-in' });
    expect(answer.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse(sends().at(-1)!.body) as { to: string; subject: string };
    expect(body.to).toBe('sara@example.com');
    expect(body.subject).toMatch(/^رمز الدخول: \d{6}$/);
  });
});
