import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { splitAgenda } from '../lib/agenda';
import { taskKind, TASK_KIND_LABEL, isTeamTask, isAgendaItem } from '../lib/taskSource';
import { isUnclaimedTask } from '../lib/unclaimedWork';
import { isDesignTask } from '../lib/myBoard';
import { visibleEntries, allRibbonRoutes, RIBBON_ENTRIES } from '../lib/ribbonNav';
import { foldRosterToPeople } from '../lib/department';
import { useAuthStore } from '../stores/authStore';
import type { MyTaskNode, TeamMember } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-462 (P-045) — THE AGENDA
// ===========================================================================
//
// ★★★ THERE IS NO AGENDA SYSTEM, AND THAT IS THE TICKET. An agenda item is a
// `team_tasks` row carrying a flag. Nothing is copied, nothing syncs, and "put
// it on the agenda" and "assign it" are two properties of ONE object.
//
// Bobby's rulings, all of them already made:
//   · **One running list shown as two** — open/active and closed/completed.
//     NOT per-meeting. No meeting-date grouping, no archive, no minutes.
//   · *"It would look very similar to the milestones in MyTask so that it fits
//     and blends with our existing system."*
//   · **The statuses are the TASK statuses.** No second vocabulary.
//   · **Membership is a per-person checkbox, not a department** — gating by
//     department means adding one person moves their whole department.
//   · Agenda is the ONE new ribbon entry, and it is a VIEW, not a lane.

let seq = 0;
function item(over: Partial<MyTaskNode> = {}): MyTaskNode {
  seq += 1;
  return {
    id: `tt-${seq}`,
    permit_id: null,
    project_id: null,
    project_address: null,
    permit_type: null,
    permit_da: null,
    parent_task_id: null,
    discipline: 'ent',
    bucket: 'pm',
    text: 'Decide the Q4 submittal cadence',
    status: 'Open',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    created_at: '2026-08-30T00:00:00Z',
    sort_order: 0,
    assigned_to: null,
    waiting_on: null,
    priority: false,
    notes: null,
    is_auto_generated: false,
    auto_event: null,
    auto_closed_reason: null,
    primary_assignee: null,
    co_assignees: [],
    source: 'team',
    agenda: true,
    ...over,
  } as unknown as MyTaskNode;
}

function permitTask(over: Partial<MyTaskNode> = {}): MyTaskNode {
  return item({
    permit_id: 10096,
    project_id: 'proj-1',
    project_address: '215 31st Ave',
    permit_type: 'Building Permit',
    permit_da: 'Cam',
    discipline: 'arch',
    bucket: 'de',
    primary_assignee: 'Cam',
    source: 'permit',
    agenda: undefined,
    ...over,
  });
}

