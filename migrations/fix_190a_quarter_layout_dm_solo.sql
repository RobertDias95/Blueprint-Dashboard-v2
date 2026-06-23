-- fix-190a (2026-06-23): DM-solo column for the per-quarter Draw Schedule layout.
--
-- fix-182 modeled a column as a DA (col_kind='da', da_name set) or an OPEN
-- placeholder (col_kind='open', da_name NULL). This adds a third kind, 'dm', for
-- the 2-tier case where a DM works a lane solo — no DA beneath them (e.g. Jade
-- occupied on a project by herself for a quarter). A 'dm' column carries the
-- DM's name in da_name (the lane-owner name the grid matches draw_schedule
-- blocks on, exactly like a 'da' column) and typically group_label=<DM> so the
-- DM gets a 1-wide manager header over their own column.
--
-- Only the CHECK constraints change. Every layout RPC (upsert / append / insert
-- / reorder / clone) passes col_kind through verbatim, so they all handle 'dm'
-- with no edit. The widening is strictly more permissive — existing 'da'/'open'
-- rows already satisfy the new constraints — so it applies without touching data.
--
-- Migration applied to prod via MCP; this file is the repo backstop. (migrations/
-- is a partial record; prod is source of truth — see CLAUDE memory.)

ALTER TABLE public.draw_schedule_quarter_layout
  DROP CONSTRAINT IF EXISTS draw_schedule_quarter_layout_col_kind_check;
ALTER TABLE public.draw_schedule_quarter_layout
  ADD  CONSTRAINT draw_schedule_quarter_layout_col_kind_check
       CHECK (col_kind IN ('da', 'open', 'dm'));

ALTER TABLE public.draw_schedule_quarter_layout
  DROP CONSTRAINT IF EXISTS dsql_kind_da_consistency;
ALTER TABLE public.draw_schedule_quarter_layout
  ADD  CONSTRAINT dsql_kind_da_consistency CHECK (
    -- OPEN: nobody assigned. DA / DM: the lane-owner name is required (da_name
    -- holds the DA's or the solo DM's name).
    (col_kind = 'open' AND da_name IS NULL) OR
    (col_kind IN ('da', 'dm') AND da_name IS NOT NULL)
  );
