import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { landingAfterSignIn } from '../lib/authEvents';
import {
  PASSWORD_RULE,
  RESET_CODE_LENGTH,
  RESET_CODE_SENT_NOTICE,
  classifyLoginError,
  classifyResetError,
  classifyResetRequestError,
  codeFormatFailure,
  isWellFormedResetCode,
  normaliseResetCode,
  validateNewPassword,
  type LoginFailure,
} from '../lib/loginErrors';
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

/** ★ fix-426: the field and label treatments, named once now that there are
 *  five inputs on this card instead of two. Same strings as before — this is an
 *  extraction, not a restyle. */
const LABEL_CLASS =
  'block text-xs font-semibold text-muted mb-1 uppercase tracking-wide';
const FIELD_CLASS =
  'w-full px-3 py-2 border border-border rounded-md bg-bg focus:outline-none focus:border-de focus:ring-1 focus:ring-de';

/** The one button's label. Three jobs, three words for them. */
function submitLabel(
  mode: 'signin' | 'reset',
  step: 'request' | 'code',
  busy: boolean,
): string {
  if (mode === 'signin') return busy ? 'Signing in…' : 'Sign in';
  if (step === 'request') return busy ? 'Sending…' : 'Email me a code';
  return busy ? 'Setting your password…' : 'Set new password';
}

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
// ★★ fix-357 RULED: NO PASSWORD RESET, AND NO PLACEHOLDER FOR ONE. "The flow
// is not built, and a disabled 'Forgot password?' link would be a dead control
// that looks like an answer — worse than its absence. What it would take is
// measured and reported in the PR; building it is Bobby's call, not a side
// effect of fixing an error message."
//
// ★★★ BOBBY MADE THAT CALL ON 2026-08-28, after a second lockout in ten days
// (Brittani; Jade was the first). The ruling is RECORDED rather than the
// comment quietly deleted — the half of it that still governs is the half that
// mattered: the control below is REAL, and fix-426 removed the "no self-service
// reset" copy from lib/loginErrors only because it now points at something that
// works. A placeholder would still be worse than nothing.
//
// ★★★ AND THE EMAIL CARRIES A CODE, NOT A LINK. A reset link is single-use and
// a mail-security scanner that opens links to check them SPENDS IT — measured
// on Brittani's account, where three sessions exist from datacenter IPs with a
// stale Chrome/118 user-agent, one of them 17 seconds after a recovery email
// went out, each holding a live unused refresh token. Nobody else in the
// database has one. So: no deep-link route, no ConfirmationURL parsing, and
// nothing in this flow a machine reading the mailbox can consume.
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

  // ★ fix-426: the reset flow lives on this card rather than on a route of its
  //   own — there is no link to land on, so there is nothing to route to.
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [resetStep, setResetStep] = useState<'request' | 'code'>('request');
  const [resetEmail, setResetEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // ★★★ THE TRAP THIS FLAG EXISTS FOR, and it is not obvious.
  //
  // `verifyOtp` SIGNS THE PERSON IN. onAuthStateChange fires, the auth store
  // gains a session, and the `initialized && session` early-return below would
  // navigate this component away MID-FLOW — before `updateUser({ password })`
  // has run, and with any failure from it rendered to an unmounted tree. The
  // person would land on the dashboard with their old password still set and no
  // indication anything had gone wrong.
  //
  // ★★★ STATE, NOT A REF — AND ONLY LINT SAYS SO. The obvious shape is a ref
  //     (`completingReset.current`), and it works at runtime; the React
  //     Compiler's `react-hooks/refs` rule rejects reading one during render,
  //     which is exactly what the early return below does. `npx tsc` and the
  //     whole suite pass with the ref. `npm run lint` is the only gate that
  //     catches it — the third time this repo has learned that (fix-403,
  //     fix-408).
  //
  // ★ The ordering still holds: this setState is called BEFORE the first
  //   `await` in the handler, so React commits the guarded render while the
  //   verifyOtp request is still in flight, and the session cannot arrive
  //   first.
  const [completingReset, setCompletingReset] = useState(false);
  // ★ This one IS a ref, legitimately: it is read only inside handlers, never
  //   during render.
  const codeVerified = useRef(false);

  // Already authenticated — e.g. the session came back while this screen was
  // up. Return to where the bounce came from, not the dashboard.
  //
  // ★★★ fix-426 gated this on `completingReset`. A verified recovery code IS a
  // session, so without the guard this return fires between verifyOtp and
  // updateUser and the reset never finishes. See the ref's own note.
  if (initialized && session && !completingReset) {
    return <Navigate to={landing} replace />;
  }

  function openReset() {
    setMode('reset');
    setResetStep('request');
    // ★ Carry whatever they already typed — they got here because sign-in
    //   failed, and retyping the address is friction at the worst moment.
    setResetEmail(email);
    setFailure(null);
    setNotice(null);
  }

  function backToSignIn() {
    setMode('signin');
    setFailure(null);
    setNotice(null);
    setCode('');
    setNewPassword('');
    setCompletingReset(false);
    codeVerified.current = false;
  }

  /** ★★ Ask for a code. The answer is the same whether or not the address is an
   *  account here — see RESET_CODE_SENT_NOTICE. */
  async function requestCode() {
    setFailure(null);
    setNotice(null);
    setSubmitting(true);
    let err: unknown;
    try {
      err = (await supabase.auth.resetPasswordForEmail(resetEmail.trim())).error;
    } catch (thrown) {
      err = thrown;
    }
    setSubmitting(false);
    const shown = classifyResetRequestError(err);
    if (shown) {
      setFailure(shown);
      return;
    }
    setResetStep('code');
    setNotice(RESET_CODE_SENT_NOTICE);
    // ★ A newly requested code has not been verified, whatever the last one did.
    codeVerified.current = false;
  }

  /** ★★★ Verify the code, then set the password, then land where fix-314 would
   *  have. Both halves are one action to the person, so both are one handler. */
  async function setNewPasswordFromCode() {
    setFailure(null);
    setNotice(null);

    // ★ Two gates BEFORE anything is sent, so a fixable mistake costs no
    //   round trip and — for the password — the rule was on screen first.
    if (!isWellFormedResetCode(code)) {
      setFailure(codeFormatFailure());
      return;
    }
    const weak = validateNewPassword(newPassword);
    if (weak) {
      setFailure(weak);
      return;
    }

    setSubmitting(true);
    setCompletingReset(true);

    // ★★ THE CODE IS SPENT ONCE. If a previous attempt verified it and only the
    //    password step failed, re-verifying would fail on an already-used token
    //    and look like a wrong code. So the verification is remembered and the
    //    retry goes straight to the password.
    if (!codeVerified.current) {
      let err: unknown;
      try {
        err = (
          await supabase.auth.verifyOtp({
            email: resetEmail.trim(),
            token: normaliseResetCode(code),
            // ★★★ 'recovery', and this is the mistake that would look like it
            //     works: 'email' verifies a signup and would sign them in
            //     without ever authorising a password change.
            type: 'recovery',
          })
        ).error;
      } catch (thrown) {
        err = thrown;
      }
      if (err) {
        setSubmitting(false);
        // ★ No session was created, so the guard comes off and this screen
        //   keeps rendering. The code box keeps its value: a mistyped digit
        //   needs a correction, not a new email.
        setCompletingReset(false);
        setFailure(classifyResetError(err));
        return;
      }
      codeVerified.current = true;
    }

    let updateErr: unknown;
    try {
      updateErr = (await supabase.auth.updateUser({ password: newPassword })).error;
    } catch (thrown) {
      updateErr = thrown;
    }
    setSubmitting(false);
    if (updateErr) {
      // ★★ The guard STAYS ON here. verifyOtp already signed them in, so
      //    releasing it would bounce them into the app with their old password
      //    and no sign that anything failed. They stay, read the reason, and
      //    submit a different password.
      setFailure(classifyResetError(updateErr));
      return;
    }
    // ★ fix-314's landing, unchanged: a reset returns you where a sign-in
    //   would have. The guard comes off only on the way out.
    setCompletingReset(false);
    navigate(landing, { replace: true });
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
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'signin') return void handleSubmit(e);
          if (resetStep === 'request') return void requestCode();
          return void setNewPasswordFromCode();
        }}
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

        {mode === 'signin' && (
          <>
            <label className={LABEL_CLASS}>Email</label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              className={`${FIELD_CLASS} mb-4`}
            />

            <label className={LABEL_CLASS}>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              className={`${FIELD_CLASS} mb-6`}
            />
          </>
        )}

        {/* ★★ fix-426 STEP 1 — ask for a code. */}
        {mode === 'reset' && resetStep === 'request' && (
          <>
            <p className="text-[12.5px] text-muted leading-relaxed mb-4" data-testid="reset-intro">
              Enter the address you sign in with. We will email you a{' '}
              {RESET_CODE_LENGTH}-digit code — not a link, because mail scanners
              open links and use them up before you can.
            </p>
            <label className={LABEL_CLASS}>Email</label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              data-testid="reset-email"
              className={`${FIELD_CLASS} mb-6`}
            />
          </>
        )}

        {/* ★★ fix-426 STEP 2 — the code and the new password, together. */}
        {mode === 'reset' && resetStep === 'code' && (
          <>
            <label className={LABEL_CLASS}>
              {RESET_CODE_LENGTH}-digit code
            </label>
            <input
              // ★ `text` with a numeric inputMode, not `number`: a leading zero
              //   is significant here and a number input eats it, along with
              //   giving a code a spinner.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={RESET_CODE_LENGTH + 4}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="reset-code"
              className={`${FIELD_CLASS} mb-4 font-mono tracking-[0.3em]`}
            />

            <label className={LABEL_CLASS}>New password</label>
            {/* ★★ THE RULE, BEFORE THEY TYPE — not after their choice is
                refused. fix-426's brief is explicit and it is the difference
                between a gate and a verdict. */}
            <p className="text-[11.5px] text-muted mb-1.5" data-testid="reset-password-rule">
              {PASSWORD_RULE}
            </p>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="reset-password"
              className={`${FIELD_CLASS} mb-6`}
            />
          </>
        )}

        {/* ★ The neutral answer to "did that address exist?" — see
            RESET_CODE_SENT_NOTICE. It is a notice, not an error, so it does not
            wear the `er` palette fix-357 named for failures. */}
        {notice && (
          <div
            className="text-[12.5px] text-de bg-de-bg border border-de-border rounded-md px-3 py-2.5 mb-4 leading-relaxed"
            role="status"
            data-testid="reset-notice"
          >
            {notice}
          </div>
        )}

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
          {submitLabel(mode, resetStep, submitting)}
        </button>

        {/* ★★★ THE CONTROL fix-357 REFUSED TO FAKE. It is real, it is not
            disabled, and it is a <button> rather than a link because there is
            no page to navigate to — the whole flow is this card. */}
        {mode === 'signin' && (
          <button
            type="button"
            onClick={openReset}
            data-testid="login-forgot"
            className="w-full mt-3 text-[12.5px] text-de hover:underline"
          >
            Forgot password?
          </button>
        )}

        {mode === 'reset' && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={backToSignIn}
              data-testid="reset-back"
              className="text-[12.5px] text-muted hover:underline"
            >
              ← Back to sign in
            </button>
            {/* ★★ "Send a new code" is a CONTROL, not a sentence telling them
                to start over. An expired code and a mistyped one look identical
                coming back from GoTrue, so the person gets both ways forward
                and does not have to work out which they need. */}
            {resetStep === 'code' && (
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={submitting}
                data-testid="reset-resend"
                className="text-[12.5px] text-de hover:underline disabled:opacity-50"
              >
                Send a new code
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

