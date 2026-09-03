import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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

// fix-285: the header now also renders the Notes panel and the Design Plan of
// Record card. Both issue their own reads, which would consume this file's
// QUEUED supabase responses and starve the OCC retry of the one it needs.
// Stubbed for the same reason fix-227 stubbed the directory above: the subject
// here is BuilderOwnerCell's write path, and the assertion below is unchanged.
vi.mock('../components/ProjectDetail/NotesPanel', () => ({
  default: () => <div data-testid="stub-notes-panel" />,
}));
vi.mock('../components/ProjectDetail/PlanOfRecordCard', () => ({
  default: () => <div data-testid="stub-plan-of-record-card" />,
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

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));


import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

// ★★★ fix-475 (P-116) — BUILDER/OWNER IS BEHIND A DISCLOSURE NOW.
//
// Its own Overview column became CONSULTANTS; the card itself moved into the
// Team card as its top section, collapsed to Owner + Business with an
// `Expand ⌄` control (Bobby: *"Owner + Business visible, click to expand to the
// full card."*).
//
// ★★ SO EVERY TEST BELOW THAT READS THE CARD'S FIELDS OPENS IT FIRST, and that
// is the ONLY change to them. Not one assertion about what the card does was
// touched — the picker still writes the same patch, the OCC retry still
// recovers, the cached fields are still read-only. What moved is where the card
// lives, so what moved in the tests is one click before the reads.
function openBuilderCard() {
  fireEvent.click(screen.getByTestId('pd-builder-disclose'));
}


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
    lot_size_sf: null,
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
    <QueryClientProvider client={queryClient}>
      {/* ★ fix-362: the Team card reads `?msg=` / `?chat=` from the URL now
          — a chat notification lands on the message, and §2's rule is that
          the deep-link state lives in the URL and nowhere else. So this
          header needs a router, where before it needed none. */}
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
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
    // ★★★ fix-475: THE QUEUE IS FILLED AFTER THE CARD IS ON SCREEN.
    //
    //     Builder/Owner is behind Team's disclosure now, so it MOUNTS on the
    //     click rather than on render — and mounting issues a `projects` read
    //     through the same mock, whose `.select()` SHIFTS the queue. Queued
    //     before the click, the mount ate the OCC response and the retry never
    //     happened: "expected 1 to be 2", three files from the cause.
    //
    // ★ Nothing about what this test proves changed. It is still
    //   `useUpdateProject`'s OCC retry, still fired by the clear button.
    const { queryClient } = setup({ builder_name: 'Boyd Lybeck' });
    openBuilderCard();

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
    // Pre-populate the cache with the fresh token — what a real
    // refetchQueries would deliver after the OCC.
    queryClient.setQueryData(queryKeys.projects(T), [
      projectFixture({ updated_at: NEW_TOKEN }),
    ]);

    // ★★ fix-448 re-points the TRIGGER, not the claim. This test is about
    //    `useUpdateProject`'s OCC retry; the cell is only what fires it. Typing
    //    a name no longer writes anything (the cell is pick-only now — P-082),
    //    so the write is fired by the clear button, which is a real builder
    //    write on this card and goes through the same hook with the same token.
    fireEvent.click(screen.getByTestId('pd-builder-name-clear'));

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
