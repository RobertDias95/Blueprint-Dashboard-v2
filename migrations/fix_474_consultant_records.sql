-- ===========================================================================
-- fix-474 (P-116) — THE CONSULTANT RECORD AND ITS ROUNDS · DATA LAYER ONLY
-- ===========================================================================
--
-- ★★★ NOT APPLIED. Written for review; Claude applies from Cowork. There is no
-- UI in this ticket and no data write in this file — the seed is a separate,
-- commented-out, unapplied file (fix_474_seed_from_external_team_PENDING_APPROVAL.sql).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- Bobby: *"the overall goal here is to help get more clarity for our
-- acquisitions team… what it doesn't show is consultants. Are the consultants
-- complete? Are we waiting on consultants? What's the status?"*
--
-- ★ The audience is ACQUISITIONS, not entitlements. Schedule Health answers
--   "is the permit late"; nothing answers "are we blocked on a consultant",
--   which is what a land person asks before committing.
--
-- ---------------------------------------------------------------------------
-- ★★★ MEASURED ON PROD 2026-09-01, BEFORE ANY OF THIS WAS WRITTEN
-- ---------------------------------------------------------------------------
--   projects                                             202
--   with a non-empty projects.external_team               53
--   (project, discipline) firm pairs inside them         159
--   external_team_directory rows                          16
--   disciplines in the directory                           7
--     Arborist, Civil, Energy, Geotech, Landscape, Structural, Surveyor
--   permit_tasks.waiting_on rows                         111   (28 still open)
--
-- ★★★ AND THE NUMBER THAT DECIDED THE FOREIGN KEY: of those 159 free-text
-- firm names, **159 resolve to a directory row** on (name, discipline),
-- case-insensitively. **ZERO unmatched.** fix-227's "the directory populates
-- the picker" has actually held in practice, so making the firm a REFERENCE
-- rather than a string orphans nothing and closes P-100 (consultant firms are
-- free text) on the one surface that was about to multiply them.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY TWO TABLES AND NOT ONE WITH A JSONB ARRAY OF ROUNDS
-- ---------------------------------------------------------------------------
-- The ruling is *"it holds a list of ROUNDS… nothing is ever overwritten"*, and
-- rows are how you store an append-only list.
--
--   1. A JSONB array is REWRITTEN WHOLE on every status change. "Nothing is
--      ever overwritten" would then be a property of the code rather than of
--      the storage, and any bug that rebuilds the array silently drops history.
--   2. ★★ THIS REPO HAS ALREADY BEEN BITTEN BY EXACTLY THAT. fix-402:
--      `parseUnitTypes` is a WHITELIST and both editors write the array back,
--      so an unrecognised key is DELETED on the next save. Consultant rounds
--      are history; that failure mode is not survivable here.
--   3. §6's property — *no RPC path ever mutates a round that is not the
--      latest* — is a WHERE clause against rows. Against an array it is careful
--      surgery that has to be re-got-right in every writer.
--   4. ★★★ THE PRECEDENT THE BRIEF ITSELF NAMES: this "mirrors correction
--      rounds", and correction rounds are `permit_cycles` — ROWS, ordered by
--      `cycle_index`. Matching that shape means the app's existing instincts
--      (an index, a latest-row derivation) transfer instead of being reinvented.
--
-- ★ THE COST, STATED: reading "current status" is a join rather than a field.
--   Paid for once by `project_consultant_current` below, so the UI ticket
--   consumes a derivation it does not have to re-write.

