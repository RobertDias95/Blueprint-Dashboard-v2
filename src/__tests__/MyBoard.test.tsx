import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-298 Phase 1 — what the board RENDERS.
//
// The domain rules live in myBoard.test.ts; this file asserts the things that
// only exist in the DOM: that a "waiting" row has NO checkbox, that a capped
// section still prints its true total, that the page itself cannot scroll, and
// that the suppression counts render even at zero.

const state = vi.hoisted(() => ({
  permits: [] as PermitWithCycles[],
  projects: [] as Project[],
  tasks: [] as unknown[],
  members: [] as unknown[],
  name: 'Miles' as string | null,
  activity: [] as unknown[],
  acks: [] as unknown[],
  dmRows: [] as unknown[],
  ackMutate: vi.fn(),
  taskMutate: vi.fn(),
  confirmHandoff: vi.fn(),
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: state.permits, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: state.members, isLoading: false }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], scope: 'permit' },
    userId: 'u1',
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: state.activity }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: state.acks }),
  useAckMilestone: () => ({ mutate: state.ackMutate, isPending: false }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  // fix-303: the board reads tasks from the SAME hook My Tasks uses.
  useAllTasks: () => ({ data: state.tasks, isLoading: false }),
  useUpsertTask: () => ({ mutate: state.taskMutate, mutateAsync: state.taskMutate, isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: state.dmRows }),
}));
// The real editor is exercised by MyTasks' own tests; here we only need to know
// the board opens THE SAME component rather than growing its own.
vi.mock('../components/TaskDetailEditor', () => ({
  default: ({ task }: { task: { id: string } }) => (
    <div data-testid="stub-task-detail-editor" data-task={task.id} />
  ),
}));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({
    confirm: state.confirmHandoff,
    pendingId: null,
    isPending: false,
  }),
}));

import MyBoard from '../pages/MyBoard';
import BoardBell from '../components/BoardBell';

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
    stage: null,
    stage_override: null,
    da: 'Fisk',
    dm: null,
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
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
    updated_at: '2026-08-01T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

function renderBoard() {
  return render(
    <MemoryRouter>
      <MyBoard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pid = 0;
  state.permits = [];
  state.projects = [mkProject('p1', '3626 164th Pl SE')];
  state.tasks = [];
  state.members = [];
  state.name = 'Miles';
  state.activity = [];
  state.acks = [];
  state.dmRows = [];
  state.ackMutate.mockClear();
  state.taskMutate.mockClear();
  state.confirmHandoff.mockClear();
});

describe('fix-298: ★ "waiting on the other half" renders with NO checkbox', () => {
  it('the entitlement lead sees the row, greyed, with no control to tick', () => {
    // Corrections with the design half still in progress: Miles can SEE it
    // sitting with Fisk without being asked to act. The whole distinction
    // rests on not being asked, so the checkbox must be ABSENT — not disabled.
    state.permits = [
      mkPermit({
        da: 'Fisk',
        ent_lead: 'Miles',
        // A dated milestone so it reaches the forecast at all.
        target_submit: '2026-03-26',
        status: 'Corrections Required',
      }),
    ];
    renderBoard();
    const rows = screen.getAllByTestId(/^board-forecast-row-/);
    const waiting = rows.filter(
      (r) => r.getAttribute('data-actionable') === 'false',
    );
    expect(waiting.length).toBeGreaterThan(0);
    for (const row of waiting) {
      expect(within(row).queryByTestId(/^board-forecast-check-/)).toBeNull();
    }
  });

  it('a row that IS mine renders the checkbox', () => {
    state.name = 'Fisk';
    state.permits = [
      mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-03-26' }),
    ];
    renderBoard();
    const rows = screen.getAllByTestId(/^board-forecast-row-/);
    const mine = rows.filter((r) => r.getAttribute('data-actionable') === 'true');
    expect(mine.length).toBeGreaterThan(0);
    expect(within(mine[0]!).getByTestId(/^board-forecast-check-/)).toBeTruthy();
  });

  it('★ a one-leg permit shows the DA no design half at all — the row is absent', () => {
    // Not greyed: absent. There is no design leg to wait on.
    state.name = 'Fisk';
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', target_submit: '2026-03-26' }),
    ];
    renderBoard();
    expect(screen.queryAllByTestId(/^board-forecast-row-/)).toHaveLength(0);
  });
});

