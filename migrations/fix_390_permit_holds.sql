-- ===========================================================================
-- fix-390 — a hold paints the whole project when only one permit is stuck
-- ===========================================================================
--
-- From the register: "Permit-level holds, not just project-level."
--
-- Today `project_holds` is the only lever. When ONE permit is stuck — a ULS
-- waiting on the city while the BP proceeds, a sub-permit paused while the main
-- set moves — the only honest options are to hold the WHOLE project (painting
-- permits that are actively moving) or to hold nothing (letting the stuck
-- permit look late everywhere). Both are lies, in opposite directions.
--
-- ---------------------------------------------------------------------------
-- ★★★ KIND IS 'hold' ONLY. THERE IS NO PERMIT-LEVEL CANCEL.
-- ---------------------------------------------------------------------------
--
-- project_holds carries kind IN ('hold','cancelled') because fix-262 defined
-- CANCEL as a PROJECT outcome — "the step after hold, before delete" — and the
-- cancelled-projects design makes it an outcome axis for volume attribution.
--
-- ★★★ A single dead permit already has vocabulary, and it is the portal's:
-- **Withdrawn**, which fix-388 just taught the board to respect (a withdrawn
-- permit raises nothing, of any kind). A second cancel concept at permit level
-- would be a RIVAL concept for a question already answered — so the CHECK below
-- admits 'hold' and nothing else, rather than copying the sibling's two-value
-- CHECK and leaving the door open.
--
-- ---------------------------------------------------------------------------
-- ★★ EVERYTHING ELSE MIRRORS THE SIBLING, DELIBERATELY
-- ---------------------------------------------------------------------------
--
-- Same open/released lifecycle (hold_end NULL = open, history preserved by
-- releasing rather than deleting), same reason/note, same tenant scoping, the
-- same single ALL policy on auth_tenant_ids(), the same activity-log trigger,
-- and the same grants — authenticated + service_role, NEVER anon (fix-157), and
-- no TRUNCATE for authenticated (fix-273).
--
-- ★★ ONE OPEN HOLD PER PERMIT, enforced by a partial unique index exactly as
-- project_holds does it. Re-holding after a release creates a NEW row, so the
-- history is the table.
--
-- ★★★ THE HIERARCHY IS ONE-WAY, AND NOTHING HERE ENFORCES IT — because nothing
-- here can. A project hold covers all its permits (unchanged); a permit hold
-- covers ONLY its permit and must NEVER derive project-level held state. That
-- is a rule about READS, so it lives in the read model and its tests, not in a
-- constraint. A permit hold under a project already on hold is redundant but
-- LEGAL — the UI says so rather than forbidding it, because a person tidying up
-- after a project hold is released should not have to re-place holds they
-- already placed.
--
-- ★ NO OCC COUPLING. This table stands alone: no trigger writes another table,
-- and no parent-then-children RPC touches it. fix-382's false-conflict bug was
-- born from exactly that coupling (a parent write cascading onto children the
-- same transaction then OCC-checked) — keeping this table uncoupled is how it
-- stays impossible here.
--
-- ★ NO ROW IS WRITTEN BY THIS MIGRATION and nothing is backfilled. Every permit
-- starts unheld, which is the only honest starting state: nobody has said any
-- permit is paused.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.permit_holds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permit_id  integer NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  note       text,
  hold_start date NOT NULL DEFAULT CURRENT_DATE,
  hold_end   date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ★★★ 'hold' ONLY — see the note above on why there is no permit cancel.
  kind       text NOT NULL DEFAULT 'hold'
);

ALTER TABLE public.permit_holds
  DROP CONSTRAINT IF EXISTS permit_holds_kind_chk;
ALTER TABLE public.permit_holds
  ADD CONSTRAINT permit_holds_kind_chk CHECK (kind = 'hold');

ALTER TABLE public.permit_holds
  DROP CONSTRAINT IF EXISTS permit_holds_dates_chk;
ALTER TABLE public.permit_holds
  ADD CONSTRAINT permit_holds_dates_chk
  CHECK (hold_end IS NULL OR hold_end >= hold_start);

-- One OPEN hold per permit; released rows accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS permit_holds_one_active_per_permit
  ON public.permit_holds (permit_id) WHERE hold_end IS NULL;

CREATE INDEX IF NOT EXISTS permit_holds_tenant_permit_idx
  ON public.permit_holds (tenant_id, permit_id);

-- The read the board and the badges make: "which permits are held right now?"
CREATE INDEX IF NOT EXISTS permit_holds_open_idx
  ON public.permit_holds (permit_id) WHERE hold_end IS NULL;

COMMENT ON TABLE public.permit_holds IS
  'fix-390: one permit deliberately paused. Mirrors project_holds minus the '
  'cancel kind — a dead permit is Withdrawn at the portal (fix-388), not '
  'cancelled here. NEVER derives project-level held state: one stuck permit '
  'must not paint its project.';

-- ---------------------------------------------------------------------------
-- RLS + grants — the sibling's shape exactly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.permit_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permit_holds_tenant_policy ON public.permit_holds;
CREATE POLICY permit_holds_tenant_policy ON public.permit_holds
  FOR ALL USING (tenant_id = ANY (public.auth_tenant_ids()));

REVOKE ALL ON public.permit_holds FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_holds TO service_role;

-- The same activity-log trigger project_holds carries, so a hold placed or
-- released shows up in the activity feed like its sibling.
DROP TRIGGER IF EXISTS bp_log_user_activity ON public.permit_holds;
CREATE TRIGGER bp_log_user_activity
AFTER INSERT OR DELETE OR UPDATE ON public.permit_holds
FOR EACH ROW EXECUTE FUNCTION public.bp_trg_log_user_activity();
