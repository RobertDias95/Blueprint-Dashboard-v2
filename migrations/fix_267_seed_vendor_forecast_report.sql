-- fix-267 (2026-08-03): seed the vendor schedule forecast into saved_reports.
--
-- WHY
-- fix-265 registered `vendor_schedule_forecast` in src/lib/builtinReports.ts —
-- route + component — but never inserted the matching public.saved_reports row.
-- The Reporting hub lists from that TABLE, not from the code registry, so the
-- report existed, worked, and was reachable only by typing
-- /reports/vendor-forecast. Bobby could not find it.
--
-- The row was inserted into prod by hand on 2026-08-03. This migration exists so
-- a FRESH environment gets it too, and is written to be a no-op wherever the row
-- already exists — including prod, which is verified below.
--
-- SCOPE, deliberately narrow: this seeds ONE key. The fix-267 audit found that
-- `phase_durations` (fix-253) is missing its row as well — the same omission,
-- made earlier and never noticed. It is NOT seeded here: putting a new card in
-- the Reporting hub is a product call, not a migration's, and the PR body
-- carries the one-line SQL to do it if wanted. src/lib/builtinReports.ts now
-- records that gap explicitly (BUILTIN_REPORT_CATALOG.phase_durations = null)
-- and a test fails if a FUTURE builtin is registered with no catalog decision.
--
-- IDEMPOTENT ON THREE AXES:
--   * per tenant     — only tenants that already have the builtin catalog
--   * per key        — skipped where this builtin_key already exists
--   * per category   — resolved by NAME; a tenant without that category still
--                      gets the row, uncategorised, rather than losing it
--                      (the hub lists category_id IS NULL under "All").

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
  'Structural Schedule Forecast',
  'Weekly schedule forecast for the structural engineer: new projects, schedule '
    || 'changes, the running pipeline, and the corrections currently with them. '
    || 'Composes an Outlook draft; marking sent is a separate action.',
  'builtin',
  'vendor_schedule_forecast',
  '{}'::jsonb,
  2
FROM (
  -- "Any tenant that has the builtin catalog": one that already holds at least
  -- one builtin saved_report. A tenant with no reports at all is a bare shell
  -- and is left alone: seeding a lone card there would be noise, and whatever
  -- provisions that tenant's catalog should own the whole set.
  SELECT DISTINCT sr.tenant_id
  FROM public.saved_reports sr
  WHERE sr.kind = 'builtin'
) AS t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.saved_reports x
  WHERE x.tenant_id = t.tenant_id
    AND x.builtin_key = 'vendor_schedule_forecast'
);

COMMIT;
