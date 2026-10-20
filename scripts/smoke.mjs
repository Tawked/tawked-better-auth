// Runs the BUILT package (dist) the way an app would: a real Better Auth, the phone sign-in through
// its HTTP handler, against the local mock of the Tawked API. Never calls Tawked.
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createMockServer } from '../../mock-server/src/server.mjs';
import { tawkedPhoneNumber, toSaudiE164 } from '@tawked/better-auth';
import { tawkedPhoneNumberClient } from '@tawked/better-auth/client';

const mock = createMockServer();
const baseUrl = await mock.listen(0);
try {
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'a-smoke-secret-that-is-long-enough-for-better-auth-01',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [
      tawkedPhoneNumber({
        apiKey: 'tk_live_smoke000000000000000000000000000001',
        baseUrl,
        signUpOnVerification: { getTempEmail: (p) => `${p.slice(1)}@phone.example.com` },
      }),
    ],
  });
  const call = (path, body) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify(body),
      }),
    );

  const sent = await call('/phone-number/send-otp', { phoneNumber: '0512345678' });
  if (sent.status !== 200) throw new Error(`send-otp answered ${sent.status}: ${await sent.text()}`);
  const verified = await call('/phone-number/verify', { phoneNumber: '0512345678', code: '123456' });
  const body = await verified.json();
  if (verified.status !== 200 || body.user?.phoneNumber !== '+966512345678' || !body.token) {
    throw new Error(`verify answered ${verified.status}: ${JSON.stringify(body)}`);
  }
  const starts = mock.requests.filter((r) => r.path === '/v1/verify/start');
  const checks = mock.requests.filter((r) => r.path === '/v1/verify/check');
  if (starts.length !== 1 || checks.length !== 1) throw new Error('expected one start and one check');
  if (toSaudiE164('٠٥١٢٣٤٥٦٧٨') !== '+966512345678') throw new Error('toSaudiE164');
  if (tawkedPhoneNumberClient().id !== 'phoneNumber') throw new Error('client plugin');
  const runtime = globalThis.Deno ? `deno ${globalThis.Deno.version.deno}` : globalThis.Bun ? `bun ${globalThis.Bun.version}` : `node ${process.versions.node}`;
  console.log(`pass ${runtime}: sign-up by phone through Tawked Verify (dist)`);
} finally {
  await mock.close();
}
