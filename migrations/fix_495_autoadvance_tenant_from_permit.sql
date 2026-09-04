-- fix-495 (2026-09-04): bp_apply_cycle_autoadvance stamps tenant_id from the
-- parent permit instead of relying on the permit_cycles_default_tenant trigger,
-- which derives it from auth.uid() and therefore yields NULL for the scraper
-- (service_role, no JWT) -> NOT NULL violation -> PostgREST 400. First flagged
-- run 33902013109 (2026-09-04 17:42Z): 7 of 7 autoadvance calls failed this way.
-- Invariant verified on prod before this change: 0 permit_cycles rows disagree
-- with their permit's tenant_id; permits.tenant_id never null; one tenant.
-- Signature unchanged; the v1 editor path is unaffected (same tenant either way).
-- APPLIED TO PROD BY COWORK 2026-09-04 (apply_migration
-- fix_495_autoadvance_tenant_from_permit); dry-run in a rolled-back DO block
-- returned rows_affected=1 with tenant stamped for permit 248 cycle 3.
CREATE OR REPLACE FUNCTION public.bp_apply_cycle_autoadvance(p_permit_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r         RECORD;
  v_rows    integer;
  v_created integer := 0;
  v_tenant  uuid;
BEGIN
  IF p_permit_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.permits WHERE id = p_permit_id;
  IF v_tenant IS NULL THEN
    -- No such permit (or a tenant-less row): nothing to advance.
    RETURN 0;
  END IF;

  FOR r IN
    SELECT pc.cycle_index + 1 AS next_index,
           CASE
             WHEN pc.cycle_index = 0  THEN pc.intake_accepted
             WHEN pc.cycle_index >= 1 THEN pc.resubmitted
           END AS trigger_date
    FROM public.permit_cycles pc
    WHERE pc.permit_id = p_permit_id
      AND ((pc.cycle_index = 0  AND pc.intake_accepted IS NOT NULL)
        OR (pc.cycle_index >= 1 AND pc.resubmitted    IS NOT NULL))
    ORDER BY pc.cycle_index
  LOOP
    INSERT INTO public.permit_cycles (permit_id, cycle_index, submitted, tenant_id)
    VALUES (p_permit_id, r.next_index, r.trigger_date, v_tenant)
    ON CONFLICT (permit_id, cycle_index) DO UPDATE
      SET submitted = EXCLUDED.submitted
      WHERE public.permit_cycles.submitted IS NULL
        AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created := v_created + v_rows;
  END LOOP;

  RETURN v_created;
END;
$function$;
