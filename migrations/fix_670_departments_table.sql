-- ===========================================================================
-- fix-670 (P-351) — departments become a list Settings can grow
-- ===========================================================================
--
-- Bobby, 2026-10-14: *"other departments need access to this to view our work…
-- so i need to be able to add their departments, so their labels are accurate
-- to their roles in the company."*
--
-- Until now the seven departments were hard-coded in five places that had to
-- move together (the TS union, DEPARTMENT_LABEL, DEPARTMENTS, the
-- `team_members_department_check` CHECK, and the value list inside
-- `bp_set_team_department`). This makes the DATABASE the list:
--
--   1. `public.departments` (tenant_id, key, label, sort_order), seeded with
--      the seven keys, today's labels and today's DEPARTMENTS order.
--   2. The CHECK is replaced by a composite FK (tenant_id, department) →
--      departments, so a typo still cannot be stored. MATCH SIMPLE: a NULL
--      department (not yet classified) is not checked, exactly as before.
--   3. `bp_set_team_department` validates against the table, not a list.
--   4. Three admin RPCs: add (key = unique slug of the label), rename the
--      label (the KEY never changes — team_members.department joins on it),
--      reorder, and delete only while nobody is in it.
--
-- ★★★ NO team_members.department VALUE CHANGES. Every non-null value on prod is
--     one of the seven seeded keys (proved in a rolled-back run first).

-- 1. The table ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  key        text NOT NULL CHECK (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  label      text NOT NULL CHECK (btrim(label) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ★ Two departments with the same words would be indistinguishable in every
--   picker, so the label is unique per tenant too (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_label_uniq
  ON public.departments (tenant_id, lower(btrim(label)));

DROP TRIGGER IF EXISTS departments_default_tenant ON public.departments;
CREATE TRIGGER departments_default_tenant
  BEFORE INSERT ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_tenant_select ON public.departments;
CREATE POLICY departments_tenant_select ON public.departments
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS departments_tenant_admin_write ON public.departments;
CREATE POLICY departments_tenant_admin_write ON public.departments
  FOR ALL USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- ★ fix-157 / fix-273 posture: anon gets nothing, authenticated no TRUNCATE.
REVOKE ALL ON public.departments FROM PUBLIC, anon;
REVOKE ALL ON public.departments FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;

-- 2. The seed — the seven that exist, today's labels, DEPARTMENTS order --------
INSERT INTO public.departments (tenant_id, key, label, sort_order)
SELECT t.id, d.key, d.label, d.sort_order
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('policy',                'Policy',                  10),
   ('design_entitlements',   'Design & Permitting',     20),
   ('acquisitions',          'Acquisitions',            30),
   ('underwriting',          'Underwriting',            40),
   ('executive',             'Executive',               50),
   ('it_investor_relations', 'IT & Investor Relations', 60),
   ('construction_admin',    'Construction Admin',      70)
 ) AS d(key, label, sort_order)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- 3. CHECK → FK ----------------------------------------------------------------
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_department_check;
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_department_fkey;
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_department_fkey
  FOREIGN KEY (tenant_id, department)
  REFERENCES public.departments (tenant_id, key)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

-- 4. bp_set_team_department validates against the table ------------------------
CREATE OR REPLACE FUNCTION public.bp_set_team_department(p_name text, p_department text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_dep  text := nullif(btrim(coalesce(p_department, '')), '');
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  -- ★ fix-670: the list is public.departments now, not a literal here.
  if v_dep is not null and not exists (
       select 1 from public.departments d
        where d.tenant_id = any (public.auth_tenant_ids())
          and d.key = v_dep) then
    raise exception 'unknown department: %', p_department;
  end if;

  update public.team_members m
     set department = v_dep
   where m.tenant_id = any (public.auth_tenant_ids())
     and m.name = v_name
     and m.department is distinct from v_dep;
  get diagnostics v_rows = row_count;

  if v_rows = 0 and not exists (
       select 1 from public.team_members m
        where m.tenant_id = any (public.auth_tenant_ids())
          and m.name = v_name) then
    raise exception 'no roster row for %', p_name;
  end if;
  return v_rows;
end;
$function$;

-- 5. Admin RPCs (invoker: the admin-write RLS policy is the gate) ---------------

-- The key a label becomes: lower-case words joined by '_'. Pure.
CREATE OR REPLACE FUNCTION public.bp_department_slug(p_label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nullif(
    trim(both '_' from regexp_replace(lower(coalesce(p_label, '')), '[^a-z0-9]+', '_', 'g')),
    '');
$function$;

-- Add (p_key NULL) or rename (p_key given; the key never changes).
CREATE OR REPLACE FUNCTION public.bp_upsert_department(p_key text, p_label text)
 RETURNS TABLE(key text, label text, sort_order integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_label  text := btrim(coalesce(p_label, ''));
  v_base   text;
  v_key    text;
  v_n      integer := 1;
begin
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then
    raise exception 'only an admin can change departments';
  end if;
  if v_label = '' then
    raise exception 'a department needs a name';
  end if;
  if exists (select 1 from public.departments d
              where d.tenant_id = v_tenant
                and lower(btrim(d.label)) = lower(v_label)
                and d.key is distinct from p_key) then
    raise exception 'there is already a department called %', v_label;
  end if;

  if p_key is not null then
    update public.departments d
       set label = v_label, updated_at = now()
     where d.tenant_id = v_tenant and d.key = p_key;
    if not found then
      raise exception 'unknown department: %', p_key;
    end if;
    return query select d.key, d.label, d.sort_order
                   from public.departments d
                  where d.tenant_id = v_tenant and d.key = p_key;
    return;
  end if;

  v_base := public.bp_department_slug(v_label);
  if v_base is null then
    raise exception 'a department name needs at least one letter or digit';
  end if;
  v_key := v_base;
  while exists (select 1 from public.departments d
                 where d.tenant_id = v_tenant and d.key = v_key) loop
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  end loop;

  insert into public.departments (tenant_id, key, label, sort_order)
  values (v_tenant, v_key, v_label,
          coalesce((select max(d.sort_order) from public.departments d
                     where d.tenant_id = v_tenant), 0) + 10);
  return query select d.key, d.label, d.sort_order
                 from public.departments d
                where d.tenant_id = v_tenant and d.key = v_key;
end;
$function$;

-- Reorder: the keys in their new order. Keys not listed keep their place after.
CREATE OR REPLACE FUNCTION public.bp_reorder_departments(p_keys text[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_rows   integer;
begin
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then
    raise exception 'only an admin can change departments';
  end if;
  update public.departments d
     set sort_order = o.ord * 10, updated_at = now()
    from unnest(p_keys) with ordinality as o(k, ord)
   where d.tenant_id = v_tenant and d.key = o.k
     and d.sort_order is distinct from o.ord * 10;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- Delete only while nobody is in it (the FK would refuse anyway; this says why).
CREATE OR REPLACE FUNCTION public.bp_delete_department(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_people integer;
begin
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then
    raise exception 'only an admin can change departments';
  end if;
  select count(distinct m.name) into v_people
    from public.team_members m
   where m.tenant_id = v_tenant and m.department = p_key;
  if v_people > 0 then
    raise exception '% % still in this department — move them first',
      v_people, case when v_people = 1 then 'person is' else 'people are' end;
  end if;
  delete from public.departments d where d.tenant_id = v_tenant and d.key = p_key;
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION public.bp_upsert_department(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_reorder_departments(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_delete_department(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_department_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_department(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_reorder_departments(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_delete_department(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_department_slug(text) TO authenticated;
