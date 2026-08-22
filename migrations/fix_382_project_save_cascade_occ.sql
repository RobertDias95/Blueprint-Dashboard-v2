-- ===========================================================================
-- fix-382 — the project save collides with its own cascade
-- ===========================================================================
--
-- ★★★ THE BUG. bp_update_project_with_permits runs, in ONE transaction:
--
--   step 1  UPDATE projects SET entitlement_lead = …
--             → fires projects_cascade_lead (fix-377)
--             → UPDATEs this project's unissued permits
--             → permits_set_updated_at sets permits.updated_at = now()
--
--   step 2  UPDATE permits … WHERE updated_at = <the client's expected value>
--             → 0 rows → RAISE 'occ_conflict'
--
-- The expectation tested in step 2 was measured by the client BEFORE the save;
-- step 1 has just invalidated it. The function raises a conflict against its
-- OWN writes. Bobby hit it changing 4412 Evanston Ave N's entitlement lead
-- from Miles to Briana — "This project was modified elsewhere" with nobody
-- else editing. And it fires EVERY time, because ProjectSettingsModal pushes
-- every existing permit row into p_permit_upserts, not only the edited ones.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE FIX: VALIDATE AND LOCK BEFORE WRITING, NOT AFTER.
-- ---------------------------------------------------------------------------
--
-- A new step 0 runs before ANY write in this function:
--
--   a) lock the project row  (SELECT … FOR UPDATE)
--   b) for every existing permit in p_permit_upserts, lock the row and compare
--      its updated_at to the client's expected_updated_at — RAISE 'occ_conflict'
--      on any mismatch.
--
-- Because nothing has been written yet, the value read in (b) IS the row as it
-- stood before this transaction touched anything. That is precisely the value
-- the client's expectation is a claim about, so the comparison finally asks the
-- right question: "did somebody else write this row since the client read it?"
-- rather than "does this row still look untouched after I touched it?"
--
-- The permit UPDATE in step 2 then drops its `updated_at = …` predicate — the
-- expectation has already been checked, and the row is held under FOR UPDATE
-- so nothing can change it in between.
--
-- ★★★ WHY A REAL CONCURRENT EDIT STILL FAILS LOUDLY — the constraint that must
-- not break. The OCC check is not removed or relaxed; it MOVED EARLIER, and it
-- got strictly stronger, because FOR UPDATE closes the window the old check
-- left open. Three cases, all still conflict:
--
--   1. Third party committed BEFORE our step 0 → step 0 reads their newer
--      updated_at, which differs from the client's expected → conflict.
--   2. Third party's transaction is IN FLIGHT holding the row lock → our
--      SELECT … FOR UPDATE BLOCKS until they commit, then (READ COMMITTED)
--      re-reads the latest version → newer updated_at → conflict. The OLD code
--      could race here; this cannot.
--   3. Third party arrives AFTER step 0 → they block on our lock until we
--      commit, and their own OCC check then fails on their side.
--
-- The only writes step 0 tolerates are the ones this transaction makes itself,
-- AFTER its expectations were checked — which is the brief's distinction
-- exactly: a change made by THIS transaction is not "somebody else".
--
-- ---------------------------------------------------------------------------
-- ★★★ AND A SECOND DEFECT THE CRASH WAS HIDING: THE CASCADE WAS BEING UNDONE.
-- ---------------------------------------------------------------------------
--
-- Fixing the OCC alone makes the save succeed — and then silently throw away
-- fix-377's whole point. PROD PROBE A (below) proved it: with only step 0 in
-- place, 4412 Evanston Ave N ended the transaction with
--
--   projects.entitlement_lead = Briana      but all 3 permits = Miles
--
-- Because the ORIGINAL order patches the project first: the cascade sets the
-- permits to Briana, and then the permit loop — replaying the client's
-- payload, which still carries the OLD ent_lead, because the user edited the
-- project lead and never touched a permit row — writes Miles straight back
-- over it. Nobody had ever seen this, because the function always aborted on
-- the false conflict before finishing.
--
-- ★★★ So the permit writes now run BEFORE the project patch, and the cascade
-- gets the LAST WORD. This is safe only because step 0 has already settled
-- every OCC question, which is what made the order free to choose.
--
-- ★★ PROOF THE CASCADE STILL LANDS CORRECTLY (the brief's demand for this
-- route). fix-377's rule is
--   WHERE actual_issue IS NULL AND lower(btrim(ent_lead)) = lower(OLD lead).
-- Running the permit writes first does not change what that matches, because
-- the client's payload restates the ent_lead it read:
--   · untouched permit → still the OLD lead when the cascade runs → renamed ✓
--   · permit the user deliberately reassigned in this same save → holds the
--     NEW third-party name → does not match → keeps that person ✓ (fix-377's
--     "a permit deliberately assigned elsewhere keeps that person")
--   · issued permit → excluded by actual_issue IS NULL, as always ✓
--   · brand-new permit created in this same save and filed under the outgoing
--     lead → unissued and matching, so it moves too, which is the same answer
--     the project's other unissued permits get ✓
-- Verified end-to-end by PROD PROBE B.
--
-- ★★ Reordering does NOT reintroduce a lock-order hazard, because step 0 has
-- already taken every lock, parent before children, before any write.
--
-- ★★ Nothing reachable from a permits write touches public.projects (checked
-- across every trigger on permits and the functions they call), so moving the
-- permit writes earlier cannot disturb the project's own OCC predicate.
--
-- ---------------------------------------------------------------------------
-- ★★ ONE MORE ALTERNATIVE CONSIDERED AND REJECTED
-- ---------------------------------------------------------------------------
--
-- • "Accept a row whose updated_at = transaction_timestamp(), since we wrote
--   it." UNSAFE — it is a silent lost update. Client reads permit at T0; a
--   third party edits it at T1; our cascade then stamps it T2. The rule sees
--   T2 = our transaction stamp, accepts, and overwrites the T1 edit with no
--   conflict at all. It trades a visible false alarm for an invisible data
--   loss, which the brief rules out. (bp_set_updated_at uses now(), so this
--   test would have "worked" — that is what makes it dangerous.)
--
-- ★★ LOCK ORDER. Step 0 takes the project row first, then the permits — the
-- same parent→child order projects_cascade_lead itself takes. Two concurrent
-- callers therefore queue instead of deadlocking.
--
-- ★ THE RETURNED updated_at values are re-read after every write, so the
-- client's next save carries expectations that match the cascade's final
-- stamp rather than the permit loop's intermediate one.
--
-- ★ NOT CHANGED, deliberately:
--   · the cascade still bumps permits.updated_at — the audit trail depends on it
--   · the client still sends every permit row — hiding the bug is not fixing it
--   · fix-379's permits_derive_dm is a BEFORE trigger that edits NEW in place
--     and issues no second UPDATE, so the permit loop has no self-collision
--   · no row is edited by this migration; it replaces a function only
--
-- Based on the LIVE pg_get_functiondef from prod (eibnmwthkcuumyclyxoe), not
-- on any committed .sql — migrations/ is partial and prod is ahead.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.bp_update_project_with_permits(
  p_project_id uuid,
  p_project_expected_updated_at timestamp with time zone,
  p_project_patch jsonb,
  p_permit_upserts jsonb,
  p_permit_deletes integer[]
)
RETURNS TABLE(
  out_conflict boolean,
  out_conflict_kind text,
  out_conflict_id text,
  out_project_updated_at timestamp with time zone,
  out_permits jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant       uuid;
  v_patch        jsonb := COALESCE(p_project_patch, '{}'::jsonb);
  v_upserts      jsonb := COALESCE(p_permit_upserts, '[]'::jsonb);
  v_deletes      integer[] := COALESCE(p_permit_deletes, ARRAY[]::integer[]);
  v_rows         integer;
  v_proj_ua      timestamptz;
  v_permits_out  jsonb := '[]'::jsonb;
  v_elem         jsonb;
  v_pid          integer;
  v_permit_ids   integer[] := ARRAY[]::integer[];  -- ★ fix-382: touched, in order
  v_pre_ua       timestamptz;   -- ★ fix-382: the row as it stood pre-write
  v_ptype        text;
  v_del          integer;
  v_occ          boolean := false;
  v_kind         text;
  v_cid          text;
  v_product_types text[];
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'p_project_id is required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.projects WHERE id = p_project_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (v_tenant = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_update_project_with_permits: tenant % not in caller scope', v_tenant
      USING ERRCODE = '42501';
  END IF;

  IF v_patch ? 'product_types' AND jsonb_typeof(v_patch->'product_types') = 'array' THEN
    SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
    INTO v_product_types
    FROM jsonb_array_elements_text(v_patch->'product_types') AS value
    WHERE NULLIF(value, '') IS NOT NULL;
  ELSE
    v_product_types := ARRAY[]::text[];
  END IF;

  BEGIN
    -- =====================================================================
    -- ★★★ fix-382 STEP 0 — check every expectation BEFORE anything writes.
    -- =====================================================================
    -- Parent first, then children: the same order projects_cascade_lead
    -- takes, so two concurrent savers queue rather than deadlock.
    PERFORM 1 FROM public.projects WHERE id = p_project_id FOR UPDATE;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_upserts)
    LOOP
      IF v_elem ? 'id' AND NULLIF(v_elem->>'id','') IS NOT NULL THEN
        SELECT updated_at INTO v_pre_ua
        FROM public.permits
        WHERE id = (v_elem->>'id')::int
          AND project_id = p_project_id
        FOR UPDATE;

        -- NOT FOUND covers a deleted permit and an id belonging to another
        -- project — both were 'permit' conflicts under the old predicate too.
        -- A missing/NULL expected_updated_at stays a conflict, as before:
        -- v_pre_ua IS DISTINCT FROM NULL is true.
        IF NOT FOUND
           OR v_pre_ua IS DISTINCT FROM (v_elem->>'expected_updated_at')::timestamptz
        THEN
          v_occ := true; v_kind := 'permit'; v_cid := v_elem->>'id';
          RAISE EXCEPTION 'occ_conflict';
        END IF;
      END IF;
    END LOOP;

    -- =====================================================================
    -- ★★★ fix-382 STEP 1 — the permits, BEFORE the project patch, so that
    -- fix-377's cascade gets the last word instead of being overwritten by
    -- the client's restatement of the outgoing lead. Free to sit here only
    -- because step 0 already settled every OCC question.
    -- =====================================================================
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_upserts)
    LOOP
      IF v_elem ? 'id' AND NULLIF(v_elem->>'id','') IS NOT NULL THEN
        -- ★★★ fix-382: no `updated_at = expected` predicate here. Step 0
        -- already checked it against the pre-write row and still holds the
        -- FOR UPDATE lock, so this row cannot have moved under us — and the
        -- cascade's own bump, which used to fail this test, is ours.
        UPDATE public.permits SET
          type           = CASE WHEN v_elem ? 'type'           THEN NULLIF(v_elem->>'type','')            ELSE type END,
          ent_lead       = CASE WHEN v_elem ? 'ent_lead'       THEN NULLIF(v_elem->>'ent_lead','')        ELSE ent_lead END,
          da             = CASE WHEN v_elem ? 'da'             THEN NULLIF(v_elem->>'da','')              ELSE da END,
          portal_url     = CASE WHEN v_elem ? 'portal_url'     THEN NULLIF(v_elem->>'portal_url','')      ELSE portal_url END,
          num            = CASE WHEN v_elem ? 'num'            THEN NULLIF(v_elem->>'num','')             ELSE num END,
          struct_address = CASE WHEN v_elem ? 'struct_address' THEN NULLIF(v_elem->>'struct_address','')  ELSE struct_address END,
          expected_issue = CASE WHEN v_elem ? 'expected_issue' THEN NULLIF(v_elem->>'expected_issue','')::date ELSE expected_issue END,
          target_submit  = CASE WHEN v_elem ? 'target_submit'  THEN NULLIF(v_elem->>'target_submit','')::date  ELSE target_submit  END
        WHERE id = (v_elem->>'id')::int
          AND project_id = p_project_id
        RETURNING id INTO v_pid;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        -- Unreachable while the step-0 lock is held; kept as a backstop so a
        -- vanished row can never be reported as a silent success.
        IF v_rows = 0 THEN
          v_occ := true; v_kind := 'permit'; v_cid := v_elem->>'id';
          RAISE EXCEPTION 'occ_conflict';
        END IF;
        v_permit_ids := v_permit_ids || v_pid;
      ELSE
        v_ptype := NULLIF(v_elem->>'type','');
        IF v_ptype IS NULL THEN
          RAISE EXCEPTION 'new permit requires a non-empty type';
        END IF;
        INSERT INTO public.permits (
          tenant_id, project_id, type, ent_lead, da, portal_url, num,
          struct_address, expected_issue, target_submit, stage, status
        ) VALUES (
          v_tenant, p_project_id, v_ptype,
          NULLIF(v_elem->>'ent_lead',''),
          NULLIF(v_elem->>'da',''),
          NULLIF(v_elem->>'portal_url',''),
          NULLIF(v_elem->>'num',''),
          NULLIF(v_elem->>'struct_address',''),
          NULLIF(v_elem->>'expected_issue','')::date,
          NULLIF(v_elem->>'target_submit','')::date,
          'de', 'Pre-Submittal — GO'
        )
        RETURNING id INTO v_pid;

        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index)
        VALUES (v_tenant, v_pid, 0);

        v_permit_ids := v_permit_ids || v_pid;
      END IF;
    END LOOP;

    FOREACH v_del IN ARRAY v_deletes
    LOOP
      DELETE FROM public.permits WHERE id = v_del AND project_id = p_project_id;
    END LOOP;

    -- =====================================================================
    -- ★★★ fix-382 STEP 2 — the project patch. Its cascade now lands on the
    -- permits' FINAL values and is the last write to reach them.
    -- =====================================================================
    IF v_patch <> '{}'::jsonb THEN
      UPDATE public.projects SET
        address          = CASE WHEN v_patch ? 'address'          THEN NULLIF(v_patch->>'address','')             ELSE address END,
        juris            = CASE WHEN v_patch ? 'juris'             THEN NULLIF(v_patch->>'juris','')               ELSE juris END,
        acq_lead         = CASE WHEN v_patch ? 'acq_lead'          THEN NULLIF(v_patch->>'acq_lead','')            ELSE acq_lead END,
        notes            = CASE WHEN v_patch ? 'notes'             THEN v_patch->>'notes'                          ELSE notes END,
        archived         = CASE WHEN v_patch ? 'archived'          THEN (v_patch->>'archived')::boolean            ELSE archived END,
        go_date          = CASE WHEN v_patch ? 'go_date'           THEN NULLIF(v_patch->>'go_date','')::date        ELSE go_date END,
        units            = CASE WHEN v_patch ? 'units'             THEN NULLIF(v_patch->>'units','')::int           ELSE units END,
        zone             = CASE WHEN v_patch ? 'zone'              THEN NULLIF(v_patch->>'zone','')                 ELSE zone END,
        lot_width        = CASE WHEN v_patch ? 'lot_width'         THEN NULLIF(v_patch->>'lot_width','')::numeric    ELSE lot_width END,
        lot_depth        = CASE WHEN v_patch ? 'lot_depth'         THEN NULLIF(v_patch->>'lot_depth','')::numeric    ELSE lot_depth END,
        parking_type     = CASE WHEN v_patch ? 'parking_type'      THEN NULLIF(v_patch->>'parking_type','')         ELSE parking_type END,
        parking_stalls   = CASE WHEN v_patch ? 'parking_stalls'    THEN NULLIF(v_patch->>'parking_stalls','')::int   ELSE parking_stalls END,
        alley            = CASE WHEN v_patch ? 'alley'             THEN NULLIF(v_patch->>'alley','')                ELSE alley END,
        product_types    = CASE WHEN v_patch ? 'product_types'     THEN v_product_types                              ELSE product_types END,
        entitlement_lead = CASE WHEN v_patch ? 'entitlement_lead'  THEN NULLIF(v_patch->>'entitlement_lead','')     ELSE entitlement_lead END,
        design_manager   = CASE WHEN v_patch ? 'design_manager'    THEN NULLIF(v_patch->>'design_manager','')       ELSE design_manager END,
        builder_name     = CASE WHEN v_patch ? 'builder_name'      THEN NULLIF(v_patch->>'builder_name','')         ELSE builder_name END,
        builder_company  = CASE WHEN v_patch ? 'builder_company'   THEN NULLIF(v_patch->>'builder_company','')      ELSE builder_company END,
        builder_email    = CASE WHEN v_patch ? 'builder_email'     THEN NULLIF(v_patch->>'builder_email','')        ELSE builder_email END,
        builder_phone    = CASE WHEN v_patch ? 'builder_phone'     THEN NULLIF(v_patch->>'builder_phone','')        ELSE builder_phone END,
        builder_address  = CASE WHEN v_patch ? 'builder_address'   THEN NULLIF(v_patch->>'builder_address','')      ELSE builder_address END,
        poc_name         = CASE WHEN v_patch ? 'poc_name'          THEN NULLIF(v_patch->>'poc_name','')             ELSE poc_name END,
        poc_email        = CASE WHEN v_patch ? 'poc_email'         THEN NULLIF(v_patch->>'poc_email','')            ELSE poc_email END
      WHERE id = p_project_id
        AND updated_at = p_project_expected_updated_at;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        v_occ := true; v_kind := 'project'; v_cid := p_project_id::text;
        RAISE EXCEPTION 'occ_conflict';
      END IF;

      IF COALESCE(TRIM(v_patch->>'builder_name'), '') <> '' THEN
        INSERT INTO public.builders (name, company, email, phone, address, tenant_id)
        VALUES (
          TRIM(v_patch->>'builder_name'),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_company','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_email','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_phone','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_address','')), ''),
          v_tenant
        )
        ON CONFLICT (name, company) DO UPDATE
          SET address = COALESCE(EXCLUDED.address, public.builders.address);
      END IF;
    END IF;

    -- =====================================================================
    -- ★ fix-382 STEP 3 — hand back the FINAL updated_at of every permit we
    -- touched, read after the cascade rather than during the loop, so the
    -- client's next save cannot carry a stale expectation. Insertion order
    -- is preserved.
    -- =====================================================================
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('id', p.id, 'updated_at', p.updated_at)
                       ORDER BY a.ord),
             '[]'::jsonb)
    INTO v_permits_out
    FROM unnest(v_permit_ids) WITH ORDINALITY AS a(pid, ord)
    JOIN public.permits p ON p.id = a.pid;

    SELECT updated_at INTO v_proj_ua FROM public.projects WHERE id = p_project_id;

  EXCEPTION WHEN OTHERS THEN
    IF v_occ THEN
      out_conflict := true;
      out_conflict_kind := v_kind;
      out_conflict_id := v_cid;
      out_project_updated_at := NULL;
      out_permits := '[]'::jsonb;
      RETURN NEXT;
      RETURN;
    ELSE
      RAISE;
    END IF;
  END;

  out_conflict := false;
  out_conflict_kind := NULL;
  out_conflict_id := NULL;
  out_project_updated_at := v_proj_ua;
  out_permits := v_permits_out;
  RETURN NEXT;
END;
$function$;
