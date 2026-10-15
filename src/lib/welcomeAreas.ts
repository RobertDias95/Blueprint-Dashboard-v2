import type { TeamRole } from './database.types';
import { visibleEntries, type RibbonLink } from './ribbonNav';
import type { WelcomeAreaKey } from '../../supabase/functions/admin-create-user/welcome';

// ===========================================================================
// ★★★ fix-670 §C (P-351) — "WHERE TO LOOK FIRST" SHOWS ONLY WHAT THEY CAN OPEN
// ===========================================================================
//
// Bobby, on the draft: *"in v1, we want them to see things that viewers/others
// can see not admins - so reports category that is hidden for most people,
// should not be visible to them yet."*
//
// ★★★ DERIVED, NEVER HAND-TYPED. Each area names the ribbon destination it
//     describes, and is listed only when `visibleEntries` — the same function
//     the ribbon renders from — shows that destination to this person. So the
//     day an entry's gate changes, the email follows it.
//
// ★★ Two areas are not a plain "can they see it" question:
//    - Chat has no ribbon entry; it lives inside each project, so it is listed
//      when Projects is.
//    - My Board is visible to every login, but a `viewer` is never assigned
//      work (fix-343), so the board would be empty for them. The approved
//      view-only version leaves it out.

export interface WelcomeArea {
  key: WelcomeAreaKey;
  /** The ribbon destination this line describes. */
  to: string;
}

/** In the order the email lists them. */
export const WELCOME_AREAS: readonly WelcomeArea[] = [
  { key: 'my_board', to: '/board' },
  { key: 'projects', to: '/dashboard' },
  { key: 'draw_schedule', to: '/draw-schedule' },
  { key: 'library', to: '/library' },
  // ★ inside every project, so it rides on Projects' visibility
  { key: 'chat', to: '/dashboard' },
];

/** Every ribbon destination this person can open, groups flattened. */
export function visibleRibbonPaths(isAdmin: boolean, isAgendaMember = false): Set<string> {
  const out = new Set<string>();
  for (const e of visibleEntries(isAdmin, isAgendaMember)) {
    if (e.kind === 'link') out.add(e.link.to);
    if (e.kind === 'group') e.group.children.forEach((c: RibbonLink) => out.add(c.to));
  }
  return out;
}

export function welcomeAreas(
  role: TeamRole,
  isAdmin: boolean,
  isAgendaMember = false,
  areas: readonly WelcomeArea[] = WELCOME_AREAS,
): WelcomeAreaKey[] {
  const paths = visibleRibbonPaths(isAdmin, isAgendaMember);
  return areas
    .filter((a) => paths.has(a.to))
    .filter((a) => !(role === 'viewer' && a.key === 'my_board'))
    .map((a) => a.key);
}
