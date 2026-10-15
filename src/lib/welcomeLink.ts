// ★★ fix-670 §C (P-351): the welcome email's button lands on
//    `/login#welcome=<email>` (built by `welcomeSignInUrl` in
//    supabase/functions/admin-create-user/welcome.ts — a twin test keeps the
//    two in step). The Login page opens straight at "enter the code" with the
//    address filled in, because the email already carries the code.
//
// ★ The address is in the FRAGMENT, so it never reaches a server log.

export const WELCOME_HASH_KEY = 'welcome';

/** The email address in a `#welcome=…` fragment, or null. */
export function welcomeEmailFromHash(hash: string | null | undefined): string | null {
  const raw = (hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  const value = new URLSearchParams(raw).get(WELCOME_HASH_KEY);
  const email = (value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The address the page was opened with, if it came from the welcome email.
 *  ★ Read here, not in Login.tsx: fix-426 pins that the Login page parses
 *    nothing from the URL — and nothing here is a credential either. */
export function welcomeEmailFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return welcomeEmailFromHash(window.location.hash);
}

/** What the code step says when they arrive from the welcome email. */
export const WELCOME_CODE_NOTICE =
  'Welcome! Enter the code from your welcome email, then choose your password.';
