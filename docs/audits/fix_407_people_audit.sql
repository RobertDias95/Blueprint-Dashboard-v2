-- ===========================================================================
-- fix-407 — WHO IS STILL NAMED ON LIVE WORK AFTER THEY LEFT
-- ===========================================================================
--
-- Bobby, 2026-08-26, on the Team Structure screen: *"why are these DA's under
-- jade? they arent active anymore? and they arent on the drawschedule anymore.
-- this is what i meant by a wholistic clean, organization, and revamp of the
-- settings to ensure our ecosystem is update to date and aligned. can you
-- review in more depth."*
--
-- ★★★ THIS FILE IS READ-ONLY BY CONSTRUCTION. Every statement is a SELECT.
-- Nothing here rewrites, reassigns or deletes a row naming a person — who
-- inherits what is a PEOPLE decision, and the deliverable is the report.
--
-- Run it whole; §0 tells you who is inactive, §1 what they still hold.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE TRAP THIS FILE EXISTS TO KEEP YOU OUT OF: NAME COLLISIONS
-- ---------------------------------------------------------------------------
--
-- `team_members.name` is a bare string, and a naive "every text column equal to
-- an inactive person's name" sweep finds rows that have NOTHING to do with that
-- person. Measured on prod 2026-08-25:
--
--     correction_items.builder    = 'Caleb'   × 24   ← a BUILDER named Caleb
--     correction_items.architect  = 'George'  × 14   ← an ARCHITECT named George
--
-- Both are outside parties whose names happen to match a roster row. A sweep
-- that "cleaned up every row naming an inactive person" would have rewritten 38
-- correction items belonging to two people who never worked here. §2 lists the
-- columns that were CONSIDERED AND EXCLUDED, so the next audit does not have to
-- rediscover them.
--
-- ★★ AND HISTORY STAYS. fix-401's rule: an issued permit records who managed it
-- at the time, and that is a fact, not a stale value. Historical rows are
-- COUNTED so the picture is complete, never flagged as actionable.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- §0 · WHO IS INACTIVE — the fix-321 membership rule, in SQL
-- ---------------------------------------------------------------------------
--
-- ★★★ `active IS FALSE OR former IS TRUE`, mirroring `isCurrentMember`
-- (`active !== false && former !== true`). EITHER FLAG ALONE RETIRES SOMEBODY,
-- and fix-321 noted at the time that "today the rule is not load-bearing"
-- because all three retired rows agreed on both columns.
--
-- ★★★ IT IS LOAD-BEARING NOW. Caleb and George are `active=false, former=false`
-- — retired by `active` alone. A predicate testing `former` would miss both,
-- and Caleb is the largest live holding in this whole audit.

SELECT name, role, active, former,
       CASE WHEN active IS FALSE AND former IS TRUE  THEN 'both flags'
            WHEN active IS FALSE                     THEN 'active=false ONLY'
            WHEN former IS TRUE                      THEN 'former=true ONLY'
       END AS retired_by
  FROM public.team_members
 WHERE active IS FALSE OR former IS TRUE
 ORDER BY name;


-- ---------------------------------------------------------------------------
-- §1 · THE TRANSITION REPORT — everything an inactive person still holds
-- ---------------------------------------------------------------------------
--
-- Three scopes, and the difference is the whole point:
--
--   LIVE        act on it. Config that still routes, or work not yet finished.
--   CANCELLED   a live-looking row on a project that is cancelled (fix-262/264
--               put those off live work). Shown separately rather than counted
--               as live, because "reassign it" is the wrong answer.
--   HISTORICAL  leave it. It records what happened.

WITH inact AS (
  SELECT name FROM public.team_members WHERE active IS FALSE OR former IS TRUE
),
cancelled AS (
  SELECT DISTINCT project_id FROM public.project_holds
   WHERE kind = 'cancelled' AND hold_end IS NULL
),
-- ★ The current quarter, derived rather than typed, so this file does not go
--   stale the moment the quarter turns.
q AS (
  SELECT to_char(current_date, 'YYYY') || '-Q'
      || ((extract(month FROM current_date)::int - 1) / 3 + 1)::text AS cur
)

