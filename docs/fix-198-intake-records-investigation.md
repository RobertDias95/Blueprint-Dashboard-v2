# fix-198 — Intake Tracker ↔ per-permit Seattle intake date: Step-0 investigation

Status: **investigation + safe dedupe only.** No schema/sync changes — the
bidirectional model below is a proposal **pending Bobby's sign-off**.

Probed against prod (`eibnmwthkcuumyclyxoe`) on 2026-06-24.

---

## 1. How `intake_records` is populated

`intake_records` is Seattle's intake-**slot inventory** (real + placeholder
slots), managed **manually** through the Intake Tracker UI. **There is no
scraper / cron / edge function writing it** — the only writers are the Tracker
hooks, plus the original bulk seed. (Whole-repo grep for `intake_records` →
`useIntakeRecords` / `useUpsertIntakeRecord` / `useDeleteIntakeRecord` /
`useSwapIntakeDates`, `queryKeys`, `exportBackup`, the FK `SET NULL` in
`useDeletePermit`/`useDeleteProject`, and `fix_157` RLS. No job.)

UI: `src/components/IntakeTracker.tsx` (rendered by `src/pages/DrawSchedule.tsx`
under the **"Seattle Intakes"** sub-tab). Actions:
- **Add / Add placeholder** → `useUpsertIntakeRecord` (`op:'insert'`) → RPC
  `bp_upsert_intake_records_row`.
