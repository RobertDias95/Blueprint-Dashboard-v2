import { create } from 'zustand';

// ★ fix-609 (P-306): the permits a Project Details save just ADDED to an
//   existing project. The modal closes on save, so the offer of their template
//   tasks has to be made somewhere that is still on screen — the permit's row
//   on the project page. This holds which rows those are, for this session.
//
// ★ In memory only, on purpose: the offer is a nudge at the moment of adding.
//   A permit that still has no tasks later is offered them again from its own
//   Tasks panel, so nothing is lost when this empties on reload.

interface AddedPermitsState {
  ids: ReadonlySet<number>;
  markAdded: (ids: readonly number[]) => void;
  dismiss: (id: number) => void;
}

export const useAddedPermitsStore = create<AddedPermitsState>((set) => ({
  ids: new Set<number>(),
  markAdded: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const next = new Set(s.ids);
      for (const id of ids) next.add(id);
      return { ids: next };
    }),
  dismiss: (id) =>
    set((s) => {
      if (!s.ids.has(id)) return s;
      const next = new Set(s.ids);
      next.delete(id);
      return { ids: next };
    }),
}));
