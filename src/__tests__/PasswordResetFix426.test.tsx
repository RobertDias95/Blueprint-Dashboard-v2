import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import loginSrc from '../pages/Login.tsx?raw';
import errorsSrc from '../lib/loginErrors.ts?raw';
import {
  PASSWORD_MIN_LENGTH,
  RESET_CODE_LENGTH,
  classifyResetError,
  classifyResetRequestError,
  isWellFormedResetCode,
  validateNewPassword,
} from '../lib/loginErrors';

// ===========================================================================
// fix-426 — a person locked out gets back in without Bobby
// ===========================================================================
//
// ★★★ TWO LOCKOUTS IN TEN DAYS. Jade 2026-08-19 (fix-357), Brittani
// 2026-08-28. NEITHER ACCOUNT WAS BROKEN — Brittani was typing a trailing `!`
// her stored password does not have. The problem was that the only way back in
// was Bobby, and the login screen said so in as many words. fix-357 §4 measured
// that deliberately and left the call; Bobby made it on 2026-08-28.
//
// ---------------------------------------------------------------------------
// ★★★ THE EMAIL CARRIES A CODE, NOT A LINK, AND THAT IS THE WHOLE TICKET
// ---------------------------------------------------------------------------
//
// A reset LINK is single-use, and a mail-security scanner that opens links to
// check them SPENDS IT. Measured, not hypothesised: three sessions exist on
// Brittani's account created from datacenter IPs with a stale `Chrome/118`
// user-agent, one of them 17 SECONDS after a recovery email was sent, each
// holding a live unused refresh token — and nobody else in the database has a
// single one. She never got a working link; she got a dead page, silently, in
// the exact case the feature exists for.
//
// Supabase names the case itself: `{{ .Token }}` exists so a code "helps
// prevent issues with email clients that prefetch URLs for security scanning."
//
// ★★ THE STEP THIS REPO CANNOT TAKE: the Recovery email template must use
//    `{{ .Token }}` instead of `{{ .ConfirmationURL }}`, and that lives in the
//    Supabase dashboard. Until it is changed the flow below is correct and the
//    email still carries a link. §F asserts this code never handles one.

/** Login.tsx with both comment forms removed — the file quotes the copy it
 *  retired and the trap it avoids, and a test that could not tell prose from
 *  code would forbid a file from explaining its own history. */
function loginCode(): string {
  return loginSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function authApiError(message: string, status: number, code?: string) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = 'AuthApiError';
  e.__isAuthError = true;
  e.status = status;
  e.code = code;
  return e;
}
function retryableFetchError(message: string) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = 'AuthRetryableFetchError';
  e.__isAuthError = true;
  e.status = 0;
  return e;
}

// ---------------------------------------------------------------------------
// §A · the classifier, extended rather than replaced
// ---------------------------------------------------------------------------

