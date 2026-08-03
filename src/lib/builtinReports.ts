import type { ComponentType } from 'react';
import WeeklyDaReport from '../pages/WeeklyDaReport';
import WeeklyUpdatesReport from '../pages/WeeklyUpdatesReport';
import ApprovedAwaitingIssuanceReport from '../pages/ApprovedAwaitingIssuanceReport';
import PhaseDurationsReport from '../pages/PhaseDurationsReport';
import VendorScheduleForecastReport from '../pages/VendorScheduleForecastReport';

// fix-68: builtin report registry. Maps a saved_reports.builtin_key to its
// rendering component + the route that runs it. The Reporting hub (Settings
// -> Reporting) uses `route` to launch a builtin when its card's Run is
// clicked; the existing /reports/weekly-da route already mounts the
// component, so launching is just navigation. Phase 3 extends this map for
// any future builtins (custom reports render from saved_reports.spec instead
// and don't live here).

export interface BuiltinReportDef {
  /** The component that renders the report (also mounted at `route`). */
  component: ComponentType;
  /** The route that runs the report. */
  route: string;
  /** Human label (fallback when a saved_report row is missing a name). */
  label: string;
}

export const BUILTIN_REPORT_COMPONENTS: Record<string, BuiltinReportDef> = {
  weekly_da_update: {
    component: WeeklyDaReport,
    route: '/reports/weekly-da',
    label: 'Weekly DA Update',
  },
  // fix-notes-3: grouped, editable project/permit notes (public.notes source).
  weekly_updates: {
    component: WeeklyUpdatesReport,
    route: '/reports/weekly-updates',
    label: 'Weekly Updates',
  },
  // fix-253: city-review vs our-turnaround durations per type/juris/cycle.
  // Read-only evidence for the phase model; feeds no date.
  phase_durations: {
    component: PhaseDurationsReport,
    route: '/reports/phase-durations',
    label: 'Phase Durations',
  },
  // fix-221: Approved – Awaiting Issuance. Every approved-not-issued permit
  // (Seattle "Issuance Prep") with days-since-approval, deep-linking to Project View.
  approved_awaiting_issuance: {
    component: ApprovedAwaitingIssuanceReport,
    route: '/reports/approved-awaiting',
    label: 'Approved – Awaiting Issuance',
  },
  // fix-265: the weekly schedule forecast Blueprint owes its structural
  // engineer — new projects, schedule changes, the running pipeline, and the
  // corrections currently sitting with them. Composes an Outlook draft; sending
  // stays a separate, explicit action.
  vendor_schedule_forecast: {
    component: VendorScheduleForecastReport,
    route: '/reports/vendor-forecast',
    label: 'Vendor Schedule Forecast',
  },
};

// ---------------------------------------------------------------------------
// fix-267: the hub catalog — and the guard that keeps it honest
// ---------------------------------------------------------------------------
//
// THE BUG THIS EXISTS TO PREVENT. Registering a builtin above gives it a route
// and a component, but the Reporting hub lists from the public.saved_reports
// TABLE, not from this registry. fix-265 added vendor_schedule_forecast here and
// never seeded the row, so the report existed, worked, and was reachable only by
// typing /reports/vendor-forecast. Bobby could not find it. Auditing prod for
// fix-267 found the same omission had already happened once before, silently.
//
// So each builtin now has to declare its hub placement — or declare, explicitly,
// that it has none. A test asserts the two maps have identical key sets, which
// means adding a builtin without making that decision fails CI loudly instead of
// hiding a finished report.
//
// This is a client-side mirror of what the seed migration inserts, in the spirit
// of the fix-153 pure-TS mirror pattern: CI has no live DB, so the guard checks
// the DECISION is present rather than that the row exists.

export interface BuiltinReportCatalogEntry {
  /** saved_reports.name — what the hub card is called. May differ from `label`
   *  above: the vendor forecast is "Structural Schedule Forecast" in the hub
   *  because that is what it is to the people reading it. */
  name: string;
  /** report_categories.name to file it under, resolved per tenant at seed time.
   *  A tenant missing that category still gets the row, uncategorised (the hub
   *  lists category_id IS NULL under "All"), rather than losing the report. */
  category: string;
  /** saved_reports.position within the category. */
  position: number;
}

/** fix-267: hub placement per builtin. `null` means DELIBERATELY not listed —
 *  reachable by URL only.
 *
 *  Every key in {@link BUILTIN_REPORT_COMPONENTS} must appear here and vice
 *  versa; `builtinReportCatalogDrift` proves it and a test fails on any gap. */
export const BUILTIN_REPORT_CATALOG: Record<
  string,
  BuiltinReportCatalogEntry | null
> = {
  weekly_da_update: {
    name: 'Weekly DA Update',
    category: 'Weekly Updates',
    position: 0,
  },
  weekly_updates: {
    name: 'Weekly Updates',
    category: 'Weekly Updates',
    position: 1,
  },
  // fix-265 / fix-267: seeded by migrations/fix_267_seed_vendor_forecast_report.sql.
  vendor_schedule_forecast: {
    name: 'Structural Schedule Forecast',
    category: 'Weekly Updates',
    position: 2,
  },
  approved_awaiting_issuance: {
    name: 'Approved – Awaiting Issuance',
    category: 'Pipeline',
    position: 0,
  },
  // fix-253 / fix-267: NOT in the hub, and this null is a FLAG, not a decision.
  // The prod audit for fix-267 found phase_durations has no saved_reports row —
  // the identical omission fix-265 made, made earlier and never noticed. It is
  // left unseeded here only because surfacing a new card in Bobby's hub is his
  // call, not a migration's. Give it a catalog entry (Pipeline / position 1) to
  // seed it; the fix-267 PR body carries the one-line SQL.
  phase_durations: null,
};

/** fix-267: keys registered as components but with no catalog decision, and
 *  vice versa. Both lists empty = the maps agree. Pure so the test can assert on
 *  it without a database. */
export function builtinReportCatalogDrift(
  components: Record<string, unknown> = BUILTIN_REPORT_COMPONENTS,
  catalog: Record<string, unknown> = BUILTIN_REPORT_CATALOG,
): { missingCatalog: string[]; orphanCatalog: string[] } {
  const componentKeys = Object.keys(components);
  const catalogKeys = Object.keys(catalog);
  return {
    missingCatalog: componentKeys.filter((k) => !(k in catalog)).sort(),
    orphanCatalog: catalogKeys.filter((k) => !(k in components)).sort(),
  };
}

/** fix-267: the builtins that SHOULD have a saved_reports row — the exact set
 *  the seed migration inserts. */
export function seededBuiltinKeys(
  catalog: Record<string, BuiltinReportCatalogEntry | null> = BUILTIN_REPORT_CATALOG,
): string[] {
  return Object.keys(catalog)
    .filter((k) => catalog[k] !== null)
    .sort();
}

/** Resolve a builtin_key to its definition (null when unknown — e.g. a
 *  builtin added server-side before the client knows about it). */
export function builtinReportDef(
  key: string | null | undefined,
): BuiltinReportDef | null {
  if (!key) return null;
  return BUILTIN_REPORT_COMPONENTS[key] ?? null;
}
