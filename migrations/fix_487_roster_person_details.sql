-- ===========================================================================
-- fix-487 §B/§C (P-120, P-144) — THE ROSTER EDITOR'S WRITE PATH, AND THE TWO
-- CONSTRUCTION ADMINS
-- ===========================================================================
--
-- Bobby, on P-120: *"have the ability to edit our team database so i can enter
-- their last names too."* Ruled scope: **first name / last name / email only.**
-- `name` stays on its existing rename path — it is the join key across ~1,850
-- references — and `role` is not this dialog's business either.
--
-- ---------------------------------------------------------------------------
-- ★★★ STEP 0 FOUND A LIVE SPLIT, AND IT IS WHY THIS IS A TRIGGER AND AN RPC
--     RATHER THAN AN UPDATE STATEMENT
-- ---------------------------------------------------------------------------
-- The roster is ONE ROW PER (person, role) and seven people carry two rows.
-- `first_name`, `last_name` and `email` are facts about the **PERSON**, but
-- they sit on a **ROLE ROW** — the exact trap fix-461 solved for `department`
-- and fix-462 solved for `agenda_member`, both with a sync trigger. Nobody
-- solved it for the fix-343 name fields, and prod shows the consequence:
--
--     Ana / schematic   first_name Ana, last_name Buttrey, ana@blueprintcap.com
--     Ana / da          first_name NULL, last_name NULL,   email NULL
--
-- Every other multi-row person agrees on all three. Ana's `da` row was added
-- later, and `AdminTeamTab`'s "add to this list" path sends only `{name, role}`
-- — so a person given a SECOND role silently loses their details on the new
-- row. That is the mechanism, not a one-off typo.
--
-- ★★★ AND IT HAS A LIVE CONSEQUENCE, NOT JUST AN UNTIDY TABLE.
-- `resolveRosterIdentity` (lib/selfScope) matches the signed-in address against
-- `team_members.email` and collects the roles of the rows that MATCH. Ana's
-- `da` row carries no email, so it does not match — she resolves as
-- `roles: ['schematic']` alone. Her Design Associate role is invisible to her
-- own self-scope, to My Tasks' role routing (fix-238) and to her name plate.
-- Filling the column fixes all three without touching the resolver.
--
-- ★★ SO THE EDITOR WRITES BY **NAME**, NEVER BY ROW ID — exactly like
--    `bp_set_team_department` — and a new role row INHERITS, exactly like
--    `team_members_department_inherit`. A dialog that wrote one row would
--    recreate Ana's split every time somebody edited a two-role person.
--
-- ---------------------------------------------------------------------------
-- ★ NOT A BRIDGE LOGIN. §C3: neither Steve nor David gets one; that is
--   `AddPersonDialog` + the Edge Function, and Bobby has not asked. These are
--   roster rows only, with **email NULL** — the brief is explicit that the
--   addresses are not known and must never be invented.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE SYNC TRIGGER (mirrors bp_trg_team_department_sync exactly)
-- ---------------------------------------------------------------------------
create or replace function public.bp_trg_team_person_details_sync()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- ★ INSERT: a new role row for an existing person inherits their details.
  --   Per FIELD, not all-or-nothing — a row that supplies an email and no
  --   surname should still inherit the surname.
  if TG_OP = 'INSERT' then
    if NEW.first_name is null then
      select m.first_name into NEW.first_name
        from public.team_members m
       where m.tenant_id = NEW.tenant_id and m.name = NEW.name
         and m.first_name is not null limit 1;
    end if;
    if NEW.last_name is null then
      select m.last_name into NEW.last_name
        from public.team_members m
       where m.tenant_id = NEW.tenant_id and m.name = NEW.name
         and m.last_name is not null limit 1;
    end if;
    if NEW.email is null then
      select m.email into NEW.email
        from public.team_members m
       where m.tenant_id = NEW.tenant_id and m.name = NEW.name
         and m.email is not null limit 1;
    end if;
    return NEW;
  end if;

  -- ★ UPDATE: push all three onto the person's other rows.
  if NEW.first_name is not distinct from OLD.first_name
     and NEW.last_name is not distinct from OLD.last_name
     and NEW.email    is not distinct from OLD.email then
    return null;
  end if;

  update public.team_members m
     set first_name = NEW.first_name,
         last_name  = NEW.last_name,
         email      = NEW.email
   where m.tenant_id = NEW.tenant_id
     and m.name      = NEW.name
     and m.id       <> NEW.id
     and (m.first_name is distinct from NEW.first_name
       or m.last_name  is distinct from NEW.last_name
       or m.email      is distinct from NEW.email);

  return null;
