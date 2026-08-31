-- ===========================================================================
-- fix-460 — A TASK THAT BELONGS TO NO PERMIT (P-046)
-- ===========================================================================
--
-- Bobby, 2026-08-26, on the shim this deliberately is NOT:
--   *"I'm not 100% sure I love the idea or concept around a fake project
--     because it seems like we're putting a Band-Aid on a bigger problem… we
--     need to develop, expand, or create the ability to have the option of
--     creating a task that's not associated with a project and a permit
--     holistically, because that's a function we just need to account for."*
--
-- …and on the surface it deliberately does NOT add:
--   *"I don't know that I really want a third board lane… what I get worried of
--     is we have too many tabs and too many things in the ribbon and too many
--     tabs in every page, and then it becomes too much."*
--
-- ★★★ SO: one task concept, permit optional, blended on `discipline` — the
-- column the two existing lanes already render. Measured 2026-08-30:
-- `discipline` holds exactly `ent` (1,194) and `arch` (446), 3 nulls, and
-- `myBoard.isDesignTask` is literally `t.discipline === 'arch'`. A team task
-- carrying a discipline therefore lands in an existing lane and NO NEW BOARD
-- SURFACE EXISTS ANYWHERE. The ruling, expressed as data.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY A NEW TABLE AND NOT A NULLABLE permit_tasks.permit_id
-- ---------------------------------------------------------------------------
-- `permit_tasks.permit_id` is `integer NOT NULL` across 1,643 live rows and it
-- STAYS THAT WAY. Relaxing it would put a NULL branch through every trigger and
-- rollup that assumes permit context — bucket defaulting, the DM co-assign
-- cascade, the audit trigger, stage/cycle_idx/auto_event — before anybody could
-- create a single off-project task.
--
-- ★★ `permit_tasks` IS NOT ALTERED BY THIS MIGRATION AT ALL. No column, no
-- constraint, no trigger, no row. It becomes ONE SOURCE FEEDING THE UNION,
-- which is exactly what leaves the door open to folding the two together later
-- as a refactor rather than a prerequisite.
--
-- ---------------------------------------------------------------------------
-- ★★★ 0c — THE TRIGGER AUDIT, AND WHAT team_tasks INHERITS
-- ---------------------------------------------------------------------------
-- Eight triggers sit on `permit_tasks`. Five are table-agnostic and are reused
-- VERBATIM here; three are permit-specific and are deliberately absent.
--
--   REUSED (generic — they read only columns this table also has):
--     · default_tenant_id_to_caller   BEFORE INSERT   tenant stamping
--     · bp_set_updated_at             BEFORE UPDATE   OCC token
--     · bp_trg_task_done_at           BEFORE I/U      done/done_at from status
--     · bp_trg_task_start_date        BEFORE I/U      first-touch start date
--     · bp_trg_log_user_activity      AFTER I/U/D     reads TG_TABLE_NAME and
--                                                     to_jsonb(NEW); works as-is
--
--   NOT APPLIED, and why:
--     · bp_trg_permit_task_default_bucket — reads
--       `permit_cycles WHERE permit_id = NEW.permit_id`. Pure permit context; a
--       team task has no cycle 0. `bucket` is derived in the view instead.
--     · bp_trg_task_coassign_dm — fix-346's DA→DM cascade, keyed off the
--       permit's DA. A team task has no DA to map from.
--     · bp_audit_permit_task — writes `permit_task_audit`, whose shape is
--       permit-centric (permit_id, project_id, and a task_id that means a
--       permit task). ★ Extending it would mean altering an audit table this
--       ticket has no business touching, and the trail is not lost:
--       `bp_trg_log_user_activity` above already records every insert, update
--       and delete of a team task into `user_activity`, by table name.
--
-- ★★★ AND NO GENERATOR AND NO CLOSER. There is no `auto_event`, no `cycle_idx`,
-- no `city_acceptance_check` and no `is_auto_generated` column on this table: a
-- person always creates a team task, so `is_auto_generated` is FALSE BY
-- CONSTRUCTION rather than by default. fix-405's closer rules read permit and
-- cycle state and therefore cannot match a team task — it is not that they are
-- switched off, it is that they have nothing to match on.

