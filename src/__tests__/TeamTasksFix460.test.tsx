import { describe, it, expect } from 'vitest';
import {
  taskSource,
  isTeamTask,
  taskKind,
  taskContextLine,
  TEAM_TASK_CONTEXT,
  TASK_KIND_LABEL,
} from '../lib/taskSource';
import { isUnclaimedTask } from '../lib/unclaimedWork';
import { isDesignTask } from '../lib/myBoard';
import { isPermitHeld } from '../lib/permitHoldWindows';
import { isCancelledProject } from '../lib/projectViewHelpers';
import { taskStatusUpsertInput } from '../lib/taskStatusWrite';
import type { MyTaskNode } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-460 (P-046) — A TASK THAT BELONGS TO NO PERMIT
// ===========================================================================
//
// Bobby, 2026-08-26, on the shim this is NOT:
//   *"I'm not 100% sure I love the idea or concept around a fake project…
//     we need to develop, expand, or create the ability to have the option of
//     creating a task that's not associated with a project and a permit
//     holistically."*
// …and on the surface it does NOT add:
//   *"I don't know that I really want a third board lane."*
//
// ★★★ SO THE WHOLE DESIGN IS: one task concept, permit optional, blended on
// `discipline` — the column the two existing lanes already render. The tests
// below are that sentence, checked.
//
// ★★ MEASURED ON PROD 2026-08-30: `permit_tasks.permit_id` is `integer NOT
// NULL` across 1,643 rows and STAYS SO; `discipline` holds exactly `ent`
// (1,194) and `arch` (446). team_tasks is a new table and bp_list_tasks unions
// the two.

/** A row as `bp_list_tasks` emits it for a TEAM task — every permit-derived
 *  field NULL, because there is no permit to derive it from. */
function teamTask(over: Partial<MyTaskNode> = {}): MyTaskNode {
  return {
    id: 'tt-1',
    permit_id: null,
    project_id: null,
    project_address: null,
    permit_type: null,
    permit_da: null,
    parent_task_id: null,
    discipline: 'ent',
    bucket: 'pm',
    text: 'Renew the ULS filing calendar',
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
    ...over,
  } as unknown as MyTaskNode;
}

/** A row as it has always been emitted for a PERMIT task. */
function permitTask(over: Partial<MyTaskNode> = {}): MyTaskNode {
  return {
    ...teamTask(),
    id: 'pt-1',
    permit_id: 10096,
    project_id: 'proj-1',
    project_address: '215 31st Ave',
    permit_type: 'Building Permit',
    permit_da: 'Cam',
    discipline: 'arch',
    bucket: 'de',
    primary_assignee: 'Cam',
    source: 'permit',
    ...over,
  } as unknown as MyTaskNode;
}

describe('fix-460 — the source field', () => {
  it('★★★ a row with no `source` is a PERMIT task', () => {
    // Hundreds of fixtures across the suite predate this field and every one of
    // them is a permit task. Reading missing as 'permit' is what let the union
    // ship without touching them.
    expect(taskSource({})).toBe('permit');
    expect(isTeamTask({})).toBe(false);
    expect(taskSource({ source: 'team' })).toBe('team');
  });
});

describe('fix-460 §B1 — it lands in an EXISTING lane', () => {
  it("★★★ discipline decides the lane, exactly as it does for a permit task", () => {
    // `myBoard.isDesignTask` is literally `t.discipline === 'arch'`. A team task
    // carrying a discipline therefore lands in a lane that already exists —
    // which IS the ruling ("no third board lane"), expressed as data.
    expect(isDesignTask(teamTask({ discipline: 'arch' }))).toBe(true);
    expect(isDesignTask(teamTask({ discipline: 'ent' }))).toBe(false);
    // …and it answers the same as a permit task with the same discipline.
    expect(isDesignTask(teamTask({ discipline: 'arch' }))).toBe(
      isDesignTask(permitTask({ discipline: 'arch' })),
    );
  });
});

describe('fix-460 §B3 — it can NEVER appear in a project or permit view', () => {
  it('★★★ it carries no project_id and no permit_id — the property, not a rule', () => {
    const t = teamTask();
    expect(t.permit_id).toBeNull();
    expect(t.project_id).toBeNull();
    // A permit view filters on permit_id and a project view on project_id, so a
    // team task cannot match either however it is linked. `ref_project_id` is
    // stored on the table and deliberately NOT surfaced here.
    const permitViewRows = [teamTask(), permitTask()].filter(
      (x) => x.permit_id === 10096,
    );
    expect(permitViewRows.map((x) => x.id)).toEqual(['pt-1']);
    const projectViewRows = [teamTask(), permitTask()].filter(
      (x) => x.project_id === 'proj-1',
    );
    expect(projectViewRows.map((x) => x.id)).toEqual(['pt-1']);
  });

  it('★★ nothing about holds or cancellation can catch it either', () => {
    // A hold is a property of a permit or a project; a team task has neither.
    expect(
      isPermitHeld({ id: null, project_id: null }, new Set(['proj-1']), new Set([10096])),
    ).toBe(false);
    expect(isCancelledProject(null, new Set(['proj-1']))).toBe(false);
  });
});

