-- ===========================================================================
-- fix-452 §A — A BUILDER'S NAME CAN BE CORRECTED (P-102)
-- ===========================================================================
--
-- Bobby, 2026-08-30: *"in list and catalogs, if the builders name is spelled
-- wrong, or all caps, i want to be able to edit the grammatical issues"* — the
-- PERSON'S name, the one field on that panel that was not editable.
--
-- ★★★ WHY THIS IS A NEW FUNCTION AND NOT A CALL TO bp_upsert_builder.
--
-- `bp_upsert_builder` already updates `name` for ONE row. Using it would be the
-- bug, not the fix: `groupByPerson` keys people on the trimmed, case-folded
-- name, and its own comment warns that rewriting one row's spelling *"would
-- quietly create 'ted chesledon' as a second person"*. Ghennadi Ialanji holds
-- three rows and Ted Chesledon two — correcting one of three SPLITS the person
-- into two groups. **The unit of rename is the PERSON, not the row.**
--
-- ★★★ AND A CLIENT-SIDE LOOP IS THE SAME BUG WEARING A RETRY. Three sequential
-- per-row calls that fail on the second leave a person renamed in half. One
-- statement pair, one transaction.
--
-- ★★ IT ALSO REWRITES projects.builder_name, FOR THE SAME REASON
-- bp_merge_builders DOES. That column is a denormalised copy (fix-175's
-- autofill cache) and it is READ, not just stored:
--   · ProjectDetailHeader ~2077 — the Builder/Owner cell's displayed value
--   · ProjectSettingsModal ~189/868 — the read-only builder block
--   · lib/redesignAnalytics ~181/188/275 — groups redesign cohorts BY NAME
--   · lib/metricDefinitions ~428 — "count(distinct projects.builder_name …)"
-- redesignAnalytics keys on `(builder_name ?? '').trim()` and does NOT
-- case-fold, so renaming the catalogue without the projects would make
-- `GERRARD FLOYD` and `Gerrard Floyd` two separate builders in that report.
-- Both move together or neither should.
--
-- ★ A CASING-ONLY RENAME MUST STILL RUN. `GERRARD FLOYD` → `Gerrard Floyd` is
-- the headline case and is a no-op under a case-folded comparison, so there is
-- deliberately NO "nothing changed" early return.
--
-- ★ NO AUTO-TIDY, BY RULING. A Title-Case helper that fixes `KANEBUILT LLC`
-- turns `SSS` into "Sss", `JMS Homes, Inc` into "Jms Homes, Inc", and mangles
-- `McDonald` and `O'Brien`. 61 curated rows want a plain editable field, and
-- fix-449 already paid for the lesson that a resolver rewriting a human's
-- value is how values get lost.
--
-- ★★ THIS MIGRATION MOVES NO ROWS. It creates one function. `GERRARD FLOYD` —
-- the single ALL-CAPS name on prod, 1 project — is left for Bobby to fix by
-- hand once the field exists; that is his acceptance test.

create or replace function public.bp_rename_builder_person(
  p_old_name text,
  p_new_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenants  uuid[] := public.auth_tenant_ids();
  v_old      text   := btrim(coalesce(p_old_name, ''));
  v_new      text   := btrim(coalesce(p_new_name, ''));
  v_ids      uuid[];
  v_rows     integer := 0;
  v_projects integer := 0;
begin
  if array_length(v_tenants, 1) is null then
    raise exception 'no tenant in session';
  end if;
  -- ★ A blank new name would erase the only thing that groups a person's rows
  --   together. `bp_upsert_builder` refuses one too.
  if v_new = '' then
    raise exception 'builder name is required';
  end if;
  if v_old = '' then
    raise exception 'no builder to rename';
  end if;

  -- ★ Case-folded match, because the panel groups that way: renaming
  --   "ted chesledon" must move the row spelled "Ted Chesledon" as well, or
  --   the split this function exists to prevent happens anyway.
  select array_agg(id) into v_ids
    from public.builders
   where tenant_id = any (v_tenants)
     and lower(btrim(name)) = lower(v_old);

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'no builder rows found for %', p_old_name;
  end if;

  update public.builders
     set name = v_new
   where id = any (v_ids)
     and tenant_id = any (v_tenants);
  get diagnostics v_rows = row_count;

  -- ★★ The denormalised copy, in the SAME transaction. Ordered after the
  --    catalogue so the two can never be observed disagreeing.
  update public.projects
     set builder_name = v_new
   where builder_id = any (v_ids)
     and tenant_id = any (v_tenants);
  get diagnostics v_projects = row_count;

  return jsonb_build_object(
    'rows', v_rows,
    'projects', v_projects,
    'name', v_new
  );
end;
$$;

-- ★ The grant model bp_merge_builders uses, verbatim: anon gets nothing,
--   authenticated gets EXECUTE and no table privileges.
revoke all on function public.bp_rename_builder_person(text, text) from public, anon;
grant execute on function public.bp_rename_builder_person(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'bp_rename_builder_person';
-- select name, count(*) from public.builders group by name having count(*) > 1;
