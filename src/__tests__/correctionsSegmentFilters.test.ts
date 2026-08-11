import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  correctionsCsvPreamble,
  describeFilters,
  filterCorrectionRows,
  filtersAreEmpty,
  hasPermitLevelFilter,
  joinCorrectionRows,
  type CorrectionFilters,
  type CorrectionReportRow,
} from '../lib/correctionsReport';
import type { SegmentProject } from '../lib/correctionsPrevalence';
import type { CorrectionItem } from '../lib/database.types';

// fix-279: the segment + permit filters, and the filter set that travels with
// every export.

let seq = 0;
function row(over: Partial<CorrectionReportRow> = {}): CorrectionReportRow {
  seq += 1;
  return {
    id: `ci-${seq}`, project_id: 'p1', permit_id: null, building: null,
    discipline: 'Zoning', cycle: 1, letter_date: '2025-08-01', reviewer: null,
    item_no: 1, subject: 's', body: 'b', codes: null,
    category: 'Setbacks', theme: 'Site geometry', source_file: 'f.pdf',
    address: '1 Main St', juris: 'Seattle', architect: null,
    permit_type: null, permit_da: null,
    ...over,
  };
}

const f = (over: Partial<CorrectionFilters>): CorrectionFilters => ({
  ...EMPTY_FILTERS, ...over,
});

const PROJECTS = new Map<string, SegmentProject>([
  ['p1', { id: 'p1', units: 4, zone: 'NR3', is_corner_lot: true,
           product_types: ['Townhome'], builder_company: 'Boyd' }],
  ['p2', { id: 'p2', units: 1, zone: 'LR2', is_corner_lot: false,
           product_types: ['SFR', 'DADU'], builder_company: null }],
]);

// ---------------------------------------------------------- segment filters --

describe('fix-279 segment filters', () => {
  const rows = [row({ project_id: 'p1' }), row({ project_id: 'p2' })];

  it('a unit-band filter keeps only the matching projects', () => {
    expect(filterCorrectionRows(rows, f({ segments: { units: '4–5' } }), PROJECTS))
      .toHaveLength(1);
    expect(filterCorrectionRows(rows, f({ segments: { units: '1' } }), PROJECTS)[0]
      .project_id).toBe('p2');
  });

  it('a corner-lot filter reads the words, not the boolean', () => {
    expect(filterCorrectionRows(rows, f({ segments: { is_corner_lot: 'Corner' } }), PROJECTS))
      .toHaveLength(1);
    expect(filterCorrectionRows(rows, f({ segments: { is_corner_lot: 'Mid-block' } }), PROJECTS))
      .toHaveLength(1);
  });

  it('a multi-valued segment matches on ANY of a project’s values', () => {
    expect(filterCorrectionRows(rows, f({ segments: { product_types: 'DADU' } }), PROJECTS)[0]
      .project_id).toBe('p2');
    expect(filterCorrectionRows(rows, f({ segments: { product_types: 'SFR' } }), PROJECTS))
      .toHaveLength(1);
  });

  it('segments compose with each other and with content filters', () => {
    expect(
      filterCorrectionRows(rows, f({ segments: { units: '4–5', zone: 'NR3' } }), PROJECTS),
    ).toHaveLength(1);
    expect(
      filterCorrectionRows(rows, f({ segments: { units: '4–5', zone: 'LR2' } }), PROJECTS),
    ).toHaveLength(0);
    expect(
      filterCorrectionRows(rows, f({ juris: 'Bellevue', segments: { units: '4–5' } }), PROJECTS),
    ).toHaveLength(0);
  });

  it('a project with nothing recorded is matched by the Not recorded bucket', () => {
    expect(
      filterCorrectionRows(rows, f({ segments: { builder_company: 'Not recorded' } }), PROJECTS)[0]
        .project_id,
    ).toBe('p2');
  });

  it('a row whose project is unknown is dropped when a segment is active', () => {
    // It cannot be shown to satisfy a project attribute we cannot look up.
    const ghost = [row({ project_id: 'ghost' })];
    expect(filterCorrectionRows(ghost, f({ segments: { units: '1' } }), PROJECTS))
      .toHaveLength(0);
    // …but survives when no segment filter is set.
    expect(filterCorrectionRows(ghost, EMPTY_FILTERS, PROJECTS)).toHaveLength(1);
  });

  it('an empty segment value is not a filter', () => {
    expect(filterCorrectionRows(rows, f({ segments: { units: '' } }), PROJECTS))
      .toHaveLength(2);
    expect(filtersAreEmpty(f({ segments: { units: '' } }))).toBe(true);
    expect(filtersAreEmpty(f({ segments: { units: '1' } }))).toBe(false);
  });
});

