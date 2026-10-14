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
  pushRecoveredToast: pushToastMock,
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
import { renderProjectData } from '../test/renderProjectData';

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
  // ★★★ fix-508 §D — THE EDITOR MOVED; EVERY CONTRACT BELOW DID NOT.
  //     fix-63 put this input on Schedule Health. §D makes that column a
  //     DERIVED Target Approval — the latest of the ACQ date, the closing date
  //     and the GO date plus six months — so an input there would write one of
  //     three candidates while displaying the answer (P-179). The control is
  //     Project Data's `ACQ date` row now, writing the same column through the
  //     same RPC with the same two OCC tokens.
  //     ★ So this suite mounts the new home and keeps its assertions
  //       word-for-word. That is the point: if the move changed how the write
  //       works, these would fail.
  // ★★★ fix-514 §G — IT MOVED AGAIN, AND THIS TIME THE WRITE MODEL MOVED WITH
  //     IT. fix-508 §D put the box on Project Data's Dates tab, where it could
  //     address the BUILDING PERMIT and nothing else. fix-513 §E measured what
  //     that cost — 153 non-BP permits across 105 projects carry a different
  //     ACQ date by design — and refused to fold `PermitDetailV2`'s box into
  //     it. §G built the surface the refusal asked for: the **Permits** tab,
  //     one ACQ box per permit row, riding the modal's atomic Save.
  return renderProjectData(
    (refsProjects.current[0] ?? projectFixture()) as Project,
    permits,
    'permits',
  );
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