describe('fix-426 §A: every failure gets a human sentence', () => {
  it('★★★ a rejected code never shows the provider string as the headline', () => {
    const f = classifyResetError(
      authApiError('Token has expired or is invalid', 403, 'otp_expired'),
    );
    expect(f.kind).toBe('code_rejected');
    expect(f.headline).toBe("That code didn't work");
    expect(f.headline).not.toContain('Token has expired');
    expect(f.technical).toBeNull();
  });

  it('★★★ WRONG and EXPIRED are ONE sentence, because GoTrue does not separate them', () => {
    // ★★ THE BRIEF ASKED FOR TWO and this is a deliberate deviation. GoTrue
    //    answers a mistyped code and an expired code with the SAME error —
    //    code `otp_expired`, message "Token has expired or is invalid". A
    //    screen that said "your code expired" would be inventing the half it
    //    does not know, which is fix-357's mistake in a new place.
    //
    // ★★ What the person needs is BOTH WAYS OUT, and §D proves they get them as
    //    controls: the code box stays re-submittable, and "Send a new code"
    //    sits beside it.
    const f = classifyResetError(
      authApiError('Token has expired or is invalid', 403, 'otp_expired'),
    );
    expect(f.guidance).toMatch(/digit wrong/i);
    expect(f.guidance).toMatch(/expired/i);
    // A 403 with no code at all is the same thing on older builds.
    expect(classifyResetError(authApiError('forbidden', 403)).kind).toBe('code_rejected');
  });

  it('★★ a mistyped code is caught BEFORE anything is sent', () => {
    // The one case that IS separable: a code that is not six digits is
    // definitely mistyped, and costs no round trip to say so.
    expect(isWellFormedResetCode('123456')).toBe(true);
    expect(isWellFormedResetCode('  123456 ')).toBe(true); // people paste
    expect(isWellFormedResetCode('12345')).toBe(false);
    expect(isWellFormedResetCode('1234567')).toBe(false);
    expect(isWellFormedResetCode('12345a')).toBe(false);
    expect(RESET_CODE_LENGTH).toBe(6);
  });

  it('★ rate-limited says how long to wait, in its own words', () => {
    const f = classifyResetError(
      authApiError('Email rate limit exceeded', 429, 'over_request_rate_limit'),
    );
    expect(f.kind).toBe('rate_limited');
    // ★ Not the sign-in wording: the thing being throttled is emails.
    expect(f.headline).toMatch(/code requests/i);
    expect(f.guidance).toMatch(/few minutes/);
  });

  it('★★ the network case is fix-357\'s, unchanged', () => {
    for (const wording of ['Failed to fetch', 'Load failed', '']) {
      const f = classifyResetError(retryableFetchError(wording));
      expect(f.kind, `wording: ${JSON.stringify(wording)}`).toBe('network');
      expect(f.headline).toBe("Can't reach the server");
      // ★ The browser's own words never reach the screen. (An empty message has
      //   nothing to look for, and `''` is a substring of everything.)
      if (wording) expect(`${f.headline} ${f.guidance}`).not.toContain(wording);
    }
  });

  it('★ anything else keeps the raw text as a labelled footnote', () => {
    const f = classifyResetError(authApiError('kaboom', 500, 'unexpected_failure'));
    expect(f.kind).toBe('unknown');
    expect(f.headline).not.toContain('kaboom');
    expect(f.technical).toBe('kaboom');
  });

  it('★★ a server-refused password names the rule it broke, as detail', () => {
    const f = classifyResetError(
      authApiError('Password should contain at least one symbol', 422, 'weak_password'),
    );
    expect(f.kind).toBe('weak_password');
    expect(f.headline).not.toMatch(/symbol/);
    // ★ The one place the provider string earns its space: it names the actual
    //   requirement, which this screen cannot know from the project settings.
    expect(f.technical).toMatch(/at least one symbol/);
  });
});

// ---------------------------------------------------------------------------
// §B · non-disclosure
// ---------------------------------------------------------------------------

