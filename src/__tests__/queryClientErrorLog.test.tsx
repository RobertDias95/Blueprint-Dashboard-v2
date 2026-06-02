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
vi.mock('../lib/errorLogger', () => ({
  logError: logErrorMock,
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { logError, messageOf } from '../lib/errorLogger';

function makeClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        const k = Array.isArray(query.queryKey)
          ? String(query.queryKey[0] ?? '')
          : String(query.queryKey ?? '');
        if (k.startsWith('auth/')) return;
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
