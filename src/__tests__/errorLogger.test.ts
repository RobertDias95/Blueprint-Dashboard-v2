import { describe, it, expect, beforeEach, vi } from 'vitest';

// fix-87: the logger is the seam every other test mocks against. We test
// it via the supabase.rpc mock directly so the contract — name of RPC,
// argument shape, fire-and-forget — is pinned.

const rpcMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: null, error: null }));

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import {
  logError,
  messageOf,
  sqlStateOf,
  isUserInputValidationError,
  USER_INPUT_SQLSTATES,
} from '../lib/errorLogger';

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe('errorLogger', () => {
  it('logError forwards the source / level / message / context to bp_log_error', async () => {
    await logError({
      source: 'frontend_toast',
      level: 'error',
      message: 'boom',
      context: { url: '/dashboard' },
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe('bp_log_error');
    // ★★ fix-511 §A SUPERSEDES the equality this used to assert. It read
    //    `p_context: { url: '/dashboard' }` — the caller's context and nothing
    //    else — and the property it was defending is that the caller's context
    //    arrives INTACT, which is asserted below and is still true. What the
    //    reporter now ADDS is the environment that sent the row: P-197 found
    //    every frontend exception in a seven-day window came from
    //    localhost:5178 and no row could say so, because `backend_rpc` rows
    //    carry only a relative pathname. See DevSessionsNotReportedFix511.
    expect(rpcMock.mock.calls[0][1]).toEqual({
      p_source: 'frontend_toast',
      p_level: 'error',
      p_message: 'boom',
      p_context: {
        url: '/dashboard',
        environment: 'test',
        origin: 'http://localhost:3000',
      },
    });
  });

  it('clips ridiculously long messages to 2000 chars + ellipsis (room for a giant stack)', async () => {
    const huge = 'x'.repeat(5_000);
    await logError({ source: 'frontend_exception', level: 'error', message: huge });
    const sentMessage = rpcMock.mock.calls[0][1].p_message as string;
    expect(sentMessage.length).toBe(2_001);
    expect(sentMessage.endsWith('…')).toBe(true);
  });

  it('defaults context to {} when omitted', async () => {
    await logError({
      source: 'backend_rpc',
      level: 'error',
      message: 'rpc died',
    });
    // ★ fix-511 §A: "defaults to {}" is now "defaults to the environment
    //   stamp and nothing else" — the point stands, which is that an absent
    //   caller context never becomes null or undefined.
    expect(rpcMock.mock.calls[0][1].p_context).toEqual({
      environment: 'test',
      origin: 'http://localhost:3000',
    });
  });

  it('swallows RPC failures so callers never see them', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });
    // The supabase JS client resolves the Promise with { error } rather
    // than rejecting; we still treat that as "logger noise" and keep
    // quiet so the app keeps working.
    await expect(
      logError({ source: 'frontend_toast', level: 'error', message: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('swallows hard rejections too', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network'));
    await expect(
      logError({ source: 'frontend_toast', level: 'error', message: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('re-entry guard: a logError invoked while another is in flight does NOT call the RPC twice', async () => {
    // First call resolves slowly so we can fire a second mid-flight.
    let resolveFirst: ((v: { data: null; error: null }) => void) | undefined;
    rpcMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );

    const p1 = logError({ source: 'frontend_toast', level: 'error', message: 'first' });
    // While p1 is unresolved, a second logError call should short-circuit.
    const p2 = logError({ source: 'backend_rpc', level: 'error', message: 'second' });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    resolveFirst?.({ data: null, error: null });
    await Promise.all([p1, p2]);

    // After p1 resolves, a third call goes through normally.
    await logError({ source: 'frontend_toast', level: 'error', message: 'third' });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('messageOf handles string, Error, plain-object, null, undefined', () => {
    expect(messageOf('hi')).toBe('hi');
    expect(messageOf(new Error('boom'))).toBe('boom');
    expect(messageOf({ message: 'rpc' })).toBe('rpc');
    expect(messageOf(null)).toBe('unknown error');
    expect(messageOf(undefined)).toBe('unknown error');
    expect(messageOf({ code: 42 })).toBe('{"code":42}');
  });
});

// fix-165: SQLSTATE classification — user-input validation rejections
// (the fix-89 chronology guard, SQLSTATE 22008) must be surfaced inline
// but kept out of Error Reports.
describe('errorLogger — SQLSTATE classification (fix-165)', () => {
  it('sqlStateOf reads a string `code` off a supabase-js error', () => {
    expect(sqlStateOf({ message: 'bad date', code: '22008' })).toBe('22008');
    expect(sqlStateOf({ message: 'occ', code: 'P0001' })).toBe('P0001');
  });

  it('sqlStateOf returns undefined for errors without a string code', () => {
    expect(sqlStateOf(new Error('plain'))).toBeUndefined();
    expect(sqlStateOf({ message: 'no code' })).toBeUndefined();
    expect(sqlStateOf({ code: 22008 })).toBeUndefined(); // numeric, not a SQLSTATE string
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf('boom')).toBeUndefined();
  });

  it('isUserInputValidationError is true ONLY for known user-input SQLSTATEs', () => {
    expect(USER_INPUT_SQLSTATES.has('22008')).toBe(true);
    // The chronology rejection the user typed — surfaced, not logged.
    expect(
      isUserInputValidationError({
        message:
          'bp_upsert_permit_cycle_row: Cycle 1: resubmitted (2026-02-15) cannot precede submitted (2026-03-15)',
        code: '22008',
      }),
    ).toBe(true);
  });

  it('isUserInputValidationError is false for system errors (keeps them logging)', () => {
    expect(isUserInputValidationError(new Error('mutation died'))).toBe(false);
    expect(isUserInputValidationError({ message: 'x', code: 'P0001' })).toBe(false);
    expect(isUserInputValidationError({ message: 'occ conflict' })).toBe(false);
    expect(isUserInputValidationError(undefined)).toBe(false);
  });
});
