import { create } from 'zustand';

// Q3: minimal toast store. Success/info auto-dismiss; warn/error stay until
// the user clicks them. Stack newest-on-top. Match v1's bpToast contract
// (msg + kind) so call sites read identically across both codebases.

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;
const AUTO_DISMISS_MS = 4_000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    if (kind === 'info' || kind === 'success') {
      setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helper for non-React code (mutation onError handlers, etc.). */
export function pushToast(message: string, kind: ToastKind = 'info') {
  return useToastStore.getState().push(message, kind);
}
