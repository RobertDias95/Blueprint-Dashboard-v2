import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { landingAfterSignIn } from '../lib/authEvents';
import { classifyLoginError, type LoginFailure } from '../lib/loginErrors';
import BridgeMark from '../components/BridgeMark';

/** ★ The lockup on the card, in px of HEIGHT.
 *
 *  The card is `max-w-sm` (384px) with `p-8` (32px each side), so its content
 *  box is exactly 320px. The artwork is 2030 x 355 — 5.7183:1 — so 320 / 5.7183
 *  = 55.96, and 56px of height fills the card's width to the pixel.
 *
 *  ★ Derived, not chosen: change the card width and this number is wrong, which
 *  is why the arithmetic is written down next to it. A test pins both. */
const LOCKUP_HEIGHT = 56;

// Q1: minimal email/password login. On success → /dashboard. Error → inline
// message.
//
// ★ fix-314: on success → back WHERE YOU WERE, not /dashboard. AuthGuard has
// always recorded `state={{ from: location }}` when it bounced someone; this
// file never read it, so every recovery landed on the index route and then
// /dashboard. That is the "takes me back to the home page" half of Miles's
// report, and it was one missing read, not a missing feature.
//
// ★★★ fix-357: THE FRONT DOOR TOLD A LOCKED-OUT PERSON NOTHING.
//
// Jade, 2026-08-19: the screen showed one line — "Failed to fetch" — because
// this file did `setError(authError.message)`, handing the browser's own words
// for "I could not reach the server at all" straight to a human. Her account
// was fine; Miles signed in the same afternoon. The one person who could not
// get in got the least readable string in the system, and could not report it
// from inside the tool because she was outside it.
//
// ★ The classification lives in lib/loginErrors — pure, so every case can be
// asserted without a browser, and keyed on the error's TYPE and STATUS rather
// than on its text (see that file for why matching "Failed to fetch" is the
// same bug one layer up).
//
// ★★ NO PASSWORD RESET, AND NO PLACEHOLDER FOR ONE. The flow is not built, and
// a disabled "Forgot password?" link would be a dead control that looks like an
// answer — worse than its absence. What it would take is measured and reported
// in the PR; building it is Bobby's call, not a side effect of fixing an error
// message.
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, initialized } = useAuthStore();
  const landing = landingAfterSignIn(
    (location.state as { from?: unknown } | null)?.from,
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // ★ fix-357: a classified failure, not a string. The screen renders three
  // parts of it, and the raw text is one of them only when nothing else fits.
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated — e.g. the session came back while this screen was
  // up. Return to where the bounce came from, not the dashboard.
  if (initialized && session) {
    return <Navigate to={landing} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setSubmitting(true);
    // ★ try/catch as well as the returned error: a transport failure can arrive
    // either way depending on where it happens in the client, and Jade's case
    // is precisely the transport failing.
    let authError: unknown;
    try {
      authError = (await supabase.auth.signInWithPassword({ email, password })).error;
    } catch (thrown) {
      authError = thrown;
    }
    setSubmitting(false);
    if (authError) {
      setFailure(classifyLoginError(authError));
      return;
    }
    navigate(landing, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface border border-border rounded-xl p-8 shadow-sm"
      >
        {/* ★★ fix-357 §3: the login screen never got fix-351's branding. It
            still read "Blueprint Capital / Entitlements — v2" in plain type —
            naming a version number at the first thing all 29 logins see.

            ★ REFERENCED, NEVER REDRAWN (fix-322's standing contract, and the
            grep that enforces it). BridgeMark renders an <img>; nothing here
            traces or re-vectors anything.

            ★ SCALED TO THE CARD, NOT CROPPED. The artwork is 5.72:1 and this is
            a 384px card with 32px padding, so the lockup is given the full
            320px of content width. `size` is a HEIGHT on this variant (fix-351
            made it height-driven so the header's rule alignment is arithmetic),
            so the number below is derived from the width we want rather than
            typed at it — and the width still comes from the file's own aspect
            ratio, which is what stops any caller stretching the artwork. */}
        <div className="mb-6" data-testid="login-brand">
          <BridgeMark variant="lockup" size={LOCKUP_HEIGHT} />
        </div>

        <label className="block text-xs font-semibold text-muted mb-1 uppercase tracking-wide">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="login-email"
          className="w-full px-3 py-2 mb-4 border border-border rounded-md bg-bg focus:outline-none focus:border-de focus:ring-1 focus:ring-de"
        />

        <label className="block text-xs font-semibold text-muted mb-1 uppercase tracking-wide">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="login-password"
          className="w-full px-3 py-2 mb-6 border border-border rounded-md bg-bg focus:outline-none focus:border-de focus:ring-1 focus:ring-de"
        />

        {failure && (
          // ★★ fix-357 §2: the ERROR palette, not `co`. `co` is CORRECTIONS
          // amber — on screen it read as a mild warning, and being unable to
          // sign in is not a warning. See index.css for why `er` had to be
          // named rather than borrowed.
          <div
            className="text-sm text-er bg-er-bg border border-er-border rounded-md px-3 py-2.5 mb-4"
            role="alert"
            data-testid="login-error"
            data-failure-kind={failure.kind}
          >
            <div className="font-semibold" data-testid="login-error-headline">
              {failure.headline}
            </div>
            <div
              className="text-[12.5px] mt-1 leading-relaxed text-text/80"
              data-testid="login-error-guidance"
            >
              {failure.guidance}
            </div>
            {failure.technical && (
              // ★ A FOOTNOTE, NEVER THE HEADLINE. The raw provider string is
              // kept for the one case nobody anticipated — hiding it entirely
              // would have made Jade's bug harder to diagnose, not easier — but
              // it is small, greyed, and labelled as what it is.
              <div
                className="text-[11px] mt-2 pt-2 border-t border-er-border/60 text-muted font-mono break-words"
                data-testid="login-error-technical"
              >
                <span className="uppercase tracking-wide not-italic">
                  Technical detail:{' '}
                </span>
                {failure.technical}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          data-testid="login-submit"
          className="w-full bg-de hover:bg-de/90 disabled:opacity-50 text-white font-semibold py-2 rounded-md transition"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

