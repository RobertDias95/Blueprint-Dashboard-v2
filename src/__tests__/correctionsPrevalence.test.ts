import { describe, it, expect } from 'vitest';
import {
  LOW_CONFIDENCE_N,
  NOT_RECORDED,
  bandPrevalence,
  computePrevalence,
  lotBand,
  permitLinkCoverage,
  segmentByKey,
  segmentPrevalence,
  segmentValues,
  unitBand,
  type SegmentProject,
} from '../lib/correctionsPrevalence';
import type { CorrectionReportRow } from '../lib/correctionsReport';

// fix-279: prevalence, segmentation, and the n.
//
// PREVALENCE IS NOT THE REPEAT RATE. Nothing in this module produces a repeat
// figure, and `PrevalenceRow` has no field for one — the two answer different
// questions and move in opposite directions for the same category.

let seq = 0;
function row(over: Partial<CorrectionReportRow> = {}): CorrectionReportRow {
  seq += 1;
  return {
    id: `ci-${seq}`,
    project_id: 'p1',
    permit_id: null,
    building: null,
    discipline: 'Zoning',
    cycle: 1,
    letter_date: '2025-08-01',
    reviewer: null,
    item_no: 1,
    subject: 's',
    body: 'b',
    codes: null,
    category: 'Setbacks & yards',
    theme: 'Site geometry',
    source_file: 'f.pdf',
    address: '1 Main St',
    juris: 'Seattle',
    architect: null,
    permit_type: null,
    permit_da: null,
    ...over,
  };
}

/** n projects, `hit` of which carry `category`. */
function corpus(n: number, hit: number, category: string): CorrectionReportRow[] {
  const out: CorrectionReportRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const pid = `p${i}`;
    // Every project has SOMETHING, so it is in the denominator.
    out.push(row({ project_id: pid, category: 'Something else', theme: 'Other' }));
    if (i < hit) out.push(row({ project_id: pid, category, theme: 'Stormwater' }));
  }
  return out;
}

// ------------------------------------------------------------- the headline --

describe('fix-279 prevalence reproduces the production table', () => {
  // The seven the brief names, verified against prod on 2026-08-11 over the 93
  // projects that have corrections.
  const PROD: Array<[string, number, number]> = [
    ['Missing / incorrect plan info', 78, 84],
    ['Address assignment / display', 65, 70],
    ['Parking / access / curb cut', 60, 65],
    ['Flow control / detention', 59, 63],
    ['Zoning – plan data missing', 51, 55],
    ['Ventilation / mechanical', 48, 52],
    ['CSC / soil plan', 45, 48],
  ];

  it.each(PROD)('%s: %i of 93 projects reads as %i%%', (category, projects, pctExpected) => {
    const rows = corpus(93, projects, category);
    const result = computePrevalence(rows, rows, 'category');
    expect(result.denominator).toBe(93);
    const found = result.rows.find((r) => r.label === category);
    expect(found?.projects).toBe(projects);
    expect(Math.round(found!.pct)).toBe(pctExpected);
  });

  it('the denominator is projects with corrections, not projects and not items', () => {
    // 3 projects, 10 items, one category on 2 of them -> 67%, not 20%.
    const rows = [
      ...Array.from({ length: 5 }, () => row({ project_id: 'a', category: 'X' })),
      ...Array.from({ length: 4 }, () => row({ project_id: 'b', category: 'X' })),
      row({ project_id: 'c', category: 'Y' }),
    ];
    const result = computePrevalence(rows, rows, 'category');
    expect(result.denominator).toBe(3);
    expect(result.rows.find((r) => r.label === 'X')).toMatchObject({
      projects: 2, pct: 66.7, items: 9,
    });
  });

  it('carries items alongside projects — they tell different stories', () => {
    // 9 items on 2 projects is one project having a bad week; the same 9 across
    // 9 projects is a template problem. The row must not collapse them.
    const rows = computePrevalence(
      [...corpus(9, 9, 'X')], [...corpus(9, 9, 'X')], 'category',
    );
    const x = rows.rows.find((r) => r.label === 'X')!;
    expect(x.projects).toBe(9);
    expect(x.items).toBe(9);
  });

  it('rolls up to theme level', () => {
    const rows = [
      row({ project_id: 'a', category: 'Flow control / detention', theme: 'Stormwater' }),
      row({ project_id: 'b', category: 'CSC / soil plan', theme: 'Stormwater' }),
      row({ project_id: 'c', category: 'Setbacks & yards', theme: 'Site geometry' }),
    ];
    const byTheme = computePrevalence(rows, rows, 'theme');
    expect(byTheme.rows.find((r) => r.label === 'Stormwater')).toMatchObject({
      projects: 2, items: 2,
    });
  });

  it('a category row names its theme so the two levels connect', () => {
    const rows = [row({ category: 'Flow control / detention', theme: 'Stormwater' })];
    expect(computePrevalence(rows, rows, 'category').rows[0].theme).toBe('Stormwater');
  });

  it('sorts by prevalence descending', () => {
    const rows = [
      ...corpus(10, 8, 'Common'),
      ...corpus(10, 2, 'Rare').filter((r) => r.category === 'Rare'),
    ];
    const out = computePrevalence(rows, rows, 'category').rows.map((r) => r.label);
    expect(out.indexOf('Common')).toBeLessThan(out.indexOf('Rare'));
  });

  it('an empty slice does not divide by zero', () => {
    expect(computePrevalence([], [], 'category')).toEqual({
      denominator: 0, rows: [], scopeWiderThanRows: false,
    });
  });
});

