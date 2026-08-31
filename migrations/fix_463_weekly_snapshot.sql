-- ===========================================================================
-- fix-463 §A — THE WEEKLY SNAPSHOT'S FIVE BUCKETS (P-108)
-- ===========================================================================
--
-- ★★★ A NARROW READ OF ITS OWN, DELIBERATELY. `bp_list_tasks` already ships
-- ~1.2 MB per refetch and is the app's hottest path; bolting five permit
-- aggregates onto it — or onto anything else that already loads the whole
-- tenant — would make every board pay for a report six people read once a week.
-- This returns only the rows the five sections render, and only the eight
-- columns the mock-up shows.
--
-- MEASURED ON PROD 2026-08-30 AND RE-DERIVED 2026-08-31 (0a — every number
-- matched the brief exactly):
--   269 live permits (actual_issue null, status not withdrawn/cancelled)
--     A  intake due in next 14 days ........  4
--     B  intake past due, not submitted .... 101
--     C  submitted, intake fee not paid ....  17   ← cycle 0
--     D  in corrections > 7 days ...........  30
--     E  approved but not issued ...........  56
--
-- ---------------------------------------------------------------------------
-- ★★★ C IS A CYCLE-0 FACT, AND THIS IS THE TRAP THE TICKET WARNS ABOUT
-- ---------------------------------------------------------------------------
-- Read off the LATEST cycle, C returns **179 of 269** — two-thirds of the
-- pipeline, which is the tell that a definition is broken rather than a finding.
-- Reproduced exactly on prod before writing this.
--
-- The intake fee is paid ONCE, at first submission. So the question is only ever
-- about cycle 0: 121 live permits have a cycle-0 submission, **104 carry an
-- intake date and 17 do not**. A later correction cycle has a `submitted` and no
-- `intake_accepted` because there is no second fee to pay — reading it as an
-- unpaid fee turns normal resubmission into an alarm on 162 extra permits.
-- fix-437 established that Seattle's "Intake Accepted" IS the fee's paid date.
--
-- ★ D is the mirror image and DOES use the latest cycle, because "still in
--   corrections" is a fact about the round in flight, not about the first one.
--   The two live side by side here so the difference is impossible to miss.
--
-- ---------------------------------------------------------------------------
-- ★★ B IS A BACKLOG, NOT A WEEK'S NEWS — AND THE RPC RETURNS ALL OF IT ANYWAY
-- ---------------------------------------------------------------------------
-- Only 13 of 101 are within 30 days; 88 are over a month, 52 over three months,
-- 8 over a year (oldest target 2023-08-01). The CLIENT shows the recent ones and
-- states the rest as a number — the mock-up's decision, and the brief's
-- instruction not to dump 101 rows into a modal. The RPC still returns them,
-- because the section's search must be able to find a two-year-old permit and
-- because a count the reader cannot drill into is a rumour.
--
-- ★ SECURITY DEFINER + tenant filter, matching every other bp_ read. STABLE:
--   it writes nothing.

create or replace function public.bp_weekly_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_today   date;
  v_result  jsonb;
