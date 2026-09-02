-- ===========================================================================
-- fix-479 §C (P-131) — "CLEAR THE ROUNDS" VOIDS THEM, IT DOES NOT DELETE THEM
-- ===========================================================================
--
-- ★★★ THE RULING, Bobby 2026-09-02: **void.** This accepts the objection CC
-- raised inside fix-475's own migration and shipped anyway:
--
--   fix-475: *"the dominant case is a CORRECTION, not a succession… so this
--   deletes the history and leaves the record exactly as
--   bp_add_project_consultant would have created it."*
--
-- ★★ THE OBJECTION, RESTATED SO IT IS NOT RE-LITIGATED LATER. Both halves of
-- fix-475's reasoning survive — a correction really is the dominant case, and
-- the dates entered against a wrong firm really are about the wrong firm. What
-- did not survive is the CONSEQUENCE it drew from them. "This should never have
-- been recorded" is a claim about what the screen shows, not a licence to
-- destroy the rows: the person clicking *Clear — wrong firm* is telling the app
-- which of two readings is right, and the app has no way to know they clicked
-- the wrong button until after the rows are gone.
--
-- ★★★ SO THE SCREEN IS UNCHANGED AND THE ROWS SURVIVE. Every reader below
-- excludes `voided_at is not null`, so the pill, the history list, the round
-- count and the current-status view read EXACTLY as they did under `delete`.
-- The only difference is that the rows are still there afterwards.
--
-- ---------------------------------------------------------------------------
-- ★★ NO `voided_by`, AND THAT IS THE BRIEF'S OWN RULE APPLIED
-- ---------------------------------------------------------------------------
-- The brief says to add one *"if the table already tracks actors the same way —
-- match the existing audit columns, don't invent a pattern"*. Measured on prod
-- 2026-09-02: `project_consultant_rounds` has `created_at` and `updated_at` and
-- NOTHING ELSE; `project_consultants` is the same. Neither table has ever
-- recorded who did anything. So there is no pattern to match, and inventing a
-- half-audit on one column of one table would be the first actor column in this
-- family — a decision that belongs to a ticket about auditing, not to this one.
-- `voided_at` alone, matching the two timestamps already there.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE ROUND INDEX AFTER A VOID: VOIDED ROUNDS KEEP THEIRS
-- ---------------------------------------------------------------------------
-- `project_consultant_rounds_index_unique` is UNIQUE (consultant_id,
-- round_index) over EVERY row — it does not know about `voided_at` and this
-- migration does not teach it. So the fresh round the clear branch creates
-- CANNOT reuse index 0: it takes `max(round_index) + 1` over ALL rounds,
-- voided ones included. The sequence therefore continues rather than restarting,
-- which is also the honest reading — round 3 happened, it was voided, and the
-- round after it is round 4.
--
-- ★ The person never sees the number. The history table renders `phase` (the
--   editable round label), not `round_index`, and the fresh round is labelled
--   `Design` exactly as fix-475 labelled the one it used to insert at index 0.
--
-- ★ `bp_set_consultant_status`'s REOPEN branch already computes its next index
--   over all rounds with no `voided_at` filter, and it MUST STAY THAT WAY —
--   adding one there would make it collide with a voided row.
--
-- ---------------------------------------------------------------------------
-- ★ RECOVERABILITY IS A SQL `update` FOR NOW. fix-479 ships no un-void UI (out
--   of scope, stated in the brief). Bringing a voided round back is:
--       update public.project_consultant_rounds
--          set voided_at = null
--        where consultant_id = '…' and voided_at is not null;
--   …which is a thing that can be done at all, which is the entire point.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE COLUMN
-- ---------------------------------------------------------------------------
alter table public.project_consultant_rounds
  add column if not exists voided_at timestamptz null;

comment on column public.project_consultant_rounds.voided_at is
  'fix-479 (P-131): set by bp_set_consultant_firm(p_clear_rounds := true). A '
  'voided round is excluded by every reader — the view, the history list and '
  'the round count — so the screen reads as it did when this was a DELETE. '
  'Voided rounds KEEP their round_index (the unique is over all rows), so a '
  'new round continues the sequence rather than restarting at 0.';

