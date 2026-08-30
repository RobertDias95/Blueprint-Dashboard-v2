import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_377_lead_cascade.sql?raw';
import backfillSql // ★ fix-450 renamed this file: re-measured 2026-08-30, its predicate
//   selects 0 rows today, so it is SUPERSEDED rather than pending. The
//   SQL below is unchanged — the supersession keeps the predicate.
from '../../migrations/fix_377_backfill_SUPERSEDED.sql?raw';

/** ★ The file explains itself at length, so every "the SQL does not say X"
 *  assertion has to read the CODE and not the prose — the same trap fix-369,
 *  fix-371 and fix-372 each hit once. */
const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

// ===========================================================================
// fix-377 — reassigning a project moves nobody's work
// ===========================================================================
//
// ★★★ AMENDED BY fix-379: the design_manager → dm half of the PROJECT cascade
// was removed (permits.dm is derived from the permit's DA — see
// migrations/fix_379_dm_derived.sql and DmDerivedFix379.test.ts). The mirror
// below models the CURRENT prod behaviour: entitlement_lead cascades, the
// permit-level trigger is unchanged, and a project design_manager change
// moves nothing on permits.
//
// No live DB in CI (fix-153 / fix-220 / fix-244 / fix-368 precedent), so this
// is a pure-TS mirror of the two triggers plus a documented ROLLED-BACK prod
// probe. If the SQL and this mirror ever disagree, one of them is wrong — they
// are written to be read side by side.
//
// ---------------------------------------------------------------------------
// PROD PROBE A — 2026-08-21, project eibnmwthkcuumyclyxoe, ROLLED BACK by
// RAISE EXCEPTION. A project with four permits and four tasks; both leads
// changed in one UPDATE.
//
//   A unissued  ent_lead=ZZ_New_Ent  dm=ZZ_New_DM  da=ZZ_DA   ← da NOT touched
//   B ISSUED    ent_lead=ZZ_Old_Ent  dm=ZZ_Old_DM             ← frozen
//   C ent NULL  ent_lead=NULL                                 ← ★ fix-312
//   D third     ent_lead=ZZ_Third_Person                      ← deliberate
//   t1 open, filed under the old ent lead  → ZZ_New_Ent
//   t2 on the role token 'Entitlements'    → Entitlements     ← untouched
//   t3 Resolved                            → ZZ_Old_Ent       ← frozen
//   t4 open, filed under the old DM        → ZZ_New_DM
//   t2 co-assignees: ZZ_New_Ent/manual + ZZ_Old_DM/dm_of_da   ← ★ auto kept
//   t3 co-assignees: ZZ_Old_Ent/manual                        ← closed, frozen
//
// PROD PROBE B — same session, also rolled back. A DA changed ON THE PERMIT,
// with a draw_schedule row and the two co-assignee edge cases:
//
//   permit da       = ZZ_DA_New
//   t1 assigned_to  = ZZ_DA_New       (moved)
//   t2 assigned_to  = Entitlements    (role token, untouched)
//   t3 assigned_to  = ZZ_DA_New       (moved)
//   t2 co-assignees : ZZ_DA_New/manual   ← COLLISION: the incoming person was
//                                          already a co-assignee; one row, no
//                                          unique violation
//   t3 co-assignees : (none)             ← SELF: the task became theirs, so
//                                          their own co-assignee row withdrew
//   draw_schedule   : ZZ_DA_New          ← synced, one hop, then it stopped
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mirror of the SQL
// ---------------------------------------------------------------------------
type Source = 'manual' | 'dm_of_da' | 'dm_of_project';

interface Project {
  id: string;
  entitlement_lead: string | null;
  design_manager: string | null;
  acq_lead?: string | null;
  schematic_designer?: string[] | null;
}
interface Permit {
  id: number;
  project_id: string;
  type: string;
  ent_lead: string | null;
  dm: string | null;
  da: string | null;
  architect?: string | null;
  permit_owner?: string | null;
  actual_issue: string | null;
}
interface Task {
  id: string;
  permit_id: number;
  assigned_to: string | null;
  completion_status: string | null;
  done: boolean | null;
  co_assignees: string[] | null;
}
interface CoAssignee {
  task_id: string;
  assignee: string;
  source: Source;
}
interface Db {
  projects: Project[];
  permits: Permit[];
  tasks: Task[];
  coAssignees: CoAssignee[];
  drawSchedule: { project_id: string; da_assigned: string | null }[];
}