// ----------------------------------------------------- the denominator trap --

describe('fix-279 a theme filter must not shrink the denominator', () => {
  it('prevalence within a theme stays a fraction of the whole slice', () => {
    // 10 projects in scope; 4 have a Stormwater item. Computing prevalence of a
    // Stormwater category over "projects with Stormwater" would read 100%.
    const scope = corpus(10, 4, 'Flow control / detention');
    const display = scope.filter((r) => r.theme === 'Stormwater');
    const result = computePrevalence(scope, display, 'category');
    expect(result.denominator).toBe(10);
    expect(result.rows.find((r) => r.label === 'Flow control / detention')?.pct).toBe(40);
    expect(result.scopeWiderThanRows).toBe(true);
  });

  it('passing the same array for both is the no-filter case', () => {
    const rows = corpus(10, 4, 'X');
    expect(computePrevalence(rows, rows, 'category').scopeWiderThanRows).toBe(false);
  });
});

// -------------------------------------------------------------------- bands --

describe('fix-279 banding', () => {
  const rows = [
    { label: 'A', theme: null, projects: 8, pct: 80, items: 10 },
    { label: 'B', theme: null, projects: 5, pct: 50, items: 6 },
    { label: 'C', theme: null, projects: 3, pct: 30, items: 4 },
    { label: 'D', theme: null, projects: 1, pct: 12, items: 1 },
    { label: 'E', theme: null, projects: 1, pct: 4, items: 1 },
  ];

  it('splits into the four bands the ask named', () => {
    const banded = bandPrevalence(rows);
    expect(banded.map((b) => [b.band.label, b.rows.map((r) => r.label)])).toEqual([
      ['50% and over', ['A', 'B']],
      ['25–49%', ['C']],
      ['10–24%', ['D']],
      ['Under 10%', ['E']],
    ]);
  });

  it('exactly 50 lands in the top band, not the second', () => {
    expect(bandPrevalence([rows[1]])[0].band.key).toBe('high');
  });

  it('exactly 10 lands in 10–24, and 9.9 in under-10', () => {
    expect(bandPrevalence([{ ...rows[0], pct: 10 }])[0].band.key).toBe('low');
    expect(bandPrevalence([{ ...rows[0], pct: 9.9 }])[0].band.key).toBe('rare');
  });

  it('empty bands are dropped rather than rendered blank', () => {
    expect(bandPrevalence([rows[0]]).map((b) => b.band.key)).toEqual(['high']);
  });
});

// ------------------------------------------------------------- segmentation --

describe('fix-279 unit bands', () => {
  it.each([
    [1, '1'], [2, '2–3'], [3, '2–3'], [4, '4–5'], [5, '4–5'], [6, '6+'], [40, '6+'],
  ])('%i units -> %s', (units, band) => {
    expect(unitBand(units)).toBe(band);
  });

  it('a project that does not say gets no band, never a default one', () => {
    expect(unitBand(null)).toBeNull();
    expect(unitBand(undefined)).toBeNull();
  });

  it('lot bands work the same way', () => {
    expect(lotBand(1)).toBe('1');
    expect(lotBand(3)).toBe('2–3');
    expect(lotBand(9)).toBe('4+');
    expect(lotBand(null)).toBeNull();
  });
});