-- ★ The partial index is the one every reader below actually uses: "the latest
--   LIVE round for this consultant". The existing full index stays — the
--   next-index arithmetic still scans all rows, voided included.
create index if not exists project_consultant_rounds_live_idx
  on public.project_consultant_rounds (consultant_id, round_index desc)
  where voided_at is null;

-- ---------------------------------------------------------------------------
-- 2 — THE VIEW. Same columns, same order, two `voided_at is null` filters.
-- ---------------------------------------------------------------------------
-- ★★ `security_invoker = true` is RE-DECLARED rather than assumed. CREATE OR
--    REPLACE VIEW is not documented to preserve reloptions, and a view that
--    silently fell back to definer would read every tenant's consultants
--    through the caller's RLS-free eyes. Verified after apply, below.
create or replace view public.project_consultant_current
with (security_invoker = true) as
  select c.id as consultant_id,
         c.tenant_id,
         c.project_id,
         c.discipline,
         c.firm_id,
         d.name   as firm_name,
         d.active as firm_active,
         c.notes,
         c.updated_at,
         r.id          as round_id,
         r.round_index,
         r.phase,
         r.status,
         r.est_send,
         r.sent,
         r.est_recd,
         r.recd,
         r.updated_at  as round_updated_at,
         (select count(*)
            from public.project_consultant_rounds x
           where x.consultant_id = c.id
             and x.voided_at is null) as round_count
    from public.project_consultants c
    join public.external_team_directory d on d.id = c.firm_id
    left join lateral (
      select r2.id, r2.tenant_id, r2.consultant_id, r2.round_index, r2.phase,
             r2.status, r2.est_send, r2.sent, r2.est_recd, r2.recd,
             r2.created_at, r2.updated_at
        from public.project_consultant_rounds r2
       where r2.consultant_id = c.id
         and r2.voided_at is null
       order by r2.round_index desc, r2.id desc
       limit 1
    ) r on true;

-- ---------------------------------------------------------------------------
-- 3 — THE THREE "LATEST ROUND" WRITERS SKIP VOIDED ROUNDS
-- ---------------------------------------------------------------------------
-- ★★★ WHY ALL THREE AND NOT JUST THE FIRM ONE. Each of these picks "the latest
--     round" with the same `order by round_index desc, id desc limit 1`. Leave
--     any one of them unfiltered and it targets a VOIDED row — a status flip or
--     a date edit would land on history the screen says does not exist, and the
--     OCC token it hands back would be a voided round's. Same query, same
--     filter, three places.

create or replace function public.bp_set_consultant_status(
  p_consultant_id       uuid,
  p_status              text,
  p_expected_updated_at timestamptz
)
returns table(out_id uuid, round_id uuid, updated_at timestamptz, appended boolean, conflict boolean)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant  uuid;
  v_status  text := btrim(coalesce(p_status, ''));
  v_cur     public.project_consultant_rounds%rowtype;
  v_rid     uuid;
  v_upd     timestamptz;
  v_next_ix integer;
  v_today   date := (now() at time zone 'America/Los_Angeles')::date;
