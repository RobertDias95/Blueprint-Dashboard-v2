-- ===========================================================================
-- fix-457 §A6 — WRITE RPCs FOR da_team_routing (P-007)
-- ===========================================================================
--
-- ★★★ THIS FIXES NO ROWS AND MOVES NONE. Measured on prod 2026-08-30: 14 rows,
-- 11 distinct DAs, **11 active DAs and 0 of them without a routing row**, 0 rows
-- pointing at an inactive or unknown person, 0 overrides without a default. The
-- routing table is HEALTHY. What was missing is the door — `da_team_routing`
-- has never had an editor, so the next DA to join needed Claude to write an
-- INSERT by hand. This is fix-436's *"Bobby can add a person without Claude"*
-- finished for the other half of onboarding.
--
-- ---------------------------------------------------------------------------
-- ★★ THE SHAPE IS COPIED, NOT INVENTED (STEP 0d)
-- ---------------------------------------------------------------------------
-- The closest sibling is `dm_da_groups` — the other DA mapping table edited
-- from Settings → Team. It writes through an OCC-guarded pair:
--   bp_upsert_dm_da_group_row(p_id, p_data jsonb, p_expected_updated_at)
--     -> TABLE(out_id, updated_at, conflict)
--   bp_delete_dm_da_group_row(p_id, p_expected_updated_at)
--     -> TABLE(deleted, conflict, current_updated_at)
-- These two mirror that exactly, including returning `conflict` as a VALUE
-- rather than raising — the client turns it into an OCCConflictError.
--
-- ★ INVOKER, NOT SECURITY DEFINER, for the same reason the sibling is:
--   da_team_routing already has all four tenant-scoped RLS policies
--   (da_team_routing_sel/ins/upd/del, each `tenant_id = ANY (auth_tenant_ids())`),
--   so the caller's own rights are exactly the right rights. A SECURITY DEFINER
--   function here would be a second, weaker copy of a policy that already works.
--
-- ★★★ …BUT `updated_at` IS SET EXPLICITLY, AND THAT IS NOT COSMETIC.
--   `dm_da_groups` has an auto-touch trigger; **da_team_routing does NOT** (its
--   only trigger is `default_tenant_id_to_caller` on INSERT). Copying the
--   sibling's UPDATE verbatim would leave `updated_at` frozen, so the OCC token
--   would never change — every subsequent save would appear to succeed against
--   a stale token forever. The guard would be decorative. Hence `updated_at =
--   now()` in the UPDATE body.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE NULL-JURISDICTION DUPLICATE HOLE, WHICH THE CONSTRAINT DOES NOT CLOSE
-- ---------------------------------------------------------------------------
-- The table has `UNIQUE (tenant_id, da, jurisdiction)`, and it is a plain btree
-- unique index. **In Postgres two NULLs are distinct**, so that constraint does
-- NOT stop a DA having TWO default (jurisdiction IS NULL) rows. Nothing on prod
-- has one today — 11 DAs, 11 defaults — but an editor with an "Add rule" button
-- and a blank jurisdiction field is exactly how the first one gets made.
--
-- It matters because `bp_ent_lead_for_da` ends in:
--     ORDER BY (jurisdiction IS NULL) ASC   -- non-NULL (specific) juris first
--     LIMIT 1;
-- With two NULL rows the ORDER BY cannot separate them and the winner is
-- whichever the planner hands back first — a DA whose routed lead changes
-- between two names for no visible reason. So both functions below refuse it,
-- and the duplicate check is deliberately in the DATABASE rather than in the
-- panel: the panel is one caller, and this is the kind of rule that must hold
-- for the next one too.
--
-- ★ NOT CHANGED BY THIS MIGRATION: bp_ent_lead_for_da,
--   bp_cascade_ent_lead_for_project, fix-147's `AND p.ent_lead IS NULL`, the
--   RLS policies, the table's columns, or one single row.

