// ===========================================================================
// ★★★ fix-678 (P-357) — what the Bridge promises about a sign-in code
// ===========================================================================
//
// ONE place for the two facts the welcome email AND the Login page state about
// the code Supabase emails. Both are SUPABASE PROJECT SETTINGS, not choices
// made here — fix-426 wrote "six digits, because that is what {{ .Token }}
// emits", the project was emitting EIGHT, and every welcome email and reset
// code since fix-672 was refused by the screen it pointed at.
//
// ★★ PURE AND IMPORT-FREE so the Login page can read it without pulling the
//    email template (and its inline images) into the app bundle.

/**
 * ★★★ HOW LONG THE CODE WORKS, in hours.
 *     MUST EQUAL Supabase → Auth → Email OTP Expiration (set to 86400 s on
 *     2026-10-15 by Bobby). Change that setting → change this one line; the
 *     welcome email and the Login page both read it, and tests pin both.
 */
export const WELCOME_CODE_VALID_HOURS = 24;

/**
 * ★★★ THE CODE LENGTHS ACCEPTED: Supabase's whole configurable range.
 *     Supabase → Auth → Email OTP Length can be anything from 6 to 10, so the
 *     screen accepts all of them rather than one number that a setting can
 *     silently make wrong (it was set to 6 on 2026-10-15 by Bobby).
 */
export const CODE_MIN_DIGITS = 6;
export const CODE_MAX_DIGITS = 10;

/** The code's lifetime as words — "1 hour", "24 hours". */
export function codeLifetimeWords(hours = WELCOME_CODE_VALID_HOURS): string {
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
