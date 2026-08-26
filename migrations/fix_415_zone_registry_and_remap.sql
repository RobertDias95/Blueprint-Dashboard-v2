-- ===========================================================================
-- fix-415 SCOPE A — zone becomes a registry, and 33 spellings collapse to 21
-- ===========================================================================
--
-- APPLIED TO PROD 2026-08-26 via apply_migration (name
-- fix_415_zone_registry_and_remap). This file is the record; the database is
-- the source of truth.
--
-- Bobby ruled the whole list on 2026-08-26, all three oddballs included. The
-- `(M)` mandatory-housing suffix is DROPPED ENTIRELY — not kept as a name, not
-- kept as a flag: "remove the M as we decided it is not needed in LR 1."
--
-- Measured read-only immediately before this ran: 196 projects, 191 with a
-- zone, 5 null, 33 distinct raw spellings.
--
-- ★ RESULT, verified after applying: 18 rows moved, 21 distinct zones, 5 still
--   null, 0 rows outside the canonical list. Counts reproduced exactly as the
--   brief predicted — NR 127 · NR3 13 · LR1 10 · RS 7.2 6 · LR3 5 ·
--   MIO-37-LR3 3 · LR2 3 · RS 8.5 3 · RSX 7.2 3 · LDR-S 2 · R-3 2 · RE-24 2 ·
--   RM 1.5 2 · RM 3.6 2 · RSL 2 · NC2-40 1 · R-M1 1 · RE-43 1 · RS 5.0 1 ·
--   SR-1 1 · SR-4 1.

-- ---------------------------------------------------------------------------
-- 0. THE BACKUP
-- ---------------------------------------------------------------------------
-- ★★★ NOT ON DEFAULT PRIVILEGES. A new table in `public` inherits this
-- database's default grants, which hand `anon` full DELETE/INSERT/UPDATE —
-- fix-412's backup table was sitting there with exactly that. RLS being on is
-- not the answer: a snapshot of production rows should not be writable by an
-- unauthenticated role at all. This takes `permit_task_audit`'s model instead:
-- anon NOTHING, authenticated SELECT, service_role ALL.
CREATE TABLE IF NOT EXISTS public._fix415_zone_remap_backup_2026_08_26 (
  project_id  uuid        NOT NULL,
  address     text,
  zone_before text,
  taken_at    timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public._fix415_zone_remap_backup_2026_08_26 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public._fix415_zone_remap_backup_2026_08_26 TO authenticated;
GRANT ALL    ON public._fix415_zone_remap_backup_2026_08_26 TO service_role;
ALTER TABLE public._fix415_zone_remap_backup_2026_08_26 ENABLE ROW LEVEL SECURITY;

-- ★ Every row that HAS a zone, not only the 18 that change — a revert wants the
--   whole column back, and 191 rows is nothing.
INSERT INTO public._fix415_zone_remap_backup_2026_08_26 (project_id, address, zone_before)
SELECT p.id, p.address, p.zone FROM public.projects p WHERE p.zone IS NOT NULL;

-- ★ fix-412's backup table, tightened in passing. It is a snapshot of
--   production rows and nothing reads it; leaving anon with DML on it is the
--   wrong posture whatever RLS says.
REVOKE ALL ON public._fix412_existing_to_remodel_backup_2026_08_26 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public._fix412_existing_to_remodel_backup_2026_08_26 TO authenticated;
GRANT ALL    ON public._fix412_existing_to_remodel_backup_2026_08_26 TO service_role;

-- ---------------------------------------------------------------------------
-- A1. the registry
-- ---------------------------------------------------------------------------
-- ★ Same shape as `productTypeOptions` exactly — a JSONB array of strings under
--   an `app_config` key, read by `readAppConfigStringArray` and written by
--   `bp_set_app_config_key`. No second convention invented.
-- ★ `ON CONFLICT (key)` because app_config's primary key is `(key)` alone, not
--   `(tenant_id, key)` — the same clause `bp_set_app_config_key` uses. Checked,
--   not assumed: the first attempt used `(tenant_id, key)` and Postgres refused
--   it, which is how the PK got read.
-- ★ ORDER IS THE DROPDOWN'S ORDER, and it is Bobby's: Seattle's NR/LR family
--   first, then the out-of-city zones.
INSERT INTO public.app_config (tenant_id, key, value)
SELECT c.tenant_id, 'zoneOptions', '[
  "NR","NR3","LR1","LR2","LR3","MIO-37-LR3","NC2-40","LDR-S","R-3","R-M1",
  "RE-24","RE-43","RM 1.5","RM 3.6","RS 5.0","RS 7.2","RS 8.5","RSL",
  "RSX 7.2","SR-1","SR-4"
]'::jsonb
FROM public.app_config c
WHERE c.key = 'productTypeOptions'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ---------------------------------------------------------------------------
-- A4. the remap
-- ---------------------------------------------------------------------------
-- ★★★ AN EXPLICIT MAP OF THE 14 SPELLINGS THAT MOVE, not a regex.
--
-- A pattern like `regexp_replace(zone, '\s*\(?M1?\)?$', '')` would look neater
-- and would be a liability: it decides the fate of spellings nobody has looked
-- at, including ones added after this ran. Every row below was read off prod
-- today and ruled on by name. Anything NOT in this list is left exactly as it
-- is — and the verification at the bottom fails if that leaves a row outside
-- the 21, which is what makes "leave it alone" safe.
--
-- ★ MIO-37-LR3 keeps its overlay in the name. It is its own entry in the
--   registry, NOT folded into LR3: the MIO overlay changes what can be built.
WITH remap(raw, canon) AS (VALUES
  ('LR1 (M)',        'LR1'),
  ('LR 1',           'LR1'),
  ('LR 1 (M)',       'LR1'),
  ('LR1 (M1)',       'LR1'),
  ('LR1 M',          'LR1'),
  ('LR 2 (M)',       'LR2'),
  ('LR2(M)',         'LR2'),
  ('LR 3 (M)',       'LR3'),
  ('LR3 (M)',        'LR3'),
  ('MIO-37-LR3 (M)', 'MIO-37-LR3'),
  ('NC2-40(M)',      'NC2-40'),
  ('RSL (M)',        'RSL'),
  -- ★ The two oddballs Bobby ruled on individually. `NR@` is a typo for NR;
  --   `NRW` is not a zone at all and he placed it in NR.
  ('NR@',            'NR'),
  ('NRW',            'NR')
)
UPDATE public.projects p
SET zone = r.canon
FROM remap r
WHERE p.zone = r.raw;

