import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

// Q1: route-level auth guard. Wraps any authenticated route and redirects to
// /login if the session is missing. Renders nothing until `initialized` is
// true — prevents the flash of "redirect to /login" on reload while we wait
// for Supabase's getSession() to restore.
export default function AuthGuard({ children }: { children: ReactNode }) {
  const { session, initialized } = useAuthStore();
  const location = useLocation();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
