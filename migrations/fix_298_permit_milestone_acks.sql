-- fix-298 Phase 2: a record that somebody performed a milestone action.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-14 via MCP apply_migration,
--   in two parts (see the grant note at the foot).
--
-- THE PROBLEM. Some board rows have no task behind them — "pay issuance fees",
-- "ping the reviewer". Ticking one has to leave a record, or the board forgets
-- overnight and re-raises it tomorrow.
--
-- ★ WHY NOT A RETROSPECTIVE RESOLVED TASK — the option I rejected, and the
-- reason matters. permit_tasks COUNTS FEED THE DESIGN-LEG RULE: a permit is
-- "ready to hand off" iff at least one design task existed and all are
-- resolved. Writing a synthetic resolved task to record "I paid the fees"
-- would change whether that permit reads as ready to file. That is a
-- self-inflicted version of the exact vacuous-truth trap this ticket exists to
-- avoid — an ENTITLEMENT action silently vouching for the DESIGN leg. It would
-- also put rows nobody created into My Tasks and into every task metric.
--
-- ★ RE-RAISE SEMANTICS. Each ack stores the milestone's defining value at the
-- time it was ticked (`anchor`), and suppresses that milestone only while the
-- anchor still matches:
--
--     fees            anchor = approval_date   (re-approved -> prompt again)
--     intake          anchor = intake_date     (rebooked    -> prompt again)
--     target_submit   anchor = target_submit
--     draw            anchor = dd_end
--     corrections     anchor = cycle_index     (new cycle   -> prompt again)
--     design_complete anchor = cycle_index     (new cycle   -> hand off again)
--
--     reviewer_silent has no stable anchor — the whole point is that nothing
--     is changing, so an anchor could never expire. It is handled in the
--     client instead: the ack COUNTS AS A MOVEMENT, so silence is re-measured
--     from it. "I pinged them; ask me again if another 14 days go by."

CREATE TABLE IF NOT EXISTS public.permit_milestone_acks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  permit_id     integer NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  milestone     text NOT NULL,
  -- NULL is a legitimate anchor (a milestone whose driving date is unset), so
  -- comparisons are null-safe rather than an equality test.
  anchor        text,
  acked_by      uuid,
  -- Roster name, denormalised for display: acked_by is an auth uuid and the
  -- board must be able to say "Miles ticked this" without a join.
  acked_by_name text,
  acked_at      timestamptz NOT NULL DEFAULT now(),
  note          text
);

COMMENT ON TABLE public.permit_milestone_acks IS
  'fix-298 Phase 2: one row per milestone action performed from My Board that '
  'has no task behind it. Append-only. `anchor` holds the milestone''s driving '
  'value at ack time so the prompt returns when the underlying fact changes.';

CREATE INDEX IF NOT EXISTS permit_milestone_acks_permit_milestone_idx
  ON public.permit_milestone_acks (permit_id, milestone);

DROP TRIGGER IF EXISTS permit_milestone_acks_default_tenant
  ON public.permit_milestone_acks;
CREATE TRIGGER permit_milestone_acks_default_tenant
  BEFORE INSERT ON public.permit_milestone_acks
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.permit_milestone_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permit_milestone_acks_tenant_select ON public.permit_milestone_acks;
CREATE POLICY permit_milestone_acks_tenant_select
  ON public.permit_milestone_acks FOR SELECT
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS permit_milestone_acks_tenant_insert ON public.permit_milestone_acks;
CREATE POLICY permit_milestone_acks_tenant_insert
  ON public.permit_milestone_acks FOR INSERT
  WITH CHECK (tenant_id = ANY (public.auth_tenant_ids()));

REVOKE ALL ON public.permit_milestone_acks FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.permit_milestone_acks TO authenticated, service_role;

-- ★ APPEND-ONLY, VERIFIED. The revoke above does NOT strip `authenticated` of
-- UPDATE/DELETE: Supabase's DEFAULT PRIVILEGES hand every new table full DML to
-- that role, and a revoke that does not NAME the role leaves it untouched.
-- Checked with has_table_privilege rather than assumed — it came back true —
-- so this second statement was applied as fix_298_acks_append_only_grants.
-- RLS already blocked both (there is no UPDATE or DELETE policy), but a table
-- documented as append-only should not be one policy away from rewritable.
REVOKE UPDATE, DELETE, TRUNCATE ON public.permit_milestone_acks FROM authenticated;