describe('fix-298: ★ the board does not grow with the workload', () => {
  it('the page is a fixed height and never scrolls itself', () => {
    renderBoard();
    const board = screen.getByTestId('my-board');
    expect(board.style.height).toBe('calc(100vh - 52px)');
    // Each panel owns its own scroll, so the page cannot grow.
    expect(screen.getByTestId('my-board-forecast-scroll').className).toContain(
      'overflow-y-auto',
    );
    expect(screen.getByTestId('my-board-queue-scroll').className).toContain(
      'overflow-y-auto',
    );
  });

  it('★ a capped section still prints its TRUE total, and offers to show all', () => {
    // 20 past-due items, cap 5. Miles must see "20" without expanding anything.
    state.projects = Array.from({ length: 20 }, (_, i) => mkProject(`p${i}`, `${i} St`));
    state.permits = Array.from({ length: 20 }, (_, i) =>
      mkPermit({ project_id: `p${i}`, da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    );
    renderBoard();
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('20');
    expect(screen.getByTestId('board-sec-past-due-showall').textContent).toContain(
      'Show all (20)',
    );
    expect(screen.getAllByTestId(/^board-forecast-row-/)).toHaveLength(5);
  });

  it('an uncapped section shows every row and offers no "show all"', () => {
    state.projects = [mkProject('p1', 'A St'), mkProject('p2', 'B St')];
    state.permits = [
      mkPermit({ project_id: 'p1', da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
      mkPermit({ project_id: 'p2', da: null, ent_lead: 'Miles', target_submit: '2026-01-02' }),
    ];
    renderBoard();
    expect(screen.getByTestId('board-sec-past-due-total').textContent).toContain('2');
    expect(screen.queryByTestId('board-sec-past-due-showall')).toBeNull();
  });

  it('★ Bobby and Miles get the same SHAPE — identical sections, different density', () => {
    const sections = [
      'board-sec-past-due',
      'board-sec-today',
      'board-sec-tomorrow',
      'board-sec-this-week',
      'board-sec-blocked',
      'board-sec-waiting-design',
      'board-sec-waiting-city',
    ];
    // Bobby: 4 permits.
    state.name = 'Bobby';
    state.projects = [mkProject('p1', 'A St')];
    state.permits = Array.from({ length: 4 }, () =>
      mkPermit({ da: null, ent_lead: 'Bobby', target_submit: '2026-08-01' }),
    );
    const bobby = renderBoard();
    for (const s of sections) expect(screen.getByTestId(s)).toBeTruthy();
    bobby.unmount();

    // Miles: 165 permits across 62 projects.
    state.name = 'Miles';
    state.projects = Array.from({ length: 62 }, (_, i) => mkProject(`m${i}`, `${i} Way`));
    state.permits = Array.from({ length: 165 }, (_, i) =>
      mkPermit({ project_id: `m${i % 62}`, da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    );
    renderBoard();
    for (const s of sections) expect(screen.getByTestId(s)).toBeTruthy();
    // …and no section renders more than its cap, so the height is bounded.
    expect(screen.getAllByTestId(/^board-forecast-row-/).length).toBeLessThanOrEqual(
      5 + 8 + 40,
    );
  });

  it('section headers are sticky so the count stays visible while scrolling', () => {
    renderBoard();
    expect(screen.getByTestId('board-sec-past-due').className).toContain('sticky');
  });
});

describe('fix-298: the bell', () => {
  function renderBell() {
    return render(
      <MemoryRouter>
        <BoardBell />
      </MemoryRouter>,
    );
  }

  it('★ "Open my board →" is the first thing in the dropdown', () => {
    renderBell();
    fireEvent.click(screen.getByTestId('board-bell-button'));
    const dd = screen.getByTestId('board-bell-dropdown');
    expect(dd.firstElementChild).toBe(screen.getByTestId('board-bell-open-board'));
    expect(screen.getByTestId('board-bell-open-board').getAttribute('href')).toBe('/board');
  });

  it('★ suppressed counts render even when nothing is shown', () => {
    // Zero notifications AND zero suppressions: the line still renders. This is
    // how a quiet day and a broken notifier stop looking the same.
    state.activity = [];
    renderBell();
    fireEvent.click(screen.getByTestId('board-bell-button'));
    expect(screen.getByTestId('board-bell-suppressed')).toBeTruthy();
    expect(screen.getByTestId('bell-suppressed-retries').textContent).toContain('0');
    expect(screen.getByTestId('bell-suppressed-guarded').textContent).toContain('0');
    expect(screen.getByTestId('bell-suppressed-notyours').textContent).toContain('0');
  });

  it('counts the two never-notify categories as suppressed', () => {
    state.activity = [
      { action: 'scrape_workflow_fetch_recovered', ent_lead: 'Miles' },
      { action: 'scrape_skipped_recent_manual_edit', ent_lead: 'Miles' },
    ];
    renderBell();
    fireEvent.click(screen.getByTestId('board-bell-button'));
    expect(screen.getByTestId('bell-suppressed-retries').textContent).toContain('1');
    expect(screen.getByTestId('bell-suppressed-guarded').textContent).toContain('1');
  });

  it('the badge counts what is asked of you, not what happened', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', target_submit: '2026-01-01' }),
    ];
    renderBell();
    expect(screen.getByTestId('board-bell-badge').textContent).toBe('1');
  });
});

describe('fix-298 Phase 2: one bell — scraper activity is oversight-only', () => {
  it('★ a non-oversight user never sees the system-health section', () => {
    state.name = 'Miles';
    state.members = [{ name: 'Miles', role: 'ent_lead', is_oversight: false }];
    renderBoard();
    expect(screen.queryByTestId('board-sec-health-wrap')).toBeNull();
    expect(screen.queryByTestId('health-activity-link')).toBeNull();
  });

  it('an oversight user sees it, with the counts and a link to /activity', () => {
    state.name = 'Gena';
    state.members = [{ name: 'Gena', role: 'dm', is_oversight: true }];
    state.activity = [
      { action: 'scrape_workflow_fetch_failed', ent_lead: null },
      { action: 'scrape_workflow_fetch_failed', ent_lead: null },
      { action: 'scrape_change_applied', ent_lead: 'Miles' },
    ];
    renderBoard();
    expect(screen.getByTestId('board-sec-health-wrap')).toBeTruthy();
    expect(screen.getByTestId('health-portal-failures').textContent).toContain('2');
    // ★ /activity keeps working as a route — it just lost its nav seat.
    expect(screen.getByTestId('health-activity-link').getAttribute('href')).toBe(
      '/activity',
    );
  });

  it('counts unowned and stale permits from the permit book, not the feed', () => {
    state.name = 'Gena';
    state.members = [{ name: 'Gena', role: 'dm', is_oversight: true }];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      // nobody on it at all
      mkPermit({ da: null, ent_lead: null, updated_at: '2026-08-13T12:00:00Z' }),
      // owned, but untouched for months
      mkPermit({ da: 'Fisk', ent_lead: 'Miles', updated_at: '2026-05-01T12:00:00Z' }),
    ];
    renderBoard();
    expect(screen.getByTestId('health-unowned').textContent).toContain('1');
    expect(screen.getByTestId('health-stale').textContent).toContain('1');
  });
});

describe('fix-298: My Board is not My Tasks', () => {
  it('links to My Tasks rather than absorbing it', () => {
    renderBoard();
    expect(screen.getByTestId('my-board-to-my-tasks').getAttribute('href')).toBe(
      '/my-tasks',
    );
  });

  it('shows the oversight badge only for a flagged viewer', () => {
    state.name = 'Gena';
    state.members = [{ name: 'Gena', role: 'dm', is_oversight: true }];
    const r = renderBoard();
    expect(screen.getByTestId('my-board-oversight-badge')).toBeTruthy();
    r.unmount();

    state.members = [{ name: 'Gena', role: 'dm', is_oversight: false }];
    renderBoard();
    expect(screen.queryByTestId('my-board-oversight-badge')).toBeNull();
  });
});

// ===========================================================================
// fix-298 Phase 2 — the write path, as rendered.
// ===========================================================================

describe('fix-298 P2: ticking a row does the real thing', () => {
  it('a task row resolves the task through the SAME hook My Tasks uses', () => {
    state.tasks = [
      {
        id: 'task-1',
        permit_id: 1,
        bucket: 'de',
        text: 'Pick up redlines',
        discipline: 'ent',
        status: 'Open',
        project_id: 'p1',
        project_address: 'A St',
        assigned_to: 'Miles',
        due_date: '2026-01-01',
        start_date: null,
        target_date: null,
        parent_task_id: null,
        done: false,
        created_at: '',
      },
    ];
    renderBoard();
    const box = screen.getAllByTestId(/^board-forecast-check-/)[0]!;
    expect(box.getAttribute('data-action')).toBe('resolve-task');
    fireEvent.click(box);
    expect(state.taskMutate).toHaveBeenCalledTimes(1);
    expect(state.taskMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      status: 'Resolved',
    });
  });

  it('an entitlement milestone with nothing behind it records an ack', () => {
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: null, ent_lead: 'Miles', approval_date: '2026-01-01' }),
    ];
    renderBoard();
    const box = screen
      .getAllByTestId(/^board-forecast-check-/)
      .find((b) => b.getAttribute('data-action') === 'ack')!;
    fireEvent.click(box);
    expect(state.ackMutate).toHaveBeenCalledTimes(1);
    expect(state.ackMutate.mock.calls[0][0]).toMatchObject({
      milestone: 'fees',
      anchor: '2026-01-01',
    });
  });

  it('★ a waiting row STILL has no checkbox — the write path did not weaken it', () => {
    // Phase 1's load-bearing assertion, re-checked with the write path live.
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [
      mkPermit({ da: 'Fisk', ent_lead: 'Miles', target_submit: '2026-03-26' }),
    ];
    renderBoard();
    const waiting = screen
      .getAllByTestId(/^board-forecast-row-/)
      .filter((r) => r.getAttribute('data-actionable') === 'false');
    expect(waiting.length).toBeGreaterThan(0);
    for (const row of waiting) {
      expect(within(row).queryByTestId(/^board-forecast-check-/)).toBeNull();
    }
  });
});

