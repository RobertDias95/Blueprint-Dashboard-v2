-- fix-277 (2026-08-11): seed the Corrections report into saved_reports.
--
-- WHY THIS FILE EXISTS AT ALL
-- The Reporting hub lists from the public.saved_reports TABLE, not from the
-- code registry in src/lib/builtinReports.ts. fix-265 registered a builtin and
-- never seeded the row, so a finished report was reachable only by typing its
-- URL and Bobby could not find it; the fix-267 audit then found the same
-- omission had already happened once before. Registering `corrections` without
-- this migration would make it three.
--
-- Applied to production on 2026-08-11 by this migration (not by hand). It is
-- written to be a no-op wherever the row already exists, so re-running it —
-- including against prod — changes nothing.
--
-- IDEMPOTENT ON THREE AXES, copied from fix_267_seed_vendor_forecast_report.sql:
--   * per tenant     — only tenants that already have the builtin catalog
--   * per key        — skipped where this builtin_key already exists
--   * per category   — resolved by NAME; a tenant without that category still
--                      gets the row, uncategorised, rather than losing it
--                      (the hub lists uncategorised reports under "All")
--
-- POSITION 2, not 1. Pipeline/0 is Approved – Awaiting Issuance. Pipeline/1 is
-- deliberately left free: src/lib/builtinReports.ts records that phase_durations
-- (fix-253) is still missing its hub row and names Pipeline/1 as the slot to put
-- it in. Taking that slot here would silently invalidate that note.

BEGIN;

INSERT INTO public.saved_reports
  (tenant_id, category_id, name, description, kind, builtin_key, spec, position)
SELECT
  t.tenant_id,
  -- Resolve "Pipeline" within THAT tenant. NULL when absent — see above.
  (SELECT rc.id
     FROM public.report_categories rc
    WHERE rc.tenant_id = t.tenant_id
      AND rc.name = 'Pipeline'
    ORDER BY rc.position, rc.name
    LIMIT 1),
  'Corrections',
  'Every comment the cities have written on our correction letters, across all '
    || 'projects. Filter by jurisdiction, discipline, theme, cycle, architect or '
    || 'letter date; see how often a topic comes back the very next cycle, where '
    || 'the volume sits by theme and discipline, and drill into the individual '
    || 'comments. Read-only.',
  'builtin',
  'corrections',
  '{}'::jsonb,
  2
FROM (
  -- "Any tenant that has the builtin catalog": one that already holds at least
  -- one builtin saved_report. A tenant with no reports at all is a bare shell
  -- and is left alone.
  SELECT DISTINCT sr.tenant_id
  FROM public.saved_reports sr
  WHERE sr.kind = 'builtin'
) AS t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.saved_reports x
  WHERE x.tenant_id = t.tenant_id
    AND x.builtin_key = 'corrections'
);

COMMIT;
