-- ===========================================================================
-- fix-513 §C (P-182) — THE AGENDA DROPS AN INTAKE THAT HAS ALREADY BEEN ACCEPTED
-- ===========================================================================
--
-- Bobby, 2026-09-09: *"the intake date in the next 14 days was showing
-- 2450 3rd Ave West, but it shows it was submitted and the intake was accepted.
-- So it should no longer show that as an intake due in the next 14 days…"*
--
-- ---------------------------------------------------------------------------
-- ★★★ WHAT THE SECTION ACTUALLY WINDOWS ON, CONFIRMED BEFORE TOUCHING IT
-- ---------------------------------------------------------------------------
-- §C asked for this to be checked rather than assumed, and it holds: bucket
-- `a` reads **`l.target_submit BETWEEN v_today AND v_today + 14`**. It has
-- never read `intake_date`. Two independent confirmations:
--
--   · the live function text, below, unchanged from `pg_get_functiondef`;
--   · the section's OWN column header in `lib/weeklySnapshot` is already
--     `dateLabel: 'Target submit'` — the title says Intake, the column says
--     Target submit, and they have disagreed since fix-463.
--
-- ★ And the prod counts settle it: permits with `intake_date` in
--   [today, today+14] = **0**. If the section read `intake_date` it would be
--   empty, and it is not.
--
-- ⏸ **THE TITLE IS NOT RENAMED. Bobby ruled: not in this PR.** So the
--   label/column mismatch survives on purpose. Banked as its own problem.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE PREDICATE IS A NAMED FUNCTION, NOT AN INLINE CLAUSE
-- ---------------------------------------------------------------------------
-- §C's instruction is *"the same helper from §A, not a second copy of the
-- rule."* SQL cannot call the TypeScript one, so this is the repo's existing
-- answer to that shape — the `isPermitInCorrections` ⇄ `bp_permit_in_corrections`
-- twin: ONE definition per language, named the same, and a test that holds them
-- in lockstep over a shared table of cases
-- (`src/__tests__/IntakeIsAcceptedFix513.test.ts`).
--
-- ★ It is a function rather than four words in a WHERE clause because
--   [[P-180-seattle-intakes-need-a-72-business-hour-warning]] needs the same
--   predicate next, and the second inline copy is the one that drifts.
--
-- ★★ `v_today` in `bp_weekly_snapshot` is already
--    `(now() AT TIME ZONE 'America/Los_Angeles')::date` — a local CALENDAR
--    date, matching the client's `todayIso()` from `lib/dateUtils`. The
--    predicate takes it as a parameter rather than reading a clock of its own,
--    so the whole report is computed against one instant.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES ON PROD, MEASURED 2026-09-09 (READ-ONLY, BEFORE APPLYING)
-- ---------------------------------------------------------------------------
-- Bucket A holds 8 rows. THREE LEAVE, all with a past `intake_date`:
--
--   322    4000 SW Concord St   Demolition  7138854-DM  intake 2026-06-16
--   10151  2450 3rd Ave W       Demolition  7149053-DM  intake 2026-07-06
--   10150  2450 3rd Ave W       Building    7149052-CN  intake 2026-08-25  ← Bobby's
--
-- FIVE STAY: 270 / 10408 / 10385 have no `intake_date` at all; 10404
-- (2027-01-26) and 10381 (2026-12-03) have a FUTURE one, which under §A's
-- ruling is not an acceptance. They do not move to another section and they do
-- not get a new grouping.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Re-run this file with the `WHERE` clause of bucket `a` reduced to
--   `WHERE l.target_submit BETWEEN v_today AND v_today + 14`
-- and drop `public.bp_intake_is_accepted(date, date)`. Nothing here writes a
-- row; both objects are STABLE reads.

