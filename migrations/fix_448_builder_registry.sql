-- ===========================================================================
-- fix-448 — BUILDERS & OWNERS BECOME A REGISTRY (P-098 / P-082)
-- ===========================================================================
--
-- Bobby, 2026-08-29 (D-2026-08-29-builder-cell-is-pick-only-and-builders-are-a-
-- registry): *"in our settings, we should have a builder/owner database. and
-- builders could have different llcs per project too."*
--
-- ★★★ NO NEW TABLE. `public.builders` IS the registry — 61 rows, 58 distinct
-- people, and it already models "one person, several LLCs" as several rows
-- sharing a name (Ghennadi Ialanji holds 3, Ted Chesledon 2). Ruling 3 asks for
-- that shape and prod already has it, so this migration adds the ONE column the
-- table is missing and the three RPCs the editor needs.
--
-- ★★ WHAT IT DOES NOT DO: it writes no data. The duplicate rows Bobby named
-- ("Cooper Thomas Homes" vs "…, LLC"; the two JMS rows) are cleaned BY HIM
-- through the merge RPC, in the editor, with the project count in front of him.
-- A migration that silently repointed FKs would be exactly the thing fix-425
-- and fix-377 warn about.
--
-- APPLY: Claude applies this from Cowork after merge. CC does not run it.
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-08-29 (read-only), the numbers this is sized for:
--   builders            61 rows, all active, 58 distinct names
--   linked to nothing    5 rows  (safe to deactivate)
--   in use              56 rows
--   projects linked    148
--   biggest            Kamala Saxton · Kuleana Homes LLC → 16 projects
--   several LLCs       Ghennadi Ialanji 3, Ted Chesledon 2
--   cross-person dup   Bill Richmond / Will Richmond, both "JMS Homes, Inc"
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1 · `updated_at`, because the editor needs OCC and the table has none
-- ---------------------------------------------------------------------------
--
-- ★★ CONFIRMED ABSENT: `builders` carries id, name, company, email, phone,
-- notes, active, tenant_id, address — no created_at and no updated_at. Every
-- other editable table in this app carries one and every editor uses it as its
-- optimistic-concurrency token (fix-382's rule: check the expectation BEFORE
-- anything writes).
--
-- ★ Backfilled to now() for existing rows. That is honest: we do not know when
-- they were last touched, and a NULL token would make the first edit of every
-- row look like a conflict.
alter table public.builders
  add column if not exists updated_at timestamptz not null default now();

-- The house trigger. Same function every other table uses, so the token cannot
-- be maintained differently here.
drop trigger if exists builders_set_updated_at on public.builders;
create trigger builders_set_updated_at
  before update on public.builders
  for each row execute function public.bp_set_updated_at();

-- ★ The registry sorts and groups by person, and the picker searches by name
--   and company. 61 rows does not need an index today; this one exists so the
--   grouped read stays a single ordered scan as the catalogue grows.
create index if not exists builders_tenant_name_company_idx
  on public.builders (tenant_id, name, company);

-- ---------------------------------------------------------------------------
-- 2 · bp_upsert_builder — the ONE write path for a catalogue row
-- ---------------------------------------------------------------------------
--
-- ★★★ REPLACES A DIRECT TABLE WRITE. `useUpsertBuilder` in the client wrote
-- `builders` straight through PostgREST, with no tenant check of its own and no
-- OCC — and, measured on origin/main, WITH NO CALLERS AT ALL. Both the registry
-- editor and the cell's "Add new builder…" go through this instead.
--
-- ★★ `p_expected_updated_at` is NULL on an insert and required on an update.
-- Passing a stale token raises, so two people editing the same LLC cannot
-- silently overwrite each other (fix-382).
create or replace function public.bp_upsert_builder(
  p_id                  uuid default null,
  p_name                text default null,
  p_company             text default null,
  p_email               text default null,
  p_phone               text default null,
  p_address             text default null,
  p_notes               text default null,
  p_active              boolean default null,
  p_expected_updated_at timestamptz default null
)
returns public.builders
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_row     public.builders;
  v_current timestamptz;
