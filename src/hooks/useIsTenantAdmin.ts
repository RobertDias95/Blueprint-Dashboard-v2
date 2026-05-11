import { useAuthStore } from '../stores/authStore';

// Q7.3.a: gate Admin Settings editors on tenant-admin role. Resolves the
// active membership's role; returns true only when `admin`.
//
// Note: jurisdictions + permit_types tables use a different RLS gate
// (`profiles.role='admin'`, global Blueprint admin) — see Q7.3 design §6.
// In single-tenant production these two roles coincide, so this hook is
// sufficient for the UI gate. A non-coinciding edge case will surface as
// a server-side RLS toast error, which is acceptable until #38 lands.

export function useIsTenantAdmin(): boolean {
  const memberships = useAuthStore((s) => s.memberships);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);
  if (!activeTenantId) return false;
  return (
    memberships.find((m) => m.tenant_id === activeTenantId)?.role === 'admin'
  );
}
