// Q7.2.a: Recharts wrapper conventions. Color palette mirrors v1's CSS
// custom-property tokens (DE blue, PM green, CO amber, JV yellow, IS
// purple). Each chart in Q7.2.b/.c picks the appropriate role color.
//
// Helpers transform Map<string, number> / Map<string, number[]> shapes
// (the natural output of "group permits by type/juris") into the
// `{ name, value }[]` array Recharts wants.

export const CHART_COLORS = {
  de: '#1d4ed8', // blue (D&E / submission)
  pm: '#10b981', // green (permitting / approved)
  co: '#f59e0b', // amber (corrections)
  jv: '#f59e0b', // yellow (junction / project address pill); same family as co
  is: '#7c3aed', // purple (issued)
  dim: '#64748b',
  overdue: '#dc2626',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;

export interface NamedValue {
  name: string;
  value: number;
}

/** Count groupings: turn a list into bar-chart-ready { name, value } pairs.
 * Keys with non-positive counts are dropped. Sorted descending by value. */
export function groupCountBy<T>(
  items: T[],
  keyFn: (item: T) => string | null | undefined,
): NamedValue[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Average groupings: group items by key, then average a numeric extractor.
 * Items where the value is null/0/undefined are excluded from the average
 * (matches v1's `filter(x => x !== null && x > 0)` pattern). */
export function groupAvgBy<T>(
  items: T[],
  keyFn: (item: T) => string | null | undefined,
  valueFn: (item: T) => number | null | undefined,
): NamedValue[] {
  const buckets = new Map<string, number[]>();
  for (const item of items) {
    const k = keyFn(item);
    const v = valueFn(item);
    if (!k || v === null || v === undefined || v <= 0) continue;
    const list = buckets.get(k) ?? [];
    list.push(v);
    buckets.set(k, list);
  }
  return Array.from(buckets.entries())
    .map(([name, values]) => ({
      name,
      value: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    }))
    .sort((a, b) => b.value - a.value);
}
