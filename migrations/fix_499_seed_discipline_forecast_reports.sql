-- ===========================================================================
-- fix-499 (P-034) — seed the per-discipline forecasts + Waiting On
-- ===========================================================================
--
-- ★★★ NOT APPLIED BY THE AGENT. The brief is explicit: Cowork applies this to
--     prod on Bobby's yes, after the PR merges. It writes ONLY `saved_reports`
--     rows — no schema change, no data touched anywhere else.
--
-- WHY
-- fix-499 turned one report into seven: the discipline is now a `?discipline=`
-- parameter on `/reports/vendor-forecast`, and Waiting On became a report of
-- its own at `/reports/waiting-on`. The Reporting hub lists from THIS TABLE,
-- not from the code registry (fix-267's whole lesson: a builtin registered and
-- never seeded is a finished report nobody can find).
--
-- SCOPE, and it is a decision rather than an omission:
--   * `vendor_schedule_forecast` (Structural) already has its row — fix-267
--     seeded it. It is NOT re-inserted; its key, name and position are
--     unchanged, so it keeps the card everybody already knows.
--   * CIVIL and SURVEYOR are seeded, because they are the two disciplines with
--     open work. Measured on prod 2026-09-04, live rounds not yet Received:
--       Surveyor 46 · Civil 34 · Structural 40 · Arborist 16 · Energy 5 ·
--       Landscape 3 · Geotech 2
--   * ARBORIST, GEOTECH, ENERGY and LANDSCAPE are NOT seeded. They work, and
--     they are reachable by URL today (`?discipline=Arborist`). Putting four
--     more cards in Bobby's hub for two and three rows of work is the fix-267
--     failure inverted — a shelf nobody asked for. `builtinReports.ts` records
--     each as an explicit `null`, which is the same flag `phase_durations`
--     carries, and a test asserts this file and that list agree.
--   * WAITING ON is seeded, filed AFTER the forecasts (position 5) as Bobby
--     asked.
--
-- IDEMPOTENT ON THREE AXES, exactly as fix_267 is:
--   * per tenant     — only tenants that already have the builtin catalog
--   * per key        — skipped where this builtin_key already exists
--   * per category   — resolved by NAME; a tenant without that category still
--                      gets the row, uncategorised, rather than losing it
--                      (the hub lists category_id IS NULL under "All")
-- ===========================================================================

BEGIN;

INSERT INTO public.saved_reports
  (tenant_id, category_id, name, description, kind, builtin_key, spec, position)
SELECT
  t.tenant_id,
  -- Resolve "Weekly Updates" within THAT tenant. NULL when absent — see above.
  (SELECT rc.id
     FROM public.report_categories rc
    WHERE rc.tenant_id = t.tenant_id
      AND rc.name = 'Weekly Updates'
    ORDER BY rc.position, rc.name
    LIMIT 1),
  r.name,
  r.description,
  'builtin',
  r.builtin_key,
  '{}'::jsonb,
  r.position
FROM (
  -- "Any tenant that has the builtin catalog": one that already holds at least
  -- one builtin saved_report. A tenant with no reports at all is a bare shell
  -- and is left alone; whatever provisions its catalog should own the whole set.
  SELECT DISTINCT sr.tenant_id
  FROM public.saved_reports sr
  WHERE sr.kind = 'builtin'
) AS t
CROSS JOIN (
  VALUES
    (
      'forecast_civil',
      'Civil Schedule Forecast',
      'Weekly schedule forecast for the civil engineer: new projects, schedule '
        || 'changes, the running pipeline, what is currently with them, and the '
        || 'corrections in permitting. Rows come from the project''s civil '
        || 'consultant record and fall off when its round is marked Received. '
        || 'Composes an Outlook draft; marking sent is a separate action.',
      3
    ),
    (
      'forecast_surveyor',
      'Surveyor Schedule Forecast',
      'Weekly schedule forecast for the surveyor: new projects, schedule '
        || 'changes, the running pipeline, what is currently with them, and the '
        || 'corrections in permitting. Rows come from the project''s surveyor '
        || 'consultant record and fall off when its round is marked Received. '
        || 'Composes an Outlook draft; marking sent is a separate action.',
      4
    ),
    (
      'waiting_on',
      'Waiting On — what each firm owes us',
      'Every open task sitting with an outside firm, grouped by discipline then '
        || 'by firm, with each firm''s contact details and its own CSV. The '
        || 'mirror image of the schedule forecasts: they say what is coming to '
        || 'a firm, this says what is with one now.',
      5
    )
) AS r(builtin_key, name, description, position)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.saved_reports x
  WHERE x.tenant_id = t.tenant_id
    AND x.builtin_key = r.builtin_key
);

COMMIT;
