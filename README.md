<p>
  <a href="https://tawked.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://docs.tawked.com/logo/dark.svg">
      <img alt="Tawked" src="https://docs.tawked.com/logo/light.svg" width="172" height="48">
    </picture>
  </a>
</p>

# Tawked for Better Auth

[![npm](https://img.shields.io/npm/v/@tawked/better-auth)](https://www.npmjs.com/package/@tawked/better-auth) [![Better Auth](https://img.shields.io/npm/dependency-version/@tawked/better-auth/peer/better-auth)](https://www.better-auth.com) [![CI](https://github.com/tawked/tawked-better-auth/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tawked/tawked-better-auth/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/tawked/tawked-better-auth/blob/main/LICENSE)

Phone number sign-in for [Better Auth](https://www.better-auth.com) with SMS OTP codes for Saudi mobile numbers, made, sent and checked by Tawked Verify. It is Better Auth's own phone-number plugin with the same endpoints, client and database schema; only the code changes hands. It also sends Better Auth's emails (verification links, password resets and email OTP codes) through Tawked Email, in Arabic or English.

Tawked (توكيد) is a Saudi messaging platform at [tawked.com](https://tawked.com) and a Meta Tech Provider: businesses send WhatsApp Business API notifications from their own number and SMS OTP verification codes, and answer customers in Tawked Chat, a shared WhatsApp inbox for teams. Tawked Email, in early access, sends a business's mail from its own domain.

[Documentation](https://docs.tawked.com) · [API reference](https://docs.tawked.com/api-reference/verify/start-a-verification) · [Changelog](https://github.com/tawked/tawked-better-auth/blob/main/CHANGELOG.md) · [Pricing](https://tawked.com/en/pricing)

## Installation

```bash
npm install @tawked/better-auth better-auth
```

The package has two entries: `@tawked/better-auth` for your Better Auth server and `@tawked/better-auth/client` for the browser.

## Before you start

- [Sign up](https://tawked.com/en/signup) and create an application in the console.
- A Better Auth server with a [database](https://www.better-auth.com/docs/concepts/database).
- An API key from your application's API keys page in the Tawked console, with Tawked Verify's send and check (`verify:send`, `verify:check`), and Tawked Email's send (`email:send`) if Tawked sends your emails. Put it in `TAWKED_API_KEY`.
- Before your application is approved, a test key (`tk_test_…`) sends to your own phone only: see Testing.
- Every code and email draws on one prepaid balance in Saudi riyals ([pricing](https://tawked.com/en/pricing)).

## Quick start

The server, in `auth.ts`:

```ts
import { betterAuth } from 'better-auth';
import { tawkedPhoneNumber } from '@tawked/better-auth';

export const auth = betterAuth({
  plugins: [
    tawkedPhoneNumber({
      apiKey: process.env.TAWKED_API_KEY, // the default, shown for clarity
      signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@phone.example.com` },
    }),
  ],
});
```

The browser, in `auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/client';
import { tawkedPhoneNumberClient } from '@tawked/better-auth/client';

export const authClient = createAuthClient({ plugins: [tawkedPhoneNumberClient()] });
```

Run Better Auth's migration. It adds `phoneNumber` and `phoneNumberVerified` to the user table, as the phone-number plugin does:

```bash
npx auth@latest migrate
```

Then sign a user in:

```ts
// authClient is the client made in auth-client.ts above.
await authClient.phoneNumber.sendOtp({ phoneNumber: '0512345678' });
const { data, error } = await authClient.phoneNumber.verify({ phoneNumber: '0512345678', code: '482913' });
```

`sendOtp` starts a verification with Tawked Verify (`POST /v1/verify/start`) and Tawked sends the code by SMS. `verify` asks Tawked whether the code is right (`POST /v1/verify/check`). If it is, Better Auth signs the user in, or signs them up when `signUpOnVerification` is set. Better Auth's own code is never sent. Keep the key on your server: see Security.

## What you can do

| Task | Call | Docs |
|---|---|---|
| Sign users in with an SMS OTP code to their Saudi mobile number | `tawkedPhoneNumber()` | [Sign-in flow](https://docs.tawked.com/verify/sign-in-flow) |
| Send and check the code from the browser | `tawkedPhoneNumberClient()`, then `authClient.phoneNumber.sendOtp()` and `verify()` | [Phone number plugin](https://www.better-auth.com/docs/plugins/phone-number) |
| Change a signed-in user's number | `authClient.phoneNumber.verify({ ..., updatePhoneNumber: true })` | [Phone number plugin](https://www.better-auth.com/docs/plugins/phone-number) |
| Reset a password with an SMS code | `authClient.phoneNumber.requestPasswordReset()`, `resetPassword()` | [Phone number plugin](https://www.better-auth.com/docs/plugins/phone-number) |
| Check a number before sending a code | `toSaudiE164()`, `isSaudiMobile()` | [Number formats](https://docs.tawked.com/destinations) |
| Use Tawked inside your own `phoneNumber()` setup | `tawkedOTP()` | [Phone number plugin](https://www.better-auth.com/docs/plugins/phone-number) |
| Send verification and password-reset emails | `tawkedEmail()` | [Email messages](https://docs.tawked.com/email/messages) |
| Send email OTP codes with Better Auth's emailOTP plugin | `sendVerificationOTP` from `tawkedEmail()` | [Email OTP plugin](https://www.better-auth.com/docs/plugins/email-otp) |
| Show the right message for each refusal | `authClient.$ERROR_CODES`, `TAWKED_ERROR_CODES` | [Errors](https://docs.tawked.com/errors) |

Everything else in the phone-number plugin works as Better Auth documents it: `disableSession: true` checks a code without signing in, `requireVerification` sends a code when an unverified user signs in with a password, and `callbackOnVerification` runs after a number is verified. On the server, `auth.api.sendPhoneNumberOTP` and `auth.api.verifyPhoneNumber` work the same way, and so does `auth.api.consumePhoneNumberOTP` from Better Auth 1.7.

## Requirements

| Requirement | Supported |
|---|---|
| Better Auth | 1.6 or a later 1.x (tested on 1.7.7 and the latest) |
| Runtime | Node.js 20 or newer, Bun or Deno, on the server |
| Modules | ESM only |
| Depends on | `@tawked/sdk` ^0.1 (installed with it) |

## Phone numbers

Tawked Verify sends to Saudi mobile numbers only. The plugin accepts every form people type: `+966512345678`, `966…`, `00966…`, `05…` and `5…`, with Arabic-Indic digits, spaces or hyphens. Before Better Auth sees a number, the plugin rewrites it to E.164 (`+966512345678`), so one person never becomes two users by typing their number two ways. Any other number gets `INVALID_PHONE_NUMBER`, and Tawked is never called.

```ts
import { isSaudiMobile, toSaudiE164 } from '@tawked/better-auth/client';

toSaudiE164('٠٥١ ٢٣٤ ٥٦٧٨'); // '+966512345678'
isSaudiMobile('+971501234567'); // false
```

Both functions come from both entries. Pass your own `phoneNumberValidator` to accept fewer numbers, and `normalizePhoneNumber: false` to keep numbers exactly as they were typed.

## Errors

Every refusal is a Better Auth error with a `code` your interface can switch on. The user sees `message`. The reason Tawked gave goes to your server's log through Better Auth's logger, with the API's `X-Request-Id`.

| `code` | Status | When |
|---|---|---|
| `INVALID_PHONE_NUMBER` | 400 | Not a Saudi mobile number. |
| `INVALID_OTP` | 400 | Wrong code. The user can try again while attempts remain. |
| `OTP_EXPIRED` | 400 | The code expired. Send a new one. |
| `OTP_NOT_FOUND` | 400 | No code was sent to this number, it was already used, or a newer one replaced it. |
| `TOO_MANY_ATTEMPTS` | 403 | Every try for this code is spent. Send a new one. |
| `OTP_DELIVERY_FAILED` | 400 | The code never reached the phone. Send a new one. |
| `PHONE_NUMBER_NOT_ALLOWED_IN_SANDBOX` | 403 | A test key sends only to the account owner's verified phone. |
| `TOO_MANY_OTP_REQUESTS` | 429 | Too many codes for this number, IP address or key. Try again later. |
| `OTP_SEND_FAILED` | 502 | Tawked could not send at the moment, or could not be reached. Try again. |
| `PHONE_SIGN_IN_UNAVAILABLE` | 503 | The setup needs you. The log line says which part. |

`PHONE_SIGN_IN_UNAVAILABLE` covers a key that is wrong, expired or lacks `verify:send` or `verify:check`, an empty balance, a paused application, and a partner key with no `application`. The first five codes are the phone-number plugin's own, so code written for it keeps working. The codes are typed on the client as `authClient.$ERROR_CODES`, and exported on the server as `TAWKED_ERROR_CODES`.

```ts
// authClient is the client made in auth-client.ts (see Quick start).
const { error } = await authClient.phoneNumber.verify({ phoneNumber: '0512345678', code: '482913' });
if (error?.code === 'INVALID_OTP') {
  // Let the user type the code again.
} else if (error?.code === 'OTP_EXPIRED' || error?.code === 'TOO_MANY_ATTEMPTS') {
  // Offer to send a new code.
}
```

A check that fails because of Tawked or the network keeps the code, so the user can try again once it is fixed. A check is never retried on its own, because each try spends an attempt. A send is tried again only when the connection failed before the request left, or after a short `Retry-After`, never after a server error, and always under one Idempotency-Key, so no one gets two codes.

If you set Better Auth's `advanced.backgroundTasks`, Better Auth sends codes in the background. A failed send is then only logged, and the user sees no error.

## Where the pending verification is kept

Between the send and the check, the plugin keeps Tawked's verification id for the number. By default it uses Better Auth's own `verification` table, or its secondary storage if you set one (`databaseStore()`). Every server and every serverless instance sees the same rows. A row is taken out when it is checked, so one code finishes one sign-in only.

```ts
import { memoryStore, tawkedPhoneNumber } from '@tawked/better-auth';

tawkedPhoneNumber({ store: memoryStore() });
```

`memoryStore()` keeps the ids in the server's memory. It suits a single long-running server and tests. **Do not use it on serverless platforms or behind a load balancer.** There, one instance sends the code and another checks it, and that instance has never seen the id, so the user gets `OTP_NOT_FOUND`. To keep the ids anywhere else, write a `VerificationStore`: an object with `set(key, value, ttlSeconds)` and `take(key)`, where `take` removes what it returns.

## Password reset

When users also have a password, `authClient.phoneNumber.requestPasswordReset` sends a Tawked code, and `resetPassword` resets the password only after Tawked verifies that code. Turn this off with `passwordReset: false`.

## Options

`tawkedPhoneNumber()` accepts every option of Better Auth's phone-number plugin except `sendOTP`, `verifyOTP`, `sendPasswordResetOTP`, `otpLength`, `expiresIn` and `allowedAttempts`. Tawked makes, sends and checks the code, and the code's length, life and attempts are your application's Verify settings in the Tawked console. Besides those:

| Option | Default | Notes |
|---|---|---|
| `apiKey` | `TAWKED_API_KEY` | A key with Tawked Verify's send and check. |
| `client` | | Your own `Tawked` client from `@tawked/sdk`, in place of `apiKey`, `baseUrl`, `timeoutMs` and `maxRetries`. |
| `baseUrl` | `https://tawked.com` | The API's address. |
| `timeoutMs`, `maxRetries` | the SDK's | How a send is retried is under Errors. |
| `application` | | Partner keys only: the client application that sends. |
| `lang` | Arabic | `'ar'`, `'en'`, `'auto'` (the request's `Accept-Language`) or a function of the request. |
| `channel` | `'sms'` | The channel the code is sent on. |
| `autofill` | every line configured | `'web'`, `'android'` or `'none'`. |
| `reference` | | A string, or a function of the number, shown on the verification in the Tawked console. |
| `clientIp` | `true` | Sends the user's IP address, as Better Auth resolves it, so your application's per-IP limit applies. `false` sends none; a function returns your own. |
| `store` | `databaseStore()` | Where the pending verification is kept. |
| `onError` | | `(error, { operation, purpose, phoneNumber, answeredWith })`, called on every failed call to Tawked. |
| `normalizePhoneNumber` | `true` | Rewrites numbers to E.164. |
| `passwordReset` | `true` | Password reset by phone with a Tawked code. |

```ts
import { tawkedPhoneNumber } from '@tawked/better-auth';

tawkedPhoneNumber({
  lang: 'auto',
  autofill: 'web',
  reference: (phoneNumber) => `signin-${phoneNumber.slice(-4)}`,
  onError: (error, { operation, answeredWith }) => console.warn(`Tawked ${operation}: ${answeredWith}`),
});
```

## Using Better Auth's phone-number plugin directly

If you prefer to configure Better Auth's plugin yourself, `tawkedOTP()` returns only its `sendOTP`, `verifyOTP` and `phoneNumberValidator`:

```ts
import { phoneNumber } from 'better-auth/plugins';
import { tawkedOTP } from '@tawked/better-auth';

phoneNumber({
  ...tawkedOTP({ apiKey: process.env.TAWKED_API_KEY }),
  signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@phone.example.com` },
});
```

This does not rewrite numbers to E.164 or handle password resets.

## Tawked Email (Early Access)

Tawked's team opens Email for an account on request, from the console. Until then every Email call answers `email_early_access`. The sender's domain must also be [verified in Tawked Email](https://docs.tawked.com/email/senders).

`tawkedEmail()` returns the three callbacks Better Auth asks for: the verification link, the password reset link and the [emailOTP plugin](https://www.better-auth.com/docs/plugins/email-otp)'s codes.

```ts
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { tawkedEmail } from '@tawked/better-auth';

const email = tawkedEmail({
  from: { name: 'متجر أكمي', address: 'no-reply@acme.sa' }, // on a domain verified in Tawked Email
  appName: 'متجر أكمي',
});

export const auth = betterAuth({
  emailVerification: { sendVerificationEmail: email.sendVerificationEmail },
  emailAndPassword: { enabled: true, sendResetPassword: email.sendResetPassword },
  plugins: [emailOTP({ sendVerificationOTP: email.sendVerificationOTP })],
});
```

Each email goes out once, under an Idempotency-Key, so a retry never sends it twice. A link's key is made from a hash of its token (`better-auth:reset:<hash>`), so the token itself never leaves your server in a key. A code's key is random for each send and never made from the code, so sending the same code again makes a new email. The words are Arabic or English (the request's `Accept-Language`, else Arabic), or yours through `messages`.

| Option | Default | Notes |
|---|---|---|
| `from` | the domain's default sender | `{ name, address }`, on a domain verified in Tawked Email. |
| `apiKey` | `TAWKED_API_KEY` | A key with Tawked Email's send (`email:send`). |
| `client` | | Your own `Tawked` client, in place of `apiKey` and `baseUrl`. |
| `baseUrl` | `https://tawked.com` | The API's address. |
| `application` | | Partner keys only: the client application that sends. |
| `language` | `'auto'` | `'ar'`, `'en'`, `'auto'` or a function of the request. |
| `appName` | | Said in the default messages. |
| `messages` | | `{ verification, resetPassword, otp }`: functions that return your own `{ subject, text, html? }`. |
| `onError` | | Called with the error and `{ message, to }` before it is thrown to Better Auth. |

A refusal (`email_early_access`, `sender_not_verified`, `recipient_suppressed` and the others) is thrown to Better Auth as the SDK's typed error, so the request fails the way Better Auth reports a failed email.

## Testing

With a test key (`tk_test_…`), Tawked sends real codes, marked [TEST], to the account owner's verified phone only, and a test key sends at most 10 codes per application ([test keys](https://docs.tawked.com/sandbox)). For automated tests, point the plugin at a local stand-in for the API with `baseUrl` (or the `TAWKED_BASE_URL` environment variable), or pass a `client` whose `fetch` you control:

```ts
import { memoryStore, tawkedPhoneNumber } from '@tawked/better-auth';

// A local stand-in for the API answers here, so the tests never send an SMS.
tawkedPhoneNumber({ apiKey: 'tk_test_local', baseUrl: 'http://127.0.0.1:4010', store: memoryStore() });
```

## Versioning

This package follows [Semantic Versioning](https://semver.org). Before 1.0, a minor release may change the public API and lists what changed under **Breaking** in the [changelog](https://github.com/tawked/tawked-better-auth/blob/main/CHANGELOG.md); a patch adds endpoints and fixes. Before 1.0 it is released with every minor of `@tawked/sdk` and may release patches of its own.

## Security

The plugin runs inside your Better Auth server and holds the key there. The browser entry, `@tawked/better-auth/client`, holds no key and never calls Tawked. The key is never logged, never part of an error and never sent to the browser.

To report a vulnerability, do not open a public issue. Use GitHub's private vulnerability reporting (**Report a vulnerability** on this repository's [Security tab](https://github.com/tawked/tawked-better-auth/security)), or email support@tawked.com with "Security" in the subject. We reply to every report.

## Support and contributing

- Help with your integration or your account: support@tawked.com and the [documentation](https://docs.tawked.com).
- Service status: [tawked.com/en/status](https://tawked.com/en/status).
- A bug in this package: [open an issue](https://github.com/tawked/tawked-better-auth/issues) with the package version, your runtime, Better Auth's version and the `X-Request-Id` of a failing call, never a key.

This repository is a read-only mirror: the package is developed in Tawked's own repository and every release is published here from there. A pull request is read as a proposal; if we take the change, we make it there and credit you as a co-author. GitHub Actions here installs `@tawked/sdk` from npm and type-checks, builds and packs the plugin on Node.js 20, 22 and 24 with Better Auth 1.7.7 and the latest; the full suite, a real Better Auth signing people in against a local stand-in for the API, runs in Tawked's repository before every release.

For assistants: [docs.tawked.com/llms.txt](https://docs.tawked.com/llms.txt), [llms-full.txt](https://docs.tawked.com/llms-full.txt), and what Tawked is in one file: [tawked.com/llms.txt](https://tawked.com/llms.txt).

## License

MIT. See [LICENSE](https://github.com/tawked/tawked-better-auth/blob/main/LICENSE).
