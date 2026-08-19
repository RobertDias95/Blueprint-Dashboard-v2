import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import loginSrc from '../pages/Login.tsx?raw';
import markSrc from '../components/BridgeMark.tsx?raw';
import tailwindConfig from '../../tailwind.config.js?raw';
import {
  classifyLoginError,
  isNetworkFailure,
  type LoginFailure,
} from '../lib/loginErrors';
import { landingAfterSignIn } from '../lib/authEvents';

// ===========================================================================
// fix-357 — the front door tells a locked-out person nothing
// ===========================================================================
//
// ★★★ Jade, 2026-08-19, unable to sign in. The screen showed one line:
// "Failed to fetch" — `setError(authError.message)`, the raw provider string
// handed to a human.
//
// ★★ Verified against prod before anything was written: her account is fine.
// jade@blueprintcap.com — email confirmed, not banned, one profiles row, one
// tenant_memberships row, one roster row, and a successful sign-in on record
// (2026-07-08). Miles signed in at 17:20 the same afternoon. Nothing was wrong
// with the account or the service.
//
// ★★★ THE REGRESSION THIS FILE EXISTS FOR is the browser-independence of the
// network case. "Failed to fetch" is Chrome's wording; Firefox and Safari each
// say something else, and a guard keyed on one of them is silent for everybody
// on the others — which is this ticket's own bug, one layer up.

/** Login.tsx with both comment forms removed. Every absence assertion runs
 *  through here: the file quotes the heading it deleted and the placeholder it
 *  refused to add, and a test that could not tell prose from code would forbid
 *  a file from explaining its own history. */
function loginCode(): string {
  return loginSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// --- the shapes the auth layer really produces -------------------------------

/** supabase-js wraps ANY transport failure in this, whatever the browser said,
 *  with status 0 and `__isAuthError`. Rebuilt here rather than imported so the
 *  test does not depend on the library's constructor staying public. */
function retryableFetchError(message: string) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = 'AuthRetryableFetchError';
  e.__isAuthError = true;
  e.status = 0;
  e.code = undefined;
  return e;
}

function authApiError(message: string, status: number, code?: string) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = 'AuthApiError';
  e.__isAuthError = true;
  e.status = status;
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// §1 — classify, do not print
// ---------------------------------------------------------------------------

