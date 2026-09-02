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

No file is **CANNOT RUN**: every helper function, table and column each one
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
| `fix_377`, `fix_379` | **nothing to approve** | Superseded. Kept for the reasoning, not the rows. |

## The guard

`src/__tests__/PendingApprovalIndexFix450.test.ts` asserts that every
`*_PENDING_APPROVAL.sql` and `*_SUPERSEDED.sql` in `migrations/` appears in this
table, and that none of them contains an uncommented `INSERT` / `UPDATE` /
`DELETE`. Add a file, and the test tells you to add a row here.