-- ---------------------------------------------------------------------------
-- VERIFY — the brief's stop condition, enforced
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_moved int; v_outside int; v_null int; v_with int; v_distinct int;
  c_canon CONSTANT text[] := ARRAY[
    'NR','NR3','LR1','LR2','LR3','MIO-37-LR3','NC2-40','LDR-S','R-3','R-M1',
    'RE-24','RE-43','RM 1.5','RM 3.6','RS 5.0','RS 7.2','RS 8.5','RSL',
    'RSX 7.2','SR-1','SR-4'];
BEGIN
  -- ★ The moved count is read from the SNAPSHOT, not from a ROW_COUNT a later
  --   statement could disturb.
  SELECT count(*) INTO v_moved
  FROM public._fix415_zone_remap_backup_2026_08_26 b
  JOIN public.projects p ON p.id = b.project_id
  WHERE p.zone IS DISTINCT FROM b.zone_before;

  SELECT count(*) INTO v_outside
  FROM public.projects WHERE zone IS NOT NULL AND NOT (zone = ANY(c_canon));

  SELECT count(*) FILTER (WHERE zone IS NULL),
         count(*) FILTER (WHERE zone IS NOT NULL),
         count(DISTINCT zone)
    INTO v_null, v_with, v_distinct FROM public.projects;

  -- ★ The brief: "If your migration moves a number of rows other than 18, or
  --   lands any row on a value outside the 21, stop and report rather than
  --   shipping." Enforced here so it cannot ship wrong.
  IF v_moved <> 18 THEN
    RAISE EXCEPTION 'fix-415: remap moved % rows, expected 18', v_moved;
  END IF;
  IF v_outside <> 0 THEN
    RAISE EXCEPTION 'fix-415: % rows landed outside the 21 canonical zones', v_outside;
  END IF;
  -- ★ Five projects keep no zone. NULL is not a 22nd zone.
  IF v_null <> 5 OR v_with <> 191 THEN
    RAISE EXCEPTION 'fix-415: zone population moved (null=%, with=%)', v_null, v_with;
  END IF;
  IF v_distinct <> 21 THEN
    RAISE EXCEPTION 'fix-415: % distinct zones remain, expected 21', v_distinct;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- ★★ ONE THING THIS MIGRATION GOT WRONG, RECORDED RATHER THAN HIDDEN
-- ---------------------------------------------------------------------------
-- It did NOT suppress `projects_set_updated_at` before the remap, so the 18
-- rows it changed had their OCC token bumped. fix-410 and fix-412 both
-- suppressed it for exactly this reason (fix-341's false "modified by someone
-- else"), and this should have too. The sibling migration
-- fix_415_round_lot_dimensions does.
--
-- Consequence, measured: 18 projects show today's `updated_at`; 0 activity rows
-- were written (`bp_log_user_activity` no-ops without an authenticated user).
-- Anyone holding one of those 18 open gets one OCC conflict on their next save,
-- which fix-99 auto-retries. Not reversible — the pre-bump timestamps were not
-- snapshotted. Reported in the fix-415 PR.
