import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  NO_ARCHITECT,
  UNKNOWN_JURISDICTION,
  UNSPECIFIED_THEME,
  architectCoverage,
  correctionFilterOptions,
  correctionsCsvRows,
  countsByDiscipline,
  countsByTheme,
  filterCorrectionRows,
  filtersAreEmpty,
  joinCorrectionRows,
  repeatRate,
  reportTopicKey,
  summarizeReport,
  type CorrectionFilters,
  type CorrectionReportRow,
} from '../lib/correctionsReport';
import { UNSPECIFIED_DISCIPLINE } from '../lib/correctionItems';
import type { CorrectionItem } from '../lib/database.types';

// fix-277: the Corrections report's logic.
//
// The repeat rule here is CONSECUTIVE — raised in cycle N and again in N+1 —
// which is deliberately stricter than the fix-276 project panel's "appears in
// more than one cycle". Several tests below pin the difference, because the two
// live side by side and the wrong one would be an easy accident.

let seq = 0;
function row(over: Partial<CorrectionReportRow> = {}): CorrectionReportRow {
  seq += 1;
  return {
    id: `ci-${seq}`,
    project_id: 'p1',
    building: null,
    discipline: 'Zoning',
    cycle: 1,
    letter_date: '2025-08-01',
    reviewer: 'A. Reviewer',
    item_no: 1,
    subject: `Subject ${seq}`,
    body: 'Body',
    codes: null,
    category: 'Setbacks & yards',
    theme: 'Site geometry',
    source_file: 'letter.pdf',
    address: '100 Main St',
    juris: 'Seattle',
    architect: null,
    ...over,
  };
}

// --------------------------------------------------------------------- join --

