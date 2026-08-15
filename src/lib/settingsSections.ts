// fix-319 #76: Settings is a page, and its sections are URLs.
//
//   Bobby: "Settings should no longer be a pop-up screen — it should just use
//   the screen vs a pop-up."
//
// The section list moves here rather than living in the page component, for
// the same reason ribbonNav.ts exists: a component module may export only
// components (react-refresh), and keeping the model pure is what lets the
// tests assert resolved routes and the admin gate without rendering anything.
//
// ─── ★ THE URL COLLISION THE BRIEF WARNED ABOUT DOES NOT EXIST ────────────
//
// The brief flags `/settings/reporting` as a trap: it says the modal's
// "Reporting" tab (AdminReportingTab) is "a DIFFERENT screen from the
// Reporting hub at the same-looking path", and that routing the modal's
// sections under /settings/:id would collide with the hub that fix-317 just
// routed the whole Reports group through.
//
// Read the code and they are THE SAME COMPONENT. ReportingHubPage was eighteen
// lines: a heading plus <AdminReportingTab />, and its own comment said so —
// "The modal section and this page share AdminReportingTab — single source of
// truth." So /settings/reporting has always been the Settings → Reporting
// section with a page heading on it.
//
// That means no distinct prefix, no moved hub, no renamed id: the Settings
// page's Reporting section IS /settings/reporting, rendering the same shelf it
// always did, and fix-317's "Saved reports" ribbon entry keeps working
// untouched. The wrapper page is retired because the Settings page now
// supplies the heading.
//
// The one deliberate choice: every section route is STATIC (/settings/team,
// not /settings/:section). A dynamic segment would sit next to the two
// pre-existing /settings/* routes and silently swallow a future section named
// `errors`. Static paths cannot, and the fix-315 coverage guard sees each one.

export type SettingsSectionId =
  | 'account'
  | 'team'
  | 'projects'
  | 'permits'
  | 'schedule'
  | 'reporting';

export interface SettingsSection {
  id: SettingsSectionId;
  path: string;
  icon: string;
  label: string;
  desc: string;
  /** ★ Preserved EXACTLY from SettingsModal. A route is guessable in a way a
   *  modal tab was not, so this is now enforced by AdminRoute at the router as
   *  well as by hiding the rail entry. */
  adminOnly: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'account',
    path: '/settings/account',
    icon: '👤',
    label: 'Account',
    desc: 'Your sign-in info + database tools',
    adminOnly: false,
  },
  {
    id: 'team',
    path: '/settings/team',
    icon: '👥',
    label: 'Team',
    desc: 'Manage people + draw schedule groupings',
    adminOnly: true,
  },
  {
    id: 'projects',
    path: '/settings/projects',
    icon: '🏗️',
    label: 'Projects',
    desc: 'Jurisdictions, product types, project tags',
    adminOnly: true,
  },
  {
    id: 'permits',
    path: '/settings/permits',
    icon: '📄',
    label: 'Permits',
    // ★ fix-319 #77: phase durations joined this section, so the description
    // says so. Bobby: "Technically this belongs in the Settings, in the permit
    // info."
    desc: 'Permit types, task templates, target formulas + phase durations',
    adminOnly: true,
  },
  {
    id: 'schedule',
    path: '/settings/schedule',
    icon: '📅',
    label: 'Schedule',
    desc: 'Per-juris learning windows',
    adminOnly: true,
  },
  {
    id: 'reporting',
    path: '/settings/reporting',
    icon: '📊',
    label: 'Reporting',
    desc: 'Saved reports library + categories',
    adminOnly: true,
  },
];

/** The section a path selects, or null when the path is not a section. */
export function sectionForPath(pathname: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((s) => s.path === pathname) ?? null;
}

/** What a viewer may see in the rail. Mirrors the modal's filter exactly. */
export function visibleSettingsSections(isAdmin: boolean): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => isAdmin || !s.adminOnly);
}

/** Where bare /settings lands. Account is the only section every role can
 *  read, so it is the landing for everyone rather than admin-only. */
export const DEFAULT_SETTINGS_PATH = '/settings/account';
