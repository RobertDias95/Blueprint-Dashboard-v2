import type { ComponentType } from 'react';
import WeeklyDaReport from '../pages/WeeklyDaReport';

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
};

/** Resolve a builtin_key to its definition (null when unknown — e.g. a
 *  builtin added server-side before the client knows about it). */
export function builtinReportDef(
  key: string | null | undefined,
): BuiltinReportDef | null {
  if (!key) return null;
  return BUILTIN_REPORT_COMPONENTS[key] ?? null;
}
