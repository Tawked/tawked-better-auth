import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_KEY, STARTED_ID, cookieOf, get, makeAuth, mockClient, post, startMock, type Mock, type Scenario } from './helpers.js';

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock.close());
beforeEach(() => mock.reset());

describe('phone sign-in with Tawked Verify', () => {
  it('signs up a new user: Tawked sends the code, Tawked checks it, Better Auth opens a session', async () => {
    const scenario: Scenario = {};
    const { auth, db } = makeAuth({ client: mockClient(mock, scenario) });

    const sent = await post(auth, '/phone-number/send-otp', { phoneNumber: '0512345678' }, { 'x-forwarded-for': '203.0.113.7' });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ message: 'code sent' });

    // One start, to the number in E.164, with the end user's IP; Better Auth's own code is not sent.
    const starts = mock.bodies('/v1/verify/start');
    expect(starts).toEqual([{ to: '+966512345678', client_ip: '203.0.113.7' }]);
    const start = mock.requests.find((r) => r.path === '/v1/verify/start')!;
    expect(start.headers.authorization).toBe(`Bearer ${LIVE_KEY}`);
    expect(start.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/); // the SDK keys every send, retries on or off

    // The pending verification sits in Better Auth's own verification table.
    expect(db.verification!.some((row) => row.identifier === 'tawked-verify:sign-in:+966512345678')).toBe(true);

    const verified = await post(auth, '/phone-number/verify', { phoneNumber: '+966 51 234 5678', code: '482913' });
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe(true);
    expect(typeof verified.body.token).toBe('string');
    expect(verified.body.user).toMatchObject({ phoneNumber: '+966512345678', phoneNumberVerified: true, email: '966512345678@phone.example.com' });

    expect(mock.bodies('/v1/verify/check')).toEqual([{ id: STARTED_ID, code: '482913' }]);
    expect(db.verification!.some((row) => String(row.identifier).startsWith('tawked-verify:'))).toBe(false);

    const session = await get(auth, '/get-session', { cookie: cookieOf(verified) });
    expect(session.status).toBe(200);
    expect((session.body.user as Record<string, unknown>).phoneNumber).toBe('+966512345678');
  });

  it('signs the same person in again however they type the number', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}) });
    for (const typed of ['0512345678', '٠٥١٢٣٤٥٦٧٨', '00966512345678', '966-51-234-5678']) {
      expect((await post(auth, '/phone-number/send-otp', { phoneNumber: typed })).status).toBe(200);
      const verified = await post(auth, '/phone-number/verify', { phoneNumber: typed, code: '111111' });
      expect(verified.status).toBe(200);
    }
    expect(db.user).toHaveLength(1);
    expect(db.user![0]!.phoneNumber).toBe('+966512345678');
  });

  it('lets one code finish one sign-in only', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    expect((await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' })).status).toBe(200);
    const again = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('OTP_NOT_FOUND');
    expect(mock.bodies('/v1/verify/check')).toHaveLength(1);
  });

  it('lets two checks racing on one code open one session', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const answers = await Promise.all([
      post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' }),
      post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' }),
    ]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 400]);
    expect(mock.bodies('/v1/verify/check')).toHaveLength(1);
  });

  it('keeps the verification after a wrong code, so the right one still works', async () => {
    const scenario: Scenario = { check: [{ example: 'Wrong code' }] };
    const { auth } = makeAuth({ client: mockClient(mock, scenario) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });

    const wrong = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ code: 'INVALID_OTP', message: 'Invalid OTP' });

    const right = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '482913' });
    expect(right.status).toBe(200);
    expect(mock.bodies('/v1/verify/check').map((b) => b.id)).toEqual([STARTED_ID, STARTED_ID]);
  });

  it('trims the typed code and never spends an attempt on an empty one', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const empty = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '   ' });
    expect(empty.body.code).toBe('INVALID_OTP');
    expect(mock.bodies('/v1/verify/check')).toHaveLength(0);
    expect((await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: ' 482913 ' })).status).toBe(200);
    expect(mock.bodies('/v1/verify/check')[0]!.code).toBe('482913');
  });

  it.each([
    ['Attempts exhausted', 403, 'TOO_MANY_ATTEMPTS'],
    ['Expired', 400, 'OTP_EXPIRED'],
    ['Send failed / prior attempts exhausted', 400, 'OTP_DELIVERY_FAILED'],
    ['Canceled', 400, 'OTP_NOT_FOUND'],
  ])('answers Tawked\'s "%s" with %i %s and asks for a new code', async (example, status, code) => {
    const { auth } = makeAuth({ client: mockClient(mock, { check: [{ example }] }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const answer = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' });
    expect(answer.status).toBe(status);
    expect(answer.body.code).toBe(code);
    // The verification is finished: the next try needs a new code.
    const next = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' });
    expect(next.body.code).toBe('OTP_NOT_FOUND');
  });

  it('answers OTP_NOT_FOUND when no code was sent to the number', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    const answer = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('OTP_NOT_FOUND');
    expect(mock.requests).toHaveLength(0);
  });

  it('checks against the newest code when the user asks for another', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    expect(mock.bodies('/v1/verify/start')).toHaveLength(2);
    expect(db.verification!.filter((row) => String(row.identifier).startsWith('tawked-verify:'))).toHaveLength(1);
    expect((await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' })).status).toBe(200);
  });

  it('refuses a number that is not a Saudi mobile without calling Tawked', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    for (const phoneNumber of ['+15551234567', '0112345678', 'not a number', '+9665123456']) {
      const answer = await post(auth, '/phone-number/send-otp', { phoneNumber });
      expect(answer.status).toBe(400);
      expect(answer.body.code).toBe('INVALID_PHONE_NUMBER');
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('accepts your own phoneNumberValidator', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}), phoneNumberValidator: (n) => n.endsWith('8') });
    expect((await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345679' })).body.code).toBe('INVALID_PHONE_NUMBER');
    expect((await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' })).status).toBe(200);
  });

  it('keeps the number as typed when normalizePhoneNumber is off', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}), normalizePhoneNumber: false, phoneNumberValidator: () => true });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '0512345678' });
    // Tawked is still given E.164, and the check still finds the pending verification.
    expect(mock.bodies('/v1/verify/start')[0]!.to).toBe('+966512345678');
    const verified = await post(auth, '/phone-number/verify', { phoneNumber: '0512345678', code: '123456' });
    expect(verified.status).toBe(200);
    expect(db.user![0]!.phoneNumber).toBe('0512345678');
  });

  it('works through auth.api on the server, hooks included', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, {}) });
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: '0512345678' } });
    expect(mock.bodies('/v1/verify/start')[0]!.to).toBe('+966512345678');
    const result = await auth.api.verifyPhoneNumber({ body: { phoneNumber: '0512345678', code: '123456', disableSession: true } });
    expect(result.status).toBe(true);
    expect(result.token).toBeNull();
    expect(result.user?.phoneNumber).toBe('+966512345678');
  });

  it('consumes a code without a session through consumePhoneNumberOTP', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}) });
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: '+966512345678' } });
    const result = await auth.api.consumePhoneNumberOTP({ body: { phoneNumber: '+966512345678', code: '123456' } });
    expect(result).toEqual({ status: true });
    expect(db.user).toHaveLength(0);
    await expect(auth.api.consumePhoneNumberOTP({ body: { phoneNumber: '+966512345678', code: '123456' } })).rejects.toMatchObject({
      body: { code: 'OTP_NOT_FOUND' },
    });
  });

  it('changes a signed-in user\'s number after Tawked verifies the new one', async () => {
    const { auth, db } = makeAuth({ client: mockClient(mock, {}) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const first = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '123456' });
    const cookie = cookieOf(first);

    await post(auth, '/phone-number/send-otp', { phoneNumber: '0598765432' }, { cookie });
    const changed = await post(auth, '/phone-number/verify', { phoneNumber: '0598765432', code: '123456', updatePhoneNumber: true }, { cookie });
    expect(changed.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.user![0]!.phoneNumber).toBe('+966598765432');
  });
});
