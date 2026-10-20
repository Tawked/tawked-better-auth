import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthClient } from 'better-auth/client';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { memoryStore, tawkedOTP, TAWKED_ERROR_CODES, type VerificationStore } from '../src/index.js';
import { tawkedPhoneNumberClient } from '../src/client.js';
import {
  ORIGIN,
  PARTNER_KEY,
  cookieOf,
  emptyDb,
  makeAuth,
  mockClient,
  post,
  startMock,
  type Mock,
  type Scenario,
} from './helpers.js';

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock.close());
beforeEach(() => mock.reset());

const PHONE = '+966512345678';

describe('what is sent to Tawked', () => {
  it('passes lang, channel, autofill and reference', async () => {
    const { auth } = makeAuth({
      client: mockClient(mock, {}),
      lang: 'en',
      channel: 'sms',
      autofill: 'web',
      reference: (phone) => `signin-${phone.slice(-4)}`,
      clientIp: false,
    });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE }, { 'x-forwarded-for': '203.0.113.7' });
    expect(mock.bodies('/v1/verify/start')).toEqual([
      { to: PHONE, channel: 'sms', lang: 'en', autofill: 'web', reference: 'signin-5678' },
    ]);
  });

  it.each([
    ['en-US,en;q=0.9', 'en'],
    ['ar-SA,ar;q=0.9', 'ar'],
    ['fr-FR', undefined],
  ])("picks the language from Accept-Language %s with lang: 'auto'", async (header, lang) => {
    const { auth } = makeAuth({ client: mockClient(mock, {}), lang: 'auto', clientIp: false });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE }, { 'accept-language': header });
    expect(mock.bodies('/v1/verify/start')[0]!.lang).toBe(lang);
  });

  it('takes the client IP from a function, and leaves out one that is not an IP address', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}), clientIp: (ctx) => ctx?.headers?.get('x-real-ip') });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE }, { 'x-real-ip': '2001:db8::1' });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE }, { 'x-real-ip': 'unknown' });
    expect(mock.bodies('/v1/verify/start').map((b) => b.client_ip)).toEqual(['2001:db8::1', undefined]);
  });

  it('names the application on start and check with a partner key', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}, { apiKey: PARTNER_KEY }), application: 'shop-42', clientIp: false });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect((await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
    expect(mock.bodies('/v1/verify/start')[0]).toEqual({ to: PHONE, application: 'shop-42' });
    expect(mock.bodies('/v1/verify/check')[0]).toMatchObject({ application: 'shop-42' });
  });

  it('says in the log that a partner key needs the application', async () => {
    const logs: { level: string; message: string }[] = [];
    const { auth } = makeAuth({ client: mockClient(mock, {}, { apiKey: PARTNER_KEY }) }, { logs });
    const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(answer.body.code).toBe('PHONE_SIGN_IN_UNAVAILABLE');
    expect(logs.some((l) => l.message.includes('a partner key needs the `application` option'))).toBe(true);
  });
});

