-- ===========================================================================
-- fix-462 — THE AGENDA (P-045)
-- ===========================================================================
--
-- ★★★ AN AGENDA ITEM IS A `team_tasks` ROW CARRYING A FLAG. Nothing is copied,
-- nothing syncs, and "put it on the agenda" and "assign it" are two properties
-- of ONE object. There is no second task concept, no parallel table and no
-- list-to-list sync — those are the things Bobby rejected.
--
-- Bobby, 2026-08-26 / 2026-08-30 — every design question, already ruled:
--   · **One running list shown as two** — open/active and closed/completed.
--     NOT per-meeting. No meeting-date grouping, no per-meeting archive.
--   · *"It would look very similar to the milestones in MyTask so that it fits
--     and blends with our existing system."*
--   · **The statuses are the TASK statuses**, unchanged: Not started /
--     In progress / Waiting on / Done. No second vocabulary enters the app.
--   · **Membership is a per-person checkbox, not a department** — gating by
--     department means adding one person to the meeting moves their whole
--     department, or you make an exception anyway.
--   · Agenda is the ONE new ribbon entry he sanctioned, and it is a VIEW.
--
-- MEASURED ON PROD 2026-08-30 (0a, all confirmed):
--   · `team_tasks` exists, **0 rows**, 20 columns as documented.
--   · `bp_list_tasks` unions it AND carries `source`. ✓
--   · NO agenda-shaped column, relation or function anywhere (0 / 0 / 0).
--   · `permit_tasks` 1,643 rows — **untouched by this migration entirely**.
--
-- ★★★ NOBODY IS FLAGGED BY THIS MIGRATION. Every `agenda_member` ships false
-- and every `agenda` ships false. Bobby ticks the six boxes himself — the
-- fix-458 / fix-461 pattern.

-- ---------------------------------------------------------------------------
-- §A1 — THE FLAG ON THE ITEM
-- ---------------------------------------------------------------------------
-- ★★ NOT NULL DEFAULT FALSE, and there is deliberately NO agenda-specific
--    status column. Bobby's ruling: **the open half is `not done`, the closed
--    half is `done`**. A second status vocabulary is exactly what he refused,
--    and `completion_status` already says everything an agenda item needs.
alter table public.team_tasks
  add column if not exists agenda boolean not null default false;

comment on column public.team_tasks.agenda is
  'fix-462 (P-045): this team task is on the weekly agenda. An agenda item IS a '
  'team task — nothing is copied and nothing syncs. The open list is '
  '`agenda and not done`; the closed list is `agenda and done`. There is no '
  'agenda-specific status: the task statuses are the agenda statuses.';

-- ★ The agenda screen's only query is (tenant, agenda) — cheap, and it keeps
--   the read off any index-less scan as team_tasks grows.
create index if not exists team_tasks_agenda_idx
  on public.team_tasks (tenant_id, agenda) where agenda;

-- ---------------------------------------------------------------------------
-- §B1 — MEMBERSHIP
-- ---------------------------------------------------------------------------
alter table public.team_members
  add column if not exists agenda_member boolean not null default false;

comment on column public.team_members.agenda_member is
  'fix-462 (P-045): this PERSON attends the weekly agenda meeting. Gates ONE '
  'ribbon entry and nothing else — it is not a permission. A fact about the '
  'PERSON, not the role row: bp_trg_team_agenda_member_sync keeps every row '
  'sharing a name in agreement. Set it through bp_set_team_agenda_member, '
  'which works by NAME.';

