-- ===========================================================================
-- fix-666 §A (P-318 census 30) — THE CONSULTANT DIRECTORY SAVES THROUGH ONE
-- SERVER STEP, LIKE THE REST OF SETTINGS
-- ===========================================================================
--
-- Before: `useExternalTeamDirectory` wrote the table directly
-- (`.from('external_team_directory').update/.insert`). RLS made it admin-only,
-- so it was never a hole — but it had none of the checks the other Settings
-- writes carry (fix-608's bp_upsert_builder is the model copied here):
--
--   · NO STALE-EDIT CHECK. The table had no `updated_at` at all, so two admins
--     editing one firm silently overwrote each other.
--   · NO AUDIT. 0 audit_log rows for this table, ever (measured 2026-10-13).
--   · tenant_id came from the `default_tenant_id_to_caller` trigger — the
--     caller's FIRST tenant — rather than being decided by the write.
--   · A duplicate was refused only by `uq_…_tenant_disc_name`, which is exact
--     on discipline and only case-insensitive on the name ("Facet  Civil" and
--     "FacetCivil" both got in), with Postgres' own wording as the toast.
--
-- Measured before this migration: 25 firms, 1 tenant, 0 duplicates by
-- (discipline, name ignoring case and spaces), 0 names with outer spaces.
--
-- ★★ NO EXISTING VALUE CHANGES. `updated_at` is added with a constant default
--    (`now()` is STABLE, so Postgres stores it once as the column's missing
--    value and rewrites no row); the 25 firms read the migration's timestamp as
--    their first token. Grants and RLS are unchanged — the same posture as
--    `builders`, whose admin RLS also stays behind its server function.
-- ===========================================================================

ALTER TABLE public.external_team_directory
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The house triggers, exactly as on team_members / builders.
DROP TRIGGER IF EXISTS external_team_directory_set_updated_at
  ON public.external_team_directory;
CREATE TRIGGER external_team_directory_set_updated_at
  BEFORE UPDATE ON public.external_team_directory
  FOR EACH ROW EXECUTE FUNCTION public.bp_set_updated_at();

-- ★ The audit row is written by the same trigger nine other tables use, so it
--   lands in the same transaction as the write, with `<table>_inserted` /
--   `_updated` and a before/after per changed column — and an update that
--   changes nothing writes no row.
DROP TRIGGER IF EXISTS external_team_directory_audit_row
  ON public.external_team_directory;
CREATE TRIGGER external_team_directory_audit_row
  AFTER INSERT OR DELETE OR UPDATE ON public.external_team_directory
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

CREATE OR REPLACE FUNCTION public.bp_upsert_external_firm(
  p_id uuid DEFAULT NULL,
  p_discipline text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS public.external_team_directory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_cur     public.external_team_directory;
  v_row     public.external_team_directory;
  v_name    text := btrim(coalesce(p_name, ''));
  v_disc    text;
  v_dup     text;
  v_dup_disc text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change the consultant directory.'
      using errcode = '42501';
  end if;

  -- ★ THE TENANT IS DECIDED HERE, never by the caller: an insert goes to the
  --   caller's tenant (bp_upsert_builder's rule); an update stays in the row's.
  if p_id is null then
    if array_length(v_tenants, 1) is null then
      raise exception 'no tenant in session' using errcode = '42501';
    end if;
    v_tenant := v_tenants[1];
  else
    select * into v_cur
      from public.external_team_directory d
     where d.id = p_id
       and d.tenant_id = any (v_tenants)
       for update;
    if not found then
      raise exception 'That firm is no longer in the directory — reload and try again.'
        using errcode = 'P0002';
    end if;
    v_tenant := v_cur.tenant_id;
  end if;

  if not public.is_tenant_admin(v_tenant) then
    raise exception 'Only an admin can change the consultant directory.'
      using errcode = '42501';
  end if;

  -- ★★ fix-382: the stale-edit check comes BEFORE anything writes. On an
  --    update a missing token is refused too (occToken's rule: null is not a
  --    free pass) — a client that has no token must reload to get one.
  if p_id is not null
     and (p_expected_updated_at is null
          or v_cur.updated_at is distinct from p_expected_updated_at) then
    raise exception 'This firm changed since you loaded it — reload and try again.'
      using errcode = '40001';
  end if;

  -- An update keeps its discipline (the editor never moves a firm between
  -- disciplines, and project_consultants validates against it); an insert
  -- must name one.
  v_disc := case when p_id is null then btrim(coalesce(p_discipline, ''))
                 else v_cur.discipline end;
  if v_disc = '' then
    raise exception 'A discipline is required.' using errcode = '22023';
  end if;
  if p_id is null and v_name = '' then
    raise exception 'A firm name is required.' using errcode = '22023';
  end if;
  if p_id is not null and v_name = '' then
    v_name := v_cur.name;
  end if;

  -- ★★ THE DUPLICATE RULE: same discipline (ignoring case and outer spaces),
  --    same name ignoring case and ALL spaces. Applies to a rename as well as a
  --    new firm — a rename onto another firm's name is the same duplicate.
  --    DETAIL carries the unique index's name so the client's named-refusal
  --    list (errorLogger EXPECTED_UNIQUE_REFUSALS) treats it as an answer.
  select d.name, d.discipline into v_dup, v_dup_disc
    from public.external_team_directory d
   where d.tenant_id = v_tenant
     and lower(btrim(d.discipline)) = lower(v_disc)
     and lower(regexp_replace(d.name, '\s+', '', 'g'))
         = lower(regexp_replace(v_name, '\s+', '', 'g'))
     and d.id is distinct from p_id
   limit 1;
  if v_dup is not null then
    raise exception '"%" is already in the directory for %.', v_dup, v_dup_disc
      using errcode = '23505',
            detail = 'uq_external_team_directory_tenant_disc_name';
  end if;

  if p_id is null then
    insert into public.external_team_directory (
      tenant_id, discipline, name, contact_name, contact_email, contact_phone,
      notes, active
    ) values (
      v_tenant, v_disc, v_name,
      nullif(btrim(coalesce(p_contact_name, '')), ''),
      nullif(btrim(coalesce(p_contact_email, '')), ''),
      nullif(btrim(coalesce(p_contact_phone, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_active, true)
    )
    returning * into v_row;
    return v_row;
  end if;

  -- ★ bp_upsert_builder's convention for optional fields: NULL = leave it,
  --   '' = clear it.
  update public.external_team_directory d set
    name          = v_name,
    contact_name  = case when p_contact_name  is null then d.contact_name  else nullif(btrim(p_contact_name), '')  end,
    contact_email = case when p_contact_email is null then d.contact_email else nullif(btrim(p_contact_email), '') end,
    contact_phone = case when p_contact_phone is null then d.contact_phone else nullif(btrim(p_contact_phone), '') end,
    notes         = case when p_notes         is null then d.notes         else nullif(btrim(p_notes), '')         end,
    active        = coalesce(p_active, d.active)
  where d.id = p_id
  returning * into v_row;
  return v_row;
end;
$function$;

COMMENT ON FUNCTION public.bp_upsert_external_firm(uuid, text, text, text, text, text, text, boolean, timestamptz) IS
  'fix-666: add or edit a consultant-directory firm. Admin of the tenant; tenant set server-side; stale token refused (40001); duplicate in the discipline ignoring case/spaces refused (23505); audited by the audit_row trigger.';

REVOKE ALL ON FUNCTION public.bp_upsert_external_firm(uuid, text, text, text, text, text, text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_external_firm(uuid, text, text, text, text, text, text, boolean, timestamptz) TO authenticated, service_role;
