import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  departmentLabel,
} from '../lib/roleLabels';
import { foldRosterToPeople } from '../lib/department';
import type { Department, TeamMember } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-464 (P-045 follow-on) — TWO MORE DEPARTMENTS
// ===========================================================================
//
// Bobby, 2026-08-31, amending his 2026-08-26 list: *"eric and darin are
// president and ceo, so they need a department. keenan is investor relations/IT
// so he needs a department too."* Offered one new department or two, he took
// **two** — Executive, and IT & Investor Relations — so that IT is its own
// function rather than filed under the CEO.
//
// MEASURED ON PROD 2026-08-31 before anything was written: 35 active people,
// **32 classified, 3 NULL** — Darin, Eric and Keenan, whose roster notes read
// CEO, President and IT. They were not an oversight: the picker had nothing
// that fitted them.
//
// ★★ NEWEST-FIRST. fix-461's "do not add a fifth" is SUPERSEDED. ★ Its other
// half is not: **Accounting is still not a department.**

// ★★★ AMENDED AGAIN 2026-09-03 (fix-487, P-144) — SEVEN. The Construction
// Admin role arrived with a department of its own: Bobby, *"they're more
// construction-based, post-permit-issuance."* fix-464's APPEND rule is what
// made that a one-line change, and it is asserted below rather than assumed.
//
// ★★ THE HALF THAT STILL HAS NOT EXPIRED: **Accounting is still not a
//    department.** Two amendments have now moved the count and neither touched
//    that, which is exactly the distinction fix-464 drew when it superseded
//    fix-461's "no fifth".