/** Mirror of SQL bp_task_is_open(text, boolean). BOTH signals, because
 *  fix-235 found 186 rows where they disagreed. */
export function taskIsOpen(status: string | null, done: boolean | null): boolean {
  return !['Resolved', 'Cancelled'].includes(status ?? 'Open') && (done ?? false) === false;
}

const norm = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Mirror of the trigger bp_sync_draw_schedule_da (fix-225 / pre-existing).
 *  Present only to show that the cascade TERMINATES here — nothing on
 *  draw_schedule writes back to permits or projects. */
function syncDrawSchedule(db: Db, permit: Permit, newDa: string | null) {
  if (newDa === null || permit.type !== 'Building Permit') return;
  for (const row of db.drawSchedule) {
    if (row.project_id === permit.project_id && !same(row.da_assigned, newDa)) {
      row.da_assigned = newDa;
    }
  }
}

/** Mirror of SQL bp_trg_permit_lead_cascade(): AFTER UPDATE OF ent_lead, dm,
 *  da ON permits. Returns the number of write statements that matched, purely
 *  so the tests can assert "nothing happened" as a fact rather than by absence. */
export function permitLeadCascade(
  db: Db,
  permit: Permit,
  before: Pick<Permit, 'ent_lead' | 'dm' | 'da'>,
): void {
  // An issued permit is a finished file.
  if (permit.actual_issue !== null) return;

  const pairs: [string | null, string | null][] = [
    [norm(before.ent_lead), norm(permit.ent_lead)],
    [norm(before.dm), norm(permit.dm)],
    [norm(before.da), norm(permit.da)],
  ];

  for (const [vOld, vNew] of pairs) {
    // ★ NOTHING HAPPENS WITHOUT AN OLD NAME. This single line is the whole
    // difference from fix-302 — see the block comment further down.
    if (vOld === null) continue;
    if (vNew === null) continue;
    if (same(vOld, vNew)) continue;

    const tasks = db.tasks.filter((t) => t.permit_id === permit.id);

    // 2a. the primary owner
    for (const t of tasks) {
      if (same(t.assigned_to, vOld) && taskIsOpen(t.completion_status, t.done)) {
        t.assigned_to = vNew;
      }
    }

    // 2b. co-assignees — MANUAL rows only, delete-then-insert
    const openIds = new Set(
      tasks.filter((t) => taskIsOpen(t.completion_status, t.done)).map((t) => t.id),
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));

    const toAdd = db.coAssignees.filter(
      (a) =>
        openIds.has(a.task_id) &&
        a.source === 'manual' &&
        same(a.assignee, vOld) &&
        !same(byId.get(a.task_id)!.assigned_to, vNew),
    );
    for (const a of toAdd) {
      const exists = db.coAssignees.some(
        (b) => b.task_id === a.task_id && same(b.assignee, vNew),
      );
      if (!exists) db.coAssignees.push({ task_id: a.task_id, assignee: vNew, source: 'manual' });
    }
    db.coAssignees = db.coAssignees.filter(
      (a) => !(openIds.has(a.task_id) && a.source === 'manual' && same(a.assignee, vOld)),
    );
    // never co-assigned to your own task (fix-346 rule 4)
    db.coAssignees = db.coAssignees.filter(
      (a) =>
        !(
          openIds.has(a.task_id) &&
          same(byId.get(a.task_id)!.assigned_to, vNew) &&
          same(a.assignee, vNew)
        ),
    );

    // 2c. the legacy array column — edited within, never rebuilt
    for (const t of tasks) {
      if (t.co_assignees && taskIsOpen(t.completion_status, t.done)) {
        t.co_assignees = t.co_assignees.map((n) => (n === vOld ? vNew : n));
      }
    }
  }
}

