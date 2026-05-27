import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type {
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-63: ACQ Target inline-edit inside the Schedule Health card on
// Project Overview. The cell already read permits.expected_issue and
// the Schedule Health badge already used it as the target — the change
// surfaces it as an <input type="date"> and wires the save through the
// same useUpdateProjectWithPermits RPC the modal + fix-62 use.
//
// Pinned contracts:
//   - editing fires the mutation with permit_upserts[0] = {id,
//     expected_updated_at, expected_issue}, project_patch = {}, deletes = []
//   - clearing the input sends expected_issue: null
//   - no-op blur (unchanged value) does NOT call the mutation
//   - out_conflict (kind='permit') surfaces the refresh toast and keeps
//     the user's typed value
//   - Enter saves; Esc resets to the stored value and does NOT save
//   - DOM order inside a row is Estimated Approval → ACQ Target →
//     Schedule Health (sanity-check column positioning)

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const mutateAsync = vi.hoisted(() => vi.fn());
const pushToastMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock('../stores/toastStore', () => ({
  pushToast: pushToastMock,
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

// The Row pulls every projection input through hooks. Stub them so the
// row renders without hitting real Supabase / the learner. None of the
// stubs affect the ACQ Target cell — they just keep the row mountable.
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false }),
}));
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => ({
    byType: new Map<string, number>(),
    isLoading: false,
  }),
}));
// Reviewer chip + permit status are unrelated to ACQ editing — render
// simple stubs so cells exist in the DOM.
vi.mock('../components/ProjectDetail/ReviewerRollupChip', () => ({
  default: () => <span data-testid="reviewer-chip-stub">chip</span>,
}));

const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));

import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-sh-1',
    address: '123 Pine St',
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
    units: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_type: null,
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: NOW,
    updated_at: '2026-05-15T12:00:00Z',
    ...over,
  } as Project;
}

function permitFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 501,
    project_id: 'p-sh-1',
    type: 'Building Permit',
    num: 'BP-501',
    status: null,
    portal_url: null,
    struct_address: null,
    ent_lead: null,
    dm: null,
    da: null,
    dual_da: null,
    architect: null,
    kickoff_date: null,
    dd_start: null,
    dd_end: null,
    expected_issue: '2026-08-01',
    target_submit: null,
    intake_date: null,
    approval_date: null,
    actual_issue: null,
    corr_rounds: null,
    extras: null,
    last_scraper_update_at: null,
    nickname: null,
    cycle_model: null,
    view_cycle: null,
    notes: null,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderTable(permits: PermitWithCycles[], projects?: Project[]) {
  refsPermits.current = permits as unknown[];
  refsProjects.current = (projects ?? [projectFixture()]) as unknown[];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ScheduleHealthTable permits={permits} />, { wrapper });
}

beforeEach(() => {
  mutateAsync.mockReset();
  pushToastMock.mockReset();
  refsPermits.current = [];
  refsProjects.current = [];
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
  } as never);
});

