import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import loginSrc from '../pages/Login.tsx?raw';
import {
  CODE_INPUT_MAX_LENGTH,
  CODE_MAX_DIGITS,
  CODE_MIN_DIGITS,
  classifyResetError,
  codeFormatFailure,
  isWellFormedResetCode,
  normaliseResetCode,
  RESET_CODE_SENT_NOTICE,
} from '../lib/loginErrors';
import {
  WELCOME_CODE_VALID_HOURS,
  codeLifetimeWords,
} from '../../supabase/functions/admin-create-user/codeLifetime';
import { renderWelcomeEmail } from '../../supabase/functions/admin-create-user/welcome';

// ===========================================================================
// fix-678 (P-357) — a sign-in code of any length Supabase sends is accepted
// ===========================================================================
//
// ★★★ Jeanne, 2026-10-15: "the system is looking for a six digit code but the
// code provided is longer than that." Her welcome email carried 8 digits. The
// Login page accepted exactly 6 (fix-426's `RESET_CODE_LENGTH = 6`), but the
// length is a Supabase setting (Auth → Email OTP Length, 6–10) and the project
// emitted 8 — so 7 people added on 10-14 were locked out by our own screen.

function authApiError(message: string, status: number, code?: string) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = 'AuthApiError';
  e.__isAuthError = true;
  e.status = status;
  e.code = code;
  return e;
}

describe('fix-678 §1: every length Supabase can emit is a code', () => {
  it('★★★ 8 digits — Jeanne\'s actual code — is accepted (RED on fix-426)', () => {
    expect(isWellFormedResetCode('03672175')).toBe(true);
  });

  it('★★ 6, 8 and 10 digits are accepted, with spaces or dashes pasted in', () => {
    for (const ok of [
      '123456',
      '12345678',
      '1234567890',
      '  123 456 ',
      '0367 2175',
      '0367-2175',
      '0367–2175', // an en dash, as some mail clients render a hyphen
      '12345-67890',
    ]) {
      expect(isWellFormedResetCode(ok), ok).toBe(true);
    }
  });

  it('★★ 5 and 11 digits, and anything not a digit, are refused', () => {
    for (const bad of ['12345', '12345678901', '1234567a', '', '12.345.678']) {
      expect(isWellFormedResetCode(bad), bad).toBe(false);
    }
    expect([CODE_MIN_DIGITS, CODE_MAX_DIGITS]).toEqual([6, 10]);
  });

  it('★ a leading zero survives — the code is a string, never a number', () => {
    expect(normaliseResetCode('0367 2175')).toBe('03672175');
    expect(normaliseResetCode('0012-3456')).toBe('00123456');
  });

  it('★ the input has room for the longest code plus separators', () => {
    expect(CODE_INPUT_MAX_LENGTH).toBeGreaterThanOrEqual(CODE_MAX_DIGITS + 4);
  });

  it('★★ the "not a code" message states the range, not one number', () => {
    const f = codeFormatFailure();
    expect(f.guidance).toContain('The code in the email is 6 to 10 digits');
    expect(f.headline + f.guidance).not.toMatch(/\b6-digit\b|six-digit/i);
    expect(RESET_CODE_SENT_NOTICE).not.toMatch(/6-digit|six-digit/i);
  });
});

describe('fix-678 §2: one expiry, the same on every screen', () => {
  it('★★★ the constant is 24 hours — Supabase Email OTP Expiration = 86400 s', () => {
    expect(WELCOME_CODE_VALID_HOURS).toBe(24);
    expect(codeLifetimeWords()).toBe('24 hours');
  });

  it('★★★ the Login page\'s wrong-or-expired sentence reads the constant', () => {
    const f = classifyResetError(
      authApiError('Token has expired or is invalid', 403, 'otp_expired'),
    );
    expect(f.guidance).toContain(`codes are good for ${codeLifetimeWords()}`);
    expect(f.guidance).not.toMatch(/about an hour/);
  });

  it('★★★ the welcome email states the same lifetime and names the real button', () => {
    const mail = renderWelcomeEmail({
      audience: 'viewer',
      firstName: 'Jeanne',
      adderFirstName: 'Bobby',
      plate: 'Jeanne · Vice President, Loan Operations · Loans',
      email: 'jeanne@blueprintcap.com',
      code: '03672175',
      areas: ['my_board'],
    });
    expect(mail.text).toContain(
      `The code works for ${codeLifetimeWords()}. If it has expired, open the sign-in page and choose Send a new code.`,
    );
    expect(mail.html).toContain('choose <strong>Send a new code</strong>.');
    expect(mail.html + mail.text).not.toMatch(/Forgot password/);
    // ★ the code is printed whole, leading zero and all
    expect(mail.html).toContain('data-welcome="code">03672175<');
  });

  it('★ the Login page imports the lifetime rather than retyping it', () => {
    expect(loginSrc).toContain('codeLifetimeWords');
    expect(loginSrc).not.toMatch(/RESET_CODE_LENGTH/);
  });
});

// ---------------------------------------------------------------------------
// §3 · the rendered screen
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  verifyCalls: [] as { email: string; token: string; type: string }[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      verifyOtp: async (args: { email: string; token: string; type: string }) => {
        state.verifyCalls.push(args);
        return { data: {}, error: authApiError('stop here', 403, 'otp_expired') };
      },
      updateUser: async () => ({ data: {}, error: null }),
    },
  },
  supabaseUrl: 'http://test.local',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ session: null, initialized: true }),
}));

import Login from '../pages/Login';

async function openCodeStep() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('login-forgot'));
  fireEvent.change(screen.getByTestId('reset-email'), {
    target: { value: 'jeanne@blueprintcap.com' },
  });
  fireEvent.click(screen.getByTestId('login-submit'));
  await waitFor(() => expect(screen.getByTestId('reset-code')).toBeInTheDocument());
}

beforeEach(() => {
  state.verifyCalls = [];
});

describe('fix-678 §3: the screen', () => {
  it('★★★ the label has no number in it', async () => {
    await openCodeStep();
    expect(screen.getByText('Code from the email')).toBeInTheDocument();
    expect(screen.queryByText(/\d-digit/)).toBeNull();
    const input = screen.getByTestId('reset-code') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.maxLength).toBe(CODE_INPUT_MAX_LENGTH);
  });

  it('★★★ an 8-digit code with a space is SENT — digits only, leading zero kept', async () => {
    await openCodeStep();
    fireEvent.change(screen.getByTestId('reset-code'), { target: { value: '0367 2175' } });
    fireEvent.change(screen.getByTestId('reset-password'), {
      target: { value: 'a-long-enough-one' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(state.verifyCalls).toHaveLength(1));
    expect(state.verifyCalls[0].token).toBe('03672175');
  });

  it('★ an 11-digit code is refused before anything is sent', async () => {
    await openCodeStep();
    fireEvent.change(screen.getByTestId('reset-code'), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByTestId('reset-password'), {
      target: { value: 'a-long-enough-one' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('login-error').dataset.failureKind).toBe('code_format'),
    );
    expect(state.verifyCalls).toHaveLength(0);
  });
});
