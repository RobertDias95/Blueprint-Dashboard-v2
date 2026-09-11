-- ===========================================================================
-- fix-527 §A + §B (P-243, P-225) — IDENTITY, AND THE FIRST REAL CAPABILITY
-- ===========================================================================
--
-- ⚠️  NOT APPLIED. Cowork applies migrations. Copied to
--     Brain/briefs/migrations/ for that. No Bridge code calls the two RPCs
--     below until Cowork confirms — see the PR.
--
-- ★★★ THIS IS MUCH SMALLER THAN THE BRIEF EXPECTS, AND THE REASON IS THE
--     TICKET'S MAIN FINDING. §0 says *"accounts with a name: 0 — every single
--     one is NULL"* and *"DA names matching any account: 0"*, both measured
--     against `profiles`. They are true and they are the wrong table: the
--     account-to-person link has lived in `team_members.email` since fix-176,
--     and `resolveRosterIdentity` reads it on every page load. Measured on
--     prod 2026-09-11:
--
--       distinct names across all six work-data columns        26
--       …in the roster                                         26   ← all
--       …resolving to a real account                           22
--       name→project hits behind the unresolved 4              22   (not 119)
--       names mapping to more than one account                  0
--
--     `profiles.name` AND `profiles.full_name` already exist — both unused, on
--     all 37 rows. **So §A needs no display-name column.** What it needs is the
--     one thing a blank email cannot express.
--
-- ★★★ AND `profiles` IS ALREADY ADMIN-READABLE. Policy `profiles_read_own` is
--     `auth.uid() = id OR is_admin()`, so the Settings screen can list accounts
--     with no new RPC. Several comments in `src/` say *"profiles is
--     read-own-only"*; they are stale. (fix-525 banked *"a comment is not
--     evidence"* — this is the same coin, found by reading pg_policy.)
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- §A · "no account" as a real, storable answer
-- ---------------------------------------------------------------------------
--
-- ★★★ THE ONE THING THE DATA CANNOT SAY TODAY. A roster row with a blank email
--     is ambiguous between *"nobody has filled this in yet"* and *"this person
--     has no login."* Four names are in that state — `George · Alex · Chad ·
--     Nidhi`, holding 22 of 870 name→project hits — and a mapping screen that
--     cannot record "nobody" invites a guess. §A: *"probably is not good enough
--     to grant access to 33 projects."*
--
-- ★ DEFAULT FALSE, NOT NULL. Absent means "not decided", which the client
--   already treats as `unmapped` → no access. Fail closed by construction
--   rather than by a branch somebody has to remember.
alter table public.team_members
  add column if not exists has_no_account boolean not null default false;

comment on column public.team_members.has_no_account is
  'fix-527 §A: this person deliberately has NO login. Distinct from a blank '
  'email, which means nobody has decided yet. Never grants anything.';

-- ---------------------------------------------------------------------------
-- §B · the capability, on the ACCOUNT
-- ---------------------------------------------------------------------------
--
-- ★★ ON `profiles`, NOT ON `team_members`, and the reason is Jade: one person
--    holds THREE roster rows on prod (one per role). A capability on the roster
--    row would be three flags for one human, and revoking it would mean
--    remembering all three. One account, one answer.
alter table public.profiles
  add column if not exists may_edit_library boolean not null default false;

comment on column public.profiles.may_edit_library is
  'fix-527 §B (P-225): may edit the Library fields (zone, alley, lot dims, '
  'unit types) through bp_update_library_fields. Default FALSE — fail closed.';

-- ---------------------------------------------------------------------------
-- §B · the gate, IN THE RPC
-- ---------------------------------------------------------------------------
--
-- ⚠️⚠️ NOT "hide the button". ~20 `useIsTenantAdmin` sites hide a control in
--      the browser and within a tenant every user is equivalent server-side.
--      `bp_reassign_project_sd` (fix-520 §E) is the ONE site that checks in the
--      RPC, and the outlier is the correct one. This copies THAT.
--
-- ★ The columns are exactly the Library's, listed rather than accepting a free
--   patch: an RPC that applies whatever jsonb it is handed is an UPDATE with
--   extra steps, and the capability would gate nothing.
create or replace function public.bp_update_library_fields(
  p_project_id uuid,
  p_expected_updated_at timestamptz,
  p_zone text default null,
  p_alley text default null,
  p_lot_width numeric default null,
  p_lot_depth numeric default null,
  p_unit_types jsonb default null
) returns table(out_updated_at timestamptz, out_conflict boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  -- ★ DECLARED WITHOUT AN INITIALISER, deliberately: a `:=` here would run
  --   `auth_tenant_ids()` BEFORE the gate below, and "the gate is first" would
  --   be true of the prose and not of the code. A test asserts the order.
  v_tenants uuid[];
  v_current timestamptz;
begin
  -- ★★★ THE GATE, FIRST AND UNCONDITIONAL. Not after the tenant lookup, not
  --     after the OCC read — a refusal must not depend on anything the caller
  --     controls, and it must not cost a query to reach.
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.may_edit_library is true
  ) then
    raise exception 'bp_update_library_fields: caller may not edit Library fields'
      using errcode = '42501';
  end if;

  v_tenants := public.auth_tenant_ids();
  select pr.updated_at into v_current
    from public.projects pr
   where pr.id = p_project_id and pr.tenant_id = any (v_tenants);
  if v_current is null then
    raise exception 'bp_update_library_fields: project % not in caller tenant', p_project_id
      using errcode = '42501';
  end if;

  -- ★ OCC, the same shape every project write in this app uses. fix-382's
  --   rule: check the expectation BEFORE anything writes.
  if p_expected_updated_at is not null
     and v_current is distinct from p_expected_updated_at then
    return query select v_current, true;
    return;
  end if;

  update public.projects pr set
    zone       = coalesce(p_zone,       pr.zone),
    alley      = coalesce(p_alley,      pr.alley),
    lot_width  = coalesce(p_lot_width,  pr.lot_width),
    lot_depth  = coalesce(p_lot_depth,  pr.lot_depth),
    unit_types = coalesce(p_unit_types, pr.unit_types)
   where pr.id = p_project_id
  returning pr.updated_at into v_current;

  return query select v_current, false;
end;
$fn$;

-- ★★★ `REVOKE … FROM anon` REPORTS SUCCESS AND DOES NOTHING. Postgres grants
--     EXECUTE on every new function to PUBLIC and `anon` inherits from PUBLIC,
--     so the role-only revoke leaves the inherited grant in place. fix-523 §0
--     cost an apply to that. **From public, anon** — and assert it below.
revoke all on function public.bp_update_library_fields(uuid, timestamptz, text, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.bp_update_library_fields(uuid, timestamptz, text, text, numeric, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- §B · granting and revoking it — admin only, also in the RPC
-- ---------------------------------------------------------------------------
--
-- ★★★ A capability whose GRANT is browser-gated is not a capability. The one
--     control that can hand out the permission has to be enforced the same way
--     the permission is.
create or replace function public.bp_set_library_capability(
  p_user_id uuid,
  p_value boolean
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.is_admin() then
    raise exception 'bp_set_library_capability: admin only'
      using errcode = '42501';
  end if;
  update public.profiles set may_edit_library = coalesce(p_value, false)
   where id = p_user_id;
  return found;
end;
$fn$;

revoke all on function public.bp_set_library_capability(uuid, boolean) from public, anon;
grant execute on function public.bp_set_library_capability(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Assert the result rather than trusting the statements
-- ---------------------------------------------------------------------------
--
-- ★★★ fix-523 §0's lesson, generalised: **a statement that succeeds is not a
--     statement that did something.** Measure with `has_function_privilege`,
--     never by re-reading the SQL above.
do $check$
begin
  if has_function_privilege('anon', 'public.bp_update_library_fields(uuid, timestamptz, text, text, numeric, numeric, jsonb)', 'EXECUTE') then
    raise exception 'fix-527: anon can still execute bp_update_library_fields';
  end if;
  if has_function_privilege('anon', 'public.bp_set_library_capability(uuid, boolean)', 'EXECUTE') then
    raise exception 'fix-527: anon can still execute bp_set_library_capability';
  end if;
  if not has_function_privilege('authenticated', 'public.bp_update_library_fields(uuid, timestamptz, text, text, numeric, numeric, jsonb)', 'EXECUTE') then
    raise exception 'fix-527: authenticated cannot execute bp_update_library_fields';
  end if;
  if (select count(*) from public.profiles where may_edit_library) <> 0 then
    raise exception 'fix-527: the capability must start at nobody';
  end if;
  raise notice 'fix-527: identity + capability installed; nobody holds it yet.';
end
$check$;

commit;

-- ---------------------------------------------------------------------------
-- After applying
-- ---------------------------------------------------------------------------
--
--   -- give Cam the capability (replace with her account id):
--   select public.bp_set_library_capability('<uuid>', true);
--
--   -- and check it took:
--   select email, may_edit_library from public.profiles where may_edit_library;
--
-- ★ NOBODY HOLDS IT ON APPLY. The column defaults to false and the migration
--   asserts the count is zero, so applying this grants nothing to anyone — the
--   first grant is a deliberate, separate, admin-only call.
