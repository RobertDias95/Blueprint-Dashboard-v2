-- ===========================================================================
-- fix-608 — THE SERVER CHECKS WHO MAY WRITE A SETTING · ONE ADMIN SOURCE
-- P-304 (census gaps 26-28) · P-305 · the builder half of census gap 31
-- ===========================================================================
--
-- ⚠️⚠️ STAGED, NOT APPLIED. Claude applies this from Cowork. CI is green with it
--       unapplied, because nothing in the app depends on it having run: every
--       change here either TIGHTENS a gate the screen already enforces, or
--       widens one to a set that is currently empty (see the Gena note below).
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The screen hides these editors from non-admins (`useIsTenantAdmin`). The
-- server did not: every RPC below checked only that you belong to the tenant, so
-- any signed-in member could write a target-submit formula or rename a builder
-- by calling the RPC directly. The screen is a courtesy; this is the rule.
--
-- ---------------------------------------------------------------------------
-- ★★★ EVERY BODY BELOW WAS READ FROM PROD (pg_get_functiondef) ON 2026-09-30
-- ---------------------------------------------------------------------------
-- Several of these functions are on prod but NOT in migrations/ — prod is ahead
-- of the repo (see the standing note in migrations/). So each definition here is
-- the LIVE text with one check added, never a rebuild from an older file. The
-- ACLs restated at the bottom are the live ones:
--     {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- ★★ Measured on prod 2026-09-30, and it is the reason §C is safe:
--        tenant_memberships admins ........ 8
--        profiles admins .................. 7
--        admin on screen, editor to server  1   ← Gena
--        admin to server, not on screen ... 0   ← nobody loses anything
--    Switching the §C gates to tenant_memberships therefore ADDS exactly one
--    person and removes none. No role is changed by this migration.

BEGIN;

-- ===========================================================================
-- §C.1 — ONE ADMIN SOURCE for the two GLOBAL catalogues
-- ===========================================================================
--
-- `permit_types` and `jurisdictions` have no `tenant_id`, so `is_tenant_admin(t)`
-- cannot be asked about them. This is the smallest honest helper.
--
-- ★★★ A GLOBAL CATALOGUE EDITED BY A TENANT ADMIN IS ACCEPTED WHILE THERE IS ONE
--     TENANT. That is a real limitation and it is written down rather than
--     discovered later: when a second tenant exists, one tenant's admin will be
--     able to rename a permit type the other tenant uses. The fix then is to give
--     these tables a tenant_id, not to widen this function.
CREATE OR REPLACE FUNCTION public.bp_is_admin_anywhere()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$function$;

COMMENT ON FUNCTION public.bp_is_admin_anywhere() IS
  'fix-608 §C: admin of ANY tenant. For the global catalogues (permit_types, '
  'jurisdictions) which have no tenant_id. Reads tenant_memberships — the one '
  'admin source — never the legacy profiles.role.';

-- ---------------------------------------------------------------------------
-- The two policies that read profiles.role
-- ---------------------------------------------------------------------------
-- Live text was:
--   EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
-- on both USING and WITH CHECK, FOR ALL.
--
-- ★ The paired `auth read …` SELECT policies are NOT touched: reading the
--   catalogues stays open to any authenticated session, which is what every
--   dropdown in the app depends on.
DROP POLICY IF EXISTS "admin write jurisdictions" ON public.jurisdictions;
CREATE POLICY "admin write jurisdictions" ON public.jurisdictions
  FOR ALL
  USING (public.bp_is_admin_anywhere())
  WITH CHECK (public.bp_is_admin_anywhere());

DROP POLICY IF EXISTS "admin write permit_types" ON public.permit_types;
CREATE POLICY "admin write permit_types" ON public.permit_types
  FOR ALL
  USING (public.bp_is_admin_anywhere())
  WITH CHECK (public.bp_is_admin_anywhere());

-- ★★★ THESE POLICIES ARE THE WHOLE GATE, WHICH IS WHY NO RPC CHANGES HERE.
--     Read from prod: bp_upsert_jurisdiction, bp_delete_jurisdiction,
--     bp_upsert_permit_type, bp_delete_permit_type and bp_rename_permit_type are
--     all SECURITY **INVOKER** (prosecdef = false), so RLS applies to the caller
--     and the policy above decides. None of them contains a profiles.role check
--     of its own — the brief asked whether they did; they do not.
--
--     `bp_upsert_permit_type_default` IS SECURITY DEFINER, but it writes
--     `permit_type_defaults`, which is tenant-scoped and is not one of the two
--     tables this section is about. Left exactly as it is.

-- ===========================================================================
-- §B.1 — TARGET-SUBMIT FORMULAS: admin only
-- ===========================================================================
--
-- Live RLS was ONE policy, `FOR ALL USING (tenant_id = ANY (auth_tenant_ids()))`
-- with no WITH CHECK — so any tenant member could insert, update or delete.
-- Split: members read, admins write.
DROP POLICY IF EXISTS target_submit_formulas_tenant_policy ON public.target_submit_formulas;

CREATE POLICY target_submit_formulas_tenant_select ON public.target_submit_formulas
  FOR SELECT
  USING (tenant_id = ANY (public.auth_tenant_ids()));

CREATE POLICY target_submit_formulas_admin_insert ON public.target_submit_formulas
  FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY target_submit_formulas_admin_update ON public.target_submit_formulas
  FOR UPDATE
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY target_submit_formulas_admin_delete ON public.target_submit_formulas
  FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

-- ★ The RPCs are SECURITY DEFINER, so they bypass the policies above — which is
--   exactly why the check has to be IN the function too. The policies cover a
--   direct PostgREST write; the RAISE covers the RPC. Neither alone is enough.

-- --- bp_upsert_target_submit_formula: live body + one check -----------------
CREATE OR REPLACE FUNCTION public.bp_upsert_target_submit_formula(
  p_type text,
  p_jurisdiction text,
  p_offset_days integer,
  p_expected_updated_at timestamp with time zone
)
RETURNS TABLE(out_updated_at timestamp with time zone, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_user   uuid;
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_actual timestamptz;
BEGIN
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'p_type is required';
  END IF;
  IF p_offset_days IS NULL OR p_offset_days < -365 OR p_offset_days > 730 THEN
    RAISE EXCEPTION 'p_offset_days must be in [-365, 730], got %', p_offset_days;
  END IF;

  v_user   := auth.uid();
  v_tenant := (auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant in auth context';
  END IF;

  -- ★★★ fix-608 §B.1 — THE ADDED CHECK. After the tenant is known (it is the
  --     subject of the question) and before anything is written. A plain
  --     sentence, because the client shows the message verbatim.
  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Only an admin can change target-submit formulas.'
      USING ERRCODE = '42501';
  END IF;

  SELECT updated_at INTO v_actual
  FROM public.target_submit_formulas
  WHERE tenant_id = v_tenant AND type = p_type
    AND jurisdiction IS NOT DISTINCT FROM v_juris;

  IF v_actual IS NULL THEN
    INSERT INTO public.target_submit_formulas
      (tenant_id, type, jurisdiction, offset_days, updated_at, updated_by)
    VALUES (v_tenant, p_type, v_juris, p_offset_days, now(), v_user)
    RETURNING updated_at INTO out_updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_actual IS DISTINCT FROM p_expected_updated_at THEN
    out_updated_at := v_actual; conflict := true;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.target_submit_formulas
    SET offset_days = p_offset_days, updated_at = now(), updated_by = v_user
  WHERE tenant_id = v_tenant AND type = p_type
    AND jurisdiction IS NOT DISTINCT FROM v_juris
  RETURNING updated_at INTO out_updated_at;
  conflict := false;
  RETURN NEXT;
END;
$function$;

-- --- bp_delete_target_submit_formula: live body + one check -----------------
CREATE OR REPLACE FUNCTION public.bp_delete_target_submit_formula(
  p_type text,
  p_jurisdiction text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_count  integer;
BEGIN
  IF v_juris IS NULL THEN
    RETURN 0;
  END IF;
  v_tenant := (auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant in auth context';
  END IF;

  -- ★★★ fix-608 §B.1 — THE ADDED CHECK.
  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Only an admin can change target-submit formulas.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.target_submit_formulas
  WHERE tenant_id = v_tenant AND type = p_type AND jurisdiction = v_juris;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ===========================================================================
-- §B.2 — BUILDERS, the admin side
-- ===========================================================================
--
-- Live RLS was four policies, all `tenant_id = ANY (auth_tenant_ids())`:
--   builders_tenant_select / _insert / _update / _delete.
-- SELECT stays as it was; the three write policies become admin-only.
--
-- ⚠️ THE INSERT POLICY IS WHERE §B.3 LIVES OR DIES. `bp_add_builder_from_project`
--    is SECURITY DEFINER, so it is NOT subject to this policy — which is the
--    whole mechanism by which a DA can add a builder while a direct PostgREST
--    insert from the same DA is refused. The policy is the floor; the function is
--    the one sanctioned door through it.
DROP POLICY IF EXISTS builders_tenant_insert ON public.builders;
DROP POLICY IF EXISTS builders_tenant_update ON public.builders;
DROP POLICY IF EXISTS builders_tenant_delete ON public.builders;

CREATE POLICY builders_admin_insert ON public.builders
  FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY builders_admin_update ON public.builders
  FOR UPDATE
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY builders_admin_delete ON public.builders
  FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

-- builders_tenant_select is deliberately NOT dropped: every project card and the
-- BuilderPicker's search read this table, and reading was never the problem.

-- --- bp_upsert_builder: live body + one check (covers BOTH branches) --------
--
-- ★★ The check sits above the `p_id IS NULL` fork, so it guards the insert branch
--    and the update branch with one statement — §B.2 asks for both, and two
--    copies of a rule is how one of them gets missed.
CREATE OR REPLACE FUNCTION public.bp_upsert_builder(
  p_id uuid DEFAULT NULL::uuid,
  p_name text DEFAULT NULL::text,
  p_company text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_active boolean DEFAULT NULL::boolean,
  p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS builders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_row     public.builders;
  v_current timestamptz;
begin
  if array_length(v_tenants, 1) is null then
    raise exception 'no tenant in session';
  end if;
  v_tenant := v_tenants[1];

  -- ★★★ fix-608 §B.2 — THE ADDED CHECK, above the insert/update fork.
  if not public.is_tenant_admin(v_tenant) then
    raise exception 'Only an admin can change builders. Ask an admin, or add a new builder from the project.'
      using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'builder name is required';
  end if;
  if p_id is null then
    insert into public.builders (tenant_id, name, company, email, phone, address, notes, active)
    values (
      v_tenant,
      btrim(p_name),
      nullif(btrim(coalesce(p_company, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_active, true)
    )
    returning * into v_row;
    return v_row;
  end if;
  select updated_at into v_current
  from public.builders
  where id = p_id and tenant_id = any (v_tenants)
  for update;
  if not found then
    raise exception 'builder not found';
  end if;
  if p_expected_updated_at is not null and v_current is distinct from p_expected_updated_at then
    raise exception 'builder changed since you loaded it';
  end if;
  update public.builders set
    name    = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    company = case when p_company is null then company else nullif(btrim(p_company), '') end,
    email   = case when p_email   is null then email   else nullif(btrim(p_email), '')   end,
    phone   = case when p_phone   is null then phone   else nullif(btrim(p_phone), '')   end,
    address = case when p_address is null then address else nullif(btrim(p_address), '') end,
    notes   = case when p_notes   is null then notes   else nullif(btrim(p_notes), '')   end,
    active  = coalesce(p_active, active)
  where id = p_id and tenant_id = any (v_tenants)
  returning * into v_row;
  return v_row;
end;
$function$;

-- --- bp_deactivate_builder: live body + one check ---------------------------
CREATE OR REPLACE FUNCTION public.bp_deactivate_builder(
  p_id uuid,
  p_active boolean DEFAULT false
)
RETURNS builders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_row     public.builders;
begin
  -- ★★★ fix-608 §B.2 — THE ADDED CHECK. Asked of the tenant the ROW belongs to,
  --     not of v_tenants[1]: this function takes an id, so the row decides which
  --     tenant the question is about.
  if not exists (
    select 1 from public.builders b
     where b.id = p_id
       and b.tenant_id = any (v_tenants)
       and public.is_tenant_admin(b.tenant_id)
  ) then
    if exists (select 1 from public.builders b
                where b.id = p_id and b.tenant_id = any (v_tenants)) then
      raise exception 'Only an admin can deactivate a builder.' using errcode = '42501';
    end if;
    raise exception 'builder not found';
  end if;

  update public.builders
     set active = coalesce(p_active, false)
   where id = p_id and tenant_id = any (v_tenants)
  returning * into v_row;
  if not found then
    raise exception 'builder not found';
  end if;
  return v_row;
end;
$function$;

-- --- bp_merge_builders: live body + one check -------------------------------
CREATE OR REPLACE FUNCTION public.bp_merge_builders(
  p_loser_id uuid,
  p_winner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_winner  public.builders;
  v_moved   integer;
begin
  if p_loser_id = p_winner_id then
    raise exception 'cannot merge a builder into itself';
  end if;
  select * into v_winner
  from public.builders
  where id = p_winner_id and tenant_id = any (v_tenants);
  if not found then
    raise exception 'winning builder not found';
  end if;

  -- ★★★ fix-608 §B.2 — THE ADDED CHECK, against the WINNER's tenant (the row
  --     this merge writes into). Placed after the lookup so "not found" still
  --     reads as "not found" rather than as a permission error.
  if not public.is_tenant_admin(v_winner.tenant_id) then
    raise exception 'Only an admin can merge builders.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.builders
    where id = p_loser_id and tenant_id = any (v_tenants)
  ) then
    raise exception 'losing builder not found';
  end if;
  update public.projects set
    builder_id      = p_winner_id,
    builder_name    = v_winner.name,
    builder_company = v_winner.company,
    builder_email   = v_winner.email,
    builder_phone   = v_winner.phone,
    builder_address = v_winner.address
  where builder_id = p_loser_id
    and tenant_id = any (v_tenants);
  get diagnostics v_moved = row_count;
  update public.builders
     set active = false
   where id = p_loser_id and tenant_id = any (v_tenants);
  return jsonb_build_object(
    'moved', v_moved,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id
  );
end;
$function$;

-- --- bp_rename_builder_person: live body + one check ------------------------
CREATE OR REPLACE FUNCTION public.bp_rename_builder_person(
  p_old_name text,
  p_new_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenants  uuid[] := public.auth_tenant_ids();
  v_old      text   := btrim(coalesce(p_old_name, ''));
  v_new      text   := btrim(coalesce(p_new_name, ''));
  v_ids      uuid[];
  v_rows     integer := 0;
  v_projects integer := 0;
begin
  if array_length(v_tenants, 1) is null then
    raise exception 'no tenant in session';
  end if;

  -- ★★★ fix-608 §B.2 — THE ADDED CHECK. This one renames across every tenant in
  --     the session, so it asks about the tenant it will write as — v_tenants[1],
  --     the same one the rest of the body uses.
  if not public.is_tenant_admin(v_tenants[1]) then
    raise exception 'Only an admin can rename a builder.' using errcode = '42501';
  end if;

  if v_new = '' then
    raise exception 'builder name is required';
  end if;
  if v_old = '' then
    raise exception 'no builder to rename';
  end if;

  select array_agg(id) into v_ids
    from public.builders
   where tenant_id = any (v_tenants)
     and lower(btrim(name)) = lower(v_old);

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'no builder rows found for %', p_old_name;
  end if;

  update public.builders
     set name = v_new
   where id = any (v_ids)
     and tenant_id = any (v_tenants);
  get diagnostics v_rows = row_count;

  update public.projects
     set builder_name = v_new
   where builder_id = any (v_ids)
     and tenant_id = any (v_tenants);
  get diagnostics v_projects = row_count;

  return jsonb_build_object(
    'rows', v_rows,
    'projects', v_projects,
    'name', v_new
  );
end;
$function$;

-- ===========================================================================
-- §B.3 — BUILDERS, the project side: a NEW insert-only function
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-09-30: *"admins + people of the project. since da's, dm, ent
--    they can all edit the project details info."*
--
-- ★★★ SO THE RULE IS ALREADY WRITTEN, AND IT IS NOT RE-WRITTEN HERE.
--     `bp_may_write_project(p_project_id)` is the existing answer to "may this
--     person edit this project's details" — admin · the `project_details` write
--     cap (DM / director / ENT / ENT lead / schematic) · `may_edit_all_projects`
--     · a DA on their own project or on a project with no DA. Reusing it means a
--     change to who may edit a project changes who may add a builder from one,
--     automatically and for ever. A second membership rule would drift.
--
-- ★★★ A SEPARATE FUNCTION, NOT A NEW PARAMETER ON bp_upsert_builder. Adding an
--     argument creates an OVERLOAD — the old signature stays resolvable, so the
--     admin-only path would still be callable with the old shape and PostgREST
--     would have two candidates (fix-438 hit exactly this). A new name cannot be
--     ambiguous.
--
-- ★★ INSERT ONLY, AND THAT IS THE SECURITY BOUNDARY. There is no p_id, so this
--    function cannot be made to update, deactivate or rename anything. A DA who
--    can reach it can add a builder and nothing else; editing stays admin-only in
--    Settings → Builders & Owners.
--
-- ★ The tenant comes from the PROJECT's row, never from the session's first
--   tenant — the project is the subject of the permission question, so it must
--   also be the source of the tenant the row is filed under.
CREATE OR REPLACE FUNCTION public.bp_add_builder_from_project(
  p_project_id uuid,
  p_name text,
  p_company text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS builders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid;
  v_row    public.builders;
begin
  if p_project_id is null then
    raise exception 'p_project_id is required';
  end if;

  select pr.tenant_id into v_tenant
    from public.projects pr
   where pr.id = p_project_id;
  if v_tenant is null then
    raise exception 'project not found';
  end if;

  -- ★★★ THE GATE. One call, the existing rule.
  if not public.bp_may_write_project(p_project_id) then
    raise exception 'You cannot add a builder from a project you cannot edit.'
      using errcode = '42501';
  end if;

  -- ★ Same required-name rule and the same trimming as bp_upsert_builder's
  --   insert branch, read from the live definition on 2026-09-30. `active`
  --   defaults to true there and does so here; there is no p_active, because a
  --   builder added from a project is by definition one somebody is about to use.
  if p_name is null or btrim(p_name) = '' then
    raise exception 'builder name is required';
  end if;

  insert into public.builders (tenant_id, name, company, email, phone, address, notes, active)
  values (
    v_tenant,
    btrim(p_name),
    nullif(btrim(coalesce(p_company, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    true
  )
  returning * into v_row;
  return v_row;
end;
$function$;

COMMENT ON FUNCTION public.bp_add_builder_from_project(uuid, text, text, text, text, text, text) IS
  'fix-608 §B.3: add a builder from a project. INSERT ONLY. Gated on '
  'bp_may_write_project() — Bobby 2026-09-30: "admins + people of the project". '
  'Editing/deactivating/merging/renaming stay admin-only via bp_upsert_builder.';

-- ===========================================================================
-- §B.4 — GRANTS
-- ===========================================================================
--
-- ★★★ `FROM public, anon` AND NEVER `FROM anon` ALONE. anon INHERITS the PUBLIC
--     grant, so revoking from anon by itself leaves the function callable by an
--     unauthenticated session through PUBLIC — fix-157's finding, and the reason
--     this is spelled out on every migration rather than assumed.
--
-- ★ Restating the ACL for the REPLACED functions as well as the new one:
--   CREATE OR REPLACE preserves the existing ACL, so these lines are a no-op for
--   them today. They are here so the file describes the end state completely and
--   a future rebuild of any one function cannot silently drop a grant.
REVOKE ALL ON FUNCTION public.bp_is_admin_anywhere() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_is_admin_anywhere() TO authenticated;

REVOKE ALL ON FUNCTION public.bp_upsert_target_submit_formula(text, text, integer, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_target_submit_formula(text, text, integer, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_delete_target_submit_formula(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_delete_target_submit_formula(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_upsert_builder(uuid, text, text, text, text, text, text, boolean, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_builder(uuid, text, text, text, text, text, text, boolean, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_deactivate_builder(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_deactivate_builder(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_merge_builders(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_merge_builders(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_rename_builder_person(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_rename_builder_person(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_add_builder_from_project(uuid, text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_add_builder_from_project(uuid, text, text, text, text, text, text) TO authenticated;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. ★★★ It does not touch the legacy `is_admin()` (which reads
--    `profiles.role = 'admin'`). Measured on prod: it is read by 3 functions and
--    4 policies — including `profiles_read_own` and `profiles_admin_write`, plus
--    two `legacy_*` tables and `bp_can_edit_draw_schedule`. Changing it is a
--    cross-cutting auth change, and getting `profiles_read_own` wrong would stop
--    people reading their own profile. It is also NOT a hole today: 0 people are
--    `profiles` admins without also being `tenant_memberships` admins, so it is
--    currently a strict subset. Named here and in the PR as the remaining
--    second source, for its own ticket.
-- 2. It changes NOBODY's role. The 8-vs-7 difference (Gena) is Bobby's call and
--    is a data question, not this migration's.
-- 3. It does not stop anything WRITING `profiles.role` — the Edge Function still
--    maintains it. Only the gates stop reading it.
-- 4. No production data is modified: this file contains no INSERT, UPDATE or
--    DELETE against a data table.
