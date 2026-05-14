import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles } from '../lib/database.types';

const T = 'test-tenant-uuid';

// Q3: useUpdatePermit — wire-shape test. Asserts the hook fires the right
// .from/.update/.eq chain with OCC token, applies optimistic state, rolls
// back on error, and surfaces conflict/error toasts via the store.

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown[] | null; error: Error | null } = {
    data: [],
    error: null,
  };
  const fromFn = vi.fn();
  const updateFn = vi.fn();
  const eqFn = vi.fn();
  const selectFn = vi.fn();

  type Builder = {
    from: (table: string) => Builder;
    update: (patch: unknown) => Builder;
    eq: (column: string, value: unknown) => Builder;
    select: (selection: string) => Promise<typeof resolveResult>;
  };

  const builder = {} as Builder;
  builder.from = (table: string) => {
    fromFn(table);
    return builder;
  };
  builder.update = (patch: unknown) => {
    updateFn(patch);
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    eqFn(column, value);
    return builder;
  };
  builder.select = (selection: string) => {
    selectFn(selection);
    return Promise.resolve(resolveResult);
  };

  return {
    builder,
    fromFn,
    updateFn,
    eqFn,
    selectFn,
    setResult: (r: { data: unknown[] | null; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useUpdatePermit } from '../hooks/useUpdatePermit';

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 7,
    project_id: 'proj-1',
    type: 'BP',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: 'Trevor',
    dm: 'Brittani',
    ent_lead: 'Bobby',
    dual_da: null,
    target_submit: '2026-01-15',
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-08T10:00:00.000Z',
    permit_cycles: [],
    ...over,
  };
}

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useUpdatePermit', () => {
  beforeEach(() => {
    mocks.fromFn.mockClear();
    mocks.updateFn.mockClear();
    mocks.eqFn.mockClear();
    mocks.selectFn.mockClear();
    useToastStore.getState().clear();
    // Q5.5.D: hooks read activeTenantId from authStore. Seed it so the
    // mutation builds query keys correctly.
    useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  });

  it('fires UPDATE with the OCC token (id + updated_at eq filters)', async () => {
    const permit = makePermit();
    const updated = { ...permit, target_submit: '2026-02-01', updated_at: '2026-05-08T10:01:00.000Z' };
    mocks.setResult({ data: [updated], error: null });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [permit]);

    const { result } = renderHook(() => useUpdatePermit(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        permitId: 7,
        projectId: 'proj-1',
        expectedUpdatedAt: '2026-05-08T10:00:00.000Z',
        patch: { target_submit: '2026-02-01' },
        fieldLabel: 'Target Submit',
      });
    });

    expect(mocks.fromFn).toHaveBeenCalledWith('permits');
    expect(mocks.updateFn).toHaveBeenCalledWith({ target_submit: '2026-02-01' });
    expect(mocks.eqFn).toHaveBeenCalledWith('id', 7);
    expect(mocks.eqFn).toHaveBeenCalledWith(
      'updated_at',
      '2026-05-08T10:00:00.000Z',
    );
    expect(mocks.selectFn).toHaveBeenCalledWith('*, permit_cycles(*)');
  });

  it('applies optimistic update to both query caches', async () => {
    const permit = makePermit();
    mocks.setResult({
      data: [{ ...permit, da: 'Ainsley', updated_at: '2026-05-08T10:01:00.000Z' }],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [permit]);

    const { result } = renderHook(() => useUpdatePermit(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        permitId: 7,
        projectId: 'proj-1',
        expectedUpdatedAt: '2026-05-08T10:00:00.000Z',
        patch: { da: 'Ainsley' },
      });
    });

    const global = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    const byProject = queryClient.getQueryData<PermitWithCycles[]>(
      queryKeys.permitsByProject(T, 'proj-1'),
    );
    expect(global?.[0].da).toBe('Ainsley');
    expect(byProject?.[0].da).toBe('Ainsley');
  });

  it('rolls back the optimistic update + emits warn toast on OCC mismatch (empty result)', async () => {
    const permit = makePermit();
    // Empty data array = OCC mismatch — server didn't find a row matching
    // both id AND the expected updated_at.
    mocks.setResult({ data: [], error: null });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [permit]);

    const { result } = renderHook(() => useUpdatePermit(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          permitId: 7,
          projectId: 'proj-1',
          expectedUpdatedAt: '2026-05-08T10:00:00.000Z',
          patch: { target_submit: '2099-01-01' },
          fieldLabel: 'Target Submit',
        }),
      ).rejects.toThrow(/Target Submit was modified/i);
    });

    // Cache rolled back to original value.
    const global = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    expect(global?.[0].target_submit).toBe('2026-01-15');

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.find((t) => t.kind === 'warn')).toBeTruthy();
    });
  });

  it('rolls back + emits error toast on network/SQL error', async () => {
    const permit = makePermit();
    mocks.setResult({
      data: null,
      error: new Error('connection refused'),
    });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [permit]);

    const { result } = renderHook(() => useUpdatePermit(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          permitId: 7,
          projectId: 'proj-1',
          expectedUpdatedAt: '2026-05-08T10:00:00.000Z',
          patch: { da: 'Cam' },
          fieldLabel: 'DA',
        }),
      ).rejects.toThrow(/connection refused/i);
    });

    const global = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    expect(global?.[0].da).toBe('Trevor');

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      const err = toasts.find((t) => t.kind === 'error');
      expect(err).toBeTruthy();
      expect(err?.message).toMatch(/connection refused/i);
    });
  });

  it('only mutates the targeted permit — sibling permits in the cache are untouched', async () => {
    const target = makePermit({ id: 7, da: 'Trevor' });
    const sibling = makePermit({ id: 8, da: 'Nicky' });
    mocks.setResult({
      data: [{ ...target, da: 'Ahmadi', updated_at: '2026-05-08T10:01:00.000Z' }],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.permits(T), [target, sibling]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [target, sibling]);

    const { result } = renderHook(() => useUpdatePermit(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        permitId: 7,
        projectId: 'proj-1',
        expectedUpdatedAt: '2026-05-08T10:00:00.000Z',
        patch: { da: 'Ahmadi' },
      });
    });

    const global = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    const byId = new Map(global?.map((p) => [p.id, p]));
    expect(byId.get(7)?.da).toBe('Ahmadi');
    expect(byId.get(8)?.da).toBe('Nicky'); // untouched
  });
});
