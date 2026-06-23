import { describe, it, expect } from 'vitest';
import {
  isSubPermit,
  isNotSubPermit,
  subPermitBadgeLabel,
} from '../lib/subPermit';
import { effectiveStage } from '../lib/permitStage';
import { derivePermitStatus, SUB_PERMIT_LABEL } from '../lib/permitStatus';
import { computeTeamMetrics } from '../lib/teamPerformance';
import { computeTeamWorkload } from '../lib/teamWorkload';
import { enrichPermits, computeMetrics } from '../lib/reportMetrics';
import { buildProjectRows } from '../lib/projectViewHelpers';
import { bucketPermits } from '../lib/permitStage';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';

// fix-194: sub/child permits. A permit with parent_permit_id set is a
// placeholder reviewed under its parent — no own review stage/status, excluded
// from every metric/rollup. Concrete case: BLD2026-0320 (204) is a child of
// BLD2026-0319 (202) on the same project; 0319 does all reviews.

function mkCycle(
  over: Omit<Partial<PermitCycle>, 'cycle_index'> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  const { cycle_index, ...rest } = over;
  return {
    id: `c-${cycle_index}-${over.permit_id ?? 0}`, permit_id: 0, cycle_index,
    submitted: null, city_target: null, corr_issued: null, resubmitted: null,
    intake_accepted: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...rest,
  };
}

function mkPermit(
  over: Omit<Partial<PermitWithCycles>, 'id' | 'project_id'> & {
    id: number;
    project_id: string;
  },
): PermitWithCycles {
  const { id, project_id, ...rest } = over;
  return {
    id, project_id, parent_permit_id: null, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null, dd_end: null,
    expected_issue: null, actual_issue: null, approval_date: null, intake_date: null,
    notes: null, cycle_model: null, view_cycle: null, kickoff_date: null,
    corr_rounds: null, permit_owner: null, architect: null, nickname: null,
    struct_address: null, portal_url: null, updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [], ...rest,
  };
}

function mkProject(over: Pick<Project, 'id' | 'address'> & Partial<Project>): Project {
  return { juris: 'Seattle', archived: false, notes: null, ...over };
}

describe('isSubPermit / isNotSubPermit predicate', () => {
  it('true only when parent_permit_id is set', () => {
    expect(isSubPermit(mkPermit({ id: 204, project_id: 'p', parent_permit_id: 202 }))).toBe(true);
    expect(isSubPermit(mkPermit({ id: 202, project_id: 'p' }))).toBe(false);
    expect(isSubPermit({ parent_permit_id: null })).toBe(false);
    expect(isSubPermit({ parent_permit_id: undefined })).toBe(false);
    expect(isSubPermit(null)).toBe(false);
  });
  it('isNotSubPermit is the inverse — a convenient array filter', () => {
    const rows = [
      mkPermit({ id: 202, project_id: 'p' }),
      mkPermit({ id: 204, project_id: 'p', parent_permit_id: 202 }),
    ];
    expect(rows.filter(isNotSubPermit).map((r) => r.id)).toEqual([202]);
  });
  it('badge label reads "Sub-permit · reviewed under <num>"', () => {
    expect(subPermitBadgeLabel('BLD2026-0319')).toBe('Sub-permit · reviewed under BLD2026-0319');
    expect(subPermitBadgeLabel(null)).toBe('Sub-permit · reviewed under parent');
  });
});

describe('stage/status short-circuit for a child', () => {
  it('effectiveStage short-circuits to terminal "is" WITHOUT reading the child cycles', () => {
    // A child with cycle data that would normally derive "co" (corrections).
    const child = mkPermit({
      id: 204, project_id: 'p', parent_permit_id: 202, status: 'Applied',
      permit_cycles: [mkCycle({ cycle_index: 0, permit_id: 204, corr_issued: '2026-03-01' })],
    });
    expect(effectiveStage(child, child.permit_cycles ?? [], [])).toBe('is');
    // The same permit standalone would derive 'co' from its open corrections.
    const standalone = { ...child, parent_permit_id: null };
    expect(effectiveStage(standalone, standalone.permit_cycles ?? [], [])).toBe('co');
  });

  it('derivePermitStatus short-circuits to the Sub-permit placeholder label', () => {
    const child = mkPermit({
      id: 204, project_id: 'p', parent_permit_id: 202,
      permit_cycles: [mkCycle({ cycle_index: 0, permit_id: 204, submitted: '2026-02-01' })],
    });
    const status = derivePermitStatus(child, []);
    expect(status.label).toBe(SUB_PERMIT_LABEL);
    expect(status.date).toBeNull();
    expect(status.derived).toBe(false);
  });
});

