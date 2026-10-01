// ===========================================================================
// ★★★ fix-611 (P-166 step 3a) — SEVEN CATEGORIES YOU OPEN UP
// ===========================================================================
//
// Bobby, 2026-09-30, across three asks: *categories you open up · a search ·
// "methodical, flow, readability" · "everything syncing end to end".*
//
// The five tabs that preceded this grouped settings by WHICH SCREEN BUILT THEM,
// not by what they are: the roster, three read-outs, the draw-schedule layout and
// the chat tags all lived on one "Team" tab, while the two halves of the
// per-type schedule sat on two different tabs (fix-319 #77's own comment flagged
// that split and declined to fix it). Seven categories, approved as a drawn mock,
// put each block where somebody would look for it.
//
// ---------------------------------------------------------------------------
// ★★ WHAT fix-319 ESTABLISHED AND THIS KEEPS
// ---------------------------------------------------------------------------
// Settings is a PAGE and its sections are URLs; the section list lives in this
// module rather than in the component because a component module may export only
// components (react-refresh), and keeping the model pure is what lets the tests
// assert resolved routes and the admin gate without rendering anything.
//
// ★ Every route stays STATIC (`/settings/people`, never `/settings/:section`). A
// dynamic segment would sit beside `/settings/errors` and silently swallow it.
//
// ★★★ AND THE OLD ROUTES REDIRECT RATHER THAN DISAPPEAR. fix-310's rule: a
// rename that moves a route breaks every bookmark and every link. `/settings/team`
// has existed since fix-319 and is in people's history and in at least one
// in-app link, so it lands on People instead of 404ing.

export type SettingsSectionId =
  | 'account'
  | 'people'
  | 'teams'
  | 'lists'
  | 'permits'
  | 'dates'
  | 'health';

export interface SettingsSection {
  id: SettingsSectionId;
  path: string;
  icon: string;
  label: string;
  desc: string;
  /** ★ Preserved EXACTLY from the modal, and enforced by AdminRoute at the
   *  router as well as by hiding the rail entry. A route is guessable in a way
   *  a modal tab was not. */
  adminOnly: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'account',
    path: '/settings/account',
    icon: '👤',
    label: 'My account',
    desc: 'Your own picture and sign-in. Everyone sees this.',
    adminOnly: false,
  },
  {
    id: 'people',
    path: '/settings/people',
    icon: '👥',
    label: 'People',
    desc: 'Who is on the team, what roles they hold, and how to reach them.',
    adminOnly: true,
  },
  {
    id: 'teams',
    path: '/settings/teams',
    icon: '🧭',
    label: 'Teams & routing',
    desc: 'Who works with whom, and who a project routes to.',
    adminOnly: true,
  },
  {
    id: 'lists',
    path: '/settings/lists',
    icon: '🏗️',
    label: 'Project lists',
    desc:
      'The pick lists a project is built from. Every dropdown reads one of ' +
      'these, and nothing else.',
    adminOnly: true,
  },
  {
    id: 'permits',
    path: '/settings/permits',
    icon: '📄',
    label: 'Permits & tasks',
    desc: 'Permit types, the tasks a permit starts with, and who a task can wait on.',
    adminOnly: true,
  },
  {
    id: 'dates',
    path: '/settings/dates',
    icon: '📅',
    label: 'Dates & targets',
    desc: 'The numbers every projected date is built from. One row per permit type.',
    adminOnly: true,
  },
  {
    id: 'health',
    path: '/settings/health',
    icon: '🩺',
    label: 'Health & tools',
    desc: 'Read-outs and checks. Nothing here changes a setting.',
    adminOnly: true,
  },
];

/**
 * ★★★ THE OLD ROUTES, AND WHERE THEY GO NOW.
 *
 * `/settings/permits` is deliberately ABSENT: the id survived the reshuffle, so
 * that URL still resolves to a real section and needs no redirect. The three
 * below are the ones whose id changed.
 */
export const SETTINGS_REDIRECTS: Readonly<Record<string, string>> = {
  '/settings/team': '/settings/people',
  '/settings/projects': '/settings/lists',
  '/settings/schedule': '/settings/dates',
};

/** The section a path selects, or null when the path is not a section. */
export function sectionForPath(pathname: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((s) => s.path === pathname) ?? null;
}

/** What a viewer may see in the rail. Mirrors the modal's filter exactly. */
export function visibleSettingsSections(isAdmin: boolean): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => isAdmin || !s.adminOnly);
}

/** Where bare /settings lands. My account is the only section every role can
 *  read, so it is the landing for everyone rather than admin-only. */
export const DEFAULT_SETTINGS_PATH = '/settings/account';

/** ★ fix-611: the rail grew from 200px to fit "Permits & tasks" on one line. */
export const SETTINGS_RAIL_WIDTH = 232;
