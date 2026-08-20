import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ===========================================================================
// fix-365 ON SCREEN — a manager's lens over their own board
// ===========================================================================
//
// ★★ The domain rules live in BoardByAssociateFix365.test.ts. This file asserts
// what a PERSON sees, for fix-308b's and fix-348's reason: a tested function
// with no caller, or a correct rule wired to the wrong prop, passes every unit
// test in the file next door.

const state = vi.hoisted(() => ({
  permits: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
  members: [] as unknown[],
  name: 'Bobby' as string | null,
  userId: 'user-1',
  /** ★ The real resolver is exercised in the domain suite; here the page's
   *  injection point is what matters, so it is a spy with a real rule. */
  owns: (task: Record<string, unknown>, name: string | null) =>
    (task.assigned_to ?? name) === name || task.assigned_to == null,
  /** ★ Brittani's real shape: Marc · Ahmadi · Fisk. */
  associates: [] as string[],
  lens: { mode: 'off', focus: null } as { mode: 'off' | 'group'; focus: string | null },
  unmanaged: [] as string[],
  setLensCalls: [] as unknown[],
}));

// ★★ THE LENS ITSELF is what this suite exercises, so its hook is driven from
// `state` rather than stubbed inert — the real `useBoardLens` reads three
// queries and these suites render without a QueryClient by design.
vi.mock('../hooks/useBoardLens', () => ({
  useBoardLens: () => ({
    associates: state.associates,
    hasAssociates: state.associates.length > 0,
    lens: state.lens,
    setLens: (next: unknown) => {
      state.lens = next as typeof state.lens;
      state.setLensCalls.push(next);
    },
    unmanaged: state.unmanaged,
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
  useTeamMembers: () => ({
    all: state.members,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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
  useTaskOwnership: () => ({
    matches: (t: Record<string, unknown>, n: string | null) => state.owns(t, n),
  }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: [] }),
  // ★ fix-370: the model reads a second, uncapped aggregate for the TRUE
  // suppressed totals. Null here = the pre-fix-370 fallback (count the page),
  // which keeps every existing expectation in this suite meaningful.
  useScraperActivitySummary: () => ({ data: null }),
}));
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
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({
    data: state.tasks,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: () => <div data-testid="stub-editor" />,
}));

import MyBoard from '../pages/MyBoard';

let pid = 0;
let tid = 0;

function mkPermit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'PAR/Pre-Sub',
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
    updated_at: '2026-08-17T00:00:00Z',
    permit_cycles: [{ id: 'c0', permit_id: 1, cycle_index: 0 }],
    ...over,
  };
}

function mkTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '4137 54th Ave SW',
    permit_type: 'PAR/Pre-Sub',
    bucket: 'de',
    text: 'Enter permit number',
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

/** ★ The board takes "today" from the clock, so the fixtures are dated relative
 *  to it rather than pinning a date the suite would then have to freeze. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

beforeEach(() => {
  pid = 0;
  tid = 0;
  state.permits = [];
  state.projects = [{ id: 'p1', address: '4137 54th Ave SW' }];
  state.tasks = [];
  state.members = [];
  state.name = 'Bobby';
  state.userId = 'user-1';
  state.owns = (task, name) => (task.assigned_to ?? name) === name || task.assigned_to == null;
  state.associates = [];
  state.lens = { mode: 'off', focus: null };
  state.unmanaged = [];
  state.setLensCalls = [];
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// The screenshot, rebuilt and rendered.
// ---------------------------------------------------------------------------


/** Brittani's real shape: three associates, and past-due work across them. */
const BRITTANI = ['Marc', 'Ahmadi', 'Fisk'];

function boardWithTeamWork() {
  state.name = 'Brittani';
  state.associates = BRITTANI;
  // fix-346 co-assigns the manager and leaves the PRIMARY alone, so the
  // assignee is still the person doing the work. `owns` mirrors that: these
  // rows are on Brittani's board because she is a co-assignee.
  state.owns = () => true;
  state.permits = [mkPermit({ id: 1, da: 'Marc' })];
  state.tasks = [
    mkTask({ permit_id: 1, assigned_to: 'Marc', text: 'Marc late one', target_date: daysFromToday(-4) }),
    mkTask({ permit_id: 1, assigned_to: 'Ahmadi', text: 'Ahmadi late one', target_date: daysFromToday(-2) }),
    mkTask({ permit_id: 1, assigned_to: 'Fisk', text: 'Fisk late one', target_date: daysFromToday(-1) }),
    mkTask({ permit_id: 1, assigned_to: 'Brittani', text: 'My own late one', target_date: daysFromToday(-3) }),
  ];
}

describe('fix-365 section 3: only the people it means something to', () => {
  it('* somebody who manages nobody never sees the control', () => {
    // 25 of the 29 logins. A control that does nothing for you is the clutter
    // fix-331 and fix-345 spent two tickets removing.
    state.associates = [];
    state.tasks = [mkTask({ assigned_to: 'Bobby', target_date: daysFromToday(-1) })];
    state.permits = [mkPermit()];
    wrap(<MyBoard />);
    expect(screen.queryByTestId('board-lens')).toBeNull();
  });

  it('* a manager with associates does', () => {
    boardWithTeamWork();
    wrap(<MyBoard />);
    expect(screen.getByTestId('board-lens')).toBeInTheDocument();
  });
});

