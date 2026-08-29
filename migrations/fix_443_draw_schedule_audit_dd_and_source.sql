-- ===========================================================================
-- ★★★ fix-443 §B (P-029) — THE DRAW-SCHEDULE AUDIT LEARNS dd_* AND WHO WROTE IT
-- ===========================================================================
--
-- MEASURED ON PROD 2026-08-29, BEFORE ANYTHING WAS WRITTEN:
--
--   draw_schedule_audit          247 rows, 2026-06-25 → 2026-08-27
--   rows with source IS NULL     247  — every single one
--   dd_start / dd_end columns    absent
--
-- Two separate holes, both silent:
--
--   1. `source` has existed since fix-207 and `bp_audit_draw_schedule` reads
--      `current_setting('app.ds_source', true)` to fill it — but NO WRITER HAS
--      EVER SET IT. A column nobody populates is worse than no column: it reads
--      as "unknown" when the honest answer is "nobody was asked".
--
--   2. The trigger's early-return compares da_assigned, start_week, end_week,
--      status and manually_placed — and NOT dd_start / dd_end. So a dd-only
--      write (bp_set_bp_dd_dates, bp_update_redesign_dd_phase) leaves NO ROW AT
--      ALL. The audit does not merely omit the dd columns; it does not know the
--      write happened.
--
-- ★★★ NOTHING IN HERE IS APPLIED BY THE PR. Written by fix-443 and applied
-- through the Supabase MCP `apply_migration` after the merge — never the SQL
-- editor.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE WRITER INVENTORY, MEASURED FROM pg_proc — NOT FROM migrations/
-- ---------------------------------------------------------------------------
--
-- P-029 guessed "~13 writers". Counted with a word-boundary match against
-- `(insert into|update|delete from) draw_schedule` (the naive pattern also
-- catches `draw_schedule_quarter_layout`, which is a different table and
-- fix-182's, so it is excluded):
--
--     bp_create_project_with_permits          INSERT
--     bp_delete_draw_schedule_row             DELETE
--     bp_move_draw_schedule_da                UPDATE
--     bp_place_new_project_on_da              INSERT
--     bp_replace_draw_schedule                INSERT + DELETE
--     bp_resolve_da_overlap                   UPDATE
--     bp_set_bp_dd_dates                      INSERT + UPDATE
--     bp_shift_da_blocks_up                   UPDATE
--     bp_sync_draw_schedule_da                UPDATE
--     bp_update_draw_schedule_with_dd_sync    UPDATE
--     bp_update_redesign_dd_phase             INSERT + UPDATE
--     bp_upsert_draw_schedule_row             INSERT + UPDATE
--
-- Twelve. (`migrate_auxiliary` also inserts, and is deliberately EXCLUDED: it
-- is the one-off import helper, not an app path, and tagging it would put a
-- migration's name on 2026 rows nobody will ever ask about.)
--
-- ★★★ FOUR OF THE TWELVE ARE NOT IN `migrations/` AT ALL —
-- bp_place_new_project_on_da, bp_replace_draw_schedule, bp_set_bp_dd_dates and
-- bp_shift_da_blocks_up. That is the standing "migrations/ is partial, prod is
-- ahead" state, and it is precisely why section C below does NOT retype any
-- function body.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY SECTION C PATCHES BY ANCHOR INSTEAD OF CREATE OR REPLACE
-- ---------------------------------------------------------------------------
--
-- The brief asks for `CREATE OR REPLACE` on each writer with its EXISTING
-- argument list, because a changed argument list makes an OVERLOAD rather than
-- a replacement (fix-438 learned that the expensive way). Reproducing twelve
-- bodies by hand — four of which have no file to copy from — is twelve chances
-- to mistype a signature or silently drop a line of working logic.
--
-- So instead each function's LIVE definition is read from
-- `pg_get_functiondef`, one line is inserted after its first `BEGIN`, and the
-- result is executed. That makes the guarantee STRUCTURAL rather than careful:
--
--   · the signature comes from the live function, so it cannot change;
--   · the body comes from the live function, so it cannot drift;
--   · it is idempotent — a function already carrying the line is skipped;
--   · a writer that does not exist is skipped and RAISEd as a NOTICE.
--
-- This is fix-425 / fix-410's technique ("patch a live RPC by ANCHOR in a DO
-- block, never retype").
--
-- ★★ WHAT `set_config(..., true)` GUARANTEES: the third argument is
-- `is_local`, so the setting is TRANSACTION-LOCAL and cannot leak into the
-- next statement on a pooled connection. It is also why the value must be set
-- INSIDE each function rather than once by the client.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. The columns (B1)
-- ---------------------------------------------------------------------------
--
-- ★ `date`, matching draw_schedule.dd_start / dd_end exactly (checked against
--   information_schema on prod, not assumed), and NULLable like every other
--   from/to pair on this table — a DELETE has no `to`, an INSERT has no `from`.
--
-- ★★ NO NEW GRANTS AND NO NEW VIEW. The table keeps fix-207's RLS and the
--    post-fix-273 grant posture untouched; adding columns to an existing table
--    inherits its privileges, and this ticket has no mandate to widen them.
ALTER TABLE public.draw_schedule_audit
  ADD COLUMN IF NOT EXISTS dd_start_from date,
  ADD COLUMN IF NOT EXISTS dd_start_to   date,
  ADD COLUMN IF NOT EXISTS dd_end_from   date,
  ADD COLUMN IF NOT EXISTS dd_end_to     date;

COMMENT ON COLUMN public.draw_schedule_audit.dd_start_from IS
  'fix-443: dd_start before the write. NULL on INSERT and on the 247 rows that '
  'predate this column — there is no backfill, and a NULL here means "not '
  'recorded", never "unchanged".';

-- ---------------------------------------------------------------------------
-- B. The trigger function (B2)
-- ---------------------------------------------------------------------------
--
-- ★★★ TWO CHANGES, AND THE FIRST IS THE ONE THAT MATTERS. Adding dd_* to the
-- INSERT column lists only records dd moves that some OTHER column already
-- made auditable. Adding them to the EARLY-RETURN comparison is what makes a
-- dd-only write produce a row at all — before this, `bp_set_bp_dd_dates`
-- moving both dates and nothing else returned NULL and wrote nothing.
--
-- ★ Same signature (a trigger function takes no arguments), so there is no
--   overload to create. The body is fix-207's, extended — not rewritten.
--
-- ★★ fix-265 deliberately left one column OUT of this trigger. That decision
--    is untouched: this adds dd_start and dd_end and nothing else.
CREATE OR REPLACE FUNCTION public.bp_audit_draw_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := current_setting('app.ds_source', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.da_assigned     IS NOT DISTINCT FROM OLD.da_assigned
       AND NEW.start_week  IS NOT DISTINCT FROM OLD.start_week
       AND NEW.end_week    IS NOT DISTINCT FROM OLD.end_week
       AND NEW.status      IS NOT DISTINCT FROM OLD.status
       AND NEW.manually_placed IS NOT DISTINCT FROM OLD.manually_placed
       -- ★★★ fix-443: without these two a dd-only write left NO audit row.
       AND NEW.dd_start    IS NOT DISTINCT FROM OLD.dd_start
       AND NEW.dd_end      IS NOT DISTINCT FROM OLD.dd_end THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.draw_schedule_audit(
      txid, tenant_id, project_id, op, actor_uid, source,
      da_from, da_to, start_week_from, start_week_to,
      end_week_from, end_week_to, status_from, status_to,
      manually_placed_from, manually_placed_to,
      dd_start_from, dd_start_to, dd_end_from, dd_end_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.project_id, 'UPDATE', auth.uid(), v_source,
      OLD.da_assigned, NEW.da_assigned, OLD.start_week, NEW.start_week,
      OLD.end_week, NEW.end_week, OLD.status, NEW.status,
      OLD.manually_placed, NEW.manually_placed,
      OLD.dd_start, NEW.dd_start, OLD.dd_end, NEW.dd_end);
    RETURN NULL;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.draw_schedule_audit(
      txid, tenant_id, project_id, op, actor_uid, source,
      da_from, da_to, start_week_from, start_week_to,
      end_week_from, end_week_to, status_from, status_to,
      manually_placed_from, manually_placed_to,
      dd_start_from, dd_start_to, dd_end_from, dd_end_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.project_id, 'INSERT', auth.uid(), v_source,
      NULL, NEW.da_assigned, NULL, NEW.start_week,
      NULL, NEW.end_week, NULL, NEW.status,
      NULL, NEW.manually_placed,
      NULL, NEW.dd_start, NULL, NEW.dd_end);
    RETURN NULL;
  ELSE
    INSERT INTO public.draw_schedule_audit(
      txid, tenant_id, project_id, op, actor_uid, source,
      da_from, da_to, start_week_from, start_week_to,
      end_week_from, end_week_to, status_from, status_to,
      manually_placed_from, manually_placed_to,
      dd_start_from, dd_start_to, dd_end_from, dd_end_to)
    VALUES (
      txid_current()::text, OLD.tenant_id, OLD.project_id, 'DELETE', auth.uid(), v_source,
      OLD.da_assigned, NULL, OLD.start_week, NULL,
      OLD.end_week, NULL, OLD.status, NULL,
      OLD.manually_placed, NULL,
      OLD.dd_start, NULL, OLD.dd_end, NULL);
    RETURN NULL;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- C. Every writer names itself (B3)
-- ---------------------------------------------------------------------------
--
-- See the header for why this patches the live text by anchor rather than
-- retyping twelve bodies. The inserted line is always the same:
--
--     PERFORM set_config('app.ds_source', '<function name>', true);
--
-- placed immediately after the function's FIRST `BEGIN`, which in a plpgsql
-- function is the start of its outermost block — before any statement that
-- could touch draw_schedule.
DO $migrate$
DECLARE
  v_name  text;
  v_oid   oid;
  v_def   text;
  v_line  text;
  v_pos   int;
  v_done  int := 0;
  v_skip  int := 0;
  -- ★ The twelve app writers, measured from pg_proc. `migrate_auxiliary` is
  --   deliberately absent — see the header.
  v_writers text[] := ARRAY[
    'bp_create_project_with_permits',
    'bp_delete_draw_schedule_row',
    'bp_move_draw_schedule_da',
    'bp_place_new_project_on_da',
    'bp_replace_draw_schedule',
    'bp_resolve_da_overlap',
    'bp_set_bp_dd_dates',
    'bp_shift_da_blocks_up',
    'bp_sync_draw_schedule_da',
    'bp_update_draw_schedule_with_dd_sync',
    'bp_update_redesign_dd_phase',
    'bp_upsert_draw_schedule_row'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_writers LOOP
    -- ★ One overload per name is expected here; if a name ever grows a second
    --   signature this raises rather than silently patching an arbitrary one.
    SELECT p.oid INTO v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name AND p.prokind = 'f';

    IF v_oid IS NULL THEN
      RAISE NOTICE 'fix-443: % not found — skipped', v_name;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    v_def := pg_get_functiondef(v_oid);

    -- Idempotent: already tagged, nothing to do.
    IF v_def LIKE '%set_config(''app.ds_source''%' THEN
      RAISE NOTICE 'fix-443: % already tagged — skipped', v_name;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    -- ★★ THE ANCHOR. A plpgsql body's first `BEGIN` on its own line opens the
    --    outermost block. Matched case-insensitively at a line start so a
    --    `BEGIN` inside a string or a comment cannot be hit.
    v_pos := position(E'\nBEGIN\n' in v_def);
    IF v_pos = 0 THEN
      v_pos := position(E'\nbegin\n' in v_def);
    END IF;
    IF v_pos = 0 THEN
      RAISE EXCEPTION 'fix-443: no BEGIN anchor in % — refusing to guess', v_name;
    END IF;

    -- ★ Trailing newline, not leading: the anchor already ends in one, so this
    --   puts the PERFORM on its own line AND leaves the function's first real
    --   statement starting a line of its own.
    v_line := format(
      E'  PERFORM set_config(''app.ds_source'', %L, true);\n',
      v_name
    );

    -- Insert immediately AFTER the matched "\nBEGIN\n" (7 characters).
    v_def := left(v_def, v_pos + 6) || v_line || substr(v_def, v_pos + 7);

    EXECUTE v_def;
    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'fix-443: tagged % writer(s), skipped %', v_done, v_skip;
END
$migrate$;

COMMIT;

-- ===========================================================================
-- B4 — NO BACKFILL, DELIBERATELY
-- ===========================================================================
--
-- The 247 existing rows keep `source IS NULL` and NULL dd_* pairs. Filling
-- them would mean inventing which RPC wrote each one, and a guessed provenance
-- in an AUDIT table is worse than an honest blank: the whole value of the
-- column is that a reader can trust it. NULL here means "not recorded",
-- exactly as it does on every other from/to pair.
--
-- ===========================================================================
-- VERIFICATION (run after apply; read-only unless noted)
-- ===========================================================================
--
--   -- 1. the four columns exist, as `date`
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='draw_schedule_audit'
--      and column_name like 'dd_%' order by 1;
--
--   -- 2. all twelve writers carry the line
--   select p.proname,
--          (pg_get_functiondef(p.oid) ~ 'set_config\('''app\.ds_source''') as tagged
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in (
--      'bp_create_project_with_permits','bp_delete_draw_schedule_row',
--      'bp_move_draw_schedule_da','bp_place_new_project_on_da',
--      'bp_replace_draw_schedule','bp_resolve_da_overlap','bp_set_bp_dd_dates',
--      'bp_shift_da_blocks_up','bp_sync_draw_schedule_da',
--      'bp_update_draw_schedule_with_dd_sync','bp_update_redesign_dd_phase',
--      'bp_upsert_draw_schedule_row')
--    order by 1;
--
--   -- 3. a dd-ONLY update now writes exactly one row, with a source
--   --    (rolled back — this is a probe, not a change)
--   BEGIN;
--     select count(*) from draw_schedule_audit;         -- before
--     select bp_set_bp_dd_dates( <a real project_id>, '2026-10-05', '2026-10-26',
--                                <its draw_schedule.updated_at>, false );
--     select op, source, dd_start_from, dd_start_to, dd_end_from, dd_end_to
--       from draw_schedule_audit order by changed_at desc limit 1;
--   ROLLBACK;
--
--   -- 4. the 247 historical rows are untouched
--   select count(*) filter (where source is null) from draw_schedule_audit;  -- >= 247
-- ===========================================================================
