import { describe, it, expect } from 'vitest';
import { buildDrawColumns, deriveTopSpans } from '../lib/quarterLayoutHelpers';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182c: the Draw Schedule grid's column model. The render bands (DM header,
// DA header, columns) all derive from buildDrawColumns; this pins the
// layout-mode build, the fallback (no-layout) equivalence, OPEN lanes, group
// spans / standalone columns, and the orphan/straddling forced-visible rule.

const NOW = '2026-06-18T00:00:00Z';
function row(
  position: number,
  partial: Partial<DrawScheduleQuarterLayoutRow>,
): DrawScheduleQuarterLayoutRow {
  return {
    id: `r${position}`,
    quarter: '2025-Q3',
    position,
    col_kind: 'da',
    da_name: null,
    group_label: null,
    label_override: null,
    top_label: null,
    updated_at: NOW,
    ...partial,
  };
}

describe('buildDrawColumns — fallback (no saved layout)', () => {
  const fallbackGroups = [
    { dm: 'Lindsay', das: ['Francesca', 'Ainsley'] },
    { dm: 'Jade', das: ['Nidhi'] },
  ];

  it('reproduces dm_da_groups order + manager headers exactly', () => {
    const { renderGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: false,
      layoutRows: [],
      fallbackGroups,
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Lindsay', 2],
      ['Jade', 1],
    ]);
    expect(renderColumns.map((c) => c.daName)).toEqual(['Francesca', 'Ainsley', 'Nidhi']);
    expect(renderColumns.every((c) => c.kind === 'da')).toBe(true);
    // group boundaries -> heavier border on the last col of each group
    expect(renderColumns.map((c) => c.isLastInGroup)).toEqual([false, true, true]);
  });

  it('dims inactive-but-forced DAs (existing treatment), ignores forcedDas for new lanes', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: false,
      layoutRows: [],
      fallbackGroups,
      inactiveDas: new Set(['Ainsley']),
      // An orphan here must NOT create a new lane in fallback mode (byte-for-byte).
      forcedDas: new Set(['Ghost']),
    });
    expect(renderColumns.find((c) => c.daName === 'Ainsley')?.inactive).toBe(true);
    expect(renderColumns.find((c) => c.daName === 'Francesca')?.inactive).toBe(false);
    expect(renderColumns.some((c) => c.daName === 'Ghost')).toBe(false);
  });
});

describe('buildDrawColumns — layout mode', () => {
  // A past quarter: Ana manages Ahmadi+Fisk, Qisheng standalone, an OPEN lane.
  const layoutRows = [
    row(0, { col_kind: 'da', da_name: 'Ahmadi', group_label: 'Ana' }),
    row(1, { col_kind: 'da', da_name: 'Fisk', group_label: 'Ana' }),
    row(2, { col_kind: 'da', da_name: 'Qisheng', group_label: null }),
    row(3, { col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN' }),
  ];

  it('builds columns in saved order with manager spans + standalone', () => {
    const { renderGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows,
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    // Ana spans 2; Qisheng standalone (null header); OPEN standalone (null).
    expect(renderGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Ana', 2],
      [null, 1],
      [null, 1],
    ]);
    expect(renderColumns.map((c) => c.label)).toEqual(['Ahmadi', 'Fisk', 'Qisheng', 'OPEN']);
    expect(renderColumns.map((c) => c.kind)).toEqual(['da', 'da', 'da', 'open']);
  });

  it('OPEN lane has no da_name (holds no blocks) and uses its label override', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [row(0, { col_kind: 'open', da_name: null, label_override: 'Spare' })],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderColumns[0]).toMatchObject({ kind: 'open', daName: null, label: 'Spare' });
  });

  it('defaults an OPEN lane label to "OPEN" when blank', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [row(0, { col_kind: 'open', da_name: null, label_override: null })],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderColumns[0].label).toBe('OPEN');
  });

  it('appends an orphan/straddling block DA as a dimmed forced-visible lane (never hidden)', () => {
    const { renderGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows,
      fallbackGroups: [],
      inactiveDas: new Set(),
      // Marc has an in-range block this quarter but is NOT in the layout.
      forcedDas: new Set(['Marc', 'Fisk']), // Fisk already in layout -> not duplicated
    });
    const marc = renderColumns.find((c) => c.daName === 'Marc');
    expect(marc).toBeDefined();
    expect(marc?.inactive).toBe(true);
    expect(marc?.isLastInGroup).toBe(true);
    // appended after the layout columns, as its own standalone (null) group
    expect(renderColumns[renderColumns.length - 1].daName).toBe('Marc');
    expect(renderGroups[renderGroups.length - 1].header).toBeNull();
    // Fisk (already a layout column) is not re-added
    expect(renderColumns.filter((c) => c.daName === 'Fisk')).toHaveLength(1);
  });

  it('treats a da row with a null da_name defensively as an OPEN lane', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [row(0, { col_kind: 'da', da_name: null })],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderColumns[0]).toMatchObject({ kind: 'open', daName: null });
  });

  // fix-183: dim a layout 'da' column whose DA is inactive in the viewed quarter.
  it('marks a layout da column inactive when isDaActiveInQuarter is false', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows,
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
      isDaActiveInQuarter: (da) => da !== 'Fisk', // Fisk departed this quarter
    });
    expect(renderColumns.find((c) => c.daName === 'Fisk')?.inactive).toBe(true);
    expect(renderColumns.find((c) => c.daName === 'Ahmadi')?.inactive).toBe(false);
    // OPEN lane is never dimmed by membership.
    expect(renderColumns.find((c) => c.kind === 'open')?.inactive).toBe(false);
  });

  it('leaves all layout columns active when no predicate is supplied (back-compat)', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows,
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderColumns.filter((c) => c.kind === 'da').every((c) => !c.inactive)).toBe(true);
  });

  it('does not let the predicate change fallback-mode dimming', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: false,
      layoutRows: [],
      fallbackGroups: [{ dm: 'Lindsay', das: ['Francesca'] }],
      inactiveDas: new Set(),
      forcedDas: new Set(),
      isDaActiveInQuarter: () => false, // ignored in fallback
    });
    expect(renderColumns[0].inactive).toBe(false);
  });
});

