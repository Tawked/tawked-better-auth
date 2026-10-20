// Type-checked against the BUILT declarations (dist), as an app would see them: `npm run typecheck:dist`.
import { betterAuth } from 'better-auth';
import { createAuthClient } from 'better-auth/client';
import { tawkedPhoneNumber, memoryStore, type TawkedPhoneNumberOptions, type VerificationStore } from '@tawked/better-auth';
import { tawkedPhoneNumberClient, toSaudiE164 } from '@tawked/better-auth/client';

const options: TawkedPhoneNumberOptions = {
  apiKey: 'tk_live_x',
  lang: 'auto',
  store: memoryStore(),
  signUpOnVerification: { getTempEmail: (phone) => `${phone}@phone.example.com` },
};
const store: VerificationStore = { set: () => undefined, take: () => null };
void store;

export const auth = betterAuth({ plugins: [tawkedPhoneNumber(options)] });
export const send = () => auth.api.sendPhoneNumberOTP({ body: { phoneNumber: '+966512345678' } });
export const verify = () => auth.api.verifyPhoneNumber({ body: { phoneNumber: '+966512345678', code: '123456' } });

export const client = createAuthClient({ plugins: [tawkedPhoneNumberClient()] });
export const sendFromBrowser = () => client.phoneNumber.sendOtp({ phoneNumber: toSaudiE164('0512345678') ?? '' });
export const code: 'PHONE_SIGN_IN_UNAVAILABLE' = client.$ERROR_CODES.PHONE_SIGN_IN_UNAVAILABLE.code;

// @ts-expect-error Tawked makes the code: sendOTP is not an option.
tawkedPhoneNumber({ sendOTP: () => undefined });
