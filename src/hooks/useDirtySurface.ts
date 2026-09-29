import { useEffect } from 'react';
import { clearDirty, setDirty } from '../lib/dirtyRegistry';

// ===========================================================================
// ★★★ fix-595 §2.3 — ONE LINE PER EDITOR, AND A CLEANUP THAT CANNOT BE FORGOTTEN
// ===========================================================================
//
// Nine surfaces hold text that survives a blur, and each of them needed to tell
// the auto-reload it is holding something. Nine hand-written
// `useEffect(() => { setDirty(k, d); return () => clearDirty(k); })` blocks would
// be nine chances to drop the cleanup — and a key left registered would disable
// the feature silently for the rest of the session, with nothing on screen to
// say so.
//
// ★★ THE UNMOUNT CLEAR IS THE LOAD-BEARING HALF. A composer with text in it is
//    usually closed rather than emptied: the dialog is dismissed, the modal is
//    shut, the chat panel unmounts. The text is gone at that moment and so is the
//    reason to block — but only if something clears the key.

/**
 * Tell the app this surface is holding unsaved work.
 *
 * @param key stable per surface. Per-INSTANCE where several can be open at once
 *   (`chat:<projectId>`), so one closing does not clear another's flag.
 * @param isDirty whatever the surface already knows — a draft string being
 *   non-empty, an existing `dirty` flag, a form comparison.
 */
export function useDirtySurface(key: string, isDirty: boolean): void {
  useEffect(() => {
    setDirty(key, isDirty);
  }, [key, isDirty]);

  // ★ Unmount clears it, and it is a SEPARATE effect keyed on `key` alone —
  //   otherwise every change of `isDirty` would run the cleanup and re-register,
  //   which works but reads as though unmount were the only path that clears.
  useEffect(() => () => clearDirty(key), [key]);
}
