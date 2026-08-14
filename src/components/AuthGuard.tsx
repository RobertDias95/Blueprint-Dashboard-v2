import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';

// Q1: route-level auth guard. Wraps any authenticated route and redirects to
// /login if the session is missing. Renders nothing until `initialized` is
// true — prevents the flash of "redirect to /login" on reload while we wait
// for Supabase's getSession() to restore.
//
// Q5.5.D: also blocks signed-in users who have no tenant memberships.
// They reach an "access denied" splash with a sign-out button rather than
// the app shell (which would show all-empty queries, since RLS would hide
// every row from a tenantless user anyway).
export default function AuthGuard({ children }: { children: ReactNode }) {
  const { session, initialized, memberships, verifying } = useAuthStore();
  const location = useLocation();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Loading…
      </div>
    );
  }
  // ★ fix-314: the settle window. A null session on anything other than an
  // explicit SIGNED_OUT no longer clears the store at all (see App.tsx), so in
  // the common case this guard never even sees the transient and the user's
  // page does not flicker. This branch covers the remainder: a verify that
  // began while the store already held no session.
  //
  // It cannot hang. confirmSession() races ONE getSession() against a backstop
  // that FAILS CLOSED — on expiry it answers "gone", which lands here as a
  // redirect. The wait can only ever end sooner than the backstop, never later.
  if (!session && verifying) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-muted text-sm"
        data-testid="auth-reconnecting"
      >
        Reconnecting…
      </div>
    );
  }
  if (!session) {
    // The `from` half of this has always been recorded here. fix-314 added the
    // half that reads it — see landingAfterSignIn in Login.tsx.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (memberships.length === 0) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        data-testid="no-tenant-splash"
      >
        <div className="max-w-md bg-surface border border-co-border rounded-xl p-6 text-sm space-y-3">
          <div className="font-display font-bold text-co">Access denied</div>
          <div className="text-muted">
            Your account isn't a member of any organization yet. Contact an
            admin to request access.
          </div>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="text-xs px-3 py-1.5 rounded-md bg-bg border border-border font-display hover:bg-s2 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
