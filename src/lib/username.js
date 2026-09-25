/**
 * Username rules (roadmap step 4a). The database is the source of truth —
 * public.username_error() in supabase/migrations/006_profiles_auth.sql — and the Edge Function
 * supabase/functions/account/index.ts has a copy. Keep all three identical (same error codes).
 *
 * After normalization (NFC, trim, runs of whitespace → one space):
 *   3–24 characters: Hebrew א–ת, Latin A–Z a–z, Russian А–я Ёё, digits, space, dot;
 *   starts with a letter or digit; a dot follows a letter or digit ("Noa L." ok, "a..b" not);
 *   at least one letter; Latin and Cyrillic letters not mixed; not a reserved name.
 * Unique case-insensitively (usernameKey).
 */

const LETTER = 'A-Za-zА-Яа-яЁёא-ת';
const RESERVED = new Set([
  'admin', 'administrator', 'owner', 'root', 'system', 'support', 'moderator', 'mitzpe',
  'מנהל', 'מנהלת', 'מנהל מערכת', 'מערכת', 'מצפה',
  'админ', 'администратор', 'модератор', 'владелец', 'система',
]);

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;

export function normalizeUsername(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Case-insensitive key (Latin + Cyrillic lower-cased; Hebrew has no case). */
export function usernameKey(name) {
  let out = '';
  for (const ch of name) out += /[A-ZА-ЯЁ]/.test(ch) ? ch.toLowerCase() : ch;
  return out;
}

/** Error code for a normalized username (auth.errors.<code> in strings.js), null when valid. */
export function usernameError(name) {
  if (!name) return 'required';
  const length = [...name].length;
  if (length < USERNAME_MIN) return 'too_short';
  if (length > USERNAME_MAX) return 'too_long';
  if (!new RegExp(`^[0-9${LETTER} .]+$`).test(name)) return 'invalid_chars';
  if (!new RegExp(`^[0-9${LETTER}]`).test(name)) return 'bad_start';
  if (/[ .]\./.test(name)) return 'bad_dots';
  if (!new RegExp(`[${LETTER}]`).test(name)) return 'no_letter';
  if (/[A-Za-z]/.test(name) && /[А-Яа-яЁё]/.test(name)) return 'mixed_scripts';
  if (RESERVED.has(usernameKey(name))) return 'reserved';
  return null;
}

export function passwordError(password) {
  if (typeof password !== 'string' || [...password].length < PASSWORD_MIN) return 'password_short';
  if (new TextEncoder().encode(password).length > 72) return 'password_long'; // bcrypt limit
  return null;
}

/** Accounts without a real email carry this internal address; never show it. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'noemail.mitzpe.invalid';

export function isPlaceholderEmail(email) {
  return !email || email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