-- ---------------------------------------------------------------------------
-- §1 — THE CONSULTANT RECORD: one per (project, discipline)
-- ---------------------------------------------------------------------------
create table if not exists public.project_consultants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  project_id  uuid not null references public.projects(id) on delete cascade,

  -- ★ The discipline vocabulary is NOT invented here and NOT constrained to a
  --   literal list. It is whatever `external_team_directory` carries (7 today),
  --   and it is validated at the write path against that table — so adding an
  --   eighth discipline to the directory needs no migration. A CHECK with seven
  --   literals would be an eighth place for that vocabulary to drift
  --   (fix-464's lesson: it already lives in five places for departments).
  discipline  text not null,

  -- ★★★ THE FIRM IS A REFERENCE, AND THIS IS WHERE P-100 GETS CLOSED. A
  --   free-text firm name is how one consultant becomes three spellings.
  --   Measured above: all 159 existing pairs already resolve, so nothing is
  --   lost by requiring it.
  --
  -- ★★ ON DELETE RESTRICT, deliberately, and it is the answer to "handle a
  --   directory row going inactive without orphaning a consultant":
  --     · INACTIVE is not deletion. `external_team_directory.active` is a
  --       flag; an inactive row still resolves through this FK, so an existing
  --       consultant keeps naming its firm for ever. That is the normal path
  --       and it needs no code at all.
  --     · DELETION is refused while a consultant points at the row. SET NULL
  --       would silently forget which firm did the work — losing history to
  --       tidy a directory — and CASCADE would delete the consultant record
  --       outright. RESTRICT makes the admin deactivate instead, which is what
  --       the flag is for.
  firm_id     uuid not null references public.external_team_directory(id)
                on delete restrict,

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ★ One consultant per discipline per project. The unit of the record IS the
  --   discipline (the ruling), so two Structural records on one project is not
  --   a state to support — a second engagement is a ROUND.
  constraint project_consultants_one_per_discipline
    unique (project_id, discipline)
);

comment on table public.project_consultants is
  'fix-474 (P-116): one consultant engagement per (project, discipline), for '
  'the Acquisitions consultant-status column. Holds no status of its own — the '
  'current status is the latest row in project_consultant_rounds. The firm is '
  'a REFERENCE to external_team_directory, which is where P-100 (consultant '
  'firms are free text) is closed.';

-- ---------------------------------------------------------------------------
-- §2 — THE ROUNDS: append-only history
-- ---------------------------------------------------------------------------
create table if not exists public.project_consultant_rounds (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  consultant_id  uuid not null
                   references public.project_consultants(id) on delete cascade,

  -- ★ 0-based like permit_cycles.cycle_index, and the ordering key for
  --   "latest". Not a timestamp: two rounds created in one transaction would
  --   tie, and fix-338 recorded that `now()` is CONSTANT inside a transaction.
  round_index    integer not null,

  -- ★★ THE LABEL IS EDITABLE FREE TEXT, seeded from a counter — Bobby: *"in
  --    case multiple cycles handle in one round"*, so `Cycle 1 & 2` must be
  --    typeable. Deliberately NOT a registry: it is a caption on a row the
  --    user owns and IT IS NOT A JOIN KEY, which is exactly what made the firm
  --    name dangerous. The two free-text decisions look alike and are opposite.
  phase          text not null,

  -- ★★★ THE STATUS LADDER. This vocabulary has changed THREE times
  --     (Preparing/Sent/Complete → Preparing/In progress/Complete →
  --     Scheduled/Pending/Received). It will change again.
  --     ★ The CHECK here, the TS union, and `bp_set_consultant_status`'s own
  --       validation are THREE places — fix-464 found a fifth place for
  --       departments the hard way, so a test asserts all three agree.
  status         text not null default 'Scheduled'
                   check (status in ('Scheduled', 'Pending', 'Received')),

  -- ★★ FOUR DATES, ALWAYS. The UI shows two of them per status; the record
  --    keeps all four, so stepping backwards and forwards never destroys a
  --    date the user typed:
  --      Scheduled   EST SEND  · EST RECEIVED
  --      Pending     SENT      · EST RECEIVED     (sent auto-stamped)
  --      Received    SENT      · RECEIVED         (recd auto-stamped)
  est_send       date,
  sent           date,
  est_recd       date,
  recd           date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint project_consultant_rounds_index_unique
    unique (consultant_id, round_index)
);

