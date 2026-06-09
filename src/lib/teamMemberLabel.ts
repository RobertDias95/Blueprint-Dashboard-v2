import type { TeamMember } from './database.types';

// fix-143: labels for team members in the backfill wizard pickers. When the
// "Backfill historical project" toggle is ON, the role pickers list inactive +
// former members so a project can be assigned to historical staff; these
// helpers render a suffix so the non-active status is visible.

/** A member the active-only pickers normally hide: explicitly inactive
 *  (active === false) OR flagged former. */
export function isNonActiveMember(
  m: Pick<TeamMember, 'active' | 'former'>,
): boolean {
  return m.former === true || m.active === false;
}

/** Dropdown / selected-value label. Active members show their name only;
 *  non-active members get a status suffix:
 *    former   → "{name} (former)" / "{name} (former, ended {q})"
 *    inactive → "{name} (inactive)" / "{name} (inactive, ended {q})"
 *  former takes precedence over inactive. (Rendered inside native <option>
 *  elements, which can't style a substring, so the suffix is plain text — the
 *  status still reads clearly and the name stays first.) */
export function memberLabel(
  m: Pick<TeamMember, 'name' | 'active' | 'former' | 'active_end_quarter'>,
): string {
  const ended = m.active_end_quarter;
  if (m.former === true) {
    return ended ? `${m.name} (former, ended ${ended})` : `${m.name} (former)`;
  }
  if (m.active === false) {
    return ended ? `${m.name} (inactive, ended ${ended})` : `${m.name} (inactive)`;
  }
  return m.name;
}
