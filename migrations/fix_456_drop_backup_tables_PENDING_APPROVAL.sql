-- ===========================================================================
-- fix-456 — THE AD-HOC BACKUP TABLES, AND TWO DEAD COLUMNS (P-036)
-- ===========================================================================
--
-- ★★★ NOTHING IN THIS FILE HAS BEEN APPLIED, AND NOTHING IN IT MAY BE APPLIED
-- BY CI, BY A MIGRATION RUNNER, OR BY ME. Every statement is commented out.
-- Bobby approves a group; Claude applies from Cowork. A DROP is irreversible
-- and this database is live — that is the whole reason this file exists rather
-- than a migration.
--
-- RE-MEASURED 2026-08-30. Read the full reasoning in
-- migrations/BACKUP_TABLE_INVENTORY.md — one row per table, with the fix that
-- created it and the sentence that says why it can go.
--
-- ---------------------------------------------------------------------------
-- WHAT THE MEASUREMENT FOUND
-- ---------------------------------------------------------------------------
--   · 26 ad-hoc tables (not 25 — the brief's pattern misses
--     `_parking_site_archive_2026_08_25`, which says *archive* not *backup*).
--   · ALL 26 have RLS enabled and ZERO policies, so nothing can read them.
--     ★ THIS IS NOT A LEAK. Do not write it up as one. 21 carry an `anon=r`
--     grant the empty policy set makes meaningless; that grant is P-105's open
--     follow-on and fix-455 deliberately left anon SELECT alone. So does this.
--   · ~528 kB in total. This was never a space problem.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY THERE IS NO `DO` BLOCK AND NO REGEX IN THIS FILE
-- ---------------------------------------------------------------------------
-- A block that drops whatever matches `backup|snapshot|...` is how a real table
-- with an unlucky name dies. This file is not a hypothetical about that: the
-- brief's own pattern MISSED `_parking_site_archive_2026_08_25`, the one table
-- on the page that must never be dropped. A pattern that both misses what you
-- need and could catch what you do not is not a tool for an irreversible
-- operation. **Names, spelled out, one per line.**

-- ===========================================================================
-- ★★★ KEEP — NOT DROPPED, AND NOT BECAUSE NOBODY GOT TO THEM
-- ===========================================================================
--
--   _parking_site_archive_2026_08_25   182 rows
--   _fix22_permits_dropped_cols_snapshot  173 rows
--
-- ★★★ THESE TWO ARE THE ONLY RECORD OF SITE PARKING and there is deliberately
-- no DROP written for them, not even a commented one, so an approving skim
-- cannot uncomment them by accident.
--
--   · `_parking_site_archive_2026_08_25` holds 181 non-null `parking_type` and
--     180 non-null `parking_stalls`. src/lib/database.types.ts names it BY NAME
--     in the @deprecated note on Project.parking_type. fix-402's reasoning:
--     *"the site answers are the only record of what the team believed before
--     the per-unit book is backfilled"* — and only 8 of 202 projects carry
--     unit-level parking today, so that backfill has barely begun.
--   · `_fix22_permits_dropped_cols_snapshot` holds 171 non-null
--     `parking_stalls` and 30 non-null `parking_type` from when those columns
--     lived on `permits`. Those values did NOT survive into `projects` (0 of
--     202 non-null today), so it is an independent EARLIER record, not a copy.
--
-- ★★ READ THIS TOGETHER WITH SCOPE C BELOW. Dropping the two columns is safe
--    BECAUSE these tables exist. Approving both in one sitting would remove the
--    column and its record together.

-- ===========================================================================
-- GROUP A — created by a shipped fix whose migration is committed here (7)
-- ===========================================================================
-- The strongest group: a migration in this repo creates each one, that fix is
-- merged, and it has been live without a revert.

-- fix-415: pre-remap projects.zone for every project that had one. The zone
-- registry has governed the field since 08-26 and zone is edited freely now.
-- drop table if exists public._fix415_zone_remap_backup_2026_08_26;