/** The direct permit-bar edit path: change a lead ON A PERMIT. */
export function updatePermit(db: Db, permitId: number, patch: Partial<Permit>): void {
  const p = db.permits.find((x) => x.id === permitId)!;
  const before = { ent_lead: p.ent_lead, dm: p.dm, da: p.da };
  Object.assign(p, patch);
  if (!same(before.da, p.da)) syncDrawSchedule(db, p, norm(p.da));
  if (
    !same(before.ent_lead, p.ent_lead) ||
    !same(before.dm, p.dm) ||
    !same(before.da, p.da)
  ) {
    permitLeadCascade(db, p, before);
  }
}

/** Mirror of SQL bp_trg_project_lead_cascade(): AFTER UPDATE OF
 *  entitlement_lead ON projects.
 *
 *  ★★★ fix-379 REMOVED the design_manager → dm half: permits.dm is DERIVED
 *  from the permit's DA (bp_trg_permit_derive_dm, see DmDerivedFix379), so a
 *  project reassignment moves nothing on permits. The entitlement half is
 *  untouched — ent_lead genuinely is assigned per permit. */
export function updateProject(db: Db, projectId: string, patch: Partial<Project>): void {
  const pr = db.projects.find((x) => x.id === projectId)!;
  const before = { entitlement_lead: pr.entitlement_lead, design_manager: pr.design_manager };
  Object.assign(pr, patch);

  const moves: [keyof Permit, string | null, string | null][] = [
    ['ent_lead', norm(before.entitlement_lead), norm(pr.entitlement_lead)],
  ];

  for (const [field, vOld, vNew] of moves) {
    if (vOld === null || vNew === null || same(vOld, vNew)) continue;
    for (const p of db.permits) {
      if (p.project_id !== projectId) continue;
      if (p.actual_issue !== null) continue;
      if (!same(p[field] as string | null, vOld)) continue;
      updatePermit(db, p.id, { [field]: vNew } as Partial<Permit>);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function db(): Db {
  return {
    projects: [
      {
        id: 'P1',
        entitlement_lead: 'Briana',
        design_manager: 'Lindsay',
        acq_lead: 'Dave',
        schematic_designer: ['Ana'],
      },
    ],
    permits: [
      // 1: live, both leads match the project
      { id: 1, project_id: 'P1', type: 'Building Permit', ent_lead: 'Briana', dm: 'Lindsay', da: 'Cam', actual_issue: null },
      // 2: ISSUED
      { id: 2, project_id: 'P1', type: 'Demolition', ent_lead: 'Briana', dm: 'Lindsay', da: null, actual_issue: '2026-05-01' },
      // 3: no ent lead at all — the fix-312 case
      { id: 3, project_id: 'P1', type: 'ULS', ent_lead: null, dm: null, da: null, actual_issue: null },
      // 4: deliberately assigned to somebody else
      { id: 4, project_id: 'P1', type: 'PAR/Pre-Sub', ent_lead: 'Bobby', dm: null, da: null, actual_issue: null, architect: 'Francesca', permit_owner: 'Entitlements' },
    ],
    tasks: [
      { id: 't1', permit_id: 1, assigned_to: 'Briana', completion_status: 'Open', done: false, co_assignees: [] },
      { id: 't2', permit_id: 1, assigned_to: 'Entitlements', completion_status: 'Open', done: false, co_assignees: [] },
      { id: 't3', permit_id: 1, assigned_to: 'Briana', completion_status: 'Resolved', done: true, co_assignees: [] },
      { id: 't4', permit_id: 1, assigned_to: 'Lindsay', completion_status: 'In Progress', done: false, co_assignees: [] },
      { id: 't5', permit_id: 2, assigned_to: 'Briana', completion_status: 'Open', done: false, co_assignees: [] },
      { id: 't6', permit_id: 4, assigned_to: 'Bobby', completion_status: 'Open', done: false, co_assignees: [] },
    ],
    coAssignees: [
      { task_id: 't2', assignee: 'Briana', source: 'manual' },
      // ★ NAMED FOR THE OUTGOING DM ON PURPOSE. A derived row that happens to
      // name a bystander proves nothing — this one is exactly the row a
      // careless rename would rewrite.
      { task_id: 't2', assignee: 'Lindsay', source: 'dm_of_da' },
      { task_id: 't3', assignee: 'Briana', source: 'manual' },
    ],
    drawSchedule: [{ project_id: 'P1', da_assigned: 'Cam' }],
  };
}

const permit = (d: Db, id: number) => d.permits.find((p) => p.id === id)!;
const task = (d: Db, id: string) => d.tasks.find((t) => t.id === id)!;
const co = (d: Db, id: string) =>
  d.coAssignees
    .filter((a) => a.task_id === id)
    .map((a) => `${a.assignee}/${a.source}`)
    .sort();

// ---------------------------------------------------------------------------
describe('fix-377 §1 — the project lead moves onto its permits', () => {
  it('renames the entitlement lead on every UNISSUED permit that carried it', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(permit(d, 1).ent_lead).toBe('Miles');
  });

  it('★★★ fix-379: a design_manager change moves NOTHING — dm follows the DA, not the project', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(permit(d, 1).ent_lead).toBe('Miles'); // the ent half still cascades
    expect(permit(d, 1).dm).toBe('Lindsay'); // the design half no longer fires
    expect(task(d, 't4').assigned_to).toBe('Lindsay'); // and no task moves for it
  });

  it('leaves an ISSUED permit exactly as it was — it is the record of who took it through', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(permit(d, 2).ent_lead).toBe('Briana');
    expect(permit(d, 2).dm).toBe('Lindsay');
  });

  it('does not fire at all when the lead is set to the same name again', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Briana' });
    expect(task(d, 't1').assigned_to).toBe('Briana');
    expect(co(d, 't2')).toEqual(['Briana/manual', 'Lindsay/dm_of_da']);
  });

  it('does nothing when the project lead is CLEARED — an empty box is not a reassignment', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: null });
    expect(permit(d, 1).ent_lead).toBe('Briana');
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 — ★★★ the fix-312 safety property', () => {
  // fix-302 was reverted because it CREATED design-associate assignments: it
  // put a DA on 102 permits that should not have had one. Bobby: "A design
  // associate and/or design manager should never be assigned to a ULS."
  //
  // ★★★ This cascade cannot do that, and the reason is the WHERE clause rather
  // than a permit-type exclusion list — which fix-312 explicitly declined.

  it('a permit whose lead is NULL stays NULL — it is never GIVEN one', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(permit(d, 3).ent_lead).toBeNull();
    expect(permit(d, 3).dm).toBeNull();
    expect(permit(d, 3).da).toBeNull();
  });

  it('the ULS in the fixture is untouched WITHOUT the rule naming a permit type', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(permit(d, 3)).toEqual(
      db().permits.find((p) => p.type === 'ULS'),
    );
    expect(sqlCode).not.toMatch(/type\s*(=|<>|NOT\s+IN|IN)\s*\(?\s*'(ULS|IPR|PAR)/i);
  });

  it('a permit deliberately assigned to somebody else keeps that person', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(permit(d, 4).ent_lead).toBe('Bobby');
    expect(task(d, 't6').assigned_to).toBe('Bobby');
  });

  it('there is no projects.da, so a design associate never cascades DOWN', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(permit(d, 1).da).toBe('Cam');
    expect(sqlCode).not.toMatch(/SET\s+da\s*=/i);
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 §2 — and from the permit onto the open tasks', () => {
  it("moves an open task filed under the outgoing lead's name", () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't1').assigned_to).toBe('Miles');
  });

  it('moves an In Progress task, which is still somebody working', () => {
    const d = db();
    // fix-379: the dm change arrives via the PERMIT (the derivation re-deriving
    // it on a DA change), never via the project — the permit-level cascade is
    // untouched and still moves the outgoing manager's live work.
    updatePermit(d, 1, { dm: 'Brittani' });
    expect(task(d, 't4').assigned_to).toBe('Brittani');
  });

  it('never touches a Resolved task — finished work is not reassigned', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't3').assigned_to).toBe('Briana');
    expect(co(d, 't3')).toEqual(['Briana/manual']);
  });

  it('never touches a task on an issued permit', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't5').assigned_to).toBe('Briana');
  });

  it('★ leaves a ROLE token alone — "Entitlements" is not a person who moved', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't2').assigned_to).toBe('Entitlements');
  });

  it('reads BOTH done signals, because fix-235 found 186 rows that disagreed', () => {
    expect(taskIsOpen('Open', false)).toBe(true);
    expect(taskIsOpen('In Progress', false)).toBe(true);
    expect(taskIsOpen('Resolved', false)).toBe(false);
    expect(taskIsOpen('Open', true)).toBe(false);
    expect(taskIsOpen('Cancelled', false)).toBe(false);
    expect(taskIsOpen(null, null)).toBe(true);
  });

  it('a lead changed on the PERMIT BAR alone moves the same work', () => {
    const d = db();
    updatePermit(d, 1, { ent_lead: 'Miles' });
    expect(task(d, 't1').assigned_to).toBe('Miles');
    expect(d.projects[0].entitlement_lead).toBe('Briana'); // the project is not rewritten
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 §3 — what happens to fix-368 co-assignees', () => {
  it('renames a MANUAL co-assignee, because a person typed that name', () => {
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(co(d, 't2')).toContain('Miles/manual');
    expect(co(d, 't2')).not.toContain('Briana/manual');
  });

  it('★★ leaves a DERIVED co-assignee alone — dm_of_da is the output of a rule', () => {
    const d = db();
    // Lindsay is BOTH the outgoing design manager and a dm_of_da co-assignee on
    // t2. The lead move must rewrite neither: that row is the output of
    // bp_coassign_for_task, and fix-368's own trigger re-asserts it.
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(co(d, 't2')).toContain('Lindsay/dm_of_da');
    expect(co(d, 't2')).not.toContain('Brittani/dm_of_da');
  });

  it('the derived sources are named in the SQL so the restriction is explicit', () => {
    expect(migrationSql).toMatch(/a\.source\s*=\s*'manual'/);
    expect(sqlCode).not.toMatch(/a\.source\s+IN\s*\(\s*'dm_of_da'/);
  });

  it('a collision resolves to ONE row rather than a unique violation', () => {
    const d = db();
    d.coAssignees.push({ task_id: 't2', assignee: 'Miles', source: 'manual' });
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(co(d, 't2').filter((s) => s.startsWith('Miles'))).toEqual(['Miles/manual']);
  });

  it('★ nobody is left co-assigned to their own task (fix-346 rule 4)', () => {
    const d = db();
    // Miles is already a manual co-assignee on t1, which is about to become his
    d.coAssignees.push({ task_id: 't1', assignee: 'Miles', source: 'manual' });
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't1').assigned_to).toBe('Miles');
    expect(co(d, 't1')).toEqual([]);
  });

  it('the legacy co_assignees ARRAY is edited within, never rebuilt', () => {
    const d = db();
    task(d, 't1').co_assignees = ['Derry', 'Briana', 'Ana'];
    updateProject(d, 'P1', { entitlement_lead: 'Miles' });
    expect(task(d, 't1').co_assignees).toEqual(['Derry', 'Miles', 'Ana']); // order kept
    expect(migrationSql).toContain('array_replace(t.co_assignees');
    expect(sqlCode).not.toMatch(/SET\s+co_assignees\s*=\s*ARRAY\[/i);
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 §4 — the draw schedule, and why there is no loop', () => {
  it('a DA rename on a Building Permit reaches the draw board', () => {
    const d = db();
    updatePermit(d, 1, { da: 'Shire' });
    expect(d.drawSchedule[0].da_assigned).toBe('Shire');
    expect(task(d, 't1').assigned_to).toBe('Briana'); // t1 was the ent lead's, not the DA's
  });

  it('★★★ the write graph is acyclic, so a cascade terminates', () => {
    // projects → permits → draw_schedule
    // permits  → permit_tasks → permit_task_assignees
    // Verified on prod: neither draw_schedule nor permit_task_assignees carries
    // a trigger writing back to permits or projects, so no flag is needed.
    const d = db();
    updateProject(d, 'P1', { entitlement_lead: 'Miles', design_manager: 'Brittani' });
    expect(d.drawSchedule[0].da_assigned).toBe('Cam'); // no lead change reached the DA
    expect(permit(d, 1).ent_lead).toBe('Miles');
  });

  it("does NOT borrow fix-225's app.bp_skip_da_sync freeze flag", () => {
    // That flag means "this project is mid-handoff, hold the board still".
    // Setting it here would erode that meaning for the sake of a loop that
    // does not exist.
    expect(sqlCode).not.toContain('bp_skip_da_sync');
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 §4 — it is on the ROW, not in a React handler', () => {
  it('ships two triggers, on projects and on permits', () => {
    // ★ The fix-377 FILE is history: it shipped watching design_manager too.
    // fix-379 (migrations/fix_379_dm_derived.sql) redefined the projects
    // trigger to entitlement_lead only — DmDerivedFix379.test.ts asserts the
    // CURRENT definition; this asserts what fix-377 shipped.
    expect(migrationSql).toMatch(
      /CREATE TRIGGER projects_cascade_lead\s+AFTER UPDATE OF entitlement_lead, design_manager ON public\.projects/,
    );
    expect(migrationSql).toMatch(
      /CREATE TRIGGER permits_lead_cascade\s+AFTER UPDATE OF ent_lead, dm, da ON public\.permits/,
    );
  });

  it('★ sorts before projects_dm_coassign, so fix-368 gets the last word', () => {
    // Postgres fires same-event triggers in NAME order.
    expect('projects_cascade_lead' < 'projects_dm_coassign').toBe(true);
  });

  it('no React component reassigns leads by hand', async () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('__tests__') && !path.includes('.test.'))
      .filter(([, src]) => {
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        // a client-side loop rewriting ent_lead/dm across many permits
        return /\.from\(['"]permits['"]\)[\s\S]{0,200}\.update\([\s\S]{0,120}\b(ent_lead|dm)\b[\s\S]{0,200}project_id/.test(
          stripped,
        );
      })
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 — the SQL keys on the OLD name, everywhere', () => {
  it('every write is guarded by an exact match with the outgoing name', () => {
    const writes = sqlCode
      .match(/(UPDATE|DELETE FROM|INSERT INTO)\s+public\.\w+[\s\S]*?;/g)!;
    // Each write statement mentions v_old, or is the paired INSERT/DELETE that
    // the v_old match selected rows for.
    expect(writes.length).toBeGreaterThan(4);
    for (const w of writes) {
      expect(w).toMatch(/v_old|lower\(v_new\)/);
    }
  });

  it('restricts the permit half to unissued permits', () => {
    expect(migrationSql).toMatch(/p\.actual_issue IS NULL/);
    expect(migrationSql).toMatch(/IF NEW\.actual_issue IS NOT NULL THEN\s+RETURN NULL;/);
  });

  it('restricts the task half through the one shared predicate', () => {
    const calls = migrationSql.match(/public\.bp_task_is_open\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('pins search_path and keeps anon out, per fix-157', () => {
    const fns = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)!;
    expect(fns.length).toBe(4);
    for (const m of migrationSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)) {
      expect(migrationSql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${m[1]}\\(`));
    }
    expect((migrationSql.match(/SET search_path TO 'public'/g) ?? []).length).toBe(4);
  });

  it('excludes the fields that are not the same fact twice', () => {
    for (const excluded of ['acq_lead', 'schematic_designer', 'architect', 'permit_owner']) {
      expect(sqlCode).not.toContain(excluded);
    }
  });
});

// ---------------------------------------------------------------------------
describe('fix-377 §5 — the backfill is produced and NOT applied', () => {
  it('lives in its own file, and every statement in it is commented out', () => {
    const live = backfillSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('says on its face that it has not been run', () => {
    expect(backfillSql).toMatch(/NOT\s+APPLIED/i);
    expect(backfillSql).toMatch(/AWAITING/i);
  });

  it('the applied migration does not contain it', () => {
    // The backfill's shape is an UPDATE of permits JOINED to projects. The
    // trigger only ever writes a local variable, so neither of these appears.
    expect(sqlCode).not.toMatch(/SET\s+ent_lead\s*=\s*pr\./);
    expect(sqlCode).not.toMatch(/SET\s+dm\s*=\s*pr\./);
    expect(sqlCode).not.toMatch(/UPDATE public\.permits[^;]*FROM public\.projects/);
  });

  it('ships a standing drift report so this is never measured by hand again', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.bp_lead_drift_report()');
    // ★ it returns the discriminator, not just a count — 55 of the 66 divergent
    // ent_lead rows are deliberate assignments, not drift.
    expect(migrationSql).toContain('lead_is_ever_a_project_lead');
    expect(migrationSql).toMatch(/tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/);
  });

  it('the mirror agrees with the measured backfill: 6 ent_lead permits, 0 tasks', () => {
    // Reproduced from the prod measurement, both drifted projects:
    const d: Db = {
      projects: [
        { id: 'A', entitlement_lead: 'Briana', design_manager: null },
        { id: 'B', entitlement_lead: 'Miles', design_manager: null },
      ],
      permits: [
        { id: 10, project_id: 'A', type: 'ULS', ent_lead: 'Miles', dm: null, da: null, actual_issue: null },
        { id: 11, project_id: 'A', type: 'Building Permit', ent_lead: 'Miles', dm: null, da: null, actual_issue: null },
        { id: 20, project_id: 'B', type: 'ULS', ent_lead: 'Briana', dm: null, da: null, actual_issue: null },
        { id: 21, project_id: 'B', type: 'Building Permit', ent_lead: 'Briana', dm: null, da: null, actual_issue: null },
        { id: 22, project_id: 'B', type: 'Demolition', ent_lead: 'Briana', dm: null, da: null, actual_issue: null },
        { id: 23, project_id: 'B', type: 'IPR', ent_lead: 'Briana', dm: null, da: null, actual_issue: null },
        // the three Seward Park permits, ISSUED — excluded by the boundary
        { id: 30, project_id: 'A', type: 'Building Permit', ent_lead: 'Briana', dm: null, da: null, actual_issue: '2026-02-02' },
      ],
      tasks: [
        // the two open tasks on 10430 66th Ave S are already Briana's
        { id: 'x1', permit_id: 10, assigned_to: 'Briana', completion_status: 'Open', done: false, co_assignees: [] },
        { id: 'x2', permit_id: 10, assigned_to: 'Briana', completion_status: 'Open', done: false, co_assignees: [] },
      ],
      coAssignees: [],
      drawSchedule: [],
    };

    const beforePermits = d.permits.map((p) => p.ent_lead);
    const beforeTasks = d.tasks.map((t) => t.assigned_to);

    // What the trigger WOULD have done had it existed when the leads changed.
    updateProject(d, 'A', { entitlement_lead: 'Briana' }); // no-op: already Briana
    for (const p of d.permits) {
      if (p.actual_issue !== null) continue;
      const pr = d.projects.find((x) => x.id === p.project_id)!;
      if (pr.entitlement_lead && p.ent_lead && !same(p.ent_lead, pr.entitlement_lead)) {
        updatePermit(d, p.id, { ent_lead: pr.entitlement_lead });
      }
    }

    const changedPermits = d.permits.filter((p, i) => p.ent_lead !== beforePermits[i]);
    const changedTasks = d.tasks.filter((t, i) => t.assigned_to !== beforeTasks[i]);

    expect(changedPermits.map((p) => p.id)).toEqual([10, 11, 20, 21, 22, 23]);
    expect(permit(d, 30).ent_lead).toBe('Briana'); // issued, frozen
    expect(changedTasks).toEqual([]); // ★ not one task moves
  });
});