-- ---------------------------------------------------------------------------
-- 1. The predicate, as one SQL definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_intake_is_accepted(
  p_intake_date date,
  p_today       date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ★★★ DATE ONLY. Bobby's ruling, 2026-09-09: accepted means the intake date
  -- has ARRIVED. Status does not corroborate it — status vocabulary is
  -- jurisdiction-specific and drifts, the date is a fact.
  --
  -- ★★ The ruling was taken against a measured counterexample set: 19 permits
  -- carry a PAST intake_date beside a status saying intake has not happened.
  -- That is a DATA problem, and a status check here would hide nineteen bad
  -- rows behind a predicate instead of correcting them.
  SELECT p_intake_date IS NOT NULL AND p_intake_date <= p_today;
$function$;

COMMENT ON FUNCTION public.bp_intake_is_accepted(date, date) IS
  'fix-513 §A (P-208). SQL twin of intakeIsAccepted() in src/lib/targetApproval.ts. Date only, by ruling. Held in lockstep by src/__tests__/IntakeIsAcceptedFix513.test.ts.';

-- ---------------------------------------------------------------------------
-- 2. Bucket A gains the predicate. Everything else is byte-identical to the
--    live definition read from pg_get_functiondef on 2026-09-09.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_weekly_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_today   date;
  v_result  jsonb;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;

  WITH live AS (
    SELECT p.*
      FROM public.permits p
     WHERE p.tenant_id = ANY (v_tenants)
       AND p.actual_issue IS NULL
       AND COALESCE(p.status, '') NOT ILIKE '%withdraw%'
       AND COALESCE(p.status, '') NOT ILIKE '%cancel%'
  ),
  c0 AS (
    SELECT permit_id, submitted, intake_accepted
      FROM public.permit_cycles WHERE cycle_index = 0
  ),
  latest AS (
    SELECT DISTINCT ON (permit_id) permit_id, cycle_index, corr_issued, resubmitted
      FROM public.permit_cycles WHERE cycle_index >= 1
     ORDER BY permit_id, cycle_index DESC
  ),
  rows AS (
    SELECT 'a' AS bucket, l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit AS on_date, (l.target_submit - v_today) AS age_days
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
     WHERE l.target_submit BETWEEN v_today AND v_today + 14
       -- ★★★ fix-513 §C (P-182): an intake that has ALREADY been accepted is
       -- not an intake due in the next 14 days. Same predicate as the Overview
       -- Dates card, one definition per language.
       AND NOT public.bp_intake_is_accepted(l.intake_date, v_today)
    UNION ALL
    SELECT 'b', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit, (v_today - l.target_submit)
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
      LEFT JOIN c0 ON c0.permit_id = l.id
     WHERE l.target_submit < v_today AND c0.submitted IS NULL
    UNION ALL
    SELECT 'c', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, c0.submitted, (v_today - c0.submitted)
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
      JOIN c0 ON c0.permit_id = l.id
     WHERE c0.submitted IS NOT NULL AND c0.intake_accepted IS NULL
    UNION ALL
    SELECT 'd', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, x.corr_issued, (v_today - x.corr_issued)
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
      JOIN latest x ON x.permit_id = l.id
     WHERE x.corr_issued IS NOT NULL AND x.resubmitted IS NULL
       AND x.corr_issued < v_today - 7
    UNION ALL
    SELECT 'e', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.approval_date, (v_today - l.approval_date)
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
     WHERE l.approval_date IS NOT NULL
  )
  SELECT jsonb_build_object(
           'today', v_today,
           'rows', COALESCE(jsonb_agg(
             jsonb_build_object(
               'bucket', r.bucket, 'permit_id', r.id, 'project_id', r.project_id,
               'address', r.address, 'num', r.num, 'type', r.type,
               'ent_lead', r.ent_lead, 'da', r.da, 'status', r.status,
               'on_date', r.on_date, 'age_days', r.age_days
             ) ORDER BY r.bucket, r.age_days DESC, r.address
           ), '[]'::jsonb)
         )
    INTO v_result FROM rows r;

  RETURN COALESCE(v_result, jsonb_build_object('today', v_today, 'rows', '[]'::jsonb));
END;
$function$;
