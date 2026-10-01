-- fix-614 (P-300 item 2): the estimate reacts to how many corrections the
-- city sent back.
--
-- ⚠️ STAGED, NOT APPLIED BY THE PR. Claude applies it from Cowork.
--    ADDITIVE ONLY: one new read-only function. The client treats a missing
--    function as "no signal" and projects exactly as before, so CI is green and
--    the app is unchanged until this lands.
--
-- bp_correction_odds() → jsonb, one call:
--   cells   — per (permit type × jurisdiction × bucket): resolved_rounds,
--             approved_next. History only; never borrowed across cities
--             (D-2026-05-20). The client turns a cell into the cautious
--             (80 % Wilson lower bound) chance.
--   permits — per not-yet-approved permit that has a correction round: its
--             latest round N and that round's correction count, NULL when no
--             letter for round N was parsed (UNKNOWN — never zero).
--
-- DEFINITIONS (measured on prod 2026-10-01; reproduce Cowork's 09-30 table —
-- 202 resolved rounds / 168 Seattle vs its 197 / 166, the gap is newer data):
--   round N        a review cycle N >= 1 that has corr_issued OR a parsed
--                  correction letter (correction_items.cycle = N). Cycle N of
--                  correction_items IS permit_cycles.cycle_index N: of 5,003
--                  dated items, 2,524 fall inside cycle N's own
--                  submitted→resubmitted window vs 81 in N+1's and 43 in N-1's.
--   count          correction_items with is_correction for (permit, N).
--   another round  a later cycle with corr_issued, or a later parsed letter.
--   approved next  no another-round AND the permit is approved
--                  (approval_date or actual_issue set).
--   resolved       another round OR approved next. Pending rounds excluded.
--   buckets        1 · 2–3 · 4–6 · 7–10 · 11+  (src/lib/correctionOdds.ts
--                  bucketFor is the twin; a test pins the thresholds).

BEGIN;

CREATE OR REPLACE FUNCTION public.bp_correction_odds()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scoped AS (
    SELECT p.id AS permit_id, p.type, pr.juris,
           (p.approval_date IS NOT NULL OR p.actual_issue IS NOT NULL) AS approved
      FROM public.permits p
      JOIN public.projects pr ON pr.id = p.project_id
     WHERE p.tenant_id = ANY (public.auth_tenant_ids())
  ),
  round_keys AS (
    SELECT pc.permit_id, pc.cycle_index AS n
      FROM public.permit_cycles pc
      JOIN scoped s ON s.permit_id = pc.permit_id
     WHERE pc.cycle_index >= 1 AND pc.corr_issued IS NOT NULL
    UNION
    SELECT ci.permit_id, ci.cycle
      FROM public.correction_items ci
      JOIN scoped s ON s.permit_id = ci.permit_id
     WHERE ci.cycle >= 1
  ),
  letters AS (
    SELECT ci.permit_id, ci.cycle AS n,
           count(*) FILTER (WHERE ci.is_correction) AS n_corr
      FROM public.correction_items ci
      JOIN scoped s ON s.permit_id = ci.permit_id
     WHERE ci.cycle >= 1
     GROUP BY 1, 2
  ),
  rounds AS (
    SELECT s.permit_id, s.type, s.juris, s.approved, k.n,
           l.n_corr,                                   -- NULL = no parsed letter
           EXISTS (SELECT 1 FROM round_keys k2
                    WHERE k2.permit_id = k.permit_id AND k2.n > k.n) AS another_round
      FROM round_keys k
      JOIN scoped s ON s.permit_id = k.permit_id
      LEFT JOIN letters l ON l.permit_id = k.permit_id AND l.n = k.n
  ),
  resolved AS (
    SELECT type, juris,
           CASE WHEN n_corr <= 1  THEN '1'
                WHEN n_corr <= 3  THEN '2-3'
                WHEN n_corr <= 6  THEN '4-6'
                WHEN n_corr <= 10 THEN '7-10'
                ELSE '11+' END AS bucket,
           (NOT another_round AND approved) AS approved_next
      FROM rounds
     WHERE n_corr IS NOT NULL
       AND (another_round OR approved)
  ),
  cells AS (
    SELECT type, juris, bucket,
           count(*)::int AS resolved_rounds,
           count(*) FILTER (WHERE approved_next)::int AS approved_next
      FROM resolved
     WHERE juris IS NOT NULL
     GROUP BY 1, 2, 3
  ),
  latest AS (
    SELECT DISTINCT ON (permit_id) permit_id, n, n_corr
      FROM rounds
     WHERE NOT approved
     ORDER BY permit_id, n DESC
  )
  SELECT jsonb_build_object(
    'cells', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'type', type, 'juris', juris, 'bucket', bucket,
                'resolved_rounds', resolved_rounds, 'approved_next', approved_next))
              FROM cells), '[]'::jsonb),
    'permits', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'permit_id', permit_id, 'round', n, 'correction_count', n_corr))
              FROM latest), '[]'::jsonb)
  );
$function$;

-- Never anon, never PUBLIC (fix-157). The client calls it as authenticated.
REVOKE ALL ON FUNCTION public.bp_correction_odds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_correction_odds() TO authenticated;

COMMIT;
