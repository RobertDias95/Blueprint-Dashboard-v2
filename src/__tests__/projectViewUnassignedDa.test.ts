import { describe, it, expect } from 'vitest';
import {
  buildProjectRows,
  filterProjectRows,
  DEFAULT_FILTERS,
  UNASSIGNED_DA,
} from '../lib/projectViewHelpers';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-302 section 4: a permit with no DA must be discoverable without SQL.
//
// ★ fix-312 KEPT THIS, and it matters more now. fix-302's cascade was reverted,
// so ~107 permits went back to showing no DA — the truthful state. This filter
// is how they stay findable, and it is the one part of fix-302 Bobby did not
// ask to undo. Nothing here depends on the cascade: the sentinel is derived
// client-side from `da`, so it works exactly the same with the trigger gone.
//
// `permits.da` is how work is routed, and the per-user notification centre
// routes on it — a blank DA is work that reaches nobody. Before this, `das`
// collected non-empty names only, so an unassigned permit contributed nothing
// to the filter and the gap was invisible on the one screen built for triage.
// "Silence is the defect."

let permitId = 0;
function mkPermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: ++permitId,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: 'BP-1',
    stage: null,
    stage_override: null,
    da: null,
    dm: null,
    ent_lead: null,
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
    updated_at: '2026-08-13T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function mkProject(id: string): Project {
  return {
    id,
    address: `addr-${id}`,
    juris: 'Seattle',
    archived: false,
    notes: null,
  } as Project;
}

describe('fix-302: the DA filter can name "nobody is assigned"', () => {
  it('a project with an unassigned permit carries the sentinel in `das`', () => {
    const rows = buildProjectRows(
      [mkProject('p1')],
      [
        mkPermit({ project_id: 'p1', type: 'Building Permit', da: 'Trevor' }),
        mkPermit({ project_id: 'p1', type: 'ULS', da: null }),
      ],
      [],
    );
    expect(rows[0]!.das.has('Trevor')).toBe(true);
    expect(rows[0]!.das.has(UNASSIGNED_DA)).toBe(true);
  });

  it('a fully-assigned project does NOT carry the sentinel', () => {
    const rows = buildProjectRows(
      [mkProject('p1')],
      [
        mkPermit({ project_id: 'p1', type: 'Building Permit', da: 'Trevor' }),
        mkPermit({ project_id: 'p1', type: 'ULS', da: 'Trevor' }),
      ],
      [],
    );
    expect(rows[0]!.das.has(UNASSIGNED_DA)).toBe(false);
    expect([...rows[0]!.das]).toEqual(['Trevor']);
  });

  it('selecting "— Unassigned —" returns exactly the projects with a blank DA', () => {
    const rows = buildProjectRows(
      [mkProject('p1'), mkProject('p2')],
      [
        mkPermit({ project_id: 'p1', type: 'Building Permit', da: 'Trevor' }),
        mkPermit({ project_id: 'p1', type: 'ULS', da: null }),
        mkPermit({ project_id: 'p2', type: 'Building Permit', da: 'Cam' }),
        mkPermit({ project_id: 'p2', type: 'ULS', da: 'Cam' }),
      ],
      [],
    );
    const hit = filterProjectRows(rows, { ...DEFAULT_FILTERS, das: [UNASSIGNED_DA] });
    expect(hit.map((r) => r.project.id)).toEqual(['p1']);
  });

  it('composes with a named DA — "Cam OR unassigned" returns both', () => {
    const rows = buildProjectRows(
      [mkProject('p1'), mkProject('p2'), mkProject('p3')],
      [
        mkPermit({ project_id: 'p1', type: 'ULS', da: null }),
        mkPermit({ project_id: 'p2', type: 'ULS', da: 'Cam' }),
        mkPermit({ project_id: 'p3', type: 'ULS', da: 'Trevor' }),
      ],
      [],
    );
    const hit = filterProjectRows(rows, {
      ...DEFAULT_FILTERS,
      das: ['Cam', UNASSIGNED_DA],
    });
    expect(hit.map((r) => r.project.id).sort()).toEqual(['p1', 'p2']);
  });

  it('a SUB-permit with no DA does not raise the flag (it carries no assignment)', () => {
    // fix-194: subs are placeholders reviewed under a parent. Counting them
    // would report unrouted work that does not exist.
    const rows = buildProjectRows(
      [mkProject('p1')],
      [
        mkPermit({ id: 900, project_id: 'p1', type: 'Building Permit', da: 'Trevor' }),
        mkPermit({ project_id: 'p1', type: 'ULS', da: null, parent_permit_id: 900 }),
      ],
      [],
    );
    expect(rows[0]!.das.has(UNASSIGNED_DA)).toBe(false);
  });

  it('the sentinel cannot collide with a roster name', () => {
    // Load-bearing: the sentinel shares an option list with real DA names.
    expect(UNASSIGNED_DA).toMatch(/^—.*—$/);
    expect(UNASSIGNED_DA).not.toMatch(/^[A-Za-z]/);
  });

  it('no DA filter selected still returns everything (the sentinel is opt-in)', () => {
    const rows = buildProjectRows(
      [mkProject('p1'), mkProject('p2')],
      [
        mkPermit({ project_id: 'p1', type: 'ULS', da: null }),
        mkPermit({ project_id: 'p2', type: 'ULS', da: 'Cam' }),
      ],
      [],
    );
    expect(filterProjectRows(rows, DEFAULT_FILTERS)).toHaveLength(2);
  });
});
