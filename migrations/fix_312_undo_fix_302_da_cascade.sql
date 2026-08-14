-- fix-312: undo fix-302. Remove the DA cascade and revert its writes.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-14 via MCP apply_migration
--   — never the SQL editor. Verified after the write:
--
--     rows reverted to da = NULL ................. 107
--     trigger bp_trg_permits_inherit_da .......... dropped (0 left)
--     function bp_trg_permits_inherit_da() ....... dropped (0 left)
--     function bp_inherited_da_for_project() ..... KEPT (1), read-only
--     rows still carrying the 21:28 fingerprint .. 99 -> 0
--     permits with a DA .......................... 393 -> 286
--     permits table row count .................... 487 -> 487
--
--   Pre-flight: the exact UPDATE below was run inside a transaction that then
--   RAISEd, so it rolled back — first run 107 rows, second run 0 (idempotency
--   proven on real data, not just in the mirror test).
--
--   Post-flight, the same way — real INSERTs on a project whose BP DA is
--   Francesca, then RAISE to roll back:
--     new ULS            -> NULL      ★ the acceptance test
--     new IPR            -> NULL
--     ULS with explicit  -> Trevor    (ordinary assignment still works)
--     0 probe rows leaked; 487 rows before and after.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY
--
-- fix-302 put a design associate on permits that should not carry one. Every
-- ULS/IPR/LBA it touched came out equal to its project's Building Permit DA —
-- a cascade signature, not human judgement.
--
--   Bobby: "A design associate and/or design manager should never be assigned
--   to a ULS. IPR records, never assigned ... I don't want us to make that rule
--   right now. I just kind of want us to undo all the design associates that
--   just got assigned to all those permits."
--
-- No replacement rule and no permit-type exclusion list: both explicitly
-- declined. Assignment is manual, by a human, at project creation, and that is
-- the intended state today.
-- ──────────────────────────────────────────────────────────────────────


-- ── 1. Remove the cascade ────────────────────────────────────────────
DROP TRIGGER IF EXISTS bp_trg_permits_inherit_da ON public.permits;
DROP FUNCTION IF EXISTS public.bp_trg_permits_inherit_da();

-- bp_inherited_da_for_project(uuid) is KEPT, deliberately. It reads and
-- returns; it assigns nothing. It is what makes the revert below checkable and
-- re-runnable — you can still ask "what would the cascade have done here?"
-- without anything acting on the answer. The danger was never the function; it
-- was the trigger that called it.
--
-- ★ The brief expected this function to be load-bearing for the Project View
-- "— Unassigned —" filter. It is not: measured, the function has NO client
-- reference at all. That filter is pure client logic (UNASSIGNED_DA in
-- src/lib/projectViewHelpers.ts), derived from `da` being blank, so it works
-- identically with the cascade gone — which is the point, since ~107 permits
-- just went back to showing no DA and that filter is how they stay findable.
COMMENT ON FUNCTION public.bp_inherited_da_for_project(uuid) IS
  'The unambiguous DA across a project''s non-sub Building Permits, or NULL '
  'when there are none or they disagree. fix-312 REMOVED the fix-302 cascade '
  'that called this; the function is now read-only and unused by the app, kept '
  'because it defines the predicate the fix-312 revert is scoped by. Do NOT '
  're-wire it to a trigger without a new decision — auto-assigning a DA was '
  'reverted on purpose.';


-- ── 2. Revert the writes ─────────────────────────────────────────────
-- ★ audit_log recorded NOTHING for fix-302's writes — a migration-driven
-- UPDATE does not go through the app's audit path — so there is no stored
-- prior value to restore. It is reconstructed instead, and it can be
-- reconstructed exactly: every row fix-302 touched went blank -> the BP's DA,
-- because its WHERE clause required `da IS NULL OR btrim(da) = ''`.
-- So the undo is `da = NULL`, and nothing is guessed.
--
-- TWO POPULATIONS, both cascade writes:
--
--   * the BACKFILL — 99 rows still carrying updated_at = 2026-08-13 21:28.
--     ULS 71 · IPR 14 · SIP 4 · TRAO 4 · Grading / Clearing 2 · LSM 2 ·
--     Condo 1 · ECA Waiver 1. No Building Permit, no Demolition, exactly as
--     fix-302's WHERE clause promised.
--
--   * ★ the TRIGGER — 8 permits CREATED after fix-302 and assigned a DA on
--     INSERT (6 ULS, 1 LBA, 1 TRAO; all Ainsley, all equal to their project's
--     BP DA, all scraped LU records the scraper never writes `da` on). The
--     brief models fix-302 as a one-shot backfill and does not mention these.
--     They are the same mistake, still being made, and 6 of them are the exact
--     type Bobby named. Reverting the backfill while leaving these would ship
--     "undo the cascade" with fresh cascade output still on the board.
--
-- The da-equals-BP check is the belt-and-braces. The timestamp is the strong
-- discriminator; the equality makes a coincidental match harmless and protects
-- every DA a person typed, including one that happens to name the same person
-- as the Building Permit.
--
-- ★ 3 backfill rows have DRIFTED off the timestamp (touched since, on 14 Aug).
-- They are NOT reverted. They are listed in the PR for Bobby to decide — the
-- brief's instruction, and the right one: a row someone has since edited is a
-- row someone may have made a decision about.
UPDATE public.permits p
SET da = NULL
WHERE p.parent_permit_id IS NULL
  AND p.type NOT IN ('Building Permit', 'Demolition')
  AND p.da IS NOT NULL
  AND btrim(p.da) = btrim(public.bp_inherited_da_for_project(p.project_id))
  AND (
    (p.updated_at >= '2026-08-13T21:28:00Z' AND p.updated_at < '2026-08-13T21:29:00Z')
    OR p.created_at >= '2026-08-13T21:28:00Z'
  );


