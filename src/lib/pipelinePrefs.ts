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

const KEY_PREFIX = 'pipeline.collapsed';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}`;
}

/** The folded columns this user chose, or null when they never have. */
export function loadPipelineCollapsed(
  userId: string | null | undefined,
): string[] | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    // Corrupt or unreadable → treat as "never chosen" and let the caller open
    // everything, rather than throwing on the way to a render.
    return null;
  }
}

export function savePipelineCollapsed(
  userId: string | null | undefined,
  keys: string[],
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(keys));
  } catch {
    // localStorage full / disabled — persistence is best-effort, exactly as
    // saveRibbonCollapsed treats it. A preference that fails to save is a
    // smaller problem than a render that throws.
  }
}

/** The stored key for a group. Stage codes, so the list survives a title
 *  change — fix-323 renamed "Approve" to "Approved" and nobody's folded
 *  columns should have sprung open because of a word. */
export function pipelineGroupKey(groupKey: string): string {
  return `g:${groupKey}`;
}

/** The stored key for one sub-column inside a group. */
export function pipelineSubKey(groupKey: string, subTitle: string): string {
  return `s:${groupKey}:${subTitle}`;
}
