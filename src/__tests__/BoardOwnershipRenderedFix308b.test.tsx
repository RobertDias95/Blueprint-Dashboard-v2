import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UNOWNED_LABEL } from '../lib/boardOwnership';

// fix-308b (register #44, #45, #47) — wire up the half of fix-308 nobody can see.
//
// ★★ I FLAGGED THIS GAP MYSELF AND IT WAS REAL. Verified on origin/main before
// writing a line, with the actual export names rather than the brief's
// approximations:
//
//   src/lib/boardOwnership.ts -> imported ONCE, in MyBoard.tsx, for
//   buildHandedOff only. UNOWNED_LABEL, taskOwnership, unownedSurfacesTo,
//   milestoneStateLabel, milestoneWhyYours, daQueueAllows, usesDaQueueShape and
//   byWorstFirst had ZERO non-test consumers.
//
// ★ A tested function with no caller is not a feature, and this codebase has
// now shipped that shape six times.
//
// ★★ SO EVERY ASSERTION IN THIS FILE IS ON RENDERED OUTPUT. The domain
// functions already have unit tests in BoardOwnershipFix308.test.ts;
// duplicating them here would prove nothing about what a person sees. These
// render the component and read the screen.

const state = vi.hoisted(() => ({
  permits: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
  members: [] as unknown[],
  name: 'Miles' as string | null,
  userId: 'user-1',
}));

// ★ fix-365: the design-manager lens. It reads dm_da_groups + the roster, and
// these suites render the board without a QueryClient by design — so it is
// mocked inert here. `hasAssociates: false` is also the state 25 of the 29
// logins are in, so this is the ordinary board, unchanged.
vi.mock('../hooks/useBoardLens', () => ({
  useBoardLens: () => ({
    associates: [],
    hasAssociates: false,
    lens: { mode: 'off', focus: null },
    setLens: vi.fn(),
    unmanaged: [],
  }),
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({
      session: { user: { id: state.userId } },
      user: { id: state.userId, email: 'x@test' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: state.permits, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: state.members, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], scope: 'permit' },
    userId: state.userId,
    isLoading: false,
  }),
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: state.name, roles: [], scope: 'permit' },
  }),
}));
vi.mock('../hooks/useTaskOwnership', () => ({
  useTaskOwnership: () => ({ matches: () => true }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({ useScraperActivity: () => ({ data: [] }) }));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: [] }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useDaTeamRouting', () => ({ useDaTeamRouting: () => ({ data: [] }) }));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({ confirm: vi.fn(), pendingId: null, isPending: false }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [] }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: state.tasks, isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: () => <div data-testid="stub-editor" />,
}));

import MyBoard from '../pages/MyBoard';
import { MineTasks } from '../pages/MyTasks';

let pid = 0;
let tid = 0;

function mkPermit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    target_submit: null,
    approval_date: null,
    actual_issue: null,
    intake_date: null,
    dd_start: null,
    dd_end: null,
    parent_permit_id: null,
    updated_at: '2026-08-10T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function mkTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '3921 43rd Ave S',
    permit_type: 'Demolition',
    bucket: 'de',
    text: 'Waiting on min risk statement',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    primary_assignee: null,
    co_assignees: [],
    discipline: 'ent',
    status: 'Open',
    ...over,
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pid = 0;
  tid = 0;
  state.permits = [];
  state.projects = [{ id: 'p1', address: '3921 43rd Ave S' }];
  state.tasks = [];
  state.members = [];
  state.name = 'Miles';
  state.userId = 'user-1';
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// ★ #44 — rendered
// ---------------------------------------------------------------------------

