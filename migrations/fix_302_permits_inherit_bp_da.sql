-- fix-302: a secondary permit inherits the Building Permit's DA.
--
-- ██ REVERTED BY fix-312 (migrations/fix_312_undo_fix_302_da_cascade.sql),
-- ██ applied to prod 2026-08-14. DO NOT RE-APPLY THIS FILE.
-- ██
-- ██ The trigger and its function are dropped; 107 rows had `da` set back to
-- ██ NULL. This was wrong: it put a design associate on ULS and IPR records,
-- ██ which must never carry one, and the tell was that every row it wrote came
-- ██ out equal to its project's Building Permit DA. Assignment is manual.
-- ██
-- ██ Section 4 (the Project View "— Unassigned —" DA filter) SURVIVES and was
-- ██ not part of the revert — it is how a DA-less permit stays findable, and
-- ██ it matters more now than it did.
-- ██
-- ██ The reasoning in this file is left intact on purpose: the research below
-- ██ (which functions can write permits.da, why the ENT cascade differs) is
-- ██ still accurate and still useful. What was wrong was the conclusion.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-13 via MCP apply_migration
--   — never the SQL editor, which records nothing and has hidden three
--   migrations before. Result, verified after the write:
--
--     rows changed .......................... 102   (permits with no DA: 194 → 92)
--     active permits with no DA ............. 107 → 5   (all 5 Demolition)
--     active non-Demolition with no DA ...... 102 → 0
--     `da` filled on active permits ......... 56.1% → 98.0%
--     trigger bp_trg_permits_inherit_da ..... installed
--     permits table row count ............... 466 → 466 (nothing created/deleted)
--
--   Pre-flight: the exact UPDATE below was run inside a transaction that then
--   RAISEd, so it rolled back — first run 102 rows, second run 0 (idempotency
--   proven on real data, not just in the mirror test).
--
--   Post-flight: the trigger was exercised the same way — real INSERTs, then
--   RAISE to roll back. On a project whose BP DA is Francesca:
--     new ULS            -> Francesca   (inherits)
--     new Demolition     -> null        (never guessed)
--     IPR with explicit  -> kept        (never overwritten)
--     project w/ no BP DA-> null        (no error)
--   0 probe rows leaked.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHAT WAS ACTUALLY WRONG
--
-- The brief asked whether a DA cascade exists and is failing, or was never
-- written. Measured against prod: EVERY function that writes permits.da is a
-- REASSIGNMENT or a RENAME. None of them can fill a blank on create:
--
--   bp_move_draw_schedule_da       WHERE da IS NOT NULL AND da = v_old_da
--   bp_undo_project_da_reassign    WHERE p.da = v_h.to_da
--   bp_rename_da                   WHERE da = p_old
--   bp_reassign_project_da         fills NULLs, but only on an explicit handoff
--   bp_update_project_with_permits writes whatever the client sent
--
-- The two creation paths carry no DA at all: useCreatePermit does a plain
-- INSERT (project_id, type, stage, status), and the wizard's addPermit starts
-- a row at da: ''. So: the DA cascade was NEVER WRITTEN.
--
-- The ent_lead cascade (bp_cascade_ent_lead_for_project) is the pattern, and
-- it is instructive: its SECOND branch exists precisely to feed permits whose
-- `da IS NULL` from the BP's ent_lead. ENT was built to cope with a DA-less
-- permit. DA itself never got the equivalent. That is why all 102 rows below
-- have an ent_lead and no DA — measured, not inferred.
--
-- WHY A TRIGGER AND NOT CLIENT CODE
--
-- The gap is 102 rows created through more than one path. A BEFORE INSERT
-- trigger is the only point that covers all of them — the wizard RPC, the
-- Project Settings plain insert, and the scraper's direct writes — and it
-- cannot be bypassed by a caller that forgets.
-- ──────────────────────────────────────────────────────────────────────


