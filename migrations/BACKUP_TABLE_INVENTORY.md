# The ad-hoc backup tables — what each one is, and whether it can go

**Measured on prod 2026-08-30, read-only. Nothing in this ticket was applied.**
The drops live in `fix_456_drop_backup_tables_PENDING_APPROVAL.sql`, every
statement commented out, for Bobby to approve a group at a time.

---

## Two things to read before the table

**★★★ THEY ARE INERT, AND THAT IS THE FINDING — NOT A LEAK.** All 26 have RLS
**enabled** and **zero policies**. RLS with no policy denies everything, so
neither `anon` nor `authenticated` can read a row from any of them. 21 carry an
`anon=r` grant that the empty policy set makes meaningless. *(That grant is
P-105's open follow-on and Bobby's call — fix-455 deliberately left anon SELECT
alone, and this ticket does not touch it either.)* **~528 kB in total. This was
never a space problem;** it is a legibility problem, and this page is the fix.

**★★★ THERE ARE 26, NOT 25.** The brief's pattern
(`backup|snapshot|_bak|_old|_20[0-9]{6}|_copy`) misses
**`_parking_site_archive_2026_08_25`** — it says *archive*, not *backup*, and
its date is underscored. It is 64 kB, RLS on, zero policies, and it is **the
single most important table on this page** (see KEEP below). A pattern that
misses the one table you must not drop is the argument for writing names out by
hand, which is what the drop file does.

---

## ★★★ KEEP — do not drop these two

| table | rows | why it stays |
|---|---:|---|
| `_parking_site_archive_2026_08_25` | **182** | ★★★ **The only record of site parking.** 181 non-null `parking_type`, 180 non-null `parking_stalls`. `src/lib/database.types.ts` names this table by name in the `@deprecated` note on `Project.parking_type`. fix-402's own reasoning: *"the site answers are the only record of what the team believed before the per-unit book is backfilled"* — and that backfill has barely started: **8 of 202 projects** carry unit-level parking today. Dropping this loses 182 rows of real answers with nothing to restore from. |
| `_fix22_permits_dropped_cols_snapshot` | **173** | ★★ **A second, older parking record, and the only pre-fix-22 one.** Holds **171 non-null `parking_stalls` and 30 non-null `parking_type`** from when those columns lived on `permits`, plus `zone`, `lot_width`, `lot_depth`, `unit_types` and the four builder columns. Those values did **not** survive into `projects` (0 of 202 non-null today), so this is not a duplicate of the archive above — it is an independent earlier snapshot. Keep it at least until the per-unit parking book is filled in. |

★ Read those two together with **Scope C**: dropping `projects.parking_stalls` /
`parking_type` is safe *because* these tables exist. Approving the column drop
and a drop of these tables in the same sitting would remove both the column and
its record.

---

## Can be dropped — grouped so a subset can be approved

### Group A — created by a shipped fix, with the creating migration in this repo (7)

Each of these was written by a migration that is committed here and merged, and
the fix it protected has been live for days or weeks without a revert.

| table | rows | size | creating fix | fix status | why it can go |
|---|---:|---:|---|---|---|
| `_fix415_zone_remap_backup_2026_08_26` | 191 | 48 kB | **fix-415** — `migrations/fix_415_zone_registry_and_remap.sql:32` creates it | merged, live since 08-26 | Pre-remap `projects.zone` for every project that had one. The registry has been in use for days and zone is edited freely since. |
| `_fix425_builder_link_backup_2026_08_28` | 147 | 24 kB | **fix-425** — the table's own `COMMENT` says so | merged (`37e7542`) | `builder_id` before the catalogue link backfill. ★ The only table here carrying a `COMMENT` that names its own fix — the practice worth keeping. |
| `_fix415_lot_round_backup_2026_08_26` | 29 | 16 kB | **fix-415** — `migrations/fix_415_round_lot_dimensions.sql:36` | merged, live since 08-26 | Lot dimensions before rounding. |
| `_report_notes_backup_20260717` | 31 | 16 kB | **fix-notes-4** — `migrations/fix_notes_4_unify_report_notes.sql:31` | merged (`#237`) | The old `report_notes` rows before the unification into `public.notes`. fix-notes-4 has been live six weeks and the Weekly DA note box reads `notes` both ways. |
| `_fix412_existing_to_remodel_backup_2026_08_26` | 7 | 16 kB | **fix-412** — `migrations/fix_412_existing_to_remodel.sql:36` | merged, live since 08-26 | 7 rows re-typed from Existing to Remodel. |
| `_target_submit_backup_20260728` | **419** | 40 kB | **fix-249-apply** — merged 2026-07-28 (`756e717`), and the columns are exactly `target_submit` + `target_submit_is_manual` | merged | Every permit's target-submit and its manual flag before policy-beats-learner. Five weeks live; the policy has since been re-derived many times. ★ This is the one the Brain's note flags as having no provenance row — it has one now, here. |
| `_target_submit_formula_backup_20260728` | 14 | 16 kB | **fix-249-apply** — columns are the per-`(type, jurisdiction)` offset policy | merged | The offset table before the same change. |