describe('metric/rollup surfaces exclude children', () => {
  // Project with a reviewing BP (202) + a placeholder child (204).
  const project = mkProject({ id: 'p', address: '123 Main', units: 4, num_lots: 1, juris: 'Seattle' });
  const parent = mkPermit({
    id: 202, project_id: 'p', num: 'BLD2026-0319', da: 'Trevor',
    dd_start: '2026-01-01', dd_end: '2026-01-11', corr_rounds: 2,
    permit_cycles: [mkCycle({ cycle_index: 0, permit_id: 202, corr_issued: '2026-03-01' })],
  });
  const child = mkPermit({
    id: 204, project_id: 'p', num: 'BLD2026-0320', parent_permit_id: 202, da: 'Trevor',
    permit_cycles: [mkCycle({ cycle_index: 0, permit_id: 204, corr_issued: '2026-03-01' })],
  });
  const permits = [parent, child];
  const projects = [project];

  it('bucketPermits never buckets a child (no inflated column / project counts)', () => {
    const inputs = permits.map((p) => ({ permit: p, cycles: p.permit_cycles ?? [], reviewers: [] }));
    const out = bucketPermits(inputs, new Map());
    const all = [...out.deEarly, ...out.deLate, ...out.pm, ...out.co, ...out.ap, ...out.is];
    expect(all.map((p) => p.id)).toEqual([202]); // only the parent
  });

  it('reportMetrics enrich/computeMetrics excludes the child (permit count, in-corrections)', () => {
    const projectsById = new Map([[project.id, project]]);
    const enriched = enrichPermits(permits, projectsById);
    expect(enriched.map((e) => e.permit.id)).toEqual([202]);
    const metrics = computeMetrics(enriched);
    // parent is in corrections; the child's identical corr cycle is ignored.
    expect(metrics.inCorrections).toBe(1);
    expect(metrics.totalUnits).toBe(4); // counted once, via the parent's project
  });

  it('buildProjectRows rolls up only the parent permit', () => {
    const rows = buildProjectRows(projects, permits, []);
    const row = rows.find((r) => r.project.id === 'p')!;
    expect(row.permits.map((p) => p.permit.id)).toEqual([202]);
  });

  it('computeTeamMetrics counts the parent permit but not the child', () => {
    const team: TeamMember[] = [{
      id: 'm', name: 'Trevor', role: 'da', active: true, former: false, email: null,
      notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null,
    }];
    const out = computeTeamMetrics(permits, projects, team, {
      role: 'da', activeOnly: true, dateFrom: null, dateTo: null, juris: '', includeRedesigns: true,
    });
    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    expect(trevor.permitCount).toBe(1); // parent only — the child placeholder is excluded
    expect(trevor.totalPermitCount).toBe(1);
    expect(trevor.delegatePermitCount).toBe(0);
    expect(trevor.unitCount).toBe(4);
  });

  it('computeTeamWorkload ignores the child', () => {
    const team: TeamMember[] = [{
      id: 'm', name: 'Trevor', role: 'da', active: true, former: false, email: null,
      notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null,
    }];
    const out = computeTeamWorkload(permits, projects, team, { role: 'da', activeOnly: true });
    const trevor = out.rows.find((r) => r.name === 'Trevor')!;
    // The parent is in corrections (1); the child contributes nothing.
    expect(trevor.inCorrectionsCount).toBe(1);
    expect(trevor.activePermitCount).toBe(1);
  });

  it('clearing the parent link restores normal behavior (the ex-child counts again)', () => {
    const restored = [parent, { ...child, parent_permit_id: null }];
    const inputs = restored.map((p) => ({ permit: p, cycles: p.permit_cycles ?? [], reviewers: [] }));
    const out = bucketPermits(inputs, new Map());
    const all = [...out.deEarly, ...out.deLate, ...out.pm, ...out.co, ...out.ap, ...out.is];
    expect(all.map((p) => p.id).sort()).toEqual([202, 204]); // both bucketed now
  });
});
