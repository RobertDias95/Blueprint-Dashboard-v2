# Pending-approval backfills — the one page

Seven files carried the rows six shipped fixes never moved. Each quoted counts
measured on the day it was written; **fix-450 re-measured all seven on
2026-08-30** and this table is what those files now say about themselves.
fix-451 and fix-456 have since joined the shelf, and fix-459 appended a
Scope D to fix-456's file.

> ★★★ **fix-456 IS THE FIRST DESTRUCTIVE FILE HERE.** Every other file on this
> page MOVES rows and could in principle be undone. fix-456 carries `DROP TABLE`
> and `ALTER TABLE … DROP COLUMN`, which cannot. Read
> `BACKUP_TABLE_INVENTORY.md` before approving any of its groups — in
> particular, **two tables deliberately carry no DROP statement at all** because
> they are the only surviving record of site parking.
>
> ★★★ **AND SCOPE D CANNOT BE APPROVED ON ITS OWN.** fix-459 appended one
> statement — dropping the dead `permit_tasks.co_assignees` (non-empty on **zero**
> of 1,643 rows; the live source is the `permit_task_assignees` join table, and
> this column already produced a wrong number in fix-458's brief). **Two database
> functions still read it** — `bp_task_touched_by_person` and
> `bp_trg_permit_lead_cascade` — and both must be edited FIRST. fix-459
> deliberately edited neither. Approving that line alone would take the app down.

> **Nothing here has been applied.** Every file's SQL is commented out and a
> test keeps it that way. Bobby approves the batch; Claude applies from Cowork.

> ★★ **fix-474's consultant seed LEFT THIS SHELF on 2026-09-02 — APPROVED AND
> APPLIED.** Bobby was asked directly, with the cost stated out loud (seeded
> rows say `Scheduled` about work that may already be finished), and said copy
> them all. It shipped as fix-479 §E: migrations/fix_479_seed_from_external_team.sql,
> **164 records, 164 rounds, 0 claiming history, 0 voided**, applied after
> fix-479 §C's void migration so no seeded row was ever reachable by a `delete`.
> Its resolve gate fired on ONE unmatched pair — *Steep Slope Tree Consulting* /
> Arborist — and Bobby approved adding that one directory row rather than
> skipping the project. It is listed here rather than deleted because it was
> the first file on this page whose rows did not exist yet, and that is the
> shape the next one will have.

## The table

| file | what it moves | verdict | rows today | rows when written | date measured |
|---|---|---|---|---|---|
| `fix_368_backfill_PENDING_APPROVAL.sql` | co-assigns the project's design manager onto tasks held by an unmapped DA | **MOVES ROWS** | **1** | 20 | 2026-08-20 |
| `fix_377_backfill_SUPERSEDED.sql` | rewrote a permit's `ent_lead` / `dm` to its project's | **MOVES NOTHING** | 0 | 6 + 16 | 2026-08-27 |
| `fix_379_backfill_SUPERSEDED.sql` | derived `permits.dm` from the DA — clears, fills, corrections | **MOVES NOTHING** | 0 | 123 | 2026-08-21 |
| `fix_379_mapping_rows_PENDING_APPROVAL.sql` | three departed-DA rows in `dm_da_groups` | **MOVES ROWS** | **1** | 3 | 2026-08-21 |
| `fix_381_backfill_PENDING_APPROVAL.sql` | opens a "CR 1" thread on projects still in design | **MOVES ROWS** | **63** | 87 | 2026-08-28 |
| `fix_384_label_candidates_PENDING_APPROVAL.sql` | links an NP time block to the project its label names | **MOVES ROWS** | **1** (+1 undecided) | 1 (+1) | 2026-08-28 |
| `fix_387_entry_drafts_PENDING_APPROVAL.sql` | adds `go_href` teaching links to What's New entries | **MOVES ROWS** | **3** of 14 drafted | 14 drafted | 2026-08-29 |
| `fix_451_not_required_PENDING_APPROVAL.sql` | deactivates the directory row named "Not Required" so it stops being offered as a firm | **MOVES ROWS** | **1** | 1 | 2026-08-30 |
| `fix_456_drop_backup_tables_PENDING_APPROVAL.sql` | drops 24 of the 26 ad-hoc backup tables, the two dead `projects.parking_*` columns, and — Scope D, appended by fix-459 — the dead `permit_tasks.co_assignees` | **DESTRUCTIVE — 27 statements** | n/a (drops, not moves) | 27 | 2026-08-30 |
| `fix_532c_resolve_returns_archived_flag_PENDING_APPROVAL.sql` | adds `is_archived_fallback` to `bp_resolve_plan_share`'s RETURNS so the `/s/` share page can say a drawing is superseded | **MOVES NOTHING — one function** | n/a (no rows) | n/a | 2026-09-12 |
| `fix_537a_plan_of_record_sets_security_invoker_PENDING_APPROVAL.sql` | sets `security_invoker = true` on `project_plan_of_record_sets`, so the plan-of-record view stops reading around the RLS policy on `project_file_index` | **MOVES NOTHING — one view flag, and REVERSIBLE** | n/a (no rows) | n/a | 2026-09-13 |
| `fix_537b_drop_draw_schedule_color_override_PENDING_APPROVAL.sql` | patches `bp_upsert_draw_schedule_row`, then drops the dead `draw_schedule.color_override` | **DESTRUCTIVE — 1 column, 2 statements** | n/a (drops, not moves) | 14 rows carried `''`, 0 carried a colour | 2026-09-13 |
| `fix_521_drop_draw_schedule_color_override_SUPERSEDED.sql` | the same drop, written so that it could not run | **CANNOT RUN — superseded by fix-537b** | n/a | n/a | 2026-09-13 |
| `fix_538_role_write_levels_PENDING_APPROVAL.sql` | makes the ROSTER decide who may write: `bp_write_caps` plus two gates moved off admin-only — the Schematic Designer (P-234) and the project DA | **MOVES NOTHING — 5 functions, 2 gates WIDENED** | n/a (no rows) | n/a | 2026-09-13 |
| `fix_539_da_row_scope_PENDING_APPROVAL.sql` | stage two: a DA writes the projects they are ON (or one no DA is on), enforced in the RLS policy AND the RPC together — **this is where the direct-write bypass closes** | **NARROWS — 4,957 person x project pairs close; 14 accounts go to 0** | n/a (no rows) | n/a | 2026-09-13 |
| `fix_540_consultant_sync_gate_PENDING_APPROVAL.sql` | gates the two consultant functions that sync `projects.external_team` — the half of fix-539 whose anchor would have matched nothing and reported success | **MOVES NOTHING — 2 functions gated** | n/a (no rows) | n/a | 2026-09-13 |
| `fix_542_notes_to_general_PENDING_APPROVAL.sql` | copies all 107 notes into each project's General post as replies, and gives every project a General | **COPIES 107 ROWS — deletes nothing** | 107 | 107 | 2026-09-14 |
| `fix_547_statements_that_cannot_run_PENDING_APPROVAL.sql` | drops four functions that cannot run (one 42P10, one pre-fix-22 fossil naming 15 dead columns, two import one-shots) and repairs the one with a single dead column | **DESTRUCTIVE — 4 functions dropped, 1 repaired** | n/a (no rows) | n/a | 2026-09-14 |
| `fix_549_cam_edits_any_project_PENDING_APPROVAL.sql` | adds profiles.may_edit_all_projects, grants it to Cam by email, one branch in bp_may_write_project, and scopes project DELETE to admins | **1 column, 1 grant, 2 functions, 1 policy** | 1 (the grant) | 1 | 2026-09-14 |
| `fix_567_shire_backfills_the_schedule_PENDING_APPROVAL.sql` | grants may_edit_all_projects to Shire by email, adds profiles.may_edit_draw_schedule and teaches it to ALL FIVE gate sites — three ALL policies plus bp_can_edit_draw_schedule and bp_assert_draw_schedule_admin. The tenant check stays above the grant. DELETE untouched (fix-549 §D). | **1 column, 2 grants, 2 functions, 3 policies** | 2 (the grants) | 2 | 2026-09-14 |
| `fix_559_a_note_belongs_to_a_task_PENDING_APPROVAL.sql` | backs up then DELETES all 107 `notes` rows, guarded on every one having a General-channel copy (fix-542). The TABLE stays — three readers still query it (Weekly Updates, the Weekly DA note box, Project View's note search) and they render empty afterwards. Reverses fix-294 by Bobby's ruling; `permit_tasks.notes` is un-frozen in the app, no schema change. | **0 schema changes, 1 backup table, 1 delete of 107 rows** | 107 (all of `notes`) | 0 | 2026-09-15 |
| `fix_562_unit_matrix_vocabulary_PENDING_APPROVAL.sql` | snapshots every unit row into `_fix562_unit_matrix_snapshot`, then WIPES `parking_kind`, `parking_stalls`, `roof_deck` and `stories` from all 270 units; seeds the three new `app_config` vocabulary registries; and DROPs + recreates `bp_update_library_fields` with a jsonb patch so a Library field can be cleared (it could not be — proved on prod, rolled back) plus `lot_size_sf`, `is_corner_lot` and `juris`. **Bobby ruled the wipe after being told ~105 of 123 parking rows would convert automatically: _"Wipe it all as I said."_ Somebody was backfilling this book while the ticket was written — the counts moved 267→270 in 25 minutes, and the wipe clears that work too.** | **DESTRUCTIVE — clears 4 keys on 270 units; 1 backup table, 1 function dropped, 3 config rows** | 270 units (126 parking · 126 stalls · 126 roof deck · 259 stories) | same | 2026-09-15 |
| `fix_577_ana_and_pto_PENDING_APPROVAL.sql` | adds `'schematic'` to the `project_details` arm of `bp_write_caps` (the other two arms re-emitted byte-identical from the live definition), then renames `da_time_blocks.type` `Vacation`→`PTO` on all 37 rows and the ECHOED label on 16 of them. **The 21 custom labels are deliberately untouched.** The label statement MUST run first — both filter on `type='Vacation'`. Probed on prod, rolled back: Ana `false→true`, a `da`-only login `false→false`. | **1 function, 37 rows retyped, 16 relabelled** | 37 + 16 | same | 2026-09-15 |
| `fix_580_empty_string_timestamp_PENDING_APPROVAL.sql` | **LIVE PRODUCTION DEFECT (P-285).** Rewrites four function bodies and moves no rows. `bp_list_tasks` starts carrying `updated_at` so the task panel stops posting the literal `''` PostgREST refused as a timestamp (error_reports 731/732 — brittani, **nothing saved, twice**). `bp_upsert_team_task` stops NULLing `due_date`, `ref_project_id` and `ref_permit_id` on every partial patch, and takes explicit `clear_*` keys so emptying a field still works. NINE sibling `bp_upsert_*_row` functions get their unguarded `p_data` casts wrapped, by anchor with a hit assertion. ⚠️ **ROLLED BACK AT APPLY TIME 2026-09-15** — the §C block asserted `v_hits <> 8` over a list of NINE functions. **fix-566 repaired it**: the expected count is now derived from the job array itself, so it cannot disagree with the list again. `bp_new_error_count` counts what the Active tab lists. **`bp_upsert_da_time_block_row` is deliberately untouched — P-283 is open on it.** | **MOVES NOTHING — 4 bodies rewritten + 8 patched by anchor** | n/a (no rows) | n/a | 2026-09-16 |
| `fix_566_redesign_keeps_its_address_PENDING_APPROVAL.sql` | **Swaps `projects_address_key` for a partial unique index** (`UNIQUE (address) WHERE redesign_of_project_id IS NULL`) so a redesign may share its original's address, then renames every redesign that carries the workaround onto its original's address. ★★★ **The constraint was doing two other jobs nobody had written down: THREE `ON CONFLICT (address)` statements INFER it (dropping it raises 42P10 on the scraper's and the wizard's project-creation paths — proved on prod, temp table, rolled back) and EIGHT `WHERE address = …` lookups are unambiguous only because it exists.** Both are repaired first, via one new helper `bp_project_id_for_address` that prefers the ORIGINAL — the row those lookups matched before the rename. **Not one row count is typed: every number is computed at apply time, which is why the set growing 19→20 mid-ticket needed no edit.** | **1 constraint swapped, 6 functions (1 new, 5 rewritten), 20 rows renamed** | 20 (all redesigns) | 20 | 2026-09-16 |
| `fix_588_atomic_save_drops_four_columns_PENDING_APPROVAL.sql` | **LIVE PRODUCTION DEFECT (P-288).** Moves no rows; replaces ONE function body by anchor (1 hit, counted on prod). `bp_update_project_with_permits` — the RPC behind the Project Details **Save** button — applies its project patch through an explicit 27-column `CASE WHEN v_patch ? 'col'` list, and **four real `projects` columns are missing from it**: `project_tags`, `closing_date`, `num_lots`, `is_corner_lot`. A patch containing only those keys still satisfies `v_patch <> '{}'`, so the UPDATE runs, every column falls to its `ELSE` and writes itself to itself, `updated_at` bumps from the trigger, the audit trigger sees `'{}'` and logs nothing, **and the person is told it saved.** That is Bobby's HVL tag on 403 W Dravus, and it is also why `closing_date` has **zero audited changes in the history of the table**. Instrumented at all five hops first — the client sends `{"project_tags":["ECA","HVL"]}` correctly and hop 5 discards it. Not a value whitelist: it ADDS columns to a column list, constrains no value, and no tag name could have survived this path. | **MOVES NOTHING — 1 body patched by anchor** | n/a (no rows) | n/a | 2026-09-16 |

★★★ **One file IS now CANNOT RUN, and it is the first.**
`fix_521_drop_draw_schedule_color_override_SUPERSEDED.sql` is not valid SQL —
three of its anchors are written `E"…"` with double quotes, which Postgres
parses as an identifier, so the DO block fails at parse time with `42601`. It
had sat in `migrations/` since 2026-09-10 looking approvable. **It was never on
this shelf** — no `_PENDING_APPROVAL` suffix, so fix-450's guard never read it
and this page never listed it — which is exactly how a file that cannot run
stays that way for three days. fix-537b replaces it, with anchors that tolerate
whitespace and were proved against prod in a rolled-back transaction.

Every OTHER file still runs: every helper function, table and column each one
depends on still exists on prod with the signature it was written against
(`bp_is_unmapped_active_da`, `bp_dm_for_da`, `bp_ensure_cr_thread`,
`bp_seed_project_posts`, and the three report functions).

## Why the numbers changed

**`fix_368` 20 → 1.** The predicate still selects 15 pairs, but
`ON CONFLICT (task_id, assignee) DO NOTHING` skips 14 of them — Cam's four
groups were co-assigned in the ordinary way after the file was written. Shire's
group also turned over completely: 10431 SE 19th St → Brittani (6 tasks) is now
5623 44th Ave SW → Lindsay (1 task). **A count of the `WHERE` is not a count of
what lands**, and this file is the clearest example of it.

**`fix_377` 22 → 0.** GROUP B was already marked superseded by fix-379 inside
the file. GROUP A is empty because the file's own discriminator works: two
unissued permits still diverge from their project, and both name **Bobby**, who
is never a project entitlement lead — the deliberate-assignment population the
`EXISTS` clause protects. Without that clause the query returns 2; with it, 0.

**`fix_379` 123 → 0.** Measured against the whole unissued book (272 permits):
no ULS permit carries a `dm` or a `da`, and no non-ULS permit carries a `dm`
without a `da`. Twelve unissued non-ULS permits still have a DA and no DM, and
this file would not touch them either — their DAs have no mapping row, so its
own `bp_dm_for_da(...) IS NOT NULL` clause excludes them. It never wanted to
invent a manager.

**`fix_379_mapping_rows` 3 → 1.** Jade→Alex and Jade→Nidhi landed through the
Settings editor. Only Gena→George is missing.

**`fix_381` 87 → 63.** 87 was the size of the *population*, never the count of
writes. 23 of the 86 projects in it already have a `CR 1` root thread, and
`bp_ensure_cr_thread` inserts only `WHERE NOT EXISTS`.

**`fix_384` unchanged.** Both blocks are still unlinked and all three candidate
projects still exist under the same ids. It is waiting on a decision, not on
data.

**`fix_451` — new, and deliberately tiny.** fix-451 §G shipped the *answer*
("Not required" is an option in the picker, and `isNotRequired` keeps such a
discipline out of the chase grouping and the export) before touching data. The
sentinel is the string prod already carries, so the one affected project row
needs **no change at all** — only the directory row that should never have been
a firm gets deactivated.

**`fix_532c` — the first file here that changes a FUNCTION rather than rows.**
Measured 2026-09-12, after fix-529's first full run: current sets **336 → 415**,
`is_archived_fallback` true on **69 rows across 60 projects**, projects with a
plan of record **163 → 196**. So 60 projects show a superseded drawing as their
plan of record. fix-532 §C marks it on the project card, the plan-of-record card
and the Library — all three can already read the column — and **cannot** mark it
on the `/s/` share page, because that page has no session and reads through
`bp_resolve_plan_share`, whose RETURNS list stops at `pdf_bytes`. The page
already reads the field defensively, so **no Bridge deploy is needed** after this
is applied; the marker simply appears. Both text anchors were verified unique
against the live function body on 2026-09-12.

**`fix_387` 14 → 3.** All 23 entries are still untaught. The file drafts
fourteen and expands three into statements on purpose — *"pasting 14 multi-line
UPDATEs that nobody has approved makes this file look like something to run
rather than something to read."* Approving it buys 3 of 14.

## Recommendations

| file | recommend | the risk, plainly |
|---|---|---|
| `fix_368` | **apply** | Adds one co-assignee row (Shire's task → Lindsay). Idempotent. The worst case is one person seeing one extra task on their board. |
| `fix_379_mapping_rows` | **apply** | Adds one `dm_da_groups` row (Gena→George). It changes what `bp_dm_for_da` returns for George's permits from NULL to Gena, which the app reads live — so check Gena is right before saying yes. |
| `fix_381` | **ask Bobby which option** | The biggest write here by two orders of magnitude: 63 new threads across 63 projects, each visible in project chat with no author. Option 2 (17 projects, live building permits only) is his literal original wording; Option 1 is every project in design. Not reversible in one statement. |
| `fix_384` | **apply candidate 1; rule on candidate 2** | One time block gains a project link. The label is untouched either way. Candidate 2 needs Bobby to say which Estrella. |
| `fix_387` | **skip — use the admin editor** | It writes 3 of the 14 drafted entries and the editor does any of them in seconds. Worth doing first, separately: the live entry *"Every new project starts with three posts"* is wrong — it has been four since CR 1 shipped. |
| `fix_451` | **apply** | Deactivates one directory row. It disappears from the Geotech picker and stays readable in Settings. Reversible with one click (Reactivate). |
| `fix_532c` | **apply** | Moves no rows. It re-creates one function with one extra output column so the public share page can mark a superseded drawing — **60 projects show one today and nothing on that page says so.** The risk is the DROP/CREATE: `bp_resolve_plan_share` is the ONLY function `anon` may execute, so a lost grant is a dead share link for every recipient. The file re-grants and then asserts with `has_function_privilege` rather than trusting the statement. |
| `fix_566` | **apply — but read §A0 first** | Moves 20 rows and swaps a constraint. The order is load-bearing: the function repairs and the index swap MUST precede the rename. ★ The repaired `ON CONFLICT (address) WHERE redesign_of_project_id IS NULL` infers the OLD index as well as the new one, so there is no broken window even applied statement by statement. Run `scripts/sql/on_conflict_census.sql` afterwards — fix-547 rules 1 AND 3 both apply. |
| `fix_580` | **apply — this one is a live defect** | Moves no rows at all; it replaces function bodies. Until it is applied, the app works anyway (the client fetches the OCC token itself), but it costs an extra read per team-task edit and `bp_upsert_team_task` keeps NULLing three columns nobody sends. Run `scripts/sql/on_conflict_census.sql` afterwards — fix-547 rule 3, a body was replaced by anchor. |
| `fix_588` | **apply — this one is a live defect, and it is four columns wide** | Moves no rows; re-creates one function body. Until it is applied, **nobody can save a project tag, a closing date, a lot count or a corner-lot flag from the Project Details modal, and the screen says it worked.** The client half of fix-588 now catches the drop and says so out loud, so the silence is gone either way — but the columns stay unsavable through Save until this runs. The risk is the anchored re-emit: `bp_update_project_with_permits` is the atomic save path for the whole modal, so run `scripts/sql/on_conflict_census.sql` afterwards (fix-547 rule 3) and do one rolled-back real save before trusting it. |
| `fix_377`, `fix_379` | **nothing to approve** | Superseded. Kept for the reasoning, not the rows. |

## The guard

`src/__tests__/PendingApprovalIndexFix450.test.ts` asserts that every
`*_PENDING_APPROVAL.sql` and `*_SUPERSEDED.sql` in `migrations/` appears in this
table, and that none of them contains an uncommented `INSERT` / `UPDATE` /
`DELETE`. Add a file, and the test tells you to add a row here.
