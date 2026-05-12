import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from './database.types';

// Q9.5.d: trends data layer ported from v1's renderTrends + helpers
// (Blueprint-Dashboard-/index.html:6011-6330). Surfaces the 4
// trends charts on the Reports → Trends tab.

export type TrendsGroupBy =
  | 'jurisdiction'
  | 'type'
  | 'ent'
  | 'acq'
  | 'da'
  | 'dm'
  | 'tag'
  | 'total';

export type TrendsRange = '6' | '12' | '24' | '36' | 'all' | 'custom';

export interface TrendsFilters {
  range: TrendsRange;
  /** YYYY-MM format. Only consulted when range='custom'. */
  dateFrom: string;
  dateTo: string;
  type: string;
  juris: string;
  ent: string;
  acq: string;
  da: string;
  tag: string;
  group: TrendsGroupBy;
}

export const DEFAULT_FILTERS: TrendsFilters = {
  range: '12',
  dateFrom: '',
  dateTo: '',
  type: '',
  juris: '',
  ent: '',
  acq: '',
  da: '',
  tag: '',
  group: 'jurisdiction',
};

// ============================================================
// Month range
// ============================================================

/** Build an array of YYYY-MM month labels covering the configured
 * range. v1 logic (index.html:6090-6111):
 *   - 'custom' + dateFrom → step from dateFrom to dateTo (or current
 *     month if dateTo empty).
 *   - 'all' → walk back to the earliest scrapeable date across permits
 *     (go_date or first cycle.submitted or actual_issue); fall back to
 *     '24' if no anchor found.
 *   - numeric → last N months ending with the current month inclusive. */
