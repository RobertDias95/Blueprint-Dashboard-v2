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
        // ★ fix-325 #4 and #5: Waiting On and Activity BOTH came out of here,
        // for the same reason in Bobby's words — neither is a place you go, so
        // neither should be a tab.
        //
        //   Activity: "I think we can give the activity and or make it a report
        //   from the scraper. That way we are not seeing that as an actual tab."
        //   It already IS scraper output, so this was a relocation, not a build:
        //   it is on the Reporting hub now, with the other scraper-derived
        //   reports, and the notification bell still links straight to it.
        //
        //   Waiting On: "I think the waiting on needs to get folded into the my
        //   task section." The Mine / Waiting On switcher already existed in the
        //   MyTasks shell; fix-318 had mounted only MineTasks because fix-315
        //   had just given Waiting On its own route and entry. Bobby has now
        //   decided the opposite, so /board mounts the full shell and the
        //   switcher is the way in.
        //
        // ★ Both routes still resolve — see ROUTES_INTENTIONALLY_NOT_IN_RIBBON.
        // Removing a destination without checking it is reachable elsewhere is
        // the fix-313 defect fix-315 existed to clean up; this removes two
        // ENTRY POINTS and leaves both destinations reachable.
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
        // ★ fix-317 (register #75): the six individual reports came OUT of here.
        // They were listed twice — once as ribbon entries, once inside Saved
        // reports, where they already sit grouped into categories.
        //
        //   Bobby: "it's showing six things that are duplicates, essentially.
        //   So I think it should maybe be Overview, Saved reports, and then
        //   within Saved reports you can see the two categories."
        //
        // Which restores his model: Reports is the live metrics dashboard,
        // Saved reports is the shelf of things you can run.
        { to: '/settings/reporting', label: 'Saved reports', icon: '·' },
        // ★★ fix-319 #77: and now the sixth. Phase durations left the ribbon —
        // not to the Saved reports shelf (it is not a report you run) but to
        // Settings → Permits, where the per-type targets it is evidence for
        // already live. /reports/phase-durations redirects there, so the
        // bookmark still works.
        //
        // The Reports group finally reads Overview + Saved reports, which is
        // the shape fix-317 was asking for.
        //
        // The old entry, for the record — it was the exception fix-317 kept
        // because the hub could not reach it:
        // ★ FIVE CAME OUT, NOT SIX — and this is the load-bearing exception.
        //
        // fix-315 exists because fix-313 removed a destination without checking
        // it was reachable elsewhere. Verified against PROD before deleting
        // anything: the hub lists from public.saved_reports, not from
        // builtinReports.ts, and phase_durations HAS NO ROW THERE. Five of the
        // six are on the shelf; this one is not, and the ribbon is the only
        // link to it anywhere in the app (grepped).
        //
        // Removing it would have manufactured exactly the defect fix-315 spent
        // a ticket cleaning up, so it stays until somebody seeds it. Its
        // catalog entry is already an explicit `phase_durations: null` flagged
        // by fix-267, with the intended slot written down — Pipeline, position
        // 1, which is why Pipeline currently runs 0, 2 with a gap. Seed that
        // row and this entry should come straight out.

      ],
    },
  },
  { kind: 'separator', id: 'sep-2' },
  // ★ fix-319 #76: Settings was a BUTTON that opened a dialog. It is a
  // destination now, so it is a link like everything else, and the coverage
  // guard covers it.
  { kind: 'link', link: { to: '/settings', label: 'Settings', icon: '⚙' } },
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
  // ★ fix-317: the five that came out of the Reports group. Each was VERIFIED
  // present on the prod shelf before its ribbon entry was deleted — the hub
  // lists from public.saved_reports, so a registry entry alone would not have
  // been evidence. The category is named so the next person can check the
  // claim without reading the registry.
  //
  // ★ phase_durations is deliberately NOT here: it has no saved_reports row,
  // so it keeps its ribbon entry. See the note beside it in RIBBON_ENTRIES.
  {
    path: '/reports/weekly-da',
    why: 'Reached from the Reporting hub ("Saved reports"), which is in the ribbon, where it sits under the Weekly Updates category as "Weekly DA Update".',
  },
  {
    path: '/reports/weekly-updates',
    why: 'Reached from the Reporting hub ("Saved reports"), which is in the ribbon, where it sits under the Weekly Updates category as "Weekly Updates".',
  },
  {
    path: '/reports/vendor-forecast',
    why: 'Reached from the Reporting hub ("Saved reports"), which is in the ribbon, where it sits under the Weekly Updates category as "Structural Schedule Forecast" — not Pipeline, and not under the ribbon\'s old "Consultant forecast" wording.',
  },
  {
    path: '/reports/approved-awaiting',
    why: 'Reached from the Reporting hub ("Saved reports"), which is in the ribbon, where it sits under the Pipeline category as "Approved – Awaiting Issuance".',
  },
  {
    path: '/reports/corrections',
    why: 'Reached from the Reporting hub ("Saved reports"), which is in the ribbon, where it sits under the Pipeline category as "Corrections".',
  },
  {
    path: '/reports/phase-durations',
    why: 'fix-319 moved this into Settings \u2192 Permits, beside the per-type target formulas it is the evidence for. The route is kept as a redirect so old bookmarks still land somewhere useful.',
  },
  // ★ fix-319: the Settings page sections. /settings itself IS in the ribbon,
  // and every section is one click from its rail — these are the deep links,
  // not separate destinations. /settings/reporting is deliberately absent
  // because it IS a ribbon entry ("Saved reports"), and a path may not be both.
  {
    path: '/settings/account',
    why: 'A section of the Settings page, which is in the ribbon. Reached from its left rail, and linkable so a section survives a reload.',
  },
  {
    path: '/settings/team',
    why: 'A section of the Settings page, which is in the ribbon. Admin-only, reached from its left rail.',
  },
  {
    path: '/settings/projects',
    why: 'A section of the Settings page, which is in the ribbon. Admin-only, reached from its left rail.',
  },
  {
    path: '/settings/permits',
    why: 'A section of the Settings page, which is in the ribbon. Admin-only, reached from its left rail; also where /reports/phase-durations now redirects.',
  },
  {
    path: '/settings/schedule',
    why: 'A section of the Settings page, which is in the ribbon. Admin-only, reached from its left rail.',
  },
  {
    path: '/trends',
    why: 'Redirect only — fix-trends-subtab folded Trends into /reports?tab=trends. Kept so old links work.',
  },
  {
    path: '/my-tasks',
    why: 'Redirect only — fix-313 merged My Tasks into My Board. Kept so bookmarks survive.',
  },
  // ★ fix-325: two entries came out of Entitlements. Both destinations are
  // alive and reachable; only the ribbon rows are gone.
  {
    path: '/activity',
    why: 'fix-325 #4: reached from the Reporting hub ("Saved reports"), which is in the ribbon, under "From the scraper" — and from the notification bell, which links straight to it. Bobby: "make it a report from the scraper … not seeing that as an actual tab."',
  },
  {
    path: '/waiting-on',
    why: 'fix-325 #5: redirect only — Waiting On folded into My Tasks, where the Mine / Waiting On switcher on /board is the way in. Bobby: "the waiting on needs to get folded into the my task section." Kept so the fix-315 links and bookmarks survive.',
  },

];

/** Paths that are exempt, for the coverage test. */
export function ribbonExemptPaths(): string[] {
  return ROUTES_INTENTIONALLY_NOT_IN_RIBBON.map((r) => r.path);
}
