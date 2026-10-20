import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TawkedErrorInfo } from '../src/index.js';
import { CONTRACT_PATH, LIVE_KEY, makeAuth, mockClient, post, startMock, type LogLine, type Mock, type Scenario } from './helpers.js';

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock.close());
beforeEach(() => mock.reset());

const PHONE = '+966512345678';

describe('when Tawked refuses to send', () => {
  it.each([
    ['invalid_destination', 400, 'INVALID_PHONE_NUMBER'],
    ['sandbox_unverified_destination', 403, 'PHONE_NUMBER_NOT_ALLOWED_IN_SANDBOX'],
    ['rate_limited', 429, 'TOO_MANY_OTP_REQUESTS'],
    ['ip_rate_limited', 429, 'TOO_MANY_OTP_REQUESTS'],
    ['too_many_requests', 429, 'TOO_MANY_OTP_REQUESTS'],
    ['send_failed', 502, 'OTP_SEND_FAILED'],
    ['internal_error', 502, 'OTP_SEND_FAILED'],
    ['unauthorized', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['key_expired', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['insufficient_scope', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['ip_not_allowed', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['account_not_active', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['application_paused', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['insufficient_credits', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['spend_cap_reached', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['sandbox_quota_exceeded', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['sandbox_unsupported_channel', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['unsupported_channel', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['invalid_json', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
  ])('answers %s with %i %s, and keeps nothing to check', async (error, status, code) => {
    const seen: [unknown, TawkedErrorInfo][] = [];
    const { auth, db } = makeAuth({
      client: mockClient(mock, { start: [{ error }] }),
      onError: (e, info) => seen.push([e, info]),
    });
    const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(answer.status).toBe(status);
    expect(answer.body.code).toBe(code);
    expect(db.verification!.some((row) => String(row.identifier).startsWith('tawked-verify:'))).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toMatchObject({ code: error });
    expect(seen[0]![1]).toEqual({ operation: 'send', purpose: 'sign-in', phoneNumber: PHONE, answeredWith: code });
  });

  it('every documented error of the start endpoint has an answer', async () => {
    // The contract's list for POST /v1/verify/start, so a new code fails here before it reaches users.
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      endpoints: { id: string; errors: { error: string }[] }[];
    };
    const documented = contract.endpoints.find((e) => e.id === 'start')!.errors.map((e) => e.error);
    for (const error of documented) {
      const { auth: fresh } = makeAuth({ client: mockClient(mock, { start: [{ error }] }) });
      const answer = await post(fresh, '/phone-number/send-otp', { phoneNumber: PHONE });
      expect([400, 403, 429, 502, 503], error).toContain(answer.status);
      expect(answer.body.code, error).toMatch(/^[A-Z_]+$/);
    }
  });

  it('logs why the setup failed, with the request id, and never the key', async () => {
    const logs: LogLine[] = [];
    const { auth } = makeAuth({ client: mockClient(mock, { start: [{ error: 'insufficient_scope' }] }) }, { logs });
    const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(answer.body.message).toBe('Phone sign-in is unavailable right now');
    const line = logs.find((l) => l.message.includes('Tawked Verify send refused'));
    expect(line?.level).toBe('error');
    expect(line?.message).toMatch(/403 insufficient_scope, request [0-9a-f-]{36}\): the API key lacks Tawked Verify's send or check/);
    expect(JSON.stringify(logs)).not.toContain(LIVE_KEY);
    expect(JSON.stringify(answer.body)).not.toContain(LIVE_KEY);
  });

  it('never sends a code again after a server error: one start, its key on the error, the user asks again', async () => {
    // Verify's start is write_once: an SMS gateway may already have been reached when a 5xx answers.
    const scenario: Scenario = { start: [{ error: 'internal_error' }, { error: 'internal_error' }] };
    const { auth } = makeAuth({ client: mockClient(mock, scenario, { maxRetries: 2 }) });
    const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(answer.status).toBe(502);
    const starts = mock.requests.filter((r) => r.path === '/v1/verify/start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers OTP_SEND_FAILED when Tawked cannot be reached', async () => {
    const seen: TawkedErrorInfo[] = [];
    const { auth } = makeAuth({ baseUrl: 'http://127.0.0.1:1', apiKey: LIVE_KEY, maxRetries: 0, onError: (_e, info) => seen.push(info) });
    const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    expect(answer.status).toBe(502);
    expect(answer.body.code).toBe('OTP_SEND_FAILED');
    expect(seen[0]?.answeredWith).toBe('OTP_SEND_FAILED');
  });

  it('answers PHONE_SIGN_IN_UNAVAILABLE when no key is set, and says so in the log', async () => {
    const saved = process.env.TAWKED_API_KEY;
    delete process.env.TAWKED_API_KEY;
    try {
      const logs: LogLine[] = [];
      const { auth } = makeAuth({ baseUrl: mock.url }, { logs });
      const answer = await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
      expect(answer.status).toBe(503);
      expect(answer.body.code).toBe('PHONE_SIGN_IN_UNAVAILABLE');
      expect(logs.some((l) => l.level === 'error' && l.message.includes('Tawked Verify send failed'))).toBe(true);
      expect(mock.requests).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.TAWKED_API_KEY = saved;
    }
  });

  it('reads the key from TAWKED_API_KEY', async () => {
    const saved = process.env.TAWKED_API_KEY;
    process.env.TAWKED_API_KEY = LIVE_KEY;
    try {
      const { auth } = makeAuth({ baseUrl: mock.url, maxRetries: 0 });
      expect((await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE })).status).toBe(200);
      expect(mock.requests[0]!.headers.authorization).toBe(`Bearer ${LIVE_KEY}`);
    } finally {
      if (saved === undefined) delete process.env.TAWKED_API_KEY;
      else process.env.TAWKED_API_KEY = saved;
    }
  });
});

describe('when Tawked refuses to check', () => {
  it('answers OTP_NOT_FOUND for a verification Tawked does not know', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, { check: [{ error: 'not_found' }] }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    const answer = await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('OTP_NOT_FOUND');
  });

  it.each([
    ['insufficient_scope', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['unauthorized', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['internal_error', 503, 'PHONE_SIGN_IN_UNAVAILABLE'],
    ['too_many_requests', 429, 'TOO_MANY_OTP_REQUESTS'],
  ])('answers %s with %i %s and keeps the code good for a later try', async (error, status, code) => {
    const { auth } = makeAuth({ client: mockClient(mock, { check: [{ error }] }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    const failed = await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' });
    expect(failed.status).toBe(status);
    expect(failed.body.code).toBe(code);
    expect((await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' })).status).toBe(200);
  });

  it('never retries a check, since each try spends an attempt', async () => {
    const { auth } = makeAuth({ client: mockClient(mock, { check: [{ error: 'internal_error' }] }, { maxRetries: 3 }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: PHONE });
    await post(auth, '/phone-number/verify', { phoneNumber: PHONE, code: '123456' });
    expect(mock.requests.filter((r) => r.path === '/v1/verify/check')).toHaveLength(1);
  });
});