-- ---------------------------------------------------------------------------
-- UPSERT
-- ---------------------------------------------------------------------------
create or replace function public.bp_upsert_da_team_routing_row(
  p_id                  bigint,
  p_data                jsonb,
  p_expected_updated_at timestamptz
)
returns table(out_id bigint, updated_at timestamptz, conflict boolean)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actual timestamptz;
  v_da     text := btrim(coalesce(p_data->>'da', ''));
  v_lead   text := btrim(coalesce(p_data->>'ent_lead', ''));
  -- ★ A BLANK jurisdiction IS the default rule, so '' and NULL must mean the
  --   same thing here. The panel sends '' from an unselected <select>.
  v_juris  text := nullif(btrim(coalesce(p_data->>'jurisdiction', '')), '');
begin
  if v_da = '' then
    raise exception 'a DA is required';
  end if;
  -- ★ ent_lead is NOT NULL on the table; refusing here gives the person a
  --   sentence instead of a constraint-violation code.
  if v_lead = '' then
    raise exception 'an entitlement lead is required';
  end if;

  -- ★★★ The duplicate guard. `IS NOT DISTINCT FROM` is what makes it work for
  --     the NULL case — `=` would never match two defaults, which is precisely
  --     the hole being closed.
  if exists (
    select 1 from public.da_team_routing r
     where r.tenant_id = any (auth_tenant_ids())
       and r.da = v_da
       and r.jurisdiction is not distinct from v_juris
       and (p_id is null or r.id <> p_id)
  ) then
    if v_juris is null then
      raise exception '% already has a default rule', v_da;
    else
      raise exception '% already has a rule for %', v_da, v_juris;
    end if;
  end if;

  if p_id is null then
    insert into public.da_team_routing (da, jurisdiction, ent_lead)
    values (v_da, v_juris, v_lead)
    returning da_team_routing.id, da_team_routing.updated_at
      into out_id, updated_at;
    conflict := false;
    return next; return;
  end if;

  update public.da_team_routing r set
    da           = v_da,
    jurisdiction = v_juris,
    ent_lead     = v_lead,
    -- ★★ See the header: there is no auto-touch trigger on this table, so
    --    without this line the OCC token never moves.
    updated_at   = now()
  where r.id = p_id
    and r.updated_at = p_expected_updated_at
  returning r.id, r.updated_at into out_id, updated_at;

  if found then
    conflict := false;
    return next; return;
  end if;

  select r.updated_at into v_actual
    from public.da_team_routing r where r.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  return next;
end; $function$;

-- ---------------------------------------------------------------------------
-- DELETE
-- ---------------------------------------------------------------------------
create or replace function public.bp_delete_da_team_routing_row(
  p_id                  bigint,
  p_expected_updated_at timestamptz
)
returns table(deleted boolean, conflict boolean, current_updated_at timestamptz)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_actual timestamptz;
begin
  delete from public.da_team_routing r
   where r.id = p_id
     and r.updated_at = p_expected_updated_at;
  if found then
    deleted := true; conflict := false; current_updated_at := null;
    return next; return;
  end if;

  select r.updated_at into v_actual
    from public.da_team_routing r where r.id = p_id;
  if v_actual is null then
    -- Already gone. Not a conflict — the caller wanted it gone and it is.
    deleted := false; conflict := false; current_updated_at := null;
    return next; return;
  end if;
  deleted := false; conflict := true; current_updated_at := v_actual;
  return next;
end; $function$;

-- ---------------------------------------------------------------------------
-- GRANTS — fix-455's lesson, applied at birth
-- ---------------------------------------------------------------------------
-- ★★ `revoke ... from public, anon` alone would leave `authenticated` holding
--    whatever ALTER DEFAULT PRIVILEGES grants on a new FUNCTION. Name every
--    role, then grant back the one privilege that is wanted, and verify from
--    the catalogue afterwards rather than from this file.
revoke all on function public.bp_upsert_da_team_routing_row(bigint, jsonb, timestamptz)
  from public, anon;
grant execute on function public.bp_upsert_da_team_routing_row(bigint, jsonb, timestamptz)
  to authenticated;

revoke all on function public.bp_delete_da_team_routing_row(bigint, timestamptz)
  from public, anon;
grant execute on function public.bp_delete_da_team_routing_row(bigint, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select proname, pg_get_function_identity_arguments(oid), proacl
--   from pg_proc where proname like 'bp_%da_team_routing_row';
-- select count(*) from public.da_team_routing;                    -- 14, unchanged
-- select da, jurisdiction, ent_lead from public.da_team_routing order by da;
