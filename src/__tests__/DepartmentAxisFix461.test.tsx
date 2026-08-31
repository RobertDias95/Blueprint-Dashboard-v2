import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  foldRosterToPeople,
  peopleWithNoDepartment,
  viewerOverlap,
} from '../lib/department';
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  departmentLabel,
  NO_DEPARTMENT_LABEL,
} from '../lib/roleLabels';
import type { Department, TeamMember } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-461 (P-045 prerequisite) — THE DEPARTMENT AXIS
// ===========================================================================
//
// Bobby, 2026-08-26, final: **Policy · Design & Entitlements · Acquisitions ·
// Underwriting.** He offered *"accounting, which is like EJ, Greg and them"*
// first and then settled on Underwriting; newest-first applies, so Accounting is
// NOT one of the four and there is no fifth.
//
// Why it exists — Bobby: *"[Lucas is] a director, like Dave, but two different
// departments."* `role` mixes discipline with seniority and cannot express
// "director of X".
//
// ★★★ THE TRAP THIS SUITE EXISTS FOR: `team_members` is ONE ROW PER
// (PERSON, ROLE). Measured on prod 2026-08-30, six people carry two rows each —
// Bobby, Briana, Miles (ent+ent_lead), Derry, Lindsay (dm+schematic), Dave
// (director+schematic). 46 rows cover 40 people; 41 active rows cover 35 active
// people. Department is a fact about a PERSON and it sits on a ROLE row, so
// "Dave is Policy as a director and Design & Entitlements as a schematic
// designer" is expressible in the schema and is nonsense.

let seq = 0;
function row(over: Partial<TeamMember> & { name: string }): TeamMember {
  seq += 1;
  return {
    id: `m-${seq}`,
    role: 'da',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-08-30T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    department: null,
    ...over,
  } as unknown as TeamMember;
}

/** The prod shape, trimmed to the interesting people. */
function roster(): TeamMember[] {
  seq = 0;
  return [
    // ★ Dave holds TWO rows — the case the whole design turns on.
    row({ name: 'Dave', role: 'director' }),
    row({ name: 'Dave', role: 'schematic' }),
    // ★ Derry likewise.
    row({ name: 'Derry', role: 'dm' }),
    row({ name: 'Derry', role: 'schematic' }),
    // A single-row person.
    row({ name: 'Cam', role: 'da' }),
    // A `viewer` standing in for "unclassified" (§B4).
    row({ name: 'Lucas', role: 'viewer' }),
    // Somebody who has left — not part of the gap.
    row({ name: 'George', role: 'da', active: false, former: true }),
  ];
}

describe('fix-461 §A2 — the four, as Bobby said them', () => {
  // ★★★ SUPERSEDED 2026-08-31 BY fix-464, NOT MISTAKEN.
  //
  // This pin asserted `toHaveLength(4)` and "there is no fifth", and it was
  // right on 2026-08-26. Then Bobby classified 32 of 35 people with the panel
  // fix-461 shipped and found three it could not fit — Darin (CEO), Eric
  // (President) and Keenan (IT) — and ruled: *"eric and darin are president and
  // ceo, so they need a department. keenan is investor relations/IT so he needs
  // a department too."* Offered one new department or two, he took TWO, so that
  // IT is its own function rather than filed under the CEO.
  //
  // ★★ SO THE COUNT MOVED AND THE ORDER DID NOT. What this test now defends is
  // the half that did NOT expire: **his original four are still the first four,
  // in his order** — fix-464 appended rather than reshuffled, because this array
  // is what he scans and he has just spent a session using it. And **Accounting
  // is still not a department**: he replaced it with Underwriting in the same
  // 2026-08-26 conversation and has not revisited that.
  //
  // ★ The six-key assertion lives in TwoMoreDepartmentsFix464 — this one stays
  //   pointed at fix-461's own ruling so a future reshuffle fails HERE, naming
  //   the decision it breaks.
  it('★★★ his four are still the FIRST four, in his order, and Accounting is NOT one', () => {
    expect(DEPARTMENTS.slice(0, 4)).toEqual([
      'policy',
      'design_entitlements',
      'acquisitions',
      'underwriting',
    ]);
    expect(DEPARTMENTS as readonly string[]).not.toContain('accounting');
  });

  it('★★ the words render as he said them', () => {
    expect(DEPARTMENT_LABEL.policy).toBe('Policy');
    expect(DEPARTMENT_LABEL.design_entitlements).toBe('Design & Entitlements');
    expect(DEPARTMENT_LABEL.acquisitions).toBe('Acquisitions');
    expect(DEPARTMENT_LABEL.underwriting).toBe('Underwriting');
  });

  it('★ NULL renders as a WORD, not a blank', () => {
    // 41 active rows hold NULL the day this ships; a column of empty cells
    // reads as a loading bug rather than as the work it is.
    expect(departmentLabel(null)).toBe(NO_DEPARTMENT_LABEL);
    expect(departmentLabel(undefined)).toBe(NO_DEPARTMENT_LABEL);
    expect(departmentLabel('policy')).toBe('Policy');
  });
});