-- ---------------------------------------------------------------------------
-- ★★★ 0b — THE ROSTER TRAP, AND WHY THIS IS A SIBLING RATHER THAN A REUSE
-- ---------------------------------------------------------------------------
--
-- `team_members` is ONE ROW PER (PERSON, ROLE). Six people carry two rows —
-- Bobby / Briana / Miles (ent+ent_lead), Derry / Lindsay (dm+schematic), Dave
-- (director+schematic). So "Dave is on the agenda as a director but not as a
-- schematic designer" is expressible and is nonsense, exactly as it was for
-- `department` in fix-461.
--
-- ★★ THE MECHANISM IS fix-461's, DELIBERATELY: propagate across every row
-- sharing the name IN THE SAME TRANSACTION, and make a new row inherit. It is a
-- property of the TABLE, not a convention the editor follows, so it holds for
-- hand SQL, an import, an Edge Function and fix-436's add-a-person alike.
--
-- ★★★ BUT IT CANNOT BE THE SAME FUNCTION, AND THE REASON IS THE COLUMN'S TYPE.
-- `department` is NULLABLE, so fix-461's insert branch could say "inherit only
-- when the new row did not specify one" (`if NEW.department is null`). This
-- column is **NOT NULL DEFAULT FALSE**: there is no "unspecified" value —
-- a new row for an existing member arrives `false`, which is indistinguishable
-- from a deliberate "not a member", and would leave that person HALF ON THE
-- AGENDA the moment fix-436 gives them a second role.
--
-- So the insert branch here is stronger: **an existing person's value always
-- wins.** If the person is already known, their siblings decide; only a genuinely
-- new person keeps what the insert asked for. That is the person-level invariant
-- stated as a rule rather than inferred from a null.
--
-- ★ Generalising fix-461's function to take the column as an argument was the
--   alternative, and it was rejected: it would mean rewriting a shipped trigger
--   (with dynamic SQL) that fix-461's suite pins, to save a copy of nine lines.
create or replace function public.bp_trg_team_agenda_member_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sibling boolean;
begin
  if TG_OP = 'INSERT' then
    -- ★★ AN EXISTING PERSON'S VALUE WINS — see the header for why this differs
    --    from fix-461's null-check. A DA who becomes a DM keeps whatever the
    --    person already is, on both rows.
    select m.agenda_member into v_sibling
      from public.team_members m
     where m.tenant_id = NEW.tenant_id
       and m.name      = NEW.name
     limit 1;
    if found then
      NEW.agenda_member := v_sibling;
    end if;
    return NEW;
  end if;

  if NEW.agenda_member is not distinct from OLD.agenda_member then
    return null;
  end if;

  -- ★ `is distinct from` terminates the recursion: the second pass finds every
  --   sibling already holding the value and matches nothing. Depth 2, always.
  update public.team_members m
     set agenda_member = NEW.agenda_member
   where m.tenant_id = NEW.tenant_id
     and m.name      = NEW.name
     and m.id       <> NEW.id
     and m.agenda_member is distinct from NEW.agenda_member;

  return null;
end;
$$;

comment on function public.bp_trg_team_agenda_member_sync() is
  'fix-462: a person cannot be half on the agenda. Propagates any '
  'agenda_member change across every team_members row sharing the name, and '
  'makes a new row inherit an existing person''s value. fix-461''s mechanism, '
  'with a stronger insert branch because the column is NOT NULL.';

drop trigger if exists team_members_agenda_inherit on public.team_members;
create trigger team_members_agenda_inherit
  before insert on public.team_members
  for each row execute function public.bp_trg_team_agenda_member_sync();

drop trigger if exists team_members_agenda_sync on public.team_members;
create trigger team_members_agenda_sync
  after update of agenda_member on public.team_members
  for each row execute function public.bp_trg_team_agenda_member_sync();