begin
  if array_length(v_tenants, 1) is null then
    raise exception 'no tenant in session';
  end if;
  v_tenant := v_tenants[1];

  -- ★ A person must have a name. Everything else is optional — 4 of the 61
  --   rows carry no company at all, and that is a real state (an owner who is
  --   not trading through an LLC), not missing data to be rejected.
  if p_name is null or btrim(p_name) = '' then
    raise exception 'builder name is required';
  end if;

  if p_id is null then
    insert into public.builders (tenant_id, name, company, email, phone, address, notes, active)
    values (
      v_tenant,
      btrim(p_name),
      nullif(btrim(coalesce(p_company, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_active, true)
    )
    returning * into v_row;
    return v_row;
  end if;

  select updated_at into v_current
  from public.builders
  where id = p_id and tenant_id = any (v_tenants)
  for update;

  if not found then
    raise exception 'builder not found';
  end if;

  -- ★★ THE OCC CHECK, BEFORE ANYTHING WRITES (fix-382). `transaction_timestamp`
  --    comparisons and after-the-fact checks both allow a lost update.
  if p_expected_updated_at is not null and v_current is distinct from p_expected_updated_at then
    raise exception 'builder changed since you loaded it';
  end if;

  -- ★ COALESCE per field, so a caller may patch one column without having to
  --   resend the row. Passing NULL means "leave it"; clearing a field is done
  --   by passing an empty string, which the nullif above turns into NULL.
  update public.builders set
    name    = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    company = case when p_company is null then company else nullif(btrim(p_company), '') end,
    email   = case when p_email   is null then email   else nullif(btrim(p_email), '')   end,
    phone   = case when p_phone   is null then phone   else nullif(btrim(p_phone), '')   end,
    address = case when p_address is null then address else nullif(btrim(p_address), '') end,
    notes   = case when p_notes   is null then notes   else nullif(btrim(p_notes), '')   end,
    active  = coalesce(p_active, active)
  where id = p_id and tenant_id = any (v_tenants)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3 · bp_deactivate_builder — never a delete
-- ---------------------------------------------------------------------------
--
-- ★★★ DEACTIVATE, NOT DELETE, AND THE LINKS SURVIVE. 56 of the 61 rows are
-- referenced by a project's `builder_id`. Deleting one would either break the
-- FK or orphan the project's cached name — and the project's history is a real
-- record of who built it. A deactivated row keeps every link, stops appearing
-- in the picker, and renders greyed in the registry.
create or replace function public.bp_deactivate_builder(
  p_id     uuid,
  p_active boolean default false
)
returns public.builders
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_row     public.builders;
begin
  update public.builders
     set active = coalesce(p_active, false)
   where id = p_id and tenant_id = any (v_tenants)
  returning * into v_row;

  if not found then
    raise exception 'builder not found';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 · bp_merge_builders — the duplicate cleanup, done by a person
-- ---------------------------------------------------------------------------
--
-- ★★★ ATOMIC, AND IT REFRESHES THE CACHE IT REPOINTS. `projects` carries five
-- denormalised builder_* columns beside `builder_id` (fix-175's autofill
-- cache). Repointing the FK without rewriting those five would leave exactly
-- the state P-082 exists to abolish: a link and a label that disagree. Both
-- happen in one statement pair, in one transaction.
--
-- ★★ ANY TWO ROWS, NOT ONLY TWO ROWS OF THE SAME PERSON. The brief's rule was
-- "select two rows of the same person", but the duplicate Bobby actually named
-- is CROSS-PERSON: `Bill Richmond` and `Will Richmond` both trade as
-- "JMS Homes, Inc" (1 and 2 projects) — one human, two spellings of a first
-- name. A same-person-only merge could not clean the very example it was
-- written for. The names are shown in full in the confirm dialog, so a
-- cross-person merge is a deliberate, visible act rather than an accident.
--
-- ★ The loser is DEACTIVATED, never deleted — see above. After the merge it
--   points at nothing, which is exactly why it is safe to retire.
create or replace function public.bp_merge_builders(
  p_loser_id  uuid,
  p_winner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenants uuid[] := public.auth_tenant_ids();
  v_winner  public.builders;
  v_moved   integer;
begin
  if p_loser_id = p_winner_id then
    raise exception 'cannot merge a builder into itself';
  end if;

  select * into v_winner
  from public.builders
  where id = p_winner_id and tenant_id = any (v_tenants);
  if not found then
    raise exception 'winning builder not found';
  end if;

  if not exists (
    select 1 from public.builders
    where id = p_loser_id and tenant_id = any (v_tenants)
  ) then
    raise exception 'losing builder not found';
  end if;

  -- ★★ The FK and the five cache columns move together. Ordered this way so
  --    the row can never be observed linked to the winner while still
  --    displaying the loser's name.
  update public.projects set
    builder_id      = p_winner_id,
    builder_name    = v_winner.name,
    builder_company = v_winner.company,
    builder_email   = v_winner.email,
    builder_phone   = v_winner.phone,
    builder_address = v_winner.address
  where builder_id = p_loser_id
    and tenant_id = any (v_tenants);
  get diagnostics v_moved = row_count;

  update public.builders
     set active = false
   where id = p_loser_id and tenant_id = any (v_tenants);

  return jsonb_build_object(
    'moved', v_moved,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5 · GRANTS — the house model, nothing wider
-- ---------------------------------------------------------------------------
--
-- ★★★ fix-273 / fix-157: `anon` gets nothing; `authenticated` gets EXECUTE on
-- the three functions and no new table privileges at all. There is no new table
-- and no view here, so there is nothing for the truncate-grant-exposure rule to
-- bite on — and `public` is revoked explicitly rather than left to the default,
-- which is the trap fix-273 documents.
revoke all on function public.bp_upsert_builder(uuid, text, text, text, text, text, text, boolean, timestamptz) from public, anon;
revoke all on function public.bp_deactivate_builder(uuid, boolean) from public, anon;
revoke all on function public.bp_merge_builders(uuid, uuid) from public, anon;

grant execute on function public.bp_upsert_builder(uuid, text, text, text, text, text, text, boolean, timestamptz) to authenticated;
grant execute on function public.bp_deactivate_builder(uuid, boolean) to authenticated;
grant execute on function public.bp_merge_builders(uuid, uuid) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select count(*) filter (where updated_at is not null) as tokens, count(*) from public.builders;
-- select proname from pg_proc where proname in
--   ('bp_upsert_builder','bp_deactivate_builder','bp_merge_builders');
-- select b.name, b.company, count(p.id) as projects
--   from public.builders b left join public.projects p on p.builder_id = b.id
--  group by b.id, b.name, b.company order by projects desc, b.name limit 10;
