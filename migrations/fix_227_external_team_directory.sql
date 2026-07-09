-- fix-227: a central External Team directory that POPULATES the per-project
-- external-team picker.
--
-- Background: fix-197 dropped the old unwired consultant_firms /
-- project_external_teams registry. External team is stored per project as the
-- projects.external_team JSONB blob { discipline: firm } (fix-195) — that blob
-- stays the SINGLE source of truth. This directory does NOT replace it: it is a
-- master firm list, by discipline, that the per-project firm picker draws its
-- dropdown options from. Picking a firm still writes the project blob; adding a
-- new firm in the picker also inserts it here so it is reusable next time.
--
-- Discipline vocabulary = the app's canonical WAITING_ON_OPTIONS (fix-190d:
-- "Surveyor", not "Survey") — the same words the external-team blob keys use.
-- Not CHECK-constrained (the blob keys aren't either); the UI drives the vocab.
--
-- Security: admin-write, tenant-select (fix-220 pattern). tenant_id is filled by
-- the shared default_tenant_id_to_caller() BEFORE-INSERT trigger, exactly like
-- public.builders (so the client can insert without passing tenant_id).

CREATE TABLE IF NOT EXISTS public.external_team_directory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  discipline    text NOT NULL,
  name          text NOT NULL,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One firm name per discipline per tenant, case-insensitively (so "Emerald" and
-- "emerald" don't both live under Surveyor). Add/rename upserts rely on this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_team_directory_tenant_disc_name
  ON public.external_team_directory (tenant_id, discipline, lower(name));
CREATE INDEX IF NOT EXISTS idx_external_team_directory_tenant_disc
  ON public.external_team_directory (tenant_id, discipline);

-- Fill tenant_id from the caller when the client omits it (mirrors builders).
DROP TRIGGER IF EXISTS external_team_directory_default_tenant
  ON public.external_team_directory;
CREATE TRIGGER external_team_directory_default_tenant
  BEFORE INSERT ON public.external_team_directory
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.external_team_directory ENABLE ROW LEVEL SECURITY;

-- reads: any member of the tenant (the per-project picker needs the options).
DROP POLICY IF EXISTS external_team_directory_tenant_select
  ON public.external_team_directory;
CREATE POLICY external_team_directory_tenant_select
  ON public.external_team_directory
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

-- writes: admins only (fix-220). A separate FOR ALL admin policy; SELECT for
-- non-admins still works via the permissive select policy above (policies OR).
DROP POLICY IF EXISTS external_team_directory_tenant_admin_write
  ON public.external_team_directory;
CREATE POLICY external_team_directory_tenant_admin_write
  ON public.external_team_directory
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

REVOKE ALL ON public.external_team_directory FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_team_directory
  TO authenticated, service_role;
