import { describe, it, expect, beforeEach, vi } from 'vitest';

// fix-87: the logger is the seam every other test mocks against. We test
// it via the supabase.rpc mock directly so the contract — name of RPC,
// argument shape, fire-and-forget — is pinned.

const rpcMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: null, error: null }));

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import { logError, messageOf } from '../lib/errorLogger';

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
    expect(rpcMock.mock.calls[0][1]).toEqual({
      p_source: 'frontend_toast',
      p_level: 'error',
      p_message: 'boom',
      p_context: { url: '/dashboard' },
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
    expect(rpcMock.mock.calls[0][1].p_context).toEqual({});
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