begin
  -- ★★★ THE VALIDATION LIST, AND IT IS THE THIRD PLACE THE LADDER LIVES.
  --     fix-464 found that bp_set_team_department validated independently of
  --     its CHECK constraint, so widening the constraint alone shipped a
  --     picker whose options the writer rejected.
  if v_status not in ('Scheduled', 'Pending', 'Received') then
    raise exception 'unknown consultant status: %', p_status
      using errcode = '22023';
  end if;

  select c.tenant_id into v_tenant
    from public.project_consultants c
   where c.id = p_consultant_id
     and c.tenant_id = any (public.auth_tenant_ids());
  if v_tenant is null then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- ★★★ THE LATEST LIVE ROUND, AND EVERY WRITE BELOW TARGETS THIS ROW AND NO
  --     OTHER. fix-479: `voided_at is null` — a voided round is not the latest
  --     round, it is not any round at all as far as this app is concerned.
  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
     and r.voided_at is null
   order by r.round_index desc, r.id desc
   limit 1;
  if not found then
    raise exception 'consultant % has no rounds', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- ★★ fix-382: CHECK THE OCC EXPECTATION BEFORE ANYTHING WRITES. As a WHERE
  --    clause it would work for the in-place branch and silently skip the
  --    check on the APPEND branch, which is the half that creates history.
  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; round_id := v_cur.id;
    updated_at := v_cur.updated_at; appended := false; conflict := true;
    return next; return;
  end if;

  if v_cur.status = 'Received' and v_status = 'Scheduled' then
    -- ★★★ REOPEN. The finished round is left BYTE-FOR-BYTE ALONE: no UPDATE
    --     names it, so not even its updated_at moves.
    --
    -- ★★★ fix-479: NO `voided_at` FILTER HERE, DELIBERATELY. The unique is
    --     (consultant_id, round_index) over EVERY row, voided included, so the
    --     next index has to be computed over every row too. Filtering here
    --     would hand back an index a voided row already owns and the insert
    --     would raise.
    select coalesce(max(r.round_index), -1) + 1 into v_next_ix
      from public.project_consultant_rounds r
     where r.consultant_id = p_consultant_id;

    insert into public.project_consultant_rounds (
      tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
    ) values (
      v_tenant, p_consultant_id, v_next_ix,
      case when v_next_ix = 1 then 'Cycle 1' else 'Cycle ' || v_next_ix::text end,
      'Scheduled', null, null
    )
    returning id, project_consultant_rounds.updated_at into v_rid, v_upd;

    out_id := p_consultant_id; round_id := v_rid; updated_at := v_upd;
    appended := true; conflict := false;
    return next; return;
  end if;

  update public.project_consultant_rounds r
     set status = v_status,
         -- ★ Auto-stamp, and only when the slot is empty: re-entering Pending
         --   after a correction must not overwrite the date it really went.
         sent = case
                  when v_status = 'Scheduled' then null
                  when v_status in ('Pending', 'Received')
                    then coalesce(r.sent, v_today)
                  else r.sent
                end,
         recd = case
                  when v_status in ('Scheduled', 'Pending') then null
                  when v_status = 'Received' then coalesce(r.recd, v_today)
                  else r.recd
                end
   where r.id = v_cur.id
  returning r.id, r.updated_at into v_rid, v_upd;

  out_id := p_consultant_id; round_id := v_rid; updated_at := v_upd;
  appended := false; conflict := false;
  return next;
end;
$function$;

create or replace function public.bp_set_consultant_date(
  p_consultant_id       uuid,
  p_field               text,
  p_value               date,
  p_expected_updated_at timestamptz
)
returns table(out_id uuid, round_id uuid, updated_at timestamptz, conflict boolean)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_field text := btrim(lower(coalesce(p_field, '')));
  v_cur   public.project_consultant_rounds%rowtype;
  v_rid   uuid;
  v_upd   timestamptz;
begin
  if v_field not in ('est_send', 'sent', 'est_recd', 'recd') then
    raise exception 'unknown consultant date field: %', p_field
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.project_consultants c
     where c.id = p_consultant_id
       and c.tenant_id = any (public.auth_tenant_ids())
  ) then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- fix-479: the latest LIVE round.
  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
     and r.voided_at is null
   order by r.round_index desc, r.id desc
   limit 1;
  if not found then
    raise exception 'consultant % has no rounds', p_consultant_id
      using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; round_id := v_cur.id;
    updated_at := v_cur.updated_at; conflict := true;
    return next; return;
  end if;

  update public.project_consultant_rounds r
     set est_send = case when v_field = 'est_send' then p_value else r.est_send end,
         sent     = case when v_field = 'sent'     then p_value else r.sent     end,
         est_recd = case when v_field = 'est_recd' then p_value else r.est_recd end,
         recd     = case when v_field = 'recd'     then p_value else r.recd     end
   where r.id = v_cur.id
  returning r.id, r.updated_at into v_rid, v_upd;

  out_id := p_consultant_id; round_id := v_rid; updated_at := v_upd;
  conflict := false;
  return next;
end;
$function$;

