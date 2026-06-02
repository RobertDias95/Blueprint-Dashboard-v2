import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-98: useUpdateProject's silentOnOcc flag suppresses the
// "modified by someone else" toast on OCCConflictError so the caller
// can attempt an auto-recovery without flashing a transient error at
// the user. Rollback + invalidate still fire — the flag ONLY gates the
// toast.

const T = 'test-tenant-uuid';

const supabaseMock = vi.hoisted(() => {
  let updateResult: { data: unknown[] | null; error: Error | null } = {
    data: [{ id: 'p-1', updated_at: '2026-05-14T13:00:00Z' }],
    error: null,
  };
  const fromFn = vi.fn();
  type Builder = {
    from: (table: string) => Builder;
    update: (patch: unknown) => Builder;
    eq: (column: string, value: unknown) => Builder;
    select: (selection: string) => Promise<typeof updateResult>;
    upsert: () => Promise<{ data: unknown; error: Error | null }>;
  };
  const builder = {} as Builder;
  builder.from = (t: string) => {
    fromFn(t);
    return builder;
  };
  builder.update = () => builder;
  builder.eq = () => builder;
  builder.select = () => Promise.resolve(updateResult);
  builder.upsert = () => Promise.resolve({ data: null, error: null });
  return {
    builder,
    fromFn,
    setUpdateResult: (
      r: { data: unknown[] | null; error: Error | null },
    ) => {
      updateResult = r;
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  supabaseMock.fromFn.mockClear();
  toastMock.mockClear();
  supabaseMock.setUpdateResult({
    data: [{ id: 'p-1', updated_at: '2026-05-14T13:00:00Z' }],
    error: null,
  });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useUpdateProject — fix-98 silentOnOcc flag', () => {
  it('default behavior: OCC pushes the "modified by someone else" toast', async () => {
    // Server matched 0 rows → OCCConflictError thrown by mutationFn.
    supabaseMock.setUpdateResult({ data: [], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: '2026-05-14T12:00:00Z',
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
        });
      } catch {
        /* OCC error is expected */
      }
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toContain(
      'modified by someone else',
    );
    expect(toastMock.mock.calls[0][1]).toBe('warn');
  });

  it('silentOnOcc=true: OCC throws and rolls back, but does NOT push the toast', async () => {
    supabaseMock.setUpdateResult({ data: [], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: '2026-05-14T12:00:00Z',
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
          silentOnOcc: true,
        });
      } catch (err) {
        caught = err;
      }
    });
    // The error still propagates so the caller can do its own recovery.
    expect(isOCCConflict(caught)).toBe(true);
    // No toast — the caller will handle messaging if the retry fails.
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('silentOnOcc=true still surfaces NON-OCC errors via toast', async () => {
    // A wire error from supabase — generic, not an OCC mismatch.
    supabaseMock.setUpdateResult({
      data: null,
      error: new Error('PostgREST 500: internal server error'),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: '2026-05-14T12:00:00Z',
          patch: { unit_types: [] },
          fieldLabel: 'Unit Dimensions',
          silentOnOcc: true,
        });
      } catch {
        /* swallowed */
      }
    });
    // silentOnOcc ONLY suppresses the OCC toast — generic errors still
    // get the "Could not save project — …" path.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toContain('Could not save project');
    expect(toastMock.mock.calls[0][1]).toBe('error');
  });

  it('successful save: silentOnOcc has no observable effect (no toast, success path runs)', async () => {
    supabaseMock.setUpdateResult({
      data: [{ id: 'p-1', updated_at: '2026-05-14T13:30:00Z' }],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let resolved: unknown = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: { unit_types: [{ label: 'A', width_ft: 40, depth_ft: 60, qty: 1 }] },
        silentOnOcc: true,
      });
    });
    expect(resolved).toMatchObject({
      id: 'p-1',
      updated_at: '2026-05-14T13:30:00Z',
    });
    expect(toastMock).not.toHaveBeenCalled();
  });
});
