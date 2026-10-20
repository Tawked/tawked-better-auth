/**
 * Saudi mobile numbers, the only destinations Tawked Verify sends to. The canonical form is
 * E.164, `+9665XXXXXXXX`, and it is the form this plugin keeps on the user, so one person never
 * becomes two users by typing their number two ways. The same rules as the Tawked API.
 */

export const SAUDI_MOBILE_E164 = /^\+9665\d{8}$/;

const EASTERN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// Whitespace (a no-break space too), hyphens, and the direction marks a copy from Arabic text brings.
const INVISIBLE = /[\s  \-‎‏؜‪-‮⁦-⁩]/gu;

/**
 * The number in E.164 (`+9665XXXXXXXX`), or `null` when it is not a Saudi mobile number.
 * Accepts `+9665…`, `9665…`, `009665…`, `05…` and `5…`, in Western, Arabic-Indic or Persian
 * digits, with spaces, hyphens and direction marks ignored.
 *
 * @example toSaudiE164('٠٥١ ٢٣٤ ٥٦٧٨') // '+966512345678'
 */
export function toSaudiE164(input: string): string | null {
  if (typeof input !== 'string') return null;
  const digits = input
    .trim()
    .replace(/[٠-٩۰-۹]/g, (d) => EASTERN_DIGITS[d] ?? d)
    .replace(INVISIBLE, '');

  if (SAUDI_MOBILE_E164.test(digits)) return digits;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^009665\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  return null;
}

/** Whether the number is a Saudi mobile number in any of the accepted forms. */
export function isSaudiMobile(input: string): boolean {
  return toSaudiE164(input) !== null;
}
