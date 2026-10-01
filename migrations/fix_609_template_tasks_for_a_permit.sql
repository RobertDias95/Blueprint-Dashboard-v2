-- fix-609 (P-306): a permit added to an existing project is OFFERED its
-- template tasks — one click, never silently (Bobby, 2026-09-30).
--
-- ⚠️ STAGED, NOT APPLIED BY THE PR. Claude applies it from Cowork.
--    CI is green with it unapplied: nothing in the client calls the new RPC
--    until this exists, and the offer it backs renders nothing on an error.
--
-- ---------------------------------------------------------------------------
-- WHAT IS EXTRACTED, AND THE PROOF IT IS THE SAME RULE
-- ---------------------------------------------------------------------------
-- The live bp_create_project_with_permits (pg_get_functiondef, prod,
-- 2026-09-30) seeds a new permit's tasks with ONE inline block:
--     IF array_length(v_task_ids, 1) > 0 THEN INSERT INTO public.permit_tasks … ;
-- 2,019 characters, md5 1aaeef35f9e47badc5c1eb0d9ae98200. That block moves into
--     bp_seed_template_tasks(p_permit_id integer, p_template_ids uuid[]) RETURNS integer
-- and the create function calls it instead. The INSERT inside the new function
-- is the original block with seven NAME substitutions and nothing else:
--     p_tenant_id → v_tenant                         (permits.tenant_id)
--     v_permit_id → p_permit_id
--     NULLIF(v_permit->>'ent_lead','') → v_ent_lead  (NULLIF(permits.ent_lead,''))
--     NULLIF(v_permit->>'da','')       → v_da        (NULLIF(permits.da,''))
--     v_schematic_designer → v_schematic             (projects.schematic_designer)
--     v_permit_type → v_type                         (permits.type)
--     v_task_ids → p_template_ids
-- Each right-hand value is READ BACK from the row the create function has just
-- inserted from the left-hand value. No BEFORE INSERT trigger on permits or
-- projects rewrites ent_lead, da, type, juris or schematic_designer (checked:
-- permits has default_tenant, target_submit_manual_flag and derive_dm — the
-- last writes dm only), so the read-back equals the argument and the rows are
-- the same. src/__tests__/TemplateTasksLaterFix609.test.ts applies the list to
-- the verbatim original (fixtures/fix609_create_seed_block.sql, md5-checked)
-- and asserts this file contains the result character for character.
--
-- The patch below REFUSES to apply unless the block it removes still has that
-- md5 — if prod moved since 2026-09-30, it aborts instead of guessing.
--
-- ★ Found while reading, NOT in the brief: the create function seeds NO
--   subtasks (task_template_subtasks is never read). Same here — byte-for-byte
--   means not adding them.
-- ★ A task does NOT record its template: permit_tasks has no template column.
--   The add RPC's "already applied" rule is therefore the narrowest safe one:
--   a template is skipped when THIS permit already has a task with the SAME
--   text. (Prod: no two templates share a text within an overlapping scope.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bp_seed_template_tasks — the one seeding rule
-- ---------------------------------------------------------------------------
-- No caller-facing grant: it trusts its arguments (applicability is filtered,
-- permission is not checked), exactly as the inline block did. Only the two
-- SECURITY DEFINER functions below call it.
CREATE OR REPLACE FUNCTION public.bp_seed_template_tasks(
  p_permit_id    integer,
  p_template_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant    uuid;
  v_type      text;
  v_ent_lead  text;
  v_da        text;
  v_juris     text;
  v_schematic text[];
  v_n         integer := 0;
BEGIN
  SELECT p.tenant_id, p.type, NULLIF(p.ent_lead, ''), NULLIF(p.da, ''),
         pr.juris, COALESCE(pr.schematic_designer, ARRAY[]::text[])
    INTO v_tenant, v_type, v_ent_lead, v_da, v_juris, v_schematic
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   WHERE p.id = p_permit_id;
  IF NOT FOUND THEN RETURN 0; END IF;

    IF array_length(p_template_ids, 1) > 0 THEN
      INSERT INTO public.permit_tasks (
        tenant_id, permit_id, bucket, discipline, text, cat,
        assigned_to, co_assignees, waiting_on,
        sort_order, is_jurisdiction_specific
      )
      SELECT
        v_tenant, p_permit_id, tt.bucket,
        COALESCE(public.bp_discipline_for_team(tt.default_team), 'ent'),
        tt.text, tt.cat,
        CASE tt.default_team
          WHEN 'Entitlements'     THEN v_ent_lead
          WHEN 'Design Associate' THEN v_da
          WHEN 'Architecture'     THEN v_da
          WHEN 'Schematic Team'   THEN (v_schematic)[1]
          ELSE NULLIF(tt.default_team, '')
        END AS assigned_to,
        (
          SELECT COALESCE(
                   array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND r <> ''),
                   ARRAY[]::text[])
          FROM unnest(COALESCE(tt.default_co_assignees, ARRAY[]::text[])) AS elem
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN elem = 'role:design_associate'
                THEN ARRAY[v_da]
              WHEN elem = 'role:design_manager'
                THEN ARRAY[(
                  SELECT g.dm_name FROM public.dm_da_groups g
                  WHERE g.tenant_id = v_tenant
                    AND g.da_name = v_da
                  LIMIT 1)]
              WHEN elem = 'role:schematic_designer'
                THEN COALESCE(v_schematic, ARRAY[]::text[])
              ELSE ARRAY[elem]
            END AS arr
          ) x
          CROSS JOIN LATERAL unnest(x.arr) AS r
        ) AS co_assignees,
        tt.default_waiting_on AS waiting_on,
        COALESCE(tt.sort_order, 0),
        (tt.jurisdiction IS NOT NULL)
      FROM public.task_templates tt
      WHERE tt.id = ANY(p_template_ids)
        AND tt.permit_type = v_type
        AND (tt.jurisdiction = v_juris OR tt.jurisdiction IS NULL);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_seed_template_tasks(integer, uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. bp_create_project_with_permits calls it — patched by ANCHOR + md5
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def   text := pg_get_functiondef(
    'public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb)'::regprocedure);
  c_start constant text := E'    IF array_length(v_task_ids, 1) > 0 THEN\n';
  c_end   constant text := E'    END IF;\n  END LOOP;';
  c_md5   constant text := '1aaeef35f9e47badc5c1eb0d9ae98200';
  v_s     integer;
  v_e     integer;
  v_old   text;
BEGIN
  IF position('bp_seed_template_tasks' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-609: bp_create_project_with_permits already calls bp_seed_template_tasks';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_start, ''))) / length(c_start) <> 1 THEN
    RAISE EXCEPTION 'fix-609: seeding anchor not found exactly once';
  END IF;
  v_s := position(c_start IN v_def);
  v_e := v_s + position(c_end IN substr(v_def, v_s)) - 1;
  v_old := substr(v_def, v_s, v_e - v_s);
  IF md5(v_old) <> c_md5 THEN
    RAISE EXCEPTION 'fix-609: the seeding block changed since 2026-09-30 (md5 %), refusing to patch', md5(v_old);
  END IF;
  EXECUTE substr(v_def, 1, v_s - 1)
       || c_start
       || E'      PERFORM public.bp_seed_template_tasks(v_permit_id, v_task_ids);\n'
       || substr(v_def, v_e);
END;
$patch$;

-- Restate the old ACL (a replace keeps it; stated so it cannot drift).
REVOKE ALL ON FUNCTION public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. bp_add_template_tasks_to_permit — the caller-facing offer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_add_template_tasks_to_permit(
  p_permit_id    integer,
  p_template_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
  v_tenant  uuid;
  v_type    text;
  v_juris   text;
  v_bad     uuid;
  v_todo    uuid[];
BEGIN
  IF p_permit_id IS NULL THEN
    RAISE EXCEPTION 'bp_add_template_tasks_to_permit: p_permit_id is required' USING ERRCODE = '22004';
  END IF;

  SELECT p.project_id, p.tenant_id, p.type, pr.juris
    INTO v_project, v_tenant, v_type, v_juris
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   WHERE p.id = p_permit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_add_template_tasks_to_permit: permit % not found', p_permit_id USING ERRCODE = 'P0002';
  END IF;

  -- ★ The project-write rule, reused — not a second one.
  IF NOT public.bp_may_write_project(v_project) THEN
    RAISE EXCEPTION 'bp_add_template_tasks_to_permit: you may not edit this project' USING ERRCODE = '42501';
  END IF;

  IF p_template_ids IS NULL OR cardinality(p_template_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- ★★ THE SERVER DECIDES APPLICABILITY: same tenant, same permit type, and a
  --    jurisdiction that is NULL (Base) or this project's. Anything else is
  --    refused outright rather than quietly dropped.
  SELECT x INTO v_bad
    FROM unnest(p_template_ids) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM public.task_templates tt
      WHERE tt.id = x
        AND tt.tenant_id = v_tenant
        AND tt.permit_type = v_type
        AND (tt.jurisdiction IS NULL OR tt.jurisdiction = v_juris))
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'bp_add_template_tasks_to_permit: template % does not apply to permit %', v_bad, p_permit_id
      USING ERRCODE = '22023';
  END IF;

  -- ★★ IDEMPOTENT: a template whose text is already a task on this permit is
  --    skipped (no template column exists to key on — see the header).
  SELECT COALESCE(array_agg(DISTINCT tt.id), ARRAY[]::uuid[])
    INTO v_todo
    FROM public.task_templates tt
   WHERE tt.id = ANY (p_template_ids)
     AND NOT EXISTS (
       SELECT 1 FROM public.permit_tasks pt
        WHERE pt.permit_id = p_permit_id
          AND pt.text = tt.text);

  RETURN public.bp_seed_template_tasks(p_permit_id, v_todo);
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_add_template_tasks_to_permit(integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_add_template_tasks_to_permit(integer, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Post-conditions (fix-540: assert the change LANDED)
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_def text := pg_get_functiondef(
    'public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb)'::regprocedure);
BEGIN
  IF position('PERFORM public.bp_seed_template_tasks(v_permit_id, v_task_ids);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-609: create function does not call bp_seed_template_tasks';
  END IF;
  IF position('INSERT INTO public.permit_tasks' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fix-609: create function still has its own seeding INSERT';
  END IF;
  IF has_function_privilege('anon', 'public.bp_add_template_tasks_to_permit(integer, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.bp_seed_template_tasks(integer, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-609: grants wrong';
  END IF;
END;
$check$;

COMMIT;