describe('fix-461 §B2 — a person cannot end up with two departments', () => {
  it('★★★ two roster rows fold into ONE person with ONE control', () => {
    const people = foldRosterToPeople(roster());
    const dave = people.find((p) => p.name === 'Dave')!;
    expect(dave.roles).toEqual(['director', 'schematic']);
    // One entry, not two — the panel renders people, never role rows.
    expect(people.filter((p) => p.name === 'Dave')).toHaveLength(1);
    expect(people.map((p) => p.name)).toEqual([
      'Cam', 'Dave', 'Derry', 'George', 'Lucas',
    ]);
  });

  it('★★★ agreeing rows produce the department; DISAGREEING rows produce an ALARM', () => {
    // ★ THE FAILURE THE MECHANISM PREVENTS, asserted directly. The database
    //   trigger makes this impossible going forward — but if it ever appeared,
    //   picking one silently would hide the defect. So `department` is null and
    //   `split` names both.
    const agreeing = foldRosterToPeople([
      row({ name: 'Dave', role: 'director', department: 'policy' }),
      row({ name: 'Dave', role: 'schematic', department: 'policy' }),
    ])[0]!;
    expect(agreeing.department).toBe('policy');
    expect(agreeing.split).toBeNull();

    const split = foldRosterToPeople([
      row({ name: 'Dave', role: 'director', department: 'policy' }),
      row({ name: 'Dave', role: 'schematic', department: 'design_entitlements' }),
    ])[0]!;
    expect(split.department).toBeNull(); // refuses to pick
    expect(split.split).toEqual(['design_entitlements', 'policy']);
  });

  it('★★ a person is ACTIVE if any of their rows is', () => {
    const p = foldRosterToPeople([
      row({ name: 'Derry', role: 'da', active: false, former: true }),
      row({ name: 'Derry', role: 'dm', active: true }),
    ])[0]!;
    expect(p.active).toBe(true);
  });
});

describe('fix-461 §B3 — the gap', () => {
  it('★★★ lists ACTIVE people with no department, and empties as they are set', () => {
    const before = peopleWithNoDepartment(foldRosterToPeople(roster()));
    expect(before.map((p) => p.name)).toEqual(['Cam', 'Dave', 'Derry', 'Lucas']);
    // ★ George has left — classifying somebody who is gone is work nobody
    //   needs, and including them would stop the list ever reaching zero.
    expect(before.map((p) => p.name)).not.toContain('George');

    const classified = roster().map((m) =>
      m.active ? { ...m, department: 'policy' as Department } : m,
    );
    expect(peopleWithNoDepartment(foldRosterToPeople(classified))).toEqual([]);
  });

  it('★ somebody mid-split is not counted as a gap — they are a different alarm', () => {
    const split = foldRosterToPeople([
      row({ name: 'Dave', role: 'director', department: 'policy' }),
      row({ name: 'Dave', role: 'schematic', department: 'acquisitions' }),
    ]);
    expect(peopleWithNoDepartment(split)).toEqual([]);
    expect(split[0]!.split).not.toBeNull();
  });
});

