-- ===========================================================================
-- fix-479 §D (P-132) — CONSULTANTS IS THE ONLY PLACE A FIRM IS PICKED, SO IT
--                      WRITES THROUGH TO projects.external_team
-- ===========================================================================
--
-- ★★★ THE RULING, Bobby 2026-09-02: the External section leaves the Team card
-- (§A) and the Project Settings *External Team* tab goes with it (§D). After
-- this ticket there is exactly ONE control in the app that names a consultant
-- firm — the Consultants card's firm dropdown.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY THE BLOB CANNOT SIMPLY BE ABANDONED
-- ---------------------------------------------------------------------------
-- `projects.external_team` has FIVE live readers that this ticket does not
-- touch, and every one of them answers "which firm is this project waiting on":
--
--     src/lib/waitingOn.ts               resolveExternalFirm — the definition
--     src/lib/myTasksHelpers.ts          My Tasks → Waiting, per project
--     src/hooks/useWaitingOnTasks.ts     overlays the firm onto each task
--     src/lib/vendorReport.ts            the vendor forecast email
--     src/components/ProjectDetail/PermitDetailV2.tsx   waiting-on firm line
--
-- Take the two editors away and leave the blob alone and those five go stale
-- the first time somebody changes a firm — silently, because a stale firm name
-- looks exactly like a correct one. So the picker that remains has to keep the
-- blob true.
--
-- ---------------------------------------------------------------------------
-- ★★★ SERVER-SIDE, IN THE SAME TRANSACTION — NOT A SECOND CLIENT CALL
-- ---------------------------------------------------------------------------
-- The brief's rule, and it is the whole design: *"not from the client, so the
-- two can't drift."* A client that fired an `update projects` after the RPC
-- would leave the record and the blob disagreeing on every failed second call,
-- every closed tab, every lost connection. Here they commit together or not at
-- all.
--
-- ★★ THE BLOB IS A CACHE OF THE RECORD, NEVER THE OTHER WAY ROUND. Nothing in
--    this file reads the blob to decide anything. `project_consultants` is the
--    source; `external_team` is what the five readers above happen to read.
--
-- ★ AND A REMOVED CONSULTANT DOES NOT DELETE ITS KEY. There is no
--   remove-consultant control in this ticket (out of scope), so there is no
--   moment at which a deletion would be correct. Adding one now would be a
--   rule with no caller.
--
-- ---------------------------------------------------------------------------
-- ★★★ OCC: THE PROJECT'S TOKEN MOVES, DELIBERATELY, AND ONLY WHEN IT SHOULD
-- ---------------------------------------------------------------------------
-- `useUpdateProject` does OCC as `.eq('updated_at', expectedUpdatedAt)`, and
-- `projects_set_updated_at` bumps that column on every UPDATE. So this
-- write-through DOES advance the project's OCC token — and that is the correct
-- answer, not a bypass: the project row really did change, and a token that
-- did not move would be lying to the next editor.
--
-- ★★ WHAT KEEPS IT FROM BECOMING fix-341's FALSE ALARM ("modified by someone
--    else" with nobody there) is the guard on the UPDATE itself:
--
--        and (p.external_team ->> v_disc) is distinct from v_firm_name
--
--    Re-picking the firm a project already names writes NOTHING, so the token
--    does not move and no open editor is disturbed. The token only advances on
--    a change somebody actually made.
--
-- ★ AND THE CLIENT REFRESHES ITSELF: `useProjectConsultants`' shared
--   invalidator now also invalidates `queryKeys.projects(tenantId)`, so the
--   cached project row carries the new token within the same tick. On the
--   narrow race that remains — a second editor holding a token from before this
--   write — fix-99's auto-retry in `useUpdateProject` refetches and retries
--   once, which is the same recovery every other project edit already gets.
--
-- ---------------------------------------------------------------------------
-- ★ `jsonb_typeof(...) = 'object'` GUARD, because 148 of 202 projects have
--   `external_team` NULL and `null || jsonb_build_object(...)` is NULL. Without
--   it the write-through would silently do nothing on exactly the projects that
--   have no firms recorded yet — which is most of them.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — ADDING A CONSULTANT SEEDS THE BLOB KEY
-- ---------------------------------------------------------------------------
create or replace function public.bp_add_project_consultant(
  p_project_id uuid,
  p_discipline text,
  p_firm_id    uuid,
  p_phase      text default null,
  p_est_send   date default null,
  p_est_recd   date default null
)
returns table(out_id uuid, round_id uuid, updated_at timestamptz)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid;
  v_disc   text := btrim(coalesce(p_discipline, ''));
  v_phase  text := coalesce(nullif(btrim(coalesce(p_phase, '')), ''), 'Design');
  v_firm   text;
  v_cid    uuid;
  v_rid    uuid;
  v_upd    timestamptz;
