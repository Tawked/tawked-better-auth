import type { PhoneNumberOptions } from 'better-auth/plugins/phone-number';

/** The Better Auth endpoint context the phone-number plugin hands its hooks. */
export type EndpointContext = NonNullable<Parameters<PhoneNumberOptions['sendOTP']>[1]>;

/** What the plugin keeps between sending a code and checking it: Tawked's verification id. */
export interface PendingVerification {
  /** The `id` Tawked Verify answered on start. */
  id: string;
  /** When Tawked said the code expires (ISO 8601). Tawked still decides; this is for your logs. */
  expiresAt: string;
}

/**
 * Where the plugin keeps the pending Tawked verification of each phone number, for the minutes
 * between sending a code and checking it. `take` must remove what it returns, so one code can
 * finish one sign-in only. Replace it to keep them in Redis or anywhere else your servers share.
 */
export interface VerificationStore {
  set(key: string, value: PendingVerification, ttlSeconds: number, ctx?: EndpointContext): Promise<void> | void;
  take(key: string, ctx?: EndpointContext): Promise<PendingVerification | null> | PendingVerification | null;
}

function parse(raw: unknown): PendingVerification | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingVerification>;
    return typeof value.id === 'string' ? { id: value.id, expiresAt: String(value.expiresAt ?? '') } : null;
  } catch {
    return null;
  }
}

/**
 * The default: Better Auth's own `verification` table (or its secondary storage when you set
 * one), so every server and every serverless instance sees the same pending verifications.
 * Falls back to memory for a call that carries no Better Auth context.
 */
export function databaseStore(): VerificationStore {
  const fallback = memoryStore();
  return {
    async set(key, value, ttlSeconds, ctx) {
      if (!ctx) return fallback.set(key, value, ttlSeconds);
      const adapter = ctx.context.internalAdapter;
      await adapter.deleteVerificationByIdentifier(key);
      await adapter.createVerificationValue({
        identifier: key,
        value: JSON.stringify(value),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    },
    async take(key, ctx) {
      if (!ctx) return fallback.take(key);
      const adapter = ctx.context.internalAdapter as typeof ctx.context.internalAdapter & {
        consumeVerificationValue?: (identifier: string) => Promise<{ value: string; expiresAt: Date } | null>;
      };
      if (typeof adapter.consumeVerificationValue === 'function') {
        // Atomic: of two checks racing on one code, only one gets the row.
        const row = await adapter.consumeVerificationValue(key);
        return row ? parse(row.value) : null;
      }
      const row = await adapter.findVerificationValue(key);
      if (!row) return null;
      await adapter.deleteVerificationByIdentifier(key);
      return new Date(row.expiresAt) < new Date() ? null : parse(row.value);
    },
  };
}

/**
 * Keeps pending verifications in this process's memory. Fine for one long-running server and for
 * tests. On serverless platforms, or behind a load balancer, the code is sent by one instance and
 * checked by another that never saw it: use the default `databaseStore()` there.
 */
export function memoryStore(): VerificationStore {
  const entries = new Map<string, { value: PendingVerification; until: number }>();
  return {
    set(key, value, ttlSeconds) {
      entries.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
    },
    take(key) {
      const entry = entries.get(key);
      entries.delete(key);
      for (const [k, e] of entries) if (e.until <= Date.now()) entries.delete(k);
      return entry && entry.until > Date.now() ? entry.value : null;
    },
  };
}