// fix-190a: DM-solo columns — a DM working a lane with no DA beneath them.
describe('buildDrawColumns — DM-solo column (fix-190a)', () => {
  it('renders a solo DM as its own header with a "(DM)" sub-row, block-matched by the DM name', () => {
    const { renderGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' }),
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    // 1-wide manager header = the DM's name.
    expect(renderGroups.map((g) => [g.header, g.colCount])).toEqual([['Jade', 1]]);
    expect(renderColumns).toHaveLength(1);
    expect(renderColumns[0]).toMatchObject({
      kind: 'dm',
      daName: 'Jade', // block matching keys off this (= the DM name)
      label: '(DM)', // DA-header sub-row shows no person name
      inactive: false,
    });
  });

  it('a DM-solo lane is NEVER dimmed by the DA-active predicate (a DM is generally active)', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [row(0, { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' })],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
      isDaActiveInQuarter: () => false, // would dim a DA — must NOT dim the DM lane
    });
    expect(renderColumns[0].inactive).toBe(false);
  });

  it('does not duplicate a DM-solo lane as an orphan when it has an in-range block', () => {
    const { renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [row(0, { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' })],
      fallbackGroups: [],
      inactiveDas: new Set(),
      // Jade owns a block this quarter — already represented by her 'dm' column.
      forcedDas: new Set(['Jade']),
    });
    expect(renderColumns.filter((c) => c.daName === 'Jade')).toHaveLength(1);
  });

  it('a DM column sits in its own group beside DA columns (mixed layout)', () => {
    const { renderGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'da', da_name: 'Ahmadi', group_label: 'Ana' }),
        row(1, { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' }),
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Ana', 1],
      ['Jade', 1],
    ]);
    expect(renderColumns.map((c) => c.kind)).toEqual(['da', 'dm']);
    expect(renderColumns.map((c) => c.label)).toEqual(['Ahmadi', '(DM)']);
  });
});

// fix-190b: top (regional/ent) tier.
describe('deriveTopSpans (fix-190b)', () => {
  function tl(...labels: (string | null)[]) {
    return deriveTopSpans(labels.map((l) => ({ top_label: l })));
  }

  it('merges contiguous same labels ACROSS DM groups into one span', () => {
    // Miles spans the first two columns even if they're in different DM groups.
    expect(tl('Miles', 'Miles', 'Briana')).toEqual([
      { label: 'Miles', count: 2 },
      { label: 'Briana', count: 1 },
    ]);
  });

  it('treats NULL / empty / whitespace as a blank spacer (merged) gap', () => {
    expect(tl(null, '', '   ', 'Miles')).toEqual([
      { label: null, count: 3 },
      { label: 'Miles', count: 1 },
    ]);
  });

  it('a non-null label broken by a NULL gap does NOT merge across the gap', () => {
    expect(tl('Miles', null, 'Miles')).toEqual([
      { label: 'Miles', count: 1 },
      { label: null, count: 1 },
      { label: 'Miles', count: 1 },
    ]);
  });

  it('colCounts always sum to the number of columns', () => {
    const spans = tl('A', 'A', null, 'B', null, null);
    expect(spans.reduce((s, g) => s + g.count, 0)).toBe(6);
  });
});

describe('buildDrawColumns — renderTopGroups (fix-190b)', () => {
  it('returns [] (no top band) when no column has a top_label', () => {
    const { renderTopGroups } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'da', da_name: 'Ahmadi', group_label: 'Ana' }),
        row(1, { col_kind: 'da', da_name: 'Fisk', group_label: 'Ana' }),
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderTopGroups).toEqual([]);
  });

  it('fallback mode never has a top tier', () => {
    const { renderTopGroups } = buildDrawColumns({
      isLayoutMode: false,
      layoutRows: [],
      fallbackGroups: [{ dm: 'Lindsay', das: ['Francesca'] }],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderTopGroups).toEqual([]);
  });

  it('a top span covers the sum of the DM groups beneath it (Miles over Lindsay + a solo DM)', () => {
    // Lindsay manages Francesca + Ainsley; Jade is a solo DM. Miles spans all
    // three columns (across the Lindsay group AND the Jade solo lane). Briana
    // spans Brittani's single column.
    const { renderGroups, renderTopGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'da', da_name: 'Francesca', group_label: 'Lindsay', top_label: 'Miles' }),
        row(1, { col_kind: 'da', da_name: 'Ainsley', group_label: 'Lindsay', top_label: 'Miles' }),
        row(2, { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade', top_label: 'Miles' }),
        row(3, { col_kind: 'da', da_name: 'Bob', group_label: 'Brittani', top_label: 'Briana' }),
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    // DM groups: Lindsay(2), Jade(1), Brittani(1).
    expect(renderGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Lindsay', 2],
      ['Jade', 1],
      ['Brittani', 1],
    ]);
    // Top spans: Miles(3) across Lindsay+Jade, Briana(1) over Brittani.
    expect(renderTopGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Miles', 3],
      ['Briana', 1],
    ]);
    // Top spans sum to the column count.
    expect(renderTopGroups.reduce((s, g) => s + g.colCount, 0)).toBe(renderColumns.length);
  });

  it('mixed: columns without a top_label become a blank spacer span, alignment preserved', () => {
    const { renderTopGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'da', da_name: 'Francesca', group_label: 'Lindsay', top_label: 'Miles' }),
        row(1, { col_kind: 'da', da_name: 'Qisheng', group_label: null }), // no top_label
        row(2, { col_kind: 'open', da_name: null, label_override: 'OPEN' }), // no top_label
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(),
    });
    expect(renderTopGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Miles', 1],
      [null, 2], // blank spacer over the two un-labeled columns
    ]);
    expect(renderTopGroups.reduce((s, g) => s + g.colCount, 0)).toBe(renderColumns.length);
  });

  it('orphan forced lanes get a blank spacer in the top band (still sums)', () => {
    const { renderTopGroups, renderColumns } = buildDrawColumns({
      isLayoutMode: true,
      layoutRows: [
        row(0, { col_kind: 'da', da_name: 'Francesca', group_label: 'Lindsay', top_label: 'Miles' }),
      ],
      fallbackGroups: [],
      inactiveDas: new Set(),
      forcedDas: new Set(['Marc']), // orphan with an in-range block, appended as a dimmed lane
    });
    // Miles over the layout column, then a blank spacer over the orphan lane.
    expect(renderTopGroups.map((g) => [g.header, g.colCount])).toEqual([
      ['Miles', 1],
      [null, 1],
    ]);
    expect(renderColumns).toHaveLength(2);
    expect(renderTopGroups.reduce((s, g) => s + g.colCount, 0)).toBe(2);
  });
});