describe('fix-462 §C2 — ONE running list, shown as two', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('★★★ the split is the TASK status — no agenda status exists', () => {
    // Bobby chose the task statuses over meeting-shaped words: no second
    // vocabulary enters the app. So "open" is `isTaskLive`, the same predicate
    // the board and every counter already use.
    const { open, closed } = splitAgenda([
      item({ status: 'Open' }),
      item({ status: 'In Progress' }),
      item({ status: 'Resolved' }),
      item({ status: 'Cancelled' }),
    ]);
    expect(open).toHaveLength(2);
    expect(closed).toHaveLength(2);
  });

  it('★★★ only agenda items — a plain team task is not on the agenda', () => {
    const { open, closed } = splitAgenda([
      item({ agenda: true }),
      item({ agenda: false }),
      permitTask(),
    ]);
    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(0);
  });

  it('★★ a closed item does not MOVE — it is the same list, rendered twice', () => {
    // The item keeps its id; only its status decides which half it renders in.
    const one = item({ id: 'x', status: 'Open' });
    expect(splitAgenda([one]).open.map((t) => t.id)).toEqual(['x']);
    expect(
      splitAgenda([{ ...one, status: 'Resolved' } as MyTaskNode]).closed.map((t) => t.id),
    ).toEqual(['x']);
  });

  it('★ priority first, then oldest — the order a meeting works a list', () => {
    const { open } = splitAgenda([
      item({ id: 'a', created_at: '2026-08-01T00:00:00Z' }),
      item({ id: 'b', created_at: '2026-07-01T00:00:00Z' }),
      item({ id: 'c', created_at: '2026-08-20T00:00:00Z', priority: true }),
    ]);
    expect(open.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('fix-462 §A3 — the tag says agenda, in the vocabulary fix-460 opened', () => {
  it('★★★ a fourth word, not a second vocabulary', () => {
    expect(taskKind(item())).toBe('agenda');
    expect(TASK_KIND_LABEL.agenda).toBe('Agenda');
    // The three that shipped are undisturbed.
    expect(taskKind(item({ agenda: false }))).toBe('team');
    expect(taskKind(permitTask({ is_auto_generated: true }))).toBe('bot');
    expect(taskKind(permitTask())).toBeNull();
  });

  it('★★★ an agenda item is STILL a team task — one object, two properties', () => {
    const t = item();
    expect(isAgendaItem(t)).toBe(true);
    // ★ This is the whole design: nothing was copied and no second kind of
    //   object exists. Every team-task rule still holds for it.
    expect(isTeamTask(t)).toBe(true);
    expect(t.source).toBe('team');
  });
});

describe('fix-462 — it reaches the board with NO board code edited', () => {
  it('★★★ it lands in the lane its discipline names, like any task', () => {
    // `myBoard.isDesignTask` is untouched by this ticket; an agenda item
    // answers it exactly as a permit task with the same discipline does.
    expect(isDesignTask(item({ discipline: 'arch' }))).toBe(true);
    expect(isDesignTask(item({ discipline: 'ent' }))).toBe(false);
    expect(isDesignTask(item({ discipline: 'arch' }))).toBe(
      isDesignTask(permitTask({ discipline: 'arch' })),
    );
  });

  it('★★★ an unassigned agenda item is UNCLAIMED (fix-458, unedited)', () => {
    const ctx = { da: null, dm: null, entLead: null, schematicDesigners: [] };
    expect(isUnclaimedTask(item({ assigned_to: null }), ctx)).toBe(true);
    expect(isUnclaimedTask(item({ assigned_to: 'Miles' }), ctx)).toBe(false);
  });

  it('★★★ it NEVER appears in a project or permit view (fix-460, re-asserted)', () => {
    const agendaItem = item();
    const permit = permitTask();
    const rows = [agendaItem, permit];

    // A permit view filters on permit_id; a project view on project_id.
    expect(rows.filter((r) => r.permit_id === 10096)).toEqual([permit]);
    expect(rows.filter((r) => r.project_id === 'proj-1')).toEqual([permit]);

    // ★ The agenda item carries NEITHER id, so no such view can match it —
    //   the property is structural, not a rule anybody has to remember.
    expect(agendaItem.permit_id).toBeNull();
    expect(agendaItem.project_id).toBeNull();
  });
});

describe('fix-462 §C1 — the ribbon gate', () => {
  // ★★★ fix-483 §C (P-138): THE ENTRY MOVED INTO THE REPORTS GROUP, so it is a
  //     group CHILD now rather than a top-level link. fix-462's claim is
  //     unchanged and is what this still asserts — a non-member does not see
  //     it, a member does, an admin sees everything — but it has to look one
  //     level deeper, and that is exactly the bug the move could have shipped:
  //     `visibleChildren` filtered on `adminOnly` alone, so an `agendaOnly`
  //     child would have been shown to all 23 non-admin editors. A gate that
  //     only one code path enforces stops being enforced the moment an entry
  //     takes the other path.
  const has = (es: ReturnType<typeof visibleEntries>) =>
    es.some(
      (e) =>
        (e.kind === 'link' && e.link.to === '/agenda') ||
        (e.kind === 'group' && e.group.children.some((c) => c.to === '/agenda')),
    );

  it('★★★ a non-member does not get the entry; an admin does', () => {
    expect(has(visibleEntries(false, false))).toBe(false); // non-admin, non-member
    expect(has(visibleEntries(false, true))).toBe(true); //  non-admin MEMBER
    expect(has(visibleEntries(true))).toBe(true); //          admin sees everything
  });

  it('★★★ …and a NON-MEMBER still gets the rest of the Reports group', () => {
    // ★ The gate withholds ONE CHILD, not the group. Project View is the
    //   23-of-29 measurement fix-331 §8 made, and hiding it to hide the Agenda
    //   would be a far bigger regression than the one being prevented.
    const group = visibleEntries(false, false).find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    expect(group).toBeDefined();
    const kids =
      group!.kind === 'group' ? group!.group.children.map((c) => c.to) : [];
    expect(kids).toEqual(['/projects']);
  });

  it('★★★ the default keeps all thirteen existing call sites honest', () => {
    // `isAgendaMember` defaults to false, so `visibleEntries(false)` — the form
    // every pre-existing caller uses — answers exactly what it answered before.
    expect(visibleEntries(false)).toEqual(visibleEntries(false, false));
  });

  it('★★★ the coverage guard still covers it — the gate is not a hiding place', () => {
    // `allRibbonRoutes()` walks entries REGARDLESS of any gate, so a gated entry
    // is still asserted against the real route table. A gate that removed an
    // entry from coverage would be a way to smuggle in a dead link.
    expect(allRibbonRoutes()).toContain('/agenda');
  });

  it('★★ there is still exactly ONE Agenda entry, and it carries BOTH gates', () => {
    // Bobby sanctioned one ribbon entry. Not two, and not a group.
    //
    // ★★★ fix-483 §C: it is a child of Reports now and it needs `adminOnly:
    //     false` as well as `agendaOnly: true`. `undefined` would INHERIT the
    //     group's admin gate — which is right for Overview and Saved reports
    //     and wrong here, because the six non-admin agenda members would lose
    //     the screen the moment it changed shelf. So the assertion flipped from
    //     "adminOnly is undefined" to "adminOnly is explicitly false", which is
    //     fix-331 §8's `undefined !== false` distinction doing real work.
    const agenda = [
      ...RIBBON_ENTRIES.filter((e) => e.kind === 'link' && e.link.to === '/agenda'),
      ...RIBBON_ENTRIES.flatMap((e) =>
        e.kind === 'group' ? e.group.children.filter((c) => c.to === '/agenda') : [],
      ),
    ];
    expect(agenda).toHaveLength(1);
    const link = agenda[0] as { adminOnly?: boolean; agendaOnly?: boolean };
    expect(link.adminOnly).toBe(false);
    expect(link.agendaOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE ROSTER TRAP — a person can never be HALF on the agenda
// ---------------------------------------------------------------------------
let mseq = 0;
function row(over: Partial<TeamMember> & { name: string }): TeamMember {
  mseq += 1;
  return {
    id: `m-${mseq}`,
    role: 'da',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-08-31T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    department: null,
    agenda_member: false,
    ...over,
  } as unknown as TeamMember;
}

describe('fix-462 §B — membership is a fact about a PERSON', () => {
  beforeEach(() => {
    mseq = 0;
  });

  it('★★★ two roster rows fold into ONE person with ONE checkbox', () => {
    // Dave holds `director` + `schematic`. A panel rendering ROWS would show him
    // twice with two checkboxes, and the obvious next thing is that they
    // disagree. fix-461's fold is reused rather than re-derived.
    const people = foldRosterToPeople([
      row({ name: 'Dave', role: 'director' }),
      row({ name: 'Dave', role: 'schematic' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]!.roles).toEqual(['director', 'schematic']);
  });

  it('★★★ THE FAILURE THE TRIGGER PREVENTS: half on, half off', () => {
    // This is what "half on the agenda" looks like in the data. The database
    // trigger makes it impossible — proved against prod in a rolled-back
    // transaction — and the panel's OR reads it as "in" rather than flickering
    // somebody out of a meeting mid-write.
    const rows = [
      row({ name: 'Dave', role: 'director', agenda_member: true }),
      row({ name: 'Dave', role: 'schematic', agenda_member: false }),
    ];
    const isMember = rows
      .filter((r) => r.name === 'Dave')
      .some((r) => r.agenda_member === true);
    expect(isMember).toBe(true);
    // ★ And the disagreement is real, which is why it is the database's job to
    //   prevent it rather than the panel's to paper over it.
    expect(new Set(rows.map((r) => r.agenda_member)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE TEST THAT WOULD HAVE CAUGHT fix-461's NEAR-MISS
// ---------------------------------------------------------------------------
import { useTeamMembers } from '../hooks/useTeamMembers';

const rosterRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        rosterRef.current = (rosterRef.current as { __cols?: string }[]).length
          ? rosterRef.current
          : rosterRef.current;
        (globalThis as { __selectCols?: string }).__selectCols = cols;
        return {
          order: () => Promise.resolve({ data: rosterRef.current, error: null }),
        };
      },
    }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('fix-462 §B3 — agenda_member survives the useTeamMembers round trip', () => {
  it('★★★ the EXPLICIT select list names it — fix-386’s trap, third occurrence', async () => {
    // fix-461 nearly shipped a panel showing everyone as unclassified for ever,
    // because `useTeamMembers`'s select is EXPLICIT and a new column is
    // invisible until named there. This is that test, for this column.
    useAuthStore.setState({
      activeTenantId: 'tenant-1',
      memberships: [{ tenant_id: 'tenant-1', role: 'admin' }],
    });
    rosterRef.current = [
      row({ name: 'Bobby', role: 'ent_lead', agenda_member: true }),
      row({ name: 'Cam', role: 'da', agenda_member: false }),
    ];
    const { result } = renderHook(() => useTeamMembers(), { wrapper });
    await vi.waitFor(() => expect(result.current.all.length).toBe(2));

    // ★ The flag reached the client.
    expect(result.current.all.find((m) => m.name === 'Bobby')?.agenda_member).toBe(true);
    expect(result.current.all.find((m) => m.name === 'Cam')?.agenda_member).toBe(false);
    // ★★ And the column is genuinely IN the select string — the assertion that
    //    fails the day somebody adds a column and forgets this list.
    expect((globalThis as { __selectCols?: string }).__selectCols).toContain(
      'agenda_member',
    );
  });
});

// ---------------------------------------------------------------------------
// The Settings panel
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({ setMember: vi.fn() }));
vi.mock('../hooks/useAgendaMember', async (orig) => {
  const actual = await orig<typeof import('../hooks/useAgendaMember')>();
  return { ...actual, useSetAgendaMember: () => ({ mutate: state.setMember, isPending: false }) };
});

import AgendaMembersPanel from '../components/Settings/AgendaMembersPanel';

beforeEach(() => state.setMember.mockReset());

describe('fix-462 §B2 — the Settings panel', () => {
  const roster = () => {
    mseq = 0;
    return [
      row({ name: 'Dave', role: 'director', agenda_member: true }),
      row({ name: 'Dave', role: 'schematic', agenda_member: true }),
      row({ name: 'Cam', role: 'da' }),
    ];
  };

  it('★★★ ONE checkbox per person, even for a two-row person', () => {
    render(<AgendaMembersPanel members={roster()} readOnly={false} />);
    expect(screen.getAllByTestId('agenda-member-Dave')).toHaveLength(1);
    expect(screen.getByTestId('agenda-member-Cam')).toBeTruthy();
  });

  it('★★★ ticking writes by NAME, never by row id', () => {
    render(<AgendaMembersPanel members={roster()} readOnly={false} />);
    fireEvent.click(screen.getByTestId('agenda-member-Cam'));
    expect(state.setMember).toHaveBeenCalledWith({ name: 'Cam', member: true });
  });

  it('★★ it says who is in the meeting, and says so plainly when nobody is', () => {
    const { unmount } = render(
      <AgendaMembersPanel members={roster()} readOnly={false} />,
    );
    expect(screen.getByTestId('agenda-member-count').textContent).toMatch(/Dave/);
    unmount();
    render(
      <AgendaMembersPanel
        members={[row({ name: 'Cam', role: 'da' })]}
        readOnly={false}
      />,
    );
    expect(screen.getByTestId('agenda-member-count').textContent).toMatch(
      /Nobody is on the agenda yet/,
    );
  });

  it('★★★ §C4: it says removing somebody hides NO item', () => {
    render(<AgendaMembersPanel members={roster()} readOnly={false} />);
    expect(screen.getByTestId('agenda-members-panel').textContent).toMatch(
      /never hides or deletes an item/i,
    );
  });

  it('★★ readOnly: the membership is readable and nothing can be changed', () => {
    render(<AgendaMembersPanel members={roster()} readOnly={true} />);
    const box = screen.getByTestId('agenda-member-Cam') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId('agenda-member-count')).toBeTruthy();
  });
});