-- ──────────────────────────────────────────────────────────────────────
-- MEASURED ON PROD, AND WHERE IT DIFFERS FROM THE BRIEF
--
-- The brief's ULS row said 83 with a DA = 76 written by fix-302 + 7
-- pre-existing. Measured, the same 83 splits differently:
--
--   71  backfill (fingerprinted)     -> reverted
--    6  created since, by the trigger -> reverted
--    1  drifted                       -> LEFT, listed
--    5  genuinely pre-existing        -> LEFT
--   ---
--   83  ✓ totals agree exactly, which is the check that the classification
--       is complete rather than merely plausible.
--
-- So 78 of the 83 were cascade writes, not 76, and 5 predate 13 August, not 7.
-- The five survivors, each last touched between 9 July and 4 August, well
-- before fix-302: 3043266-LU (Nicky) · 3043471-LU (Erick) · 3044084-LU (Fisk)
-- · 3044093-LU (Francesca) · 3043436-LU (Marc). Nothing was adjusted to make
-- the numbers agree.
--
-- THE 3 DRIFTED ROWS — left alone, for Bobby
--
--   3044216-LU  ULS   Ainsley     1327 44th Ave SW    updated 13 Aug 22:10
--   (no num)    IPR   Ainsley     1327 44th Ave SW    updated 13 Aug 22:10
--   7102013-CN-002 PPR Francesca  725 N 92nd ST       updated 14 Aug 15:46
--
--   Worth knowing when deciding: all three still carry EXACTLY the cascaded
--   value, and the first two share an identical microsecond timestamp on one
--   project — a bulk write, not a person retyping a name. So it is unlikely
--   anyone reassigned them; something else on the row was touched. They are
--   still left alone, because "unlikely" is not "confirmed".
--
-- VOLUME CREDIT — `da` is credit on the Team performance report, so this MOVES
-- REPORTED NUMBERS. It is a correction, not a regression, but it is visible:
--
--   Ainsley 46->25 · Ahmadi 42->22 · Marc 42->26 · Francesca 31->17 ·
--   Fisk 39->27 · Trevor 27->15 · Nidhi 7->3 · Chad 4->2 · Nicky 25->23 ·
--   Qisheng 20->18 · Alex 4->3 · Erick 8->7 · Cam 93->93 · Shire 4->4
--
--   Cam is untouched, which is itself a check: fix-302 excluded Demolition and
--   Cam holds 85 of 93 Demolition permits.
--
-- ★ SCRAPER MANUAL-EDIT GUARD (fix-293) — fix-302's CLAIM DOES NOT HOLD
--
-- fix-302 recorded the guard trip as "bounded and self-clearing". Re-measured
-- 24 hours later, it has not cleared:
--
--   * the scraper HAS run since (last stamp 14 Aug 21:05, 16 permits);
--   * 0 of the 99 fix-302 rows were among them;
--   * 84 of the 99 still have updated_at newer than last_scraper_update_at,
--     which is the guard's precondition;
--   * base rate for comparison: 16 of 357 other scraper-tracked permits were
--     re-stamped in the same period (4.5%), so ~4 of the 99 would be expected
--     by chance and 0 were observed.
--
--   That is consistent with the guard holding those rows back; it is NOT proof
--   (one day, and the scraper's per-run scope is decided in the scraper repo,
--   which is out of scope here). Either way this revert bumps updated_at a
--   second time and extends the window. Flagged rather than assumed — the
--   brief asked for confirmation and the honest answer is "unconfirmed, and
--   the earlier claim looks optimistic".
--
-- TRIGGERS THIS UPDATE FIRES (enumerated, not hoped for):
--   permits_set_updated_at ......... bumps updated_at (the cost above)
--   bp_log_user_activity ........... no-ops when auth.uid() IS NULL, and a
--                                    migration applied via MCP carries no JWT
--   bp_trg_sync_draw_schedule_da ... WHEN new.type = 'Building Permit' only;
--                                    this touches none, so it never fires
--   everything else on permits is OF status / intake_date / dd_end /
--   dd_start / target_submit / actual_issue — none of which this writes.
-- ──────────────────────────────────────────────────────────────────────
