-- ===========================================================================
-- fix-643b (P-338 addendum) — @Corrections becomes a SMART tag
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-12: "Can we make the @corrections a smart @corrections
-- where it's always Dave, always Gina, always Lucas, always Bobby, and then
-- it's the entitlement lead, the design manager, and the design associate? …
-- We could just do @corrections in any chat, and the rule would follow any
-- chat." Popup ruling: Brit is always included — the fixed half is exactly
-- the Corrections tag's current members, so no member change.
--
-- ★★★ ANY ADMIN TAG CAN NOW BE SMART: `mention_tags.include_project_team`.
--     When it is on, the tag reaches its members ∪ the chat's project team
--     (ENT · DM · DA) — the same three people `@project` reaches.
--
-- ★★★ ONE RESOLVER: `bp_resolve_mention_tag(tag, project)`. The composer asks
--     it (through `bp_mention_tags_for_project`) and the Bridge's corrections
--     notice calls it directly, so a person typing @Corrections and the Bridge
--     posting one reach the same people by the same rule.
--
-- ★★★ THE @project RULE, IN SQL: `bp_project_team_names(project)` is the
--     database twin of src/lib/projectTeam.ts (`projectInternalTeam` filtered
--     by `projectTagNames`), pinned clause by clause by a test:
--       · the permit in view = the project's first Building Permit by id, else
--         its first permit by id (the chat modal's `permits.find(BP) ??
--         permits[0]` over `usePermitsByProject`'s `.order('id')`);
--       · ENT = COALESCE(bp.ent_lead, project.entitlement_lead)
--       · DM  = COALESCE(bp.dm, project.design_manager)
--       · DA  = bp.da  (there is no project-level DA)
--     Names resolve to a login the fix-634 way (`bp_notify_person_for_name`:
--     exactly one active, non-former roster email with an active login, or
--     nobody). `@project` itself is unchanged.
--
-- ★★ THE NOTICE NOW USES THE RESOLVER (fix-643 §Build 1, re-ruled): mentions =
--    bp_resolve_mention_tag(<Corrections>, project), and the body shows one
--    `@Corrections` chip. A role with no login is still RAISEd as a WARNING.
--
-- ★ The one data write: include_project_team = true on the Corrections tag.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.mention_tags
  ADD COLUMN IF NOT EXISTS include_project_team boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mention_tags.include_project_team IS
  'fix-643b: when true the tag also reaches the chat''s project team '
  '(ENT · DM · DA, the @project rule) — see bp_resolve_mention_tag.';

-- ---------------------------------------------------------------------------
-- 2. The @project rule in SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_project_team_names(p_project_id uuid)
RETURNS TABLE(ord integer, role text, name text, user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH pr AS (
    SELECT p.id, p.tenant_id, p.entitlement_lead, p.design_manager
      FROM public.projects p
     WHERE p.id = p_project_id
  ),
  b AS (
    SELECT pm.ent_lead, pm.dm, pm.da
      FROM public.permits pm
     WHERE pm.project_id = p_project_id
     ORDER BY (pm.type = 'Building Permit') DESC, pm.id
     LIMIT 1
  ),
  roles AS (
    SELECT 1 AS ord, 'ENT'::text AS role, COALESCE(b.ent_lead, pr.entitlement_lead) AS name, pr.tenant_id
      FROM pr LEFT JOIN b ON true
    UNION ALL
    SELECT 2, 'DM', COALESCE(b.dm, pr.design_manager), pr.tenant_id
      FROM pr LEFT JOIN b ON true
    UNION ALL
    SELECT 3, 'DA', b.da, pr.tenant_id
      FROM pr LEFT JOIN b ON true
  )
  SELECT r.ord, r.role, btrim(r.name),
         (SELECT x.user_id FROM public.bp_notify_person_for_name(r.tenant_id, r.name) x)
    FROM roles r
   WHERE NULLIF(btrim(COALESCE(r.name, '')), '') IS NOT NULL
   ORDER BY r.ord;
$function$;

COMMENT ON FUNCTION public.bp_project_team_names(uuid) IS
  'fix-643b: the @project rule (ENT · DM · DA, first Building Permit''s '
  'overrides) in SQL — twin of src/lib/projectTeam.ts. user_id is NULL for a '
  'name with no single active login.';

-- ---------------------------------------------------------------------------
-- 3. The resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resolve_mention_tag(p_tag_id uuid, p_project_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant  uuid;
  v_smart   boolean;
  v_ids     uuid[] := '{}';
  v_u       uuid;
BEGIN
  SELECT t.tenant_id, t.include_project_team INTO v_tenant, v_smart
    FROM public.mention_tags t WHERE t.id = p_tag_id;
  IF v_tenant IS NULL THEN
    RETURN '{}';
  END IF;
  -- ★ A signed-in caller only resolves its own tenant's tags. (No session —
  --   the scraper's trigger chain — has no tenant to check against.)
  IF auth.uid() IS NOT NULL AND NOT (v_tenant = ANY (public.auth_tenant_ids())) THEN
    RETURN '{}';
  END IF;

  -- The fixed members, as they stand right now.
  FOR v_u IN
    SELECT m.user_id
      FROM public.mention_tag_members m
      JOIN public.profiles pr ON pr.id = m.user_id
     WHERE m.tag_id = p_tag_id
       AND COALESCE(pr.active, true)
     ORDER BY m.user_id
  LOOP
    IF NOT (v_u = ANY (v_ids)) THEN v_ids := v_ids || v_u; END IF;
  END LOOP;

  -- ∪ the chat's project team, when the tag is smart and the project is ours.
  IF v_smart AND p_project_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project_id AND p.tenant_id = v_tenant) THEN
    FOR v_u IN
      SELECT t.user_id FROM public.bp_project_team_names(p_project_id) t
       WHERE t.user_id IS NOT NULL
       ORDER BY t.ord
    LOOP
      IF NOT (v_u = ANY (v_ids)) THEN v_ids := v_ids || v_u; END IF;
    END LOOP;
  END IF;

  RETURN v_ids;
END;
$function$;

COMMENT ON FUNCTION public.bp_resolve_mention_tag(uuid, uuid) IS
  'fix-643b: who a tag reaches in a project''s chat — its members, plus the '
  'project team (ENT · DM · DA) when include_project_team is on. Deduped. The '
  'one rule shared by the composer and the Bridge''s corrections notice.';

-- The composer's call: every tag of the caller's tenant, resolved for one chat.
CREATE OR REPLACE FUNCTION public.bp_mention_tags_for_project(p_project_id uuid)
RETURNS TABLE(tag_id uuid, user_ids uuid[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT t.id, public.bp_resolve_mention_tag(t.id, p_project_id)
    FROM public.mention_tags t
   WHERE t.tenant_id = ANY (public.auth_tenant_ids())
   ORDER BY lower(t.name);
$function$;

-- ---------------------------------------------------------------------------
-- 4. List and upsert carry the flag (return type / arguments change, so DROP
--    and CREATE — CREATE OR REPLACE with a new argument list would leave an
--    overload that PostgREST cannot choose between)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.bp_list_mention_tags();
CREATE FUNCTION public.bp_list_mention_tags()
RETURNS TABLE(id uuid, name text, member_ids uuid[], updated_at timestamp with time zone,
              include_project_team boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT t.id, t.name,
         COALESCE(
           (SELECT array_agg(m.user_id ORDER BY m.user_id)
              FROM public.mention_tag_members m WHERE m.tag_id = t.id),
           ARRAY[]::uuid[]
         ) AS member_ids,
         t.updated_at,
         t.include_project_team
  FROM public.mention_tags t
  WHERE t.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY lower(t.name);
$function$;

DROP FUNCTION IF EXISTS public.bp_upsert_mention_tag(uuid, text, uuid[]);
CREATE FUNCTION public.bp_upsert_mention_tag(
  p_id uuid,
  p_name text,
  p_member_ids uuid[],
  p_include_project_team boolean DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_name   text := btrim(COALESCE(p_name, ''));
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: no tenant' USING ERRCODE = '42501';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'creating or editing a tag is restricted to admins'
      USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: a tag needs a name' USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '\s' OR left(v_name, 1) = '@' THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: a tag name is one word, without @ (got %)', v_name
      USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.mention_tags (tenant_id, name, created_by, include_project_team)
    VALUES (v_tenant, v_name, auth.uid(), COALESCE(p_include_project_team, false))
    RETURNING mention_tags.id INTO v_id;
  ELSE
    -- ★ fix-643b: NULL keeps the current flag, so an older client that does
    --   not send it cannot switch a smart tag off by saving its members.
    UPDATE public.mention_tags
       SET name = v_name,
           include_project_team = COALESCE(p_include_project_team, mention_tags.include_project_team),
           updated_at = now()
     WHERE mention_tags.id = p_id
       AND mention_tags.tenant_id = ANY (public.auth_tenant_ids())
    RETURNING mention_tags.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bp_upsert_mention_tag: tag % not in caller tenant', p_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.mention_tag_members WHERE tag_id = v_id;
  INSERT INTO public.mention_tag_members (tenant_id, tag_id, user_id)
  SELECT v_tenant, v_id, u
  FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u
  WHERE EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id = u AND tm.tenant_id = v_tenant
  )
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The Bridge's notice uses the resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_post_cr_notice(
  p_permit_id   integer,
  p_cycle_index integer,
  p_corr_issued date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today   date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_tenant  uuid;
  v_project uuid;
  v_num     text;
  v_type    text;
  v_thread  uuid;
  v_msg     uuid := gen_random_uuid();
  v_got     uuid;
  v_tag_id  uuid;
  v_tag     text;
  v_ids     uuid[] := '{}';
  v_missing text[] := '{}';
  v_body    text;
BEGIN
  IF p_permit_id IS NULL OR p_cycle_index IS NULL OR p_cycle_index < 1
     OR p_corr_issued IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_corr_issued < v_today - 14 OR p_corr_issued > v_today THEN
    RETURN NULL;
  END IF;

  SELECT p.tenant_id, p.project_id, p.num, p.type
    INTO v_tenant, v_project, v_num, v_type
    FROM public.permits p
   WHERE p.id = p_permit_id;
  IF v_project IS NULL OR v_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_type IS DISTINCT FROM 'Building Permit' THEN
    RETURN NULL;
  END IF;

  SELECT m.id INTO v_thread
    FROM public.project_messages m
   WHERE m.project_id = v_project
     AND m.parent_message_id IS NULL
     AND m.title = 'CR ' || p_cycle_index
   ORDER BY m.created_at, m.id
   LIMIT 1;
  IF v_thread IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.cr_notices
    (permit_id, cycle_index, tenant_id, project_id, message_id, corr_issued)
  VALUES
    (p_permit_id, p_cycle_index, v_tenant, v_project, v_msg, p_corr_issued)
  ON CONFLICT (permit_id, cycle_index) DO NOTHING
  RETURNING message_id INTO v_got;
  IF v_got IS NULL THEN
    RETURN NULL;
  END IF;

  -- ★★★ fix-643b: ONE RULE — exactly what a person typing @Corrections reaches.
  SELECT t.id, t.name INTO v_tag_id, v_tag
    FROM public.mention_tags t
   WHERE t.tenant_id = v_tenant
     AND lower(btrim(t.name)) = 'corrections'
   ORDER BY t.created_at, t.id
   LIMIT 1;

  IF v_tag_id IS NULL THEN
    -- No tag: still reach the project team, and say so.
    v_missing := v_missing || 'the Corrections tag'::text;
    v_ids := ARRAY(SELECT t.user_id FROM public.bp_project_team_names(v_project) t
                    WHERE t.user_id IS NOT NULL ORDER BY t.ord);
  ELSE
    v_ids := public.bp_resolve_mention_tag(v_tag_id, v_project);
  END IF;

  -- A project role with no single active login is reported, never fatal.
  v_missing := v_missing || ARRAY(
    SELECT t.role || ' ' || t.name FROM public.bp_project_team_names(v_project) t
     WHERE t.user_id IS NULL ORDER BY t.ord);

  IF cardinality(v_missing) > 0 THEN
    RAISE WARNING 'fix-643: corrections notice for permit % round % could not tag: %',
      COALESCE(v_num, p_permit_id::text), p_cycle_index, array_to_string(v_missing, ', ');
  END IF;

  v_body := 'Corrections are out — '
         || COALESCE(NULLIF(btrim(v_num), ''), 'this permit')
         || ' (' || v_type || '), round ' || p_cycle_index
         || '. The city issued them ' || to_char(p_corr_issued, 'FMMon FMDD') || '.';
  IF v_tag_id IS NOT NULL THEN
    v_body := v_body || chr(10) || '@' || btrim(v_tag);
  END IF;

  INSERT INTO public.project_messages
    (id, tenant_id, project_id, author_id, title, body, parent_message_id, mentions, created_at)
  VALUES
    (v_msg, v_tenant, v_project, NULL::uuid, NULL, v_body, v_thread, COALESCE(v_ids, '{}'), now());

  RETURN v_msg;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_project_team_names(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_project_team_names(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bp_resolve_mention_tag(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_resolve_mention_tag(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_mention_tags_for_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_mention_tags_for_project(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_list_mention_tags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_mention_tags() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_upsert_mention_tag(uuid, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_mention_tag(uuid, text, uuid[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_post_cr_notice(integer, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_post_cr_notice(integer, integer, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The one approved data write (Bobby): Corrections becomes smart.
--    Members are unchanged.
-- ---------------------------------------------------------------------------
UPDATE public.mention_tags
   SET include_project_team = true
 WHERE lower(btrim(name)) = 'corrections'
   AND include_project_team = false;

COMMIT;
