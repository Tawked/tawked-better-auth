import { phoneNumberClient } from 'better-auth/client/plugins';
import { TAWKED_ERROR_CODES } from './error-codes.js';
import type { TawkedPhoneNumberPlugin } from './plugin.js';

export { TAWKED_ERROR_CODES, type TawkedErrorCode } from './error-codes.js';
export { toSaudiE164, isSaudiMobile, SAUDI_MOBILE_E164 } from './phone.js';

/**
 * The client side of `tawkedPhoneNumber()`: Better Auth's own `phoneNumberClient()`, with Tawked's
 * error codes added. Safe in the browser: it holds no key and never calls Tawked.
 *
 * @example createAuthClient({ plugins: [tawkedPhoneNumberClient()] })
 */
/** Better Auth's `phoneNumberClient()`, typed from the Tawked server plugin. */
export type TawkedPhoneNumberClientPlugin = Omit<ReturnType<typeof phoneNumberClient>, '$InferServerPlugin' | '$ERROR_CODES'> & {
  $InferServerPlugin: TawkedPhoneNumberPlugin;
  $ERROR_CODES: ReturnType<typeof phoneNumberClient>['$ERROR_CODES'] & typeof TAWKED_ERROR_CODES;
};

export function tawkedPhoneNumberClient(): TawkedPhoneNumberClientPlugin {
  const plugin = phoneNumberClient();
  return {
    ...plugin,
    // Type-only: the client learns the server plugin's endpoints, fields and error codes.
    $InferServerPlugin: {} as TawkedPhoneNumberPlugin,
    $ERROR_CODES: { ...plugin.$ERROR_CODES, ...TAWKED_ERROR_CODES },
  };
}
