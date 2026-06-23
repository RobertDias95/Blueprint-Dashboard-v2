import { describe, it, expect } from 'vitest';
import {
  primaryPermit,
  holisticOwner,
  delegateAssignments,
  attributePersonVolume,
} from '../lib/volumeAttribution';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-192: the canonical per-person attribution rule. Two behaviours:
//   1. accumulation — a redesign's volume counts AGAIN toward its owner.
//   2. holistic lead vs delegate — only the project's holistic owner carries
//      lot/unit volume; permit-level delegates get a permit count only.
//
// Fixtures mirror the real 5053 25th Ave SW cohort (probed from prod):
//   original (2 lots / 6 units): BP da=Nicky ×2 + ULS da=Nicky + Demolition
//     da=Cam (the delegate) + ULS da=null. DM=Derry, ent=Miles.
//   redesign (2 lots / 6 units): PPR da=Marc, ent_lead=Miles. DM/ent NULL.

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
    id, project_id, type: 'Building Permit', stage: 'is', stage_override: null,
    status: null, num: null, da: null, dm: null, ent_lead: null, dual_da: null,
    target_submit: null, dd_start: null, dd_end: null, expected_issue: null,
    actual_issue: null, approval_date: null, intake_date: null, notes: null,
    cycle_model: null, view_cycle: null, kickoff_date: null, corr_rounds: null,
    permit_owner: null, architect: null, nickname: null, struct_address: null,
    portal_url: null, updated_at: '2026-01-01T00:00:00Z', permit_cycles: [], ...rest,
  };
}

describe('primaryPermit', () => {
  it('prefers the Building Permit', () => {
    const ps = [
      mkPermit({ id: 2, project_id: 'p', type: 'Demolition', da: 'Cam' }),
      mkPermit({ id: 3, project_id: 'p', type: 'Building Permit', da: 'Nicky' }),
    ];
    expect(primaryPermit(ps)?.da).toBe('Nicky');
  });

  it('falls back to the lowest-id permit when there is no BP (redesign PPR)', () => {
    const ps = [
      mkPermit({ id: 10321, project_id: 'r', type: 'PPR', da: 'Marc' }),
    ];
    expect(primaryPermit(ps)?.da).toBe('Marc');
  });

  it('returns null on an empty permit list', () => {
    expect(primaryPermit([])).toBeNull();
  });
});

describe('holisticOwner', () => {
  const original = mkProject({
    id: 'orig', address: '5053 25th Ave SW', num_lots: 2, units: 6,
    design_manager: 'Derry', entitlement_lead: 'Miles',
  });
  const origPermits = [
    mkPermit({ id: 10203, project_id: 'orig', type: 'Building Permit', da: 'Nicky', ent_lead: 'Miles' }),
    mkPermit({ id: 10204, project_id: 'orig', type: 'Demolition', da: 'Cam', ent_lead: 'Miles' }),
    mkPermit({ id: 10205, project_id: 'orig', type: 'ULS', da: null, ent_lead: 'Miles' }),
  ];

  it('DA owner = the Building Permit DA (the drawer), not a secondary-permit DA', () => {
    expect(holisticOwner('da', original, origPermits)).toBe('Nicky');
  });

  it('DM owner = the project-level design_manager', () => {
    expect(holisticOwner('dm', original, origPermits)).toBe('Derry');
  });

  it('ENT owner = the project-level entitlement_lead', () => {
    expect(holisticOwner('ent', original, origPermits)).toBe('Miles');
  });

  it('ENT owner falls back to the primary permit ent_lead when the project field is null (redesign)', () => {
    const redesign = mkProject({
      id: 'rd', address: '… [Redesign 1]', redesign_of_project_id: 'orig',
      num_lots: 2, units: 6, design_manager: null, entitlement_lead: null,
    });
    const rdPermits = [mkPermit({ id: 10321, project_id: 'rd', type: 'PPR', da: 'Marc', ent_lead: 'Miles' })];
    expect(holisticOwner('ent', redesign, rdPermits)).toBe('Miles');
    expect(holisticOwner('da', redesign, rdPermits)).toBe('Marc');
  });
});

describe('delegateAssignments', () => {
  it('DA delegates = secondary-permit da + dual_da, excluding the holistic owner', () => {
    const permits = [
      mkPermit({ id: 1, project_id: 'p', type: 'Building Permit', da: 'Nicky', dual_da: 'Shire' }),
      mkPermit({ id: 2, project_id: 'p', type: 'Demolition', da: 'Cam' }),
    ];
    const ds = delegateAssignments('da', permits, 'Nicky');
    const names = ds.map((d) => d.name).sort();
    expect(names).toEqual(['Cam', 'Shire']);
    // The holistic owner (Nicky) is never a delegate.
    expect(names).not.toContain('Nicky');
  });

  it('ENT delegate = a permit ent_lead that diverges from the holistic ent', () => {
    const permits = [
      mkPermit({ id: 1, project_id: 'p', type: 'Building Permit', ent_lead: 'Miles' }),
      mkPermit({ id: 2, project_id: 'p', type: 'ULS', ent_lead: 'Dana' }),
    ];
    expect(delegateAssignments('ent', permits, 'Miles').map((d) => d.name)).toEqual(['Dana']);
  });
});