-- ---------------------------------------------------------------------------
-- THE WRITE PATH — fix-461's, for fix-461's reasons
-- ---------------------------------------------------------------------------
-- ★★ INVOKER. `team_members` already carries `team_members_tenant_admin_write`,
--    gating ALL verbs on `is_tenant_admin(tenant_id)`, so the DATABASE refuses a
--    non-admin and `readOnly` only hides the buttons. A SECURITY DEFINER copy
--    would be a weaker second policy.
-- ★★★ IT TAKES A NAME, NEVER A ROW ID: the unit of membership is the PERSON,
--    and an id would invite a caller to think in role rows.
create or replace function public.bp_set_team_agenda_member(
  p_name   text,
  p_member boolean
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  if p_member is null then
    raise exception 'agenda membership is true or false, never null';
  end if;

  update public.team_members m
     set agenda_member = p_member
   where m.tenant_id = any (public.auth_tenant_ids())
     and m.name = v_name
     and m.agenda_member is distinct from p_member;
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

revoke all on function public.bp_set_team_agenda_member(text, boolean) from public, anon;
grant execute on function public.bp_set_team_agenda_member(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- §A3 — THE FLAG REACHES THE CLIENT
-- ---------------------------------------------------------------------------
-- ★★★ ONLY THE TEAM BRANCH GAINS A KEY. The permit branch is byte-for-byte what
-- fix-460 shipped, so `bp_list_tasks` still returns permit tasks BYTE-IDENTICALLY
-- — the property fix-460 established and this ticket re-proves. A permit task
-- has no `agenda` key at all, which reads as falsy and is correct: a permit task
-- cannot be an agenda item, because an agenda item is a team task.
--
-- ★★ AND THAT IS THE WHOLE OF THE INTEGRATION. Because the union already
-- carries team tasks, an agenda item reaches every board, filter, count and date
-- band for free — including its assignee's own board, which is Bobby's *"nothing
-- agreed in the meeting dies in a list nobody reopens"*. NO BOARD CODE IS EDITED.
create or replace function public.bp_list_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_result  jsonb;
BEGIN
  SELECT COALESCE(
           jsonb_agg(obj ORDER BY project_address, permit_id, sort_order, created_at),
           '[]'::jsonb
         )
    INTO v_result
  FROM (
    -- ============= permit tasks (UNCHANGED — byte-identical) =============
    SELECT
      pr.address AS project_address,
      t.permit_id,
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id',              t.id,
        'permit_id',       t.permit_id,
        'project_id',      p.project_id,
        'project_address', pr.address,
        'permit_type',     p.type,
        'permit_da',       p.da,
        'parent_task_id',  t.parent_task_id,
        'discipline',      COALESCE(t.discipline, 'ent'),
        'bucket',          t.bucket,
        'text',            t.text,
        'status',          t.completion_status,
        'start_date',      t.start_date,
        'target_date',     t.target_date,
        'due_date',        t.due_date,
        'done_at',         t.done_at,
        'created_at',      t.created_at,
        'sort_order',      t.sort_order,
        'assigned_to',     t.assigned_to,
        'waiting_on',      t.waiting_on,
        'priority',        COALESCE(t.priority, false),
        'notes',           t.notes,
        'is_auto_generated', COALESCE(t.is_auto_generated, false),
        'auto_event',      t.auto_event,
        'auto_closed_reason', t.auto_closed_reason,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch'
               THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id),
        'source',          'permit'
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits  p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)

    UNION ALL

    -- ===================== team tasks (+ `agenda`) =======================
    SELECT
      NULL::text    AS project_address,
      NULL::integer AS permit_id,
      tt.sort_order,
      tt.created_at,
      jsonb_build_object(
        'id',              tt.id,
        'permit_id',       NULL,
        'project_id',      NULL,
        'project_address', NULL,
        'permit_type',     NULL,
        'permit_da',       NULL,
        'parent_task_id',  NULL,
        'discipline',      tt.discipline,
        'bucket',          CASE WHEN tt.discipline = 'arch' THEN 'de' ELSE 'pm' END,
        'text',            tt.text,
        'status',          tt.completion_status,
        'start_date',      tt.start_date,
        'target_date',     tt.target_date,
        'due_date',        tt.due_date,
        'done_at',         tt.done_at,
        'created_at',      tt.created_at,
        'sort_order',      tt.sort_order,
        'assigned_to',     tt.assigned_to,
        'waiting_on',      NULL,
        'priority',        COALESCE(tt.priority, false),
        'notes',           tt.notes,
        'is_auto_generated', false,
        'auto_event',      NULL,
        'auto_closed_reason', NULL,
        'primary_assignee', NULL,
        'co_assignees',    '[]'::jsonb,
        'source',          'team',
        -- ★ fix-462: the ONLY new key, and only on this branch.
        'agenda',          tt.agenda
      ) AS obj
    FROM public.team_tasks tt
    WHERE tt.tenant_id = ANY (v_tenants)
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

revoke all on function public.bp_list_tasks() from public, anon;
grant execute on function public.bp_list_tasks() to authenticated;

-- ---------------------------------------------------------------------------
-- §C3 — "ADD TO AGENDA" ON THE WRITE PATH
-- ---------------------------------------------------------------------------
-- fix-460's upsert, gaining one optional key. ★ Absent means "leave it alone"
-- on an update and `false` on an insert, so every existing caller behaves
-- exactly as it did.
create or replace function public.bp_upsert_team_task(
  p_id                  uuid,
  p_data                jsonb,
  p_expected_updated_at timestamptz
)
returns table(out_id uuid, updated_at timestamptz, conflict boolean)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_actual timestamptz;
  v_text   text := btrim(coalesce(p_data->>'text', ''));
  v_disc   text := coalesce(nullif(btrim(coalesce(p_data->>'discipline','')),''), 'ent');
BEGIN
  IF v_text = '' THEN
    RAISE EXCEPTION 'a task needs a description';
  END IF;
  IF v_disc NOT IN ('arch', 'ent') THEN
    RAISE EXCEPTION 'discipline must be arch or ent';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.team_tasks (
      text, notes, assigned_to, discipline,
      start_date, due_date, target_date,
      completion_status, priority, sort_order,
      source_message_id, ref_project_id, ref_permit_id, agenda)
    VALUES (
      v_text,
      nullif(btrim(coalesce(p_data->>'notes','')),''),
      nullif(btrim(coalesce(p_data->>'assigned_to','')),''),
      v_disc,
      (p_data->>'start_date')::date,
      (p_data->>'due_date')::date,
      (p_data->>'target_date')::date,
      coalesce(nullif(btrim(coalesce(p_data->>'completion_status','')),''), 'Open'),
      coalesce((p_data->>'priority')::boolean, false),
      coalesce((p_data->>'sort_order')::integer, 0),
      (nullif(btrim(coalesce(p_data->>'source_message_id','')),''))::uuid,
      (nullif(btrim(coalesce(p_data->>'ref_project_id','')),''))::uuid,
      (nullif(btrim(coalesce(p_data->>'ref_permit_id','')),''))::integer,
      coalesce((p_data->>'agenda')::boolean, false))
    RETURNING team_tasks.id, team_tasks.updated_at INTO out_id, updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.team_tasks tt SET
    text              = v_text,
    notes             = nullif(btrim(coalesce(p_data->>'notes','')),''),
    assigned_to       = nullif(btrim(coalesce(p_data->>'assigned_to','')),''),
    discipline        = v_disc,
    start_date        = (p_data->>'start_date')::date,
    due_date          = (p_data->>'due_date')::date,
    target_date       = (p_data->>'target_date')::date,
    completion_status = coalesce(nullif(btrim(coalesce(p_data->>'completion_status','')),''), tt.completion_status),
    priority          = coalesce((p_data->>'priority')::boolean, tt.priority),
    sort_order        = coalesce((p_data->>'sort_order')::integer, tt.sort_order),
    ref_project_id    = (nullif(btrim(coalesce(p_data->>'ref_project_id','')),''))::uuid,
    ref_permit_id     = (nullif(btrim(coalesce(p_data->>'ref_permit_id','')),''))::integer,
    -- ★ Absent = unchanged, so no existing caller can clear the flag by omission.
    agenda            = coalesce((p_data->>'agenda')::boolean, tt.agenda)
  WHERE tt.id = p_id
    AND tt.updated_at = p_expected_updated_at
  RETURNING tt.id, tt.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  SELECT tt.updated_at INTO v_actual FROM public.team_tasks tt WHERE tt.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END;
$function$;

revoke all on function public.bp_upsert_team_task(uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.bp_upsert_team_task(uuid, jsonb, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select count(*) from public.team_members where agenda_member;   -- 0
-- select count(*) from public.team_tasks  where agenda;           -- 0
-- select count(*) from public.permit_tasks;                       -- 1643, untouched
-- select name, count(distinct agenda_member) from public.team_members
--   group by name having count(distinct agenda_member) > 1;       -- zero rows, always