describe('fix-357 §1: the network case, detected by TYPE not by TEXT', () => {
  it("★★★ Jade's failure renders guidance, and never the raw string", () => {
    const f = classifyLoginError(retryableFetchError('Failed to fetch'));
    expect(f.kind).toBe('network');
    expect(f.headline).toBe("Can't reach the server");
    // ★ The raw text is not in ANY field for a case we recognise.
    expect(f.technical).toBeNull();
    expect(`${f.headline} ${f.guidance}`).not.toContain('Failed to fetch');
  });

  it('★★★ …and the SAME classification from Firefox and Safari wording', () => {
    // THE REGRESSION THAT MATTERS. Each browser words the transport failure
    // differently; the classification must not notice.
    const wordings = [
      'Failed to fetch', // Chrome, Edge
      'NetworkError when attempting to fetch resource.', // Firefox
      'Load failed', // Safari
      'The network connection was lost.', // Safari, offline
      'network error', // some proxies
      '', // no message at all
    ];
    for (const message of wordings) {
      const f = classifyLoginError(retryableFetchError(message));
      expect(f.kind, `wording: ${JSON.stringify(message)}`).toBe('network');
      expect(f.headline).toBe("Can't reach the server");
    }
  });

  it('★★ status 0 alone is enough, even without the type', () => {
    // Belt and braces: an error that crossed a serialisation boundary and lost
    // its prototype still classifies. "No HTTP response happened at all" is
    // what status 0 means, whatever the object claims to be.
    const bare = { status: 0, message: 'whatever this browser calls it' };
    expect(isNetworkFailure(bare)).toBe(true);
    expect(classifyLoginError(bare).kind).toBe('network');
  });

  it('★★ a bare TypeError — an unwrapped fetch rejection — is network too', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('★★★ and the guard is NOT satisfied by the words alone', () => {
    // The inverse of the regression: a server that RESPONDED, with a body that
    // happens to contain the phrase, is not a transport failure. A string match
    // would get this wrong in the one direction that matters — it would tell a
    // person to check their ad-blocker when the server had refused them.
    const responded = authApiError('Failed to fetch user profile', 500, 'unexpected_failure');
    expect(isNetworkFailure(responded)).toBe(false);
    expect(classifyLoginError(responded).kind).toBe('unknown');
  });

  it('★ the source never greps the browser wording', async () => {
    const code = (await import('../lib/loginErrors.ts?raw')).default as string;
    const body = code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toContain('Failed to fetch');
    expect(body).not.toMatch(/message.*includes\(/);
  });
});

describe('fix-357 §1: the other four cases', () => {
  it('★ wrong credentials — plain, and it does NOT say which field', () => {
    const f = classifyLoginError(
      authApiError('Invalid login credentials', 400, 'invalid_credentials'),
    );
    expect(f.kind).toBe('credentials');
    expect(f.headline).toBe("That email and password don't match");
    const all = `${f.headline} ${f.guidance}`.toLowerCase();
    // ★★ Naming the field tells anyone typing at this box whether an email is a
    // real account here.
    expect(all).not.toMatch(/no such (account|user|email)/);
    expect(all).not.toMatch(/email (is |was )?(not found|unknown|wrong|incorrect)/);
    expect(all).not.toMatch(/password (is |was )?(wrong|incorrect)\b/);
    expect(f.technical).toBeNull();
  });

  it('★ rate-limited — says it lifts by itself, and roughly when', () => {
    for (const err of [
      authApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
      authApiError('Too many requests', 429),
    ]) {
      const f = classifyLoginError(err);
      expect(f.kind).toBe('rate_limited');
      expect(f.guidance).toMatch(/few minutes/);
      expect(f.guidance).toMatch(/lifts by itself/);
    }
  });

  it('★ unconfirmed email — the account exists, contact Bobby', () => {
    const f = classifyLoginError(
      authApiError('Email not confirmed', 400, 'email_not_confirmed'),
    );
    expect(f.kind).toBe('email_unconfirmed');
    expect(f.guidance).toMatch(/Bobby/);
  });

  it('★★ anything unrecognised keeps the raw text — as a FOOTNOTE', () => {
    // A message nobody anticipated is exactly when the underlying string is
    // worth having. Hiding it entirely would have made Jade's bug harder to
    // diagnose, not easier.
    const f = classifyLoginError(
      authApiError('Database error querying schema', 500, 'unexpected_failure'),
    );
    expect(f.kind).toBe('unknown');
    expect(f.technical).toBe('Database error querying schema');
    // ★ …and it is NOT the headline.
    expect(f.headline).toBe('Something went wrong signing you in');
    expect(f.headline).not.toContain('Database error');
  });

  it('★ an empty message still yields something rather than a blank box', () => {
    const f = classifyLoginError(authApiError('', 500));
    expect(f.technical).toBeTruthy();
  });

  it('★ a 400 with no code falls THROUGH, rather than being guessed at', () => {
    // It would be easy to map 400 to "wrong password" and be right most of the
    // time — and wrong in exactly the cases nobody has thought about, which is
    // where the raw string earns its place.
    const f = classifyLoginError(authApiError('Something odd', 400));
    expect(f.kind).toBe('unknown');
    expect(f.technical).toBe('Something odd');
  });
});

// ---------------------------------------------------------------------------
// The rendered screen
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  error: null as unknown,
  throws: false,
  calls: [] as { email: string; password: string }[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: async (creds: { email: string; password: string }) => {
        state.calls.push(creds);
        if (state.throws) throw state.error;
        return { data: { session: null, user: null }, error: state.error };
      },
    },
  },
  supabaseUrl: 'http://test.local',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ session: null, initialized: true }),
}));

import Login from '../pages/Login';

function wrap(node: ReactNode) {
  return render(<MemoryRouter initialEntries={['/login']}>{node}</MemoryRouter>);
}

async function submitWith(err: unknown, opts: { throws?: boolean } = {}) {
  state.error = err;
  state.throws = opts.throws ?? false;
  wrap(<Login />);
  fireEvent.change(screen.getByTestId('login-email'), {
    target: { value: 'jade@blueprintcap.com' },
  });
  fireEvent.change(screen.getByTestId('login-password'), {
    target: { value: 'hunter2' },
  });
  fireEvent.click(screen.getByTestId('login-submit'));
  await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument());
}

beforeEach(() => {
  state.error = null;
  state.throws = false;
  state.calls = [];
});

