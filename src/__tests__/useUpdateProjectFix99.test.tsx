import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-99: OCC auto-recovery moved into useUpdateProject's mutationFn so
// every caller inherits the same silent-first → refetch → retry-once
// behavior that fix-98 had to wire by hand in UnitDimensions.writeTypes.
//
// New default semantics (silentOnOcc undefined/false):
//   1. First attempt with the caller's expectedUpdatedAt.
//   2. If OCCConflictError: refetch the projects query, read the
//      freshest updated_at out of the cache.
//   3. If the fresh token equals the stale one (cache didn't move
//      forward), throw the original OCC → onError fires the toast.
//   4. Otherwise retry ONCE with the fresh token. Any failure from the
//      retry propagates to onError (no third attempt).
//
// silentOnOcc=true preserves the fix-98 escape hatch: no auto-retry,
// no toast — the caller is on its own.

const T = 'test-tenant-uuid';
const OLD_TOKEN = '2026-05-15T12:00:00Z';
const NEW_TOKEN = '2026-05-15T12:05:00Z';

const supabaseMock = vi.hoisted(() => {
  // Queue of sequential update responses. Each `update().select()` chain
  // pulls the next entry. Lets a single test simulate the OCC →
  // refetch → retry-success sequence without inventing a state machine.
  const updateResponses: Array<{
    data: unknown[] | null;
    error: Error | null;
  }> = [];
  const fromFn = vi.fn();
  type Builder = {
    from: (table: string) => Builder;
    update: (patch: unknown) => Builder;
    eq: (column: string, value: unknown) => Builder;
    select: (selection: string) => Promise<{
      data: unknown[] | null;
      error: Error | null;
    }>;
    upsert: () => Promise<{ data: unknown; error: Error | null }>;
  };
  const builder = {} as Builder;
  builder.from = (t: string) => {
    fromFn(t);
    return builder;
  };
  builder.update = () => builder;
  builder.eq = () => builder;
  builder.select = () => {
    // Pull the next queued response; default to OCC (0 rows) when
    // the test underflows the queue.
    const next =
      updateResponses.shift() ?? { data: [] as unknown[], error: null };
    return Promise.resolve(next);
  };
  builder.upsert = () => Promise.resolve({ data: null, error: null });
  return {
    builder,
    fromFn,
    queueResponses: (
      ...responses: Array<{ data: unknown[] | null; error: Error | null }>
    ) => {
      updateResponses.length = 0;
      updateResponses.push(...responses);
    },
  };
});

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock.builder }));
vi.mock('../stores/toastStore', () => ({ pushToast: toastMock }));

import { useUpdateProject } from '../hooks/useUpdateProject';
import { isOCCConflict } from '../lib/occ';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  supabaseMock.fromFn.mockClear();
  toastMock.mockClear();
  supabaseMock.queueResponses();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useUpdateProject — fix-99 default OCC auto-recovery', () => {
  it('first attempt OCCs, refetch finds fresh token, retry succeeds — caller observes ONE happy resolution and ZERO toasts', async () => {
    // Queue: first update returns 0 rows (OCC), second returns the
    // persisted row with a fresh updated_at.
    supabaseMock.queueResponses(
      { data: [], error: null },
      {
        data: [{ id: 'p-1', updated_at: NEW_TOKEN }],
        error: null,
      },
    );
    const { wrapper, queryClient } = setup();
    // Pre-populate the cache with a project carrying the FRESH token
    // — this is what a real refetchQueries would land in the cache
    // after the server's invalidation. Pre-population is how we model
    // the refetch landing in tests that don't stand up a fetchFn.
    queryClient.setQueryData(queryKeys.projects(T), [
      { id: 'p-1', updated_at: NEW_TOKEN },
    ]);
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let resolved: unknown = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: OLD_TOKEN,
        patch: { unit_types: [] },
        fieldLabel: 'Unit Dimensions',
      });
    });
    // Hook's onSuccess sees the retry's response. The intermediate
    // OCC never surfaced — neither onError fired nor a toast pushed.
    expect(resolved).toMatchObject({ id: 'p-1', updated_at: NEW_TOKEN });
    expect(toastMock).not.toHaveBeenCalled();
    // Two supabase calls: the OCC + the retry.
    expect(supabaseMock.fromFn).toHaveBeenCalledWith('projects');
    const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
      ([table]) => table === 'projects',
    );
    expect(projectsCalls.length).toBe(2);
  });

  it('first attempt OCCs, refetch returns SAME stale token, no retry — original OCC toasts', async () => {
    // Queue: only one OCC response. The retry, if it fired, would
    // also OCC by default-queue underflow.
    supabaseMock.queueResponses({ data: [], error: null });
    const { wrapper, queryClient } = setup();
    // Cache still has the STALE token — refreshTokenAfterOcc reads
    // it and returns null, the hook surrenders to the original OCC.
    queryClient.setQueryData(queryKeys.projects(T), [
      { id: 'p-1', updated_at: OLD_TOKEN },
    ]);
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: OLD_TOKEN,
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(isOCCConflict(caught)).toBe(true);
    // Exactly one supabase update — no retry was attempted.
    const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
      ([table]) => table === 'projects',
    );
    expect(projectsCalls.length).toBe(1);
    // onError surfaced the OCC toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toContain('modified by someone else');
    expect(toastMock.mock.calls[0][1]).toBe('warn');
  });

  it('first attempt OCCs, retry ALSO OCCs — toast fires, mutation rejects with the retry\'s OCC', async () => {
    // Queue: two OCCs in a row. Cache moves forward (fresh token
    // appears) so the retry IS attempted; the retry just happens to
    // also conflict (real concurrent edit between attempts).
    supabaseMock.queueResponses(
      { data: [], error: null },
      { data: [], error: null },
    );
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(queryKeys.projects(T), [
      { id: 'p-1', updated_at: NEW_TOKEN },
    ]);
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: OLD_TOKEN,
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(isOCCConflict(caught)).toBe(true);
    // Two supabase update attempts (OCC + retry-also-OCC).
    const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
      ([table]) => table === 'projects',
    );
    expect(projectsCalls.length).toBe(2);
    // Toast fired once on the FINAL failure — no toast leaked from
    // the intermediate (silently-swallowed) first OCC.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toContain('modified by someone else');
  });

  it('successful first attempt: hook returns the persisted row, ZERO retries, ZERO toasts', async () => {
    supabaseMock.queueResponses({
      data: [{ id: 'p-1', updated_at: NEW_TOKEN }],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let resolved: unknown = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: OLD_TOKEN,
        patch: { unit_types: [] },
        fieldLabel: 'Unit Dimensions',
      });
    });
    expect(resolved).toMatchObject({ id: 'p-1', updated_at: NEW_TOKEN });
    expect(toastMock).not.toHaveBeenCalled();
    const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
      ([table]) => table === 'projects',
    );
    expect(projectsCalls.length).toBe(1);
  });

  it('silentOnOcc=true bypasses the auto-retry entirely (caller handles recovery)', async () => {
    // Even when a fresh token IS available in the cache, the hook
    // does NOT auto-retry when silentOnOcc=true. The escape hatch
    // is preserved from fix-98 for any caller that wants to drive
    // recovery itself.
    supabaseMock.queueResponses({ data: [], error: null });
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(queryKeys.projects(T), [
      { id: 'p-1', updated_at: NEW_TOKEN },
    ]);
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: OLD_TOKEN,
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
          silentOnOcc: true,
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(isOCCConflict(caught)).toBe(true);
    // No retry attempted, no toast pushed.
    const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
      ([table]) => table === 'projects',
    );
    expect(projectsCalls.length).toBe(1);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
