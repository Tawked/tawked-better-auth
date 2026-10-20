// The tests run a real Better Auth against the local mock of the Tawked API (sdks/mock-server),
// never against Tawked: no SMS is ever sent.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { Tawked } from '@tawked/sdk';
import { createMockServer } from '../../mock-server/src/server.mjs';
import { tawkedPhoneNumber, type TawkedPhoneNumberOptions } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_PATH = process.env.TAWKED_CONTRACT ?? resolve(here, '../../contract/api.json');

export const LIVE_KEY = 'tk_live_betterauthtest0000000000000000000001';
export const PARTNER_KEY = 'tk_partner_betterauthtest000000000000000001';
export const ORIGIN = 'http://localhost:3000';
export const STARTED_ID = 'b7e5c2b0-9c1a-4e2f-8f2a-3a6b0e9d1c44';

export interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface Mock {
  url: string;
  requests: MockRequest[];
  /** The JSON bodies sent to one endpoint path, such as `/v1/verify/start`. */
  bodies(path: string): Record<string, unknown>[];
  reset(): void;
  close(): Promise<void>;
}

export async function startMock(): Promise<Mock> {
  const mock = createMockServer({ contractPath: CONTRACT_PATH });
  const url: string = await mock.listen(0);
  const requests = mock.requests as MockRequest[];
  return {
    url,
    requests,
    bodies: (path) => requests.filter((r) => r.path === path).map((r) => JSON.parse(r.body || '{}') as Record<string, unknown>),
    reset: () => mock.reset(),
    close: () => mock.close(),
  };
}

/**
 * What the mock answers next, per endpoint: `{ start: { error: 'rate_limited' } }` or
 * `{ check: { example: 'Wrong code' } }`. Each entry is used once, then the mock's first example.
 */
export type Scenario = Partial<Record<'start' | 'check', { error?: string; example?: string }[]>>;

/** A Tawked client pointed at the mock, whose fetch adds the mock's controls from `scenario`. */
export function mockClient(mock: Mock, scenario: Scenario, options: { apiKey?: string; maxRetries?: number } = {}): Tawked {
  const controlled: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const endpoint = url.pathname.endsWith('/verify/start') ? 'start' : url.pathname.endsWith('/verify/check') ? 'check' : undefined;
    const next = endpoint ? scenario[endpoint]?.shift() : undefined;
    const headers = new Headers(init?.headers);
    if (next?.error) headers.set('x-mock-error', next.error);
    if (next?.example) headers.set('x-mock-example', next.example);
    return fetch(input, { ...init, headers });
  };
  return new Tawked({
    apiKey: options.apiKey ?? LIVE_KEY,
    baseUrl: mock.url,
    maxRetries: options.maxRetries ?? 0,
    fetch: controlled,
  });
}

export interface LogLine {
  level: string;
  message: string;
}

export type Db = Record<string, Record<string, unknown>[]>;

export function emptyDb(): Db {
  return { user: [], session: [], account: [], verification: [] };
}

/** A real Better Auth on the memory adapter, with the Tawked plugin. */
export function makeAuth(plugin: TawkedPhoneNumberOptions, extra: { db?: Db; logs?: LogLine[]; emailAndPassword?: boolean } = {}) {
  const db = extra.db ?? emptyDb();
  const logs = extra.logs ?? [];
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: 'a-test-secret-that-is-long-enough-for-better-auth-0001',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: extra.emailAndPassword ?? true },
    logger: {
      level: 'debug',
      log: (level, message, ...args) => {
        logs.push({ level, message: [message, ...args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))].join(' ') });
      },
    },
    plugins: [
      tawkedPhoneNumber({
        signUpOnVerification: { getTempEmail: (phone) => `${phone.replace('+', '')}@phone.example.com` },
        ...plugin,
      }),
    ],
  });
  return { auth, db, logs };
}

export type Auth = ReturnType<typeof makeAuth>['auth'];

export interface Answer {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/** POSTs JSON to one of Better Auth's endpoints through its HTTP handler, as a browser would. */
export async function post(auth: Auth, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: response.headers };
}

export async function get(auth: Auth, path: string, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { headers: { origin: ORIGIN, ...headers } }));
  const text = await response.text();
  return { status: response.status, body: text && text !== 'null' ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: response.headers };
}

/** The session cookie a response set, ready for a Cookie header. */
export function cookieOf(answer: Answer): string {
  return answer.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