describe('fix-357: what a blocked person actually sees', () => {
  it('★★★ the network failure shows guidance, not "Failed to fetch"', async () => {
    await submitWith(retryableFetchError('Failed to fetch'));
    const box = screen.getByTestId('login-error');
    expect(box.dataset.failureKind).toBe('network');
    expect(screen.getByTestId('login-error-headline').textContent).toBe(
      "Can't reach the server",
    );
    const guidance = screen.getByTestId('login-error-guidance').textContent ?? '';
    expect(guidance).toMatch(/hard refresh/i);
    expect(guidance).toMatch(/incognito/i);
    expect(guidance).toMatch(/mobile data/i);
    // ★ The string that started this ticket appears nowhere on screen.
    expect(box.textContent).not.toContain('Failed to fetch');
    expect(screen.queryByTestId('login-error-technical')).toBeNull();
  });

  it('★★ a THROWN transport failure is caught too, not left unhandled', async () => {
    // A transport failure can arrive either as a returned error or as a
    // rejection, depending on where in the client it happens.
    await submitWith(new TypeError('Load failed'), { throws: true });
    expect(screen.getByTestId('login-error').dataset.failureKind).toBe('network');
  });

  it('★ the unknown case renders the raw text, small and labelled', async () => {
    await submitWith(authApiError('Database error querying schema', 500));
    expect(screen.getByTestId('login-error').dataset.failureKind).toBe('unknown');
    const tech = screen.getByTestId('login-error-technical');
    expect(tech.textContent).toContain('Database error querying schema');
    expect(tech.textContent).toMatch(/technical detail/i);
    // ★ The headline is still the human sentence.
    expect(screen.getByTestId('login-error-headline').textContent).toBe(
      'Something went wrong signing you in',
    );
  });

  it('★★ the box uses the ERROR palette, not corrections amber', async () => {
    await submitWith(retryableFetchError('Failed to fetch'));
    const cls = screen.getByTestId('login-error').className;
    expect(cls).toContain('text-er');
    expect(cls).toContain('bg-er-bg');
    expect(cls).toContain('border-er-border');
    // `co` is CORRECTIONS. Being unable to sign in is not a mild warning.
    expect(cls).not.toMatch(/\bco\b|co-bg|co-border/);
  });

  it('★ it is announced to a screen reader — a blocked person may not see it', async () => {
    await submitWith(retryableFetchError('Failed to fetch'));
    expect(screen.getByTestId('login-error').getAttribute('role')).toBe('alert');
  });

  it('★ and the error clears when they try again', async () => {
    await submitWith(retryableFetchError('Failed to fetch'));
    state.error = null;
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.queryByTestId('login-error')).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// §2 — the palette
// ---------------------------------------------------------------------------

describe('fix-357 §2: the error colour is named, not borrowed', () => {
  it('★★ `er` is a real token, and it is the red already in use', () => {
    // ★ Asserted on tailwind.config rather than index.css: the config is what
    // compiles `text-er` / `bg-er-bg` into real CSS, so it is the file that
    // would actually break the screen if the token went missing. (index.css
    // carries the matching custom properties and the reasoning; it is processed
    // by PostCSS before a test can read it as text.)
    expect(tailwindConfig).toMatch(/er:\s*\{\s*DEFAULT:\s*'#dc2626'/);
    expect(tailwindConfig).toMatch(/bg:\s*'#fee2e2'/);
    expect(tailwindConfig).toMatch(/border:\s*'#fca5a5'/);
  });

  it('★ it is not a fourth red — #dc2626 was already the app\'s error colour', async () => {
    // Ribbon's error-triage badge and PermitCard's red row both use it. What
    // was missing was a NAME, so surfaces reached for the nearest token, and
    // the nearest token was corrections amber.
    const ribbon = (await import('../components/Ribbon.tsx?raw')).default as string;
    expect(ribbon).toContain('#dc2626');
  });
});

// ---------------------------------------------------------------------------
// §3 — the branding
// ---------------------------------------------------------------------------

describe('fix-357 §3: the login screen got fix-351\'s lockup', () => {
  it('★★ it renders the lockup as a REFERENCED image', () => {
    wrap(<Login />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/bridge-logo-2026/);
    expect(img.dataset.logoVariant).toBe('lockup');
  });

  it('★★ fix-322\'s grep survives — nothing here is redrawn', () => {
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code(loginSrc)).not.toMatch(/<path|<svg|viewBox/);
    expect(code(markSrc)).not.toMatch(/<path|<svg|viewBox/);
  });

  it('★★★ "Entitlements — v2" and "Blueprint Capital" are gone', () => {
    wrap(<Login />);
    const form = screen.getByTestId('login-brand').closest('form')!;
    expect(form.textContent).not.toMatch(/Entitlements — v2/);
    expect(form.textContent).not.toMatch(/Blueprint Capital/);
    // ★ Gone from the CODE too — no switched-off heading to find later.
    // Comments stripped first: this file explains what it used to say, and a
    // test that cannot tell prose from code would forbid the explanation.
    expect(loginCode()).not.toContain('Entitlements — v2');
    expect(loginCode()).not.toContain('Blueprint Capital');
  });

  it('★ the name did not leave the accessible tree with the heading', () => {
    // The words are inside the artwork now, so the alt text is the only place
    // they can live — the same rule fix-351 applied to the header.
    wrap(<Login />);
    expect(screen.getByTestId('bridge-mark').getAttribute('alt')).toMatch(/The Bridge/);
  });

  it('★★ scaled to the card, not cropped — 56px tall is 320px wide', () => {
    // The card is max-w-sm (384) with p-8 (32 a side) = 320px of content.
    // 320 / 5.7183 = 55.96, so 56px of height fills it to the pixel.
    wrap(<Login />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.style.height).toBe('56px');
    // ★ Width comes from the FILE's aspect ratio, which is what stops any
    // caller stretching the artwork.
    expect(img.style.width).toBe('auto');
    expect(56 * (2030 / 355)).toBeCloseTo(320.2, 1);
  });
});

// ---------------------------------------------------------------------------
// §4 — no placeholder
// ---------------------------------------------------------------------------

describe('fix-357 §4: no forgot-password link, disabled or otherwise', () => {
  it('★★★ there is no dead control on the screen', () => {
    // A disabled link that looks like an answer is worse than its absence, and
    // it is exactly what the no-placeholders rule forbids. What the flow would
    // take is measured in the PR; building it is Bobby's decision.
    wrap(<Login />);
    expect(screen.queryByText(/forgot/i)).toBeNull();
    expect(screen.queryByText(/reset/i)).toBeNull();
    expect(loginCode()).not.toMatch(/resetPasswordForEmail/);
    expect(loginCode().toLowerCase()).not.toMatch(/forgot password/);
  });

  it('★ …but the screen still tells a stuck person what to do', () => {
    // The credentials message carries the only recovery that exists today.
    const f = classifyLoginError(
      authApiError('Invalid login credentials', 400, 'invalid_credentials'),
    );
    expect(f.guidance).toMatch(/no self-service password reset/i);
    expect(f.guidance).toMatch(/Bobby/);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-357: prior contracts survive', () => {
  it('★★ fix-314\'s return-to-where-you-were is untouched', () => {
    // Miles reported this and it was a real bug. The redirect logic is not
    // this ticket's business and must still be read from location.state.
    expect(loginSrc).toContain('landingAfterSignIn');
    expect(loginSrc).toMatch(/location\.state as \{ from\?: unknown \}/);
    expect(loginSrc).toContain('navigate(landing, { replace: true })');
    // And the helper itself still behaves.
    expect(landingAfterSignIn({ pathname: '/board' })).toBe('/board');
    expect(landingAfterSignIn('//evil.com')).toBe('/dashboard');
    expect(landingAfterSignIn(undefined)).toBe('/dashboard');
  });

  it('★ the already-signed-in short-circuit still goes where the bounce came from', () => {
    expect(loginSrc).toMatch(/initialized && session[\s\S]{0,80}Navigate to=\{landing\}/);
  });

  it('★ the credentials are still what gets sent — no field was dropped', async () => {
    await submitWith(retryableFetchError('Failed to fetch'));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toEqual({
      email: 'jade@blueprintcap.com',
      password: 'hunter2',
    });
  });

  it('★ fix-314\'s friendlyAuthMessage is left alone — a different surface', async () => {
    // It matches on strings, which this ticket forbids for the LOGIN screen.
    // It is fix-314's helper for a session that vanished under somebody already
    // signed in, where the input is an arbitrary thrown value with no typed
    // error to interrogate. Deliberately not touched.
    const events = (await import('../lib/authEvents.ts?raw')).default as string;
    expect(events).toContain('friendlyAuthMessage');
  });
});

// ---------------------------------------------------------------------------
// The five messages, pinned. ★ This is the deliverable.
// ---------------------------------------------------------------------------

describe('fix-357: the five messages a person can meet', () => {
  const cases: Array<[string, LoginFailure]> = [
    ['network', classifyLoginError(retryableFetchError('Failed to fetch'))],
    [
      'credentials',
      classifyLoginError(authApiError('Invalid login credentials', 400, 'invalid_credentials')),
    ],
    [
      'rate_limited',
      classifyLoginError(authApiError('rate limited', 429, 'over_request_rate_limit')),
    ],
    [
      'email_unconfirmed',
      classifyLoginError(authApiError('Email not confirmed', 400, 'email_not_confirmed')),
    ],
    ['unknown', classifyLoginError(authApiError('Something nobody expected', 500))],
  ];

  it('★★ every one has a headline and guidance, and none is a raw provider string', () => {
    for (const [kind, f] of cases) {
      expect(f.kind, kind).toBe(kind);
      expect(f.headline.length, kind).toBeGreaterThan(10);
      expect(f.guidance.length, kind).toBeGreaterThan(30);
      // ★ No headline is a provider string, and none ends in a full stop —
      // they are labels, not sentences.
      expect(f.headline, kind).not.toMatch(/^[A-Z_]+$/);
      expect(f.headline, kind).not.toMatch(/\.$/);
    }
  });

  it('★★ only the unrecognised one carries technical detail', () => {
    for (const [kind, f] of cases) {
      if (kind === 'unknown') expect(f.technical).toBeTruthy();
      else expect(f.technical, kind).toBeNull();
    }
  });
});
