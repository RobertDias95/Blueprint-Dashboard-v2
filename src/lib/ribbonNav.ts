// fix-313: the Blueprint Bridge ribbon's navigation model.
//
// The structure lives here rather than in Ribbon.tsx for two reasons. The
// react-refresh rule means a component module may export ONLY components, so
// the data and its helpers could not sit beside the JSX anyway; and keeping the
// model pure is what lets the tests assert RESOLVED ROUTES against the real
// route table instead of asserting that some link exists — the fix-306 lesson,
// where six board links pointed at `/projects/:id`, a route the app does not
// have, and the tests passed because they only compared href strings.

export interface RibbonLink {
  /** Route path. Must exist in router.tsx — asserted, not assumed. */
  to: string;
  label: string;
  /** Glyph for the collapsed ribbon. Text, so there is no icon font to load. */
  icon: string;
  /** Longer explanation, surfaced as the title attribute. Used where two
   *  entries could be confused for one another. */
  hint?: string;
  /** ★ fix-315: match this route EXACTLY rather than by prefix.
   *  /reports is the parent of seven child routes, so the default
   *  prefix match would light the overview entry up while you are reading
   *  Corrections — two entries claiming to be where you are. */
  exact?: boolean;
}

export interface RibbonGroup {
  /** Stable id for the open/closed state and the test ids. */
  id: string;
  label: string;
  icon: string;
  children: RibbonLink[];
  /** fix-234: Reports is admin-only. A non-admin must not see seven report
   *  entries they cannot open, so the WHOLE group is withheld — not an empty
   *  one, which would advertise a locked door. */
  adminOnly?: boolean;
}

export type RibbonEntry =
  | { kind: 'link'; link: RibbonLink }
  | { kind: 'group'; group: RibbonGroup }
  | { kind: 'separator'; id: string };

// ★ The structure is Bobby's, from the approved mockup (Bridge_Shell_Mockup_v1).
//
// The "Entitlements" grouping mirrors his inspiration image and is a guess
// about how the team thinks — build it, expect it to move. Draw Schedule,
// Library and Activity are the three screens that sit under it today.
export const RIBBON_ENTRIES: RibbonEntry[] = [
  { kind: 'link', link: { to: '/dashboard', label: 'Pipeline', icon: '▦' } },
  { kind: 'link', link: { to: '/board', label: 'My Board', icon: '◈' } },
  { kind: 'separator', id: 'sep-1' },
  { kind: 'link', link: { to: '/projects', label: 'Project View', icon: '▤' } },
  {
    kind: 'group',
    group: {
      id: 'entitlements',
      label: 'Entitlements',
      icon: '◫',
      children: [
        { to: '/draw-schedule', label: 'Draw Schedule', icon: '·' },
        { to: '/library', label: 'Library', icon: '·' },
        // ★ fix-315: stranded by fix-313, which folded My Tasks into My Board
        // and redirected /my-tasks -> /board. WaitingOnView went with it and it
        // is not a small panel — grouped by consultant firm with firm status, a
        // scope filter, an include-completed toggle, and CSV export both for
        // all rows and per firm (16 columns) so one consultant can be sent
        // their own open items.
        //
        // ★ It is NOT the Consultant forecast (/reports/vendor-forecast). That
        // forecasts upcoming SENDS; this is what each outside firm currently
        // OWES US. Different question, different audience, both stay.
        //
        // ★ ON THE LABEL. The brief invites a better name if "Waiting On" reads
        // ambiguously beside "Consultant forecast". Keeping it, deliberately:
        // it is this screen's established name across the RPC, the hook, the
        // CSV module and the team's own speech since fix-140, and renaming it
        // would open exactly the one-concept-two-names split fix-310 spent a
        // whole ticket closing. The two entries also live in different groups,
        // so they are never adjacent; the tooltip carries the distinction.
        {
          to: '/waiting-on',
          label: 'Waiting On',
          icon: '·',
          hint: 'What each outside firm currently owes us, by discipline and firm',
        },
        { to: '/activity', label: 'Activity', icon: '·' },
      ],
    },
  },
  {
    kind: 'group',
    group: {
      id: 'reports',
      label: 'Reports',
      icon: '◧',
      adminOnly: true,
      children: [
        // ★ fix-315: /reports itself — MetricCards, the overview tab, and
        // Trends at /reports?tab=trends — had no entry at all. fix-313 listed
        // the seven children and not the parent, so the live-metrics dashboard
        // became unreachable by clicking while still rendering perfectly.
        //
        // ★ WHY A FIRST CHILD RATHER THAN A CLICKABLE GROUP HEADER. The brief
        // offers both. A header that navigates AND expands cannot satisfy the
        // brief's own constraint — "a person opening the group to reach
        // Corrections should not be dragged to the metrics page first" —
        // unless the header is split into two hit targets, which makes the
        // expand control a 17px chevron and breaks the uniform behaviour every
        // other group has. An explicit first child keeps the header purely an
        // expander, makes the destination visible rather than discovered, and
        // inherits the collapsed-group active handling that already works.
        //
        // It also matches Bobby's model exactly: "the reports page that had all
        // of the report metrics, and then within Settings -> Reporting … all of
        // the individual reports you could run" — the metrics dashboard first,
        // the runnable reports beneath it.
        {
          to: '/reports',
          label: 'Overview',
          icon: '·',
          exact: true,
          hint: 'Live metrics — the reports dashboard, including Trends',
        },
        { to: '/reports/weekly-da', label: 'Weekly DA', icon: '·' },
        { to: '/reports/weekly-updates', label: 'Weekly Updates', icon: '·' },
        {
          to: '/reports/approved-awaiting',
          label: 'Approved, awaiting issue',
          icon: '·',
        },
        { to: '/reports/phase-durations', label: 'Phase durations', icon: '·' },
        { to: '/reports/vendor-forecast', label: 'Consultant forecast', icon: '·' },
        { to: '/reports/corrections', label: 'Corrections', icon: '·' },
        { to: '/settings/reporting', label: 'Saved reports', icon: '·' },
      ],
    },
  },
  { kind: 'separator', id: 'sep-2' },
];

