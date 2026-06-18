// fix-182b/c: pure helpers for the per-quarter Draw Schedule layout — shared by
// the editor (Phase B) and the grid render (Phase C). Kept out of the component
// files so they stay components-only (react-refresh) and the logic is
// unit-testable on its own.

import type { DrawScheduleQuarterLayoutRow } from './database.types';

export interface GroupSpan {
  label: string | null;
  count: number;
}

/** Mirror of the grid's header span logic: contiguous columns sharing a
 *  non-null group_label merge into one manager header; nulls never merge
 *  (each null column is its own standalone column). */
export function deriveGroupSpans(
  rows: { group_label: string | null }[],
): GroupSpan[] {
  const out: GroupSpan[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.label === r.group_label && r.group_label !== null) {
      last.count += 1;
    } else {
      out.push({ label: r.group_label, count: 1 });
    }
  }
  return out;
}

// fix-182c: the unified column model the Draw Schedule grid renders from. Both
// modes (saved per-quarter layout, or the current dm_da_groups fallback)
// produce the same shape, so the fallback path renders byte-for-byte as before.

/** One rendered grid column. */
export interface RenderCol {
  key: string;
  /** null = OPEN placeholder lane (no person, holds no blocks). */
  daName: string | null;
  kind: 'da' | 'open';
  /** Label shown in the DA-header row. */
  label: string;
  /** Dimmed treatment (forced-visible / orphan). */
  inactive: boolean;
  /** Drives the heavier right border at a group boundary. */
  isLastInGroup: boolean;
}

/** A manager-header group spanning `colCount` contiguous columns. */
export interface RenderGroup {
  key: string;
  /** Manager label; null = standalone column (blank header cell). */
  header: string | null;
  colCount: number;
}

export interface DrawColumnModelInput {
  isLayoutMode: boolean;
  /** Saved layout rows, ordered by position (layout mode). */
  layoutRows: DrawScheduleQuarterLayoutRow[];
  /** dm_da_groups view filtered by active-quarter (fallback mode). */
  fallbackGroups: { dm: string; das: string[] }[];
  /** DAs kept visible only because they have a block this quarter (dimmed). */
  inactiveDas: Set<string>;
  /** DAs with an in-range block this quarter — used to surface orphan lanes. */
  forcedDas: Set<string>;
}

/** Build the grid's column model. Layout mode: columns/headers/order come from
 *  the saved layout (deriveGroupSpans for manager headers; OPEN lanes; orphan
 *  DAs with in-range blocks appended as forced-visible dimmed standalone lanes
 *  so work is never hidden). Fallback mode: exactly the prior dm_da_groups +
 *  active-quarter structure. */
export function buildDrawColumns(input: DrawColumnModelInput): {
  renderGroups: RenderGroup[];
  renderColumns: RenderCol[];
} {
  const { isLayoutMode, layoutRows, fallbackGroups, inactiveDas, forcedDas } =
    input;
  const renderGroups: RenderGroup[] = [];
  const renderColumns: RenderCol[] = [];

  if (isLayoutMode) {
    const spans = deriveGroupSpans(layoutRows);
    const daInLayout = new Set<string>();
    let idx = 0;
    spans.forEach((span, gi) => {
      renderGroups.push({ key: `lg-${gi}`, header: span.label, colCount: span.count });
      for (let j = 0; j < span.count; j += 1) {
        const row = layoutRows[idx];
        const isOpen = row.col_kind === 'open' || !row.da_name;
        if (!isOpen && row.da_name) daInLayout.add(row.da_name);
        renderColumns.push({
          key: `lc-${row.id}`,
          daName: isOpen ? null : row.da_name,
          kind: isOpen ? 'open' : 'da',
          label: isOpen ? row.label_override?.trim() || 'OPEN' : (row.da_name ?? ''),
          inactive: false,
          isLastInGroup: j === span.count - 1,
        });
        idx += 1;
      }
    });
    // Orphan-block rule (locked #4 + straddling #5): a DA with an in-range block
    // but no column in this quarter's layout is appended as a forced-visible
    // DIMMED standalone lane, so work is NEVER hidden.
    const orphans = Array.from(forcedDas)
      .filter((da) => !daInLayout.has(da))
      .sort((a, b) => a.localeCompare(b));
    for (const da of orphans) {
      renderGroups.push({ key: `og-${da}`, header: null, colCount: 1 });
      renderColumns.push({
        key: `oc-${da}`,
        daName: da,
        kind: 'da',
        label: da,
        inactive: true,
        isLastInGroup: true,
      });
    }
    return { renderGroups, renderColumns };
  }

  // FALLBACK: today's exact structure.
  for (const g of fallbackGroups) {
    renderGroups.push({ key: `fg-${g.dm}`, header: g.dm, colCount: g.das.length });
    g.das.forEach((da, i) => {
      renderColumns.push({
        key: `fc-${g.dm}-${da}`,
        daName: da,
        kind: 'da',
        label: da,
        inactive: inactiveDas.has(da),
        isLastInGroup: i === g.das.length - 1,
      });
    });
  }
  return { renderGroups, renderColumns };
}
