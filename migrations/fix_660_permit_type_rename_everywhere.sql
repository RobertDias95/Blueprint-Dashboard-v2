-- fix-660 (census 8, P-318): renaming a permit type carries everything that
-- stores it BY NAME, in one transaction — or refuses and says why.
--
-- ---------------------------------------------------------------------------
-- §0, MEASURED ON PROD 2026-10-13 (read-only)
-- ---------------------------------------------------------------------------
-- The type is a STRING everywhere — no foreign key anywhere points at
-- permit_types(name). A whole-database value scan (every text, text[] and
-- json/jsonb column in public) for 'SDOT Tree', 'ULS' and 'Building Permit'
-- found it in:
--
--   LIVE, and moved by this function                 SDOT Tree  ULS  Bldg Permit
--     permit_types.name                                     1     1      1
--     permits.type                                         22   126    322
--     permits.extras->>'type'  (2026-05-01 import copy;    11    28     47
--        nothing in v2, SQL or the scraper reads it —
--        moved anyway so no live row says the old name)
--     task_templates.permit_type                            1     2     20
--     target_submit_formulas.type                           1     1      1
--     permit_type_defaults.type                             1     1      1
--     app_config 'permitTypeDescriptions' (a KEY)           1     1      1
--     intake_records.permit_type                            0     0    283
--
--   HISTORY, deliberately NOT rewritten — it records what was true then:
--     audit_log.changes, notification_email_queue.payload, error_reports,
--     legacy_app_config / legacy_project_data / legacy_task_templates /
--     legacy_intake_data, _fix22_permits_dropped_cols_snapshot.
--   REBUILT BY ITS OWN WRITER: indexer_missing_letter.permit_type is the
--     file indexer's per-run output, read from permits.type on its next run.
--   CHECKED AND EMPTY: saved_reports.spec (all 8 are builtins with spec {}),
--     every other app_config key, and there is no learner table — the
--     target-submit learner reads permits live.
--
-- ★★★ THE THING THE OLD FUNCTION COULD NOT SEE: THE NAME IS ALSO CODE.
--     19 database functions name 'Building Permit' as a literal (7 name 'ULS',
--     4 'SDOT Tree', 3 'Condo' …), the scraper keys NO_ISSUANCE_PERMIT_TYPES and
--     BP_DEMO_PERMIT_TYPES off the names, and 45 client files name
--     'Building Permit'. Renaming 'ULS' used to succeed and silently switch off
--     the ULS rules in bp_derived_dm_for_permit, bp_permit_results_ready_autotask
--     and five more — no error, just wrong answers from then on. So:
--       • a BUILT-IN type is refused (every one of them is named by code),
--       • any type whose quoted name appears in a public function body is
--         refused, naming the functions (this catches custom ones like
--         'SDOT Tree' and 'Condo'),
--     and the refusal says what to do instead.
--
-- ★★ SECURITY DEFINER now, with an explicit admin check. It was INVOKER and
--    relied on RLS; that left the tenant tables reachable only through
--    whichever policies happened to allow the caller, so a rename could move
--    permits.type and silently skip a formula a policy hid. The catalogue is
--    global, so a reference in a tenant where the caller is NOT an admin is a
--    refusal, not a partial move.
--
-- ★ Return shape gains `out_writes` (jsonb, per-place counts). The two
--   existing columns keep their names and meaning, so the client deployed
--   before or after this migration reads it either way. A changed OUT list
--   cannot be CREATE OR REPLACEd, hence the DROP; fix-438's overload trap does
--   not apply because the argument list is unchanged.

DROP FUNCTION IF EXISTS public.bp_rename_permit_type(text, text);