describe('fix-365 section 1: group, and focus', () => {
  it('*** three associates produce three groups inside the bucket', () => {
    boardWithTeamWork();
    state.lens = { mode: 'group', focus: null };
    wrap(<MyBoard />);
    // The bucket is still the section; the names are dividers inside it.
    for (const who of [...BRITTANI, 'Your own work']) {
      expect(
        screen.getByTestId('board-sec-past-due-group-head-' + who),
      ).toBeInTheDocument();
    }
  });

  it('*** and a past-due row is STILL past-due when grouped', () => {
    // The fix-348 contract, and the one most at risk. Person is the INNER
    // axis: "Past due" still reads first and still carries its own count.
    boardWithTeamWork();
    state.lens = { mode: 'group', focus: null };
    wrap(<MyBoard />);
    const header = screen.getByTestId('board-sec-past-due');
    expect(header.textContent).toContain('Past due');
    // Every row is inside the past-due section, under a name.
    const group = screen.getByTestId('board-sec-past-due-group-Marc');
    expect(group.textContent).toContain('Marc late one');
    // And the urgency wording the row carries is untouched.
    expect(screen.getByTestId('my-board-forecast').textContent).toContain('Past due');
  });

  it('* focusing one associate shows only their work', () => {
    boardWithTeamWork();
    state.lens = { mode: 'off', focus: 'Ahmadi' };
    wrap(<MyBoard />);
    const forecast = screen.getByTestId('my-board-forecast');
    expect(forecast.textContent).toContain('Ahmadi late one');
    expect(forecast.textContent).not.toContain('Marc late one');
    expect(forecast.textContent).not.toContain('My own late one');
  });

  it('* and clearing it restores everything', () => {
    boardWithTeamWork();
    state.lens = { mode: 'off', focus: null };
    wrap(<MyBoard />);
    const forecast = screen.getByTestId('my-board-forecast');
    for (const text of ['Marc late one', 'Ahmadi late one', 'My own late one']) {
      expect(forecast.textContent).toContain(text);
    }
  });

  it('** ungrouped is the DEFAULT - the board nobody asked to change is unchanged', () => {
    boardWithTeamWork();
    state.lens = { mode: 'off', focus: null };
    wrap(<MyBoard />);
    expect(screen.queryByTestId('board-sec-past-due-group-head-Marc')).toBeNull();
  });
});

describe('fix-365: Jade has exactly one associate', () => {
  function jadeBoard() {
    state.name = 'Jade';
    state.associates = ['Erick'];
    state.owns = () => true;
    state.permits = [mkPermit({ id: 1, da: 'Erick' })];
    state.tasks = [
      mkTask({ permit_id: 1, assigned_to: 'Erick', target_date: daysFromToday(-1) }),
    ];
  }

  it('** so she gets a focus toggle, not a grouping control offering one group', () => {
    // "A grouping control offering one group is noise." With one associate the
    // control is a single toggle that says what it does - "Only Erick" - and
    // the Group button is not offered at all.
    jadeBoard();
    wrap(<MyBoard />);
    const lens = screen.getByTestId('board-lens');
    expect(lens.dataset.associateCount).toBe('1');
    expect(lens.dataset.mode).toBe('single');
    expect(screen.getByTestId('board-lens-only').textContent).toBe('Only Erick');
    expect(screen.queryByTestId('board-lens-group')).toBeNull();
    expect(screen.queryByTestId('board-lens-focus-all')).toBeNull();
  });

  it('* and the toggle focuses her one associate', () => {
    jadeBoard();
    wrap(<MyBoard />);
    fireEvent.click(screen.getByTestId('board-lens-only'));
    expect(state.setLensCalls).toHaveLength(1);
    expect(state.setLensCalls[0]).toEqual({ mode: 'off', focus: 'Erick' });
  });
});

describe('fix-365 section 4: the associates nobody manages are NAMED', () => {
  it('*** Cam and Shire are said out loud, on the manager own board', () => {
    // MEASURED: both are active design associates with no row in dm_da_groups,
    // holding 21 open tasks between them - more than Brittani whole book.
    // Their work reaches no manager, and it never reaches this control either.
    //
    // Grouping must not turn an existing gap into an invisible one: a manager
    // reading "Marc . Ahmadi . Fisk" would reasonably conclude that is the
    // whole design bench.
    boardWithTeamWork();
    state.unmanaged = ['Cam', 'Shire'];
    wrap(<MyBoard />);
    const note = screen.getByTestId('board-lens-unmanaged');
    expect(note.textContent).toContain('Cam');
    expect(note.textContent).toContain('Shire');
    expect(note.textContent).toContain('Not on anyone');
  });

  it('* and nothing is said when everybody is mapped', () => {
    boardWithTeamWork();
    state.unmanaged = [];
    wrap(<MyBoard />);
    expect(screen.queryByTestId('board-lens-unmanaged')).toBeNull();
  });
});