begin
  select p.tenant_id into v_tenant
    from public.projects p
   where p.id = p_project_id
     and p.tenant_id = any (public.auth_tenant_ids());
  if v_tenant is null then
    raise exception 'project % not found in caller scope', p_project_id
      using errcode = 'P0002';
  end if;

  if v_disc = '' then
    raise exception 'a discipline is required';
  end if;

  -- ★★ THE DISCIPLINE IS VALIDATED AGAINST THE DIRECTORY, not against a list
  --    written here. fix-479: the firm's NAME is read out in the same lookup,
  --    because §D's write-through needs it and a second query could disagree
  --    with the one that did the validating.
  select d.name into v_firm
    from public.external_team_directory d
   where d.id = p_firm_id
     and d.tenant_id = v_tenant
     and lower(btrim(d.discipline)) = lower(v_disc);
  if v_firm is null then
    raise exception 'firm % is not a % in the directory', p_firm_id, v_disc
      using errcode = '23503';
  end if;

  insert into public.project_consultants (tenant_id, project_id, discipline, firm_id)
  values (v_tenant, p_project_id, v_disc, p_firm_id)
  returning id, project_consultants.updated_at into v_cid, v_upd;

  -- ★ Round 0 exists from the moment the consultant does.
  insert into public.project_consultant_rounds (
    tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
  ) values (
    v_tenant, v_cid, 0, v_phase, 'Scheduled', p_est_send, p_est_recd
  )
  returning id into v_rid;

  -- ★★★ fix-479 §D — WRITE THROUGH, IN THIS TRANSACTION. See the header.
  update public.projects p
     set external_team =
           (case when jsonb_typeof(p.external_team) = 'object'
                 then p.external_team else '{}'::jsonb end)
           || jsonb_build_object(v_disc, v_firm)
   where p.id = p_project_id
     and (p.external_team ->> v_disc) is distinct from v_firm;

  out_id := v_cid; round_id := v_rid; updated_at := v_upd;
  return next;
end;
$function$;

revoke all on function public.bp_add_project_consultant(uuid, text, uuid, text, date, date) from public, anon;
grant execute on function public.bp_add_project_consultant(uuid, text, uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 — CHANGING THE FIRM CHANGES THE BLOB VALUE
-- ---------------------------------------------------------------------------
-- ★ This is fix-479 §C's function with §D's write-through added. It is one
--   function and it gets one definition: splitting the two changes across two
--   files would leave whichever ran second silently reverting the first.
create or replace function public.bp_set_consultant_firm(
  p_consultant_id       uuid,
  p_firm_id             uuid,
  p_expected_updated_at timestamptz,
  -- ★★ DEFAULTS TO FALSE — "keep the rounds" is the conservative answer.
  p_clear_rounds        boolean default false
)
returns table(out_id uuid, updated_at timestamptz, conflict boolean, rounds_cleared integer)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cur      public.project_consultants%rowtype;
  v_upd      timestamptz;
  v_cleared  integer := 0;
  v_next_ix  integer;
  v_firm     text;
begin
  select * into v_cur
    from public.project_consultants c
   where c.id = p_consultant_id
     and c.tenant_id = any (public.auth_tenant_ids());
  if not found then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- ★ The firm must practise the discipline it is being booked for; fix-479
  --   reads its NAME out of the same lookup for the write-through below.
  select d.name into v_firm
    from public.external_team_directory d
   where d.id = p_firm_id
     and d.tenant_id = v_cur.tenant_id
     and lower(btrim(d.discipline)) = lower(btrim(v_cur.discipline));
  if v_firm is null then
    raise exception 'firm % is not a % in the directory', p_firm_id, v_cur.discipline
      using errcode = '23503';
  end if;

  -- ★★ fix-382: the OCC expectation is checked BEFORE anything writes.
  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; updated_at := v_cur.updated_at;
    conflict := true; rounds_cleared := 0;
    return next; return;
  end if;

  update public.project_consultants c
     set firm_id = p_firm_id
   where c.id = p_consultant_id
  returning c.updated_at into v_upd;

  if p_clear_rounds then
    -- ★★★ fix-479 §C: VOID, NOT DELETE (P-131, Bobby 2026-09-02).
    update public.project_consultant_rounds r
       set voided_at = now()
     where r.consultant_id = p_consultant_id
       and r.voided_at is null;
    get diagnostics v_cleared = row_count;

    -- ★★★ THE NEXT INDEX IS OVER ALL ROWS, VOIDED INCLUDED — the unique key
    --     does not know about voiding, so index 0 is still taken.
    select coalesce(max(r.round_index), -1) + 1 into v_next_ix
      from public.project_consultant_rounds r
     where r.consultant_id = p_consultant_id;

    insert into public.project_consultant_rounds (
      tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
    ) values (
      v_cur.tenant_id, p_consultant_id, v_next_ix, 'Design', 'Scheduled', null, null
    );
  end if;

  -- ★★★ fix-479 §D — WRITE THROUGH, IN THIS TRANSACTION. See the header.
  update public.projects p
     set external_team =
           (case when jsonb_typeof(p.external_team) = 'object'
                 then p.external_team else '{}'::jsonb end)
           || jsonb_build_object(v_cur.discipline, v_firm)
   where p.id = v_cur.project_id
     and (p.external_team ->> v_cur.discipline) is distinct from v_firm;

  out_id := p_consultant_id; updated_at := v_upd; conflict := false;
  rounds_cleared := v_cleared;
  return next;
end;
$function$;

revoke all on function public.bp_set_consultant_firm(uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.bp_set_consultant_firm(uuid, uuid, timestamptz, boolean) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- ★ Both writers carry the write-through, and neither has an overload:
-- select p.proname, count(*),
--        bool_and(pg_get_functiondef(p.oid) like '%set external_team =%') as writes_through
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('bp_add_project_consultant', 'bp_set_consultant_firm')
--  group by 1;                                        -- 2 rows, 1 each, true
--
-- ★ And the firm writer still voids rather than deletes:
-- select pg_get_functiondef(p.oid) like '%delete from%'
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'bp_set_consultant_firm';   -- false
