import { describe, it, expect } from 'vitest';
import {
  buildLibraryRows,
  extractTags,
  filterLibraryRows,
  matchRange,
  pickBpForProject,
  sortLibraryRows,
  worstStage,
  type LibraryFilters,
} from '../lib/libraryHelpers';
import type { PermitWithCycles, Project } from '../lib/database.types';

// Q6.3.a: helper tests for the Library matrix. matchRange semantics are
// ported from v1 (index.html line 5709) — the buffer logic is non-obvious
// (one-bounded queries expand around the unset side), so the cases here
// pin every boundary.

function makePermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    go_date: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    units: 0,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    zone: null,
    product_type: null,
    project_tags: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    lot_width: null,
    lot_depth: null,
    alley: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-10T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

describe('matchRange', () => {
  it('returns true when both bounds null (filter inactive)', () => {
    expect(matchRange(40, null, null, 2)).toBe(true);
  });

  it('returns false when val is falsy and any bound is active', () => {
    expect(matchRange(0, 30, null, 2)).toBe(false);
    expect(matchRange(null, null, 50, 2)).toBe(false);
    expect(matchRange(undefined, 30, 50, 2)).toBe(false);
  });

  it('min-only with buffer: passes anything ≥ (min - buf)', () => {
    // min=40, buf=2 → effective range is [38, val] which simplifies to "val ≥ 38".
    expect(matchRange(38, 40, null, 2)).toBe(true);
    expect(matchRange(37, 40, null, 2)).toBe(false);
  });

  it('max-only with buffer: passes anything ≤ (max + buf)', () => {
    // max=50, buf=2 → effective range is [val, 52] which simplifies to "val ≤ 52".
    expect(matchRange(52, null, 50, 2)).toBe(true);
    expect(matchRange(53, null, 50, 2)).toBe(false);
  });

  it('both bounds with buffer: range is [min-buf, max+buf]', () => {
    expect(matchRange(38, 40, 50, 2)).toBe(true);
    expect(matchRange(52, 40, 50, 2)).toBe(true);
    expect(matchRange(37, 40, 50, 2)).toBe(false);
    expect(matchRange(53, 40, 50, 2)).toBe(false);
  });

  it('buf=0 means strict range', () => {
    expect(matchRange(40, 40, 50, 0)).toBe(true);
    expect(matchRange(50, 40, 50, 0)).toBe(true);
    expect(matchRange(39, 40, 50, 0)).toBe(false);
  });
});

describe('extractTags', () => {
  it('returns [] for null / non-array', () => {
    expect(extractTags(null)).toEqual([]);
    expect(extractTags('ECA')).toEqual([]);
    expect(extractTags({})).toEqual([]);
  });

  it('drops non-string elements defensively', () => {
    expect(extractTags(['ECA', 42, null, 'SIP'])).toEqual(['ECA', 'SIP']);
  });

  it('preserves string elements as-is', () => {
    expect(extractTags(['ECA', 'SIP', 'LBA'])).toEqual(['ECA', 'SIP', 'LBA']);
  });
});

describe('pickBpForProject', () => {
  it('returns null for empty permit list', () => {
    expect(pickBpForProject([])).toBeNull();
  });

  it('prefers the Building Permit when present', () => {
    const bp = makePermit({ id: 1, type: 'Building Permit' });
    const demo = makePermit({ id: 2, type: 'Demolition' });
    expect(pickBpForProject([demo, bp])?.id).toBe(1);
  });

  it('falls back to the first permit when no BP exists', () => {
    const demo = makePermit({ id: 2, type: 'Demolition' });
    const eca = makePermit({ id: 3, type: 'ECA Waiver' });
    expect(pickBpForProject([demo, eca])?.id).toBe(2);
  });
});

describe('worstStage', () => {
  it('rolls up to the latest-stage permit (Issued > Approved > Corrections > Permitting > DE)', () => {
    // effectiveStage derives stage from cycles + actual_issue/approval_date,
    // NOT from the stored `stage` column. Use stage_override to pin each
    // permit's stage deterministically.
    const a = makePermit({ id: 1, stage_override: 'de' });
    const b = makePermit({ id: 2, stage_override: 'pm' });
    const c = makePermit({ id: 3, stage_override: 'co' });
    expect(worstStage([a, b, c])).toBe('co');
  });
});

