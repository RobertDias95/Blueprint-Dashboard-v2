import { create } from 'zustand';
import type { SaveFailure } from '../lib/saveFailure';

// ===========================================================================
// ★★★ fix-372 §6 — it does NOT fade
// ===========================================================================
//
// ★★ WHY THIS IS NOT A TOAST, and the choice matters more than the code.
//
// `toastStore` auto-dismisses after six seconds — fix-86 made it so on purpose,
// because Bobby had error toasts that stuck around until he refreshed. That is
// right for "copied to clipboard" and wrong for this: a person who looked away
// while their save died on the wire would come back to a screen showing their
// edit, with nothing anywhere saying it might not be on the server. Six seconds
// later the only record is in Error Reports, which they do not read.
//
// ★★★ So it persists until DISMISSED BY HAND. The brief's words: "not a toast
// that fades — the person needs to know their edit did not land."
//
// ★ One at a time, newest wins. Two failed saves in a row are one problem, and
// a stack of banners is a second thing to clear rather than a clearer signal.

interface SaveFailureState {
  failure: SaveFailure | null;
  report: (failure: SaveFailure) => void;
  dismiss: () => void;
}

export const useSaveFailureStore = create<SaveFailureState>((set) => ({
  failure: null,
  report: (failure) => set({ failure }),
  dismiss: () => set({ failure: null }),
}));