comment on table public.project_consultant_rounds is
  'fix-474 (P-116): one round of a consultant engagement. APPEND-ONLY — the '
  'only transition that creates a row is Received -> Scheduled (a reopen); '
  'every other transition edits the round in hand. Current status = the row '
  'with the highest round_index.';

create index if not exists project_consultants_project_idx
  on public.project_consultants (tenant_id, project_id);
create index if not exists project_consultant_rounds_consultant_idx
  on public.project_consultant_rounds (consultant_id, round_index desc);

-- ---------------------------------------------------------------------------
-- §3 — updated_at triggers (the OCC token both tables carry)
-- ---------------------------------------------------------------------------
create or replace function public.project_consultants_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_consultants_touch on public.project_consultants;
create trigger project_consultants_touch
  before update on public.project_consultants
  for each row execute function public.project_consultants_set_updated_at();

drop trigger if exists project_consultant_rounds_touch on public.project_consultant_rounds;
create trigger project_consultant_rounds_touch
  before update on public.project_consultant_rounds
  for each row execute function public.project_consultants_set_updated_at();

-- ---------------------------------------------------------------------------
-- §4 — RLS
-- ---------------------------------------------------------------------------
-- ★★★ NO PERMISSION TIER, AND THAT IS THE RULING, NOT AN OMISSION.
-- Bobby, 2026-09-01: anyone who can edit may reopen. He named four people who
-- are NOT on a given project's team precisely because they cover for each
-- other, and the app has no read-only tier at all (`profiles_role_check`
-- allows only admin|editor). A per-project rule would be the only one on this
-- screen and the named exceptions defeat it immediately.
--
-- ★ So this takes `project_holds`' shape (tenant members, all verbs) rather
--   than `external_team_directory`'s (admin-only writes). The DIRECTORY is
--   admin-managed; an engagement on a project is ordinary project work.
alter table public.project_consultants        enable row level security;
alter table public.project_consultant_rounds  enable row level security;

drop policy if exists project_consultants_tenant_policy on public.project_consultants;
create policy project_consultants_tenant_policy
  on public.project_consultants
  for all
  using (tenant_id = any (public.auth_tenant_ids()))
  with check (tenant_id = any (public.auth_tenant_ids()));

drop policy if exists project_consultant_rounds_tenant_policy on public.project_consultant_rounds;
create policy project_consultant_rounds_tenant_policy
  on public.project_consultant_rounds
  for all
  using (tenant_id = any (public.auth_tenant_ids()))
  with check (tenant_id = any (public.auth_tenant_ids()));

-- ★ fix-273 / fix-455's posture: anon gets nothing, authenticated gets the
--   verbs RLS then filters. TRUNCATE is never granted.
revoke all on public.project_consultants       from public, anon;
revoke all on public.project_consultant_rounds from public, anon;
grant select, insert, update, delete on public.project_consultants       to authenticated;
grant select, insert, update, delete on public.project_consultant_rounds to authenticated;

-- ---------------------------------------------------------------------------
-- §5 — THE CURRENT-STATUS VIEW (the derivation the UI ticket consumes)
-- ---------------------------------------------------------------------------
-- ★★★ `security_invoker = true` — the standing house rule since the
-- TRUNCATE-grant incident. Without it the view runs as its OWNER and quietly
-- bypasses the RLS above, which is how a tenant boundary leaks.
--
-- ★★ ONE DEFINITION OF "CURRENT". Latest round = highest `round_index`, tie
-- broken by `id` — fix-338's rule, because `now()` is constant inside a
-- transaction and two rounds written together would otherwise order at random.
create or replace view public.project_consultant_current
with (security_invoker = true) as
select
  c.id            as consultant_id,
  c.tenant_id,
  c.project_id,
  c.discipline,
  c.firm_id,
  d.name          as firm_name,
  d.active        as firm_active,
  c.notes,
  c.updated_at,
  r.id            as round_id,
  r.round_index,
  r.phase,
  r.status,
  r.est_send,
  r.sent,
  r.est_recd,
  r.recd,
  r.updated_at    as round_updated_at,
  (select count(*) from public.project_consultant_rounds x
    where x.consultant_id = c.id)  as round_count
