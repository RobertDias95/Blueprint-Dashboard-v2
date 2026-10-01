// ===========================================================================
// ★★★ fix-604 — A FAILED WRITE ARRIVES IN TRIAGE WITH ITS NAME ON IT
// ===========================================================================
//
// The census test next door proves every hook DECLARES a name. This one proves
// the declaration actually reaches `error_reports`, through the real reporter
// code, using the hook from P-286 itself: `useSetProjectCancel`.
//
// ★★ WHAT IS REAL HERE AND WHAT IS NOT. `mutationErrorContext`, `describeFailure`
//    and `shouldSkipBackendRpcLog` are the shipped implementations — they are the
//    thing under test. Only `logError` (the network call) and `supabase` (the
//    database) are stubbed. The MutationCache handler mirrors App.tsx's; the
//    census file pins App.tsx's text so the mirror cannot drift unnoticed.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query';

const logErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/errorLogger', async (importActual) => {
  const actual = await importActual<typeof import('../lib/errorLogger')>();
  return { ...actual, logError: logErrorMock };
});

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: () => {
      throw new Error('this test only exercises the RPC path');
    },
  },
}));

import {
  messageOf,
  shouldSkipBackendRpcLog,
} from '../lib/errorLogger';
import {
  describeFailure,
  mutationErrorContext,
} from '../lib/mutationErrorContext';
import { useAuthStore } from '../stores/authStore';
import { useSetProjectCancel, useSetProjectHold } from '../hooks/useProjectHolds';

/** App.tsx's mutationCache.onError, minus the save-failure banner. */
function makeClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (err, vars, _ctx, mutation) => {
        const key = mutation.options.mutationKey;
        if (shouldSkipBackendRpcLog(err, key)) return;
        const wrote = mutationErrorContext(key, mutation.options.meta, vars, err);
        void logErrorMock({
          source: 'backend_rpc',
          level: 'error',
          message: describeFailure(messageOf(err), { operation: wrote.write }),
          context: { kind: 'mutation', ...wrote },
        });
      },
    }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** The reports that would land in Error Triage from the write path. */
function backendRows() {
  return logErrorMock.mock.calls
    .map((c) => c[0])
    .filter((a) => a?.source === 'backend_rpc');
}

beforeEach(() => {
  logErrorMock.mockReset();
  rpcMock.mockReset();
  useAuthStore.setState({ activeTenantId: 'tenant-1' });
});

describe('fix-604 — a failed cancel names itself in Error Triage', () => {
  it('★★★ exactly one backend_rpc report, carrying write=bp_set_project_cancel', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table project_holds', code: '42501' },
    });

    const client = makeClient();
    const { result } = renderHook(() => useSetProjectCancel(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ projectId: 'p-1', reason: 'Builder pulled out' });
    });
    await waitFor(() => expect(backendRows().length).toBe(1));

    const row = backendRows()[0];
    // ★★★ THE FIELD THAT WAS MISSING FROM 83 PROD ROWS.
    expect(row.context.write).toBe('bp_set_project_cancel');
    expect(row.context.kind).toBe('mutation');
    // ★★ fix-592 §C: and the operation is in the MESSAGE too, because the triage
    //    list shows `message` and nothing else.
    expect(row.message).toBe(
      'permission denied for table project_holds — bp_set_project_cancel',
    );
    expect(row.level).toBe('error');
  });

  it('★★ the toast path logs as well — two sources, one incident', async () => {
    // ★★★ NOT A DEFECT, AND NOT INTRODUCED HERE: the hook's own `onError` calls
    //     pushToast(…, 'error'), which logs with source `frontend_toast`, while
    //     the MutationCache logs with `backend_rpc`. fix-87 accepted this
    //     deliberately — *"fingerprint dedupes on the server side, so duplicate
    //     logs are cheap"*. It is asserted so that "exactly one" above is
    //     understood as one per PATH, and so a future reader does not go hunting
    //     for a double-report bug that is a documented decision.
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table project_holds', code: '42501' },
    });
    const client = makeClient();
    const { result } = renderHook(() => useSetProjectCancel(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      result.current.mutate({ projectId: 'p-1', reason: 'Builder pulled out' });
    });
    await waitFor(() => expect(backendRows().length).toBe(1));

    const sources = logErrorMock.mock.calls.map((c) => c[0]?.source).sort();
    expect(sources).toContain('backend_rpc');
    expect(sources).toContain('frontend_toast');
  });

  it('★ a DIFFERENT hook in the same file reports its OWN name', async () => {
    // ★ The 106 lines this ticket added were applied mechanically, so the thing
    //   worth proving is that they did not all end up pointing at one RPC.
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'A hold is already active', code: 'P0001' },
    });
    const client = makeClient();
    const { result } = renderHook(() => useSetProjectHold(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      result.current.mutate({ projectId: 'p-1', reason: 'Waiting on survey' });
    });
    await waitFor(() => expect(backendRows().length).toBe(1));
    expect(backendRows()[0].context.write).toBe('bp_set_project_hold');
  });

  it('★★★ a write that SUCCEEDS reports nothing', async () => {
    // The obvious half, asserted because a reporter wired into the wrong
    // lifecycle hook would pass every test above and flood triage in prod.
    rpcMock.mockResolvedValue({
      data: [{ id: 'h-1', project_id: 'p-1', hold_end: null, kind: 'cancelled' }],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useSetProjectCancel(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      result.current.mutate({ projectId: 'p-1', reason: 'Builder pulled out' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(backendRows()).toEqual([]);
  });

  it('★★ an unnamed mutation still reports — which is why 83 rows exist', async () => {
    // ★★★ THE RE-DERIVATION, EXECUTABLE. The brief's premise was that a missing
    //     `meta.write` meant NO `error_reports` row. It does not: the row is
    //     written either way, just anonymously — `{url, kind}` and nothing else,
    //     which is the shape of 83 prod rows between 2026-06-02 and 09-23.
    //
    // ★★ SO THIS TICKET DOES NOT CHANGE TRIAGE VOLUME, and that claim is pinned
    //    here rather than only asserted in prose: the before-state logs exactly
    //    as often as the after-state. What changes is whether the row can be
    //    attributed to a hook without four database queries.
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMutation({
          // deliberately no `meta` — this is how all 106 hooks looked
          mutationFn: async (): Promise<never> => {
            throw new Error('invalid input syntax for type integer: "1.015e+68"');
          },
        }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      result.current.mutate(undefined);
    });
    await waitFor(() => expect(backendRows().length).toBe(1));

    const row = backendRows()[0];
    // ★ the row EXISTS …
    expect(row.context.kind).toBe('mutation');
    // … and is anonymous, which was the actual defect
    expect(row.context.write).toBeUndefined();
    // ★★ and the message carries no operation, so prod row 696's four-query
    //    attribution problem is reproduced exactly
    expect(row.message).toBe('invalid input syntax for type integer: "1.015e+68"');
    expect(row.message).not.toContain('—');
  });
});
