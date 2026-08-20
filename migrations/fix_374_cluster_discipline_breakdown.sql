-- fix-374: the report knows the discipline and shows the junk drawer instead.
--
-- ADDITIVE AND READ-ONLY. A new function BESIDE bp_correction_cluster_ranking,
-- deliberately not a change to it: the ranking RPC is what the live page runs,
-- and changing a function's return type means dropping it, which is not a thing
-- to do to a working screen for a display ticket.
--
-- ★★★ Every fact here already exists in `correction_items.discipline`. Nothing
-- is derived, guessed or written; this only carries it to the screen, per
-- cluster, so the ranked list can be ORGANISED by the column that is already
-- right instead of by the city's subject line.
--
-- Bobby: *"whats interesting, is it said General for this item, but it is a
-- drainage correction, as mentioned in the first few words."*
--
-- Measured on prod 2026-08-20: all 476 items whose subject is `General` carry a
-- non-empty discipline. `General` is not a category, it is the absence of one,
-- and the answer was sitting in the next column the whole time.
--
-- ★★ Returns the FULL breakdown, one row per (cluster, discipline), rather than
-- a single dominant value. Which discipline "wins", and when a pile counts as
-- mixed, is a judgement — and judgement belongs where it can be seen and tested
-- (`src/lib/correctionDisciplines.ts`), not buried in SQL. The real
-- `subject:general` pile is Drainage 206 / Energy 203, so there is no honest
-- winner to pick and the UI says so instead of guessing.
create or replace function public.bp_correction_cluster_discipline(
  p_juris text default null,
  p_tier  text default 'subject'
)
returns table (
  cluster_key text,
  discipline  text,
  items       integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.cluster_key,
         coalesce(nullif(btrim(ci.discipline), ''), '(not recorded)') as discipline,
         count(*)::int as items
    from correction_clusters c
    join correction_cluster_items cci on cci.cluster_id = c.id
    join correction_items ci          on ci.id = cci.item_id
    left join projects p              on p.id = ci.project_id
   where c.tier = coalesce(p_tier, 'subject')
     and (p_juris is null or p.juris = p_juris)
   group by 1, 2
$$;

comment on function public.bp_correction_cluster_discipline(text, text) is
  'fix-374: per-cluster discipline breakdown, straight from correction_items.discipline. Read-only and additive — the ranking RPC is untouched. The UI picks the dominant value and decides what counts as mixed, so that judgement stays visible and testable.';

grant execute on function public.bp_correction_cluster_discipline(text, text)
  to authenticated, service_role;
