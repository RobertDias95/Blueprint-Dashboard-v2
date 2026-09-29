-- ===========================================================================
-- fix-594 — a removed consultant frees its slot
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Bobby applies this from Cowork. fix-594 did not run it
--       against prod, and CI is green with it unapplied — the app ships working
--       either way (see §3 below for what the client does in the meantime).
--
-- ---------------------------------------------------------------------------
-- BOBBY'S RULING, 2026-09-28 (P-291, the remainder after fix-592)
-- ---------------------------------------------------------------------------
--
-- `project_consultants_one_per_discipline` becomes a **partial** unique index.
-- **"One LIVE consultant per discipline" is unchanged.** What changes is that a
-- REMOVED row no longer holds the slot.
--
-- ★ Not a revive RPC. Not a hand-clear of the two rows. The rule was always
--   about live consultants; the index just did not say so.
--
-- ---------------------------------------------------------------------------
-- THE REPORT THIS CLOSES
-- ---------------------------------------------------------------------------
--
-- **Lindsay, 2026-09-23, 3020 E Yesler Way.** Three raw
-- `duplicate key value violates unique constraint
-- "project_consultants_one_per_discipline"` toasts in 106 seconds, then she
-- stopped. She had removed a Civil ninety-one seconds earlier;
-- `project_consultant_current` hides a removed row so the picker offered Civil
-- back, and the index still counted it. fix-592 made the app tell the truth
-- about that; this file removes the cause.
--
-- ---------------------------------------------------------------------------
-- VERIFIED READ-ONLY ON PROD, 2026-09-29, BEFORE WRITING THIS
-- ---------------------------------------------------------------------------
--
--   index today   CREATE UNIQUE INDEX project_consultants_one_per_discipline
--                   ON public.project_consultants USING btree (project_id, discipline)
--                 — no predicate, exactly as fix-592 measured
--   rows                                              198
--   rows with removed_at                                2   (Civil + Geotech,
--                                                            3020 E Yesler Way,
--                                                            both removed 09-23)
--   slots held ONLY by a removed row                    2   ← what this frees
--
-- ★★★ AND THE ONE CHECK THAT DECIDES WHETHER THIS FILE IS SAFE TO RUN:
--
--   live duplicates under the NEW predicate            0
--
--     i.e. `SELECT project_id, discipline FROM project_consultants
--            WHERE removed_at IS NULL GROUP BY 1,2 HAVING count(*) > 1` is empty.
--
--     **This matters because the DROP comes first.** If any (project, discipline)
--     had two LIVE rows, the CREATE would fail, the transaction would roll back,
--     and the index would survive — but only because of the transaction. Re-run
--     that query before applying; if it ever returns rows, resolve them first
--     rather than letting the CREATE decide.
-- ===========================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- ★★★ IT IS A CONSTRAINT, NOT A STANDALONE INDEX — SO `DROP INDEX` CANNOT WORK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The brief specifies `DROP INDEX IF EXISTS public.project_consultants_one_per_discipline;`.
-- **That statement fails on prod**, and a rolled-back probe is how I know:
--
--   ERROR: 2BP01: cannot drop index project_consultants_one_per_discipline
--          because constraint project_consultants_one_per_discipline on table
--          project_consultants requires it
--   HINT:  You can drop constraint … instead.
--
-- `pg_constraint` confirms it: `contype = 'u'`, `UNIQUE (project_id, discipline)`.
-- `pg_indexes` shows constraint-backed indexes too, which is why fix-592 — and
-- this brief after it — read it as a plain index.
--
-- ★★★ AND A UNIQUE **CONSTRAINT** CANNOT BE PARTIAL. Postgres has no
--     `UNIQUE (…) WHERE …` constraint syntax; only an INDEX takes a predicate.
--     So the ruling can only be implemented as a partial unique INDEX, and the
--     constraint has to go for the index to take its name. That is a schema-shape
--     change the brief did not anticipate, and it is reported in the PR.
--
-- ⚠️ WHAT THIS COSTS, STATED: after this file, `project_consultants_one_per_discipline`
--    is an INDEX and no longer a CONSTRAINT, so it stops appearing in
--    `pg_constraint` / `information_schema.table_constraints`. Nothing in this
--    repo reads either (checked). The enforcement is identical, and so is the
--    error: Postgres reports a unique-INDEX violation as
--    `duplicate key value violates unique constraint "<index name>"` — the same
--    text, with the same name — which is what keeps `addConsultantMessage`
--    working. **Verified on prod in the same rolled-back probe.**
--
-- ★★★ THE SAME NAME, ON PURPOSE. `addConsultantMessage` (fix-592 §A) matches on
--     that name to turn a raw Postgres error into a sentence, and it must keep
--     working for the case that survives this change: a genuine race, two people
--     adding the same LIVE discipline at once. Renaming would silently return
--     that path to showing `duplicate key value violates unique constraint …` at
--     somebody.
ALTER TABLE public.project_consultants
  DROP CONSTRAINT IF EXISTS project_consultants_one_per_discipline;

-- ★ Belt and braces: if this file is ever re-run after the constraint has become
--   an index, the line above is a no-op and this is what clears the way.
DROP INDEX IF EXISTS public.project_consultants_one_per_discipline;

CREATE UNIQUE INDEX project_consultants_one_per_discipline
  ON public.project_consultants (project_id, discipline)
  WHERE removed_at IS NULL;

COMMENT ON INDEX public.project_consultants_one_per_discipline IS
  'fix-594: one LIVE consultant per (project, discipline). A row with '
  'removed_at set does not hold the slot, so a discipline can be booked again '
  'after it is removed. Remove stays a soft delete — bp_remove_project_consultant '
  'stamps removed_at and voids the live rounds (fix-514 §D), and this predicate '
  'is what stops that record blocking a re-add.';

COMMIT;

-- ===========================================================================
-- VERIFY, after applying
-- ===========================================================================
--
--   SELECT indexdef FROM pg_indexes
--    WHERE schemaname='public' AND indexname='project_consultants_one_per_discipline';
--   -- expect: … USING btree (project_id, discipline) WHERE (removed_at IS NULL)
--
--   -- and the two freed slots are now addable (read-only check, adds nothing):
--   SELECT p.address, pc.discipline
--     FROM project_consultants pc JOIN projects p ON p.id = pc.project_id
--    WHERE pc.removed_at IS NOT NULL;
--   -- expect: 3020 E Yesler Way / Civil, 3020 E Yesler Way / Geotech
--   -- Lindsay can add a Civil to that project again the moment this lands.
--
-- ★ IDEMPOTENT. `DROP INDEX IF EXISTS` then `CREATE` — re-running the file after
--   it has been applied drops the partial index and rebuilds the identical one.
-- ===========================================================================