end;
$function$;

drop trigger if exists team_members_person_details_inherit on public.team_members;
create trigger team_members_person_details_inherit
  before insert on public.team_members
  for each row execute function public.bp_trg_team_person_details_sync();

drop trigger if exists team_members_person_details_sync on public.team_members;
create trigger team_members_person_details_sync
  after update of first_name, last_name, email on public.team_members
  for each row execute function public.bp_trg_team_person_details_sync();

-- ---------------------------------------------------------------------------
-- 2 — THE EDITOR'S WRITE PATH
-- ---------------------------------------------------------------------------
-- ★★★ IT CANNOT WRITE `name` OR `role`, AND THAT IS ENFORCED BY THE SIGNATURE,
--     not by the dialog. `name` is the join key (~1,850 references, no FK, no
--     cascade) and has its own rename path — `bp_rename_da` / `bp_rename_dm`
--     for the two roles that cascade, and AdminTeamTab's simple rename for the
--     rest. A details dialog that could touch either would be a second, quieter
--     way to split a person in half.
--
-- ★ SECURITY INVOKER (no `security definer`), like `bp_set_team_department`:
--   `team_members_tenant_admin_write` already restricts writes to tenant
--   admins, so the RLS policy is the gate and this function must not step
--   around it.
create or replace function public.bp_set_person_details(
  p_name       text,
  p_first_name text,
  p_last_name  text,
  p_email      text
) returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  text := nullif(btrim(coalesce(p_last_name, '')), '');
  -- ★ Addresses are compared lower-cased by `resolveRosterIdentity`, so they
  --   are STORED trimmed and lower-cased here. A stored "Ana@..." that only
  --   matches after normalisation is a row that looks wrong in Settings.
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_rows  integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address: %', p_email;
  end if;

  -- ★★ EVERY ROW FOR THE NAME, in one statement. The sync trigger above would
  --    fan a single-row update out anyway; doing it here as well means the RPC
  --    is correct even if somebody later drops the trigger, and it reports a
  --    truthful row count.
  update public.team_members m
     set first_name = v_first,
         last_name  = v_last,
         email      = v_email
   where m.tenant_id = any (public.auth_tenant_ids())
     and m.name = v_name
     and (m.first_name is distinct from v_first
       or m.last_name  is distinct from v_last
       or m.email      is distinct from v_email);
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

