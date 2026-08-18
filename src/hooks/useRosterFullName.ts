import { useCallback } from 'react';
import { useTeamMembers } from './useTeamMembers';
import { rosterFullName } from '../lib/roster';

// ★★ fix-343 / register #127 — "Bobby Dias" from the key "Bobby".
//
// `team_members.name` is a JOIN KEY: one word, chosen years ago, pointed at by
// ~2,209 rows across 11 columns with no FK. It is not a display name, and the
// one place that difference showed was the chat avatar — `initialsOf('Bobby')`
// takes the first two letters of a single-word name and drew **BO**.
//
// ★ THE DATA ARRIVED, SO THE FIX IS A LOOKUP. first_name / last_name landed on
// prod 2026-08-18 for all 40 current roster rows. This hook turns the key into
// the full name; `initialsOf` — deliberately UNCHANGED, it was never wrong —
// then draws BD.
//
// ★ ONE QUERY, SHARED. `useTeamMembers` is the roster query the app already
// runs; React Query dedupes it, so a thread of forty messages calling this adds
// no fetch. The resolver is memoized on the roster so a re-render of one row
// does not re-walk it for the others.
//
// ★ AND IT NEVER FAILS CLOSED. An unknown name, a departed row with no
// first/last, an empty string — all return the input, so a caller always has a
// usable string and no call site has to decide what "no full name" looks like.

/** `(rosterKey) => "First Last"`, falling back to the key itself. */
export function useRosterFullName(): (name: string | null | undefined) => string {
  const team = useTeamMembers();
  const members = team.all;
  return useCallback(
    (name: string | null | undefined) => rosterFullName(name, members),
    [members],
  );
}
