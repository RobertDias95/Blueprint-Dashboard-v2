import { useCallback, useEffect, useRef, useState } from 'react';

// ===========================================================================
// ★★★ fix-572 §D (P-280) — A SAVE YOU CAN SEE
// ===========================================================================
//
// 🚨 Bobby edited Stories on `10004 116th Ave NE`, saw nothing happen, and
//    REVERTED A CORRECT EDIT. The database shows both writes: 11:23:17 and
//    11:23:36 PT — the change and the undo, **19 seconds apart**. The save
//    worked. He could not tell.
//
// ★★★ A WRITE NOBODY CAN SEE IS INDISTINGUISHABLE FROM A WRITE THAT FAILED,
//     and the next thing a person does is re-type it or undo it. **That** is
//     the defect; the missing button is not.
//
// ---------------------------------------------------------------------------
// ★★★ ONLY CONFIRM A WRITE THAT LANDED
// ---------------------------------------------------------------------------
//
// ⚠️ §D is explicit: *"A confirmation fired on blur regardless of the RPC's
//    result is worse than none — it teaches the exact false confidence this
//    ticket exists to remove."* So `markSaved()` is called from the RESOLVED
//    side of the write and from nowhere else; every caller that swallows its
//    own error (the `.catch(() => {})` this codebase uses so a `void` call
//    cannot trip an unhandled rejection) must return success/failure rather
//    than confirming on the way past.
//
// ★★ ONE ACKNOWLEDGEMENT PER COMPLETED SAVE, not a toast per keystroke. It
//    lives ON the field, says one word, and clears itself. A modal that flashes
//    on every blur is its own noise — §D says so and it is why this is a local
//    flag rather than `pushToast`.
//
// ★ AND IT DOES NOT FIRE WHEN NOTHING WAS WRITTEN. Every commit path in this
//   modal early-returns when the value is unchanged (`if (next === original)
//   return;`), so a blur that changed nothing never reaches `markSaved` — which
//   is what keeps tabbing through a form silent.

/** How long the acknowledgement stays. ★ Long enough to be read after the eye
 *  has moved to the next field, short enough that two saves in a row do not
 *  leave a row of ticks behind. */
export const SAVED_FLASH_MS = 1600;

export interface SavedFlash {
  /** True while the acknowledgement should render. */
  saved: boolean;
  /** Call ONLY after the write has resolved successfully. */
  markSaved: () => void;
}

export function useSavedFlash(ms: number = SAVED_FLASH_MS): SavedFlash {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSaved = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), ms);
  }, [ms]);

  // ★ A field can be unmounted by the save it just made — switching tabs, or a
  //   re-render that re-keys the block. Clearing the timer on unmount is what
  //   stops a setState on a dead component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { saved, markSaved };
}