/** The entries a viewer may see. fix-234's gate, applied to the whole group. */
export function visibleEntries(isAdmin: boolean): RibbonEntry[] {
  if (isAdmin) return RIBBON_ENTRIES;
  return RIBBON_ENTRIES.filter(
    (e) => !(e.kind === 'group' && e.group.adminOnly),
  );
}

/** Every route the ribbon can reach, admin included. Used by the test that
 *  checks each one against the real route table. */
export function allRibbonRoutes(): string[] {
  const out: string[] = [];
  for (const e of RIBBON_ENTRIES) {
    if (e.kind === 'link') out.push(e.link.to);
    if (e.kind === 'group') out.push(...e.group.children.map((c) => c.to));
  }
  return out;
}

/** Is this link the current route?
 *
 *  Prefix-matched on a path boundary, so /reports/weekly-da stays active while
 *  a child of it is open, and /reports does NOT light up /reports/corrections.
 *  Exact-only would drop the active state on any nested route; a bare
 *  startsWith would make /library match /library-archive. */
export function isLinkActive(
  to: string,
  pathname: string,
  exact = false,
): boolean {
  if (pathname === to) return true;
  // ★ fix-315: an exact entry never claims its own children. /reports is the
  // parent of seven routes; without this, opening Corrections would light up
  // BOTH it and the Overview entry.
  if (exact) return false;
  return pathname.startsWith(to.endsWith('/') ? to : `${to}/`);
}

/** ★ Does a group CONTAIN the active route?
 *
 *  This is what makes a COLLAPSED group show it is active. Without it, opening
 *  a report and then closing the group leaves the ribbon claiming nothing is
 *  selected, which reads as "you are nowhere". */
export function groupContainsActive(
  group: RibbonGroup,
  pathname: string,
): boolean {
  return group.children.some((c) => isLinkActive(c.to, pathname, c.exact));
}

// ---------------------------------------------------------------------------
// ★ fix-315: the guard for the defect that caused this ticket
// ---------------------------------------------------------------------------
//
// Two screens were lost because a HAND-WRITTEN LIST omitted them, and nothing
// failed — no test, no type error, no console warning. They still rendered;
// they were simply unreachable by clicking, and the only detector was Bobby
// noticing weeks later.
//
// So: every non-parameterised, non-redirect route in router.tsx must be either
// reachable from the ribbon or listed HERE, out loud, with a reason. Removing
// an entry from RIBBON_ENTRIES now fails a test unless you also come here and
// write down that you meant it.
export const ROUTES_INTENTIONALLY_NOT_IN_RIBBON: ReadonlyArray<{
  path: string;
  why: string;
}> = [
  { path: '/login', why: 'Unauthenticated. The ribbon does not render there.' },
  {
    path: '/settings/errors',
    why: 'Reached from the error-triage badge in the top bar, and from a shared URL when triaging a specific group. Not a browsing destination.',
  },
  {
    path: '/reports/builder',
    why: 'Opened from the Reporting hub ("Saved reports"), which is in the ribbon. A blank builder is not somewhere you navigate to cold.',
  },
  {
    path: '/trends',
    why: 'Redirect only — fix-trends-subtab folded Trends into /reports?tab=trends. Kept so old links work.',
  },
  {
    path: '/my-tasks',
    why: 'Redirect only — fix-313 merged My Tasks into My Board. Kept so bookmarks survive.',
  },
  {
    path: '/settings',
    why: 'Redirect only. System Settings is a MODAL, opened from the ribbon; the legacy path bounces to /dashboard.',
  },
];

/** Paths that are exempt, for the coverage test. */
export function ribbonExemptPaths(): string[] {
  return ROUTES_INTENTIONALLY_NOT_IN_RIBBON.map((r) => r.path);
}