describe('fix-308b #44: an unassigned task SAYS it needs an owner', () => {
  it('★★ renders the label in the task list', () => {
    state.tasks = [mkTask({ id: 't-unowned', text: 'Waiting on min risk statement' })];
    wrap(<MineTasks />);
    const chip = screen.getByTestId('mytask-card-t-unowned-needs-owner');
    expect(chip.textContent).toBe(UNOWNED_LABEL);
    expect(chip.textContent).toMatch(/needs an owner/i);
  });

  // ★ THE POINT OF fix-308, re-asserted through the UI. Attributing unowned
  // work to permits.da is what produced "blocked by Cam" on a permit where Cam
  // had no task.
  it('★★ and NEVER names the DA anywhere in that row', () => {
    state.permits = [mkPermit({ id: 1, da: 'Cam', ent_lead: 'Miles' })];
    state.tasks = [mkTask({ id: 't-unowned', permit_id: 1 })];
    wrap(<MineTasks />);
    const card = screen
      .getByTestId('mytask-card-t-unowned-needs-owner')
      .closest('[data-testid^="mytask-card-"]')
      ?? screen.getByTestId('mytask-card-t-unowned-needs-owner').parentElement!
        .parentElement!;
    expect(card.textContent).not.toContain('Cam');
  });

  it('an ASSIGNED task carries no such label — the chip is not decoration', () => {
    state.tasks = [
      mkTask({ id: 't-mine', primary_assignee: 'Miles' }),
      mkTask({ id: 't-co', co_assignees: ['Briana'] }),
    ];
    wrap(<MineTasks />);
    expect(screen.queryByTestId('mytask-card-t-mine-needs-owner')).toBeNull();
    // ★ A co-assignee counts as ownership — calling that ownerless would
    // manufacture a gap that is not there.
    expect(screen.queryByTestId('mytask-card-t-co-needs-owner')).toBeNull();
  });

  it('★ a RESOLVED unowned task is not nagged about — only live work needs an owner', () => {
    state.tasks = [mkTask({ id: 't-done', status: 'Resolved' })];
    wrap(<MineTasks />);
    expect(screen.queryByTestId('mytask-card-t-done-needs-owner')).toBeNull();
  });

  it('★ and it is NOT hidden — the task still renders, gap and all', () => {
    state.tasks = [mkTask({ id: 't-unowned', text: 'Waiting on min risk statement' })];
    wrap(<MineTasks />);
    expect(screen.getByTestId('mytask-card-t-unowned-text').textContent).toBe(
      'Waiting on min risk statement',
    );
  });
});

// ---------------------------------------------------------------------------
// ★ #45 — rendered
// ---------------------------------------------------------------------------