revoke all on function public.bp_set_person_details(text, text, text, text) from public, anon;
grant execute on function public.bp_set_person_details(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 — HEAL THE SPLIT THE TRIGGER NOW PREVENTS
-- ---------------------------------------------------------------------------
-- ★ Written as a RULE over the whole roster, not as "fix Ana". Today Ana is the
--   only person affected; a statement naming her would have to be rewritten the
--   next time, and the general form is no harder to read.
--
-- ★★ IT ONLY FILLS NULLS. A row that disagrees with its sibling is a different
--    problem — two people, or a typo — and quietly picking one would be
--    guessing. Prod has none: every other multi-row person agrees on all three.
with facts as (
  select tenant_id, name,
         max(first_name) as first_name,
         max(last_name)  as last_name,
         max(email)      as email
    from public.team_members
   group by tenant_id, name
  having count(distinct first_name) <= 1
     and count(distinct last_name)  <= 1
     and count(distinct email)      <= 1
)
update public.team_members m
   set first_name = coalesce(m.first_name, f.first_name),
       last_name  = coalesce(m.last_name,  f.last_name),
       email      = coalesce(m.email,      f.email)
  from facts f
 where f.tenant_id = m.tenant_id
   and f.name = m.name
   and (m.first_name is null and f.first_name is not null
     or m.last_name  is null and f.last_name  is not null
     or m.email      is null and f.email      is not null);

-- ---------------------------------------------------------------------------
-- 4 — THE TWO CONSTRUCTION ADMINS (§C1, approved)
-- ---------------------------------------------------------------------------
-- ★★★ EMAIL IS NULL AND MUST STAY NULL until Bobby types the real address into
--     the editor this ticket builds. The brief: *"Never invent an address."*
--
-- ★★ `name` is the roster join key and follows the house convention (the first
--    name — "Bobby", "Fisk", "Derry"), so `Steve` and `David`. The full names
--    live in first_name/last_name, which is what the avatar's initials read
--    (fix-343): **SS** for Steve Svetlik, **DR** for David Rice.
--
-- ★★★ THE COLLISION CHECK IS RUN HERE, NOT JUST BEFORE. The brief said "STOP
--     and report" if an active Steve or David appeared; measuring it in the
--     migration means the check is true at WRITE time rather than at
--     measurement time.
do $$
declare v_clash text;
begin
  select string_agg(name || '/' || role, ', ') into v_clash
    from public.team_members
   where name in ('Steve', 'David');
  if v_clash is not null then
    raise exception 'fix-487: a roster row already exists for Steve/David (%) — stopping rather than merging', v_clash;
  end if;
end $$;

insert into public.team_members
  (tenant_id, name, first_name, last_name, role, active, former, email, department)
values
  ('00000000-0000-0000-0000-000000000001', 'Steve', 'Steve', 'Svetlik',
   'ca', true, false, null, 'construction_admin'),
  ('00000000-0000-0000-0000-000000000001', 'David', 'David', 'Rice',
   'ca', true, false, null, 'construction_admin');

-- ---------------------------------------------------------------------------
-- 5 — VERIFY
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.team_members where role = 'ca';
  if v_n <> 2 then
    raise exception 'fix-487: expected 2 ca rows, found %', v_n;
  end if;

  -- ★ Every project carries a CA. §C2 — and note it needed NO backfill
  --   statement: `add column ... default 'Steve'` filled all 211 rows as a
  --   catalog change, so no row trigger fired and no `updated_at` moved.
  select count(*) into v_n from public.projects where construction_admin is null;
  if v_n <> 0 then
    raise exception 'fix-487: % projects have no construction_admin', v_n;
  end if;

  -- ★★ No person disagrees with themselves any more.
  select count(*) into v_n from (
    select name from public.team_members
     group by tenant_id, name
    having count(distinct coalesce(first_name, '~')) > 1
        or count(distinct coalesce(last_name,  '~')) > 1
        or count(distinct coalesce(email,      '~')) > 1
  ) x;
  if v_n <> 0 then
    raise exception 'fix-487: % people still hold split details across their role rows', v_n;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ★ VERIFIED AFTER COMMIT, 2026-09-03 — measured, not predicted
-- ---------------------------------------------------------------------------
--   team_members rows            47 → 49
--   role = 'ca'                  2   Steve (Steve Svetlik) · David (David Rice)
--                                    department construction_admin, email NULL
--   projects.construction_admin  211 of 211 = 'Steve'
--                                ★ NOT backfilled by a statement: `add column
--                                  ... default 'Steve'` filled every row as a
--                                  CATALOG change, so ZERO rows had updated_at
--                                  move (measured: 0 projects touched in the
--                                  30 minutes around the run, 7 distinct
--                                  updated_at values before and after). No OCC
--                                  token was invalidated and no activity row
--                                  was written — which a bulk UPDATE would have
--                                  done to all 211 (the fix-410 / fix-425
--                                  trigger-suppression dance, sidestepped).
--   split people healed          1 — Ana. Her `da` row now carries
--                                Ana / Buttrey / ana@blueprintcap.com, so
--                                `resolveRosterIdentity` matches BOTH her rows
--                                and her Design Associate role is visible to
--                                her own self-scope again.
--   split people remaining       0
