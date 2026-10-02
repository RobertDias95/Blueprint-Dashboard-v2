import { create } from 'zustand';

// fix-620 (P-315): the "choose other weeks" prompt. One sentence at a time —
// set by the grid's own check (lib/finishedBlocks) or by App's mutation
// handler when the server refuses with SQLSTATE P0620. Dismissed by hand.

interface BlockOverlapState {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
}

export const useBlockOverlapStore = create<BlockOverlapState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null }),
}));
