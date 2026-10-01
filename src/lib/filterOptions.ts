// ===========================================================================
// fix-619 (P-166 step 4b, P-173) — WHAT A FILTER OFFERS
// ===========================================================================
//
// fix-321's rule, restated in the brief: **CHOOSING is current-only; SHOWING is
// whatever is recorded.**
//
//   · A PICKER that sets a value offers the Settings list — nothing else.
//   · A FILTER offers the Settings list PLUS any value still stored on a
//     project or permit that the list no longer has, MARKED, so a straggler
//     can still be found — and never a value from nowhere.
//
// Before this, most filters built their options from the stored data alone (so
// a type or city in Settings that had no permit yet could not be filtered for,
// and a typo looked exactly like a real option), and the Library zone filter
// built them from the registry alone (so a retired zone still on a project
// could not be found). One helper, every filter.

/** The marker on a filter option that is stored but not in the Settings list. */
export const UNLISTED_MARKER = ' (not in Settings)';

export interface FilterOptionSet {
  /** The Settings list in its own order, then the stored stragglers, sorted. */
  options: string[];
  /** The stragglers — rendered with UNLISTED_MARKER. */
  unlisted: ReadonlySet<string>;
}

function clean(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function filterOptions(
  registry: Iterable<string | null | undefined>,
  stored: Iterable<string | null | undefined>,
): FilterOptionSet {
  const listed: string[] = [];
  const seen = new Set<string>();
  for (const r of registry) {
    const v = clean(r);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    listed.push(v);
  }
  const extra = new Set<string>();
  for (const s of stored) {
    const v = clean(s);
    if (v && !seen.has(v)) extra.add(v);
  }
  return {
    options: [...listed, ...[...extra].sort((a, b) => a.localeCompare(b))],
    unlisted: extra,
  };
}

/** The label an option shows in a filter. */
export function filterOptionLabel(value: string, set: Pick<FilterOptionSet, 'unlisted'>): string {
  return set.unlisted.has(value) ? `${value}${UNLISTED_MARKER}` : value;
}

/** An empty set, for a filter whose registry has not loaded. */
export const NO_FILTER_OPTIONS: FilterOptionSet = { options: [], unlisted: new Set() };
