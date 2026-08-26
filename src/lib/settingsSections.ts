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
  | 'schedule';

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
    // ★★★ fix-415 SCOPE C — LABELS ONLY. The `id`, the `path` and every
    // testid are UNCHANGED, which is fix-310's rule: a rename that moves a
    // route breaks every bookmark and every link, and this section has been
    // /settings/projects since fix-319.
    //
    // ★★ WHY IT NEEDED A NEW NAME. It holds jurisdictions, product types,
    // project tags, hold reasons, cancel reasons and now zones — six editable
    // vocabularies. "Projects" names none of them, which is why Bobby went
    // looking for the product-type editor and walked straight past it. The tab
    // already calls them catalogues in its own read-only banner ("you need
    // tenant admin to edit catalogs"), so the name is the app's own word rather
    // than a new one.
    id: 'projects',
    path: '/settings/projects',
    icon: '🏗️',
    label: 'Lists & Catalogs',
    desc: 'Zones, product types, jurisdictions, tags, hold + cancel reasons',
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
  // ★★★ fix-367 §1: REPORTING IS GONE FROM SETTINGS, which is the second half
  // of what Bobby asked for — "system settings would lose the Reporting tab".
  //
  // ★ A hub that lives in two places is the ambiguity he was describing, so it
  // lives in one: /reports/saved, in the Reports group where fix-317 put its
  // ribbon entry. /settings/reporting redirects there and keeps every bookmark
  // working. Nothing else in Settings moved.
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
