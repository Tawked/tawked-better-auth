# Changelog

`@tawked/better-auth` connects [Better Auth](https://www.better-auth.com) to Tawked: phone sign-in with
Tawked Verify, and Better Auth's e-mails through Tawked Email. It follows semantic versioning; before 1.0 it
is released with every minor of `@tawked/sdk`.

## 0.1.0 - 2026-10-21

The first release, beside `@tawked/sdk` 0.1.0.

- `tawkedPhoneNumber(options)`: Better Auth's phone-number plugin with the code made, sent and checked by
  Tawked Verify (`POST /v1/verify/start` and `POST /v1/verify/check` through `@tawked/sdk`).
- `tawkedPhoneNumberClient()` from `@tawked/better-auth/client`, typed from the server plugin.
- `tawkedOTP(options)`: the `sendOTP`, `verifyOTP` and `phoneNumberValidator` alone, to spread into
  `phoneNumber({ ... })`.
- Saudi mobile numbers only, rewritten to E.164 before Better Auth sees them; `toSaudiE164` and `isSaudiMobile`.
- Tawked's outcomes and errors as Better Auth errors (`TAWKED_ERROR_CODES`), with the reason and request id in
  the server's log and an `onError` hook.
- Pending verifications in Better Auth's verification table by default (`databaseStore()`), taken out on
  check so one code finishes one sign-in; `memoryStore()` and your own `VerificationStore`.
- Password reset by phone with a Tawked code.
- Options for `lang` (also from Accept-Language), `channel`, `autofill`, `reference`, the end user's IP
  (`client_ip`) and partner keys (`application`).
- `tawkedEmail(options)`: Better Auth's `sendVerificationEmail`, `sendResetPassword` and the emailOTP plugin's
  `sendVerificationOTP` through Tawked Email (early access), with Arabic and English default words
  (`DEFAULT_MESSAGES`), your own through `messages`, an Idempotency-Key made from a link's token, and a random one for each code's send (a resend goes out, and
  the key never reveals the code).
- Verify's start follows `@tawked/sdk`'s retry class (`write_once`): sent again only when the connection failed
  before it left or after a short `Retry-After`, never after a server error, and always under a key.
