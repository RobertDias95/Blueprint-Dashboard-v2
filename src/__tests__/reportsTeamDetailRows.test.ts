import { describe, it, expect } from 'vitest';
import { buildRows } from '../lib/teamDetailRows';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-226: the DA drill-in project list must include handed-off projects the DA
// co-owns (even when permits.da no longer names them) and flag every handed-off
// project shared (✳). DM/ENT drill-ins ignore the co-credit map.

function mkProject(
  over: Omit<Partial<Project>, 'id' | 'address'> & Pick<Project, 'id' | 'address'>,
): Project {
  const { id, address, ...rest } = over;
  return { id, address, juris: 'Seattle', archived: false, notes: null, ...rest };
}

function mkPermit(
  over: Omit<Partial<PermitWithCycles>, 'id' | 'project_id'> & {
    id: number;
    project_id: string;
  },
): PermitWithCycles {
  const { id, project_id, ...rest } = over;
  return {
    id, project_id, type: 'Building Permit', stage: 'de', stage_override: null,
    status: null, num: null, da: null, dm: null, ent_lead: null, dual_da: null,
    target_submit: null, dd_start: null, dd_end: null, expected_issue: null,
    actual_issue: null, approval_date: null, intake_date: null, notes: null,
    cycle_model: null, view_cycle: null, kickoff_date: null, corr_rounds: null,
    permit_owner: null, architect: null, nickname: null, struct_address: null,
    portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [], ...rest,
  };
}

describe('ReportsTeamDetail buildRows — DA co-credit (fix-226)', () => {
  // shared: handed off Trevor → Nicky (permits.da is now Nicky). solo: Nicky only.
  const shared = mkProject({ id: 'sp', address: '900 Shared Ave' });
  const solo = mkProject({ id: 'so', address: '11 Solo St' });
  const projects = [shared, solo];
  const permits = [
    mkPermit({ id: 1, project_id: 'sp', type: 'Building Permit', da: 'Nicky' }),
    mkPermit({ id: 2, project_id: 'sp', type: 'Demolition', da: 'Nicky' }),
    mkPermit({ id: 3, project_id: 'so', type: 'Building Permit', da: 'Nicky' }),
  ];
  const coCredit = new Map<string, Set<string>>([
    ['sp', new Set(['Trevor', 'Nicky'])],
  ]);

  it('the NEW DA (on the permits) sees the shared project flagged ✳', () => {
    const rows = buildRows('Nicky', 'da', permits, projects, coCredit);
    const sp = rows.find((r) => r.projectId === 'sp')!;
    const so = rows.find((r) => r.projectId === 'so')!;
    expect(sp.isShared).toBe(true);
    expect(so.isShared).toBe(false); // solo is not shared
    // Types come from all of the project's credited permits.
    expect(sp.types).toEqual(['Building Permit', 'Demolition']);
  });

  it('the ORIGINAL DA (no longer on any permit) still gets the shared project', () => {
    const rows = buildRows('Trevor', 'da', permits, projects, coCredit);
    // Trevor is on zero permits, but co-credit includes the handed-off project.
    expect(rows.map((r) => r.projectId)).toEqual(['sp']);
    const sp = rows[0];
    expect(sp.isShared).toBe(true);
    // Permit types are derived from the project's full permit set.
    expect(sp.types).toEqual(['Building Permit', 'Demolition']);
  });

  it('without the co-credit map, the original DA sees nothing (unchanged)', () => {
    expect(buildRows('Trevor', 'da', permits, projects)).toEqual([]);
  });

  it('co-credit is DA-scoped: the DM drill-in ignores the map', () => {
    const dmPermits = [
      mkPermit({ id: 1, project_id: 'sp', type: 'Building Permit', dm: 'Nicky' }),
    ];
    const rows = buildRows('Trevor', 'dm', dmPermits, projects, coCredit);
    // Trevor is not a DM here and co-credit doesn't apply to DM → no rows.
    expect(rows).toEqual([]);
    // And Nicky's DM row is not flagged shared (DA-only marker).
    const nicky = buildRows('Nicky', 'dm', dmPermits, projects, coCredit);
    expect(nicky.find((r) => r.projectId === 'sp')?.isShared).toBe(false);
  });
});
