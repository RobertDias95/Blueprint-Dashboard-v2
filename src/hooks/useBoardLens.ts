import { useCallback, useMemo, useState } from 'react';
import { useDmDaGroups } from './useDmDaGroups';
import { unmappedActiveDas } from '../lib/dmCoAssign';
import { isCurrentMember } from '../lib/roster';
import { useTeamMembers } from './useTeamMembers';
import { useSelfScope } from './useSelfScope';
import { useAuthStore } from '../stores/authStore';
import {
  DEFAULT_BOARD_LENS,
  loadBoardLens,
  reconcileLens,
  saveBoardLens,
  type BoardLens,
} from '../lib/boardByAssociate';

// ★★ fix-365 — who gets the control, and what it remembers.
//
// ★ ONLY PEOPLE IT MEANS SOMETHING TO. A design manager has associates; nobody
// else does. Putting a control on everyone's board that does nothing for them
// is how a screen accumulates the clutter fix-331 and fix-345 spent two tickets
// removing — so `hasAssociates` is false for 25 of the 29 logins and the
// control never renders for them.
//
// ★ `dm_da_groups` is the source of truth for who manages whom, and
// `useDmDaGroups` already reads it. Nothing here re-derives that mapping.

export interface BoardLensState {
  /** This viewer's design associates, in the roster's own order. */
  associates: string[];
  /** ★ Render the control at all? */
  hasAssociates: boolean;
  lens: BoardLens;
  setLens: (next: BoardLens) => void;
  /** ★★★ Active design associates with NO manager at all — see below. */
  unmanaged: string[];
}

export function useBoardLens(): BoardLensState {
  const { groups, rows: dmRows } = useDmDaGroups();
  const team = useTeamMembers();
  const { identity } = useSelfScope();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const associates = useMemo(() => {
    const me = (identity.name ?? '').trim().toLowerCase();
    if (!me) return [];
    const mine = groups.find((g) => g.dm.trim().toLowerCase() === me);
    return mine ? [...mine.das] : [];
  }, [groups, identity.name]);

  // ★★★ THE ASSOCIATES NOBODY MANAGES.
  //
  // MEASURED on prod 2026-08-20: **Cam and Shire are active design associates
  // with no row in `dm_da_groups` at all**, and between them they hold **21
  // open tasks** — more than Brittani's entire book of three associates (20).
  //
  // ★★ Their work reaches NO manager: not through fix-346's co-assign, which
  // keys off the same table, and therefore not through this grouping either.
  // A view that silently omitted them would take an existing gap and make it
  // INVISIBLE — a manager would read "Marc · Ahmadi · Fisk" and reasonably
  // conclude that is the whole design bench.
  //
  // ★ So the gap is SURFACED, not fixed. Adding them to `dm_da_groups` is a
  // data change and Bobby's decision, and it is already on his list; this only
  // makes sure the tool stops hiding the question.
  //
  // ★★★ fix-617 (census gap 40) — AND IT IS THE SHARED PREDICATE NOW. This
  //     used to walk the GROUPED view, which keys by `dm_name`; a row with a
  //     blank manager therefore made its DA look MANAGED here while
  //     `unmappedActiveDas` — the copy Settings shows — called the same person
  //     unmapped. Two screens, two answers, about the same person.
  const unmanaged = useMemo(
    () =>
      unmappedActiveDas(
        team.all
          .filter((m) => m.role === 'da' && isCurrentMember(m))
          .map((m) => m.name),
        dmRows,
      ).sort((a, b) => a.localeCompare(b)),
    [dmRows, team.all],
  );

  // ★ The remembered choice, read once per (user, roster) and overridable for
  // this mount. Same shape as fix-176's scope preference: an explicit choice
  // wins for the session, and is written through so the next visit starts
  // where this one left off.
  const [override, setOverride] = useState<BoardLens | null>(null);
  const stored = useMemo(() => loadBoardLens(userId), [userId]);

  // ★★ Reconciled against the CURRENT roster: a focus on somebody who is no
  // longer your associate is not a focus, it is an empty board.
  const lens = useMemo(
    () => reconcileLens(override ?? stored ?? DEFAULT_BOARD_LENS, associates),
    [override, stored, associates],
  );

  const setLens = useCallback(
    (next: BoardLens) => {
      setOverride(next);
      saveBoardLens(userId, next);
    },
    [userId],
  );

  return {
    associates,
    hasAssociates: associates.length > 0,
    lens,
    setLens,
    unmanaged,
  };
}