BEGIN
  -- ★★ TODAY IN PACIFIC, not in UTC. The server runs UTC, so at 5pm Pacific
  --    `current_date` is already tomorrow — and "due in the next 14 days" would
  --    silently shift a day every evening. fix-433's lesson, applied to the
  --    read side.
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;

  WITH live AS (
    SELECT p.*
      FROM public.permits p
     WHERE p.tenant_id = ANY (v_tenants)
       AND p.actual_issue IS NULL
       AND COALESCE(p.status, '') NOT ILIKE '%withdraw%'
       AND COALESCE(p.status, '') NOT ILIKE '%cancel%'
  ),
  -- ★★★ CYCLE 0 — the first submission, and the only one an intake fee attaches
  --     to. See the header.
  c0 AS (
    SELECT permit_id, submitted, intake_accepted
      FROM public.permit_cycles
     WHERE cycle_index = 0
  ),
  -- ★ The round in flight, for D only.
  latest AS (
    SELECT DISTINCT ON (permit_id)
           permit_id, cycle_index, corr_issued, resubmitted
      FROM public.permit_cycles
     WHERE cycle_index >= 1
     ORDER BY permit_id, cycle_index DESC
  ),
  rows AS (
    -- A — intake due in the next 14 days
    SELECT 'a' AS bucket, l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit AS on_date,
           (l.target_submit - v_today) AS age_days
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
     WHERE l.target_submit BETWEEN v_today AND v_today + 14

    UNION ALL
    -- B — intake past due, still not submitted (cycle 0 never went in)
    SELECT 'b', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit,
           (v_today - l.target_submit)
      FROM live l
      JOIN public.projects pr ON pr.id = l.project_id
      LEFT JOIN c0 ON c0.permit_id = l.id
     WHERE l.target_submit < v_today
       AND c0.submitted IS NULL

    UNION ALL
    -- C — submitted, intake fee not paid. CYCLE 0. See the header.
    SELECT 'c', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, c0.submitted,
           (v_today - c0.submitted)
      FROM live l
      JOIN public.projects pr ON pr.id = l.project_id
      JOIN c0 ON c0.permit_id = l.id
     WHERE c0.submitted IS NOT NULL
       AND c0.intake_accepted IS NULL

    UNION ALL
    -- D — in corrections more than 7 days. LATEST cycle, deliberately.
    SELECT 'd', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, x.corr_issued,
           (v_today - x.corr_issued)
      FROM live l
      JOIN public.projects pr ON pr.id = l.project_id
      JOIN latest x ON x.permit_id = l.id
     WHERE x.corr_issued IS NOT NULL
       AND x.resubmitted IS NULL
       AND x.corr_issued < v_today - 7

    UNION ALL
    -- E — approved but not issued
    SELECT 'e', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.approval_date,
           (v_today - l.approval_date)
      FROM live l JOIN public.projects pr ON pr.id = l.project_id
     WHERE l.approval_date IS NOT NULL
  )
  SELECT jsonb_build_object(
           'today', v_today,
           'rows', COALESCE(jsonb_agg(
             jsonb_build_object(
               'bucket',     r.bucket,
               'permit_id',  r.id,
               'project_id', r.project_id,
               'address',    r.address,
               'num',        r.num,
               'type',       r.type,
               'ent_lead',   r.ent_lead,
               'da',         r.da,
               'status',     r.status,
               'on_date',    r.on_date,
               'age_days',   r.age_days
             )
             -- ★ Most urgent first within each bucket: the oldest thing is the
             --   one somebody has been waiting longest for. The client re-sorts
             --   on any column, but the DEFAULT order is the one the meeting
             --   wants.
             ORDER BY r.bucket, r.age_days DESC, r.address
           ), '[]'::jsonb)
         )
    INTO v_result
    FROM rows r;

  RETURN COALESCE(v_result, jsonb_build_object('today', v_today, 'rows', '[]'::jsonb));
END;
$function$;

comment on function public.bp_weekly_snapshot() is
  'fix-463 (P-108): the Weekly Update''s five permit buckets, as one narrow '
  'read. NOT part of bp_list_tasks — that already ships ~1.2 MB per refetch and '
  'every board would pay for a weekly report. Bucket C is a CYCLE-0 fact (the '
  'intake fee is paid once, at first submission); reading it off the latest '
  'cycle returns 179 of 269 instead of 17.';

revoke all on function public.bp_weekly_snapshot() from public, anon;
grant execute on function public.bp_weekly_snapshot() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select key, count(*) from (
--   select r->>'bucket' as key from jsonb_array_elements(
--     (public.bp_weekly_snapshot())->'rows') r) x group by key order by key;
--   -- a 4 · b 101 · c 17 · d 30 · e 56
