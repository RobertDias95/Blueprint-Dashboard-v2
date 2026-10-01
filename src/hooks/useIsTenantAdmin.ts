import { useAuthStore } from '../stores/authStore';

// Q7.3.a: gate Admin Settings editors on tenant-admin role. Resolves the
// active membership's role; returns true only when `admin`.
//
// ★★★ fix-608 §C: THE SECOND GATE IS GONE. This note used to say that the
//     jurisdictions + permit_types tables had a DIFFERENT RLS gate (the legacy
//     global `profiles` admin flag) and that *"in single-tenant production these
//     two roles coincide, so this hook is sufficient"*.
//
//     They did NOT coincide. Measured on prod 2026-09-30: 8 admins by membership,
//     7 by the legacy column — one person saw every admin editor and was refused
//     by the server, which is precisely the "non-coinciding edge case" this note
//     said would "surface as a server-side RLS toast error". It did, for months.
//
// ★★ Both of those policies now ask `tenant_memberships` (via
//    `bp_is_admin_anywhere()`, because the two catalogues are global and have no
//    tenant_id), so this hook and the server read ONE source and cannot disagree.

export function useIsTenantAdmin(): boolean {
  const memberships = useAuthStore((s) => s.memberships);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);
  if (!activeTenantId) return false;
  return (
    memberships.find((m) => m.tenant_id === activeTenantId)?.role === 'admin'
  );
}
