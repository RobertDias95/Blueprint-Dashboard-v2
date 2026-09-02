-- ===========================================================================
-- fix-479 §E (P-132) — SEED CONSULTANT RECORDS FROM projects.external_team
-- ===========================================================================
--
-- ★★★ APPROVED 2026-09-02, REVERSING THE 2026-09-01 RULING. This file shipped
-- as `fix_474_seed_from_external_team_PENDING_APPROVAL.sql` — a readable
-- proposal with every statement commented out — because fix-474 had ruled
-- *"the tracker starts empty and fills from new activity"*. Bobby was then
-- asked directly, with the cost stated:
--
--   *"if there is an external member there, let's make sure we add it over to
--    consultants… and then the status default for all the projects would be
--    whatever the primary setting is, which I think is scheduled."*
--
-- Confirmed via popup with the trade named out loud — **rows will say
-- `Scheduled` about work that may already be finished** — and the answer was
-- yes, copy them all. That cost is not hidden here; it is the reason the
-- 09-01 ruling went the other way, and it is what was overruled.
--
-- ★★★ ORDER MATTERS AND IT IS NOT NEGOTIABLE. `fix_479_consultant_rounds_void`
-- was applied FIRST (2026-09-02), so `bp_set_consultant_firm(p_clear_rounds)`
-- VOIDS rounds instead of deleting them. Not one of the rows this file creates
-- has ever been reachable by a `delete`.
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-09-02 16:01 UTC (the day this ran)
-- ---------------------------------------------------------------------------
--   projects                                          202
--   with a non-empty projects.external_team            54    (53 on 09-01)
--   (project, discipline) firm pairs inside them      164    (159 on 09-01)
--   max pairs on one project                            6
--   disciplines represented                             7
--     Arborist, Civil, Energy, Geotech, Landscape, Structural, Surveyor
--
-- ★★★ THE RESOLVE CHECK, AND IT DID NOT PASS ON THE FIRST RUN. Of the 164
-- free-text firm names, **163 resolved** to an `external_team_directory` row on
-- (name, discipline), case-insensitively. **ONE DID NOT:**
--
--     "Steep Slope Tree Consulting"  ·  Arborist  ·  5917 41st Ave SW
--
-- It is not a typo of anything in the directory — the three Arborists on file
-- are Russell + Lambert, Seattle Arboricultural Associates and Seattle Tree
-- Consulting. It is a real firm somebody typed into the free-text blob back
-- when the External Team panel accepted free text, and the directory simply
-- never learned about it.
--
-- ★★ THE BRIEF'S GATE FIRED HERE: *"if any pair is unmatched, STOP — report the
--    unmatched pairs and do not seed."* It was reported, and Bobby ruled
--    2026-09-02: **add the directory row and seed all 164.** So step 1 below
--    creates exactly one directory row, named, and this file does no fuzzy
--    matching of any kind — every other pair matches exactly or not at all.
--
-- ---------------------------------------------------------------------------
-- ★★ WHAT A SEEDED RECORD CLAIMS, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------------
-- Each record gets ONE round: index 0, phase `Design`, status `Scheduled`, and
-- **all four dates NULL**. That is the honest shape — `external_team` records
-- WHO and nothing about when anything was sent or received — so a seeded record
-- claims **no history at all**. `Scheduled` is the status Bobby named.
--
-- ★★ AND THE OPEN `waiting_on` TASKS ARE NOT PART OF THIS. Re-measured
-- 2026-09-01: 111 tasks carry `waiting_on`, 28 of them open. They stay in My
-- Tasks, untouched, per the 08-31 ruling. Nothing here reads them.
--
-- ★ IDEMPOTENT. `on conflict do nothing` on the one-per-discipline unique, and
--   round 0 is created only for records this statement actually INSERTED, so a
--   re-run cannot double a round.
--
-- ★ THE SEED WRITES `project_consultants` DIRECTLY rather than calling
--   `bp_add_project_consultant`. That RPC now writes through to
--   `projects.external_team` (§D) — which is where these rows came from, so the
--   write-through would be a no-op at best and 164 needless `projects.updated_at`
--   bumps at worst. The blob is already correct by construction here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE ONE DIRECTORY ROW THE GATE ASKED ABOUT (approved 2026-09-02)
-- ---------------------------------------------------------------------------
-- ★ Named in full so this is never mistaken for fuzzy matching: it is one row,
--   for one firm, that one project already names. Its tenant is read from the
--   project that names it rather than typed.
insert into public.external_team_directory (tenant_id, discipline, name, active)
select distinct p.tenant_id, 'Arborist', 'Steep Slope Tree Consulting', true
  from public.projects p
 where lower(btrim(coalesce(p.external_team ->> 'Arborist', '')))
       = 'steep slope tree consulting'
   and not exists (
     select 1 from public.external_team_directory d
      where d.tenant_id = p.tenant_id
        and lower(btrim(d.name)) = 'steep slope tree consulting'
        and lower(btrim(d.discipline)) = 'arborist'
   );

-- ---------------------------------------------------------------------------
-- 2 — THE SEED
-- ---------------------------------------------------------------------------
with pairs as (
  select p.id as project_id, p.tenant_id, e.key as discipline,
         btrim(e.value #>> '{}') as firm
    from public.projects p
    cross join lateral jsonb_each(
      case when jsonb_typeof(p.external_team) = 'object'
           then p.external_team else '{}'::jsonb end) e
   where btrim(coalesce(e.value #>> '{}', '')) <> ''
),
resolved as (
  select pr.tenant_id, pr.project_id, pr.discipline, d.id as firm_id
    from pairs pr
    join public.external_team_directory d
      on d.tenant_id = pr.tenant_id
     and lower(btrim(d.name)) = lower(pr.firm)
     and lower(btrim(d.discipline)) = lower(pr.discipline)
),
ins as (
  insert into public.project_consultants (tenant_id, project_id, discipline, firm_id)
  select tenant_id, project_id, discipline, firm_id from resolved
  on conflict (project_id, discipline) do nothing
  returning id, tenant_id
)
insert into public.project_consultant_rounds
       (tenant_id, consultant_id, round_index, phase, status,
        est_send, sent, est_recd, recd)
select ins.tenant_id, ins.id, 0, 'Design', 'Scheduled',
       null, null, null, null
  from ins;

commit;

-- ---------------------------------------------------------------------------
-- VERIFIED AFTER COMMIT, 2026-09-02 — the three numbers the brief asked for
-- ---------------------------------------------------------------------------
--   records          164
--   rounds           164
--   claims_history     0     (nothing but 'Scheduled' with four null dates)
--   voided             0     (§C shipped first; nothing has been cleared)
--
-- select (select count(*) from public.project_consultants)                as records,
--        (select count(*) from public.project_consultant_rounds)          as rounds,
--        (select count(*) from public.project_consultant_rounds
--          where status <> 'Scheduled' or sent is not null
--             or recd is not null or est_send is not null
--             or est_recd is not null)                                    as claims_history,
--        (select count(*) from public.project_consultant_rounds
--          where voided_at is not null)                                   as voided;
--
-- ★ And the gate re-run: zero unmatched pairs remain.
-- with pairs as (…as above…)
-- select count(*) from pairs pr
--  where not exists (select 1 from public.external_team_directory d
--                     where d.tenant_id = pr.tenant_id
--                       and lower(btrim(d.name)) = lower(pr.firm)
--                       and lower(btrim(d.discipline)) = lower(pr.discipline));  -- 0
