-- ===========================================================================
-- fix-517 §E — `parent_permit_id` joins the atomic project+permits save
-- ===========================================================================
--
-- WHY. fix-194's sub-permit marker (`permits.parent_permit_id`) had exactly
-- ONE editor in the app: `QuickEditPermitModal`. fix-517 §E deletes that modal
-- — it and fix-514's Project Details → Permits tab were editing the same six
-- fields, the third instance of that shape in one week — and the Permits tab
-- lacked this one field. Without this patch the field would become
-- uneditable: a mis-linked placeholder is excluded from Schedule Health,
-- corrections counts, reviewer rollups, on-track % and volume attribution
-- with no way back. 3 of 685 prod permits are sub-permits.
--
-- HOW. PATCHED BY ANCHOR ON THE LIVE DEFINITION, never retyped. `migrations/`
-- is partial and prod is ahead of it, so the source of truth is
-- `pg_get_functiondef` — retyping the body would silently revert whatever
-- landed since the last file. Same pattern as fix-425.
--
-- VALIDATION IS SERVER-SIDE, not only in the picker. The value is resolved
-- through a lookup that requires the parent to be (a) on THIS project,
-- (b) not the row itself, and (c) not already a sub-permit — fix-194's own
-- three rules. Anything else resolves to NULL, i.e. "not a sub-permit", which
-- is the safe direction: the marker can always be removed, never wrongly
-- added.
--
-- The INSERT branch is deliberately untouched. A permit being created has no
-- id for a sibling to point at and cannot be a parent; the form only renders
-- the selector on saved rows.
-- ===========================================================================

DO $mig$
DECLARE
  v_def text;
  v_anchor text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'bp_update_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'bp_update_project_with_permits not found';
  END IF;

  IF position('parent_permit_id' in v_def) > 0 THEN
    RAISE NOTICE 'fix-517: already patched, nothing to do';
    RETURN;
  END IF;

  v_anchor := $a$          expected_issue = CASE WHEN v_elem ? 'expected_issue' THEN NULLIF(v_elem->>'expected_issue','')::date ELSE expected_issue END,$a$;

  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'fix-517: anchor not found in bp_update_project_with_permits';
  END IF;

  v_new := v_anchor || E'\n' || $b$          parent_permit_id = CASE WHEN v_elem ? 'parent_permit_id' THEN (
                             SELECT pp.id FROM public.permits pp
                              WHERE pp.id = NULLIF(v_elem->>'parent_permit_id','')::int
                                AND pp.project_id = p_project_id
                                AND pp.id <> (v_elem->>'id')::int
                                AND pp.parent_permit_id IS NULL
                           ) ELSE parent_permit_id END,$b$;

  v_def := replace(v_def, v_anchor, v_new);
  EXECUTE v_def;
  RAISE NOTICE 'fix-517: bp_update_project_with_permits patched';
END
$mig$;