describe('fix-426 §B: the box never says whether an address is an account', () => {
  it('★★★ a "user not found" answer is SWALLOWED, not shown', () => {
    // ★★ Supabase returns success for an unknown address today — that is the
    //    point. But a provider change that started returning 404 would turn
    //    this box into an account-existence oracle without one line of our code
    //    changing. Swallowing it costs nothing and closes the door in advance.
    expect(classifyResetRequestError(authApiError('User not found', 404, 'user_not_found')))
      .toBeNull();
    expect(classifyResetRequestError(authApiError('not found', 404))).toBeNull();
    expect(classifyResetRequestError(null)).toBeNull();
  });

  it('★ but a transport or rate-limit failure IS shown — neither reveals anything', () => {
    expect(classifyResetRequestError(retryableFetchError('Failed to fetch'))?.kind)
      .toBe('network');
    expect(
      classifyResetRequestError(authApiError('rate', 429, 'over_request_rate_limit'))?.kind,
    ).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
// §C · the password rule
// ---------------------------------------------------------------------------

describe('fix-426 §C: the rule is a gate, not a verdict', () => {
  it('★ too short is refused locally, with the rule in the sentence', () => {
    const f = validateNewPassword('short');
    expect(f?.kind).toBe('weak_password');
    expect(f?.guidance).toMatch(new RegExp(`${PASSWORD_MIN_LENGTH} characters`));
    expect(f?.guidance).toMatch(/nothing has been changed/i);
    expect(validateNewPassword('longenough1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rendered flow
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  session: null as unknown,
  resetError: null as unknown,
  verifyError: null as unknown,
  updateError: null as unknown,
  resetCalls: [] as string[],
  verifyCalls: [] as { email: string; token: string; type: string }[],
  updateCalls: [] as { password: string }[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async (email: string) => {
        state.resetCalls.push(email);
        return { data: {}, error: state.resetError };
      },
      verifyOtp: async (args: { email: string; token: string; type: string }) => {
        state.verifyCalls.push(args);
        if (state.verifyError) return { data: {}, error: state.verifyError };
        // ★★ VERIFYING SIGNS THEM IN. That is the trap the guard exists for —
        //    see §E — so the mock reproduces it rather than pretending
        //    otherwise.
        state.session = { user: { id: 'u1' } };
        return { data: { session: state.session }, error: null };
      },
      updateUser: async (args: { password: string }) => {
        state.updateCalls.push(args);
        return { data: {}, error: state.updateError };
      },
    },
  },
  supabaseUrl: 'http://test.local',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ session: state.session, initialized: true }),
}));

import Login from '../pages/Login';

function Landed() {
  const loc = useLocation();
  return <div data-testid="landed">{loc.pathname}</div>;
}

function wrap(from?: string) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/login', state: from ? { from: { pathname: from } } : null },
      ]}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the reset flow and get a code sent. */
async function requestCode(email = 'brittani@blueprintcap.com') {
  fireEvent.click(screen.getByTestId('login-forgot'));
  fireEvent.change(screen.getByTestId('reset-email'), { target: { value: email } });
  fireEvent.click(screen.getByTestId('login-submit'));
  await waitFor(() => expect(screen.getByTestId('reset-code')).toBeInTheDocument());
}

function fillAndSubmit(code: string, password: string) {
  fireEvent.change(screen.getByTestId('reset-code'), { target: { value: code } });
  fireEvent.change(screen.getByTestId('reset-password'), { target: { value: password } });
  fireEvent.click(screen.getByTestId('login-submit'));
}

beforeEach(() => {
  state.session = null;
  state.resetError = null;
  state.verifyError = null;
  state.updateError = null;
  state.resetCalls = [];
  state.verifyCalls = [];
  state.updateCalls = [];
});

// ---------------------------------------------------------------------------
// §D · the happy path, and the retries
// ---------------------------------------------------------------------------

describe('fix-426 §D: request → verify → set → signed in', () => {
  it('★★★ the whole flow, and verifyOtp is called with type "recovery"', async () => {
    // ★★★ THE MISTAKE THAT WOULD LOOK LIKE IT WORKS: type 'email' verifies a
    //     signup and signs them in WITHOUT authorising a password change.
    wrap();
    await requestCode();
    expect(state.resetCalls).toEqual(['brittani@blueprintcap.com']);
    fillAndSubmit('123456', 'a-long-enough-one');
    await waitFor(() => expect(state.updateCalls).toHaveLength(1));
    expect(state.verifyCalls).toEqual([
      { email: 'brittani@blueprintcap.com', token: '123456', type: 'recovery' },
    ]);
    expect(state.updateCalls[0].password).toBe('a-long-enough-one');
  });

  it('★★★ fix-314 survives: a reset lands where the bounce came from', async () => {
    // Asserted, not assumed. A password reset must return you to the page you
    // were on exactly as a sign-in does.
    wrap('/project/abc');
    await requestCode();
    fillAndSubmit('123456', 'a-long-enough-one');
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());
    expect(screen.getByTestId('landed').textContent).toBe('/project/abc');
  });

  it('★★ a corrected code works WITHOUT requesting a new one', async () => {
    wrap();
    await requestCode();
    state.verifyError = authApiError('Token has expired or is invalid', 403, 'otp_expired');
    fillAndSubmit('111111', 'a-long-enough-one');
    await waitFor(() =>
      expect(screen.getByTestId('login-error').dataset.failureKind).toBe('code_rejected'),
    );
    // ★ Still on the code screen, still one email sent.
    expect(screen.getByTestId('reset-code')).toBeInTheDocument();
    expect(state.resetCalls).toHaveLength(1);

    state.verifyError = null;
    fillAndSubmit('123456', 'a-long-enough-one');
    await waitFor(() => expect(state.updateCalls).toHaveLength(1));
    expect(state.resetCalls).toHaveLength(1); // ★ never asked for a second code
  });

  it('★★ "Send a new code" is a CONTROL, not a sentence telling them to start over', async () => {
    wrap();
    await requestCode();
    const resend = screen.getByTestId('reset-resend');
    expect(resend).toBeInTheDocument();
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(state.resetCalls).toHaveLength(2));
  });

  it('★ a mistyped code is refused locally — no round trip', async () => {
    wrap();
    await requestCode();
    fillAndSubmit('12345', 'a-long-enough-one');
    await waitFor(() =>
      expect(screen.getByTestId('login-error').dataset.failureKind).toBe('code_format'),
    );
    expect(state.verifyCalls).toHaveLength(0);
  });

  it('★ a weak password is blocked, and the rule was on screen first', async () => {
    wrap();
    await requestCode();
    // ★★ SHOWN BEFORE THEY TYPE, which is the difference between a gate and a
    //    verdict — it is rendered as soon as the field is.
    expect(screen.getByTestId('reset-password-rule').textContent).toMatch(
      new RegExp(`${PASSWORD_MIN_LENGTH} characters`),
    );
    fillAndSubmit('123456', 'short');
    await waitFor(() =>
      expect(screen.getByTestId('login-error').dataset.failureKind).toBe('weak_password'),
    );
    expect(state.verifyCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('★★★ an unknown address is INDISTINGUISHABLE from a known one', async () => {
    // Rendered side by side rather than argued about: same notice, same next
    // screen, same controls.
    const first = wrap();
    await requestCode('nobody@example.com');
    const unknown = screen.getByTestId('reset-notice').textContent;
    const unknownHasCodeBox = !!screen.queryByTestId('reset-code');
    expect(screen.queryByTestId('login-error')).toBeNull();
    first.unmount();

    beforeEachReset();
    wrap();
    await requestCode('brittani@blueprintcap.com');
    expect(screen.getByTestId('reset-notice').textContent).toBe(unknown);
    expect(!!screen.queryByTestId('reset-code')).toBe(unknownHasCodeBox);
    expect(screen.queryByTestId('login-error')).toBeNull();
  });
});

function beforeEachReset() {
  state.session = null;
  state.resetError = null;
  state.verifyError = null;
  state.updateError = null;
  state.resetCalls = [];
  state.verifyCalls = [];
  state.updateCalls = [];
}

// ---------------------------------------------------------------------------
// §E · the trap
// ---------------------------------------------------------------------------

describe('fix-426 §E: verifying signs them in, and that nearly breaks the flow', () => {
  it('★★★ the screen does NOT navigate away between verifyOtp and updateUser', async () => {
    // ★★★ verifyOtp establishes a session. Without a guard, Login's
    //     `initialized && session` early-return fires on the very next render
    //     and the component navigates away BEFORE the password is set — the
    //     person lands on the dashboard with their OLD password and no sign
    //     that anything failed. This is the assertion that catches its removal.
    state.updateError = authApiError('Password should be different', 422, 'same_password');
    wrap();
    await requestCode();
    fillAndSubmit('123456', 'a-long-enough-one');
    await waitFor(() => expect(state.updateCalls).toHaveLength(1));
    // A session now exists…
    expect(state.session).not.toBeNull();
    // …and we are still on the reset screen, showing why it failed.
    expect(screen.queryByTestId('landed')).toBeNull();
    expect(screen.getByTestId('login-error')).toBeInTheDocument();
  });

  it('★★ retrying the password does NOT re-verify a spent code', async () => {
    // ★ A recovery code is single-use. Re-sending it after the password step
    //   failed would come back "invalid" and look like a wrong code.
    state.updateError = authApiError('Password should be different', 422, 'same_password');
    wrap();
    await requestCode();
    fillAndSubmit('123456', 'a-long-enough-one');
    await waitFor(() => expect(state.updateCalls).toHaveLength(1));

    state.updateError = null;
    fireEvent.change(screen.getByTestId('reset-password'), {
      target: { value: 'a-different-one' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(state.updateCalls).toHaveLength(2));
    expect(state.verifyCalls).toHaveLength(1); // ★ verified once, ever
  });
});

// ---------------------------------------------------------------------------
// §F · what this must never do
// ---------------------------------------------------------------------------

describe('fix-426 §F: a code, never a link', () => {
  it('★★★ no ConfirmationURL, no deep-link route, no token parsing', () => {
    const code = loginCode();
    expect(code).not.toMatch(/ConfirmationURL/i);
    expect(code).not.toMatch(/access_token|refresh_token/);
    expect(code).not.toMatch(/window\.location\.hash|useSearchParams/);
    // ★ resetPasswordForEmail is called with the address ALONE — no
    //   redirectTo, because there is nothing to redirect to.
    expect(code).toMatch(/resetPasswordForEmail\(\s*resetEmail\.trim\(\)\s*\)/);
    expect(code).not.toMatch(/redirectTo/);
  });

  it('★★ the "no self-service password reset" copy is gone', () => {
    // Asserted by CONTENT, on the executable text — the file explains what it
    // retired, and prose quoting the old sentence is not the old sentence.
    const body = errorsSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/no self-service password/i);
    expect(body).toMatch(/Forgot password\?/);
  });

  it('★ the standing decision is RECORDED, not silently deleted', () => {
    // fix-357 wrote "building it is Bobby's call". He called it; the comment
    // says so rather than vanishing, so the next reader learns the rule and its
    // resolution together.
    expect(loginSrc).toMatch(/BOBBY MADE THAT CALL/);
    expect(loginSrc).toMatch(/no placeholder/i);
  });

  it('★★ fix-351\'s lockup is still referenced, never redrawn', () => {
    expect(loginSrc).toMatch(/BridgeMark/);
    expect(loginCode()).not.toMatch(/<svg|<path/);
  });
});
