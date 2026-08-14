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
export function isLinkActive(to: string, pathname: string): boolean {
  if (pathname === to) return true;
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
  return group.children.some((c) => isLinkActive(c.to, pathname));
}