describe('fix-298 P2: the handoff prompt', () => {
  const withCycle = (over: Record<string, unknown>) =>
    mkPermit({
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 2,
          submitted: '2026-05-01',
          intake_accepted: null,
          city_target: null,
          corr_issued: '2026-06-01',
          resubmitted: null,
          created_at: '',
          updated_at: '',
        },
      ],
      ...over,
    });

  it('★ a permit with ZERO design tasks offers the MANUAL button, never an auto-prompt', () => {
    state.name = 'Fisk';
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [withCycle({ da: 'Fisk', ent_lead: 'Miles' })];
    state.tasks = [];
    renderBoard();
    const row = screen.getByTestId(/^board-handoff-row-/);
    expect(row.getAttribute('data-affordance')).toBe('manual');
    expect(screen.getByTestId(/^board-handoff-confirm-/).textContent).toContain(
      'Mark design complete',
    );
  });

  it('★ a permit with one RESOLVED design task prompts, naming the lead', () => {
    state.name = 'Fisk';
    state.projects = [mkProject('p1', 'A St')];
    const permit = withCycle({ da: 'Fisk', ent_lead: 'Miles' });
    state.permits = [permit];
    state.tasks = [
      {
        id: 'd1',
        permit_id: permit.id,
        bucket: 'de',
        text: 'Redlines',
        discipline: 'arch',
        status: 'Resolved',
        project_id: 'p1',
        project_address: 'A St',
        assigned_to: null,
        due_date: null,
        start_date: null,
        target_date: null,
        parent_task_id: null,
        done: true,
        created_at: '',
      },
    ];
    renderBoard();
    expect(screen.getByTestId(/^board-handoff-row-/).getAttribute('data-affordance')).toBe(
      'prompt',
    );
    const btn = screen.getByTestId(/^board-handoff-confirm-/);
    expect(btn.textContent).toContain('assign to Miles');
    fireEvent.click(btn);
    expect(state.confirmHandoff).toHaveBeenCalledTimes(1);
    expect(state.confirmHandoff.mock.calls[0][0]).toMatchObject({
      entLead: 'Miles',
      cycleIndex: 2,
      manual: false,
    });
  });

  it('★ a ONE-LEG permit shows no handoff affordance at all', () => {
    state.name = 'Miles';
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [withCycle({ da: null, ent_lead: 'Miles' })];
    renderBoard();
    expect(screen.queryByTestId('board-sec-handoff-wrap')).toBeNull();
  });

  it('somebody unrelated to the permit is not offered the confirmation', () => {
    state.name = 'Ainsley';
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [withCycle({ da: 'Fisk', ent_lead: 'Miles', dm: 'Gena' })];
    renderBoard();
    expect(screen.queryByTestId('board-sec-handoff-wrap')).toBeNull();
  });

  it('the DM is offered it too — one confirmation on the permit', () => {
    state.name = 'Gena';
    state.members = [{ name: 'Gena', role: 'dm', is_oversight: false }];
    state.projects = [mkProject('p1', 'A St')];
    state.permits = [withCycle({ da: 'Fisk', ent_lead: 'Miles', dm: 'Gena' })];
    renderBoard();
    expect(screen.getByTestId('board-sec-handoff-wrap')).toBeTruthy();
  });
});
