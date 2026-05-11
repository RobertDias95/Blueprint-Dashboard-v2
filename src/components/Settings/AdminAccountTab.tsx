import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';

// Q7.3.d: Account tab. Read-only sign-in info + sign-out. v1's "DB
// tools" (push/pull/migrate) section dropped per Q3 design decision —
// legacy migration scaffolding that doesn't survive cutover.

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_TONE: Record<string, string> = {
  admin: 'text-de',
  editor: 'text-pm',
  viewer: 'text-muted',
};

export default function AdminAccountTab() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);

  const activeRole =
    memberships.find((m) => m.tenant_id === activeTenantId)?.role ?? 'viewer';

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="space-y-3" data-testid="admin-account-tab">
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-3">
          Account
        </h2>
        <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-xs">
          <dt className="text-dim uppercase tracking-wide text-[10px] self-center">
            Email
          </dt>
          <dd className="font-mono text-text" data-testid="account-email">
            {user?.email ?? 'Not signed in'}
          </dd>
          <dt className="text-dim uppercase tracking-wide text-[10px] self-center">
            Role
          </dt>
          <dd
            className={`font-display font-bold ${ROLE_TONE[activeRole] ?? 'text-text'}`}
            data-testid="account-role"
          >
            {ROLE_LABEL[activeRole] ?? activeRole}
          </dd>
          <dt className="text-dim uppercase tracking-wide text-[10px] self-center">
            Tenants
          </dt>
          <dd className="text-muted" data-testid="account-tenants">
            {memberships.length} membership
            {memberships.length === 1 ? '' : 's'}
          </dd>
        </dl>

        <button
          onClick={handleSignOut}
          className="mt-4 px-3 py-1.5 text-xs font-display font-semibold bg-co text-white rounded border border-co hover:bg-co/90"
          data-testid="account-signout"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