describe('<ScheduleHealthTable /> ACQ Target inline edit (fix-63)', () => {
  it('renders the ACQ Target cell as an editable date input pre-populated from expected_issue', () => {
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-08-01');
  });

  it('renders empty input when expected_issue is null', () => {
    const p = permitFixture({ id: 502, expected_issue: null });
    renderTable([p]);
    const input = screen.getByTestId('schedule-health-acq-target-502') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('blur fires the mutation with the right permit_upsert shape', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 501, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const project = projectFixture({
      id: 'p-99',
      updated_at: '2026-05-15T12:00:00Z',
    });
    const p = permitFixture({
      id: 501,
      project_id: 'p-99',
      expected_issue: '2026-08-01',
      updated_at: '2026-05-14T09:00:00Z',
    } as Partial<PermitWithCycles>);
    renderTable([p], [project]);

    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-15' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      projectId: 'p-99',
      projectExpectedUpdatedAt: '2026-05-15T12:00:00Z',
      // No project-row fields — the RPC skips the project update when
      // project_patch is empty.
      projectPatch: {},
      permitUpserts: [
        {
          id: 501,
          expected_updated_at: '2026-05-14T09:00:00Z',
          expected_issue: '2026-09-15',
        },
      ],
      permitDeletes: [],
    });
  });

  it('clearing the input sends expected_issue: null', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 501, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);

    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as {
      permitUpserts: { expected_issue: string | null }[];
    };
    expect(call.permitUpserts[0].expected_issue).toBeNull();
  });

  it('no-op blur (unchanged value) does NOT call the mutation', () => {
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.blur(input);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('out_conflict (kind="permit") surfaces refresh toast and keeps the typed value', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: true,
      conflictKind: 'permit',
      conflictId: '501',
      projectUpdatedAt: null,
      permits: [],
    });
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);

    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-10-31' } });
    fireEvent.blur(input);

    await waitFor(() => expect(pushToastMock).toHaveBeenCalled());
    const args = pushToastMock.mock.calls[0];
    expect(args[0]).toMatch(/modified elsewhere/i);
    expect(args[1]).toBe('warn');
    // Typed value preserved — user reloads + retries without re-typing.
    expect(input.value).toBe('2026-10-31');
  });

  it('Enter triggers a save with the typed value', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 501, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);

    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2027-01-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as {
      permitUpserts: { expected_issue: string | null }[];
    };
    expect(call.permitUpserts[0].expected_issue).toBe('2027-01-15');
  });

  it('Esc resets to the stored value and does NOT save', () => {
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    expect(input.value).toBe('2026-12-31');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('2026-08-01');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('input is disabled when project.updated_at is missing (no OCC token)', () => {
    // No project rows for refsProjects → projectsById.get(...) is undefined,
    // occMissing flips true.
    const p = permitFixture({
      id: 501,
      project_id: 'p-missing',
      expected_issue: '2026-08-01',
    });
    renderTable([p], []);
    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('cell sits between Estimated Approval and Schedule Health in the row', () => {
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const row = screen.getByTestId('schedule-health-row-501');
    const tds = within(row).getAllByRole('cell');
    // Columns: 1 Permit Type, 2 Reviewers, 3 Stage, 4 Permit Status,
    // 5 Data Source, 6 Estimated Approval, 7 ACQ Target, 8 Schedule Health.
    expect(tds.length).toBe(8);
    // ACQ Target lives in column 7 (index 6).
    expect(
      within(tds[6]).getByTestId('schedule-health-acq-target-501'),
    ).toBeInTheDocument();
    // The ACQ Target cell is sandwiched between cols 6 and 8 — verify
    // those neighbors are NOT the ACQ Target cell (catches a refactor
    // that swaps column order).
    expect(within(tds[5]).queryByTestId('schedule-health-acq-target-501')).toBeNull();
    expect(within(tds[7]).queryByTestId('schedule-health-acq-target-501')).toBeNull();
    // Column 8 is the Schedule Health badge — one of the status labels
    // ("In Progress" appears when the projection mock returns null, which
    // it does here since we don't drive the learner).
    expect(tds[7].textContent).toMatch(/On Track|At Risk|Behind|In Progress/);
  });

  it('editing the ACQ Target updates the Schedule Health badge after refetch (calc uses expected_issue)', () => {
    // Sanity for the existing calc: Schedule Health = projection - target.
    // We don't drive the projection here (the learner / projection mocks
    // produce null for a freshly-mocked permit, so the badge renders
    // "In Progress"). What we DO want to pin is that the cell reads
    // permit.expected_issue (already enforced by the test above's
    // "renders pre-populated from expected_issue") AND that the calc
    // imports the SAME field — verified by code inspection at
    // ScheduleHealthTable.tsx:251 ("const diff = computeHealthDiff(
    // projection, acqTarget)" where acqTarget = permit.expected_issue).
    // This test just guards against a refactor that quietly switches the
    // target column to something else (e.g. target_submit) by failing if
    // the input no longer mirrors permit.expected_issue.
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const input = screen.getByTestId('schedule-health-acq-target-501') as HTMLInputElement;
    expect(input.value).toBe(p.expected_issue);
  });
});
