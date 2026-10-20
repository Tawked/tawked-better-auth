import { Tawked } from '@tawked/sdk';
import { describe, expect, it } from 'vitest';
import { databaseStore, type EndpointContext } from '../src/index.js';
import { LIVE_KEY, makeAuth, post } from './helpers.js';

/** A Better Auth context with only the verification calls the store uses. */
function fakeContext(withConsume: boolean) {
  const rows: { identifier: string; value: string; expiresAt: Date }[] = [];
  const internalAdapter: Record<string, unknown> = {
    createVerificationValue: async (row: { identifier: string; value: string; expiresAt: Date }) => {
      rows.push(row);
      return row;
    },
    findVerificationValue: async (identifier: string) => rows.filter((r) => r.identifier === identifier).at(-1) ?? null,
    deleteVerificationByIdentifier: async (identifier: string) => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.identifier === identifier) rows.splice(i, 1);
    },
  };
  if (withConsume) {
    internalAdapter.consumeVerificationValue = async (identifier: string) => {
      const row = rows.find((r) => r.identifier === identifier) ?? null;
      await (internalAdapter.deleteVerificationByIdentifier as (i: string) => Promise<void>)(identifier);
      return row && row.expiresAt > new Date() ? row : null;
    };
  }
  return { rows, ctx: { context: { internalAdapter } } as unknown as EndpointContext };
}

describe('databaseStore', () => {
  it.each([true, false])('keeps one row per key, takes it once and drops an expired one (consume: %s)', async (withConsume) => {
    const { rows, ctx } = fakeContext(withConsume);
    const store = databaseStore();
    await store.set('k', { id: 'one', expiresAt: 'x' }, 60, ctx);
    await store.set('k', { id: 'two', expiresAt: 'x' }, 60, ctx);
    expect(rows).toHaveLength(1);
    expect(await store.take('k', ctx)).toEqual({ id: 'two', expiresAt: 'x' });
    expect(await store.take('k', ctx)).toBeNull();
    await store.set('k', { id: 'old', expiresAt: 'x' }, -1, ctx);
    expect(await store.take('k', ctx)).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it('ignores a row that is not its own', async () => {
    const { ctx, rows } = fakeContext(true);
    rows.push({ identifier: 'k', value: 'not json', expiresAt: new Date(Date.now() + 60_000) });
    expect(await databaseStore().take('k', ctx)).toBeNull();
  });

  it('falls back to memory for a call without a Better Auth context', async () => {
    const store = databaseStore();
    await store.set('k', { id: 'a', expiresAt: '' }, 60);
    expect(await store.take('k')).toEqual({ id: 'a', expiresAt: '' });
  });
});

describe('answers Tawked gives that the mock has no example of', () => {
  /** A Tawked client whose check answers `body`. */
  function answering(body: Record<string, unknown>) {
    return new Tawked({
      apiKey: LIVE_KEY,
      baseUrl: 'http://tawked.test',
      maxRetries: 0,
      fetch: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        const json = url.endsWith('/start')
          ? { id: '6f1c4b8e-0d55-4c55-9a0b-5f1f0c4a1e01', status: 'pending', expires_at: '2026-10-06T00:05:00.000Z' }
          : body;
        return new Response(JSON.stringify(json), { status: url.endsWith('/start') ? 201 : 200, headers: { 'content-type': 'application/json' } });
      },
    });
  }

  it('a wrong code with no attempts left is TOO_MANY_ATTEMPTS, and the code is gone', async () => {
    const { auth } = makeAuth({ client: answering({ verified: false, status: 'invalid_code', attempts_remaining: 0 }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const answer = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '1' });
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '1' })).body.code).toBe('OTP_NOT_FOUND');
  });

  it('a status newer than this package never signs anyone in', async () => {
    const { auth } = makeAuth({ client: answering({ verified: true, status: 'something_new' }) });
    await post(auth, '/phone-number/send-otp', { phoneNumber: '+966512345678' });
    const answer = await post(auth, '/phone-number/verify', { phoneNumber: '+966512345678', code: '1' });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('OTP_NOT_FOUND');
  });
});