describe('fix-308b #45: a milestone row states what, why and when', () => {
  function pastDueMilestone() {
    state.name = 'Miles';
    state.permits = [
      mkPermit({ id: 1, da: null, ent_lead: 'Miles', target_submit: '2026-03-01' }),
    ];
  }

  it('★★ renders the STATE, the ACTION and WHY IT IS YOURS', () => {
    pastDueMilestone();
    wrap(<MyBoard />);
    const states = screen.getAllByTestId(/^board-row-state-/);
    const actions = screen.getAllByTestId(/^board-row-action-/);
    const whys = screen.getAllByTestId(/^board-row-why-/);
    expect(states.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
    expect(whys.length).toBeGreaterThan(0);

    expect(states[0]!.textContent).toBe('Past due');
    expect(actions[0]!.textContent!.length).toBeGreaterThan(0);
    // ★ WHY is a ROLE — the new part, and the thing a person needs when a row
    // they have never seen appears.
    expect(whys[0]!.textContent).toMatch(/entitlement lead/i);
  });

  it('★ and it stays SHORT — #22\'s verbiage cut is not undone', () => {
    pastDueMilestone();
    wrap(<MyBoard />);
    for (const el of screen.getAllByTestId(/^board-row-why-/)) {
      expect((el.textContent ?? '').length).toBeLessThan(60);
    }
    for (const el of screen.getAllByTestId(/^board-row-state-/)) {
      expect((el.textContent ?? '').length).toBeLessThan(12);
    }
  });

  it('★ a DA row says the DA role instead — the answer follows the leg', () => {
    state.name = 'Cam';
    const p = mkPermit({ id: 1, da: 'Cam', ent_lead: 'Miles', target_submit: '2026-03-01' });
    state.permits = [p];
    // fix-308: a design leg exists only where design work does.
    state.tasks = [mkTask({ permit_id: 1, discipline: 'arch', status: 'Open' })];
    wrap(<MyBoard />);
    const whys = screen.getAllByTestId(/^board-row-why-/).map((e) => e.textContent ?? '');
    expect(whys.some((w) => /design associate/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★★ fix-308's guarantee, re-asserted through the UI
// ---------------------------------------------------------------------------

describe('fix-308b: the 3921 shape, through the rendered board', () => {
  /** DA Cam, ENT Miles, six ENT tasks, no arch — prod permit 165. */
  function permit3921() {
    const p = mkPermit({
      id: 1,
      type: 'Demolition',
      num: '7133443-DM',
      status: 'Corrections Required',
      da: 'Cam',
      ent_lead: 'Miles',
      target_submit: '2026-03-01',
    });
    state.permits = [p];
    state.tasks = [
      mkTask({ permit_id: 1, text: 'Resubmit to the city', assigned_to: 'Miles', primary_assignee: 'Miles' }),
      mkTask({ permit_id: 1, text: 'Waiting on min risk statement' }),
    ];
  }

  it('★★ Cam sees neither "ready to hand off" nor "blocked by" — on screen', () => {
    permit3921();
    state.name = 'Cam';
    wrap(<MyBoard />);
    // No handoff section at all.
    expect(screen.queryByTestId('board-sec-handoff-wrap')).toBeNull();
    // No forecast rows, so nothing claims to be his.
    expect(screen.queryAllByTestId(/^board-forecast-row-/)).toHaveLength(0);
    // And his queue is genuinely empty — the permit is not attributed to him
    // under any heading. (The panel's own chrome is static text; the count is
    // what says whether anything reached it.)
    const queue = screen.getByTestId('my-board-queue');
    expect(queue.textContent).toContain('0 projects');
    expect(queue.textContent).not.toContain('7133443-DM');
  });

  it('★★ Miles sees it, and it is actionable — the permit is his', () => {
    permit3921();
    state.name = 'Miles';
    wrap(<MyBoard />);
    const rows = screen.getAllByTestId(/^board-forecast-row-/);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.getAttribute('data-actionable') === 'true')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★ #47 — the DA's queue, rendered
// ---------------------------------------------------------------------------

describe('fix-308b #47: a DA\'s rendered queue is intakes and corrections only', () => {
  /** A permit whose only stateful milestone is a reviewer-silence chase —
   *  neither an intake nor a correction, so a DA must not see it. */
  function quietReview(id: number, address: string) {
    // A project id of its own — reusing p1 would collide with the default
    // fixture project and make the assertion read the wrong address.
    state.projects = [{ id: `proj-${id}`, address }];
    return mkPermit({
      id,
      project_id: `proj-${id}`,
      da: 'Cam',
      ent_lead: 'Miles',
      status: 'In Review',
      permit_cycles: [
        {
          id: `c${id}`,
          permit_id: id,
          cycle_index: 1,
          submitted: '2026-01-02',
          intake_accepted: '2026-01-05',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ],
    });
  }

  it("★★ a permit in plain review does not reach the DA's queue GROUPS", () => {
    const p = quietReview(1, 'Quiet St');
    state.permits = [p];
    // A design leg, so fix-308 is not what removes it — the #47 filter is.
    state.tasks = [mkTask({ permit_id: 1, discipline: 'arch', status: 'Open' })];
    state.name = 'Cam';
    wrap(<MyBoard />);
    // Zero projects across all three groups — "blocked on you", "waiting on
    // design" and "waiting on the city". The last needed its own gate: it is
    // reached by a fallback that skips the milestone loop entirely, and only
    // the RENDERED test caught that. The domain unit tests could not have.
    const queue = screen.getByTestId('my-board-queue');
    expect(queue.textContent).toContain('0 projects');
  });

  // ★ A BOUNDARY I AM STATING RATHER THAN CROSSING. fix-305's "Did this
  // happen?" ageing section shares the queue PANEL but is not the queue — it is
  // the time-in-state ladder that caught 4000 SW Concord (94 days in Ready for
  // Intake, touched four days ago). It still surfaces a plain-review permit to
  // a DA.
  //
  // #47 governs "a DA's queue", and buildQueue IS the queue. Silencing another
  // feature's section for DAs would re-hide exactly what fix-305 exists to
  // surface, and that is Bobby's call rather than mine. Asserted here so the
  // behaviour is visible and deliberate instead of accidental — flagged in the
  // PR for a decision.
  it("★ fix-305's ageing section still shows it — stated, not silently changed", () => {
    const p = quietReview(1, 'Quiet St');
    state.permits = [p];
    state.tasks = [mkTask({ permit_id: 1, discipline: 'arch', status: 'Open' })];
    state.name = 'Cam';
    wrap(<MyBoard />);
    const queue = screen.getByTestId('my-board-queue');
    expect(queue.textContent).toContain('Did this happen?');
    expect(queue.textContent).toContain('Quiet St');
  });

  it('★★ but the ENT lead still sees it — the DA shape is DA-only', () => {
    const p = quietReview(1, 'Quiet St');
    state.permits = [p];
    state.tasks = [mkTask({ permit_id: 1, discipline: 'arch', status: 'Open' })];
    state.name = 'Miles';
    wrap(<MyBoard />);
    const queue = screen.getByTestId('my-board-queue');
    // ★ 1 project reaches his QUEUE — the filter is DA-shaped only.
    expect(queue.textContent).toContain('1 project');
    expect(queue.textContent).toContain('Quiet St');
  });

  it('★ a CORRECTIONS permit does reach the DA\'s queue — the filter is not a blanket', () => {
    state.projects = [{ id: 'p9', address: 'Corrections Way' }];
    const p = mkPermit({
      id: 9,
      project_id: 'p9',
      da: 'Cam',
      ent_lead: 'Miles',
      status: 'Corrections Required',
      permit_cycles: [
        {
          id: 'c9',
          permit_id: 9,
          cycle_index: 1,
          submitted: '2026-01-02',
          intake_accepted: '2026-01-05',
          city_target: null,
          corr_issued: '2026-06-01',
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    state.permits = [p];
    state.tasks = [mkTask({ permit_id: 9, discipline: 'arch', status: 'Open' })];
    state.name = 'Cam';
    wrap(<MyBoard />);
    expect(screen.getByTestId('my-board-queue').textContent).toContain('Corrections Way');
  });
});
