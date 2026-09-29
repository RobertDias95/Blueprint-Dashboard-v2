// ===========================================================================
// ★★★ fix-595 §2.3 — ONE PLACE THAT KNOWS WHETHER ANYTHING IS UNSAVED
// ===========================================================================
//
// The brief: *"Find the app's existing dirty signals first — if there is no
// single registry, add ONE small `dirtyRegistry`."* There is no single one.
// There are ~30 components holding a draft, and they split cleanly in two:
//
//   · **commit-on-blur** (`onBlur={commit}`) — `EditableField`, `LibraryEditCell`,
//     `BufferedDateInput`, `TaskDateField`, the Settings inline editors, the
//     project data editors. Their draft cannot survive the person walking away,
//     because walking away blurs the field and the value is written or refused.
//     **These do not register, and the reason is a property of the code rather
//     than a judgement about it.**
//
//   · **text that survives a blur** — the chat composers, the note box, the
//     dialogs, the atomic Project Details form, the quarter layout, the report
//     builder. These are what fix-371 §4 meant by *"losing a paragraph"*, and
//     these are what register here.
//
// ★★★ AND THE CARET TEST IS THE SAFETY NET UNDER BOTH. `activeElementIsInput`
//     blocks the reload whenever focus is in any field at all — including a
//     search box, and including every editor nobody remembered to register. The
//     registry is for text somebody typed and then looked away from; the caret
//     test is for text they are still in the middle of.
//
// ★ NOT A STORE. No zustand, no React state, no subscription: this is read once,
//   inside an event handler, by one caller. A store would add a re-render to
//   every keystroke in every composer to answer a question nobody asks during
//   render. `NewBuildNotice` reads it at the moment the window comes back.

/**
 * Keys currently holding unsaved work.
 *
 * ★ A Set of KEYS, not a count, so a component that registers twice (a remount
 *   racing its own cleanup) cannot leave the app permanently "dirty" — the exact
 *   failure that would silently disable this feature for the rest of a session.
 */
const dirty = new Set<string>();

/**
 * Mark a surface as holding unsaved work, or clear it.
 *
 * ★★ ONE CALL, BOTH DIRECTIONS, because two functions is how a cleanup path gets
 *    forgotten. Components call it from an effect with their own current dirty
 *    flag, so the register and the unregister are the same line.
 *
 * @param key stable per surface — `'project-details'`, `'chat:<projectId>'`.
 *   Per-instance where several can be open at once.
 */
export function setDirty(key: string, isDirty: boolean): void {
  if (isDirty) dirty.add(key);
  else dirty.delete(key);
}

/** ★ For an effect's cleanup, where the flag is not in scope any more. */
export function clearDirty(key: string): void {
  dirty.delete(key);
}

/** Is anything on screen holding unsaved work? */
export function isAnythingDirty(): boolean {
  return dirty.size > 0;
}

/** Which surfaces — for tests, and for a future "you have unsaved work" prompt. */
export function dirtyKeys(): string[] {
  return Array.from(dirty).sort();
}

/** ★ Tests only. The registry is module state and vitest shares a module graph
 *  across cases in a file. */
export function __resetDirtyRegistry(): void {
  dirty.clear();
}