from public.project_consultants c
join public.external_team_directory d on d.id = c.firm_id
left join lateral (
  select * from public.project_consultant_rounds r2
   where r2.consultant_id = c.id
   order by r2.round_index desc, r2.id desc
   limit 1
) r on true;

comment on view public.project_consultant_current is
  'fix-474: one row per consultant with its LATEST round flattened on. '
  'security_invoker so RLS on the base tables still applies. The UI reads this '
  'rather than re-deriving "current" from a rounds list.';

-- ---------------------------------------------------------------------------
-- §6 — RPCs. ONE PER INTENT, SERVER-CANONICAL.
-- ---------------------------------------------------------------------------
-- ★★ OCC EVERYWHERE, AND EVERY ONE RETURNS THE NEW TOKEN. fix-073's churn and
-- the fixes fix-442/fix-443 each had to make later: a write path that does not
-- hand the caller the token it just created forces a refetch, and the caller
-- that does not write it back conflicts with itself on the next keystroke.
-- Shape copied from `bp_upsert_team_task`: (out_id, updated_at, conflict).

-- ---------------------------------------------------------------------------
-- 6a — ADD A CONSULTANT
-- ---------------------------------------------------------------------------
-- ★★★ THE TWO EST DATES ARE INPUTS, NOT DERIVED HERE, and that is a deliberate
-- reading of the ruling: *"Both are ordinary editable fields that assert no
-- rule."* They are DEFAULTS, not invariants.
--
-- ★★ Deriving them server-side would mean re-implementing TWO existing rules in
-- SQL: `vendorTargetSend` (dd_end − 7) and the new 3-business-day lead. And
-- `vendorTargetSend`'s own comment is a warning against exactly that — *"the
-- second literal `- 7` here is exactly how the row on this card and the date in
-- the email would silently diverge the day the lead changes. One concept, one
-- function."* So the seeds are computed once, in TS, by the functions that
-- already own those concepts, and arrive here as values.
--
-- ★ What IS server-canonical is what is genuinely a RULE: the auto-stamp and
--   the append-a-round transition. Those are in 6b, where no client can
--   disagree with them.
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
  --    written here. Adding an eighth discipline to the directory must not
  --    need a migration, and the firm must actually PRACTISE the discipline it
  --    is being booked for — a Geotech firm filed under Landscape is the kind
  --    of quiet wrong this reference was introduced to prevent.
  if not exists (
    select 1 from public.external_team_directory d
     where d.id = p_firm_id
       and d.tenant_id = v_tenant
       and lower(btrim(d.discipline)) = lower(v_disc)
  ) then
    raise exception 'firm % is not a % in the directory', p_firm_id, v_disc
      using errcode = '23503';
  end if;

  insert into public.project_consultants (tenant_id, project_id, discipline, firm_id)
  values (v_tenant, p_project_id, v_disc, p_firm_id)
  returning id, project_consultants.updated_at into v_cid, v_upd;

  -- ★ Round 0 exists from the moment the consultant does. A consultant with no
  --   rounds would be a second empty state for the UI to render, and "current
  --   status" would have to mean two things.
  insert into public.project_consultant_rounds (
    tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
  ) values (
    v_tenant, v_cid, 0, v_phase, 'Scheduled', p_est_send, p_est_recd
  )
  returning id into v_rid;

  out_id := v_cid; round_id := v_rid; updated_at := v_upd;
  return next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6b — SET STATUS. The auto-stamp and the reopen rule live HERE and only here.