-- 1a · dm_da_groups — the mapping fix-379 derives permits.dm from, fix-346/368
--      co-assign from, and the draw schedule groups by. Always live config.
SELECT g.da_name AS person, 'dm_da_groups.da_name' AS store, 'LIVE' AS scope,
       count(*) AS n, string_agg('under ' || g.dm_name, ', ') AS detail
  FROM public.dm_da_groups g JOIN inact ON inact.name = btrim(g.da_name)
 GROUP BY 1
UNION ALL
SELECT g.dm_name, 'dm_da_groups.dm_name', 'LIVE', count(*), string_agg(g.da_name, ', ')
  FROM public.dm_da_groups g JOIN inact ON inact.name = btrim(g.dm_name) GROUP BY 1

-- 1b · da_team_routing — jurisdiction → (DA, ENT lead). Always live config.
UNION ALL
SELECT r.da, 'da_team_routing.da', 'LIVE', count(*), string_agg(r.jurisdiction, ', ')
  FROM public.da_team_routing r JOIN inact ON inact.name = btrim(r.da) GROUP BY 1
UNION ALL
SELECT r.ent_lead, 'da_team_routing.ent_lead', 'LIVE', count(*), string_agg(r.jurisdiction, ', ')
  FROM public.da_team_routing r JOIN inact ON inact.name = btrim(r.ent_lead) GROUP BY 1

-- 1c · permits — the four people columns. LIVE = not issued, project not
--      cancelled. `dual_da` is included for completeness: it is 100% NULL
--      across all 609 permits, so it can never report anything, and knowing
--      that is worth more than leaving it off the list.
UNION ALL
SELECT p.da, 'permits.da',
       CASE WHEN p.actual_issue IS NOT NULL THEN 'HISTORICAL'
            WHEN p.project_id IN (SELECT project_id FROM cancelled) THEN 'CANCELLED'
            ELSE 'LIVE' END,
       count(*),
       string_agg(COALESCE(p.num, '(no number)') || ' [' || COALESCE(p.status, '?') || ']', ', ')
  FROM public.permits p JOIN inact ON inact.name = btrim(p.da) GROUP BY 1, 3
UNION ALL
SELECT p.dual_da, 'permits.dual_da',
       CASE WHEN p.actual_issue IS NOT NULL THEN 'HISTORICAL' ELSE 'LIVE' END,
       count(*), string_agg(COALESCE(p.num, '?'), ', ')
  FROM public.permits p JOIN inact ON inact.name = btrim(p.dual_da) GROUP BY 1, 3
UNION ALL
SELECT p.dm, 'permits.dm',
       CASE WHEN p.actual_issue IS NOT NULL THEN 'HISTORICAL' ELSE 'LIVE' END,
       count(*), string_agg(COALESCE(p.num, '?'), ', ')
  FROM public.permits p JOIN inact ON inact.name = btrim(p.dm) GROUP BY 1, 3
UNION ALL
SELECT p.ent_lead, 'permits.ent_lead',
       CASE WHEN p.actual_issue IS NOT NULL THEN 'HISTORICAL' ELSE 'LIVE' END,
       count(*), string_agg(COALESCE(p.num, '?'), ', ')
  FROM public.permits p JOIN inact ON inact.name = btrim(p.ent_lead) GROUP BY 1, 3

-- 1d · projects — the lead columns. LIVE = not cancelled AND still holding an
--      unissued permit; a project whose every permit has issued is finished
--      work, not a pending handover.
UNION ALL
SELECT pr.acq_lead, 'projects.acq_lead',
       CASE WHEN pr.id IN (SELECT project_id FROM cancelled) THEN 'CANCELLED'
            WHEN EXISTS (SELECT 1 FROM public.permits x
                          WHERE x.project_id = pr.id AND x.actual_issue IS NULL) THEN 'LIVE'
            ELSE 'HISTORICAL' END,
       count(*), string_agg(pr.address, ', ')
  FROM public.projects pr JOIN inact ON inact.name = btrim(pr.acq_lead) GROUP BY 1, 3