// ----------------------------------------------------------- permit filters --

describe('fix-279 permit-level filters', () => {
  const rows = [
    row({ permit_id: 1, permit_type: 'Building Permit', permit_da: 'Ana' }),
    row({ permit_id: 2, permit_type: 'Demolition', permit_da: 'Derry' }),
    row({ permit_id: null }),
  ];

  it('filters on the linked permit type and DA', () => {
    expect(filterCorrectionRows(rows, f({ permitType: 'Demolition' }))).toHaveLength(1);
    expect(filterCorrectionRows(rows, f({ da: 'Ana' }))).toHaveLength(1);
  });

  it('an unlinked row can never satisfy a permit filter', () => {
    // The ~50% with no permit_id are excluded, and the page says so rather than
    // showing two unexplained totals.
    const out = filterCorrectionRows(rows, f({ permitType: 'Building Permit' }));
    expect(out.every((r) => r.permit_id != null)).toBe(true);
  });

  it('hasPermitLevelFilter drives the coverage disclosure', () => {
    expect(hasPermitLevelFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasPermitLevelFilter(f({ permitType: 'Building Permit' }))).toBe(true);
    expect(hasPermitLevelFilter(f({ da: 'Ana' }))).toBe(true);
    expect(hasPermitLevelFilter(f({ juris: 'Seattle' }))).toBe(false);
  });
});

// ------------------------------------------------------------ the join adds --

describe('fix-279 joinCorrectionRows carries the permit facts', () => {
  const item = (over: Partial<CorrectionItem> = {}): CorrectionItem => ({
    id: 'i1', project_id: 'p1', permit_id: null, building: null,
    discipline: null, cycle: 1, letter_date: null, reviewer: null, item_no: 1,
    subject: null, body: null, codes: null, category: null, theme: null,
    source_file: 'f.pdf', ...over,
  });
  const projects = [{ id: 'p1', address: '1 Main St', juris: 'Seattle' }];

  it('resolves permit type and DA from the linked permit', () => {
    const out = joinCorrectionRows(
      [item({ permit_id: 7 })], projects, new Map(),
      new Map([[7, { id: 7, type: 'Building Permit', da: 'Ana' }]]),
    );
    expect(out[0]).toMatchObject({ permit_type: 'Building Permit', permit_da: 'Ana' });
  });

  it('leaves them null when the item has no permit link', () => {
    const out = joinCorrectionRows([item()], projects);
    expect(out[0]).toMatchObject({ permit_type: null, permit_da: null });
  });

  it('leaves them null when the permit id does not resolve', () => {
    // Same practical meaning as no link at all: this row cannot answer a
    // per-permit question.
    const out = joinCorrectionRows([item({ permit_id: 999 })], projects, new Map(), new Map());
    expect(out[0]).toMatchObject({ permit_type: null, permit_da: null });
  });
});

// ------------------------------------------------------- filters in the CSV --

describe('fix-279 the filter set travels with the export', () => {
  it('describes every active filter in words', () => {
    const described = describeFilters(f({
      juris: 'Bellevue',
      cycle: '2',
      permitType: 'Building Permit',
      from: '2025-01-01',
      segments: { units: '4–5', zone: 'NR3' },
    }));
    expect(described).toContain('Jurisdiction: Bellevue');
    expect(described).toContain('Cycle: 2');
    expect(described).toContain('Permit type: Building Permit');
    expect(described).toContain('Letter date: 2025-01-01 to any');
    expect(described).toContain('Unit band: 4–5');
    expect(described).toContain('Zone: NR3');
  });

  it('says so plainly when nothing is filtered', () => {
    expect(describeFilters(EMPTY_FILTERS)).toEqual(['No filters — all corrections']);
  });

  it('the CSV preamble carries the filters and ends with a blank line', () => {
    const csv = correctionsCsvPreamble(f({ juris: 'Bellevue' }), ['View: Prevalence']);
    expect(csv).toContain('Blueprint — Corrections report');
    expect(csv).toContain('View: Prevalence');
    expect(csv).toContain('Jurisdiction: Bellevue');
    // A blank row before the real header keeps Excel parsing the table below.
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('""\r\n');
  });

  it('quotes a filter value containing a comma', () => {
    const csv = correctionsCsvPreamble(f({ segments: { zone: 'NR3, LR2' } }));
    expect(csv).toContain('"  Zone: NR3, LR2"');
  });
});
