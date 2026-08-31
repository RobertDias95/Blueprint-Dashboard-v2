import type { TaskSource } from './database.types';

// ===========================================================================
// ★★★ fix-460 (P-046) — WHAT KIND OF THING IS THIS ROW?
// ===========================================================================
//
// Bobby, 2026-08-26: *"maybe there's a tag on it or something that identifies
// it as an agenda item versus a bot item versus the other options."*
//
// ★★ SO THE VOCABULARY IS DELIBERATELY THREE WORDS AND NO MORE, and two of them
// are facts the row already carried before this ticket:
//
//     'bot'   — is_auto_generated. The scraper made it.
//     'team'  — source === 'team'. No permit; a person made it.
//     null    — an ordinary permit task. NO TAG IS RENDERED.
//
// ★★★ THE THIRD STATE IS "NO TAG", AND THAT IS THE POINT. 1,643 of 1,643 rows
// today are ordinary permit tasks; tagging all of them would be 1,643 badges
// saying "normal". A tag earns its pixels only when it distinguishes.
//
// ★ The agenda value Bobby names is NOT here. That is
// P-045 (the weekly-meeting tracker) and it needs his ruling on meeting dates,
// the `department` roster column and agenda-member visibility. Adding a fourth
// word now would be guessing at a design he has not given.

export type TaskKind = 'bot' | 'team';

/** The row's source, defaulting to 'permit' when absent.
 *
 *  ★ ABSENT MEANS 'permit', not "unknown". `bp_list_tasks` always sends the
 *  field now, but hundreds of hand-built fixtures across the suite do not, and
 *  every one of them is a permit task. Treating missing as 'permit' is what
 *  lets this ship without touching them. */
export function taskSource(t: { source?: TaskSource | null }): TaskSource {
  return t.source === 'team' ? 'team' : 'permit';
}

/** True when this row belongs to no permit. */
export function isTeamTask(t: { source?: TaskSource | null }): boolean {
  return taskSource(t) === 'team';
}

/**
 * ★★ §B4 — the tag, or null when the row needs none.
 *
 * `bot` wins over `team` if both were ever true, but they cannot both be true:
 * `team_tasks` has no generator and `bp_list_tasks` sends
 * `is_auto_generated: false` for every team row BY CONSTRUCTION, not by
 * default. The precedence is stated anyway so a future writer cannot make the
 * question ambiguous by accident.
 */
export function taskKind(t: {
  source?: TaskSource | null;
  is_auto_generated?: boolean | null;
}): TaskKind | null {
  if (t.is_auto_generated === true) return 'bot';
  if (taskSource(t) === 'team') return 'team';
  return null;
}

/** The words on the tag. One place, so the board and My Tasks cannot drift. */
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  bot: 'Auto',
  team: 'Team',
};

/**
 * ★★★ §B2 — THE CONTEXT LINE, AND IT IS THE ONLY VISIBLE DIFFERENCE.
 *
 * A project task shows its address. A team task has no address to show — so it
 * says what it is instead of showing a blank where every other row has a place.
 *
 * ★ It does NOT fall back to `ref_project_id`'s address even when the team task
 * names a project. That link is data for a later ticket; giving it a rendering
 * path here would make a team task look like it lives somewhere, which is the
 * one impression this design must never give.
 */
export const TEAM_TASK_CONTEXT = 'Team task — no permit';

export function taskContextLine(t: {
  source?: TaskSource | null;
  project_address?: string | null;
}): string {
  if (isTeamTask(t)) return TEAM_TASK_CONTEXT;
  return t.project_address ?? '';
}
