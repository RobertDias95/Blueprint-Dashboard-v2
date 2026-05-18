import { create } from 'zustand';
import type { ScraperActivityRow } from '../lib/database.types';

// fix-28: shared read-state for the activity feed. localStorage-backed
// Set<number> of audit_log ids the user has marked read. Replaces
// fix-27's `bp_notif_last_seen_at` timestamp model (we keep one-time
// migration from it on init).
//
// Bell badge and ActivityPage both subscribe to this store — clicking
// a row's checkbox on the page decrements the bell badge instantly in
// the same tab. Cross-tab sync is handled by a `storage` event listener
// registered at module load.
//
// Server-side per-user read state is the fix-28.B follow-up; for now
// localStorage is fine — one user / one tenant in prod today.

export const READ_IDS_KEY = 'bp_notif_read_ids';
const LEGACY_LAST_SEEN_KEY = 'bp_notif_last_seen_at';

interface NotificationState {
  readIds: Set<number>;
  markRead: (id: number) => void;
  markUnread: (id: number) => void;
  markManyRead: (ids: number[]) => void;
  /** Used by tests; the production code never clears the set. */
  _reset: () => void;
  /** Internal — used by the cross-tab storage listener. */
  _hydrate: (next: Set<number>) => void;
}

function loadFromStorage(): Set<number> {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const set = new Set<number>();
        for (const v of parsed) {
          if (typeof v === 'number' && Number.isFinite(v)) set.add(v);
        }
        return set;
      }
    }
    // One-time migration from the fix-27 timestamp model. We CAN'T
    // populate the read-ids set without the row list, so leave the
    // legacy timestamp in place. ActivityPage / NotificationBell call
    // migrateLegacyLastSeen(rows) once they have the rows loaded.
  } catch {
    // localStorage may be unavailable (private mode, SSR). Silent fail.
  }
  return new Set<number>();
}

function persist(set: Set<number>) {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage may be unavailable — state-only fallback.
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  readIds: loadFromStorage(),
  markRead: (id) => {
    const next = new Set(get().readIds);
    next.add(id);
    persist(next);
    set({ readIds: next });
  },
  markUnread: (id) => {
    const next = new Set(get().readIds);
    next.delete(id);
    persist(next);
    set({ readIds: next });
  },
  markManyRead: (ids) => {
    const next = new Set(get().readIds);
    for (const id of ids) next.add(id);
    persist(next);
    set({ readIds: next });
  },
  _reset: () => {
    try {
      localStorage.removeItem(READ_IDS_KEY);
    } catch {
      // ignore
    }
    set({ readIds: new Set<number>() });
  },
  _hydrate: (next) => {
    set({ readIds: next });
  },
}));

// Cross-tab sync: storage events only fire on OTHER tabs, so when the
// activity page in tab A marks rows read, the bell badge in tab B
// updates automatically. Same-tab sync is handled by the Zustand
// subscribers (markRead etc. all call set()).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== READ_IDS_KEY) return;
    const next = new Set<number>();
    if (e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            if (typeof v === 'number' && Number.isFinite(v)) next.add(v);
          }
        }
      } catch {
        // ignore malformed payloads
      }
    }
    useNotificationStore.getState()._hydrate(next);
  });
}

/** One-time migration: if the user has a fix-27 `bp_notif_last_seen_at`
 *  timestamp but no `bp_notif_read_ids` set yet, mark every row created
 *  on or before that timestamp as read. Called from components that
 *  have the row list available. Idempotent — only runs once per
 *  session because it deletes the legacy key on success. */
export function migrateLegacyLastSeen(rows: ScraperActivityRow[]): void {
  if (typeof localStorage === 'undefined') return;
  let legacy: string | null;
  let existingIds: string | null;
  try {
    legacy = localStorage.getItem(LEGACY_LAST_SEEN_KEY);
    existingIds = localStorage.getItem(READ_IDS_KEY);
  } catch {
    return;
  }
  if (!legacy || existingIds) return;
  const cutoff = new Date(legacy).getTime();
  if (!Number.isFinite(cutoff)) {
    try {
      localStorage.removeItem(LEGACY_LAST_SEEN_KEY);
    } catch {
      // ignore
    }
    return;
  }
  const ids = rows
    .filter((r) => {
      const t = new Date(r.created_at).getTime();
      return Number.isFinite(t) && t <= cutoff;
    })
    .map((r) => r.id);
  if (ids.length > 0) {
    useNotificationStore.getState().markManyRead(ids);
  }
  try {
    localStorage.removeItem(LEGACY_LAST_SEEN_KEY);
  } catch {
    // ignore
  }
}
