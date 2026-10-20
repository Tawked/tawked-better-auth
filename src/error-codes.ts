/**
 * The error codes the plugin answers with, in Better Auth's shape (`{ code, message }`). The first
 * five are the phone-number plugin's own, so code written for it keeps working; the rest are
 * Tawked's. The end user sees `message`; the reason behind a refusal is in your server's log.
 */
function codes<const T extends Record<string, string>>(map: T): { [K in keyof T]: { code: K; message: T[K] } } {
  return Object.fromEntries(Object.entries(map).map(([code, message]) => [code, { code, message }])) as never;
}

export const TAWKED_ERROR_CODES = codes({
  /** Not a Saudi mobile number, or Tawked refused it as a destination. */
  INVALID_PHONE_NUMBER: 'Invalid phone number',
  /** No code was sent to this number, it was already used, or it was replaced by a newer one. */
  OTP_NOT_FOUND: 'OTP not found',
  /** The code expired. Request a new one. */
  OTP_EXPIRED: 'OTP expired',
  /** The code is wrong. The user can try again while attempts remain. */
  INVALID_OTP: 'Invalid OTP',
  /** Every attempt for this code is spent. Request a new one. */
  TOO_MANY_ATTEMPTS: 'Too many attempts',
  /** A test key (`tk_test_`) sends only to the phone the account owner verified at sign-up. */
  PHONE_NUMBER_NOT_ALLOWED_IN_SANDBOX: "A test key sends codes only to the account owner's phone number",
  /** Too many codes for this number, this IP address or this key. Try again later. */
  TOO_MANY_OTP_REQUESTS: 'Too many codes requested. Try again later',
  /** Tawked could not send the code just now. Try again. */
  OTP_SEND_FAILED: 'The code could not be sent. Try again',
  /** The code was never delivered to the phone. Request a new one. */
  OTP_DELIVERY_FAILED: 'The code could not be delivered. Request a new one',
  /** The Tawked setup needs attention (the key, its scopes, the balance): see your server's log. */
  PHONE_SIGN_IN_UNAVAILABLE: 'Phone sign-in is unavailable right now',
});

export type TawkedErrorCode = keyof typeof TAWKED_ERROR_CODES;