-- ---------------------------------------------------------------------------
-- §A1 — THE TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.team_tasks (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null,
  text              text        not null,
  notes             text,
  assigned_to       text,
  -- ★ THE BLEND POINT. Same vocabulary as permit_tasks.discipline, because the
  --   board's two lanes are this column rendered. Constrained here because a
  --   third value would silently create the third lane Bobby ruled out.
  discipline        text        not null default 'ent'
                                check (discipline in ('arch', 'ent')),
  start_date        date,
  due_date          date,
  target_date       date,
  completion_status text        not null default 'Open'
                                check (completion_status in ('Open', 'In Progress', 'Resolved', 'Cancelled')),
  done              boolean     not null default false,
  done_at           timestamptz,
  priority          boolean     not null default false,
  sort_order        integer     not null default 0,
  created_by        uuid        default auth.uid(),
  -- ★ Chat provenance, same meaning as permit_tasks.source_message_id.
  source_message_id uuid,
  -- ★★★ A LINK BACK, NOT AN OWNER. These are deliberately NOT surfaced as
  --   `project_id` / `project_address` by the view — see the view's comment.
  --   A team task that mentions a project must still never appear in that
  --   project's view, and the safest way to guarantee that is for the link to
  --   have no rendering path at all.
  ref_project_id    uuid        references public.projects(id) on delete set null,
  ref_permit_id     integer     references public.permits(id)  on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.team_tasks is
  'fix-460 (P-046): a task with no permit. Blends into the two existing board '
  'lanes on `discipline`; never appears in a project or permit view. '
  'ref_project_id / ref_permit_id are a link back, not an owner, and are not '
  'surfaced as project_id/project_address by bp_list_tasks.';

create index if not exists team_tasks_tenant_idx on public.team_tasks (tenant_id);
create index if not exists team_tasks_open_idx
  on public.team_tasks (tenant_id, completion_status);

-- ---------------------------------------------------------------------------
-- §0c — THE FIVE GENERIC TRIGGERS, REUSED
-- ---------------------------------------------------------------------------
drop trigger if exists team_tasks_default_tenant on public.team_tasks;
create trigger team_tasks_default_tenant
  before insert on public.team_tasks
  for each row execute function public.default_tenant_id_to_caller();

drop trigger if exists team_tasks_set_updated_at on public.team_tasks;
create trigger team_tasks_set_updated_at
  before update on public.team_tasks
  for each row execute function public.bp_set_updated_at();

drop trigger if exists team_tasks_done_at on public.team_tasks;
create trigger team_tasks_done_at
  before insert or update on public.team_tasks
  for each row execute function public.bp_trg_task_done_at();

drop trigger if exists team_tasks_start_date on public.team_tasks;
create trigger team_tasks_start_date
  before insert or update on public.team_tasks
  for each row execute function public.bp_trg_task_start_date();

drop trigger if exists bp_log_user_activity on public.team_tasks;
create trigger bp_log_user_activity
  after insert or update or delete on public.team_tasks
  for each row execute function public.bp_trg_log_user_activity();

-- ---------------------------------------------------------------------------
-- §0d — RLS AND GRANTS
-- ---------------------------------------------------------------------------
-- ★★ THE PRECEDENT IS TAKEN WITH ITS REASONING, NOT ITS LETTER. Standing rule 9
-- names `permit_task_audit`: anon nothing, authenticated the minimum it needs,
-- service_role ALL. `permit_task_audit` is READ-ONLY to users, so its minimum
-- is `authenticated=rm`. `team_tasks` is a table people CREATE and EDIT rows in,
-- so its minimum is DML — the shape `da_team_routing` uses (four tenant-scoped
-- policies, one per verb). Copying `rm` literally would ship a table the app
-- cannot write to.
--
-- ★★★ AND NOTHING FOR anon, DELIBERATELY. `permit_tasks` still carries
-- `anon=r`; that is a fix-455 leftover (SELECT was left alone as a separate
-- decision), NOT a pattern to copy onto a new table. fix-455's lesson is
-- applied at birth here: name `authenticated` in the revoke too, because
-- Supabase's ALTER DEFAULT PRIVILEGES grants it everything on a new relation
-- and revoking from PUBLIC and anon does not touch it.
alter table public.team_tasks enable row level security;

drop policy if exists team_tasks_sel on public.team_tasks;
create policy team_tasks_sel on public.team_tasks
  for select using (tenant_id = any (public.auth_tenant_ids()));

drop policy if exists team_tasks_ins on public.team_tasks;
create policy team_tasks_ins on public.team_tasks
  for insert with check (tenant_id = any (public.auth_tenant_ids()));

drop policy if exists team_tasks_upd on public.team_tasks;
create policy team_tasks_upd on public.team_tasks
  for update using (tenant_id = any (public.auth_tenant_ids()))
          with check (tenant_id = any (public.auth_tenant_ids()));

drop policy if exists team_tasks_del on public.team_tasks;
create policy team_tasks_del on public.team_tasks
  for delete using (tenant_id = any (public.auth_tenant_ids()));

revoke all on public.team_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.team_tasks to authenticated;
grant all on public.team_tasks to service_role;

-- ---------------------------------------------------------------------------
-- §A3 — THE UNION, INSIDE bp_list_tasks
-- ---------------------------------------------------------------------------
-- ★★★ IT GOES IN THE RPC, NOT THE CLIENT. `bp_list_tasks` is the single read
-- every board, filter, count, band and badge is built on (useTaskTree:68). Put
-- the union here and all of them inherit it on day one and CANNOT disagree with
-- each other. A client-side merge is how two surfaces start answering the same
-- question differently — the drift fix-318 put both halves on one query to
-- avoid.
--
-- ★★★ EVERY EXISTING FIELD IS BYTE-IDENTICAL FOR A PERMIT TASK. The permit
-- branch below is the previous function body verbatim; the only addition is
-- `'source'`. When `team_tasks` is empty this function returns exactly what it
-- returned before, in the same order — which is the regression that matters
-- most and is asserted in the suite.
--
-- ★★ WHAT A TEAM TASK SENDS AS NULL, AND WHY THAT IS THE POINT:
--   permit_id, project_id, project_address, permit_type, permit_da,
--   primary_assignee — all NULL, because there is no permit to derive them
--   from. ★ A SENTINEL WOULD BE THE FAKE PERMIT BOBBY REJECTED, wearing a
--   different costume: `permit_id = -1` or `project_address = ''` is a
--   Band-Aid that every consumer then has to know about. NULL is the honest
--   answer and TypeScript's nullability is what forces each consumer to say
--   what it does with it.
--
--   ★★★ AND `primary_assignee` BEING NULL IS LOAD-BEARING. It is what makes an
--   unassigned team task UNCLAIMED BY CONSTRUCTION under fix-458's predicate:
--   the resolver has no ent_lead and no da to fall back to, so the task lands
--   in the Unclaimed queue rather than vanishing. No edit to that predicate.
--
--   ★★ `ref_project_id` IS NOT EMITTED AS `project_id`. That is what makes §B3
--   true by construction: a project view filters on project_id, so a team task
--   can never match one however it is linked.
--
-- ★ `bucket` is derived rather than stored: 'arch' -> 'de', 'ent' -> 'pm',
--   matching what bp_trg_permit_task_default_bucket produces for a permit task
--   in the same phase. Only permit views read `bucket` (PermitDetailV2) plus one
--   safe ternary in TaskDetailEditor, so nothing depends on it here.
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
    -- ===================== permit tasks (unchanged) =====================
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
        -- fix-304: the only addition. Lets the bell fold a bot task and the
        -- flip that spawned it into one row (register #18).
        'created_at',      t.created_at,
        'sort_order',      t.sort_order,
        'assigned_to',     t.assigned_to,
        'waiting_on',      t.waiting_on,
        'priority',        COALESCE(t.priority, false),
        'notes',           t.notes,
        'is_auto_generated', COALESCE(t.is_auto_generated, false),
        'auto_event',      t.auto_event,
        -- ★★ fix-337: why the SYSTEM closed it, NULL when a person did.
        'auto_closed_reason', t.auto_closed_reason,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch'
               THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id),
        -- ★ fix-460: the ONLY new field. Everything above is untouched.
        'source',          'permit'
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits  p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)

    UNION ALL

    -- ========================= team tasks (new) =========================
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
        -- ★★ FALSE BY CONSTRUCTION, not by default: a person always creates a
        --    team task and this table has no generator.
        'is_auto_generated', false,
        'auto_event',      NULL,
        'auto_closed_reason', NULL,
        -- ★★★ NULL, and that is what makes an unassigned team task UNCLAIMED.
        'primary_assignee', NULL,
        'co_assignees',    '[]'::jsonb,
        'source',          'team'
      ) AS obj
    FROM public.team_tasks tt
    WHERE tt.tenant_id = ANY (v_tenants)
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ★ The grant model bp_list_tasks already had; restated because CREATE OR
--   REPLACE keeps the ACL but a future re-create from this file should not
--   silently widen it.
revoke all on function public.bp_list_tasks() from public, anon;
grant execute on function public.bp_list_tasks() to authenticated;

