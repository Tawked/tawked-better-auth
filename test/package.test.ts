import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as server from '../src/index.js';
import * as client from '../src/client.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>;

describe('the package', () => {
  it('ships its dist, README, LICENSE and CHANGELOG only, with its public repository', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE', 'CHANGELOG.md']);
    expect(pkg.repository).toEqual({ type: 'git', url: 'git+https://github.com/tawked/tawked-better-auth.git' });
    expect(pkg.homepage).toBe('https://docs.tawked.com');
    expect(pkg.license).toBe('MIT');
    expect(pkg.version).toBe('0.1.0');
  });

  it('depends on @tawked/sdk and leaves better-auth to the app', () => {
    expect(pkg.dependencies).toEqual({ '@tawked/sdk': '^0.1.0' });
    expect(pkg.peerDependencies).toEqual({ 'better-auth': expect.any(String) });
  });

  it('keeps the client entry free of the server', () => {
    const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');
    // Only a type comes from the server side, and types are erased.
    expect(source).not.toMatch(/@tawked\/sdk|\.\/verify|\.\/store/);
    expect(source).toMatch(/^import type \{ TawkedPhoneNumberPlugin \} from '\.\/plugin\.js';$/m);
    expect(Object.keys(client).sort()).toEqual(['SAUDI_MOBILE_E164', 'TAWKED_ERROR_CODES', 'isSaudiMobile', 'tawkedPhoneNumberClient', 'toSaudiE164']);
  });

  it('exports the plugin, the lower-level hooks, the stores and the e-mail helpers', () => {
    expect(Object.keys(server).sort()).toEqual([
      'DEFAULT_MESSAGES',
      'PENDING_TTL_SECONDS',
      'SAUDI_MOBILE_E164',
      'TAWKED_ERROR_CODES',
      'databaseStore',
      'isSaudiMobile',
      'memoryStore',
      'tawkedEmail',
      'tawkedOTP',
      'tawkedPhoneNumber',
      'toSaudiE164',
    ]);
  });

  it('is Better Auth\'s phone-number plugin underneath, so its client and schema apply', () => {
    const plugin = server.tawkedPhoneNumber({ apiKey: 'tk_live_x' });
    expect(plugin.id).toBe('phone-number');
    expect(Object.keys(plugin.endpoints)).toContain('verifyPhoneNumber');
    expect(plugin.schema.user.fields.phoneNumber).toBeDefined();
    expect(plugin.$ERROR_CODES.OTP_EXPIRED).toEqual({ code: 'OTP_EXPIRED', message: 'OTP expired' });
  });

  it('never keeps the key where it can be printed', () => {
    const plugin = server.tawkedPhoneNumber({ apiKey: 'tk_live_secret_never_printed' });
    expect(JSON.stringify(plugin.options ?? {})).not.toContain('tk_live_secret_never_printed');
  });
});