describe('fix-279 segment values', () => {
  const p = (over: Partial<SegmentProject> = {}): SegmentProject => ({ id: 'p', ...over });

  it('a missing value becomes an explicit Not recorded bucket', () => {
    const seg = segmentByKey('zone')!;
    expect(segmentValues(seg, p({ zone: null }))).toEqual([NOT_RECORDED]);
    expect(segmentValues(seg, p({ zone: '   ' }))).toEqual([NOT_RECORDED]);
  });

  it('a multi-valued segment puts a project in every bucket it belongs to', () => {
    const seg = segmentByKey('product_types')!;
    expect(seg.multi).toBe(true);
    expect(segmentValues(seg, p({ product_types: ['Townhome', 'DADU'] })))
      .toEqual(['Townhome', 'DADU']);
  });

  it('corner lot reads as words, not a boolean', () => {
    const seg = segmentByKey('is_corner_lot')!;
    expect(segmentValues(seg, p({ is_corner_lot: true }))).toEqual(['Corner']);
    expect(segmentValues(seg, p({ is_corner_lot: false }))).toEqual(['Mid-block']);
    expect(segmentValues(seg, p({ is_corner_lot: null }))).toEqual([NOT_RECORDED]);
  });

  it('every advertised segment resolves', () => {
    for (const key of [
      'juris', 'units', 'num_lots', 'is_corner_lot', 'product_types', 'zone',
      'parking_type', 'alley', 'builder_company', 'design_manager',
      'entitlement_lead', 'acq_lead',
    ]) {
      expect(segmentByKey(key), key).not.toBeNull();
    }
  });
});

// -------------------------------------------------- THE WORKED EXAMPLE ------

describe('fix-279 prevalence by unit band — the production worked example', () => {
  // Flow control / detention, per the brief and re-verified against prod on
  // 2026-08-11: 1 unit 1/4, 2–3 15/27, 4–5 37/54, 6+ 5/7.
  //
  // The brief quoted n=53 for the 4–5 band; production holds 54 today, so that
  // band reads 69% rather than 68%. One project moved between the brief being
  // written and this being built; the other three bands match to the unit.
  const SHAPE: Array<[string, number, number, number]> = [
    ['1', 4, 1, 25],
    ['2–3', 27, 15, 56],
    ['4–5', 54, 37, 69],
    ['6+', 7, 5, 71],
  ];

  const UNITS_FOR: Record<string, number> = { '1': 1, '2–3': 2, '4–5': 4, '6+': 6 };

  function build() {
    const rows: CorrectionReportRow[] = [];
    const projects = new Map<string, SegmentProject>();
    for (const [band, n, hit] of SHAPE) {
      for (let i = 0; i < n; i += 1) {
        const id = `${band}-${i}`;
        projects.set(id, { id, units: UNITS_FOR[band] });
        rows.push(row({ project_id: id, category: 'Other', theme: 'Other' }));
        if (i < hit) {
          rows.push(row({
            project_id: id,
            category: 'Flow control / detention',
            theme: 'Stormwater',
          }));
        }
      }
    }
    return { rows, projects };
  }

  it('reproduces 25% / 56% / 69% / 71% with the right n on each', () => {
    const { rows, projects } = build();
    const out = segmentPrevalence(
      rows, projects, segmentByKey('units')!, 'category', 'Flow control / detention',
    );
    expect(out.map((r) => [r.value, r.projectsInSegment, r.affected, Math.round(r.pct)]))
      .toEqual(SHAPE.map(([band, n, hit, pct]) => [band, n, hit, pct]));
  });

  it('keeps the bands in size order, not prevalence order', () => {
    const { rows, projects } = build();
    const out = segmentPrevalence(
      rows, projects, segmentByKey('units')!, 'category', 'Flow control / detention',
    );
    // 6+ has the highest rate but 1 comes first — a band axis reads in order.
    expect(out.map((r) => r.value)).toEqual(['1', '2–3', '4–5', '6+']);
  });

  it('flags the 1-unit band as low confidence and leaves 4–5 alone', () => {
    const { rows, projects } = build();
    const out = segmentPrevalence(
      rows, projects, segmentByKey('units')!, 'category', 'Flow control / detention',
    );
    expect(out.find((r) => r.value === '1')?.lowConfidence).toBe(true);
    expect(out.find((r) => r.value === '2–3')?.lowConfidence).toBe(false);
    expect(out.find((r) => r.value === '4–5')?.lowConfidence).toBe(false);
    expect(out.find((r) => r.value === '6+')?.lowConfidence).toBe(true);
  });
});