-- ── 1. The rule, in exactly one place ────────────────────────────────
-- The DA to inherit for a project, or NULL when there is nothing
-- unambiguous to inherit. Deliberately returns NULL when the project's
-- Building Permits disagree — an ambiguous source is not a source.
--
-- SECURITY INVOKER (the default) so RLS still applies: a user can only
-- inherit from a Building Permit they can already read.
--
-- Deliberately does NOT filter on tenant_id. permits_default_tenant is also
-- a BEFORE INSERT trigger, and triggers of the same timing fire in NAME
-- order — 'bp_trg_permits_inherit_da' sorts before 'permits_default_tenant',
-- so NEW.tenant_id is not reliably populated when this runs. project_id is a
-- uuid and is sufficient on its own.
CREATE OR REPLACE FUNCTION public.bp_inherited_da_for_project(p_project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN count(DISTINCT btrim(da)) = 1 THEN min(btrim(da)) END
  FROM public.permits
  WHERE project_id = p_project_id
    AND type = 'Building Permit'
    AND parent_permit_id IS NULL
    AND da IS NOT NULL
    AND btrim(da) <> '';
$function$;

COMMENT ON FUNCTION public.bp_inherited_da_for_project(uuid) IS
  'fix-302: the unambiguous DA across a project''s non-sub Building Permits, '
  'or NULL when there are none or they disagree. Single source of truth for '
  'both the BEFORE INSERT cascade and the fix-302 backfill.';


-- ── 2. The cascade ───────────────────────────────────────────────────
-- Fill-blanks only. Three refusals, each deliberate:
--   * a DA that is already set stands — this never overwrites a choice;
--   * Demolition is excluded (see the note at the bottom of this file);
--   * an ambiguous or absent BP DA yields NULL, and NULL is not assigned,
--     so a blank stays blank rather than being guessed.
CREATE OR REPLACE FUNCTION public.bp_trg_permits_inherit_da()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_da text;
BEGIN
  -- An explicit choice stands.
  IF NEW.da IS NOT NULL AND btrim(NEW.da) <> '' THEN
    RETURN NEW;
  END IF;

  -- fix-302 section 2: Demolition is a convention, not a rule (Cam holds 85
  -- of 93). Cascading the BP's DA would be wrong on the overwhelming
  -- majority, and defaulting to Cam would be right most of the time and
  -- quietly wrong sometimes. Surfaced, never guessed.
  IF NEW.type = 'Demolition' THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_da := public.bp_inherited_da_for_project(NEW.project_id);

  -- Only ever writes a value. Never nulls, never trims, never overwrites.
  IF v_da IS NOT NULL THEN
    NEW.da := v_da;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bp_trg_permits_inherit_da ON public.permits;
CREATE TRIGGER bp_trg_permits_inherit_da
  BEFORE INSERT ON public.permits
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_trg_permits_inherit_da();


-- ── 3. Backfill the rows already sitting empty ───────────────────────
-- Same rule as the trigger (same function), narrowed to ACTIVE permits.
--
-- "Active" is the codebase's canonical definition, not an ad-hoc one:
--   isPermitDone      (src/lib/projectViewHelpers.ts) — actual_issue set, or a
--                      terminal portal status
--   isSubPermit       (src/lib/subPermit.ts)          — parent_permit_id
--   isCancelledProject(src/lib/projectViewHelpers.ts) — open cancel hold
--
-- Scoped to active on purpose: `da` is also volume-credit on the Team
-- performance report, so filling it on historical/issued permits would move
-- reported numbers. That is a decision, not a side effect of this ticket —
-- the 87 done/issued rows are left alone and reported instead.
--
-- Idempotent: after this runs, every row it touched has a non-blank da, so the
-- WHERE clause matches nothing on a second run.
--
-- updated_at: left to the normal permits_set_updated_at trigger. It bumps, and
-- that trips the scraper's manual-edit guard for the touched rows. Measured
-- cost, not assumed — see the note at the bottom.
UPDATE public.permits p
SET da = public.bp_inherited_da_for_project(p.project_id)
WHERE (p.da IS NULL OR btrim(p.da) = '')
  AND p.type <> 'Demolition'
  AND p.parent_permit_id IS NULL
  AND p.actual_issue IS NULL
  AND COALESCE(btrim(p.status), '') NOT IN
      ('Issued', 'Completed', 'Finaled', 'Closed', 'Withdrawn')
  AND NOT EXISTS (
    SELECT 1 FROM public.project_holds h
    WHERE h.project_id = p.project_id
      AND h.kind = 'cancelled'
      AND h.hold_end IS NULL
  )
  AND public.bp_inherited_da_for_project(p.project_id) IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────
-- MEASURED ON PROD (eibnmwthkcuumyclyxoe) BEFORE APPLYING
--
-- Active permits ................................. 244
-- Active with no DA .............................. 107  (43.9%)
--   of which Demolition (left for a human) ....... 5
--   of which non-Demo w/ exactly ONE BP DA ....... 102  <- this backfill
--   of which BP DA ambiguous ..................... 0
--   of which no BP DA to inherit ................. 0
--   of which are themselves a Building Permit .... 0
--
-- Every blank is a SECONDARY permit on a project whose BP already names a
-- designer. That is the brief's central claim and it reproduces exactly.
--
-- The brief's figures were 114 / 8 / 106. Mine are 107 / 5 / 102 — same
-- shape, slightly smaller, and the two structural zeroes match exactly. The
-- difference is drift plus a definition: the brief's "active" looks like
-- stage-based (coalesce(stage_override,stage) NOT IN ('is','cl')), which
-- yields 165 today; the codebase's isPermitDone rule yields 107. Rows have
-- also issued out of the active set and a few DAs have been typed in by hand
-- since. Nothing was adjusted to make the numbers agree.
--
-- ALSO MEASURED: all 102 target rows already have an ent_lead (0 missing).
-- The ENT cascade reaches DA-less permits; the DA cascade never existed.
--
-- SCRAPER MANUAL-EDIT GUARD (fix-293) — CONFIRMED, NOT ASSUMED
--
-- The backfill bumps updated_at on 102 rows (85 of them scraper-tracked, i.e.
-- carrying a permit number), which trips the guard. What that costs, measured:
--
--   * permits currently carrying a pending_scrape_change ....... 4
--   * max runs_skipped across them ............................. 1
--   * worst consecutive-skip streak, any permit, last 30d ...... 5 runs
--     (40 of the 48 skipped permits were skipped only once or twice)
--
--   ★ The brief expected this to self-heal via fix-293's starvation ceiling.
--     That is only half right, and worth knowing: the ONLY ceiling action
--     present in prod is 'scrape_cycle_forced_after_starvation' (n=2, firing
--     2026-08-12 and -13). There is NO permit-level
--     'scrape_forced_after_starvation'. The ceiling covers the CYCLE path, not
--     the permit row. Permit rows recover a different way — the guard is a
--     time window, so it expires on its own rather than being force-broken.
--     Either way the effect is bounded and self-clearing; a one-shot backfill
--     creates one window, not the daily-edit starvation fix-159 described.
--
-- bp_trg_log_user_activity no-ops when auth.uid() IS NULL, and a migration
-- applied via MCP runs with no JWT — so this backfill writes no activity rows.
--
-- bp_trg_sync_draw_schedule_da fires only WHEN new.type = 'Building Permit';
-- this backfill touches no Building Permits, so it never fires.
--
-- DEMOLITION — LEFT FOR A DECISION (brief section 2)
--
-- 5 active Demolition permits have no DA. Not auto-assigned. If Demolition
-- should have its own rule, the honest one is not "default to Cam" but
-- "Demolition inherits the project's Demolition DA if the project has another
-- Demolition permit, else ask" — but 5 rows is a two-minute job for a human
-- and does not justify a second rule. They are now discoverable via the
-- Project View DA filter's "— Unassigned —" option (fix-302 section 4).
-- ──────────────────────────────────────────────────────────────────────
