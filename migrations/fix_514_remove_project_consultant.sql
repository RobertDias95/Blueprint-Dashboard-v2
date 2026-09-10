-- ===========================================================================
-- fix-514 §D (P-181) — REMOVING A CONSULTANT, AS AN RPC AND AS A SOFT DELETE
-- ===========================================================================
--
-- fix-508 §I shipped `+ Add consultant`. **Remove was never built**, and it is
-- a gap rather than a deferral: the write surface is `bp_add_project_consultant`
-- and `bp_set_consultant_date` / `_firm` / `_phase` / `_status`, and there was
-- no remove of any kind.
--
-- ★★★ RULED ON THE NEURON: PREFER THE RPC. A lone direct write is how a feature
--     grows two rules, and this codebase has paid that bill twice this week —
--     [[P-207-expected-issue-has-two-authors]] and
--     [[P-221-project-data-can-only-edit-the-building-permits-acq-date]], both
--     closed in this same PR.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY IT IS A SOFT DELETE, AND WHY THE SCHEMA HAD TO CHANGE
-- ---------------------------------------------------------------------------
-- §D: *"Do not hard-delete rounds."* [[P-131-consultant-clear-rounds-is-destructive]]
-- is the precedent, and prod says how lightly it is used: **182 rounds across
-- 179 consultants, and exactly ONE round has ever been voided.**
--
-- ★★★ AND `DELETE FROM project_consultants` WOULD HAVE TAKEN THE ROUNDS WITH
--     IT. Checked before writing a line:
--
--       project_consultant_rounds_consultant_id_fkey
--         FOREIGN KEY (consultant_id) REFERENCES project_consultants(id)
--         ON DELETE CASCADE
--
--     So the obvious implementation — delete the row — is precisely the thing
--     the brief forbids, silently, via a constraint nobody would think to read.
--     `voided_at` is the existing soft-delete idiom on ROUNDS; the consultant
--     row had no equivalent, so this adds one rather than inventing a second.
--
-- ★★ WHAT HAPPENS TO A REMOVED CONSULTANT'S ROUNDS, stated because the PR must
--    state it: **nothing is deleted.** The consultant row is stamped
--    `removed_at`, and every one of its LIVE rounds is stamped `voided_at` with
--    the same timestamp — the same mark `bp_set_consultant_firm(p_clear_rounds
--    => true)` already uses when a firm change invalidates a round. The rows
--    stay readable, the vendor forecast's history stays intact, and re-adding
--    the same discipline later starts a fresh round rather than resurrecting
--    a stale one.
--
-- ★ AND THE VIEW IS WHERE IT TAKES EFFECT. `project_consultant_current` is what
--   every reader consumes; filtering there means one clause hides a removed
--   consultant from the band, the overview, the forecast and the Library at
--   once, instead of five call sites each remembering to.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   drop function public.bp_remove_project_consultant(uuid, timestamptz);
--   -- restore the view without the `c.removed_at IS NULL` clause
--   alter table public.project_consultants drop column removed_at;
-- No row is destroyed by this migration, so a rollback loses nothing: a
-- consultant removed while it was live simply becomes visible again.

-- ---------------------------------------------------------------------------
-- 1. The soft-delete column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_consultants
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

COMMENT ON COLUMN public.project_consultants.removed_at IS
  'fix-514 §D (P-181). Soft delete. NULL = live. Set by bp_remove_project_consultant, which also voids the live rounds. Never hard-delete this row: project_consultant_rounds cascades on delete.';

-- ---------------------------------------------------------------------------
-- 2. The RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_remove_project_consultant(
  p_consultant_id      uuid,
  p_expected_updated_at timestamptz
)
RETURNS TABLE(out_id uuid, out_rounds_voided integer, out_conflict boolean)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actual  timestamptz;
  v_voided  integer := 0;
  v_now     timestamptz := now();
BEGIN
  -- The function runs as the CALLER, so RLS scopes `project_consultants`:
  -- a consultant in another tenant is invisible and the removal is refused.
  SELECT c.updated_at INTO v_actual
    FROM public.project_consultants c
   WHERE c.id = p_consultant_id;

  IF v_actual IS NULL THEN
    -- Already gone, or never visible here. Idempotent rather than an error:
    -- the same shape bp_delete_da_time_block_row uses for a missing row.
    out_id := p_consultant_id; out_rounds_voided := 0; out_conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  -- ★★ THE SAME OCC CONTRACT AS EVERY OTHER CONSULTANT WRITE. Removing is the
  -- most destructive thing this surface can do, so it is the last place to
  -- relax the check somebody else's edit would have failed.
  IF v_actual IS DISTINCT FROM p_expected_updated_at THEN
    out_id := p_consultant_id; out_rounds_voided := 0; out_conflict := true;
    RETURN NEXT; RETURN;
  END IF;

  -- ★★★ VOID, NEVER DELETE. `voided_at` is the existing idiom (P-131) and the
  -- FK cascades, so a DELETE here would destroy the round history the vendor
  -- forecast reads.
  UPDATE public.project_consultant_rounds
     SET voided_at = v_now
   WHERE consultant_id = p_consultant_id
     AND voided_at IS NULL;
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  UPDATE public.project_consultants
     SET removed_at = v_now
   WHERE id = p_consultant_id;

  out_id := p_consultant_id;
  out_rounds_voided := v_voided;
  out_conflict := false;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.bp_remove_project_consultant(uuid, timestamptz) IS
  'fix-514 §D (P-181). Soft-removes a project consultant and VOIDS its live rounds. Nothing is hard-deleted — the rounds FK cascades, so a DELETE would destroy history.';

REVOKE ALL ON FUNCTION public.bp_remove_project_consultant(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_remove_project_consultant(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The view stops offering removed consultants. One clause, every reader.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.project_consultant_current AS
 SELECT c.id AS consultant_id,
    c.tenant_id,
    c.project_id,
    c.discipline,
    c.firm_id,
    d.name AS firm_name,
    d.active AS firm_active,
    c.notes,
    c.updated_at,
    r.id AS round_id,
    r.round_index,
    r.phase,
    r.status,
    r.est_send,
    r.sent,
    r.est_recd,
    r.recd,
    r.updated_at AS round_updated_at,
    ( SELECT count(*) AS count
           FROM project_consultant_rounds x
          WHERE x.consultant_id = c.id AND x.voided_at IS NULL) AS round_count
   FROM project_consultants c
     JOIN external_team_directory d ON d.id = c.firm_id
     LEFT JOIN LATERAL ( SELECT r2.id,
            r2.tenant_id,
            r2.consultant_id,
            r2.round_index,
            r2.phase,
            r2.status,
            r2.est_send,
            r2.sent,
            r2.est_recd,
            r2.recd,
            r2.created_at,
            r2.updated_at
           FROM project_consultant_rounds r2
          WHERE r2.consultant_id = c.id AND r2.voided_at IS NULL
          ORDER BY r2.round_index DESC, r2.id DESC
         LIMIT 1) r ON true
  -- ★★★ fix-514 §D: the one clause. Everything else above is byte-identical to
  -- the live definition read from pg_get_viewdef on 2026-09-10.
  WHERE c.removed_at IS NULL;
