-- ===========================================================================
-- fix-545 — THE ON CONFLICT CENSUS. Run this against prod; it writes nothing.
-- ===========================================================================
--
-- ★★★ WHAT IT IS FOR. `ON CONFLICT (…) WHERE …` does not name an index — it
--     INFERS one, and inference requires the statement's predicate to IMPLY the
--     index's. So an index and a statement can drift apart while **both objects
--     look perfectly healthy**, and nothing in Postgres complains until someone
--     writes.
--
-- ★★★ THAT IS THE 09-14 INCIDENT. fix-536 recreated
--     `permit_tasks_auto_event_uniq` with a THIRD excluded event;
--     `bp_create_lifecycle_task` still named two → `42P10` → PostgREST 400 →
--     *"Lifecycle tasks created: 0"*, and three real tasks were never made.
--     **Every guard in fix-536 passed** — it asserted its own index was created
--     and satisfiable. The damage was in a different object.
--
-- ---------------------------------------------------------------------------
-- HOW IT DECIDES: THE ENGINE, NOT A PARSER
-- ---------------------------------------------------------------------------
--
-- ★★★ DO NOT HAND-PARSE THE SQL. The first draft of this census used a regex
--     over `pg_get_functiondef` and **missed the very statement that caused the
--     incident** — `ON CONFLICT (tenant_id, permit_id, auto_event,
--     COALESCE(cycle_idx, -1))` has a nested paren, and `\([^)]*\)` stops at the
--     first `)`. A parser that cannot read the failing statement cannot police
--     it.
--
-- ★★ `plpgsql_check` PLANS every SQL statement inside every plpgsql function,
--    which is exactly when Postgres resolves an `ON CONFLICT` to an index. It
--    reports `42P10` itself. The extension is created and **rolled back**, so
--    running this leaves nothing installed and writes nothing.
--
-- ★ Trigger functions need their table passed (`relid`) or the checker refuses
--   them with `22023: missing trigger relation` — 216 functions all reporting
--   an error is that mistake, not 216 defects.
--
-- ---------------------------------------------------------------------------
-- RESULT ON PROD, 2026-09-14
-- ---------------------------------------------------------------------------
--
--   plpgsql functions checked ....................... 216
--   ★ 42P10 — ON CONFLICT cannot infer an index ....... 1
--   other error classes ............. 42P01 ×17 · 42703 ×6
--
-- ★★★ THE ONE: `bp_upsert_permit_cycle_reviewer` says
--     `ON CONFLICT (permit_id, cycle_index, reviewer_name)` while the only
--     unique index is `(permit_id, cycle_index, discipline) WHERE discipline
--     IS NOT NULL` — fix-44's per-NAME → per-discipline-SLOT remodel moved the
--     index and left this statement behind. **Same class as the incident, from
--     a different ticket, sitting unnoticed because nothing calls it.**
--     Reported, not repaired: it needs a migration and this ticket has none.
--
-- ★ The 42P01s are runtime temp tables (`_cc_items`, `_pn`) the checker cannot
--   see, and the 42703s are three functions naming columns that no longer
--   exist (`permits.go_date`, `task_templates.default_assignee`,
--   `permits.stage`). Real, but a different class — recorded, not this ticket.
--
-- ---------------------------------------------------------------------------
-- §C — THE SIBLING FORMS, ANSWERED BY THE SAME RUN
-- ---------------------------------------------------------------------------
--
-- ★★★ The engine plans every statement whatever its shape, so this census
--     covers the siblings without a second pass:
--
--   · **`ON CONFLICT ON CONSTRAINT`** — 4 sites, all
--     `ON CONSTRAINT draw_schedule_pkey1` inside
--     `bp_create_project_with_permits`. The constraint exists and all four
--     plan clean.
--   · **partial unique indexes used by an upsert** — 11 partial unique indexes
--     in `public`; every upsert that infers one plans clean.
--
-- ★★★ So: exactly ONE statement in the schema cannot infer its index, and it is
--     `bp_upsert_permit_cycle_reviewer`, above. **No statement infers an index
--     that no longer exists** other than that one.
--
-- ★ The mirror question — *an index no statement can infer* — describes an
--   UNUSED index, not a broken one. It is not a correctness defect and is not
--   raised as one here.
-- ===========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS plpgsql_check;

CREATE TEMP TABLE _census(fn text, sqlstate text, finding text) ON COMMIT DROP;

DO $census$
DECLARE r record; v text;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::text AS sig,
           (SELECT t.tgrelid FROM pg_trigger t WHERE t.tgfoid = p.oid LIMIT 1) AS relid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
  LOOP
    BEGIN
      -- ★ Two branches rather than a CASE: `plpgsql_check_function` is
      --   set-returning and a CASE around it errors for every row, which looks
      --   exactly like "every function is broken".
      IF r.relid IS NOT NULL THEN
        FOR v IN SELECT plpgsql_check_function(r.oid, relid := r.relid, fatal_errors := false) LOOP
          IF v LIKE 'error:%' THEN
            INSERT INTO _census VALUES (r.sig, split_part(v, ':', 2), v);
          END IF;
        END LOOP;
      ELSE
        FOR v IN SELECT plpgsql_check_function(r.oid, fatal_errors := false) LOOP
          IF v LIKE 'error:%' THEN
            INSERT INTO _census VALUES (r.sig, split_part(v, ':', 2), v);
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _census VALUES (r.sig, 'CHECKER', SQLSTATE || ': ' || SQLERRM);
    END;
  END LOOP;
END
$census$;

-- 1. the headline: anything that cannot infer its index
SELECT fn, finding
FROM _census
WHERE sqlstate = '42P10'
ORDER BY fn;

-- 2. the summary
SELECT 'plpgsql functions checked' AS what,
       (SELECT count(*)::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language  l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND l.lanname = 'plpgsql') AS value
UNION ALL SELECT '42P10 — ON CONFLICT cannot infer an index',
       (SELECT count(*)::text FROM _census WHERE sqlstate = '42P10')
UNION ALL SELECT 'errors by class',
       (SELECT coalesce(string_agg(sqlstate || ' x' || c::text, ' | ' ORDER BY c DESC), '(none)')
          FROM (SELECT sqlstate, count(*) c FROM _census GROUP BY sqlstate) s);

-- 3. ★ FAIL LOUDLY. Uncomment to use this as a gate rather than a report:
--
-- DO $gate$
-- DECLARE v_n int; v_list text;
-- BEGIN
--   SELECT count(*), string_agg(fn, ', ') INTO v_n, v_list
--     FROM _census WHERE sqlstate = '42P10';
--   IF v_n > 0 THEN
--     RAISE EXCEPTION
--       'fix-545: % function(s) cannot infer an ON CONFLICT index: %', v_n, v_list;
--   END IF;
-- END
-- $gate$;

ROLLBACK;
