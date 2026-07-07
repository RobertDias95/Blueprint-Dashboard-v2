import { describe, it, expect } from 'vitest';

// fix-220: lock draw-schedule editing to admins (server-enforced).
// Logic is SQL (migrations/fix_220_draw_schedule_admin_lock.sql). No live DB in
// CI (the fix-153 precedent), so this is a pure-TS mirror of the two-layer gate
// plus a documented read-only PROD probe of the pieces the migration depends on.
//
// PROD probe (2026-07-07, project eibnmwthkcuumyclyxoe, READ-ONLY — no writes):
//   - profiles.role and tenant_memberships.role AGREE for all 9 users:
//       admins   = briana, brittani, dave, miles, robertd
//       editors  = cameron, keenan, ldeherrera, smahdi
//     single tenant 00000000-0000-0000-0000-000000000001.
//   - pg_roles.rolbypassrls: service_role=true, postgres=true,
//                            authenticated=false, anon=false.
//     => service_role (the scraper's key) bypasses the RLS admin-write policies,
//        so the scraper keeps writing; a logged-in editor does NOT bypass.
//   - Pre-existing precedent: draw_schedule_quarter_layout + dm_da_groups already
//     carry is_tenant_admin(tenant_id) FOR ALL write policies. fix-220 adds the
//     same to draw_schedule + da_time_blocks and an in-RPC guard to the 10
//     SECURITY DEFINER writers (they bypass RLS, so RLS alone can't stop them).
//   - is_admin(), is_tenant_admin(uuid), auth_tenant_ids() all resolve in prod.

// ---------------------------------------------------------------------------
// Layer 1 mirror — the in-RPC guard: public.bp_can_edit_draw_schedule()
//   SELECT auth.role() = 'service_role'
//       OR public.is_admin()                                   -- profiles.role
//       OR EXISTS (tenant_memberships WHERE user_id=auth.uid() AND role='admin')
// bp_assert_draw_schedule_admin() RAISES 42501 when this is false.
// ---------------------------------------------------------------------------
type AuthRole = 'service_role' | 'authenticated' | 'anon';
interface Caller {
  authRole: AuthRole;
  isProfileAdmin: boolean; // profiles.role = 'admin' for auth.uid()
  isTenantAdmin: boolean; // tenant_memberships.role = 'admin' for auth.uid()
}

function canEditDrawSchedule(c: Caller): boolean {
  return c.authRole === 'service_role' || c.isProfileAdmin || c.isTenantAdmin;
}

// ---------------------------------------------------------------------------
// Layer 2 mirror — RLS write policy on draw_schedule / da_time_blocks:
//   FOR ALL USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(...))
// A role with BYPASSRLS (service_role, postgres) is never subject to it.
// ---------------------------------------------------------------------------
function rlsWriteAllowed(c: {
  bypassRls: boolean;
  isTenantAdmin: boolean;
}): boolean {
  return c.bypassRls || c.isTenantAdmin;
}

// SELECT policy is unchanged: any tenant member may read.
function rlsSelectAllowed(c: {
  bypassRls: boolean;
  isTenantMember: boolean;
}): boolean {
  return c.bypassRls || c.isTenantMember;
}

const ADMIN: Caller = {
  authRole: 'authenticated',
  isProfileAdmin: true,
  isTenantAdmin: true,
};
const EDITOR: Caller = {
  authRole: 'authenticated',
  isProfileAdmin: false,
  isTenantAdmin: false,
};
const SCRAPER: Caller = {
  authRole: 'service_role',
  isProfileAdmin: false,
  isTenantAdmin: false,
};

describe('fix-220 in-RPC guard (bp_can_edit_draw_schedule mirror)', () => {
  it('admin may edit', () => {
    expect(canEditDrawSchedule(ADMIN)).toBe(true);
  });

  it('editor is blocked (would RAISE 42501)', () => {
    expect(canEditDrawSchedule(EDITOR)).toBe(false);
  });

  it('viewer / any non-admin authenticated caller is blocked', () => {
    expect(
      canEditDrawSchedule({
        authRole: 'authenticated',
        isProfileAdmin: false,
        isTenantAdmin: false,
      }),
    ).toBe(false);
  });

  it('service_role (scraper) is exempt even with no admin role', () => {
    expect(canEditDrawSchedule(SCRAPER)).toBe(true);
  });

  it('profiles-admin OR tenant-admin each independently grant (they agree in prod)', () => {
    expect(
      canEditDrawSchedule({ ...EDITOR, isProfileAdmin: true }),
    ).toBe(true);
    expect(
      canEditDrawSchedule({ ...EDITOR, isTenantAdmin: true }),
    ).toBe(true);
  });
});

describe('fix-220 RLS write policy (is_tenant_admin mirror)', () => {
  it('admin write allowed', () => {
    expect(rlsWriteAllowed({ bypassRls: false, isTenantAdmin: true })).toBe(
      true,
    );
  });

  it('editor write denied at RLS', () => {
    expect(rlsWriteAllowed({ bypassRls: false, isTenantAdmin: false })).toBe(
      false,
    );
  });

  it('service_role write allowed via BYPASSRLS (scraper path)', () => {
    // service_role never satisfies is_tenant_admin, but bypasses RLS entirely.
    expect(rlsWriteAllowed({ bypassRls: true, isTenantAdmin: false })).toBe(
      true,
    );
  });
});

describe('fix-220 reads stay open (SELECT policy unchanged)', () => {
  it('editor (tenant member) can still SELECT the draw schedule', () => {
    expect(rlsSelectAllowed({ bypassRls: false, isTenantMember: true })).toBe(
      true,
    );
  });

  it('non-member is not granted read', () => {
    expect(rlsSelectAllowed({ bypassRls: false, isTenantMember: false })).toBe(
      false,
    );
  });
});

describe('fix-220 end-to-end matrix (both layers together)', () => {
  // A write is only truly blocked if BOTH the layer that applies denies it.
  // INVOKER RPCs + direct writes -> RLS applies. SECURITY DEFINER RPCs bypass
  // RLS -> the in-RPC guard applies. The scraper (service_role) must pass both.
  const cases: {
    who: string;
    caller: Caller;
    bypassRls: boolean;
    canWrite: boolean;
  }[] = [
    { who: 'admin', caller: ADMIN, bypassRls: false, canWrite: true },
    { who: 'editor', caller: EDITOR, bypassRls: false, canWrite: false },
    { who: 'scraper', caller: SCRAPER, bypassRls: true, canWrite: true },
  ];

  for (const c of cases) {
    it(`${c.who}: RPC-guard=${canEditDrawSchedule(c.caller)} & RLS=${rlsWriteAllowed(
      { bypassRls: c.bypassRls, isTenantAdmin: c.caller.isTenantAdmin },
    )} -> canWrite=${c.canWrite}`, () => {
      const guard = canEditDrawSchedule(c.caller);
      const rls = rlsWriteAllowed({
        bypassRls: c.bypassRls,
        isTenantAdmin: c.caller.isTenantAdmin,
      });
      // Both layers agree per caller (that is the design invariant).
      expect(guard).toBe(c.canWrite);
      expect(rls).toBe(c.canWrite);
    });
  }
});