describe('buildLibraryRows', () => {
  it('builds one row per non-archived project that has at least one permit', () => {
    const projects = [
      makeProject({ id: 'p1', address: '500 Pike St' }),
      makeProject({ id: 'p2', address: '750 Oak Way', archived: true }),
      makeProject({ id: 'p3', address: '900 Birch Ln' }), // no permits
    ];
    const permits = [
      makePermit({
        id: 1,
        project_id: 'p1',
        type: 'Building Permit',
        units: 3,
        zone: 'NR',
        lot_width: 40,
        lot_depth: 100,
        alley: 'Yes',
        product_type: 'SFR',
        project_tags: ['ECA'],
      }),
    ];
    const rows = buildLibraryRows(projects, permits);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: 'p1',
      address: '500 Pike St',
      juris: 'Seattle',
      productType: 'SFR',
      units: 3,
      zone: 'NR',
      lotWidth: 40,
      lotDepth: 100,
      alley: 'Yes',
      tags: ['ECA'],
      stage: 'de',
    });
  });

  it('skips archived projects and projects with no permits', () => {
    const projects = [
      makeProject({ id: 'p1', archived: true }),
      makeProject({ id: 'p2' }),
    ];
    expect(buildLibraryRows(projects, [])).toEqual([]);
  });
});

describe('filterLibraryRows', () => {
  const baseFilters: LibraryFilters = {
    search: '',
    lotwMin: null,
    lotwMax: null,
    lotwBuf: 2,
    lotdMin: null,
    lotdMax: null,
    lotdBuf: 2,
    zone: '',
    alley: '',
    productType: '',
    tag: '',
    juris: '',
  };
  const rows = [
    {
      projectId: 'a',
      address: '500 Pike St',
      juris: 'Seattle',
      productType: 'SFR',
      units: 3,
      zone: 'NR',
      lotWidth: 40,
      lotDepth: 100,
      alley: 'Yes',
      tags: ['ECA'],
      stage: 'de' as const,
    },
    {
      projectId: 'b',
      address: '750 Oak Way',
      juris: 'Bellevue',
      productType: 'Attached Units',
      units: 4,
      zone: 'R-2',
      lotWidth: 60,
      lotDepth: 120,
      alley: 'No',
      tags: ['SIP'],
      stage: 'pm' as const,
    },
  ];

  it('no filters → returns all rows', () => {
    expect(filterLibraryRows(rows, baseFilters)).toHaveLength(2);
  });

  it('lotw range narrows to matching rows (within buffer)', () => {
    const filtered = filterLibraryRows(rows, {
      ...baseFilters,
      lotwMin: 58,
      lotwMax: 62,
      lotwBuf: 2,
    });
    expect(filtered.map((r) => r.projectId)).toEqual(['b']);
  });

  it('juris filter is exact match', () => {
    const filtered = filterLibraryRows(rows, { ...baseFilters, juris: 'Seattle' });
    expect(filtered.map((r) => r.projectId)).toEqual(['a']);
  });

  it('tag filter matches by array.includes', () => {
    const filtered = filterLibraryRows(rows, { ...baseFilters, tag: 'ECA' });
    expect(filtered.map((r) => r.projectId)).toEqual(['a']);
  });

  it('search filter uses multi-token address match', () => {
    const filtered = filterLibraryRows(rows, { ...baseFilters, search: 'oak way' });
    expect(filtered.map((r) => r.projectId)).toEqual(['b']);
  });

  it('zone filter is case-insensitive substring match', () => {
    const filtered = filterLibraryRows(rows, { ...baseFilters, zone: 'nr' });
    expect(filtered.map((r) => r.projectId)).toEqual(['a']);
  });

  it('multiple filters AND together', () => {
    const filtered = filterLibraryRows(rows, {
      ...baseFilters,
      juris: 'Bellevue',
      alley: 'No',
    });
    expect(filtered.map((r) => r.projectId)).toEqual(['b']);
  });
});

describe('sortLibraryRows', () => {
  const rows = [
    { address: '500 Pike St', units: 3, lotWidth: 40, stage: 'pm' as const },
    { address: '100 Apple Way', units: 7, lotWidth: 80, stage: 'is' as const },
    { address: '300 Oak Ln', units: 5, lotWidth: 60, stage: 'de' as const },
  ].map((r) => ({
    projectId: r.address,
    address: r.address,
    juris: '',
    productType: '',
    units: r.units,
    zone: '',
    lotWidth: r.lotWidth,
    lotDepth: 0,
    alley: '',
    tags: [],
    stage: r.stage,
  }));

  it('sorts by address ascending (string compare)', () => {
    const out = sortLibraryRows(rows, { col: 'address', asc: true });
    expect(out.map((r) => r.address)).toEqual([
      '100 Apple Way',
      '300 Oak Ln',
      '500 Pike St',
    ]);
  });

  it('sorts by units numerically (descending)', () => {
    const out = sortLibraryRows(rows, { col: 'units', asc: false });
    expect(out.map((r) => r.units)).toEqual([7, 5, 3]);
  });

  it('sorts by stage using workflow rank, not alphabetical', () => {
    const out = sortLibraryRows(rows, { col: 'stage', asc: true });
    // Workflow order: de(0) < pm(1) < is(4). Alphabetical would be de, is, pm.
    expect(out.map((r) => r.stage)).toEqual(['de', 'pm', 'is']);
  });
});