-- ---------------------------------------------------------------------------
-- ★★★ THE ONE TRANSITION THAT CREATES HISTORY IS Received → Scheduled.
-- Every other move edits the round in hand. Bobby: *"okay, here's the status,
-- auto date pops in."* Nobody types `sent` or `recd`.
--
--   → Pending    stamps `sent` (if not already set), leaves `recd` null
--   → Received   stamps `recd` (if not already set)
--   Pending  → Scheduled   clears `sent`   (in place)
--   Received → Pending     clears `recd`   (in place)
--   Received → Scheduled   APPENDS a new round, and the finished one is not
--                          touched at all
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
  v_actual  timestamptz;
  v_rid     uuid;
  v_upd     timestamptz;
  v_next_ix integer;
  v_today   date := (now() at time zone 'America/Los_Angeles')::date;
begin
  -- ★★★ THE VALIDATION LIST, AND IT IS THE THIRD PLACE THE LADDER LIVES.
  --     fix-464 found that `bp_set_team_department` validated independently of
  --     its CHECK constraint, so widening the constraint alone shipped a
  --     picker whose options the writer rejected. A test asserts this list,
  --     the CHECK above, and the TS union all carry the same three words.
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

  -- ★★★ THE LATEST ROUND, AND EVERY WRITE BELOW TARGETS THIS ROW AND NO OTHER.
  --     That is §6's property expressed where it can be enforced rather than
  --     hoped for: an older round is never named by any statement in this
  --     function.
  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
   order by r.round_index desc, r.id desc
   limit 1;
  if not found then
    raise exception 'consultant % has no rounds', p_consultant_id
      using errcode = 'P0002';
  end if;

  -- ★★ fix-382: CHECK THE OCC EXPECTATION BEFORE ANYTHING WRITES. Doing it as
  --    a WHERE clause on the first UPDATE works for the in-place branch and
  --    silently skips the check on the APPEND branch, which is the half that
  --    creates history.
  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; round_id := v_cur.id;
    updated_at := v_cur.updated_at; appended := false; conflict := true;
    return next; return;
  end if;

  if v_cur.status = 'Received' and v_status = 'Scheduled' then
    -- ★★★ REOPEN. The finished round is left BYTE-FOR-BYTE ALONE: no UPDATE
    --     names it, so not even its `updated_at` moves.
    select coalesce(max(r.round_index), -1) + 1 into v_next_ix
      from public.project_consultant_rounds r
     where r.consultant_id = p_consultant_id;

    insert into public.project_consultant_rounds (
      tenant_id, consultant_id, round_index, phase, status, est_send, est_recd
    ) values (
      v_tenant, p_consultant_id, v_next_ix,
      -- ★ Seeded from the counter, and editable afterwards: Design, Cycle 1,
      --   Cycle 2 … A user who needs "Cycle 1 & 2" types it.
      case when v_next_ix = 1 then 'Cycle 1' else 'Cycle ' || v_next_ix::text end,
      'Scheduled', null, null
    )
    returning id, project_consultant_rounds.updated_at into v_rid, v_upd;

    out_id := p_consultant_id; round_id := v_rid; updated_at := v_upd;
    appended := true; conflict := false;
    return next; return;
  end if;

  -- Every other transition edits the round in hand.
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

-- ---------------------------------------------------------------------------
-- 6c — EDIT ONE DATE on the latest round
-- ---------------------------------------------------------------------------
-- ★ All four slots are editable, including the two that get auto-stamped: the
--   stamp is a convenience, not a claim that the machine knows better. A send
--   that actually happened on Friday can be corrected to Friday.
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

  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
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

