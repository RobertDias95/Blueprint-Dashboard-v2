import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-174: useUpdateProject must NEVER upsert into the builders catalog. The
// fix-24b auto-promote was removed — the Project Overview Builder/Owner cell
// commits each field on blur, so a partial/in-progress name got promoted on
// every intermediate blur and littered the catalog with fragments ("boy",
// "stas"). Catalog growth now happens ONLY via the form-submit RPCs
// (bp_create_project_with_permits / bp_update_project_with_permits). This suite
// pins the no-side-effect contract: a project update with builder fields fires
// the projects UPDATE and NO builders upsert.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let projectsResult: { data: unknown[] | null; error: Error | null } = {
    data: [{ id: 'p-1', updated_at: '2026-05-14T13:00:00Z' }],
    error: null,
  };
  let buildersUpsertResult: { data: unknown; error: Error | null } = {
    data: null,
    error: null,
  };
  const fromFn = vi.fn();
  const updateFn = vi.fn();
  const eqFn = vi.fn();
  const selectFn = vi.fn();
  const upsertFn = vi.fn();

  type Builder = {
    from: (table: string) => Builder;
    update: (patch: unknown) => Builder;
    eq: (column: string, value: unknown) => Builder;
    select: (selection: string) => Promise<typeof projectsResult>;
    upsert: (
      payload: unknown,
      options?: unknown,
    ) => Promise<typeof buildersUpsertResult>;
  };

  // Track which table the current chain is targeting so .upsert can be
  // routed to the builders result rather than the projects one.
  let currentTable = '';
  const builder = {} as Builder;
  builder.from = (table: string) => {
    fromFn(table);
    currentTable = table;
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
  builder.select = () => {
    selectFn();
    return Promise.resolve(projectsResult);
  };
  builder.upsert = (payload: unknown, options?: unknown) => {
    upsertFn(currentTable, payload, options);
    return Promise.resolve(buildersUpsertResult);
  };

  return {
    builder,
    fromFn,
    updateFn,
    eqFn,
    upsertFn,
    setProjectsResult: (r: { data: unknown[] | null; error: Error | null }) => {
      projectsResult = r;
    },
    setBuildersResult: (r: { data: unknown; error: Error | null }) => {
      buildersUpsertResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useUpdateProject } from '../hooks/useUpdateProject';

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
  mocks.fromFn.mockClear();
  mocks.updateFn.mockClear();
  mocks.eqFn.mockClear();
  mocks.upsertFn.mockClear();
  mocks.setProjectsResult({
    data: [{ id: 'p-1', updated_at: '2026-05-14T13:00:00Z' }],
    error: null,
  });
  mocks.setBuildersResult({ data: null, error: null });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useUpdateProject — fix-174 no builder auto-promote', () => {
  it('does NOT upsert a builder even when the patch carries full builder fields (the project update still fires)', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let resolved: unknown = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: {
          builder_name: 'Jane Builder',
          builder_company: 'Acme Homes',
          builder_email: 'jane@acme.test',
          builder_phone: '(206) 555-0100',
        },
      });
    });
    // Project save persisted…
    expect(resolved).toMatchObject({ id: 'p-1' });
    expect(mocks.fromFn).toHaveBeenCalledWith('projects');
    // …and crucially NO builders catalog write happened.
    expect(mocks.upsertFn).not.toHaveBeenCalled();
    expect(mocks.fromFn).not.toHaveBeenCalledWith('builders');
  });

  it('does NOT upsert a builder for a partial single-field builder_name commit (the per-blur fragment path)', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        // Exactly what the Project Overview Builder/Owner name field commits
        // on blur — a fragment like "boy" must NOT become a catalog row.
        patch: { builder_name: 'boy' },
        fieldLabel: 'Builder Name',
      });
    });
    expect(mocks.upsertFn).not.toHaveBeenCalled();
    // The project's own builder_name string is still saved (its own data).
    expect(mocks.updateFn).toHaveBeenCalledWith({ builder_name: 'boy' });
  });

  it('does NOT upsert for a non-builder patch (unchanged behavior)', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: { zone: 'LR2' },
      });
    });
    expect(mocks.upsertFn).not.toHaveBeenCalled();
  });
});
