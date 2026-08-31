-- ===========================================================================
-- fix-461 — THE ROSTER GETS AN AXIS IT HAS NEVER HAD: department (P-045 prereq)
-- ===========================================================================
--
-- Bobby, 2026-08-26 — the four, final:
--   **Policy · Design & Entitlements · Acquisitions · Underwriting**
-- He first said *"accounting, which is like EJ, Greg and them"* and then settled
-- on **Underwriting**. Newest-first applies: ★ ACCOUNTING IS NOT ONE OF THE
-- FOUR and must not be restored, and there is no fifth.
--
-- Why the column exists at all — Bobby: *"[Lucas is] a director, like Dave, but
-- two different departments."* `role` mixes DISCIPLINE with SENIORITY and
-- simply cannot express "director of X".
--
-- ★★★ THIS MIGRATION ASSIGNS NOBODY. Every one of the 46 rows gets NULL. Bobby
-- fills the departments in himself, exactly as he is filling fix-458's fifteen
-- entitlement leads. There is no backfill and no default in this file.
--
-- MEASURED ON PROD 2026-08-30 (0a, all confirmed):
--   · 46 roster rows, 41 active, 40 distinct people, 35 distinct ACTIVE people
--   · nine roles: da 15(11) · viewer 7(7) · acq_lead 6(5) · dm 5 · schematic 4
--     · ent 3 · ent_lead 3 · acq 2 · director 1
--   · NO department column, enum, view or function anywhere (0 / 0 / 0)
--   · `viewer` is doing duty as "unclassified" for seven real people:
--     Darin, EJ, Eric, Greg, Keenan, Lucas, Taylor — the CEO and the President
--     among them. ★ REPORTED, NOT ACTED ON: no role moves in this ticket.
--
-- ---------------------------------------------------------------------------
-- ★★★ 0c — HOW A PERSON CANNOT CARRY TWO DEPARTMENTS
-- ---------------------------------------------------------------------------
--
-- THE TRAP: `team_members` is ONE ROW PER (PERSON, ROLE), not one row per
-- person. Six people carry two rows each, measured today:
--     Bobby, Briana, Miles   ent + ent_lead
--     Derry, Lindsay         dm  + schematic
--     Dave                   director + schematic
-- Department is a fact about a PERSON, and A1 puts it on a ROLE row. So "Dave
-- is Design & Entitlements as a schematic designer but Policy as a director" is
-- expressible in the schema, and it is nonsense.
--
-- ★★★ THE DECISION: keep the column on the row (A1), and make the split
-- IMPOSSIBLE IN THE DATABASE rather than merely unlikely in the editor.
--
-- A trigger propagates any department change to every row that shares the
-- person's name, inside the same transaction. That is deliberately NOT a
-- convention the editor follows — it is a property of the table, so it holds
-- for a hand-written UPDATE, a future import, an Edge Function, and the
-- add-a-person path alike. An editor-only guarantee would have been exactly the
-- kind of rule somebody breaks from the SQL console at 11pm.
--
-- ★★ AND IT TERMINATES, WHICH IS THE PART TO CHECK. Updating row A fires the
-- trigger, which updates row B; that fires the trigger for B, which looks for
-- rows still DISTINCT FROM the new value and finds none, because A already
-- holds it. Depth two, always.
--
-- ★ INSERT INHERITS, for the same reason. fix-436's add-a-person creates a
-- SECOND row for somebody who already has one (a DA who becomes a DM keeps
-- both). Without the insert branch, that new row would arrive NULL beside a
-- classified sibling — a split created by the one path most likely to create
-- it.

-- ---------------------------------------------------------------------------
-- §A1 — THE COLUMN
-- ---------------------------------------------------------------------------
-- ★ NULLABLE, AND NULL IS A FIRST-CLASS STATE. "Not yet classified" is where
--   all 46 rows start and where most of them will sit until Bobby works
--   through them. It is not an error and nothing may treat it as one.
alter table public.team_members
  add column if not exists department text;

-- ★★ The four, and only the four. A fifth value cannot be typed, imported or
--    inserted — the vocabulary is Bobby's and the database holds him to it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.team_members'::regclass
       and conname  = 'team_members_department_check'
  ) then
    alter table public.team_members
      add constraint team_members_department_check
      check (department is null or department in (
        'policy', 'design_entitlements', 'acquisitions', 'underwriting'
      ));
  end if;