describe('where the pending verification is kept', () => {
  it('in Better Auth\'s table by default, so another instance can check the code', async () => {
    const db = emptyDb();
    const one = makeAuth({ client: mockClient(mock, {}) }, { db }).auth;
    const two = makeAuth({ client: mockClient(mock, {}) }, { db }).auth;
    await post(one, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect((await post(two, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
  });

  it('in memory, which another instance cannot see (why the README warns about serverless)', async () => {
    const db = emptyDb();
    const one = makeAuth({ client: mockClient(mock, {}), store: memoryStore() }, { db }).auth;
    const two = makeAuth({ client: mockClient(mock, {}), store: memoryStore() }, { db }).auth;
    await post(one, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(db.verification!.some((row) => String(row.identifier).startsWith('tawked-verify:'))).toBe(false);
    expect((await post(two, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).body.code).toBe('OTP_NOT_FOUND');
    expect((await post(one, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
  });

  it('in your own store', async () => {
    const kept = new Map<string, string>();
    const store: VerificationStore = {
      set: (key, value, ttl) => {
        expect(ttl).toBe(1800);
        kept.set(key, JSON.stringify(value));
      },
      take: (key) => {
        const raw = kept.get(key);
        kept.delete(key);
        return raw ? JSON.parse(raw) : null;
      },
    };
    const { auth } = makeAuth({ client: mockClient(mock, {}), store });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(JSON.parse(kept.get(`tawked-verify:sign-in:${PHONE}`)!)).toEqual({ id: expect.any(String), expiresAt: '2026-09-01T12:34:56.789Z' });
    expect((await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
    expect(kept.size).toBe(0);
  });

  it('memoryStore forgets an entry after its time', async () => {
    const store = memoryStore();
    await store.set('k', { id: 'a', expiresAt: '' }, 0);
    expect(await store.take('k')).toBeNull();
    await store.set('k', { id: 'a', expiresAt: '' }, 60);
    expect(await store.take('k')).toEqual({ id: 'a', expiresAt: '' });
    expect(await store.take('k')).toBeNull();
  });
});

describe('password reset by phone', () => {
  async function phoneUser(auth: ReturnType<typeof makeAuth>['auth']) {
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    const signedIn = await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' });
    expect(signedIn.status).toBe(200);
    mock.reset();
    return signedIn;
  }

  it('sends the reset code through Tawked and resets once Tawked verifies it', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await phoneUser(auth);

    const requested = await post(auth, '/phone-number/request-password-reset', { phoneNumber: '0512345678' });
    expect(requested.body).toEqual({ status: true });
    expect(mock.bodies('/v1/verify/start')).toMatchObject([{ to: PHONE }]);

    const reset = await post(auth, '/phone-number/reset-password', { phoneNumber: '0512345678', otp: '734125', newPassword: 'a-new-password-1' });
    expect(reset.status).toBe(200);
    expect(mock.bodies('/v1/verify/check')).toEqual([{ id: expect.any(String), code: '734125' }]);

    const signedIn = await post(auth, '/sign-in/phone-number', { phoneNumber: PHONE, password: 'a-new-password-1' });
    expect(signedIn.status).toBe(200);
    expect(cookieOf(signedIn)).toContain('session_token');
  });

  it('refuses a wrong reset code and leaves the password as it was', async () => {
    const scenario: Scenario = {};
    const { auth, db } = makeAuth({ client: mockClient(mock, scenario) });
    await phoneUser(auth);
    scenario.check = [{ example: 'Wrong code' }];
    await post(auth, '/phone-number/request-password-reset', { phoneNumber: PHONE });
    const reset = await post(auth, '/phone-number/reset-password', { phoneNumber: PHONE, otp: '000000', newPassword: 'a-new-password-1' });
    expect(reset.status).toBe(400);
    expect(reset.body.code).toBe('INVALID_OTP');
    expect(db.account!.some((a) => a.providerId === 'credential')).toBe(false);
  });

  it('refuses a reset with no code sent, even with Better Auth\'s own code', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}) });
    await phoneUser(auth);
    // A number with no user: Better Auth keeps a code of its own but sends nothing, and so does Tawked.
    await post(auth, '/phone-number/request-password-reset', { phoneNumber: '+966598765432' });
    expect(mock.bodies('/v1/verify/start')).toHaveLength(0);
    const own = String(db.verification!.find((r) => r.identifier === '+966598765432-request-password-reset')!.value).split(':')[0];
    const reset = await post(auth, '/phone-number/reset-password', { phoneNumber: '+966598765432', otp: own, newPassword: 'a-new-password-1' });
    expect(reset.status).toBe(400);
    expect(reset.body.code).toBe('OTP_NOT_FOUND');
    expect(mock.bodies('/v1/verify/check')).toHaveLength(0);
  });

  it('keeps reset codes and sign-in codes apart', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await phoneUser(auth);
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    const reset = await post(auth, '/phone-number/reset-password', { phoneNumber: PHONE, otp: '123456', newPassword: 'a-new-password-1' });
    expect(reset.body.code).toBe('OTP_NOT_FOUND');
  });

  it('can be turned off, leaving Better Auth without a reset sender', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}), passwordReset: false });
    await phoneUser(auth);
    await post(auth, '/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(mock.bodies('/v1/verify/start')).toHaveLength(0);
  });
});