UNION ALL
SELECT pr.entitlement_lead, 'projects.entitlement_lead',
       CASE WHEN pr.id IN (SELECT project_id FROM cancelled) THEN 'CANCELLED'
            WHEN EXISTS (SELECT 1 FROM public.permits x
                          WHERE x.project_id = pr.id AND x.actual_issue IS NULL) THEN 'LIVE'
            ELSE 'HISTORICAL' END,
       count(*), string_agg(pr.address, ', ')
  FROM public.projects pr JOIN inact ON inact.name = btrim(pr.entitlement_lead) GROUP BY 1, 3
UNION ALL
SELECT pr.design_manager, 'projects.design_manager',
       CASE WHEN pr.id IN (SELECT project_id FROM cancelled) THEN 'CANCELLED'
            WHEN EXISTS (SELECT 1 FROM public.permits x
                          WHERE x.project_id = pr.id AND x.actual_issue IS NULL) THEN 'LIVE'
            ELSE 'HISTORICAL' END,
       count(*), string_agg(pr.address, ', ')
  FROM public.projects pr JOIN inact ON inact.name = btrim(pr.design_manager) GROUP BY 1, 3
UNION ALL
-- ★ Array column: one row per PROJECT that names an inactive designer.
SELECT x.nm, 'projects.schematic_designer[]', 'LIVE', count(*), string_agg(pr.address, ', ')
  FROM public.projects pr
  CROSS JOIN LATERAL unnest(COALESCE(pr.schematic_designer, '{}')) AS x(nm)
  JOIN inact ON inact.name = btrim(x.nm)
 GROUP BY 1

-- 1e · tasks — open only. A resolved task naming somebody who has left is a
--      record of who did it.
UNION ALL
SELECT t.assigned_to, 'permit_tasks.assigned_to (open)', 'LIVE', count(*), ''
  FROM public.permit_tasks t JOIN inact ON inact.name = btrim(t.assigned_to)
 WHERE t.completion_status <> 'Resolved' AND COALESCE(t.done, false) = false GROUP BY 1
UNION ALL
SELECT a.assignee, 'permit_task_assignees (open)', 'LIVE', count(*), ''
  FROM public.permit_task_assignees a
  JOIN public.permit_tasks t ON t.id = a.task_id
  JOIN inact ON inact.name = btrim(a.assignee)
 WHERE t.completion_status <> 'Resolved' AND COALESCE(t.done, false) = false GROUP BY 1
UNION ALL
SELECT x.nm, 'permit_tasks.co_assignees[] (open)', 'LIVE', count(*), ''
  FROM public.permit_tasks t
  CROSS JOIN LATERAL unnest(COALESCE(t.co_assignees, '{}')) AS x(nm)
  JOIN inact ON inact.name = btrim(x.nm)
 WHERE t.completion_status <> 'Resolved' AND COALESCE(t.done, false) = false GROUP BY 1
UNION ALL
SELECT x.nm, 'task_templates.default_co_assignees[]', 'LIVE', count(*), ''
  FROM public.task_templates tt
  CROSS JOIN LATERAL unnest(COALESCE(tt.default_co_assignees, '{}')) AS x(nm)
  JOIN inact ON inact.name = btrim(x.nm) GROUP BY 1

-- 1f · the draw schedule — layout columns, time blocks, and the denormalized
--      per-project DA. Live = this quarter or later / not yet ended.
UNION ALL
SELECT l.da_name, 'draw_schedule_quarter_layout.da_name',
       CASE WHEN l.quarter >= (SELECT cur FROM q) THEN 'LIVE' ELSE 'HISTORICAL' END,
       count(*), string_agg(l.quarter || '/' || COALESCE(l.group_label, '-'), ', ')
  FROM public.draw_schedule_quarter_layout l JOIN inact ON inact.name = btrim(l.da_name)
 GROUP BY 1, 3