end $$;

comment on column public.team_members.department is
  'fix-461 (P-045 prereq): which of Bobby''s four departments this PERSON '
  'belongs to — policy | design_entitlements | acquisitions | underwriting. '
  'NULL = not yet classified, a first-class state. ★ It is a fact about the '
  'PERSON, not the role row: bp_trg_team_department_sync keeps every row '
  'sharing a name in agreement, so a person can never hold two departments. '
  'Set it through bp_set_team_department, which works by NAME.';

-- ---------------------------------------------------------------------------
-- ★★★ 0c's MECHANISM — the trigger that makes a split impossible
-- ---------------------------------------------------------------------------
create or replace function public.bp_trg_team_department_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if TG_OP = 'INSERT' then
    -- ★ A NEW ROW FOR AN EXISTING PERSON INHERITS THEIR DEPARTMENT. This is the
    --   add-a-person path (fix-436): a DA who also becomes a DM gets a second
    --   row, and without this it would arrive NULL beside a classified sibling.
    if NEW.department is null then
      select m.department into NEW.department
        from public.team_members m
       where m.tenant_id = NEW.tenant_id
         and m.name      = NEW.name
         and m.department is not null
       limit 1;
    end if;
    return NEW;
  end if;

  -- UPDATE: nothing to do unless the department actually moved.
  if NEW.department is not distinct from OLD.department then
    return null;
  end if;

  -- ★★ Propagate to the person's OTHER rows, in this transaction.
  --    `is distinct from` is what terminates the recursion: the second pass
  --    finds every sibling already holding the value and matches nothing.
  update public.team_members m
     set department = NEW.department
   where m.tenant_id = NEW.tenant_id
     and m.name      = NEW.name
     and m.id       <> NEW.id
     and m.department is distinct from NEW.department;

  return null;
end;
$$;

comment on function public.bp_trg_team_department_sync() is
  'fix-461: a person cannot hold two departments. Propagates any department '
  'change to every team_members row sharing the name, and makes a new row '
  'inherit an existing person''s department. Recursion terminates at depth 2.';

drop trigger if exists team_members_department_inherit on public.team_members;
create trigger team_members_department_inherit
  before insert on public.team_members
  for each row execute function public.bp_trg_team_department_sync();

drop trigger if exists team_members_department_sync on public.team_members;
create trigger team_members_department_sync
  after update of department on public.team_members
  for each row execute function public.bp_trg_team_department_sync();

-- ---------------------------------------------------------------------------
-- §0d — THE WRITE PATH
-- ---------------------------------------------------------------------------
-- ★★ INVOKER, BECAUSE THE TABLE ALREADY DECIDES. `team_members` carries
--    `team_members_tenant_admin_write` — ALL verbs gated on
--    `is_tenant_admin(tenant_id)` — so the DATABASE refuses a non-admin and the
--    panel's `readOnly` only hides the buttons. A SECURITY DEFINER function here
--    would be a weaker second copy of a policy that already works, and would
--    quietly let a non-admin write.
--
-- ★★★ IT TAKES A NAME, NOT AN ID, because the unit of a department is the
--    PERSON. Handing it a row id would invite a caller to think in rows, which
--    is precisely the mistake 0c exists to prevent. (The trigger would still
--    catch it — this just stops the wrong idea being expressible.)
create or replace function public.bp_set_team_department(
  p_name       text,
  p_department text
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_dep  text := nullif(btrim(coalesce(p_department, '')), '');
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  -- ★ NULL is a legitimate value to SET, not just to start at: Bobby must be
  --   able to un-classify somebody he classified by mistake.
  if v_dep is not null and v_dep not in (
       'policy', 'design_entitlements', 'acquisitions', 'underwriting') then
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
$$;

revoke all on function public.bp_set_team_department(text, text) from public, anon;
grant execute on function public.bp_set_team_department(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select count(*) from public.team_members;                       -- 46
-- select count(*) from public.team_members where department is null; -- 46
-- select name, count(distinct department) from public.team_members
--   group by name having count(distinct department) > 1;          -- zero rows, always
-- select conname from pg_constraint
--  where conrelid='public.team_members'::regclass and conname like '%department%';
