// fix-182b: pure helpers for the per-quarter Draw Schedule layout editor.
// Kept out of the component file so the editor can stay a components-only
// module (react-refresh) and so the logic is unit-testable on its own.

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
