import { createContext, useContext } from 'react';

// ===========================================================================
// ★★★ fix-445 §A3 — WHICH ROWS ARE SHARED RATHER THAN MINE
// ===========================================================================
//
// Bobby, 2026-08-29 (ruling 4 / P-047): *"so 'mine' and 'shared' are
// distinguishable rather than blended."*
//
// ★★ CONTEXT, NOT A PROP THROUGH FOUR COMPONENTS. The answer needs
// `identity.name` and the ownership resolver, neither of which a card has, and
// the card is four levels down (BucketColumn → SubColumn → TaskGroupRows →
// TaskCard) behind a `memo`. Only the leaf that draws the mark reads it.
//
// ---------------------------------------------------------------------------
// ★★★ THE VALUE IS A SET, AND ITS IDENTITY MUST TRACK CONTENT — NOT RENDERS
// ---------------------------------------------------------------------------
//
// fix-434 §B1 pins that a status click does not re-render the other 49 cards.
// Publishing anything through context puts that pin at risk, because EVERY
// consumer re-renders when the provider's value changes identity — memo or no
// memo. Two versions failed it at 50 renders against a ceiling of 2:
//
//   1. a Set rebuilt from the visible tasks — new identity on every
//      optimistic status write;
//   2. a predicate closed over the ownership resolver — whose own identity
//      moves whenever `usePermits().data` / `useProjects().data` do. In
//      production React Query keeps those stable, but the fix-434 suite mocks
//      them as `data: []`, a fresh array per call, and it was right to: a
//      board that re-renders on a reference change it cannot see is a real
//      fragility, not a test artifact.
//
// ★★★ SO THE PAGE DERIVES A CONTENT KEY FIRST AND THE SET FROM THE KEY. The
// key is a joined, sorted list of ids; the Set is memoised on the key alone.
// Recomputing costs one O(n) pass the page was already paying, and the Set's
// identity now changes if and only if the ANSWER changed — which is exactly
// when the cards should hear about it.
//
// ★ NO COMPONENT IS EXPORTED FROM THIS FILE. `react-refresh/only-export-
// components` is an ERROR here and a file exporting both a component and a
// hook trips it — the same split fix-434 documents in
// lib/taskStatusOverlayContext.
//
// ★ The default is EMPTY, so a surface that renders a TaskCard without the
// provider (the detail pane, Waiting-On) shows no mark rather than crashing.
// Absence of a provider means "not computed here", never "nothing is shared".

/** ★ One frozen empty set — the default and the "Everyone" value, so neither
 *  hands out a new identity on every render. */
export const NO_CO_ASSIGNED: ReadonlySet<string> = new Set<string>();

export const CoAssignedContext =
  createContext<ReadonlySet<string>>(NO_CO_ASSIGNED);

/** True when this task reaches the viewer ONLY through the co-assignee join —
 *  see selfScope.isCoAssigned for the exact rule. */
export function useIsCoAssigned(taskId: string): boolean {
  return useContext(CoAssignedContext).has(taskId);
}
