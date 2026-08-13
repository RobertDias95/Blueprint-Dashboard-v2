import type { ComponentType } from 'react';
import WeeklyDaReport from '../pages/WeeklyDaReport';
import WeeklyUpdatesReport from '../pages/WeeklyUpdatesReport';
import ApprovedAwaitingIssuanceReport from '../pages/ApprovedAwaitingIssuanceReport';
import PhaseDurationsReport from '../pages/PhaseDurationsReport';
import VendorScheduleForecastReport from '../pages/VendorScheduleForecastReport';
import CorrectionsReport from '../pages/CorrectionsReport';

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
  // fix-277: every indexed correction-letter comment across every project, with
  // the consecutive-cycle repeat rate. Replaces the per-project panel fix-276
  // put on Project Overview.
  corrections: {
    component: CorrectionsReport,
    route: '/reports/corrections',
    label: 'Corrections',
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

/** fix-270: how a report decides what appears in it, in the words of the people
 *  who read it.
 *
 *  saved_reports.description says WHAT a report covers. Nothing said HOW IT
 *  DECIDES — which is why the vendor forecast's stale rows read as a bug rather
 *  than a rule, and why "how does something fall off this report" had to be
 *  asked of Bobby directly. Keeping it HERE, next to the catalog entry, means a
 *  logic change and its explanation land in the same diff.
 *
 *  Structured rather than one blob so every report reads the same way:
 *  what gets in, what stays out, and the things that surprise people.
 *
 *  WRITE FOR GENA AND BRITTANI, NOT FOR DEVELOPERS. No function names, no column
 *  names. "Projects whose permits have all issued", never "allPermitsDoneIds". */
export interface HowItWorks {
  /** What qualifies a row for the report. */
  included: string[];
  /** What keeps a row out. A report that excludes nothing has not been thought
   *  about — the fix-270 guard requires this to be non-empty. */
  excluded: string[];
  /** The non-obvious parts: where the report disagrees with intuition, with the
   *  city portal, or with another report. */
  notes?: string[];
}

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
  /** fix-270: how this report decides what appears. Required for anything with a
   *  hub placement — a report nobody can explain is a report nobody can trust. */
  howItWorks: HowItWorks;
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
    howItWorks: {
      included: [
        'Grouped by Design Associate. Permits with no DA are grouped under "Unassigned", which always sorts last.',
        'Corrections — permits the city has returned corrections on that we have not resubmitted yet.',
        'Upcoming intakes — permits with a target submit date inside the report window (14 days unless you change it) that have never been accepted at intake.',
        'Approved, awaiting issuance — permits with an approval date and no issue date.',
        "Each row carries that permit's newest open note, editable here; edits write straight back to the project.",
      ],
      excluded: [
        'Every permit on a project that is ON HOLD. The whole project disappears from the report, not just some of its rows.',
        'Cancelled projects, for the same reason — hold and cancel share one mechanism and both drop out.',
        'From upcoming intakes: any permit that has EVER been accepted at intake, plus anything already approved, issued, completed, closed or ready for issuance.',
        'From approved-awaiting-issuance: sub-permits, and permits marked Issued, Withdrawn, Completed or Closed.',
        'Sub-permits generally — they are reviewed under their parent permit.',
      ],
      notes: [
        'The intake gate is "ever accepted", not "currently accepted". Once a permit has been through intake it never comes back to the upcoming list, even on a later cycle.',
        'Putting a project on hold silently removes it. Today that hides 17 permits across the 6 held or cancelled projects — nothing announces it, the rows just stop appearing.',
        'Widening the window from 14 days pulls in more upcoming intakes and changes nothing else.',
      ],
    },
  },
  weekly_updates: {
    name: 'Weekly Updates',
    category: 'Weekly Updates',
    position: 1,
    howItWorks: {
      included: [
        'Every active project, whether or not it has any notes.',
        "The project's own notes first, then each permit's notes in the order the permits are listed on the project.",
        'Notes that have not been marked complete, newest first.',
        'Projects that have open notes sort to the top; everything else follows alphabetically by address.',
      ],
      excluded: [
        'Archived projects.',
        'Cancelled projects.',
        'Completed notes — hidden by default, but each section has its own history toggle if you want them back.',
      ],
      notes: [
        'Held projects DO still appear here. That is a deliberate difference from the Weekly DA Update, which drops them entirely.',
        'Notes are editable in place and there is only one copy — what you change here is what the project and permit pages show. This is not a snapshot.',
        'The "only projects with notes" checkbox narrows the list; leaving it off shows every active project.',
      ],
    },
  },
  // fix-265 / fix-267: seeded by migrations/fix_267_seed_vendor_forecast_report.sql.
  vendor_schedule_forecast: {
    name: 'Structural Schedule Forecast',
    category: 'Weekly Updates',
    position: 2,
    howItWorks: {
      included: [
        'Projects whose draw block is in a pre-submittal phase — Scheduled, Schematic, DD / Permit Set or Pending Consultants — and that have an address. Redesigns count in their own right.',
        'Their target send date (Draw End) must still be ahead of us.',
        'Exception: a target send date that has already passed still shows IF the project has a structural task that is open and not yet started. Those appear at the top of Upcoming, marked OVERDUE.',
        'Once that task is started, the project moves to Transmitted instead — sent, awaiting return.',
        'The project\'s PHASE decides which section a structural task lands in, not what the task is called. On a pre-submittal project it is the design handoff (Upcoming or Transmitted); on a project past submittal it is a correction.',
      ],
      excluded: [
        'Projects whose permits have all issued or closed. This overrides everything else, including an open transmit task.',
        'Draw blocks that have moved past submittal — Under Review, Corrections or Approved.',
        'A target send date that has passed when the project has NO transmit task at all: nothing says the work is still live.',
        'Projects whose transmit task has been resolved — the package came back, so the design phase is finished.',
        'Cancelled projects, and any block flagged to stay out of vendor emails.',
        'Vacation, PTO and training blocks — they are not projects and never reach this report.',
      ],
      notes: [
        'Target send is a commitment, not an observation: it is the date we are aiming to hand documents over, not something we watched happen.',
        'Empty sections vanish from the email completely, so most weeks show two or three of the five.',
        'Composing a draft records nothing — previewing is free. Only "Mark as sent" updates what the consultant is treated as knowing. Skip it and everything shows as new again next week.',
        'Held projects stay on the list, labelled, so the consultant knows a project is parked rather than wondering why it went quiet.',
        'Name the task whatever you like — the report reads the project\'s phase, not the task name. Only that a structural task EXISTS and whether it has been started matters.',
        'Only a handful of projects currently carry a structural task. Until a project has one, it will drop off silently the moment its target send date passes.',
        'A project with no draw block at all is treated as permitting, so its structural work shows under Corrections. Putting an unknown into a "coming to you" list is the worse mistake.',
      ],
    },
  },
  approved_awaiting_issuance: {
    name: 'Approved – Awaiting Issuance',
    category: 'Pipeline',
    position: 0,
    howItWorks: {
      included: [
        'Permits that have an approval date recorded and no issue date.',
        'Every jurisdiction and every permit type.',
        'Sorted by how long they have been waiting, longest first.',
      ],
      excluded: [
        'Sub-permits — they are reviewed under their parent permit.',
        'Permits marked Issued, Withdrawn, Completed or Closed, even if an approval date is still on the record.',
        'Anything with an issue date, however recent.',
      ],
      notes: [
        'This keys off OUR approval date, not the word the city portal uses. A permit the portal calls "Approved" will NOT appear unless an approval date is recorded here — and one the portal calls "Ready for Issuance" or "Awaiting Information" WILL appear if it has one. The two do not line up, and this report follows ours.',
        'Permits in this state count as ISSUED in throughput and completion figures elsewhere: the decision was that for our purposes they are done.',
      ],
    },
  },
  // fix-277 / seeded by migrations/fix_277_seed_corrections_report.sql.
  // Filed at Pipeline position 2, NOT 1: the phase_durations note below already
  // reserves Pipeline/1 for the day someone gives that report a placement, and
  // quietly taking its slot would make that note wrong.
  corrections: {
    name: 'Corrections',
    category: 'Pipeline',
    position: 2,
    howItWorks: {
      included: [
        'Every comment the indexer has read off a correction letter, across every project — 2,194 comments on 93 projects today.',
        'A comment is one numbered item on one letter: its discipline, its round, who wrote it and what it asked for.',
        'The repeat view treats a topic — a building, a discipline and a category together — as repeating when the city raised it in one round and again in the very next round.',
        'A topic can only count as a repeat if the project actually went on to another round. A comment on the newest round has nothing after it yet.',
        'Counts by theme and by discipline follow the filters, so every number on the page and every row in the item list describe the same slice.',
      ],
      excluded: [
        'Projects the indexer has never been run against. Most projects have nothing here yet — it is a manual run on one PC, not something that happens on its own.',
        'Letters the indexer could not read: scans with no text in them, and files named in a way it does not recognise as a correction letter.',
        'Comments with no round recorded are left out of the repeat maths, because "again in the next round" means nothing without a round. They still appear in the counts and the item list.',
        'Once you set a date range, comments with no date on their letter drop out rather than being shown as though they fell inside it.',
      ],
      notes: [
        'The repeat rule here is stricter than the one the project page used to show: it needs the VERY NEXT round, not just some later one. Raised in round 1 and again in round 3 means it was fixed once and came back — a different problem from one the city had to write twice running.',
        'A topic belongs to its project. The same discipline and category on two different projects is two projects sharing a problem, not a repeat.',
        'Architect is barely recorded — 72 of the 2,194 comments, spread over 3 projects. The filter works, but until more projects carry an architect it will hide nearly everything. The page says so above the filters.',
        'The date shown is the date on the letter, not the day the indexer read it.',
        'This report changes nothing. The indexer owns the data end to end, and it only refreshes when someone runs it.',
      ],
    },
  },
  // fix-253 / fix-267: NOT in the hub, and this null is a FLAG, not a decision.
  // The prod audit for fix-267 found phase_durations has no saved_reports row —
  // the identical omission fix-265 made, made earlier and never noticed. It is
  // left unseeded here only because surfacing a new card in Bobby's hub is his
  // call, not a migration's. Give it a catalog entry (Pipeline / position 1) to
  // seed it; the fix-267 PR body carries the one-line SQL.
  //
  // fix-270: its howItWorks is written out below rather than as a field, because
  // `null` means "no hub placement" and a null entry has nowhere to hang one.
  // Not forced into the type — lift this straight into a howItWorks block the
  // day someone gives it a placement. It has the least obvious rule of the five:
  //
  //   INCLUDED
  //     - Completed review phases only, split two ways per permit type,
  //       jurisdiction and correction cycle: how long the CITY took (submitted
  //       to corrections issued) and how long WE took (corrections issued to
  //       resubmitted).
  //     - A cohort needs at least 3 completed phases before any figure is shown;
  //       below that you see the count and no median.
  //   EXCLUDED
  //     - ANY PHASE STILL IN FLIGHT. A cycle that has been submitted but has no
  //       corrections back yet, or has corrections out but no resubmittal yet,
  //       contributes NOTHING and is not counted anywhere on the page. On prod
  //       today that is 293 open city phases and 47 of ours, out of 603 cycles —
  //       so roughly half the review activity is invisible here by design.
  //     - Spans that are negative or longer than two years (data errors).
  //     - Cohorts of fewer than 3 completed phases disappear from the grid
  //       entirely rather than showing an empty row.
  //   NOTES
  //     - These are medians of FINISHED work, so a jurisdiction that has slowed
  //       down recently looks unchanged until its slow cycles actually close.
  //     - "Recent" figures use a 180-day window on the date the phase ENDED.
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

