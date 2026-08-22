-- ===========================================================================
-- fix-384 — people are typing project addresses into a label because there is
--           no link
-- ===========================================================================
--
-- ★★★ WHERE THIS CAME FROM. 5831 104th Ave NE took two separate design windows
-- months apart — not a redesign, just staged work. The first is stored:
--
--   draw_schedule  project 05ca328c…  Nicky  dd_start 2025-03-31  dd_end 2025-04-25
--                                            manually_placed = true
--
-- The second, 9–27 Jun 2025, DOES NOT EXIST in the database, and it cannot:
-- draw_schedule's PRIMARY KEY is project_id. One row per project, full stop.
--
-- ★★ Re-keying draw_schedule was priced and REJECTED — 34 source files read it,
-- plus bp_sync_draw_schedule_da, bp_resolve_da_overlap (fix-24a), fix-182's
-- quarter-versioned layout, fix-207's audit trail and the vendor reports. A
-- disproportionate blast radius for a one-off.
--
-- ★★★ Bobby's own answer is better, and people are ALREADY DOING IT BY HAND:
-- "Could we just plop a block on the draw schedule as an 'other', but link it
-- to that project?" da_time_blocks — the non-project block table — had no
-- project link, so the project got typed into the free-text label instead:
--
--   Cancelled Project (9022 36th Ave SW)
--   2621 Eastlake Ave E (Redesign)
--   4707 S Graham St                    REDESIGN
--   Estrella Interior Elevations
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY A LINKED BLOCK STILL CANNOT REACH THE VENDOR REPORTS
-- ---------------------------------------------------------------------------
--
-- This is the contract most at risk, and it holds ARCHITECTURALLY rather than
-- by a filter anyone could later "tidy away":
--
--   ★★★ NOTHING IN THE REPORTING PATH READS da_time_blocks AT ALL.
--
-- src/lib/vendorReport.ts names the table exactly once — in a COMMENT at :202
-- explaining why it needs no clause ("they live in a SEPARATE table,
-- da_time_blocks, and never appear in draw_schedule at all"). It issues no
-- query against it. Neither does any deal-volume or team-performance module.
-- The vendor forecast is built from draw_schedule; a column added over here
-- cannot travel to a query that does not exist.
--
-- ★★★ A LINKED NP BLOCK IS STILL NOT A PROJECT'S DESIGN WINDOW — it is
-- somebody's TIME. That is why the link is deliberately inert to reporting: if
-- linking one started feeding vendor forecasts or deal volume, this ticket
-- would have quietly corrupted the reporting fix-265/fix-266 spent a week
-- validating. Asserted in NpBlockProjectLinkFix384.test.ts, which fails if any
-- reporting module ever starts reading this table.
--
-- ---------------------------------------------------------------------------
-- ★★ THE COLUMN
-- ---------------------------------------------------------------------------
--
-- ★★ NULLABLE IS THE WHOLE POINT. A Vacation or Training block genuinely has
-- no project, and most rows will keep a NULL — 34 Vacation, 12 Training of 81
-- rows today. The link is never required and is NEVER gated on the block type:
-- the useful cases (Other, Corrections, Redesign) are not a closed set, and
-- nobody should have to pick the "right" type to be allowed to link.
--
-- ★ THE LABEL STAYS FREE TEXT and keeps its meaning. This ADDS a link; it does
-- not replace the label with one.
--
-- ★★ ON DELETE SET NULL, not CASCADE. The row is a person's time on the draw
-- schedule; the project link is incidental to it. Deleting a project must not
-- silently delete somebody's scheduled weeks out of the grid.
--
-- ★ NO ROW IS EDITED BY THIS MIGRATION. Every existing block keeps project_id
-- NULL. The candidate list for the four label-named blocks is reported, NOT
-- applied — migrations/fix_384_label_candidates_PENDING_APPROVAL.sql.
--
-- Based on the LIVE pg_get_functiondef from prod (eibnmwthkcuumyclyxoe).
-- ===========================================================================

ALTER TABLE public.da_time_blocks
  ADD COLUMN IF NOT EXISTS project_id uuid
  REFERENCES public.projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.da_time_blocks.project_id IS
  'fix-384: optional link to the project this non-project block is about. '
  'NULL for Vacation/Training/PTO and most rows. A linked block is still NOT a '
  'project design window — it never reaches the vendor reports or deal volume, '
  'which read draw_schedule and never this table.';

-- Only linked rows are ever looked up this way (the project page asks "what
-- blocks point at me?"), so the index carries only them.
CREATE INDEX IF NOT EXISTS da_time_blocks_project_id_idx
  ON public.da_time_blocks (project_id)
  WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The upsert RPC learns one field.
-- ---------------------------------------------------------------------------
--
-- ★ SECURITY INVOKER, unchanged. fix-220 made these writes admin-only through
-- RLS on the table rather than a guard inside the function, so this stays a
-- plain invoker function and the gate keeps working untouched.
--
-- ★★ project_id follows `label`'s existing semantics: p_data carries the whole
-- row, so an absent key CLEARS the field. That is what makes the picker able to
-- UNLINK — sending project_id: null is how you clear it — and the client always
-- sends the full payload.
--
-- ★★ The tenant guard costs one EXISTS. Because the function runs as the
-- caller, RLS already scopes `projects`, so a project in another tenant is
-- invisible here and the link is refused rather than silently written.
CREATE OR REPLACE FUNCTION public.bp_upsert_da_time_block_row(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamp with time zone
)
RETURNS TABLE(out_id text, updated_at timestamp with time zone, conflict boolean)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actual  timestamptz;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
BEGIN
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_project)
  THEN
    RAISE EXCEPTION 'bp_upsert_da_time_block_row: project % not in caller scope', v_project
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    INSERT INTO public.da_time_blocks (id, da_name, type, label, start_week, end_week, project_id)
    VALUES (
      p_id,
      p_data->>'da_name',
      p_data->>'type',
      p_data->>'label',
      p_data->>'start_week',
      p_data->>'end_week',
      v_project
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING da_time_blocks.id, da_time_blocks.updated_at INTO out_id, updated_at;

    IF NOT FOUND THEN
      SELECT b.updated_at INTO v_actual FROM public.da_time_blocks b WHERE b.id = p_id;
      out_id := p_id; updated_at := v_actual; conflict := true;
    ELSE
      conflict := false;
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.da_time_blocks b SET
    da_name    = p_data->>'da_name',
    type       = p_data->>'type',
    label      = p_data->>'label',
    start_week = p_data->>'start_week',
    end_week   = p_data->>'end_week',
    project_id = v_project
  WHERE b.id = p_id AND b.updated_at = p_expected_updated_at
  RETURNING b.id, b.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;
  SELECT b.updated_at INTO v_actual FROM public.da_time_blocks b WHERE b.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END;
$function$;
