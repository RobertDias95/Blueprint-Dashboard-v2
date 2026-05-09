import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';

// Q1: minimal auth store. Holds the current Supabase session + user, plus an
// `initialized` flag set to true after the first `getSession()` call resolves.
// Keep this small — server state (permits, projects, etc.) belongs in
// TanStack Query, not here. This store is for client-only auth metadata.
//
// Q5.5.D: extended with tenant memberships + activeTenantId. Memberships are
// loaded once after sign-in via `loadMemberships`. For now `activeTenantId`
// defaults to the first membership; tenant-switcher UI is Phase 2.

export interface TenantMembership {
  tenant_id: string;
  role: 'admin' | 'editor' | 'viewer';
}

type AuthState = {
  session: Session | null;
  user: User | null;
  /** False until the initial getSession() resolves. Used to avoid flashing
   *  the login screen on reload while we wait for session restoration. */
  initialized: boolean;
  memberships: TenantMembership[];
  activeTenantId: string | null;
  setSession: (session: Session | null) => void;
  setInitialized: (initialized: boolean) => void;
  setMemberships: (memberships: TenantMembership[]) => void;
  setActiveTenant: (tenantId: string | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  initialized: false,
  memberships: [],
  activeTenantId: null,
  setSession: (session) =>
    set({ session, user: session?.user ?? null }),
  setInitialized: (initialized) => set({ initialized }),
  setMemberships: (memberships) =>
    set((state) => ({
      memberships,
      // Default to the first membership when none is currently active or the
      // active one is no longer valid. Phase 2 will replace this with explicit
      // user choice via a tenant-switcher.
      activeTenantId:
        state.activeTenantId &&
        memberships.some((m) => m.tenant_id === state.activeTenantId)
          ? state.activeTenantId
          : (memberships[0]?.tenant_id ?? null),
    })),
  setActiveTenant: (tenantId) => set({ activeTenantId: tenantId }),
}));
