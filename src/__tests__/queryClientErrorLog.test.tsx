import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from '@tanstack/react-query';

// fix-87: QueryClient defaults log every query / mutation rejection to
// bp_log_error with source=backend_rpc. We rebuild the same client shape
// as App.tsx so we're testing the contract end-to-end rather than the
// `logError` import in isolation.

const logErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// fix-165: keep the REAL classifier (sqlStateOf / isUserInputValidationError)
// so the filter under test matches App.tsx's shouldSkipBackendRpcLog exactly;
// only logError is stubbed so we can assert call counts.
vi.mock('../lib/errorLogger', async (importActual) => {
  const actual = await importActual<typeof import('../lib/errorLogger')>();
  return { ...actual, logError: logErrorMock };
});

import {
  logError,
  messageOf,
  isUserInputValidationError,
} from '../lib/errorLogger';

// Mirrors App.tsx's shouldSkipBackendRpcLog verbatim.
function shouldSkip(err: unknown, key: unknown): boolean {
  const k = Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '');
  if (k.startsWith('auth/')) return true;
  if (isUserInputValidationError(err)) return true;
  return messageOf(err).toLowerCase().includes('bp_log_error');
}

function makeClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (shouldSkip(err, query.queryKey)) return;
        void logError({
          source: 'backend_rpc',
          level: 'error',
          message: messageOf(err),
          context: { kind: 'query', queryKey: query.queryKey },
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (err, _v, _c, mutation) => {
        if (shouldSkip(err, mutation.options.mutationKey)) return;
        void logError({
          source: 'backend_rpc',
          level: 'error',
          message: messageOf(err),
          context: {
            kind: 'mutation',
            mutationKey: mutation.options.mutationKey,
          },
        });
      },
    }),
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  logErrorMock.mockReset();
});

describe('QueryClient global onError (fix-87)', () => {
  it('a failing query fires logError with source=backend_rpc and kind=query', async () => {
    const client = makeClient();
    renderHook(
      () =>
        useQuery({
          queryKey: ['my-query'],
          queryFn: () => Promise.reject(new Error('rpc failed')),
        }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(logErrorMock).toHaveBeenCalledTimes(1));
    const arg = logErrorMock.mock.calls[0][0];
    expect(arg.source).toBe('backend_rpc');
    expect(arg.message).toBe('rpc failed');
    expect(arg.context.kind).toBe('query');
    expect(arg.context.queryKey).toEqual(['my-query']);
  });

  it('a failing mutation fires logError with kind=mutation and the mutationKey', async () => {
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ['save-something'],
          mutationFn: () => Promise.reject(new Error('mutation died')),
        }),
      { wrapper: wrapperFor(client) },
    );

    result.current.mutate();
    await waitFor(() => expect(logErrorMock).toHaveBeenCalledTimes(1));
    const arg = logErrorMock.mock.calls[0][0];
    expect(arg.source).toBe('backend_rpc');
    expect(arg.message).toBe('mutation died');
    expect(arg.context.kind).toBe('mutation');
    expect(arg.context.mutationKey).toEqual(['save-something']);
  });

  // fix-165: a chronology rejection (SQLSTATE 22008) is user input, not a
  // system error — the global backend_rpc path must NOT log it.
  it('a mutation rejecting with SQLSTATE 22008 is skipped (user-input validation)', async () => {
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ['bp_upsert_permit_cycle_row'],
          mutationFn: () =>
            Promise.reject(
              Object.assign(
                new Error(
                  'bp_upsert_permit_cycle_row: Cycle 1: resubmitted (2026-02-15) cannot precede submitted (2026-03-15)',
                ),
                { code: '22008' },
              ),
            ),
        }),
      { wrapper: wrapperFor(client) },
    );

    result.current.mutate();
    // It still rejects; we just don't log it.
    await new Promise((r) => setTimeout(r, 30));
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('a mutation rejecting with a non-22008 code still logs (genuine system error)', async () => {
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ['save-something'],
          mutationFn: () =>
            Promise.reject(
              Object.assign(new Error('deadlock detected'), { code: '40P01' }),
            ),
        }),
      { wrapper: wrapperFor(client) },
    );

    result.current.mutate();
    await waitFor(() => expect(logErrorMock).toHaveBeenCalledTimes(1));
    expect(logErrorMock.mock.calls[0][0].source).toBe('backend_rpc');
  });

  it('auth-key query failures are skipped (user logged out is not an app error)', async () => {
    const client = makeClient();
    renderHook(
      () =>
        useQuery({
          queryKey: ['auth/session'],
          queryFn: () => Promise.reject(new Error('no session')),
        }),
      { wrapper: wrapperFor(client) },
    );

    // The query still rejects; we just shouldn't log it.
    await new Promise((r) => setTimeout(r, 30));
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