describe('fix-461 §B4 — the viewer overlap is REPORTED, not acted on', () => {
  it('★★ it counts them and changes no role', () => {
    const people = foldRosterToPeople(roster());
    const overlap = viewerOverlap(people);
    expect(overlap.map((p) => p.name)).toEqual(['Lucas']);
    // ★ The role is untouched — this ticket surfaces the question and leaves it
    //   to Bobby.
    expect(people.find((p) => p.name === 'Lucas')!.roles).toEqual(['viewer']);
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE REGRESSION THAT PROVES THIS WAS ADDITIVE
// ---------------------------------------------------------------------------
import { useTeamMembers } from '../hooks/useTeamMembers';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

const rosterRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      // ★ The real query is .select(...).order(...), so the mock must chain.
      select: () => ({
        order: () => Promise.resolve({ data: rosterRef.current, error: null }),
      }),
    }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('fix-461 — every useTeamMembers derived list is UNCHANGED', () => {
  it('★★★ adding `department` moves nobody between lists', async () => {
    // 29 files read these lists. The column is nullable and nothing derives
    // from it, so every list must answer exactly what it answered before —
    // this is the regression that proves the change was additive.
    const base = [
      row({ name: 'Cam', role: 'da', active: true }),
      row({ name: 'Derry', role: 'dm', active: true }),
      row({ name: 'Derry', role: 'schematic', active: true }),
      row({ name: 'Miles', role: 'ent', active: true }),
      row({ name: 'Miles', role: 'ent_lead', active: true }),
      row({ name: 'George', role: 'da', active: false, former: true }),
    ];
    const withDepartments = base.map((m) => ({
      ...m,
      department: 'design_entitlements' as Department,
    }));

    const shape = (r: ReturnType<typeof useTeamMembers>) => ({
      all: r.all.map((m) => `${m.name}/${m.role}`).sort(),
      activeDas: r.activeDas.map((m) => m.name).sort(),
      formerDas: r.formerDas.map((m) => m.name).sort(),
      dms: r.dms.map((m) => m.name).sort(),
      ents: r.ents.map((m) => m.name).sort(),
      acqs: r.acqs.map((m) => m.name).sort(),
      schematics: r.schematics.map((m) => m.name).sort(),
      inactive: r.inactive.map((m) => m.name).sort(),
    });

    // ★ useTeamMembers is `enabled: !!tenantId` — without a tenant the query
    //   never runs and the lists are empty for a reason that has nothing to do
    //   with departments.
    useAuthStore.setState({
      activeTenantId: 'tenant-1',
      memberships: [{ tenant_id: 'tenant-1', role: 'admin' }],
    });
    rosterRef.current = base;
    const a = renderHook(() => useTeamMembers(), { wrapper });
    await vi.waitFor(() => expect(a.result.current.all.length).toBe(6));
    const before = shape(a.result.current);

    rosterRef.current = withDepartments;
    const b = renderHook(() => useTeamMembers(), { wrapper });
    await vi.waitFor(() => expect(b.result.current.all.length).toBe(6));

    expect(shape(b.result.current)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({ setDept: vi.fn() }));
vi.mock('../hooks/useSetTeamDepartment', () => ({
  useSetTeamDepartment: () => ({ mutate: state.setDept, isPending: false }),
}));

import DepartmentEditor from '../components/Settings/DepartmentEditor';

beforeEach(() => state.setDept.mockReset());

describe('fix-461 §B1/§B2 — the panel', () => {
  it('★★★ ONE control per person, even for a two-row person', () => {
    render(<DepartmentEditor members={roster()} readOnly={false} />);
    expect(screen.getByTestId('department-select-Dave')).toBeTruthy();
    // Not two — folded to people before anything renders.
    expect(screen.getAllByTestId(/^department-select-Dave$/)).toHaveLength(1);
  });

  it('★★★ setting a department writes by NAME, never by row id', () => {
    render(<DepartmentEditor members={roster()} readOnly={false} />);
    fireEvent.change(screen.getByTestId('department-select-Dave'), {
      target: { value: 'policy' },
    });
    expect(state.setDept).toHaveBeenCalledWith({
      name: 'Dave',
      department: 'policy',
    });
  });

  it('★★ "No department" is an OPTION — un-classifying is allowed', () => {
    render(
      <DepartmentEditor
        members={[row({ name: 'Cam', role: 'da', department: 'policy' })]}
        readOnly={false}
      />,
    );
    fireEvent.change(screen.getByTestId('department-select-Cam'), {
      target: { value: '' },
    });
    expect(state.setDept).toHaveBeenCalledWith({ name: 'Cam', department: null });
  });

  it('★★★ the gap lists the unclassified, and says so plainly when empty', () => {
    const { unmount } = render(
      <DepartmentEditor members={roster()} readOnly={false} />,
    );
    expect(screen.getByTestId('department-gap').textContent).toMatch(/4 people have no department/);
    unmount();

    render(
      <DepartmentEditor
        members={[row({ name: 'Cam', role: 'da', department: 'policy' })]}
        readOnly={false}
      />,
    );
    expect(screen.getByTestId('department-gap-empty').textContent).toMatch(
      /Everyone has a department/,
    );
  });

  it('★★★ a split is shouted about, not silently resolved', () => {
    render(
      <DepartmentEditor
        members={[
          row({ name: 'Dave', role: 'director', department: 'policy' }),
          row({ name: 'Dave', role: 'schematic', department: 'acquisitions' }),
        ]}
        readOnly={false}
      />,
    );
    const warn = screen.getByTestId('department-split-warning');
    expect(warn.textContent).toMatch(/two different departments/);
    expect(warn.textContent).toMatch(/Acquisitions and Policy/);
  });

  it('★★ readOnly: the departments are readable and nothing can be changed', () => {
    render(<DepartmentEditor members={roster()} readOnly={true} />);
    expect(screen.getByTestId('department-value-Dave')).toBeTruthy();
    expect(screen.queryByTestId('department-select-Dave')).toBeNull();
    // ★ The gap stays visible to a non-admin — it is information, not an action.
    expect(screen.getByTestId('department-gap')).toBeTruthy();
  });
});