/** fix-270: hub-placed builtins whose howItWorks is missing or empty.
 *
 *  A report placed in the hub without an explanation is the gap this whole
 *  change exists to close, so CI refuses it. Both lists must be non-empty:
 *  a report that excludes nothing has almost certainly not been thought about.
 *  A `null` entry (URL-only, deliberately unlisted) needs nothing. */
export function builtinReportsMissingHowItWorks(
  catalog: Record<string, BuiltinReportCatalogEntry | null> = BUILTIN_REPORT_CATALOG,
): string[] {
  return Object.keys(catalog)
    .filter((key) => {
      const entry = catalog[key];
      if (entry === null || entry === undefined) return false;
      const h = entry.howItWorks;
      if (!h) return true;
      return (
        !Array.isArray(h.included) ||
        h.included.length === 0 ||
        !Array.isArray(h.excluded) ||
        h.excluded.length === 0
      );
    })
    .sort();
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

/** fix-270: a builtin's how-it-works, or null when it has none — a custom report,
 *  an unknown key, or a URL-only builtin with no hub placement. */
export function builtinReportHowItWorks(
  key: string | null | undefined,
): HowItWorks | null {
  if (!key) return null;
  return BUILTIN_REPORT_CATALOG[key]?.howItWorks ?? null;
}

/** Resolve a builtin_key to its definition (null when unknown — e.g. a
 *  builtin added server-side before the client knows about it). */
export function builtinReportDef(
  key: string | null | undefined,
): BuiltinReportDef | null {
  if (!key) return null;
  return BUILTIN_REPORT_COMPONENTS[key] ?? null;
}

// ---------------------------------------------------------------------------
// fix-282: a saved report has THREE shapes, not two
// ---------------------------------------------------------------------------
//
// THE BUG THIS EXISTS TO PREVENT. `builtinReportDef` returns null for two very
// different situations — "this is a custom report" and "this is a builtin I do
// not recognise" — and every caller that wrote `def ? def.route : customRoute`
// silently merged them. It sent unknown builtins down the custom-report path.
//
// That path runs `bp_run_saved_report`, which reads saved_reports.spec. Every
// builtin row has `spec = {}` — correctly so, a builtin renders from a
// component, not a spec — so the RPC hits `spec.entity is required` and throws,
// 100% of the time. It is an RPC that cannot succeed.
//
// The unknown case is not exotic. It is the normal state of a browser holding a
// bundle from before the newest builtin shipped: the seed migration adds the
// saved_reports row the moment it runs, but a client keeps its cached JS until
// it reloads. That window produced the production error this ticket fixes
// (builtin_key 'corrections', which IS registered above — the reporting client
// simply predated it).
//
// So the three cases are named, and the type makes the third impossible to
// fold back into the second.

export type SavedReportTarget =
  /** builtin_key is null — a real custom report, spec-driven. */
  | { kind: 'custom' }
  /** builtin_key is registered in this bundle. */
  | { kind: 'builtin'; key: string; def: BuiltinReportDef }
  /** builtin_key is set but absent from this bundle: newer server than client.
   *  NOT runnable here — no component to render, and no spec to run. */
  | { kind: 'unknown'; key: string };

export function resolveSavedReportTarget(
  key: string | null | undefined,
): SavedReportTarget {
  if (!key) return { kind: 'custom' };
  const def = BUILTIN_REPORT_COMPONENTS[key];
  return def ? { kind: 'builtin', key, def } : { kind: 'unknown', key };
}

/** The message shown when a builtin cannot be rendered by this bundle. The key
 *  is included deliberately: it is the one piece of information that turns a
 *  support report into a diagnosis. */
export function unknownBuiltinMessage(key: string): string {
  return (
    `This report ("${key}") needs a newer version of the app than the one ` +
    'loaded in this tab. Please refresh to update.'
  );
}
