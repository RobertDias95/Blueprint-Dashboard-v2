-- ===========================================================================
-- fix-379 — a design manager sees a permit because their associate is on it
-- ===========================================================================
--
-- APPLIED to prod (eibnmwthkcuumyclyxoe) on 2026-08-21 via MCP apply_migration
-- as `fix_379_dm_derived`. This file is the repo-of-record copy.
--
-- ★★★ THE TWO DATA CHANGES ARE NOT HERE AND ARE NOT APPLIED:
--   · the three mapping rows (Jade→Alex, Jade→Nidhi, Gena→George)
--       → migrations/fix_379_mapping_rows_PENDING_APPROVAL.sql
--   · the 123-permit backfill (56 clears / 61 fills / 6 corrections)
--       → migrations/fix_379_backfill_PENDING_APPROVAL.sql
-- Both are commented out in full and a test asserts they stay that way.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE RULE, IN BOBBY'S WORDS
-- ---------------------------------------------------------------------------
-- "If the design associate is assigned to a permit, then that design manager
--  would also see the permit… everything outside of Cam and Shire should have
--  a mapped design manager to them based off the design associate. Their job
--  is to oversee the associates, right?"
--
-- So permits.dm IS DERIVED: it is whoever manages the DA on this permit,
-- via dm_da_groups (bp_dm_for_da, fix-346's single lookup). Consequences:
--
--   · NO DA means NO DM. A manager with nobody to oversee does not belong on
--     the permit.
--   · A ULS permit carries NEITHER a DM nor a DA, whatever the project says.
--     Bobby: "generally speaking, ULS permits are never assigned to a DM or
--     DA." (fix-302 was reverted by fix-312 for violating exactly this.)
--   · An UNMAPPED DA (Cam, Shire) is NOT an error and gets no invented
--     manager. The derivation is silent there: permits.dm stays whatever a
--     person set, and bp_dm_gap_report() names the permits so the silence is
--     a number. Cam's TASKS still reach a manager through fix-368's
--     dm_of_project fallback, which this ticket does not touch.
--   · dm stops being independently editable: any write of da/dm/type runs the
--     derivation (BEFORE trigger below), so a dm that contradicts the mapping
--     cannot be stored — it is snapped to the derived value in the same write.
--
-- ---------------------------------------------------------------------------
-- ★★★ §1 — THIS CORRECTS PART OF fix-377
-- ---------------------------------------------------------------------------
-- fix-377 shipped projects.design_manager → permits.dm as a cascade. Under
-- this rule that cascade must not exist: permits.dm follows the DA, never the
-- project. §4 below REDEFINES bp_trg_project_lead_cascade with the
-- design_manager block REMOVED and recreates projects_cascade_lead to watch
-- entitlement_lead only. The entitlement half (projects.entitlement_lead →
-- permits.ent_lead) is correct and stays byte-for-byte.
--
-- fix-377's PERMIT-level trigger (permits_lead_cascade) is untouched: when
-- the derivation changes dm on a permit, that trigger still moves the old
-- manager's open tasks to the new one — same event, same rule as before.
--
-- ---------------------------------------------------------------------------
-- ★★★ §2 — THE MAPPING OUTLIVES THE PERSON, mechanically
-- ---------------------------------------------------------------------------
-- fix-346 §3 deleted the departed DAs' rows ("a routing table, not a history
-- record"). Under fix-379 that conception is wrong: the row records who
-- managed whom, which stays true after they leave, and the derivation needs
-- it for every permit still carrying that DA. team_members.active already
-- handles "no new work".
--
-- Two mechanisms, because there are two deleters:
--   · a BEFORE DELETE guard on dm_da_groups refuses to drop a row whose
--     da_name is still carried by ANY permit (issued included — issued
--     permits keep their DA forever, which is what makes the protection
--     permanent). Overridable only by an explicit session flag.
--   · bp_replace_app_config_and_roster's reconciling DELETE (the config
--     import) now RETAINS protected rows instead of erroring: an imported
--     roster that omits a departed DA keeps the mapping silently, which is
--     the desired durability, not a failure.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The derivation, in one place.
-- ---------------------------------------------------------------------------
-- ★ Returns (derived_dm, determinate). determinate=false is the unmapped-DA
-- case: the derivation has no answer and the caller must leave dm alone.
-- ★ Its TS twin is derivePermitDm() in src/lib/permitDmDerivation.ts — KEEP IN
-- LOCKSTEP (the fix-214 / fix-244 / fix-346 pattern).
CREATE OR REPLACE FUNCTION public.bp_derived_dm_for_permit(
  p_type   text,
  p_da     text,
  p_tenant uuid
)
RETURNS TABLE (derived_dm text, determinate boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_da     text := NULLIF(btrim(COALESCE(p_da, '')), '');
  v_mapped text;
BEGIN
  -- ★★★ A ULS permit carries neither a DM nor a DA. This is the ONE permit
  -- type Bobby named; it is not the NO_ISSUANCE set (SDOT Tree stays out —
  -- Shire runs those and they must simply not RESOLVE to a manager).
  IF p_type = 'ULS' THEN
    derived_dm := NULL; determinate := true; RETURN NEXT; RETURN;
  END IF;

  -- ★★★ No DA means NO DM — a manager overseeing nobody.
  IF v_da IS NULL THEN
    derived_dm := NULL; determinate := true; RETURN NEXT; RETURN;
  END IF;

  -- ★★ The DA's manager, from dm_da_groups. fix-346's lookup: trimmed,
  -- case-folded, (dm_order, da_order, dm_name, da_name) tie-break.
  v_mapped := public.bp_dm_for_da(v_da, p_tenant);
  IF v_mapped IS NOT NULL THEN
    derived_dm := v_mapped; determinate := true; RETURN NEXT; RETURN;
  END IF;

  -- ★ An unmapped DA (Cam, Shire) resolves to NOTHING, deliberately. No
  -- manager is invented (fix-368 measured that a single row for Cam would
  -- mis-file two thirds of his work); the permits are named by
  -- bp_dm_gap_report() rather than guessed at.
  derived_dm := NULL; determinate := false; RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.bp_derived_dm_for_permit(text, text, uuid) IS
  'fix-379: permits.dm is derived — the manager of the permit''s DA (dm_da_groups), NULL when there is no DA, and NULL always on a ULS. determinate=false = the DA has no mapping row (Cam, Shire): the derivation is silent and dm is left to people.';

REVOKE ALL ON FUNCTION public.bp_derived_dm_for_permit(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_derived_dm_for_permit(text, text, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★★★ 2. The trigger — dm stops being independently writable.
-- ---------------------------------------------------------------------------
-- BEFORE, because it edits NEW in place; on the ROW, because permits.dm has
-- many writers (direct client updates, the wizard's insert path,
-- bp_move_draw_schedule_da, bp_rename_dm, and until this migration the
-- fix-377 project cascade) and a rule installed in any one of them is
-- silently absent from the rest — fix-346's argument, unchanged.
--
-- ★ NAME ORDER MATTERS: BEFORE triggers fire alphabetically, and
-- 'permits_default_tenant' < 'permits_derive_dm', so NEW.tenant_id is already
-- resolved when the mapping lookup runs. Do not rename either without
-- re-checking that sort.
--
-- ★ The AFTER trigger permits_lead_cascade (fix-377) sees the FINAL row, so
-- when a DA reassignment re-derives dm here, the outgoing manager's open
-- tasks on the permit still move to the incoming one — the same path a
-- direct dm change took before this ticket.
CREATE OR REPLACE FUNCTION public.bp_trg_permit_derive_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_derived     text;
  v_determinate boolean;
BEGIN
  -- ★★ fix-346's guard, for a new reason: "UPDATE OF da, dm, type" fires
  -- whenever those columns are in the SET list even when the values are
  -- identical. Without this, any writer re-asserting unchanged values (a
  -- scraper upsert, a bulk save) would silently apply the pending backfill
  -- to the rows it touches — a data change nobody approved. The rule acts
  -- on a CHANGE.
  IF TG_OP = 'UPDATE'
     AND NEW.da   IS NOT DISTINCT FROM OLD.da
     AND NEW.dm   IS NOT DISTINCT FROM OLD.dm
     AND NEW.type IS NOT DISTINCT FROM OLD.type THEN
    RETURN NEW;
  END IF;

  -- ★★★ ULS: strip BOTH. "A design associate and/or design manager should
  -- never be assigned to a ULS" — enforced here so the violation measured on
  -- 2026-08-21 (41 with a DM, 8 with a DA) cannot regrow.
  IF NEW.type = 'ULS' THEN
    NEW.dm := NULL;
    NEW.da := NULL;
    RETURN NEW;
  END IF;

  SELECT d.derived_dm, d.determinate INTO v_derived, v_determinate
  FROM public.bp_derived_dm_for_permit(NEW.type, NEW.da, NEW.tenant_id) d;

  IF v_determinate THEN
    -- Mapped DA → their manager. No DA → NULL. Whatever the writer sent for
    -- dm is overwritten: the derivation is the value.
    NEW.dm := v_derived;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.da IS DISTINCT FROM OLD.da
    AND NEW.dm IS NOT DISTINCT FROM OLD.dm
    AND public.bp_dm_for_da(OLD.da, NEW.tenant_id) IS NOT NULL THEN
    -- ★ Unmapped DA, and the permit just CHANGED HANDS from a MAPPED one
    -- with dm merely carried over: that dm is the previous associate's
    -- manager, which is now nobody's answer. Clear it rather than let it
    -- ride along. The OLD-mapped test is what keeps a plain RENAME safe:
    -- bp_rename_da rewriting Cam → a new spelling changes da with dm
    -- untouched, and Cam's human-set managers must survive that. A write
    -- that sets dm explicitly in the same statement
    -- (bp_move_draw_schedule_da does) keeps what it sent — for an unmapped
    -- DA that is a person's call.
    NEW.dm := NULL;
  END IF;
  -- else: unmapped DA, DA unchanged → dm stays a human-managed field
  -- (Cam's 20 permits keep the managers people put there — brief §3).

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.bp_trg_permit_derive_dm() IS
  'fix-379: BEFORE INSERT OR UPDATE OF da, dm, type — snaps permits.dm to bp_derived_dm_for_permit, strips dm AND da from ULS permits, and leaves dm alone only when the DA is unmapped (Cam, Shire). This is what makes dm computed rather than editable.';

REVOKE ALL ON FUNCTION public.bp_trg_permit_derive_dm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_permit_derive_dm()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS permits_derive_dm ON public.permits;
CREATE TRIGGER permits_derive_dm
  BEFORE INSERT OR UPDATE OF da, dm, type ON public.permits
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_trg_permit_derive_dm();

-- ---------------------------------------------------------------------------
-- ★★★ 3. dm_da_groups: the mapping outlives the person.
-- ---------------------------------------------------------------------------
-- The guard. Any permit (issued included) still naming the DA makes the row
-- load-bearing for the derivation and for reading history; deleting it is
-- refused with a message the Settings toast can show verbatim.
-- ★ The override flag exists because a deliberate, Bobby-approved removal
-- must still be possible — but it has to be TYPED, in the session, on
-- purpose: SET app.bp_allow_dm_da_group_delete = 'on';
CREATE OR REPLACE FUNCTION public.bp_trg_dm_da_group_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refs bigint;
BEGIN
  IF COALESCE(current_setting('app.bp_allow_dm_da_group_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO v_refs
  FROM public.permits p
  WHERE p.tenant_id = OLD.tenant_id
    AND lower(btrim(COALESCE(p.da, ''))) = lower(btrim(COALESCE(OLD.da_name, '')))
    AND btrim(COALESCE(OLD.da_name, '')) <> '';

  IF v_refs > 0 THEN
    RAISE EXCEPTION
      'The % → % mapping cannot be removed: % permit(s) still name % as their design associate and the DM derivation reads this row. A departed associate keeps their mapping — mark them inactive on the roster instead. (fix-379)',
      OLD.dm_name, OLD.da_name, v_refs, OLD.da_name
      USING ERRCODE = 'P0379';
  END IF;

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.bp_trg_dm_da_group_guard() IS
  'fix-379 §4: a dm_da_groups row whose da_name is still on any permit (issued included) cannot be deleted — the mapping records who managed whom and the derivation reads it. Override for a deliberate removal: SET app.bp_allow_dm_da_group_delete = ''on''.';

REVOKE ALL ON FUNCTION public.bp_trg_dm_da_group_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_dm_da_group_guard()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS dm_da_groups_guard_departed ON public.dm_da_groups;
CREATE TRIGGER dm_da_groups_guard_departed
  BEFORE DELETE ON public.dm_da_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_trg_dm_da_group_guard();

-- The second deleter: the config import's reconciling DELETE. Redefined from
-- the LIVE prod definition (2026-08-21) with ONE change — the delete now
-- retains rows the guard protects, so importing a roster JSON that omits a
-- departed DA silently KEEPS their mapping instead of failing the whole
-- import. (This is the path that would otherwise recreate the fix-346 §3
-- hole on the next departure.) Everything else is byte-for-byte.
CREATE OR REPLACE FUNCTION public.bp_replace_app_config_and_roster(p_expected_version bigint, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_cfg integer := 0; c_team integer := 0; c_dmda integer := 0;
  c_juris integer := 0; c_ptype integer := 0;
  ent_arr jsonb; dm_arr jsonb; da_arr jsonb; fmrda_arr jsonb; acq_arr jsonb;
  juris_arr jsonb; ptype_arr jsonb; groups_obj jsonb; thresh_obj jsonb; v_new bigint;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'p_config must be a jsonb object';
  end if;
  v_new := public.bp_check_and_bump_version('app_config_bundle', p_expected_version);

  insert into public.app_config (key, value, updated_at)
  select kv.key, kv.value, now() from jsonb_each(p_config) kv
  on conflict (key) do update set value = excluded.value, updated_at = now();
  get diagnostics c_cfg = row_count;

  ent_arr   := coalesce(p_config->'entLeads',     '[]'::jsonb);
  dm_arr    := coalesce(p_config->'dms',          '[]'::jsonb);
  da_arr    := coalesce(p_config->'das',          '[]'::jsonb);
  fmrda_arr := coalesce(p_config->'formerDas',    '[]'::jsonb);
  acq_arr   := coalesce(p_config->'acqLeads',     '[]'::jsonb);
  juris_arr := coalesce(p_config->'jurisdictions','[]'::jsonb);
  ptype_arr := coalesce(p_config->'permitTypes',  '[]'::jsonb);
  groups_obj := coalesce(p_config->'dmDaGroups',  '{}'::jsonb);
  thresh_obj := coalesce(p_config->'learnThresholds','{}'::jsonb);

  update public.team_members set active = false where former = false;

  insert into public.team_members (name, role, active, former)
  select n, 'ent_lead', true, false from jsonb_array_elements_text(ent_arr) n
  union all select n, 'dm', true, false from jsonb_array_elements_text(dm_arr) n
  union all select n, 'da', true, false from jsonb_array_elements_text(da_arr) n
  union all select n, 'da', false, true from jsonb_array_elements_text(fmrda_arr) n
  union all select n, 'acq_lead', true, false from jsonb_array_elements_text(acq_arr) n
  on conflict (name, role) do update
    set active = excluded.active, former = excluded.former;
  get diagnostics c_team = row_count;

  insert into public.dm_da_groups (dm_name, da_name)
  select dm.key, da_name
    from jsonb_each(groups_obj) dm,
         jsonb_array_elements_text(dm.value) da_name
  on conflict (dm_name, da_name) do nothing;
  get diagnostics c_dmda = row_count;
  -- fix-379: retain any mapping whose DA is still carried by a permit — the
  -- guard trigger would refuse the delete anyway; skipping it here keeps a
  -- roster import working while preserving the departed associates' rows.
  delete from public.dm_da_groups d
   where not exists (
     select 1 from jsonb_each(groups_obj) dm,
                   jsonb_array_elements_text(dm.value) da_name
      where dm.key = d.dm_name and da_name = d.da_name
   )
   and not exists (
     select 1 from public.permits p
      where p.tenant_id = d.tenant_id
        and lower(btrim(coalesce(p.da, ''))) = lower(btrim(coalesce(d.da_name, '')))
        and btrim(coalesce(d.da_name, '')) <> ''
   );

  insert into public.jurisdictions (name, learn_window_days)
  select j, coalesce((thresh_obj->>j)::integer, 120)
    from jsonb_array_elements_text(juris_arr) j
  on conflict (name) do update set learn_window_days = excluded.learn_window_days;
  get diagnostics c_juris = row_count;
  delete from public.jurisdictions j
   where not exists (
     select 1 from jsonb_array_elements_text(juris_arr) jn where jn = j.name
   );

  insert into public.permit_types (name, is_builtin)
  select t, false from jsonb_array_elements_text(ptype_arr) t
  on conflict (name) do nothing;
  get diagnostics c_ptype = row_count;
  delete from public.permit_types pt
   where pt.is_builtin = false
     and not exists (
       select 1 from jsonb_array_elements_text(ptype_arr) tn where tn = pt.name
     );

  return jsonb_build_object(
    'app_config_keys', c_cfg, 'team_members', c_team,
    'dm_da_groups', c_dmda, 'jurisdictions', c_juris,
    'permit_types', c_ptype, 'new_version', v_new);
end;
$function$;

-- ---------------------------------------------------------------------------
-- ★★★ 4. fix-377, minus its design half.
-- ---------------------------------------------------------------------------
-- Redefined from the LIVE prod definition (2026-08-21). REMOVED: the
-- design_manager → dm block — under fix-379, permits.dm follows the DA, and
-- a project reassignment must not touch it. KEPT byte-for-byte: the
-- entitlement_lead → ent_lead block, which is a genuine per-permit
-- assignment (Bobby holds PAR/Pre-Sub and SDOT Tree ent leads on projects
-- other people run).
CREATE OR REPLACE FUNCTION public.bp_trg_project_lead_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text;
  v_new text;
BEGIN
  -- entitlement_lead → permits.ent_lead (fix-377, unchanged)
  v_old := NULLIF(btrim(COALESCE(OLD.entitlement_lead, '')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.entitlement_lead, '')), '');
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.permits p
       SET ent_lead = v_new
     WHERE p.project_id = NEW.id
       AND p.actual_issue IS NULL
       AND lower(btrim(COALESCE(p.ent_lead, ''))) = lower(v_old);
  END IF;

  -- ★★★ fix-379: the design_manager → dm block that stood here is REMOVED.
  -- permits.dm is derived from the permit's DA (permits_derive_dm); a
  -- project's design manager changing moves nothing on permits. fix-368's
  -- projects_dm_coassign (task co-assignees for UNMAPPED DAs) is a different
  -- rule on a different table and still fires after this one.

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.bp_trg_project_lead_cascade() IS
  'fix-377, amended by fix-379: a project''s entitlement_lead change follows onto its UNISSUED permits (renames only — never creates). The design_manager half was removed by fix-379: permits.dm is derived from the DA and never follows the project.';

-- ★ Still named to sort before projects_dm_coassign (fix-377's ordering note).
DROP TRIGGER IF EXISTS projects_cascade_lead ON public.projects;
CREATE TRIGGER projects_cascade_lead
  AFTER UPDATE OF entitlement_lead ON public.projects
  FOR EACH ROW
  WHEN (NEW.entitlement_lead IS DISTINCT FROM OLD.entitlement_lead)
  EXECUTE FUNCTION public.bp_trg_project_lead_cascade();

-- ---------------------------------------------------------------------------
-- ★★ 5. The drift report follows the model.
-- ---------------------------------------------------------------------------
-- fix-377's report compared permits.dm against projects.design_manager.
-- Under fix-379 that comparison is meaningless — dm follows the DA, so
-- disagreeing with the project is the EXPECTED state, not drift. The report
-- keeps its shape and its ent_lead arm only.
CREATE OR REPLACE FUNCTION public.bp_lead_drift_report()
RETURNS TABLE (
  field         text,
  address       text,
  permit_label  text,
  permit_lead   text,
  project_lead  text,
  lead_is_ever_a_project_lead boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'ent_lead',
         pr.address,
         COALESCE(p.num, '(' || COALESCE(p.type, 'no type') || ')'),
         p.ent_lead,
         pr.entitlement_lead,
         EXISTS (
           SELECT 1 FROM public.projects x
            WHERE lower(btrim(COALESCE(x.entitlement_lead, '')))
                = lower(btrim(p.ent_lead))
         )
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   WHERE pr.tenant_id = ANY (public.auth_tenant_ids())
     AND p.actual_issue IS NULL
     AND NULLIF(btrim(COALESCE(p.ent_lead,  '')), '') IS NOT NULL
     AND NULLIF(btrim(COALESCE(pr.entitlement_lead, '')), '') IS NOT NULL
     AND lower(btrim(p.ent_lead)) <> lower(btrim(pr.entitlement_lead))
   ORDER BY 1, 2, 3;
$$;

COMMENT ON FUNCTION public.bp_lead_drift_report() IS
  'fix-377 §5, narrowed by fix-379: unissued permits whose ent_lead disagrees with the project. The dm arm was removed — permits.dm is derived from the DA (fix-379), so disagreeing with the project''s design_manager is not drift.';

-- ---------------------------------------------------------------------------
-- ★ 6. The gap surface: permits whose DA the derivation cannot resolve.
-- ---------------------------------------------------------------------------
-- The unmapped DAs are a decision, not an oversight (Cam works across
-- managers via fix-368; Shire's SDOT Trees must not resolve to anyone) — but
-- the decision must not be silent. Same reasoning as fix-368's
-- bp_coassign_gap_report.
CREATE OR REPLACE FUNCTION public.bp_dm_gap_report()
RETURNS TABLE (
  da           text,
  address      text,
  permit_label text,
  permit_type  text,
  current_dm   text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.da,
         pr.address,
         COALESCE(p.num, '(' || COALESCE(p.type, 'no type') || ')'),
         p.type,
         p.dm
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   WHERE pr.tenant_id = ANY (public.auth_tenant_ids())
     AND p.actual_issue IS NULL
     AND p.type IS DISTINCT FROM 'ULS'
     AND NULLIF(btrim(COALESCE(p.da, '')), '') IS NOT NULL
     AND public.bp_dm_for_da(p.da, p.tenant_id) IS NULL
   ORDER BY 1, 2, 3;
$$;

COMMENT ON FUNCTION public.bp_dm_gap_report() IS
  'fix-379: unissued non-ULS permits whose DA has no dm_da_groups row, so the DM derivation resolves to nobody. Cam and Shire by design (fix-368 covers their tasks); anyone else appearing here is a mapping worth adding.';

REVOKE ALL ON FUNCTION public.bp_lead_drift_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_lead_drift_report() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_dm_gap_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_dm_gap_report() TO authenticated, service_role;
