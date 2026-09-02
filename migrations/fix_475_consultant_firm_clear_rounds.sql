-- ===========================================================================
-- fix-475 (P-116) — CHANGING THE FIRM MAY CLEAR THE ROUNDS BEHIND IT
-- ===========================================================================
--
-- ★★★ THE RULING, Bobby 2026-09-01, and it is the one NEW behaviour in this
-- ticket — it is not in the approved mock:
--
--   *"maybe i selected the wrong firm at first and need to correct it… i could
--    say firm a, but then we change to firm b partial way and cancel/delete any
--    previous data."*
--
-- ★★ THE REASON, so it is not simplified away later: **the dominant case is a
-- CORRECTION, not a succession.** The wrong firm was picked and the record
-- should never have said otherwise — so the rounds behind it are not history,
-- they are a mistake. But the other case is real too: a genuine hand-off, where
-- those rounds happened and belong to the firm that did them.
--
-- ★★★ SO IT IS NEITHER AUTOMATIC NOR SILENT. Only the person doing it knows
-- which of the two they are doing, so the app asks. This function makes the
-- ANSWER atomic; the question is the UI's.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE OLD SIGNATURE IS DROPPED FIRST, AND fix-438 IS WHY
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE FUNCTION` with a NEW ARGUMENT LIST does not replace
-- anything — it creates an OVERLOAD. PostgREST then cannot resolve
-- `bp_set_consultant_firm` and every call fails with "could not choose the best
-- candidate function". fix-438 shipped exactly that and had to come back for
-- it. So the three-argument version is dropped explicitly before the
-- four-argument one is created.
--
-- ★ Dropping is safe here: fix-474's version has been live for hours, is called
--   from one hook, and nothing else in the database references it.

drop function if exists public.bp_set_consultant_firm(uuid, uuid, timestamptz);

create or replace function public.bp_set_consultant_firm(
  p_consultant_id       uuid,
  p_firm_id             uuid,
  p_expected_updated_at timestamptz,
  -- ★★ DEFAULTS TO FALSE — "keep the rounds" is the conservative answer, and a
  --    caller that forgets the argument must not destroy history.
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

  -- ★★ fix-382: the OCC expectation is checked BEFORE anything writes, and it
  --    matters more here than anywhere else in this family — the write below
  --    can DELETE rows, and a stale token must not reach it.
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
    -- ★★★ "CLEAR" MEANS BACK TO ONE EMPTY ROUND, NOT ZERO ROUNDS. fix-474's
    --     invariant is that a consultant always has at least one round —
    --     `bp_set_consultant_status` raises 'has no rounds' otherwise, and the
    --     current-status view would render a consultant with no status at all.
    --     So this deletes the history and leaves the record exactly as
    --     `bp_add_project_consultant` would have created it.
    --
    -- ★★ AND THE DATES GO WITH IT. A correction means the firm was wrong, so
    --    the dates entered against it were about the wrong firm too. Keeping
    --    them would leave "Est send 1 Oct" attached to a firm nobody ever sent
    --    anything to — the exact half-truth this ruling exists to remove.
    delete from public.project_consultant_rounds r
     where r.consultant_id = p_consultant_id;
    get diagnostics v_cleared = row_count;

    insert into public.project_consultant_rounds (
      tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
    ) values (
      v_cur.tenant_id, p_consultant_id, 0, 'Design', 'Scheduled', null, null
    );
  end if;

  out_id := p_consultant_id; updated_at := v_upd; conflict := false;
  rounds_cleared := v_cleared;
  return next;
end;
$function$;

revoke all on function public.bp_set_consultant_firm(uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.bp_set_consultant_firm(uuid, uuid, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- ★ EXACTLY ONE bp_set_consultant_firm — an overload is the failure fix-438
--   recorded, and it does not surface until a call is made:
-- select count(*), string_agg(oid::regprocedure::text, ' | ')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='bp_set_consultant_firm';   -- 1
--
-- ★ Nothing was written: this ticket seeds nothing.
-- select count(*) from public.project_consultants;                    -- 0