create or replace function public.bp_set_consultant_phase(
  p_consultant_id       uuid,
  p_phase               text,
  p_expected_updated_at timestamptz
)
returns table(out_id uuid, round_id uuid, updated_at timestamptz, conflict boolean)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phase text := btrim(coalesce(p_phase, ''));
  v_cur   public.project_consultant_rounds%rowtype;
  v_rid   uuid;
  v_upd   timestamptz;
begin
  if v_phase = '' then
    raise exception 'a round needs a label';
  end if;

  if not exists (
    select 1 from public.project_consultants c
     where c.id = p_consultant_id
       and c.tenant_id = any (public.auth_tenant_ids())
  ) then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- fix-479: the latest LIVE round.
  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
     and r.voided_at is null
   order by r.round_index desc, r.id desc
   limit 1;
  if not found then
    raise exception 'consultant % has no rounds', p_consultant_id
      using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; round_id := v_cur.id;
    updated_at := v_cur.updated_at; conflict := true;
    return next; return;
  end if;

  update public.project_consultant_rounds r
     set phase = v_phase
   where r.id = v_cur.id
  returning r.id, r.updated_at into v_rid, v_upd;

  out_id := p_consultant_id; round_id := v_rid; updated_at := v_upd;
  conflict := false;
  return next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4 — THE ONE THAT MATTERS: `delete` BECOMES `set voided_at = now()`
-- ---------------------------------------------------------------------------
-- ★★★ `rounds_cleared` KEEPS ITS NAME AND ITS NUMBER. It counted deleted rows;
--     it now counts voided ones. Same integer for the same click, so no caller
--     changes — and "cleared" is still the right word for what the person did.
--     They cleared the screen. The database kept the rows.
--
-- ★ The `insert` afterwards is unchanged in intent — fix-474's invariant is
--   that a consultant ALWAYS has at least one live round, or
--   bp_set_consultant_status raises 'has no rounds' and the view renders a
--   consultant with no status at all. Only its INDEX moves: see the header.

create or replace function public.bp_set_consultant_firm(
  p_consultant_id       uuid,
  p_firm_id             uuid,
  p_expected_updated_at timestamptz,
  -- ★★ DEFAULTS TO FALSE — "keep the rounds" is the conservative answer, and a
  --    caller that forgets the argument must not void history.
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
begin
  select * into v_cur
    from public.project_consultants c
   where c.id = p_consultant_id
     and c.tenant_id = any (public.auth_tenant_ids());
  if not found then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- ★ Unchanged from fix-474: the firm must actually practise the discipline
  --   it is being booked for.
  if not exists (
    select 1 from public.external_team_directory d
     where d.id = p_firm_id
       and d.tenant_id = v_cur.tenant_id
       and lower(btrim(d.discipline)) = lower(btrim(v_cur.discipline))
  ) then
    raise exception 'firm % is not a % in the directory', p_firm_id, v_cur.discipline
      using errcode = '23503';
  end if;

  -- ★★ fix-382: the OCC expectation is checked BEFORE anything writes. fix-475
  --    justified this by "the write below can DELETE rows"; it can no longer
  --    delete anything, and the check stays exactly where it is — a stale token
  --    must not void rows either, and the rule was never about how bad the
  --    write was.
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
    -- ★★★ VOID, NOT DELETE (P-131, Bobby 2026-09-02).
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
-- ★ The view is still security_invoker — the thing this file re-declares
--   rather than assumes:
-- select reloptions from pg_class
--  where oid = 'public.project_consultant_current'::regclass;   -- {security_invoker=true}
--
-- ★ No reader mentions rounds without the filter:
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname like 'bp_set_consultant%'
--    and pg_get_functiondef(p.oid) not like '%voided_at is null%';   -- 0 rows
--
-- ★ EXACTLY ONE bp_set_consultant_firm — the fix-438 overload trap. The arg
--   list is unchanged from fix-475, so CREATE OR REPLACE really replaces:
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'bp_set_consultant_firm';   -- 1
--
-- ★ Nothing was voided by this migration; it changes behaviour, not data:
-- select count(*) from public.project_consultant_rounds
--  where voided_at is not null;                                          -- 0