describe('fix-279 segment prevalence rules', () => {
  const projects = new Map<string, SegmentProject>([
    ['a', { id: 'a', juris: 'Seattle' }],
    ['b', { id: 'b', juris: 'Seattle' }],
    ['c', { id: 'c', juris: 'Bellevue' }],
  ]);

  it('the denominator is projects IN SCOPE in the bucket, not projects affected', () => {
    const rows = [
      row({ project_id: 'a', category: 'X' }),
      row({ project_id: 'b', category: 'Y' }),
      row({ project_id: 'c', category: 'X' }),
    ];
    const out = segmentPrevalence(rows, projects, segmentByKey('juris')!, 'category', 'X');
    // Seattle: 2 in scope, 1 affected -> 50%. Not 100%.
    expect(out.find((r) => r.value === 'Seattle')).toMatchObject({
      projectsInSegment: 2, affected: 1, pct: 50,
    });
    expect(out.find((r) => r.value === 'Bellevue')).toMatchObject({
      projectsInSegment: 1, affected: 1, pct: 100, lowConfidence: true,
    });
  });

  it('a project the lookup cannot resolve is dropped, not bucketed as unknown', () => {
    // Claiming "Not recorded" would assert we asked and the project said
    // nothing; we simply do not have the project.
    const rows = [row({ project_id: 'ghost', category: 'X' })];
    expect(segmentPrevalence(rows, projects, segmentByKey('juris')!, 'category', 'X'))
      .toEqual([]);
  });

  it('Not recorded sorts last however high it scores', () => {
    const withGap = new Map(projects);
    withGap.set('d', { id: 'd', juris: null });
    const rows = [
      row({ project_id: 'a', category: 'Y' }),
      row({ project_id: 'd', category: 'X' }),
    ];
    const out = segmentPrevalence(rows, withGap, segmentByKey('juris')!, 'category', 'X');
    expect(out[out.length - 1].value).toBe(NOT_RECORDED);
  });

  it('works at theme level too', () => {
    const rows = [
      row({ project_id: 'a', theme: 'Stormwater' }),
      row({ project_id: 'b', theme: 'Other' }),
    ];
    const out = segmentPrevalence(rows, projects, segmentByKey('juris')!, 'theme', 'Stormwater');
    expect(out.find((r) => r.value === 'Seattle')).toMatchObject({ affected: 1, pct: 50 });
  });

  it('LOW_CONFIDENCE_N is 10, and the boundary is inclusive-below', () => {
    expect(LOW_CONFIDENCE_N).toBe(10);
    const many = new Map<string, SegmentProject>();
    const rows: CorrectionReportRow[] = [];
    for (let i = 0; i < 10; i += 1) {
      many.set(`p${i}`, { id: `p${i}`, juris: 'Seattle' });
      rows.push(row({ project_id: `p${i}`, category: 'X' }));
    }
    const out = segmentPrevalence(rows, many, segmentByKey('juris')!, 'category', 'X');
    expect(out[0].projectsInSegment).toBe(10);
    expect(out[0].lowConfidence).toBe(false);
  });
});

// --------------------------------------------------------- permit coverage --

describe('fix-279 permit-link coverage', () => {
  it('reports the fraction of a slice that can answer a permit question', () => {
    const rows = [
      row({ permit_id: 1 }), row({ permit_id: 2 }), row({ permit_id: null }),
      row({ permit_id: null }),
    ];
    expect(permitLinkCoverage(rows)).toEqual({ linked: 2, total: 4, pct: 50 });
  });

  it('production is about half — the figure the disclosure exists for', () => {
    const rows = [
      ...Array.from({ length: 1092 }, () => row({ permit_id: 7 })),
      ...Array.from({ length: 1102 }, () => row({ permit_id: null })),
    ];
    expect(permitLinkCoverage(rows).pct).toBe(50);
  });

  it('an empty slice is 0%, not NaN', () => {
    expect(permitLinkCoverage([])).toEqual({ linked: 0, total: 0, pct: 0 });
  });
});
