-- fix-72 (2026-05-29): DA -> DM (ent_lead) routing + cascade on draw-schedule moves.
--
-- When a project is moved to a new DA on the draw schedule,
-- bp_trg_sync_draw_schedule_da already syncs permits.da (so the derived
-- Architecture-task primary follows). But permits.ent_lead (the DM, e.g.
-- "Miles" / "Bri") did NOT follow, leaving ENT tasks on the wrong DM.
--
-- This adds first-class DA->DM routing data + a lookup + a cascade RPC the
-- frontend calls (only when the user confirms the implied DM change). The move
-- RPC bp_move_draw_schedule_da is intentionally LEFT UNTOUCHED — the cascade is
-- a separate, idempotent follow-up so we don't risk that critical path
-- (OCC / gap-detection / dd-cascade). ENT task primary derivation (fix-70)
-- picks up the new ent_lead automatically; permit_task_assignees are never
-- touched.
--
-- Tenant pattern matches the repo: auth_tenant_ids() for RLS/reads,
-- default_tenant_id_to_caller() BEFORE INSERT to stamp tenant_id on direct
-- inserts. (There is no auth_tenant_id_single() helper in this project, so the
-- column has no DEFAULT — the trigger + explicit seed tenant cover it.)
--
-- ADDITIVE + SAFE: one new table + two new functions. Nothing existing changes.

-- ---------------------------------------------------------------------------
-- 1. Routing table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.da_team_routing (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  da           text NOT NULL,
  jurisdiction text,            -- NULL = fallback / "any other juris"
  ent_lead     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, da, jurisdiction)
);
CREATE INDEX IF NOT EXISTS da_team_routing_lookup_idx
  ON public.da_team_routing(tenant_id, da);

DROP TRIGGER IF EXISTS da_team_routing_default_tenant ON public.da_team_routing;
CREATE TRIGGER da_team_routing_default_tenant
  BEFORE INSERT ON public.da_team_routing
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.da_team_routing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS da_team_routing_sel ON public.da_team_routing;
CREATE POLICY da_team_routing_sel ON public.da_team_routing
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS da_team_routing_ins ON public.da_team_routing;
CREATE POLICY da_team_routing_ins ON public.da_team_routing
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS da_team_routing_upd ON public.da_team_routing;
CREATE POLICY da_team_routing_upd ON public.da_team_routing
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
              WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS da_team_routing_del ON public.da_team_routing;
CREATE POLICY da_team_routing_del ON public.da_team_routing
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 2. Seed the Blueprint Capital tenant's current configuration.
--    Most DAs route to one DM; Fisk + Qisheng are jurisdiction-conditional
--    (juris-specific row + NULL fallback row). Future team shuffles are a row
--    edit, not a code change.
-- ---------------------------------------------------------------------------
INSERT INTO public.da_team_routing (tenant_id, da, jurisdiction, ent_lead) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Francesca', NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Ainsley',   NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Trevor',    NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Nicky',     NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Marc',      NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Erick',     NULL,       'Bri'),
  ('00000000-0000-0000-0000-000000000001', 'Ahmadi',    NULL,       'Bri'),
  ('00000000-0000-0000-0000-000000000001', 'Fisk',      'Seattle',  'Bri'),
  ('00000000-0000-0000-0000-000000000001', 'Fisk',      NULL,       'Miles'),
  ('00000000-0000-0000-0000-000000000001', 'Qisheng',   'Maricopa', 'Bri'),
  ('00000000-0000-0000-0000-000000000001', 'Qisheng',   NULL,       'Miles')
ON CONFLICT (tenant_id, da, jurisdiction) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Lookup: routed ent_lead (DM) for a DA + jurisdiction.
--    Most-specific match wins — a juris-specific row beats the NULL fallback.
--    NULL juris input (project without a jurisdiction) only matches fallback
--    rows. Returns NULL when the DA has no routing row at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_ent_lead_for_da(p_da text, p_juris text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead text;
BEGIN
  IF p_da IS NULL OR length(trim(p_da)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT ent_lead INTO v_lead
  FROM public.da_team_routing
  WHERE da = p_da
    AND tenant_id = ANY (auth_tenant_ids())
    AND (jurisdiction = p_juris OR jurisdiction IS NULL)
  ORDER BY (jurisdiction IS NULL) ASC   -- non-NULL (specific) juris first
  LIMIT 1;

  RETURN v_lead;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_ent_lead_for_da(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cascade: set permits.ent_lead to the routed value for every permit on a
--    project. Jurisdiction lives on projects (NOT permits), so we join to get
--    it. Only rewrites where routing yields a value AND it actually differs
--    (manual overrides to a non-routed DM survive when routing returns NULL).
--    Returns the number of permit rows updated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_cascade_ent_lead_for_project(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_count   integer;
BEGIN
  UPDATE public.permits p
  SET ent_lead   = public.bp_ent_lead_for_da(p.da, pr.juris),
      updated_at = now()
  FROM public.projects pr
  WHERE p.project_id = p_project_id
    AND pr.id = p.project_id
    AND p.tenant_id = ANY (v_tenants)
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS NOT NULL
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS DISTINCT FROM p.ent_lead;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_cascade_ent_lead_for_project(uuid) TO authenticated;
