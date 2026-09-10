-- ===========================================================================
-- fix-520 §D (P-233) — `projects` gets an audit trail
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Written for Cowork to apply. fix-520 did not run this
--       against prod, and nothing in the app depends on it existing.
--
-- WHY. `audit_log` holds 16,330 rows and 76 of them are `projects` — every one
-- a one-off backfill, the newest dated 2026-06-17. Nothing records a user's
-- change to a project row. That is why fix-519's question — *"which rows did we
-- correct by hand while the Library was showing a parking code under ROOF
-- DECK?"* — has no answer, and it is why this needs to exist BEFORE the
-- backfill volume arrives rather than after somebody asks the question again.
--
-- ★★★ ONE ROW PER UPDATE, CARRYING ONLY THE COLUMNS THAT CHANGED.
--     `audit_log.changes` is already `jsonb`, so the diff goes in there as
--     `{"column": {"before": …, "after": …}}`. The alternative — one row per
--     changed column — multiplies the row count by however many fields a save
--     touches for no extra fact, and fix-520 §A has just made every field save
--     on its own, so most updates carry exactly one column anyway.
--
-- ★★ IT DOES NOT NEED TO BE CLEVER; IT NEEDS TO EXIST. No retention policy, no
--    partitioning, no reporting surface. Those are decisions with owners; this
--    is the record they will need to make them.
--
-- ---------------------------------------------------------------------------
-- EXPECTED ROW GROWTH — the number the brief asked for before anyone applies it
-- ---------------------------------------------------------------------------
--
--   `projects` is 46 columns / 219 rows. `audit_log` is ~823 bytes a row today
--   (13 MB / 16,330), and a projects diff is smaller than the median row
--   already in there, so 823 is a conservative per-row figure.
--
--   THE BACKFILL (P-225): 102 projects have no unit rows. Cam enters, per
--   project, roughly: 1 unit-count + 1..3 types + 3..9 unit fields (all of
--   which land in the single `unit_types` column, one UPDATE per edit) + a
--   handful of site and date corrections. Call it **20–40 UPDATEs a project**,
--   which is deliberately pessimistic because §A turned batched saves into
--   per-field ones.
--
--     102 projects × 30 updates   ≈ 3,060 rows   ≈ 2.5 MB
--
--   STEADY STATE afterwards: 219 projects, a handful of field edits a week
--   each. At 20 edits per project per year that is ~4,400 rows / ~3.6 MB a
--   year.
--
--   ⚠️ SO THE BACKFILL IS ROUGHLY ONE YEAR OF NORMAL TRAFFIC, ARRIVING AT ONCE,
--      AND IT IS SMALL: `audit_log` roughly doubles its CURRENT row count over
--      the backfill plus the first year, from 16,330 to ~24,000, and grows from
--      13 MB to ~19 MB. No partitioning is warranted at this size. Revisit if
--      the scraper is ever pointed at this trigger — a machine writer changes
--      the arithmetic by two orders of magnitude, which is why the trigger
--      below records `auth.uid()` and a service-role write is identifiable.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS TO `project_sd_handoffs` (fix-344)
-- ---------------------------------------------------------------------------
--
-- ★★★ IT STAYS, AND IT IS NOT MADE REDUNDANT. This trigger will record the
--     `schematic_designer` column changing, which is the same FACT — but the
--     handoff ledger records three things this cannot:
--       · `tasks_moved`, the count of open tasks the reassign carried with it;
--       · a `note`, which is a human's reason rather than a diff;
--       · the row is written by `bp_reassign_project_sd` INSIDE the same
--         transaction as the task moves, so a handoff and its consequences can
--         never be half-recorded.
--     A generic column diff is "the value changed"; the ledger is "this is what
--     the change did". They answer different questions and both are cheap.
-- ★ The overlap is a duplicated column diff on ~20 rows to date. That is not a
--   reason to weaken either.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The diff function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_audit_projects_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_old     jsonb := to_jsonb(OLD);
  v_new     jsonb := to_jsonb(NEW);
BEGIN
  -- ★ `updated_at` is excluded: every UPDATE moves it, so including it would
  --   make a no-op write look like a change and every real change carry a
  --   field nobody asked about.
  FOR v_key IN SELECT jsonb_object_keys(v_new)
  LOOP
    IF v_key = 'updated_at' THEN
      CONTINUE;
    END IF;
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      v_changes := v_changes || jsonb_build_object(
        v_key,
        jsonb_build_object('before', v_old -> v_key, 'after', v_new -> v_key)
      );
    END IF;
  END LOOP;

  -- ★★ A WRITE THAT CHANGED NOTHING WRITES NOTHING. `projects_set_updated_at`
  --    fires on every UPDATE including the no-op ones a bulk job produces, and
  --    fix-341 spent a ticket on what those already cost elsewhere.
  IF v_changes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    NEW.tenant_id,
    -- ★ NULL for a service-role / trigger-driven write, which is how a
    --   machine write is told from a person's. The scraper does not write
    --   `projects`, but a backfill migration does.
    auth.uid(),
    'project_updated',
    'projects',
    NEW.id::text,
    v_changes
  );

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The trigger
-- ---------------------------------------------------------------------------
--
-- ★ AFTER, so a failure to audit can never roll back the user's edit — the
--   record is worth having, but not at the price of the change it records.
--   (An AFTER trigger raising would still abort; the INSERT above cannot,
--   short of the table being gone.)
-- ★ FOR EACH ROW, and no WHEN clause: the function itself decides whether
--   anything changed, so the rule lives in one place.

DROP TRIGGER IF EXISTS projects_audit_row ON public.projects;

CREATE TRIGGER projects_audit_row
AFTER UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.bp_audit_projects_row();

-- ---------------------------------------------------------------------------
-- 3. Reading it back
-- ---------------------------------------------------------------------------
--
-- The query fix-519 could not run, which is the point of the whole section:
--
--   SELECT a.created_at,
--          (SELECT tm.name FROM team_members tm
--             JOIN auth.users u ON lower(u.email) = lower(tm.email)
--            WHERE u.id = a.user_id LIMIT 1) AS who,
--          p.address,
--          k                              AS column_name,
--          a.changes -> k ->> 'before'    AS before,
--          a.changes -> k ->> 'after'     AS after
--     FROM public.audit_log a
--     JOIN public.projects p ON p.id::text = a.row_id
--    CROSS JOIN LATERAL jsonb_object_keys(a.changes) k
--    WHERE a.table_name = 'projects'
--      AND a.action = 'project_updated'
--      AND a.created_at >= now() - interval '30 days'
--    ORDER BY a.created_at DESC;
--
-- ★ `audit_log` is already covered by fix-157's grant posture and fix-273's
--   revocations; this adds no new table and therefore no new grant decision.
--   Verify that assumption before applying — it is the one thing here that
--   depends on state this file cannot see.
