import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useSelfScope } from '../../hooks/useSelfScope';
import DbToolsCard from '../SettingsModal/DbToolsCard';
import AvatarControl from './AvatarControl';
import SettingsBlock from './SettingsBlock';

// Q7.3.d: Account tab. Read-only sign-in info + sign-out.
// Q9.5.a: DB Tools restored (was dropped per Q3 — wrong call given the
// preserve-v1-layout rule). Bobby uses these regularly for manual
// snapshots before risky operations.

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

  // ★★ fix-505 §B: the circle is drawn from the ROSTER NAME, not from the email
  //    or the login id — that is the key `bp_avatar_paths()` returns and the
  //    string every other avatar in the app is resolved by. `identity.name` is
  //    that name, already resolved by useSelfScope from the signed-in address.
  const { identity } = useSelfScope();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="space-y-3" data-testid="admin-account-tab">
      {/* ★★★ fix-505 §B (P-162) — YOUR PICTURE. Bobby: *"in settings, if we can
          have the option to upload our headshot or profile picture."* This tab
          because it is the one that already shows YOUR sign-in — the Team tab
          is where you edit other people. */}
      <SettingsBlock id="your-picture">
        <AvatarControl
          profileId={user?.id ?? null}
          name={identity.name}
          canEdit
          testId="account-avatar"
        />
      </SettingsBlock>

      <SettingsBlock id="sign-in-info">
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
      </SettingsBlock>

      {/* ★★ fix-611 §B: Export backup moved to Health & tools, and KEEPS its
          admin-only condition exactly as it was. The registry puts the block in
          the `health` category, so `SettingsBlock` renders it only on that page —
          but the condition below is what decides whether it exists at all, and
          that is unchanged. */}
      {activeRole === 'admin' && (
        <SettingsBlock id="export-backup">
          <DbToolsCard />
        </SettingsBlock>
      )}
    </div>
  );
}