- **Inline edit** (date/address/permit#/type, placeholder toggle) → same RPC
  (`op:'update'`, OCC on `updated_at`).
- **Delete** → `useDeleteIntakeRecord` → `bp_delete_intake_records_row`.
- **Swap** (🔀) → `useSwapIntakeDates` → `bp_swap_intake_dates` (see §4).

Seed origin of the existing rows (now 63 after dedupe; was 84):

| created | rows | what |
|---|---|---|
| 2026-05-07 | 47 | original bulk seed |
| 2026-05-12 | 21 | **partial RE-SEED — every row an exact dup of a 5/07 row** (the dedupe target) |
| 2026-06-23 | 2 | UI-created real rows (permits 355/356, `intake_date` still NULL) |
| 2026-06-24 | 14 | UI-created **placeholder** slots (`is_placeholder=true`, `address='OPEN'`, `permit_id=NULL`, a city `permit_num` + a future `intake_date`) — the "book ahead" inventory |

Columns that drive the tracker: `intake_date`, `is_placeholder`, `permit_id`
(→ "Submitted" badge via the linked permit's cycles), `address`/`permit_num`/
`permit_type`/`portal_url` for display. (`link` is a legacy dup of `portal_url`.)

## 2. `intake_records` ↔ permit linkage

Schema (prod): `id` int PK, `tenant_id` uuid NOT NULL (FK→tenants RESTRICT),
`project_id` uuid **nullable** (FK→projects **SET NULL**), `permit_id` int
**nullable** (FK→permits **SET NULL**), `address`, `permit_num`, `permit_type`,
`intake_date` date, `is_placeholder` bool default false, `portal_url`, `link`,
`created_at`, `updated_at`.

- **Linkage = `permit_id`** (nullable). A row CAN be a placeholder with **no
  permit** (`is_placeholder=true`, `permit_id=NULL`, `address='OPEN'`).
- Nothing references `intake_records.id` — all FKs point **out** (projects,
  permits, tenants). Deleting a row affects no other table.
- Render: `intakeStatus()` (`src/lib/intakeHelpers.ts`) → `submitted` (linked
  permit has a submitted cycle) → `reschedule` (≤7 days, not submitted) →
  `placeholder` → `real`. The swap action picks a row, then swaps dates with a
  second row.

## 3. `permits.intake_date` — readers / writers

- **Writer (the Design strip):** `PermitDetailV2.SeattleIntakeRow` — renders only
  for **Seattle** Building Permit / Demolition; `<input type=date>` commits on
  blur via `useUpdatePermit` → direct `permits.update({ intake_date })` (OCC).
  Its sub-label currently reads *"Scheduled intake with Seattle portal — syncs to
  Intake Tracker"* — **but it does NOT sync** (this is the bug surface).
- **Readers:** `landUsePhase.ts` (fallback when no cycle has `intake_accepted`);
  `scheduleBenchmarks.ts` explicitly does **not** use it in calcs (preserves the
  team-vs-city signal).
- **Sync today:** see §4 — **one-way, swap-only**. Editing `permits.intake_date`
  on the Project Overview **never touches `intake_records`**. Confirmed: no code
  path writes both.

## 4. Draw-schedule "Seattle Intakes" surface

`DrawSchedule.tsx` → "Seattle Intakes" sub-tab renders `<IntakeTracker />`, which
reads **`intake_records` only** (`useIntakeRecords`). It does **not** read
`permits.intake_date`. So it shows the early-May seed snapshot, not the permits'
current intake dates.

`bp_swap_intake_dates` (live def) swaps the two rows' `intake_date` **and** also
`UPDATE permits SET intake_date = … WHERE intake_records.permit_id = permits.id`
for each — i.e. **intake_records → permits** sync, but only on swap. The reverse
(**permits → intake_records**) does not exist anywhere.

---

## The bug, quantified

- **Sync gap (systemic):** **~130** Seattle BP/DM permits have a `permits.intake_date`
  set but **no `intake_records` row** — so the tracker omits them. The three cases
  Bobby named are all confirmed victims:
  - permit **10322** `7082198-CN` — 10044 37th Ave SW — intake **2026-11-11** → absent
  - permit **10077** `7148722-CN` — 9711 12th Ave NW — intake **2026-11-04** → absent
  - permit **10078** `7148723-DM` — 9711 12th Ave NW — intake **2026-11-10** → absent
- **Duplicates:** the 5/12 re-seed created **21 exact-duplicate pairs** (4222
  Latona Ave NE, 13515 27th Ave NE, …) → each shown twice. **Fixed by this PR's
  dedupe** (see below).

---

## Safe dedupe — APPLIED (`migrations/fix_198_dedupe_intake_records.sql`)

Deletes the 21 re-seed duplicates, keeping the **lowest id** per group (the 5/07
original). Scoped to **real-permit rows** (`permit_id IS NOT NULL`) so the `OPEN`
placeholder inventory is never touched; idempotent; safe (no inbound FKs).

- Probed first (rolled-back `BEGIN…ROLLBACK`): **21 rows** to delete, all from the
  5/12 batch (ids 48–68), **0 dup groups remaining**, total 84 → **63**.
- Applied to prod via MCP → verified **63 rows, 0 dup groups**, 4222 Latona now
  **2 rows** (one per permit, was 4).
- Won't fight a re-seed: there is no automated seeder (§1).

---

## PROPOSED bidirectional model — FOR SIGN-OFF (not built)

**Goal:** a Seattle CN/DM permit's intake date **IS** its assigned slot. Project
Overview, Intake Tracker, and the draw-schedule Seattle intakes all show the same
date. One linkage key (`intake_records.permit_id`), one resolver, kept in lockstep
both directions (bidirectional principle).

**A. permits.intake_date edit → maintain the linked slot.**
When a Seattle BP/DM permit's `intake_date` is set/changed, UPSERT the matching
`intake_records` row keyed by `permit_id`: update its `intake_date` if a linked
row exists, else INSERT a real (`is_placeholder=false`) row, backfilling
`address`/`permit_num`/`permit_type`/`portal_url`/`project_id` from the permit +
project. Recommend an **AFTER UPDATE trigger on `permits.intake_date`** (rather
than a one-off RPC) so it also covers the scraper, which writes
`permits.intake_date` too. *(Decision: a trigger is automatic everywhere; an RPC
is more explicit but misses non-UI writers.)*

**B. Intake Tracker edits → keep syncing the permit.**
- Swap already syncs linked permits — keep.
- Extend `bp_upsert_intake_records_row` to also update the linked permit's
  `intake_date` when `permit_id` is set (mirror the swap), so inline date edits in
  the tracker reach the permit.
- The **swap workflow** (assign an earlier placeholder to a ready project; bump
  that project's later slot back to placeholder) needs a **"link slot → permit"**
  action that sets `permit_id` (+ `is_placeholder=false`) and syncs
  `permits.intake_date`.

**C. One resolver.** Keep `permits.intake_date` as the canonical scalar for a
permit; `intake_records` is the inventory/scheduling view; the `permit_id` linkage
+ the two-way maintenance above keep them equal, so every reader is consistent.

**D. target_submit vs intake date (discrepancy spotting).** Surface
`permits.target_submit` next to the intake date — a "Target Submit" column in the
Intake Tracker row and on the Project Overview Seattle Intake row — and flag when
the gap exceeds a threshold, so a slot that's too early/late for where the project
actually is stands out.

**E. One-time backfill.** After A/B land, an idempotent backfill creating
`intake_records` rows (keyed by `permit_id`) for the ~130 Seattle BP/DM permits
that have `intake_date` but no slot, so the tracker reflects reality.

**Open decisions for Bobby:**
1. Trigger vs RPC for permit→slot (recommend **trigger** — covers the scraper).
2. Clearing a permit's `intake_date`: **delete** the auto-created slot, or revert
   it to a **placeholder**?
3. Should the `OPEN` placeholder rows (which carry a `permit_num` but no
   `permit_id`) **auto-link** when a permit with that number appears?
4. Add a **partial unique index** `(tenant_id, permit_id) WHERE permit_id IS NOT
   NULL` to prevent future duplicate real-permit slots? (Confirm a permit can't
   legitimately hold two slots.)
