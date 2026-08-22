// fix-324 #66–#69: which Pipeline columns this person has folded, remembered
// across reloads.
//
// ★ NO NEW MECHANISM. This is the SAME one fix-313 gave the ribbon
// (`src/lib/ribbonPrefs.ts`), which is itself the shape `src/lib/selfScope.ts`
// established: localStorage, keyed per user id, best-effort, returning null when
// this user has never chosen so the caller applies its own default rather than
// inheriting a stored non-answer.
//
// It is a separate MODULE rather than two more functions inside `ribbonPrefs`
// because that file is about the ribbon; a Pipeline preference filed under
// "ribbon" is the kind of misfiling nobody ever finds again. Same mechanism,
// same key discipline, its own namespace.
//
// ★ Per user, not per browser — fix-176's rule. One login's folded columns must
// never decide what another person sees on a shared machine.
//
// ONE ARRAY, NOT ONE KEY PER COLUMN. Groups and sub-columns share a single
// stored list of "what is folded", so adding a sub-column later needs no new
// storage key and no migration: an unknown key simply never matches.

import {
  loadCollapsedKeys,
  saveCollapsedKeys,
} from './collapsePrefs';

// ★ fix-326 lifted the reading and writing into `collapsePrefs` so a fourth
// panel did not become a fourth copy. THE STORAGE KEY IS UNCHANGED — nobody's
// folded columns spring open on deploy — and so are the exported names.
const NAMESPACE = 'pipeline.collapsed';

/** The folded columns this user chose, or null when they never have. */
export function loadPipelineCollapsed(
  userId: string | null | undefined,
): string[] | null {
  return loadCollapsedKeys(NAMESPACE, userId);
}

export function savePipelineCollapsed(
  userId: string | null | undefined,
  keys: string[],
): void {
  saveCollapsedKeys(NAMESPACE, userId, keys);
}

/** The stored key for a group. Stage codes, so the list survives a title
 *  change — fix-323 renamed "Approve" to "Approved" and nobody's folded
 *  columns should have sprung open because of a word. */
export function pipelineGroupKey(groupKey: string): string {
  return `g:${groupKey}`;
}

/**
 * ★ fix-324b — register #68: "Approve and Issue default to COLLAPSED."
 *
 * fix-324 shipped all four columns open because that is how the signed-off
 * mockup DRAWS them. The mockup is an illustration of the layout; #68 is a
 * stated rule about the starting state, and the rule wins. The two working
 * columns are where the day is spent; Approved and Issued are for glancing at,
 * so they start as spines and cost nothing until someone wants them.
 *
 * ★ This is the DEFAULT, not a floor — it applies only when this user has never
 * chosen. The moment they fold or open anything, their stored list is the whole
 * answer and this is never consulted again. A "default" that reasserted itself
 * on every load would be a preference that does not work.
 */
export function defaultCollapsedKeys(): string[] {
  return [pipelineGroupKey('ap'), pipelineGroupKey('is')];
}

/** The stored key for one sub-column inside a group. */
export function pipelineSubKey(groupKey: string, subTitle: string): string {
  return `s:${groupKey}:${subTitle}`;
}

/**
 * ★ fix-383: the prefix every sub-column key of a group shares.
 *
 * A count click has to UNFOLD the column it is sending you to — Approved and
 * Issued default to collapsed (#68), so revealing a project inside a folded
 * spine would show you nothing. Unfolding needs to clear the group key and any
 * folded sub-column under it, and matching on this prefix does that WITHOUT
 * the caller having to know the sub-column titles. Those titles live in the
 * PipelineGroup props in Dashboard.tsx; copying them into a reveal map would
 * be a second list to keep in step, and the first one to drift.
 *
 * The cost is that unfolding for a `co` click also unfolds its sibling "Under
 * Review". Sub-columns start unfolded and are rarely folded by hand, and
 * "I asked to see this project in Permitting" is a fair reading of opening
 * Permitting — cheaper than duplicating the titles.
 */
export function pipelineSubKeyPrefix(groupKey: string): string {
  return `s:${groupKey}:`;
}