-- fix-425: projects.builder_id before the builder-catalog link backfill.
-- ★ The only one of the 26 carrying a COMMENT that names its own fix.
-- drop table if exists public._fix425_builder_link_backup_2026_08_28;

-- fix-415: lot dimensions before rounding.
-- drop table if exists public._fix415_lot_round_backup_2026_08_26;

-- fix-notes-4: the old report_notes rows before unification into public.notes.
-- Six weeks live; the Weekly DA note box reads and writes `notes` both ways.
-- drop table if exists public._report_notes_backup_20260717;

-- fix-412: the 7 rows re-typed from Existing to Remodel.
-- drop table if exists public._fix412_existing_to_remodel_backup_2026_08_26;

-- fix-249-apply (merged 2026-07-28): every permit's target_submit and its
-- manual flag before policy-beats-learner. Five weeks live and re-derived many
-- times since. ★ This is the table the Brain's note flags as having no
-- provenance row — BACKUP_TABLE_INVENTORY.md is now that row.
-- drop table if exists public._target_submit_backup_20260728;

-- fix-249-apply: the per-(type, jurisdiction) offset policy before the same
-- change.
-- drop table if exists public._target_submit_formula_backup_20260728;

-- ===========================================================================
-- GROUP B — attributed from columns + date, NOT from a migration (3)
-- ===========================================================================
-- ★ No committed migration creates these. The attribution is the column shape
--   plus a date matching a merged fix. Good enough to drop, weaker than Group
--   A — which is why approving A does not silently approve B.

-- fix-notes-1..5 era (2026-07-17); columns are exactly public.notes. Junk note
-- rows removed during the unification.
-- drop table if exists public._notes_junk_backup_20260717;

-- fix-232 era (2026-07-10); columns are product_types text[] + unit_types.
-- Pre-remap product types; the canonical registry has governed the field since.
-- drop table if exists public._productype_remap_backup_20260710;

-- Same; one orphaned app_config row (key, value jsonb, tenant_id).
-- drop table if exists public._orphaned_producttypes_key_backup_20260710;

-- ===========================================================================
-- GROUP C — the SCRAPER repo's fixes, unverifiable from this repo (3)
-- ===========================================================================
-- ★ The names attribute cleanly to scraper-254 / 255 / 257, but those live in
--   `Blueprint-Dashboard-`, so THIS repo cannot confirm they landed. All three
--   are permit_cycles date snapshots from 2026-07-28, five weeks stale. Safe on
--   the evidence — but the evidence is a name, and that is said out loud here
--   rather than implied by putting them in Group A.

-- drop table if exists public._scraper254_kirkland_backup_20260728;
-- drop table if exists public._scraper255_kirkland_backup_20260728;
-- drop table if exists public._scraper257_seattle_corr_backup_20260728;

-- ===========================================================================
-- ★★ GROUP D — UNATTRIBUTED. DO NOT DROP WITHOUT A LOOK (11)
-- ===========================================================================
--
-- ★★★ NOT ATTRIBUTED TO ANY FIX, in this repo or by table comment. Each is
-- recognisably a one-off data repair — a named permit, a deleted row, a
-- jurisdiction fix — but "the name looks like a throwaway" is a GUESS, and a
-- guess is not an attribution. A backup whose fix never landed is not
-- disposable, and from here there is no way to tell which of these that is.
--
-- 91 rows and 184 kB between them. There is no cost to leaving them until
-- somebody who was there recognises the name. **Approve this group only if you
-- recognise the specific table.**

-- 24 rows — MBP permits marked in corrections too early (2026-07-13).
-- drop table if exists public._mbp_premature_corr_backup_20260713;

-- 19 rows — generic {src, row jsonb} backup for record 108851 (2026-08-19).
-- drop table if exists public._gd_108851_cycle_backup_20260819;