describe('fix-277 joinCorrectionRows', () => {
  const items: CorrectionItem[] = [
    { ...row(), project_id: 'p1' },
    { ...row(), project_id: 'p2' },
  ];

  it('attaches address, jurisdiction and architect', () => {
    const out = joinCorrectionRows(
      items,
      [
        { id: 'p1', address: '100 Main St', juris: 'Seattle' },
        { id: 'p2', address: '200 Oak Ave', juris: 'Bellevue' },
      ],
      new Map([['p2', 'Fisk']]),
    );
    expect(out.map((r) => [r.address, r.juris, r.architect])).toEqual([
      ['100 Main St', 'Seattle', null],
      ['200 Oak Ave', 'Bellevue', 'Fisk'],
    ]);
  });

  it('DROPS an item whose project is unknown rather than defaulting it', () => {
    // Defaulting would put rows into a jurisdiction bucket they do not belong
    // to, and every per-jurisdiction figure on the page would quietly include
    // them.
    const out = joinCorrectionRows(items, [
      { id: 'p1', address: '100 Main St', juris: 'Seattle' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].project_id).toBe('p1');
  });

  it('a project with no jurisdiction gets the unknown label, not an empty string', () => {
    const out = joinCorrectionRows(
      [items[0]],
      [{ id: 'p1', address: '100 Main St', juris: null }],
    );
    expect(out[0].juris).toBe(UNKNOWN_JURISDICTION);
  });
});

// ------------------------------------------------------------------ filters --

describe('fix-277 filterCorrectionRows', () => {
  const rows = [
    row({ juris: 'Seattle', discipline: 'Zoning', theme: 'Site geometry', cycle: 1, letter_date: '2025-08-01' }),
    row({ juris: 'Bellevue', discipline: 'Planning', theme: 'Site geometry', cycle: 2, letter_date: '2025-10-01' }),
    row({ juris: 'Seattle', discipline: null, theme: null, cycle: 1, letter_date: null }),
  ];
  const f = (over: Partial<CorrectionFilters>): CorrectionFilters => ({
    ...EMPTY_FILTERS,
    ...over,
  });

  it('no filters keeps everything', () => {
    expect(filterCorrectionRows(rows, EMPTY_FILTERS)).toHaveLength(3);
    expect(filtersAreEmpty(EMPTY_FILTERS)).toBe(true);
  });

  it('filters by jurisdiction', () => {
    expect(filterCorrectionRows(rows, f({ juris: 'Bellevue' }))).toHaveLength(1);
  });

  it('filters by discipline, including the Unspecified bucket', () => {
    expect(filterCorrectionRows(rows, f({ discipline: 'Zoning' }))).toHaveLength(1);
    expect(
      filterCorrectionRows(rows, f({ discipline: UNSPECIFIED_DISCIPLINE })),
    ).toHaveLength(1);
  });

  it('filters by theme, including the Unspecified bucket', () => {
    expect(filterCorrectionRows(rows, f({ theme: 'Site geometry' }))).toHaveLength(2);
    expect(filterCorrectionRows(rows, f({ theme: UNSPECIFIED_THEME }))).toHaveLength(1);
  });

  it('filters by cycle', () => {
    expect(filterCorrectionRows(rows, f({ cycle: '1' }))).toHaveLength(2);
    expect(filterCorrectionRows(rows, f({ cycle: '2' }))).toHaveLength(1);
  });

  it('filters by architect, including the not-recorded bucket', () => {
    const withArch = [row({ architect: 'Fisk' }), row({ architect: null })];
    expect(filterCorrectionRows(withArch, f({ architect: 'Fisk' }))).toHaveLength(1);
    expect(filterCorrectionRows(withArch, f({ architect: NO_ARCHITECT }))).toHaveLength(1);
  });

  it('a date range is inclusive on both ends', () => {
    const out = filterCorrectionRows(
      rows,
      f({ from: '2025-08-01', to: '2025-08-01' }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].letter_date).toBe('2025-08-01');
  });

  it('an undated row survives with no bounds but drops once either is set', () => {
    // Showing an undated comment inside "corrections in Q3" would be a claim we
    // cannot support.
    expect(filterCorrectionRows(rows, EMPTY_FILTERS).filter((r) => !r.letter_date))
      .toHaveLength(1);
    expect(filterCorrectionRows(rows, f({ from: '2020-01-01' })).some((r) => !r.letter_date))
      .toBe(false);
    expect(filterCorrectionRows(rows, f({ to: '2099-01-01' })).some((r) => !r.letter_date))
      .toBe(false);
  });

  it('filters compose', () => {
    expect(
      filterCorrectionRows(rows, f({ juris: 'Seattle', cycle: '1', discipline: 'Zoning' })),
    ).toHaveLength(1);
    expect(
      filterCorrectionRows(rows, f({ juris: 'Bellevue', cycle: '1' })),
    ).toHaveLength(0);
  });
});

describe('fix-277 correctionFilterOptions', () => {
  const rows = [
    row({ juris: 'Seattle', discipline: 'Zoning', theme: 'Site geometry', cycle: 2, architect: 'Fisk' }),
    row({ juris: 'Bellevue', discipline: null, theme: null, cycle: 1, architect: null }),
  ];

  it('lists distinct values with the unknown buckets sorted last', () => {
    const o = correctionFilterOptions(rows);
    expect(o.jurisdictions).toEqual(['Bellevue', 'Seattle']);
    expect(o.disciplines).toEqual(['Zoning', UNSPECIFIED_DISCIPLINE]);
    expect(o.themes).toEqual(['Site geometry', UNSPECIFIED_THEME]);
    expect(o.architects).toEqual(['Fisk', NO_ARCHITECT]);
  });

  it('sorts cycles numerically and drops the ones with no cycle', () => {
    const o = correctionFilterOptions([
      ...rows,
      row({ cycle: 10 }),
      row({ cycle: null }),
    ]);
    expect(o.cycles).toEqual([1, 2, 10]);
  });
});

describe('fix-277 architectCoverage', () => {
  it('reports how thin the architect data is', () => {
    const rows = [row({ architect: 'Fisk' }), row({ architect: null }), row({ architect: '  ' })];
    expect(architectCoverage(rows)).toEqual({ withArchitect: 1, total: 3, pct: 33 });
  });

  it('does not divide by zero on an empty set', () => {
    expect(architectCoverage([])).toEqual({ withArchitect: 0, total: 0, pct: 0 });
  });
});

// ------------------------------------------------------------------- counts --

describe('fix-277 counts by theme and discipline', () => {
  const rows = [
    row({ project_id: 'p1', theme: 'Plan info', discipline: 'Zoning' }),
    row({ project_id: 'p1', theme: 'Plan info', discipline: 'Zoning' }),
    row({ project_id: 'p2', theme: 'Plan info', discipline: 'Drainage' }),
    row({ project_id: 'p2', theme: 'Stormwater', discipline: 'Drainage' }),
    row({ project_id: 'p3', theme: null, discipline: null }),
  ];

  it('counts items and DISTINCT projects per theme', () => {
    const t = countsByTheme(rows);
    expect(t[0]).toMatchObject({ label: 'Plan info', items: 3, projects: 2 });
    expect(t.find((r) => r.label === 'Stormwater')).toMatchObject({
      items: 1,
      projects: 1,
    });
  });

  it('sorts biggest first and puts the unknown bucket last', () => {
    expect(countsByTheme(rows).map((r) => r.label)).toEqual([
      'Plan info',
      'Stormwater',
      UNSPECIFIED_THEME,
    ]);
    expect(countsByDiscipline(rows).map((r) => r.label)).toEqual([
      'Drainage',
      'Zoning',
      UNSPECIFIED_DISCIPLINE,
    ]);
  });

  it('shares are percentages of the filtered total', () => {
    const t = countsByTheme(rows);
    expect(t[0].pct).toBe(60);
    expect(t.reduce((n, r) => n + r.items, 0)).toBe(rows.length);
  });

  it('an empty set counts to nothing rather than dividing by zero', () => {
    expect(countsByTheme([])).toEqual([]);
    expect(countsByDiscipline([])).toEqual([]);
  });
});

// -------------------------------------------------------------- repeat rate --

describe('fix-277 repeatRate — the consecutive rule', () => {
  it('a topic in cycle 1 and again in cycle 2 IS a repeat', () => {
    const r = repeatRate([
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.repeated).toBe(1);
    expect(r.eligible).toBe(1);
    expect(r.pct).toBe(100);
    expect(r.repeatedTopics).toHaveLength(1);
    expect(r.repeatedTopics[0].repeatedFromCycles).toEqual([1]);
  });

  it('cycle 1 and cycle 3 is NOT a repeat — this is the whole point of the rule', () => {
    // The fix-276 project panel WOULD count this. This report must not: the
    // comment was fixed once and came back later, a different failure.
    const r = repeatRate([
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Drainage', category: 'TESC' }),
      row({ cycle: 3, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.repeated).toBe(0);
    expect(r.repeatedTopics).toEqual([]);
  });

  it('a topic running 1 → 2 → 3 counts TWO repeats over two eligible cycles', () => {
    const r = repeatRate([1, 2, 3].map((cycle) =>
      row({ cycle, discipline: 'Zoning', category: 'Setbacks' }),
    ));
    expect(r.repeated).toBe(2);
    expect(r.eligible).toBe(2);
    expect(r.pct).toBe(100);
    expect(r.repeatedTopics[0].repeatedFromCycles).toEqual([1, 2]);
    expect(r.repeatedTopics[0].cycles).toEqual([1, 2, 3]);
  });

  it('the LAST cycle is never eligible — nothing can follow it', () => {
    // A project reviewed once would otherwise score 0% and look excellent when
    // it was simply never asked twice.
    const r = repeatRate([row({ cycle: 1 }), row({ cycle: 1, item_no: 2 })]);
    expect(r.eligible).toBe(0);
    expect(r.pct).toBe(0);
  });

  it('a topic only in the final cycle is not counted against the project', () => {
    const r = repeatRate([
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Fire', category: 'Hydrant' }),
    ]);
    // Zoning/Setbacks in cycle 1 is eligible and repeats. The Fire topic only
    // exists in cycle 2, the last one, so it is neither eligible nor a miss.
    expect(r.eligible).toBe(1);
    expect(r.repeated).toBe(1);
  });

  it('a topic that did NOT come back drags the rate down', () => {
    const r = repeatRate([
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 1, discipline: 'Fire', category: 'Hydrant' }),
      row({ cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.eligible).toBe(2);
    expect(r.repeated).toBe(1);
    expect(r.pct).toBe(50);
  });

  it('a topic belongs to ITS project — two projects are not a repeat', () => {
    const r = repeatRate([
      row({ project_id: 'p1', cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ project_id: 'p1', cycle: 2, discipline: 'Fire', category: 'Hydrant' }),
      row({ project_id: 'p2', cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.repeated).toBe(0);
  });

  it('the building is part of the topic', () => {
    const r = repeatRate([
      row({ cycle: 1, building: 'SFR 1', discipline: 'Planning', category: 'Setbacks' }),
      row({ cycle: 2, building: 'SFR 2', discipline: 'Planning', category: 'Setbacks' }),
    ]);
    expect(r.repeated).toBe(0);
    expect(reportTopicKey(row({ building: 'SFR 1' }))).not.toBe(
      reportTopicKey(row({ building: 'SFR 2' })),
    );
  });

  it('a cycle gap means the intervening cycle is not eligible', () => {
    // Project has cycles 1 and 3 only. Cycle 1 has no cycle 2 to repeat into.
    const r = repeatRate([
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 3, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.eligible).toBe(0);
    expect(r.repeated).toBe(0);
  });

  it('rows with no cycle are excluded from the maths entirely', () => {
    const r = repeatRate([
      row({ cycle: null, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.eligible).toBe(1);
    expect(r.repeated).toBe(1);
  });

  it('reports the repeated topic with enough detail to act on', () => {
    const r = repeatRate([
      row({ cycle: 1, building: 'SFR 1', discipline: 'Planning', category: 'Setbacks', address: '9 Elm' }),
      row({ cycle: 2, building: 'SFR 1', discipline: 'Planning', category: 'Setbacks', address: '9 Elm' }),
    ]);
    expect(r.repeatedTopics[0]).toMatchObject({
      projectId: 'p1',
      address: '9 Elm',
      building: 'SFR 1',
      discipline: 'Planning',
      category: 'Setbacks',
      items: 2,
    });
  });

  it('sorts the worst offender first', () => {
    const r = repeatRate([
      // one repeat
      row({ project_id: 'a', address: 'A', cycle: 1, discipline: 'Fire', category: 'Hydrant' }),
      row({ project_id: 'a', address: 'A', cycle: 2, discipline: 'Fire', category: 'Hydrant' }),
      // two repeats
      row({ project_id: 'b', address: 'B', cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ project_id: 'b', address: 'B', cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
      row({ project_id: 'b', address: 'B', cycle: 3, discipline: 'Zoning', category: 'Setbacks' }),
    ]);
    expect(r.repeatedTopics.map((t) => t.address)).toEqual(['B', 'A']);
  });

  it('an empty set is 0% rather than a division by zero', () => {
    expect(repeatRate([])).toMatchObject({ eligible: 0, repeated: 0, pct: 0 });
  });

  it('the rate is rounded to one decimal', () => {
    // 1 of 3 → 33.3%
    const r = repeatRate([
      row({ project_id: 'p', cycle: 1, discipline: 'A', category: 'x' }),
      row({ project_id: 'p', cycle: 1, discipline: 'B', category: 'x' }),
      row({ project_id: 'p', cycle: 1, discipline: 'C', category: 'x' }),
      row({ project_id: 'p', cycle: 2, discipline: 'A', category: 'x' }),
    ]);
    expect(r.eligible).toBe(3);
    expect(r.repeated).toBe(1);
    expect(r.pct).toBe(33.3);
  });
});

// ------------------------------------------------------------------ summary --

describe('fix-277 summarizeReport', () => {
  it('counts comments, projects, jurisdictions and cycles present', () => {
    const s = summarizeReport([
      row({ project_id: 'p1', juris: 'Seattle', cycle: 1 }),
      row({ project_id: 'p1', juris: 'Seattle', cycle: 2 }),
      row({ project_id: 'p2', juris: 'Bellevue', cycle: 1 }),
    ]);
    expect(s.items).toBe(3);
    expect(s.projects).toBe(2);
    expect(s.jurisdictions).toBe(2);
    expect(s.cycles).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------- CSV --

describe('fix-277 CSV rows', () => {
  it('flattens every displayed field and labels the empty ones', () => {
    const [r] = correctionsCsvRows([
      row({ architect: null, building: null, codes: null, cycle: 3 }),
    ]);
    expect(r.architect).toBe(NO_ARCHITECT);
    expect(r.building).toBe('');
    expect(r.codes).toBe('');
    expect(r.cycle).toBe(3);
    expect(r.address).toBe('100 Main St');
  });
});