describe('fix-464 §A — the vocabulary grows by APPENDING', () => {
  it('★★★ seven keys, and the original four are STILL first, in his order', () => {
    // §A5: APPEND, do not reshuffle. This array's order is the one he scans,
    // and he has spent a session using it to classify 32 people.
    expect(DEPARTMENTS).toEqual([
      'policy',
      'design_entitlements',
      'acquisitions',
      'underwriting',
      'executive',
      'it_investor_relations',
      'construction_admin',
    ]);
    // ★ And fix-464's own two are still where IT put them — the append rule
    //   applied twice, which is the only way it means anything.
    expect(DEPARTMENTS.slice(4, 6)).toEqual([
      'executive',
      'it_investor_relations',
    ]);
    // ★ Stated separately so a future reshuffle fails on the REASON, not just
    //   on the array: the first four are fix-461's, untouched.
    expect(DEPARTMENTS.slice(0, 4)).toEqual([
      'policy',
      'design_entitlements',
      'acquisitions',
      'underwriting',
    ]);
  });

  it('★★ the labels are his words', () => {
    expect(DEPARTMENT_LABEL.executive).toBe('Executive');
    // ★ He wrote "investor relations/IT"; the ampersand reads as a department
    //   where the slash reads as a job description.
    expect(DEPARTMENT_LABEL.it_investor_relations).toBe('IT & Investor Relations');
    // The original four are untouched.
    expect(DEPARTMENT_LABEL.policy).toBe('Policy');
    expect(DEPARTMENT_LABEL.design_entitlements).toBe('Design & Entitlements');
    expect(DEPARTMENT_LABEL.acquisitions).toBe('Acquisitions');
    expect(DEPARTMENT_LABEL.underwriting).toBe('Underwriting');
  });

  it('★ ACCOUNTING IS STILL NOT A DEPARTMENT — only "no fifth" expired', () => {
    expect(DEPARTMENTS as readonly string[]).not.toContain('accounting');
    expect(Object.keys(DEPARTMENT_LABEL)).not.toContain('accounting');
  });

  it('★ NULL still renders as a word, not a blank', () => {
    expect(departmentLabel(null)).toBe('No department');
    expect(departmentLabel('executive')).toBe('Executive');
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE REGRESSION THIS TICKET IS REALLY BUYING
// ---------------------------------------------------------------------------
describe('fix-464 — the five places cannot drift apart', () => {
  it('★★★ DEPARTMENT_LABEL and DEPARTMENTS cover exactly the same keys', () => {
    // Edit one without the other and this fails.
    expect([...DEPARTMENTS].sort()).toEqual(Object.keys(DEPARTMENT_LABEL).sort());
  });

  it('★★★ the Department UNION and DEPARTMENT_LABEL agree', () => {
    // `Record<Department, string>` makes this a compile-time guarantee, so the
    // runtime assertion is that the compile-time one is still in force: if
    // somebody loosened the type to `Record<string, string>`, the count breaks.
    const fromUnion: Department[] = [
      'policy',
      'design_entitlements',
      'acquisitions',
      'underwriting',
      'executive',
      'it_investor_relations',
      // ★ fix-487 (P-144).
      'construction_admin',
    ];
    expect([...fromUnion].sort()).toEqual(Object.keys(DEPARTMENT_LABEL).sort());
    expect(fromUnion).toHaveLength(7);
  });

  it('★★★ THE FIFTH PLACE: bp_set_team_department carries its OWN value list', () => {
    // ★ STEP 0a's finding, and the one that would have shipped a broken picker.
    //   The brief named four places; the RPC validates independently of the
    //   CHECK constraint, so widening only the constraint gives you a dropdown
    //   that offers options the writer raises "unknown department" on.
    //
    // ★★★ fix-487 RE-POINTED THIS AT THE MIGRATION THAT DEFINES THE CURRENT
    //     VOCABULARY. It used to read fix-464's file, which is now a HISTORICAL
    //     record of six — it cannot mention `construction_admin` and should not
    //     be edited to. The rule being enforced ("both database lists agree
    //     with the app's") is unchanged; what moved is which file is the live
    //     one, and the next department will move it again.
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_487_construction_admin.sql'),
      'utf8',
    );
    // ★ The `?raw`/readFileSync guard (fix-406): assert the file arrived before
    //   trusting a "contains" check, or an empty string passes everything below
    //   for the wrong reason.
    expect(sql.length).toBeGreaterThan(2000);
    expect(sql).toMatch(/add constraint team_members_department_check/);
    expect(sql).toMatch(/create or replace function public\.bp_set_team_department/);

    // ★★ BOTH lists carry all seven — split the file at the function boundary
    //    and check each half, so widening one and not the other fails here.
    const cut = sql.indexOf('create or replace function public.bp_set_team_department');
    const constraintHalf = sql.slice(0, cut);
    const functionHalf = sql.slice(cut);
    for (const key of DEPARTMENTS) {
      expect(constraintHalf, `constraint is missing ${key}`).toContain(`'${key}'`);
      expect(functionHalf, `the RPC is missing ${key}`).toContain(`'${key}'`);
    }
  });

  it('★★ fix-464\'s own migration is untouched — it still records ITS six', () => {
    // ★ A historical migration is a record of what happened, not a copy of the
    //   current vocabulary. Editing it to add `construction_admin` would make
    //   the file claim to have done something it did not do.
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_464_two_more_departments.sql'),
      'utf8',
    );
    expect(sql.length).toBeGreaterThan(500);
    expect(sql).toContain(`'it_investor_relations'`);
    expect(sql).not.toContain(`'construction_admin'`);
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
    updated_at: '2026-08-31T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    department: null,
    agenda_member: false,
    ...over,
  } as unknown as TeamMember;
}

beforeEach(() => {
  seq = 0;
  state.setDept.mockReset();
});

describe('fix-464 §B — the screens', () => {
  it('★★★ §B1: the picker offers them ALL, and renders from DEPARTMENTS', () => {
    render(<DepartmentEditor members={[row({ name: 'Darin' })]} readOnly={false} />);
    const select = screen.getByTestId('department-select-Darin') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // ★ Every department + the "No department" option — DERIVED from
    //   DEPARTMENTS rather than a pinned count, so the next append does not
    //   have to edit this line. fix-464 wrote `7`; fix-487 made it 8 and took
    //   the number out.
    expect(values).toEqual(['', ...DEPARTMENTS]);
    expect(select.options.length).toBe(DEPARTMENTS.length + 1);
  });

  it('★★★ §B2: an EMPTY department renders as an empty group, not a gap', () => {
    // This is the failure the whole ticket corrects: the picker had nothing
    // that fitted three people, and there was no way to see that from here.
    render(
      <DepartmentEditor
        members={[row({ name: 'Cam', department: 'policy' })]}
        readOnly={false}
      />,
    );
    expect(screen.getByTestId('department-group-executive')).toBeTruthy();
    expect(screen.getByTestId('department-group-executive-empty').textContent).toBe(
      'Nobody yet.',
    );
    expect(screen.getByTestId('department-group-it_investor_relations')).toBeTruthy();
    // …and a department with somebody in it shows the count.
    expect(screen.getByTestId('department-group-policy-count').textContent).toBe('1');
  });

  it('★★ the unclassified group appears only when somebody is in it', () => {
    const { unmount } = render(
      <DepartmentEditor members={[row({ name: 'Darin' })]} readOnly={false} />,
    );
    expect(screen.getByTestId('department-group-none')).toBeTruthy();
    unmount();
    render(
      <DepartmentEditor
        members={[row({ name: 'Cam', department: 'executive' })]}
        readOnly={false}
      />,
    );
    // ★ It is the work remaining, not a department — so when it is empty it
    //   goes away entirely, unlike the six.
    expect(screen.queryByTestId('department-group-none')).toBeNull();
  });

  it('★★★ a new value writes by NAME, like the original four', () => {
    render(<DepartmentEditor members={[row({ name: 'Keenan' })]} readOnly={false} />);
    fireEvent.change(screen.getByTestId('department-select-Keenan'), {
      target: { value: 'it_investor_relations' },
    });
    expect(state.setDept).toHaveBeenCalledWith({
      name: 'Keenan',
      department: 'it_investor_relations',
    });
  });

  it('★★ readOnly: six groups are readable, nothing is editable', () => {
    render(
      <DepartmentEditor
        members={[row({ name: 'Darin', department: 'executive' })]}
        readOnly
      />,
    );
    expect(screen.getByTestId('department-value-Darin').textContent).toBe('Executive');
    expect(screen.queryByTestId('department-select-Darin')).toBeNull();
    expect(screen.getByTestId('department-group-executive')).toBeTruthy();
  });
});

describe('fix-464 — the per-person rule still holds for a NEW value', () => {
  it('★★★ two roster rows set to `executive` are ONE person, not a split', () => {
    // The mechanism must not care which value it is carrying. Proved against
    // prod in a rolled-back transaction too: setting one of Dave's two rows to
    // each of the six left `count(distinct department) = 1` every time.
    const people = foldRosterToPeople([
      row({ name: 'Dave', role: 'director', department: 'executive' }),
      row({ name: 'Dave', role: 'schematic', department: 'executive' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]!.department).toBe('executive');
    expect(people[0]!.split).toBeNull();
  });

  it('★★ …and a DISAGREEMENT across a new value is still shouted about', () => {
    const p = foldRosterToPeople([
      row({ name: 'Dave', role: 'director', department: 'executive' }),
      row({ name: 'Dave', role: 'schematic', department: 'it_investor_relations' }),
    ])[0]!;
    expect(p.department).toBeNull(); // refuses to pick
    expect(p.split).toEqual(['executive', 'it_investor_relations']);
  });
});