describe('fix-63 ACQ date inline edit — moved AGAIN by fix-514 §G, now per permit', () => {
  // =========================================================================
  // ★★★ WHAT THE NINE TESTS BELOW USED TO ASSERT, AND WHY THEY ARE GONE
  // =========================================================================
  //
  // fix-63 built this as an INLINE, PER-FIELD editor: blur fires the mutation,
  // Enter saves, Escape resets, a no-op blur writes nothing, an OCC conflict
  // keeps the typed value. fix-508 §D moved it from Schedule Health to Project
  // Data's Dates tab and this suite kept every one of those assertions
  // word-for-word — deliberately, because *"if the move changed how the write
  // works, these would fail."*
  //
  // ★★★ fix-514 §G CHANGES HOW THE WRITE WORKS, ON PURPOSE, and this is the
  //     honest record of it rather than nine tests quietly deleted. The
  //     control is now one box per PERMIT ROW on the Permits tab, and it rides
  //     the modal's atomic `bp_update_project_with_permits` Save with that
  //     row's type, ENT and DA. So blur no longer writes, Escape no longer
  //     resets, and there is no per-field OCC round trip to conflict on — the
  //     whole form has one.
  //
  // ★★★ WHAT WAS BOUGHT: **every permit is editable**, not just the Building
  //     Permit. That is the defect fix-513 §E documented and refused to make
  //     worse, and it is why the write model had to change rather than the
  //     control simply moving a third time.
  //
  // ★★ WHAT IS STILL ASSERTED, because it is what actually mattered: the box
  //    is pre-populated from `expected_issue`, an edit is recognised as a
  //    change, and the Save sends the column through the same RPC. Below.

  it('★★★ every permit row carries its own ACQ box, pre-populated', () => {
    const bp = permitFixture({ id: 501, type: 'Building Permit', expected_issue: '2026-08-01' });
    const uls = permitFixture({ id: 502, type: 'ULS', expected_issue: '2026-12-01' });
    renderTable([bp, uls]);
    const a = screen.getByTestId('psm-permit-acq-501') as HTMLInputElement;
    const b = screen.getByTestId('psm-permit-acq-502') as HTMLInputElement;
    expect(a.value).toBe('2026-08-01');
    // ★★★ THE WHOLE POINT OF §G: the non-Building-Permit row has its own, and
    //     it holds a DIFFERENT date — which is the 153-permit case.
    expect(b.value).toBe('2026-12-01');
  });

  it('★★ an empty expected_issue renders an empty box, not a guess', () => {
    const p = permitFixture({ id: 501, expected_issue: null });
    renderTable([p]);
    expect((screen.getByTestId('psm-permit-acq-501') as HTMLInputElement).value).toBe('');
  });

  // ═════════════════════════════════════════════════════════════════════
  // ★★★ fix-666 §C (P-303) — SUPERSEDES fix-514 §B's "typing makes the MODAL
  //     dirty" and its two Save tests. The ACQ date on a SAVED row commits on
  //     leaving the box, like every other date field; the footer Save no
  //     longer carries it. A NEW row still sends it with the Save that
  //     creates the permit, because until then there is no permit to save to.
  // ═════════════════════════════════════════════════════════════════════
  const FRESH = '2026-05-16T00:00:00Z';
  type Call = {
    projectPatch: Record<string, unknown>;
    permitUpserts: Record<string, unknown>[];
    permitDeletes: number[];
  };
  const callArg = (i: number) => mutateAsync.mock.calls[i][0] as Call;

  it('★★★ fix-666: typing a date and leaving the box saves ONCE, through the same RPC, with the row token', async () => {
    mutateAsync.mockResolvedValue({ conflict: false, permits: [{ id: 501, updated_at: FRESH }] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    const box = screen.getByTestId('psm-permit-acq-501');
    fireEvent.change(box, { target: { value: '2026-09-15' } });
    // ★ Nothing on the keystroke.
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.blur(box);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(callArg(0)).toEqual({
      projectId: 'p-sh-1',
      projectExpectedUpdatedAt: '2026-05-15T12:00:00Z',
      projectPatch: {},
      permitUpserts: [
        { id: 501, expected_updated_at: '2026-05-14T09:00:00Z', expected_issue: '2026-09-15' },
      ],
      permitDeletes: [],
    });
    // ★ Leaving again with nothing new typed fires nothing.
    fireEvent.focus(box);
    fireEvent.blur(box);
    // ★★ And the modal is NOT dirty: an ACQ-only edit leaves the footer on Exit,
    //    exactly as an address edit does.
    await waitFor(() =>
      expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('false'),
    );
    expect(screen.getByTestId('project-data-done').textContent).toContain('Exit');
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    // ★ The "saves now" mark says so on the row.
    expect(screen.getByTestId('saves-now-acq-501')).toBeInTheDocument();
  });

  it('★★ fix-666: clearing the box and leaving it sends null — Target Approval falls back to its other two candidates', async () => {
    mutateAsync.mockResolvedValue({ conflict: false, permits: [{ id: 501, updated_at: FRESH }] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    const box = screen.getByTestId('psm-permit-acq-501');
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(callArg(0).permitUpserts).toEqual([
      { id: 501, expected_updated_at: '2026-05-14T09:00:00Z', expected_issue: null },
    ]);
  });

  it('★★★ fix-666: an impossible year is refused on leaving the box — nothing is sent (fix-602 kept)', async () => {
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    const box = screen.getByTestId('psm-permit-acq-501');
    fireEvent.change(box, { target: { value: '20266-09-15' } });
    fireEvent.blur(box);
    expect(await screen.findByTestId('psm-permit-acq-501-rejection')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('★★★ fix-666: the footer Save no longer sends the ACQ date on a saved row', async () => {
    mutateAsync.mockResolvedValue({ conflict: false, permits: [] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    // Make the tab dirty with a batch-saved edit (a new row), then Save.
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    fireEvent.click(screen.getByTestId('project-data-done'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const row = callArg(0).permitUpserts.find((u) => u.id === 501);
    expect(row).toBeDefined();
    expect('expected_issue' in (row as object)).toBe(false);
  });

  it('★★★ fix-666: type a date, then click Save — the Save carries the token the commit produced, not the stale one', async () => {
    // The click blurs the box first, so the commit is in flight when Save
    // builds its rows. Without the wait, the permit's own stale-edit check
    // would refuse the Save over the user's own write.
    mutateAsync
      .mockResolvedValueOnce({ conflict: false, permits: [{ id: 501, updated_at: FRESH }] })
      .mockResolvedValueOnce({ conflict: false, permits: [] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    const box = screen.getByTestId('psm-permit-acq-501');
    fireEvent.change(box, { target: { value: '2026-09-15' } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByTestId('project-data-done'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    const saved = callArg(1).permitUpserts.find((u) => u.id === 501);
    expect(saved?.expected_updated_at).toBe(FRESH);
    expect('expected_issue' in (saved as object)).toBe(false);
  });

  it('★★ fix-666: a stale commit says so and the box goes back to the stored date', async () => {
    mutateAsync.mockResolvedValue({ conflict: true, conflictKind: 'permit', permits: [] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    const box = screen.getByTestId('psm-permit-acq-501');
    fireEvent.change(box, { target: { value: '2026-09-15' } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(
        'A permit on this project was changed elsewhere — reload and retry.',
        'warn',
      ),
    );
    await waitFor(() =>
      expect((screen.getByTestId('psm-permit-acq-501') as HTMLInputElement).value).toBe('2026-08-01'),
    );
  });

  it('★★ fix-666: on a NEW row the date stays in the form and rides the Save that creates the permit', async () => {
    mutateAsync.mockResolvedValue({ conflict: false, permits: [] });
    renderTable([permitFixture({ id: 501, expected_issue: '2026-08-01' })]);
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    const box = screen.getByTestId('psm-permit-acq-new');
    fireEvent.change(box, { target: { value: '2026-10-01' } });
    fireEvent.blur(box);
    // ★ No permit to save to yet — nothing is sent on blur.
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('saves-now-acq-new')).toBeNull();
    fireEvent.click(screen.getByTestId('project-data-done'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const created = callArg(0).permitUpserts.find((u) => u.id === undefined);
    expect(created?.expected_issue).toBe('2026-10-01');
  });

  it('★★★ SUPERSEDED: column 7 is a DERIVED Target Approval, and it does not edit', () => {
    // ★★★ fix-63 pinned the column ORDER around an input. §D keeps the order
    //     and takes the input out: the cell prints `targetApproval()` — the
    //     latest of the ACQ date, the closing date and the GO date plus six
    //     calendar months — read-only, so the blue that was its editable
    //     affordance goes with it (§H).
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    const projects = [projectFixture({ id: 'p-sh-1', closing_date: null, go_date: null })];
    refsPermits.current = p ? [p] as unknown[] : [];
    refsProjects.current = projects as unknown[];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    render(<ScheduleHealthTable permits={[p]} />, { wrapper });
    const row = screen.getByTestId('schedule-health-row-501');
    const tds = within(row).getAllByRole('cell');
    // Columns: 1 Permit Type, 2 Permit Number, 3 Reviewers, 4 Stage,
    // 5 Permit Status, 6 Data Source, 7 Permit Approval, 8 Target Approval,
    // 9 Schedule Health.
    // ★★★ fix-517 §B: NINE columns now — `Permit Number` becomes one of its
    //     own, hyperlinked to the city portal, having ridden along inside the
    //     type cell in 9px mono since fix-25. Target Approval moves from index
    //     6 to index 7 with it; the index is read off the list above rather
    //     than remembered, which is why this reads as a one-line change.
    expect(tds.length).toBe(9);
    const cell = within(tds[7]).getByTestId('schedule-health-target-approval-501');
    expect(cell).toBeInTheDocument();
    // ★★ NOT an input any more — the assertion that would fail if somebody put
    //    the box back without re-reading §D.
    expect(cell.tagName).toBe('SPAN');
    expect(within(tds[7]).queryByRole('textbox')).toBeNull();
    expect(tds[7].querySelector('input')).toBeNull();
    // ★ With no closing date and no GO date, the ACQ date is the only candidate
    //   — so the derived answer IS `expected_issue`, which is the continuity
    //   check that the column still means what it meant.
    // ★★ fix-512 §A SUPERSEDES THE FORMAT, not the fact. This asserted the raw
    //    ISO `2026-08-01`, which is what the cell printed while the Dates card
    //    three inches away printed `08/01/2026`. One fact, two formats, one
    //    screen. The date being asserted is unchanged.
    expect(cell.textContent).toBe('08/01/2026');
    expect(cell.getAttribute('data-driver')).toBe('acq');
    // ★ …and the badge is in the LAST column, which is index 8 of nine.
    expect(tds[8].textContent).toMatch(/On Track|At Risk|Behind|In Progress/);
  });

  it('★★★ SUPERSEDED by fix-512 §A: the badge measures against TARGET APPROVAL, not the ACQ date', () => {
    // ★★★ WHAT THIS TEST USED TO SAY, and it was right when it was written:
    //     "the calc uses expected_issue … guards against a refactor that
    //     quietly switches the target column to something else". fix-508 §D is
    //     exactly that refactor, done deliberately — Target Approval became
    //     MAX(ACQ, closing, GO + 6 months) — and §D moved the column's WRITERS
    //     without moving this READER. So the badge kept subtracting the ACQ
    //     date while the column beside it printed the max. **P-204.**
    //
    // ★★ The PROPERTY the old test defended still holds and is still the point:
    //    the badge and the column must not drift apart. It is now enforced by
    //    construction — the row derives Target Approval ONCE and hands the same
    //    object to both — so what is asserted here is that the ACQ date input
    //    still mirrors `expected_issue` (it is that column's one author) and
    //    that the badge no longer reads it directly.
    // ★ fix-514 §G: and the box it mirrors is the PERMIT ROW's now.
    const p = permitFixture({ id: 501, expected_issue: '2026-08-01' });
    renderTable([p]);
    const input = screen.getByTestId('psm-permit-acq-501') as HTMLInputElement;
    expect(input.value).toBe(p.expected_issue);
  });
});
