import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-99 integration smoke: BuilderOwnerCell uses the standard
// useUpdateProject path with NO bespoke OCC handling. After fix-99
// promotes auto-recovery into the hook's mutationFn, the Builder
// editor should inherit the same silent-first → refetch → retry
// behavior for free. This test mocks the supabase client (not the
// hook) so the real recovery wire is exercised end-to-end, and
// verifies that a stale-token write recovers without a toast.

// fix-227: the header renders ExternalTeamEditor — mock the directory inert so
// this test's bespoke supabase mock only sees the builder write path.
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

const T = 'test-tenant-uuid';
const OLD_TOKEN = '2026-05-15T12:00:00Z';
const NEW_TOKEN = '2026-05-15T12:05:00Z';

const supabaseMock = vi.hoisted(() => {
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
  const b = {} as Builder;
  b.from = (t: string) => {
    fromFn(t);
    return b;
  };
  b.update = () => b;
  b.eq = () => b;
  b.select = () => {
    const next =
      updateResponses.shift() ?? { data: [] as unknown[], error: null };
    return Promise.resolve(next);
  };
  b.upsert = () => Promise.resolve({ data: null, error: null });
  return {
    builder: b,
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

// Inert hooks the surrounding ProjectDetailHeader components touch.
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: OLD_TOKEN,
    updated_at: OLD_TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function setup(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  supabaseMock.fromFn.mockClear();
  supabaseMock.queueResponses();
  toastMock.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('BuilderOwnerCell — fix-99 inherits hook-level OCC auto-recovery', () => {
  it('typing a builder name → blur with a stale token: the hook retries with the fresh token, the cell\'s edit lands, no toast surfaces', async () => {
    // First server response: 0 rows (OCC). Second: persisted with NEW token.
    supabaseMock.queueResponses(
      { data: [], error: null },
      {
        data: [
          {
            ...projectFixture({ builder_name: 'Boyd Lybeck' }),
            updated_at: NEW_TOKEN,
          },
        ],
        error: null,
      },
    );
    const { queryClient } = setup();
    // Pre-populate the cache with the fresh token — what a real
    // refetchQueries would deliver after the OCC.
    queryClient.setQueryData(queryKeys.projects(T), [
      projectFixture({ updated_at: NEW_TOKEN }),
    ]);

    const nameInput = screen.getByTestId('pd-builder-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Boyd Lybeck' } });
    fireEvent.blur(nameInput);

    // Two supabase update calls — the OCC + the retry. The hook ran
    // both internally; the BuilderOwnerCell only fired one mutateAsync.
    await waitFor(() => {
      const projectsCalls = supabaseMock.fromFn.mock.calls.filter(
        ([table]) => table === 'projects',
      );
      expect(projectsCalls.length).toBe(2);
    });
    // No toast: the intermediate OCC was silently absorbed, and the
    // retry succeeded.
    expect(toastMock).not.toHaveBeenCalled();
  });
});
