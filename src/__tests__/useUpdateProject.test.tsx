import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-24b: useUpdateProject — wire-shape test focused on the
// builder-catalog auto-promote follow-up. The project update half
// is unchanged from fix-3; this suite pins the new catalog upsert
// behaviour:
//   - fires when patch.builder_name has non-empty trimmed value
//   - skips when builder_name is missing / empty / whitespace
//   - uses onConflict:'name,company' + ignoreDuplicates:true so
//     existing catalog entries aren't overwritten
//   - swallows upsert failures (best-effort; project save already
//     committed)

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

describe('useUpdateProject — fix-24b builder auto-promote', () => {
  it('auto-promotes a typed builder when patch.builder_name has a non-empty trimmed value', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
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
    // The catalog upsert fired against the builders table.
    expect(mocks.upsertFn).toHaveBeenCalledTimes(1);
    const [table, payload, options] = mocks.upsertFn.mock.calls[0];
    expect(table).toBe('builders');
    expect(payload).toEqual({
      name: 'Jane Builder',
      company: 'Acme Homes',
      email: 'jane@acme.test',
      phone: '(206) 555-0100',
      tenant_id: T,
    });
    // ON CONFLICT (name, company) DO NOTHING semantics from PostgREST.
    expect(options).toMatchObject({
      onConflict: 'name,company',
      ignoreDuplicates: true,
    });
  });

  it('does NOT auto-promote when builder_name is missing from the patch', async () => {
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

  it('does NOT auto-promote when builder_name is empty / whitespace-only', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: {
          builder_name: '   ',
          builder_company: 'Should not matter',
          builder_email: '',
          builder_phone: null,
        },
      });
    });
    expect(mocks.upsertFn).not.toHaveBeenCalled();
  });

  it('passes empty company/email/phone as null (not empty string) so PostgREST sees nullable columns correctly', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: {
          builder_name: 'Solo Builder',
          builder_company: '',
          builder_email: '   ',
          builder_phone: null,
        },
      });
    });
    expect(mocks.upsertFn).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.upsertFn.mock.calls[0];
    expect(payload).toEqual({
      name: 'Solo Builder',
      company: null,
      email: null,
      phone: null,
      tenant_id: T,
    });
  });

  it('swallows the catalog upsert error (best-effort; the project save itself still succeeds)', async () => {
    mocks.setBuildersResult({
      data: null,
      error: new Error('PostgREST 23505: duplicate or RLS denied'),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    // Should NOT throw despite the catalog upsert failing.
    let resolved: unknown = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: {
          builder_name: 'Jane Builder',
          builder_company: 'Acme Homes',
        },
      });
    });
    expect(resolved).toMatchObject({ id: 'p-1' });
    expect(mocks.upsertFn).toHaveBeenCalledTimes(1);
  });

  it('skips the catalog upsert when no active tenant is set (RLS would reject it anyway)', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
        patch: {
          builder_name: 'Jane Builder',
          builder_company: 'Acme Homes',
        },
      });
    });
    // Project update still fires; catalog upsert skipped.
    expect(mocks.fromFn).toHaveBeenCalledWith('projects');
    expect(mocks.upsertFn).not.toHaveBeenCalled();
  });
});