CREATE FUNCTION public.bp_rename_permit_type(p_old text, p_new text)
 RETURNS TABLE(out_name text, out_permits_repointed integer, out_writes jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_old       text := btrim(COALESCE(p_old, ''));
  v_new       text := btrim(COALESCE(p_new, ''));
  v_builtin   boolean;
  v_fns       text;
  v_taken     text;
  v_foreign   integer;
  v_n         integer;
  v_permits   integer := 0;
  v_writes    jsonb := '{}'::jsonb;
  v_quoted    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bp_rename_permit_type: sign in to rename a permit type'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.bp_is_admin_anywhere() THEN
    RAISE EXCEPTION 'bp_rename_permit_type: only an admin can rename a permit type'
      USING ERRCODE = '42501';
  END IF;

  IF v_old = '' OR v_new = '' THEN
    RAISE EXCEPTION 'bp_rename_permit_type: both names are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_old = v_new THEN
    RETURN QUERY SELECT v_new, 0, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT is_builtin INTO v_builtin FROM public.permit_types WHERE name = v_old;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is not a permit type', v_old
      USING ERRCODE = 'P0002';
  END IF;

  -- ★ Refuse to merge — case-insensitively, since two types differing only in
  --   case read as one in every picker. A case-only rename of the SAME type
  --   ('Vault' → 'VAULT') is allowed.
  IF EXISTS (SELECT 1 FROM public.permit_types
             WHERE lower(name) = lower(v_new) AND name <> v_old) THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % already exists', v_new
      USING ERRCODE = '23505';
  END IF;

  IF v_builtin THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is a built-in type, and the app''s own rules name it in code (the scraper, the target-submit learner, routing). Renaming it here would quietly switch those rules off', v_old
      USING ERRCODE = '0A000',
            HINT = 'A built-in type is renamed by a code change, not from Settings.';
  END IF;

  -- LIKE wildcards in the name are escaped, so 'A_B' cannot match 'AxB'.
  v_quoted := '%'''
    || replace(replace(replace(replace(v_old, '\', '\\'), '%', '\%'), '_', '\_'), '''', '''''')
    || '''%';
  SELECT string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname) INTO v_fns
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosrc LIKE v_quoted;
  IF v_fns IS NOT NULL THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is named in the database''s own rules (%), so renaming it here would quietly switch them off', v_old, v_fns
      USING ERRCODE = '0A000',
            HINT = 'Those functions must be changed in the same release as the rename.';
  END IF;

  -- ★ The new name must not already be in use anywhere, even with no
  --   catalogue row behind it — a leftover formula or template for that name
  --   would otherwise be silently adopted by the renamed type.
  SELECT string_agg(place, ', ') INTO v_taken FROM (
    SELECT 'permits' AS place WHERE EXISTS (SELECT 1 FROM public.permits WHERE type = v_new)
    UNION ALL SELECT 'task templates' WHERE EXISTS (SELECT 1 FROM public.task_templates WHERE permit_type = v_new)
    UNION ALL SELECT 'target-submit formulas' WHERE EXISTS (SELECT 1 FROM public.target_submit_formulas WHERE type = v_new)
    UNION ALL SELECT 'permit-type defaults' WHERE EXISTS (SELECT 1 FROM public.permit_type_defaults WHERE type = v_new)
    UNION ALL SELECT 'intake records' WHERE EXISTS (SELECT 1 FROM public.intake_records WHERE permit_type = v_new)
    UNION ALL SELECT 'descriptions' WHERE EXISTS (SELECT 1 FROM public.app_config WHERE key = 'permitTypeDescriptions' AND value ? v_new)
  ) t;
  IF v_taken IS NOT NULL THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is already used by % with no permit type behind it — clear that up first', v_new, v_taken
      USING ERRCODE = '23505';
  END IF;

  -- ★★ Every tenant holding a reference must be one the caller administers.
  SELECT count(*) INTO v_foreign FROM (
    SELECT tenant_id FROM public.permits WHERE type = v_old
    UNION SELECT tenant_id FROM public.task_templates WHERE permit_type = v_old
    UNION SELECT tenant_id FROM public.target_submit_formulas WHERE type = v_old
    UNION SELECT tenant_id FROM public.permit_type_defaults WHERE type = v_old
    UNION SELECT tenant_id FROM public.intake_records WHERE permit_type = v_old
  ) refs
  WHERE refs.tenant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships m
                    WHERE m.user_id = v_uid AND m.role = 'admin' AND m.tenant_id = refs.tenant_id);
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is used in a workspace you are not an admin of', v_old
      USING ERRCODE = '42501';
  END IF;

  -- ===== the writes: one transaction, all or nothing =======================
  UPDATE public.permit_types SET name = v_new WHERE name = v_old;
  v_writes := v_writes || jsonb_build_object('permit_types', 1);

  UPDATE public.permits
     SET type = v_new,
         extras = CASE WHEN extras ->> 'type' = v_old
                       THEN jsonb_set(extras, '{type}', to_jsonb(v_new))
                       ELSE extras END
   WHERE type = v_old;
  GET DIAGNOSTICS v_permits = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('permits', v_permits);

  -- A permit whose type is already something else but whose import copy still
  -- says the old name (0 on prod today) is moved too, so no live row keeps it.
  UPDATE public.permits SET extras = jsonb_set(extras, '{type}', to_jsonb(v_new))
   WHERE extras ->> 'type' = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('permits_extras_only', v_n);

  UPDATE public.task_templates SET permit_type = v_new WHERE permit_type = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('task_templates', v_n);

  UPDATE public.target_submit_formulas SET type = v_new WHERE type = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('target_submit_formulas', v_n);

  UPDATE public.permit_type_defaults SET type = v_new WHERE type = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('permit_type_defaults', v_n);

  UPDATE public.intake_records SET permit_type = v_new WHERE permit_type = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('intake_records', v_n);

  UPDATE public.app_config
     SET value = (value - v_old) || jsonb_build_object(v_new, value -> v_old),
         updated_at = now()
   WHERE key = 'permitTypeDescriptions' AND value ? v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_writes := v_writes || jsonb_build_object('permit_type_descriptions', v_n);

  -- ★ Audited: permit_types has no audit trigger of its own (it has no
  --   tenant_id), so the rename itself is written here — one row per tenant the
  --   caller administers, carrying the full write list. The moved rows in
  --   permits / task_templates / permit_type_defaults / app_config are also
  --   audited row by row by their own bp_audit_row triggers.
  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, row_key, changes)
  SELECT m.tenant_id, v_uid, 'permit_type_renamed', 'permit_types', v_new,
         jsonb_build_object('name', v_new),
         jsonb_build_object('name', jsonb_build_object('before', v_old, 'after', v_new),
                            'writes', v_writes)
  FROM public.tenant_memberships m
  WHERE m.user_id = v_uid AND m.role = 'admin';

  RETURN QUERY SELECT v_new, v_permits, v_writes;
END; $function$;

REVOKE ALL ON FUNCTION public.bp_rename_permit_type(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_rename_permit_type(text, text) TO authenticated, service_role;