describe('requireVerification', () => {
  it('sends a Tawked code when an unverified user signs in with a password, and verifying lets them in', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}), requireVerification: true });
    // A user who signed up by email and added a number that was never verified.
    const signedUp = await post(auth, '/sign-up/email', { email: 'sara@example.com', password: 'a-password-123', name: 'Sara' });
    expect(signedUp.status).toBe(200);
    db.user![0]!.phoneNumber = PHONE;
    db.user![0]!.phoneNumberVerified = false;

    const refused = await post(auth, '/sign-in/phone-number', { phoneNumber: '0512345678', password: 'a-password-123' });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('PHONE_NUMBER_NOT_VERIFIED');
    expect(mock.bodies('/v1/verify/start')[0]!.to).toBe(PHONE);

    expect((await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
    expect((await post(auth, '/sign-in/phone-number', { phoneNumber: PHONE, password: 'a-password-123' })).status).toBe(200);
  });
});

describe('tawkedOTP() inside your own phoneNumber()', () => {
  it('signs in with Tawked through Better Auth\'s plugin as you configured it', async () => {
    const auth = betterAuth({
      baseURL: ORIGIN,
      secret: 'a-test-secret-that-is-long-enough-for-better-auth-0001',
      database: memoryAdapter(emptyDb()),
      plugins: [
        phoneNumber({
          ...tawkedOTP({ client: mockClient(mock, {}), clientIp: false }),
          signUpOnVerification: { getTempEmail: (p) => `${p}@phone.example.com` },
        }),
      ],
    });
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: PHONE } });
    expect(mock.bodies('/v1/verify/start')).toEqual([{ to: PHONE }]);
    const result = await auth.api.verifyPhoneNumber({ body: { phoneNumber: PHONE, code: '123456' } });
    expect(result.user?.phoneNumber).toBe(PHONE);
    await expect(auth.api.sendPhoneNumberOTP({ body: { phoneNumber: '+15551234567' } })).rejects.toMatchObject({ body: { code: 'INVALID_PHONE_NUMBER' } });
  });
});

describe('the client', () => {
  it('runs the whole sign-in from createAuthClient, and knows Tawked\'s error codes', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, { check: [{ example: 'Wrong code' }] }) });
    let cookie = '';
    const client = createAuthClient({
      baseURL: `${ORIGIN}/api/auth`,
      plugins: [tawkedPhoneNumberClient()],
      fetchOptions: {
        customFetchImpl: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('origin', ORIGIN);
          if (cookie) headers.set('cookie', cookie);
          const response = await auth.handler(new Request(input, { ...init, headers }));
          const set = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
          if (set) cookie = set;
          return response;
        },
      },
    });

    // The codes are on the client's type (Better Auth keeps them type-only) and on the plugin object.
    expectTypeOf(client.$ERROR_CODES).toHaveProperty('PHONE_SIGN_IN_UNAVAILABLE');
    expectTypeOf(client.$ERROR_CODES).toHaveProperty('INVALID_OTP');
    expect(tawkedPhoneNumberClient().$ERROR_CODES.PHONE_SIGN_IN_UNAVAILABLE).toEqual(TAWKED_ERROR_CODES.PHONE_SIGN_IN_UNAVAILABLE);
    expect(tawkedPhoneNumberClient().id).toBe('phoneNumber');

    const sent = await client.phoneNumber.sendOtp({ phoneNumber: '0512345678' });
    expect(sent.error).toBeNull();

    const wrong = await client.phoneNumber.verify({ phoneNumber: '0512345678', code: '000000' });
    expect(wrong.error?.code).toBe('INVALID_OTP');

    const right = await client.phoneNumber.verify({ phoneNumber: '0512345678', code: '482913' });
    expect(right.error).toBeNull();
    expect(right.data?.user?.phoneNumber).toBe(PHONE);

    const session = await client.getSession();
    expect(session.data?.user.phoneNumber).toBe(PHONE);
  });
});