-- ---------------------------------------------------------------------------
-- §B5 — CREATING ONE
-- ---------------------------------------------------------------------------
-- ★ OCC-guarded upsert in the house shape (bp_upsert_dm_da_group_row /
--   bp_upsert_da_team_routing_row): `conflict` returned as a VALUE, invoker
--   rights so the four RLS policies above are the authorisation.
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
      source_message_id, ref_project_id, ref_permit_id)
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
      (nullif(btrim(coalesce(p_data->>'ref_permit_id','')),''))::integer)
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
    ref_permit_id     = (nullif(btrim(coalesce(p_data->>'ref_permit_id','')),''))::integer
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
-- §B1 — THE STATUS FLIP
-- ---------------------------------------------------------------------------
-- ★★ A FOCUSED SINGLE-COLUMN RPC RATHER THAN A REUSE OF THE UPSERT, for the
-- reason fix-434 gives about the whole status path: the checkbox and the chip
-- fire in BURSTS, and an OCC token that must be read, sent and re-read between
-- clicks is precisely what makes a burst lose writes. A status flip is one
-- column and last-write-wins is correct for it — `useSetTaskStatus`'s optimistic
-- overlay already collapses a burst into one call before this is reached.
--
-- ★ This is what lets the checkbox and the chip stay ONE write path with two
--   entry points: the branch lives in that one hook, not in two components.
create or replace function public.bp_set_team_task_status(
  p_id     uuid,
  p_status text
)
returns timestamptz
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_updated timestamptz;
BEGIN
  IF p_status NOT IN ('Open', 'In Progress', 'Resolved', 'Cancelled') THEN
    RAISE EXCEPTION 'unknown task status: %', p_status;
  END IF;

  UPDATE public.team_tasks tt
     SET completion_status = p_status
   WHERE tt.id = p_id
  RETURNING tt.updated_at INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no team task %', p_id;
  END IF;
  RETURN v_updated;
END;
$function$;

revoke all on function public.bp_set_team_task_status(uuid, text) from public, anon;
grant execute on function public.bp_set_team_task_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select count(*) from public.permit_tasks;                     -- 1643, unchanged
-- select count(*) from public.team_tasks;                       -- 0, nothing seeded
-- select is_nullable from information_schema.columns
--  where table_name='permit_tasks' and column_name='permit_id'; -- NO, unchanged
-- select coalesce(string_agg(x,', '),'(none)') from pg_class,
--   unnest(relacl::text[]) x where oid='public.team_tasks'::regclass;
--   -- authenticated=arwd, service_role=ALL, NO anon
