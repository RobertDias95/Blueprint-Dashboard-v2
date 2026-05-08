import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';

// Q1: minimal auth store. Holds the current Supabase session + user, plus an
// `initialized` flag set to true after the first `getSession()` call resolves.
// Keep this small — server state (permits, projects, etc.) belongs in
// TanStack Query, not here. This store is for client-only auth metadata.

type AuthState = {
  session: Session | null;
  user: User | null;
  /** False until the initial getSession() resolves. Used to avoid flashing
   *  the login screen on reload while we wait for session restoration. */
  initialized: boolean;
  setSession: (session: Session | null) => void;
  setInitialized: (initialized: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  initialized: false,
  setSession: (session) =>
    set({ session, user: session?.user ?? null }),
  setInitialized: (initialized) => set({ initialized }),
}));