export function getMonthRange(
  filters: TrendsFilters,
  permits: PermitWithCycles[],
  now: Date = new Date(),
): string[] {
  const labels: string[] = [];

  if (filters.range === 'custom' && filters.dateFrom) {
    const start = parseMonth(filters.dateFrom);
    const end = filters.dateTo ? parseMonth(filters.dateTo) : monthFloor(now);
    if (!start || !end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      labels.push(toMonthKey(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return labels;
  }

  const nowFloor = monthFloor(now);

  if (filters.range === 'all') {
    let earliest = '';
    for (const p of permits) {
      const candidates: string[] = [];
      if (p.go_date) candidates.push(p.go_date);
      for (const c of p.permit_cycles ?? []) {
        if (c.submitted) candidates.push(c.submitted);
      }
      if (p.actual_issue) candidates.push(p.actual_issue);
      for (const d of candidates) {
        if (d && (!earliest || d < earliest)) earliest = d;
      }
    }
    if (earliest) {
      const start = parseMonth(earliest.slice(0, 7));
      if (start) {
        const cur = new Date(start);
        while (cur <= nowFloor) {
          labels.push(toMonthKey(cur));
          cur.setMonth(cur.getMonth() + 1);
        }
        return labels;
      }
    }
    // Fall through to default 24-month range if no anchor.
  }

  const n =
    filters.range === 'all' ? 24 : parseInt(filters.range, 10) || 12;
  const cur = new Date(nowFloor);
  cur.setMonth(cur.getMonth() - (n - 1));
  while (cur <= nowFloor) {
    labels.push(toMonthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return labels;
}

// ============================================================
// Permit filtering (top-level dimension filters)
// ============================================================

/** Apply the top-level filter dimensions (type/juris/ent/acq/da/tag) to
 * the permit set. v1 logic at index.html:6114-6124. */
export function trFilteredPermits(
  permits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
): PermitWithCycles[] {
  return permits.filter((p) => {
    if (filters.type && p.type !== filters.type) return false;
    if (filters.juris) {
      const proj = projectsById.get(p.project_id);
      if (proj?.juris !== filters.juris) return false;
    }
    if (filters.ent && (p.ent_lead ?? '') !== filters.ent) return false;
    // ACQ filter: permits don't carry an acq_lead column in v2 (task #63
    // tracks the schema decision). Filter is effectively a no-op until
    // that column lands. We accept the filter shape to preserve UI parity
    // but it'll always match every permit. ReportTrendsTab hides the
    // ACQ filter input entirely.
    if (filters.acq) {
      // Future: when permits.acq_lead exists, compare here.
      // For now: don't reject any permit on this dimension.
    }
    if (filters.da) {
      const daMatch = p.da === filters.da || p.architect === filters.da;
      if (!daMatch) return false;
    }
    if (filters.tag) {
      const tags = (p.project_tags as unknown[]) ?? [];
      if (!tags.includes(filters.tag)) return false;
    }
    return true;
  });
}

// ============================================================
// Group keys + dimension match
// ============================================================

/** Distinct grouping keys for the chart's color/legend series. Sorted
 * for deterministic ordering. v1 logic at index.html:6148-6157. */
export function getGroupKeys(
  permits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
): string[] {
  if (filters.group === 'total') return ['Total'];
  const set = new Set<string>();
  for (const p of permits) {
    const proj = projectsById.get(p.project_id);
    const key = keyForGroupBy(p, proj, filters.group);
    if (Array.isArray(key)) key.forEach((k) => set.add(k));
    else if (key) set.add(key);
  }
  return Array.from(set).filter(Boolean).sort();
}

/** True if `permit` belongs to grouping bucket `key` under the given
 * dimension. v1 logic at index.html:6159-6168. */
export function permMatchesGroup(
  permit: PermitWithCycles,
  project: Project | undefined,
  key: string,
  group: TrendsGroupBy,
): boolean {
  if (group === 'total') return true;
  const k = keyForGroupBy(permit, project, group);
  if (Array.isArray(k)) return k.includes(key);
  return k === key;
}

function keyForGroupBy(
  p: PermitWithCycles,
  proj: Project | undefined,
  group: TrendsGroupBy,
): string | string[] {
  switch (group) {
    case 'jurisdiction':
      return proj?.juris ?? 'Unknown';
    case 'type':
      return p.type ?? 'Unknown';
    case 'ent':
      return p.ent_lead ?? 'Unknown';
    case 'acq':
      // v2 permits have no acq column; everything bucket-as 'Unknown' for
      // now. Charts will render flat lines under this grouping until the
      // schema addition lands.
      return 'Unknown';
    case 'da':
      return p.da ?? p.architect ?? 'Unknown';
    case 'dm':
      return p.dm ?? 'Unknown';
    case 'tag': {
      const tags = (p.project_tags as unknown[]) ?? [];
      const list = tags.filter((t): t is string => typeof t === 'string');
      return list.length ? list : ['Untagged'];
    }
    case 'total':
      return 'Total';
  }
}

// ============================================================
// Dataset builders — one per chart
// ============================================================

export interface ChartPoint {
  month: string; // YYYY-MM
  /** Per-group counts keyed by group label. Always defined for every
   *  group; null means "no value this month" (line charts use spanGaps). */
  values: Record<string, number | null>;
}

/** Permits Submitted by Month — count of permits whose ANY cycle has
 * `submitted` in the bucket month. */
export function buildSubmittedSeries(
  filteredPermits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
  months: string[],
  groupKeys: string[],
): ChartPoint[] {
  return months.map((m) => {
    const values: Record<string, number | null> = {};
    for (const key of groupKeys) {
      const count = filteredPermits.filter((p) => {
        const proj = projectsById.get(p.project_id);
        if (!permMatchesGroup(p, proj, key, filters.group)) return false;
        return (p.permit_cycles ?? []).some(
          (c: PermitCycle) =>
            c.submitted && c.submitted.slice(0, 7) === m,
        );
      }).length;
      values[key] = count;
    }
    return { month: m, values };
  });
}

/** Permits Approved by Month — count of permits whose `approval_date`
 * (or fallback `actual_issue`) falls in the bucket month. */
export function buildApprovedSeries(
  filteredPermits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
  months: string[],
  groupKeys: string[],
): ChartPoint[] {
  return months.map((m) => {
    const values: Record<string, number | null> = {};
    for (const key of groupKeys) {
      const count = filteredPermits.filter((p) => {
        const proj = projectsById.get(p.project_id);
        if (!permMatchesGroup(p, proj, key, filters.group)) return false;
        const end = p.approval_date ?? p.actual_issue ?? '';
        return end.slice(0, 7) === m;
      }).length;
      values[key] = count;
    }
    return { month: m, values };
  });
}

/** Avg Permit Timeline by Month — for permits approved in month `m`,
 * average (end - earliest cycle submitted) in days. Null when no
 * permits with both endpoints exist that month (line chart spans gaps). */
export function buildTimelineSeries(
  filteredPermits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
  months: string[],
  groupKeys: string[],
): ChartPoint[] {
  return months.map((m) => {
    const values: Record<string, number | null> = {};
    for (const key of groupKeys) {
      const ps = filteredPermits.filter((p) => {
        const proj = projectsById.get(p.project_id);
        if (!permMatchesGroup(p, proj, key, filters.group)) return false;
        const end = p.approval_date ?? p.actual_issue ?? '';
        if (!end || end.slice(0, 7) !== m) return false;
        const submitted = earliestSubmitted(p);
        return !!submitted;
      });
      if (!ps.length) {
        values[key] = null;
        continue;
      }
      let total = 0;
      for (const p of ps) {
        const end = p.approval_date ?? p.actual_issue ?? '';
        const sub = earliestSubmitted(p)!;
        const days = Math.round(
          (new Date(end + 'T12:00:00').getTime() -
            new Date(sub + 'T12:00:00').getTime()) /
            (24 * 60 * 60 * 1000),
        );
        total += days;
      }
      values[key] = Math.round(total / ps.length);
    }
    return { month: m, values };
  });
}

/** GOs by Month — new projects (unique addresses) with go_date in the
 * bucket month. v1 dedupes by address: the first permit at an address
 * with go_date set "claims" that address; subsequent permits at the
 * same address don't double-count. */
export function buildGoSeries(
  filteredPermits: PermitWithCycles[],
  filters: TrendsFilters,
  projectsById: Map<string, Project>,
  months: string[],
  groupKeys: string[],
): ChartPoint[] {
  // First pass: dedupe per address — keep one permit per address with
  // a non-null go_date.
  const seenAddrs = new Set<string>();
  const goPermits: PermitWithCycles[] = [];
  for (const p of filteredPermits) {
    if (!p.go_date) continue;
    const proj = projectsById.get(p.project_id);
    const addr = proj?.address ?? `__noaddr_${p.project_id}`;
    if (seenAddrs.has(addr)) continue;
    seenAddrs.add(addr);
    goPermits.push(p);
  }

  return months.map((m) => {
    const values: Record<string, number | null> = {};
    for (const key of groupKeys) {
      // For each group, count distinct addresses with go_date in m.
      const addrs = new Set<string>();
      for (const p of goPermits) {
        const proj = projectsById.get(p.project_id);
        if (!permMatchesGroup(p, proj, key, filters.group)) continue;
        if ((p.go_date ?? '').slice(0, 7) !== m) continue;
        addrs.add(proj?.address ?? `__noaddr_${p.project_id}`);
      }
      values[key] = addrs.size;
    }
    return { month: m, values };
  });
}

// ============================================================
// Color palette (matches v1's TR_JURIS_COLORS + fallback)
// ============================================================

const TR_JURIS_COLORS: Record<string, string> = {
  Seattle: '#2563eb',
  Bellevue: '#059669',
  Kirkland: '#d97706',
  Redmond: '#7c3aed',
  Edmonds: '#0891b2',
  Bothell: '#dc2626',
  Phoenix: '#ea580c',
  Scottsdale: '#be185d',
};

const TR_FALLBACK_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#dc2626',
  '#ea580c',
  '#be185d',
  '#0369a1',
  '#16a34a',
];

/** Color for a given group key + its index in the legend. Jurisdiction
 * names get fixed hues so charts stay visually stable across
 * juris-narrowing filters. */
export function trColor(key: string, idx: number): string {
  return (
    TR_JURIS_COLORS[key] ??
    TR_FALLBACK_COLORS[idx % TR_FALLBACK_COLORS.length]
  );
}

// ============================================================
// Internals
// ============================================================

function parseMonth(s: string): Date | null {
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 7) + '-01T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function monthFloor(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
}

function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function earliestSubmitted(p: PermitWithCycles): string | null {
  const sorted = (p.permit_cycles ?? [])
    .map((c) => c.submitted ?? '')
    .filter(Boolean)
    .sort();
  return sorted[0] ?? null;
}

/** Format a month key as 'MMM YY' for chart axis labels. */
export function formatMonthShort(m: string): string {
  const d = parseMonth(m);
  if (!d) return m;
  const month = d.toLocaleString('default', { month: 'short' });
  const year = String(d.getFullYear()).slice(2);
  return `${month} ${year}`;
}
