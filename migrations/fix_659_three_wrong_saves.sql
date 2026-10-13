-- ===========================================================================
-- fix-659 (P-318) — three saves that stored the wrong thing
--   (Settings audit census 32 and 42; 29 needs no SQL — see the PR)
-- ===========================================================================
--
-- ★★ NO EXISTING ROW CHANGES. Two function bodies are patched by ANCHOR
--    (fix-410/425: never retype a live function) and one helper is added.
--    Every anchor must match exactly once or the migration aborts.
--
-- ---------------------------------------------------------------------------
-- 1. bp_create_project_with_permits — the wizard's builder pick is the link
-- ---------------------------------------------------------------------------
-- fix-425 already linked a wizard project to a catalogue row, but by
-- UPSERTING ON (name, company). Measured 2026-10-12: that has two faults.
--   ★ The pick itself was thrown away — the RPC re-derived the row from
--     the typed text, so a pick and a typed name were the same thing.
--   ★★ `UNIQUE (name, company)` treats NULL companies as DISTINCT, so for a
--     builder with no company the ON CONFLICT never fired and every wizard
--     save INSERTED A NEW DUPLICATE builder (4 null-company builders on prod,
--     one duplicated pair).
-- Now: a `builder_id` in p_project_data (sent by the wizard on a pick) is
-- linked as-is when it is in this tenant; otherwise an existing row with the
-- same name and the SAME company (NULL-safe, active first) is reused; only
-- then is a new catalogue row created, exactly as before.
DO $mig$
DECLARE
  v_def text := pg_get_functiondef(
    'public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb)'::regprocedure);
  v_old text := E'  IF COALESCE(TRIM(v_pd->>''builder_name''), '''') <> '''' THEN\n    INSERT INTO public.builders (name, company, email, phone, address, tenant_id)';
  v_new text := E'  -- fix-659: a PICKED builder is the link; a typed one reuses a same-name,\n'
             || E'  -- same-company row (NULL-safe) before creating one.\n'
             || E'  IF NULLIF(v_pd->>''builder_id'', '''') IS NOT NULL THEN\n'
             || E'    SELECT b.id INTO v_builder_id FROM public.builders b\n'
             || E'     WHERE b.id = (v_pd->>''builder_id'')::uuid AND b.tenant_id = p_tenant_id;\n'
             || E'  END IF;\n'
             || E'  IF v_builder_id IS NULL AND COALESCE(TRIM(v_pd->>''builder_name''), '''') <> '''' THEN\n'
             || E'    SELECT b.id INTO v_builder_id FROM public.builders b\n'
             || E'     WHERE b.tenant_id = p_tenant_id\n'
             || E'       AND b.name = TRIM(v_pd->>''builder_name'')\n'
             || E'       AND b.company IS NOT DISTINCT FROM NULLIF(TRIM(COALESCE(v_pd->>''builder_company'', '''')), '''')\n'
             || E'     ORDER BY (b.active IS NOT FALSE) DESC, b.id\n'
             || E'     LIMIT 1;\n'
             || E'  END IF;\n'
             || E'  IF v_builder_id IS NOT NULL THEN\n'
             || E'    -- Same address rule the upsert below applies on conflict.\n'
             || E'    UPDATE public.builders\n'
             || E'       SET address = COALESCE(NULLIF(TRIM(COALESCE(v_pd->>''builder_address'', '''')), ''''), address)\n'
             || E'     WHERE id = v_builder_id;\n'
             || E'    UPDATE public.projects SET builder_id = v_builder_id\n'
             || E'     WHERE id = v_project_id;\n'
             || E'  ELSIF COALESCE(TRIM(v_pd->>''builder_name''), '''') <> '''' THEN\n'
             || E'    INSERT INTO public.builders (name, company, email, phone, address, tenant_id)';
  v_n int;
BEGIN
  IF position('fix-659' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-659: bp_create_project_with_permits already patched';
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-659: builder anchor matched % times in bp_create_project_with_permits', v_n;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. bp_roster_name_has_login — "is this person's email their sign-in?"
-- ---------------------------------------------------------------------------
-- `profiles` is read-own-only, so the People screen cannot answer this, and
-- `bp_profile_id_for_roster_name` matches on a DISPLAY name (which falls back
-- to an email's local part) — fine for a picture, too loose for a guard.
-- This is the exact join `resolveRosterIdentity` makes: a roster row of this
-- name whose email is some login's email.
CREATE OR REPLACE FUNCTION public.bp_roster_name_has_login(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.team_members t
      JOIN public.profiles pr
        ON lower(btrim(pr.email)) = lower(btrim(t.email))
     WHERE t.tenant_id = ANY (public.auth_tenant_ids())
       AND t.name = btrim(coalesce(p_name, ''))
       AND coalesce(btrim(t.email), '') <> ''
  );
$fn$;

REVOKE ALL ON FUNCTION public.bp_roster_name_has_login(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_roster_name_has_login(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. bp_set_person_details — no longer edits a SIGN-IN email
-- ---------------------------------------------------------------------------
-- For a person with a login, the roster email IS the join to their login;
-- changing it here detached them (census 42). That change now goes through
-- the `admin-change-sign-in-email` Edge Function, which moves auth, profile
-- and roster together. A case-only difference is not a change (the function
-- stores lower-case, and `resolveRosterIdentity` compares lower-case).
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.bp_set_person_details(text,text,text,text)'::regprocedure);
  v_old text := E'  update public.team_members m\n     set first_name = v_first,';
  v_new text := E'  -- fix-659: a sign-in email is changed with "Change sign-in email", never here.\n'
             || E'  if public.bp_roster_name_has_login(v_name)\n'
             || E'     and exists (\n'
             || E'       select 1 from public.team_members m\n'
             || E'        where m.tenant_id = any (public.auth_tenant_ids())\n'
             || E'          and m.name = v_name\n'
             || E'          and nullif(lower(btrim(coalesce(m.email, ''''))), '''') is distinct from v_email) then\n'
             || E'    raise exception ''This is %''''s sign-in email. Use "Change sign-in email" to change it.'', v_name\n'
             || E'      using errcode = ''42501'';\n'
             || E'  end if;\n\n'
             || E'  update public.team_members m\n     set first_name = v_first,';
  v_n int;
BEGIN
  IF position('fix-659' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-659: bp_set_person_details already patched';
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-659: update anchor matched % times in bp_set_person_details', v_n;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$mig$;
