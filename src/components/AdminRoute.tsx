import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';

// fix-234: route-level gate for the Reports hub. Only tenant admins may reach the
// analytics/reports pages — a non-admin (editor) navigating directly to a
// /reports path is redirected to the default landing view (/dashboard). Hiding
// the Reports nav tab alone is insufficient, so every report route is wrapped in
// this guard. AuthGuard has already loaded the session + memberships before any
// child route renders, so useIsTenantAdmin is reliable here (no flash-redirect
// for a real admin).
//
// NOTE: this is a UI/route gate — it stops normal viewership. It does NOT lock
// the underlying report RPCs at the database (a determined editor could still
// call them); true server-side lockdown is a separate RLS/role pass.
export default function AdminRoute({ children }: { children: ReactNode }) {
  const isAdmin = useIsTenantAdmin();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
