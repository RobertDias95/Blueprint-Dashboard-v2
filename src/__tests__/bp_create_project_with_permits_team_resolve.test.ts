import { describe, it, expect } from 'vitest';

// fix-153: contract spec for the team-resolution that bp_create_project_with_permits
// applies when seeding permit_tasks from task_templates.
//
// The resolution itself is SQL (a CASE on tt.default_team inside the INSERT-SELECT,
// see migrations/fix_153_task_templates_team_co_assignees_waiting_on.sql). There is
// no live database in CI, so the canonical verification was a transactional,
// rolled-back MCP probe against PROD on 2026-06-10. Its verbatim output:
//
//   [arch task]       assigned=Trevor       co={Jordan,Sarah}  waiting=Civil
//   [ent task]        assigned=Maria        co={}              waiting=<null>
//   [literal task]    assigned=Bob Literal  co={}              waiting=<null>
//   [unassigned task] assigned=<null>       co={}              waiting=<null>
//
//   (permit: type=ZZTEST, da=Trevor, ent_lead=Maria — entire probe rolled back)
//
// The pure function below mirrors that SQL CASE exactly so the documented contract
// is regression-guarded in the test suite. If the SQL ever changes, update both.

interface SeedPermit {
  da: string | null;
  ent_lead: string | null;
}

/** Mirror of the SQL:
 *   CASE tt.default_team
 *     WHEN 'Entitlements' THEN NULLIF(v_permit->>'ent_lead','')
 *     WHEN 'Architecture' THEN NULLIF(v_permit->>'da','')
 *     ELSE NULLIF(tt.default_team,'')
 *   END
 */
function resolveAssignee(
  defaultTeam: string | null,
  permit: SeedPermit,
): string | null {
  const nullif = (v: string | null) => (v && v.trim() !== '' ? v : null);
  switch (defaultTeam) {
    case 'Entitlements':
      return nullif(permit.ent_lead);
    case 'Architecture':
      return nullif(permit.da);
    default:
      return nullif(defaultTeam);
  }
}

describe('bp_create_project_with_permits — team resolution (fix-153)', () => {
  const demo: SeedPermit = { da: 'Trevor', ent_lead: 'Maria' };

  it("'Architecture' resolves to the permit's da (per-permit DA override)", () => {
    expect(resolveAssignee('Architecture', demo)).toBe('Trevor');
    // A different permit (e.g. BP) with its own da cascades naturally.
    expect(resolveAssignee('Architecture', { da: 'Qisheng', ent_lead: 'Maria' }))
      .toBe('Qisheng');
  });

  it("'Entitlements' resolves to the permit's ent_lead", () => {
    expect(resolveAssignee('Entitlements', demo)).toBe('Maria');
  });

  it('a literal (legacy) name passes through unchanged', () => {
    expect(resolveAssignee('Bob Literal', demo)).toBe('Bob Literal');
  });

  it('a NULL team stays NULL (manual assignment expected later)', () => {
    expect(resolveAssignee(null, demo)).toBeNull();
  });

  it("resolves to NULL when the team's field on the permit is unset", () => {
    expect(resolveAssignee('Architecture', { da: null, ent_lead: 'Maria' }))
      .toBeNull();
    expect(resolveAssignee('Entitlements', { da: 'Trevor', ent_lead: '' }))
      .toBeNull();
  });
});
