import { describe, it, expect } from 'vitest';
import {
  buildLibraryRows,
  extractTags,
  filterLibraryRows,
  matchingUnitIndices,
  matchStoriesTier,
  matchTargetWithBuffer,
  pickBpForProject,
  sortLibraryRows,
  worstStage,
  type LibraryFilters,
  type LibraryRow,
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
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
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

describe('matchTargetWithBuffer', () => {
  it('returns true when target is null (filter inactive)', () => {
    expect(matchTargetWithBuffer(40, null, 5)).toBe(true);
  });

  it('returns false when val is falsy and target is active', () => {
    expect(matchTargetWithBuffer(0, 50, 5)).toBe(false);
    expect(matchTargetWithBuffer(null, 50, 5)).toBe(false);
    expect(matchTargetWithBuffer(undefined, 50, 5)).toBe(false);
  });

  it('"50 ± 5" matches everything in [45, 55] inclusive', () => {
    expect(matchTargetWithBuffer(45, 50, 5)).toBe(true);
    expect(matchTargetWithBuffer(50, 50, 5)).toBe(true);
    expect(matchTargetWithBuffer(55, 50, 5)).toBe(true);
    expect(matchTargetWithBuffer(44, 50, 5)).toBe(false);
    expect(matchTargetWithBuffer(56, 50, 5)).toBe(false);
  });

  it('absolute difference (works in both directions from target)', () => {
    expect(matchTargetWithBuffer(48, 50, 2)).toBe(true);
    expect(matchTargetWithBuffer(52, 50, 2)).toBe(true);
    expect(matchTargetWithBuffer(47, 50, 2)).toBe(false);
  });

  it('buf=0 requires exact match to target', () => {
    expect(matchTargetWithBuffer(50, 50, 0)).toBe(true);
    expect(matchTargetWithBuffer(51, 50, 0)).toBe(false);
    expect(matchTargetWithBuffer(49, 50, 0)).toBe(false);
  });

  it('handles non-integer values + decimal buffers', () => {
    expect(matchTargetWithBuffer(40.94, 41, 0.5)).toBe(true);
    expect(matchTargetWithBuffer(40.4, 41, 0.5)).toBe(false);
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
    // fix-22 Mig 3: physical fields (units/zone/lot_*/alley/product_types/
    // project_tags) live on the project now. Matrix row reads from project.
    const projects = [
      makeProject({
        id: 'p1',
        address: '500 Pike St',
        units: 3,
        zone: 'NR',
        lot_width: 40,
        lot_depth: 100,
        alley: 'Yes',
        product_types: ['SFR'],
        project_tags: ['ECA'],
      }),
      makeProject({ id: 'p2', address: '750 Oak Way', archived: true }),
      makeProject({ id: 'p3', address: '900 Birch Ln' }), // no permits
    ];
    const permits = [
      makePermit({
        id: 1,
        project_id: 'p1',
        type: 'Building Permit',
      }),
    ];
    const rows = buildLibraryRows(projects, permits);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: 'p1',
      address: '500 Pike St',
      juris: 'Seattle',
      productTypes: ['SFR'],
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

  // fix-122: row carries num_lots + is_corner_lot from the project.
  it('fix-122: surfaces num_lots + is_corner_lot on the row', () => {
    const projects = [
      makeProject({
        id: 'p1',
        num_lots: 7,
        is_corner_lot: true,
      }),
    ];
    const permits = [makePermit({ project_id: 'p1' })];
    const rows = buildLibraryRows(projects, permits);
    expect(rows[0].numLots).toBe(7);
    expect(rows[0].isCornerLot).toBe(true);
  });

  it('fix-122: NULL num_lots + is_corner_lot stay null on the row', () => {
    const projects = [makeProject({ id: 'p1' })];
    const permits = [makePermit({ project_id: 'p1' })];
    const rows = buildLibraryRows(projects, permits);
    expect(rows[0].numLots).toBeNull();
    expect(rows[0].isCornerLot).toBeNull();
  });
});

describe('filterLibraryRows', () => {
  const baseFilters: LibraryFilters = {
    search: '',
    lotwTarget: null,
    lotwBuf: 2,
    lotdTarget: null,
    lotdBuf: 2,
    unitwTarget: null,
    unitwBuf: 2,
    unitdTarget: null,
    unitdBuf: 2,
    zone: '',
    alley: '',
    productTypes: [],
    tag: '',
    juris: '',
    numLots: null,
    isCornerLot: '',
    stories: '',
  };
  const rows = [
    {
      projectId: 'a',
      address: '500 Pike St',
      juris: 'Seattle',
      productTypes: ['SFR'],
      units: 3,
      zone: 'NR',
      lotWidth: 40,
      lotDepth: 100,
      alley: 'Yes',
      tags: ['ECA'],
      stage: 'de' as const,
      unitTypes: [],
      numLots: 1,
      isCornerLot: true,
      updatedAt: null,
    },
    {
      projectId: 'b',
      address: '750 Oak Way',
      juris: 'Bellevue',
      productTypes: ['Attached Units'],
      units: 4,
      zone: 'R-2',
      lotWidth: 60,
      lotDepth: 120,
      alley: 'No',
      tags: ['SIP'],
      stage: 'pm' as const,
      unitTypes: [],
      numLots: 5,
      isCornerLot: false,
      updatedAt: null,
    },
  ];

  it('no filters → returns all rows', () => {
    expect(filterLibraryRows(rows, baseFilters)).toHaveLength(2);
  });

  it('lotw target ± buf narrows to matching rows', () => {
    // Target 60 ± 2 → matches [58, 62]. Row b is 60, matches. Row a is 40, no.
    const filtered = filterLibraryRows(rows, {
      ...baseFilters,
      lotwTarget: 60,
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

  // fix-122: exact-match num_lots + tri-state corner. NULL values fall
  // out when the filter is active — Bobby's "apples-to-apples
  // subdivision" intent means unanswered rows aren't candidates.
  describe('fix-122: numLots + isCornerLot filters', () => {
    const rowsExt = [
      { ...rows[0], numLots: 5, isCornerLot: true },
      { ...rows[1], numLots: 1, isCornerLot: false },
      {
        ...rows[0],
        projectId: 'c',
        address: '900 Cedar Ct',
        numLots: null as number | null,
        isCornerLot: null as boolean | null,
      },
    ];

    it('numLots=5 picks only the matching row', () => {
      const out = filterLibraryRows(rowsExt, { ...baseFilters, numLots: 5 });
      expect(out.map((r) => r.projectId)).toEqual(['a']);
    });

    it('numLots=null (no filter) leaves all rows', () => {
      const out = filterLibraryRows(rowsExt, { ...baseFilters, numLots: null });
      expect(out).toHaveLength(3);
    });

    it('numLots filter drops NULL-num_lots rows', () => {
      const out = filterLibraryRows(rowsExt, { ...baseFilters, numLots: 1 });
      expect(out.map((r) => r.projectId)).toEqual(['b']);
    });

    it('isCornerLot=Yes keeps only true rows; NULL drops', () => {
      const out = filterLibraryRows(rowsExt, {
        ...baseFilters,
        isCornerLot: 'Yes',
      });
      expect(out.map((r) => r.projectId)).toEqual(['a']);
    });

    it('isCornerLot=No keeps only false rows; NULL drops', () => {
      const out = filterLibraryRows(rowsExt, {
        ...baseFilters,
        isCornerLot: 'No',
      });
      expect(out.map((r) => r.projectId)).toEqual(['b']);
    });

    it('isCornerLot="" (Any) leaves all rows including NULLs', () => {
      const out = filterLibraryRows(rowsExt, {
        ...baseFilters,
        isCornerLot: '',
      });
      expect(out).toHaveLength(3);
    });

    it('numLots + isCornerLot AND together', () => {
      const out = filterLibraryRows(rowsExt, {
        ...baseFilters,
        numLots: 5,
        isCornerLot: 'Yes',
      });
      expect(out.map((r) => r.projectId)).toEqual(['a']);
    });
  });
});

// fix-205: Stories tier filter on a project's unit_types.
describe('fix-205: stories filter', () => {
  const EMPTY_FILTERS: LibraryFilters = {
    search: '',
    lotwTarget: null,
    lotwBuf: 2,
    lotdTarget: null,
    lotdBuf: 2,
    unitwTarget: null,
    unitwBuf: 2,
    unitdTarget: null,
    unitdBuf: 2,
    zone: '',
    alley: '',
    productTypes: [],
    tag: '',
    juris: '',
    numLots: null,
    isCornerLot: '',
    stories: '',
  };
  function mkRow(id: string, stories: (number | null)[]): LibraryRow {
    return {
      projectId: id,
      address: `${id} St`,
      juris: 'Seattle',
      productTypes: ['SFR'],
      units: stories.length,
      zone: '',
      lotWidth: 0,
      lotDepth: 0,
      alley: '',
      tags: [],
      stage: 'de',
      unitTypes: stories.map((s, i) => ({
        label: `Type ${i}`,
        width_ft: null,
        depth_ft: null,
        qty: 1,
        stories: s,
      })),
      numLots: null,
      isCornerLot: null,
      updatedAt: '2026-06-25T00:00:00Z',
    };
  }

  describe('matchStoriesTier', () => {
    it("'' matches anything (incl. null)", () => {
      expect(matchStoriesTier(null, '')).toBe(true);
      expect(matchStoriesTier(3, '')).toBe(true);
    });
    it('exact tiers 1–3 require an equal, non-null stories', () => {
      expect(matchStoriesTier(2, '2')).toBe(true);
      expect(matchStoriesTier(3, '2')).toBe(false);
      expect(matchStoriesTier(null, '2')).toBe(false);
    });
    it("'4+' matches 4 or more", () => {
      expect(matchStoriesTier(4, '4+')).toBe(true);
      expect(matchStoriesTier(6, '4+')).toBe(true);
      expect(matchStoriesTier(3, '4+')).toBe(false);
    });
  });

  it('filters projects to those with a unit at the picked stories tier', () => {
    const rows = [mkRow('a', [2, 3]), mkRow('b', [1]), mkRow('c', [4])];
    expect(
      filterLibraryRows(rows, { ...EMPTY_FILTERS, stories: '3' }).map((r) => r.projectId),
    ).toEqual(['a']);
    expect(
      filterLibraryRows(rows, { ...EMPTY_FILTERS, stories: '4+' }).map((r) => r.projectId),
    ).toEqual(['c']);
  });

  it('a project whose units have no stories drops out when a tier is picked', () => {
    const rows = [mkRow('a', [null, null])];
    expect(filterLibraryRows(rows, { ...EMPTY_FILTERS, stories: '2' })).toHaveLength(0);
    // …but stays under "Any".
    expect(filterLibraryRows(rows, { ...EMPTY_FILTERS, stories: '' })).toHaveLength(1);
  });

  it('matchingUnitIndices highlights only the units at the tier', () => {
    const row = mkRow('a', [2, 4, 4]);
    expect(matchingUnitIndices(row, { ...EMPTY_FILTERS, stories: '4+' })).toEqual([1, 2]);
    // No tier → all indices.
    expect(matchingUnitIndices(row, EMPTY_FILTERS)).toEqual([0, 1, 2]);
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
    productTypes: [],
    units: r.units,
    zone: '',
    lotWidth: r.lotWidth,
    lotDepth: 0,
    alley: '',
    tags: [],
    stage: r.stage,
    unitTypes: [],
    numLots: null as number | null,
    isCornerLot: null as boolean | null,
    updatedAt: null as string | null,
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

  // fix-122: numLots + isCornerLot sortable. NULL values land at the
  // end regardless of direction — unanswered rows shouldn't dilute the
  // top of an asc view.
  describe('fix-122: numLots + isCornerLot sort', () => {
    const lotsRows = [
      { ...rows[0], numLots: 3 as number | null, isCornerLot: true as boolean | null },
      { ...rows[1], numLots: 1 as number | null, isCornerLot: null as boolean | null },
      { ...rows[2], numLots: null as number | null, isCornerLot: false as boolean | null },
    ];

    it('numLots asc: smallest first, NULLs last', () => {
      const out = sortLibraryRows(lotsRows, { col: 'numLots', asc: true });
      expect(out.map((r) => r.numLots)).toEqual([1, 3, null]);
    });

    it('numLots desc: largest first, NULLs still last', () => {
      const out = sortLibraryRows(lotsRows, { col: 'numLots', asc: false });
      expect(out.map((r) => r.numLots)).toEqual([3, 1, null]);
    });

    it('isCornerLot asc: true < false < null', () => {
      const out = sortLibraryRows(lotsRows, {
        col: 'isCornerLot',
        asc: true,
      });
      expect(out.map((r) => r.isCornerLot)).toEqual([true, false, null]);
    });

    it('isCornerLot desc: false < true < null (NULLs still last)', () => {
      const out = sortLibraryRows(lotsRows, {
        col: 'isCornerLot',
        asc: false,
      });
      expect(out.map((r) => r.isCornerLot)).toEqual([false, true, null]);
    });
  });
});