describe('fix-460 — unclaimed BY CONSTRUCTION (fix-458, unedited)', () => {
  it('★★★ an unassigned team task reaches nobody', () => {
    // The resolver has no ent_lead and no da to fall back to, because there is
    // no permit. fix-458's predicate is used verbatim — this ticket edited
    // neither it nor resolvePrimaryAssignee.
    const ctx = { da: null, dm: null, entLead: null, schematicDesigners: [] };
    expect(isUnclaimedTask(teamTask({ assigned_to: null }), ctx)).toBe(true);
    // ★ …and assigning it makes it claimed, with nothing else changing.
    expect(isUnclaimedTask(teamTask({ assigned_to: 'Miles' }), ctx)).toBe(false);
  });

  it('★★ it is NOT swallowed by the 130 that still reach somebody', () => {
    // A permit task with a DA resolves to that DA; the team task beside it does
    // not, and the difference is the missing permit, not the missing assignee.
    const withDa = { da: 'Cam', dm: null, entLead: null, schematicDesigners: [] };
    expect(isUnclaimedTask(permitTask({ assigned_to: null }), withDa)).toBe(false);
    expect(isUnclaimedTask(teamTask({ assigned_to: null, discipline: 'arch' }), {
      da: null, dm: null, entLead: null, schematicDesigners: [],
    })).toBe(true);
  });
});

describe('fix-460 §B2/§B4 — the only visible difference', () => {
  it('★★★ a team task says what it is where a project task shows an address', () => {
    expect(taskContextLine(permitTask())).toBe('215 31st Ave');
    expect(taskContextLine(teamTask())).toBe(TEAM_TASK_CONTEXT);
  });

  it('★★ it does NOT borrow an address even when it links to a project', () => {
    // ref_project_id is data for a later ticket. Giving it a rendering path
    // would make a team task look like it lives somewhere — the one impression
    // this design must never give.
    expect(taskContextLine(teamTask({ project_address: '215 31st Ave' }))).toBe(
      TEAM_TASK_CONTEXT,
    );
  });

  it('★★★ an ordinary permit task carries NO tag', () => {
    // 1,643 of 1,643 rows are ordinary permit tasks. A tag on every one of them
    // would be 1,643 badges saying "normal".
    expect(taskKind(permitTask())).toBeNull();
    expect(taskKind(teamTask())).toBe('team');
    expect(taskKind(permitTask({ is_auto_generated: true }))).toBe('bot');
    expect(TASK_KIND_LABEL.team).toBe('Team');
    expect(TASK_KIND_LABEL.bot).toBe('Auto');
  });

  it('★ bot beats team, though the two can never both be true', () => {
    // team_tasks has no generator and the RPC sends is_auto_generated:false for
    // every team row BY CONSTRUCTION. The precedence is stated so a future
    // writer cannot make the question ambiguous by accident.
    expect(taskKind(teamTask({ is_auto_generated: true }))).toBe('bot');
  });
});

describe('fix-460 §A4 — the permit writer is unreachable for a team task', () => {
  it('★★★ taskStatusUpsertInput THROWS rather than inventing a permit', () => {
    // `bp_upsert_permit_task`'s whole contract is a permit. useSetTaskStatus
    // routes team tasks to bp_set_team_task_status before this is reached; the
    // throw is what makes that routing a guarantee rather than a convention.
    expect(() =>
      taskStatusUpsertInput(
        {
          id: 'tt-1', permit_id: null, parent_task_id: null,
          discipline: 'ent', text: 'x', start_date: null, target_date: null,
        },
        'Resolved',
      ),
    ).toThrow(/team task has no permit/i);
  });

  it('★★ …and a permit task still builds the payload it always did', () => {
    const out = taskStatusUpsertInput(
      {
        id: 'pt-1', permit_id: 10096, parent_task_id: null,
        discipline: 'arch', text: 'x', start_date: null, target_date: null,
      },
      'Resolved',
    );
    expect(out.permitId).toBe(10096);
    expect(out.status).toBe('Resolved');
  });
});