-- ---------------------------------------------------------------------------
-- 6d — EDIT THE ROUND LABEL on the latest round
-- ---------------------------------------------------------------------------
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

  select * into v_cur
    from public.project_consultant_rounds r
   where r.consultant_id = p_consultant_id
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
-- 6e — CHANGE THE FIRM
-- ---------------------------------------------------------------------------
-- ★ This edits the CONSULTANT, not a round — the firm is a property of the
--   engagement, and changing it does not rewrite which firm did an earlier
--   round. That is a limitation, stated: if the firm genuinely changes
--   mid-engagement, the honest record is a new round under the new firm, and
--   this model cannot express "round 0 was A, round 1 was B". See the PR.
create or replace function public.bp_set_consultant_firm(
  p_consultant_id       uuid,
  p_firm_id             uuid,
  p_expected_updated_at timestamptz
)
returns table(out_id uuid, updated_at timestamptz, conflict boolean)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cur  public.project_consultants%rowtype;
  v_upd  timestamptz;
begin
  select * into v_cur
    from public.project_consultants c
   where c.id = p_consultant_id
     and c.tenant_id = any (public.auth_tenant_ids());
  if not found then
    raise exception 'consultant % not found in caller scope', p_consultant_id
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.external_team_directory d
     where d.id = p_firm_id
       and d.tenant_id = v_cur.tenant_id
       and lower(btrim(d.discipline)) = lower(btrim(v_cur.discipline))
  ) then
    raise exception 'firm % is not a % in the directory', p_firm_id, v_cur.discipline
      using errcode = '23503';
  end if;

  if p_expected_updated_at is not null
     and v_cur.updated_at is distinct from p_expected_updated_at then
    out_id := p_consultant_id; updated_at := v_cur.updated_at; conflict := true;
    return next; return;
  end if;

  update public.project_consultants c
     set firm_id = p_firm_id
   where c.id = p_consultant_id
  returning c.updated_at into v_upd;

  out_id := p_consultant_id; updated_at := v_upd; conflict := false;
  return next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- §7 — GRANTS
-- ---------------------------------------------------------------------------
-- ★ fix-455's posture: anon never, authenticated always, and RLS does the rest.
--   Every function is SECURITY INVOKER, so the policies above are what actually
--   decide — a DEFINER copy would be strictly weaker.
revoke all on function public.bp_add_project_consultant(uuid, text, uuid, text, date, date) from public, anon;
revoke all on function public.bp_set_consultant_status(uuid, text, timestamptz)             from public, anon;
revoke all on function public.bp_set_consultant_date(uuid, text, date, timestamptz)         from public, anon;
revoke all on function public.bp_set_consultant_phase(uuid, text, timestamptz)              from public, anon;
revoke all on function public.bp_set_consultant_firm(uuid, uuid, timestamptz)               from public, anon;

grant execute on function public.bp_add_project_consultant(uuid, text, uuid, text, date, date) to authenticated;
grant execute on function public.bp_set_consultant_status(uuid, text, timestamptz)             to authenticated;
grant execute on function public.bp_set_consultant_date(uuid, text, date, timestamptz)         to authenticated;
grant execute on function public.bp_set_consultant_phase(uuid, text, timestamptz)              to authenticated;
grant execute on function public.bp_set_consultant_firm(uuid, uuid, timestamptz)               to authenticated;

revoke all on public.project_consultant_current from public, anon;
grant select on public.project_consultant_current to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- ★ Both tables exist, empty, RLS on:
-- select relname, relrowsecurity from pg_class
--  where relname in ('project_consultants','project_consultant_rounds');
-- select count(*) from public.project_consultants;               -- 0
--
-- ★ The view is security_invoker (the house rule):
-- select reloptions from pg_class where relname = 'project_consultant_current';
--                                              -- {security_invoker=true}
--
-- ★ Nothing else moved. These are what this file must NOT have changed:
-- select count(*) from public.external_team_directory;           -- 16
-- select count(*) from public.projects
--  where external_team is not null and external_team <> '{}';    -- 53
-- select count(*) from public.permit_tasks where waiting_on is not null; -- 111