UNION ALL
SELECT b.da_name, 'da_time_blocks.da_name',
       CASE WHEN b.end_week::date >= current_date THEN 'LIVE' ELSE 'HISTORICAL' END,
       count(*), ''
  FROM public.da_time_blocks b JOIN inact ON inact.name = btrim(b.da_name) GROUP BY 1, 3
UNION ALL
SELECT d.da_assigned, 'draw_schedule.da_assigned',
       CASE WHEN d.project_id IN (SELECT project_id FROM cancelled) THEN 'CANCELLED'
            WHEN d.end_week::date >= current_date THEN 'LIVE'
            ELSE 'HISTORICAL' END,
       count(*), ''
  FROM public.draw_schedule d JOIN inact ON inact.name = btrim(d.da_assigned) GROUP BY 1, 3

ORDER BY 1, 3, 2;


-- ---------------------------------------------------------------------------
-- §2 · THE ENUMERATION — every text column that holds a roster name
-- ---------------------------------------------------------------------------
--
-- ★★★ RUN THIS RATHER THAN TRUSTING A COUNT. The standing figure was "~11
-- referencing columns"; the real answer on 2026-08-25 was **35 scalar text
-- columns** plus 4 text[] columns, of which 22 are genuine people references
-- and the rest are collisions, audit trails, or the roster's own columns.
--
-- ★ It is a DO block because it has to reach every table by dynamic SQL. It
--   reads only — the sole statement inside is a counting SELECT — and it ends
--   in RAISE EXCEPTION so it cannot leave a transaction open.

DO $enumerate$
DECLARE
  r record; n bigint; ninact bigint; report text := E'\n  TABLE.COLUMN                                  ROWS  INACTIVE\n';
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying')
     ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE btrim(%I) IN (SELECT name FROM public.team_members)),
              count(*) FILTER (WHERE btrim(%I) IN (SELECT name FROM public.team_members
                                                    WHERE active IS FALSE OR former IS TRUE))
         FROM public.%I', r.column_name, r.column_name, r.table_name)
      INTO n, ninact;
    IF n > 0 THEN
      report := report || '  ' || rpad(r.table_name || '.' || r.column_name, 46)
             || lpad(n::text, 5) || lpad(ninact::text, 10) || E'\n';
    END IF;
  END LOOP;
  RAISE EXCEPTION E'%', report;
END $enumerate$;

-- ---------------------------------------------------------------------------
-- ★★ CONSIDERED AND EXCLUDED — do not "clean" these
-- ---------------------------------------------------------------------------
--
--   correction_items.builder        a builder who shares a roster first name
--   correction_items.architect      an outside architect, likewise
--   permits.architect               same column family, outside party
--   audit_log.row_id                the audited row's key, which for
--                                   team_members IS a name — an audit trail
--   permit_task_audit.*             the task audit trail (from/to values)
--   draw_schedule_audit.da_from/to  the reassignment trail; the whole point of
--                                   it is that it names who it used to be
--   permit_milestone_acks.acked_by_name   who acknowledged it, then
--   project_da_handoffs.from_da     ditto — 4 of 4 rows name an inactive DA,
--                                   which is what a handoff record IS
--   project_sd_handoffs.from_sd     ditto
--   permit_task_auto_closures.recipient   who was told, at the time
--   draw_schedule_quarter_layout.group_label   a column HEADING that happens
--                                   to equal a DM's name
--   team_members.name/first_name/last_name    the roster itself
--
--   projects.external_team (jsonb)  ★ CHECKED AND CLEAN: 0 rows name any staff
--                                   member. fix-227 built it for outside firms
--                                   and it has stayed that way.
--   post_requests.unresolved_recipients[]     0 roster names.