-- 8 rows — orphaned Seattle permit_cycle_reviewers rows (2026-07-28).
-- drop table if exists public._seattle_reviewer_orphan_backup_20260728;

-- 8 rows — permit 3626, MBP re-correction (2026-07-17).
-- drop table if exists public._mbp_3626_recorr_backup_20260717;

-- 7 rows — a deleted chat thread, 1301 (2026-08-19).
-- drop table if exists public._deleted_thread_1301_backup_20260819;

-- 6 rows — permit 3626 again, second pass (2026-07-17).
-- drop table if exists public._mbp_3626_recorr_backup_20260717b;

-- 2 rows — permit 3056, {kind, ref, old_val} (2026-07-17).
-- drop table if exists public._dd3056_fix_backup_20260717;

-- 2 rows — a deleted test row, 4017 (2026-08-20).
-- drop table if exists public._deleted_test_4017_backup_20260820;

-- 2 rows — a permit-type correction (2026-07-28).
-- drop table if exists public._permit_type_fix_backup_20260728;

-- 2 rows — full permit_cycles shape + permit_num (2026-07-28).
-- drop table if exists public._seattle_cycle_fix_backup_20260728;

-- 1 row — full intake_records shape (2026-07-28).
-- drop table if exists public._intake_date_fix_backup_20260728;

-- ===========================================================================
-- SCOPE C — projects.parking_stalls AND projects.parking_type
-- ===========================================================================
--
-- ★★★ BOTH ARE 100% NULL: 0 non-null of 202 projects, for each column.
-- fix-402 moved parking onto the unit (`unit_types[].parking_kind` /
-- `.parking_stalls`) and these two never followed. They are DEAD columns, not
-- empty ones.
--
-- ZERO READERS, verified 2026-08-30:
--   · `src/hooks/useProjects.ts:39` dropped them from the select on purpose —
--     *"they are archived and NULL on every row; selecting them would ship 186
--     nulls to every client on every load to feed nothing."*
--   · Every other `parking_stalls` in `src/` is the UNIT-level field on
--     `UnitType` (LibraryMatrix, UnitTypesEditor, unitParking, unitRowLayout,
--     unitTypeNaming, libraryHelpers, libraryUnitRows) or a history comment.
--   · No RPC, trigger or view reads either column.
--   · `src/lib/correctionsSegments.ts:96` records that fix-402 removed the
--     "Parking type" report segment.
--
-- ★★ THE DROP IS SAFE ONLY WHILE THE ARCHIVE STANDS. Do not approve these two
--    statements in the same sitting as a drop of
--    `_parking_site_archive_2026_08_25` or
--    `_fix22_permits_dropped_cols_snapshot` — no DROP is written for either,
--    and this is why.
--
-- ★ The @deprecated declarations in src/lib/database.types.ts are DELIBERATELY
--   LEFT IN PLACE until these run. fix-402 kept them typed "so the archive
--   story is discoverable from the type rather than only from a migration
--   file", and that reasoning holds until the column is actually gone. When
--   these two statements are applied, delete the two declarations in the same
--   change so the type and the database never disagree.

-- alter table public.projects drop column if exists parking_stalls;
-- alter table public.projects drop column if exists parking_type;

-- ===========================================================================
-- STATEMENT COUNT: 26 destructive statements, ALL COMMENTED OUT
--   Group A  7 drop table
--   Group B  3 drop table
--   Group C  3 drop table
--   Group D 11 drop table   ← unattributed; approve individually
--   Scope C  2 alter table … drop column
--   KEEP     0 — two tables carry no statement at all, by design
-- ===========================================================================
--
-- VERIFY BEFORE APPLYING ANY OF IT (read-only):
--   select c.relname, (select count(*) from pg_policy p where p.polrelid=c.oid) as policies
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r' and c.relname like '\_%'
--    order by 1;
--   select count(parking_stalls), count(parking_type) from public.projects;  -- 0, 0
--   select count(*) from public._parking_site_archive_2026_08_25;            -- 182