describe('attributePersonVolume — accumulation + lead-vs-delegate', () => {
  // Same DA (Trevor) owns the original AND its redesign — accumulation should
  // credit 4 lots / 12 units, not dedupe to 2/6.
  const original = mkProject({ id: 'orig', address: '5053 25th Ave SW', num_lots: 2, units: 6 });
  const redesign = mkProject({
    id: 'rd', address: '5053 25th Ave SW [Redesign 1]', num_lots: 2, units: 6,
    redesign_of_project_id: 'orig',
  });
  const permits = [
    mkPermit({ id: 1, project_id: 'orig', type: 'Building Permit', da: 'Trevor' }),
    mkPermit({ id: 2, project_id: 'rd', type: 'Building Permit', da: 'Trevor' }),
  ];

  it('redesign volume accumulates onto the owner (4 lots / 12 units), not deduped', () => {
    const buckets = attributePersonVolume(permits, [original, redesign], { role: 'da' });
    const trevor = buckets.get('Trevor')!;
    expect(trevor.originalProjectIds.size).toBe(1);
    expect(trevor.redesignProjectIds.size).toBe(1);
    // Accumulated: 2 + 2 lots, 6 + 6 units.
    const lots =
      sumVol([original, redesign], trevor.originalProjectIds, 'num_lots') +
      sumVol([original, redesign], trevor.redesignProjectIds, 'num_lots');
    const units =
      sumVol([original, redesign], trevor.originalProjectIds, 'units') +
      sumVol([original, redesign], trevor.redesignProjectIds, 'units');
    expect(lots).toBe(4);
    expect(units).toBe(12);
  });

  it('the holistic lead carries the volume; the delegate gets a permit count and ZERO volume', () => {
    // 5053 original: BP da=Nicky (lead), Demolition da=Cam (delegate).
    const origPermits = [
      mkPermit({ id: 10203, project_id: 'orig', type: 'Building Permit', da: 'Nicky' }),
      mkPermit({ id: 10204, project_id: 'orig', type: 'Demolition', da: 'Cam' }),
    ];
    const buckets = attributePersonVolume(origPermits, [original], { role: 'da' });

    const nicky = buckets.get('Nicky')!;
    expect(nicky.originalProjectIds.has('orig')).toBe(true); // owns the project
    expect(nicky.leadOriginalPermits.length).toBe(2); // both permits are on his project
    expect(nicky.delegatePermitIds.size).toBe(0);

    const cam = buckets.get('Cam')!;
    // Cam owns NOTHING — zero project/unit/lot volume.
    expect(cam.originalProjectIds.size).toBe(0);
    expect(cam.redesignProjectIds.size).toBe(0);
    // …measured ONLY by the number of permits he touches (the Demolition).
    expect(cam.delegatePermitIds.size).toBe(1);
    expect(cam.delegatePermitIds.has(10204)).toBe(true);
  });

  it('no double-counting: the project volume sits with exactly one owner', () => {
    const origPermits = [
      mkPermit({ id: 1, project_id: 'orig', type: 'Building Permit', da: 'Nicky' }),
      mkPermit({ id: 2, project_id: 'orig', type: 'Demolition', da: 'Cam' }),
    ];
    const buckets = attributePersonVolume(origPermits, [original], { role: 'da' });
    // Only Nicky holds 'orig'; Cam does not — so 6 units aren't counted twice.
    const owners = [...buckets.values()].filter((b) => b.originalProjectIds.has('orig'));
    expect(owners.map((b) => b.name)).toEqual(['Nicky']);
  });

  it('respects the includeProject window gate', () => {
    const buckets = attributePersonVolume(permits, [original, redesign], {
      role: 'da',
      includeProject: (p) => !p.redesign_of_project_id, // originals only
    });
    const trevor = buckets.get('Trevor')!;
    expect(trevor.originalProjectIds.size).toBe(1);
    expect(trevor.redesignProjectIds.size).toBe(0);
  });
});

function sumVol(projects: Project[], ids: Set<string>, key: 'units' | 'num_lots'): number {
  let t = 0;
  for (const p of projects) if (ids.has(p.id)) t += p[key] ?? 0;
  return t;
}