### Group B — attributed from columns + date, not from a migration (3)

★ No committed migration creates these; the attribution is the column shape plus
the date matching a merged fix. **Good enough to drop, weaker than Group A** —
which is why it is a separate group.

| table | rows | size | most likely fix | why it can go |
|---|---:|---:|---|---|
| `_notes_junk_backup_20260717` | 138 | 40 kB | **fix-notes-1..5** era (07-17) — columns are exactly `public.notes` | Junk note rows removed during the notes unification. `notes` has been the single source since. |
| `_productype_remap_backup_20260710` | 35 | 24 kB | **fix-232** (product-type registry, merged in that window) — columns are `product_types text[]`, `unit_types` | Pre-remap product types. The canonical registry has governed the field since fix-232, and fix-449 re-ruled it again. |
| `_orphaned_producttypes_key_backup_20260710` | 1 | 16 kB | same — columns are an `app_config` row (`key`, `value jsonb`, `tenant_id`) | One orphaned `app_config` key. |

### Group C — the scraper repo's fixes, which cannot be verified from here (3)

★ The names attribute cleanly to **scraper-254 / 255 / 257**, but those live in
`Blueprint-Dashboard-` (the scraper repo), so **this repo cannot confirm they
landed**. All three are cycle-date snapshots from 2026-07-28, five weeks stale.
Safe on the evidence, but say so out loud rather than implying verification.

| table | rows | size |
|---|---:|---:|
| `_scraper254_kirkland_backup_20260728` | 55 | 16 kB |
| `_scraper255_kirkland_backup_20260728` | 55 | 16 kB |
| `_scraper257_seattle_corr_backup_20260728` | 13 | 16 kB |

### ★★ Group D — UNATTRIBUTED. Do not drop without a look (11)

**These are not attributed to any fix**, in this repo or by table comment. Each
is recognisably a one-off data repair — a named permit, a deleted row, a
jurisdiction fix — but *"the name looks like a throwaway"* is a guess, and B2 is
explicit that a guess is not an attribution. They total **91 rows and 184 kB**;
there is no cost to leaving them until somebody recognises them.

| table | rows | size | what its columns say it holds |
|---|---:|---:|---|
| `_mbp_premature_corr_backup_20260713` | 24 | 16 kB | `permit_id, num, status, corr_rounds, cycle_index, corr_issued` — MBP permits marked in corrections too early |
| `_gd_108851_cycle_backup_20260819` | 19 | 24 kB | `src text, row jsonb` — generic row backup for record 108851 |
| `_seattle_reviewer_orphan_backup_20260728` | 8 | 16 kB | `permit_cycle_reviewers` rows with a `permit_num` — orphaned Seattle reviewers |
| `_mbp_3626_recorr_backup_20260717` | 8 | 16 kB | `kind, ref, status, extra` — permit 3626 |
| `_deleted_thread_1301_backup_20260819` | 7 | 16 kB | `src text, row jsonb` — a deleted chat thread |
| `_mbp_3626_recorr_backup_20260717b` | 6 | 16 kB | `num, status, corr_rounds, cycle2_corr` — permit 3626, second pass |
| `_dd3056_fix_backup_20260717` | 2 | 16 kB | `kind, ref, old_val` — permit 3056 |
| `_deleted_test_4017_backup_20260820` | 2 | 16 kB | `src text, row jsonb` — a deleted test row |
| `_permit_type_fix_backup_20260728` | 2 | 16 kB | `id, num, type, status` — a permit-type correction |
| `_seattle_cycle_fix_backup_20260728` | 2 | 16 kB | full `permit_cycles` shape + `permit_num` |
| `_intake_date_fix_backup_20260728` | 1 | 16 kB | full `intake_records` shape |

---

## Totals

| | tables | rows | size |
|---|---:|---:|---:|
| **KEEP** | 2 | 355 | 104 kB |
| Group A — shipped fix, migration in repo | 7 | 838 | 176 kB |
| Group B — attributed by columns + date | 3 | 174 | 80 kB |
| Group C — scraper repo, unverifiable here | 3 | 123 | 48 kB |
| **Group D — UNATTRIBUTED** | 11 | 91 | 184 kB |
| **total** | **26** | **1,581** | **~528 kB** |

Approving **A + B + C** drops **13 tables / ~304 kB** and leaves every table
whose provenance is unknown and both parking records. That is the recommended
subset.

---

## ★ The habit that would end this

`_fix425_builder_link_backup_2026_08_28` is the only one of the 26 that carries
a `COMMENT ON TABLE` naming its fix, its date and its purpose. It took one line
in the migration that created it, and it is the reason that table needed no
detective work here. **Every future backup table should carry one** — otherwise
the next person writes this page again in six weeks, against thirty tables.
