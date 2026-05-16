# Resume context — Blueprint Dashboard V2, 2026-05-16

Repo: `C:\Users\robertd\dev\Blueprint-Dashboard-v2`
Branch: `main`, latest commit: `98dbabf` (fix-25e)
Working tree: clean. 734/734 vitest, build clean. All commits pushed to origin/main; Render is auto-deploying fix-25e.

---

## Current objective

No active task. Last shipped: fix-25e (permit status pill derives from cycle state). Bobby is about to restart his PC and will smoke fix-25e + any prior un-smoked work on resume. The natural next step is **his smoke report** — either a bug to chase or a new fix request from the queue.

The broader objective hasn't changed: continue tightening Blueprint Dashboard V2 to match Bobby's V1 mental model while building out new improvements (cleaner status surfaces, intake-anchored learner, etc.).

---

## Progress so far (this session)

15 commits shipped in chronological order. Each was a complete fix-and-push cycle (frontend + tests + Supabase MCP migration where needed, then `git push origin main`).

| Commit | Fix | What it did |
|---|---|---|
| `579c6b6` | fix-24c | (prior session — context) builder search wildcard, design strip blanks, latest-by-date highlight |
| `129edfd` | fix-24b | (prior) auto-promote typed builders to catalog on save |
| `94bbf26` | fix-24c-2 | snap RPC `UPDATE-if-NULL` on existing empty cycle N+1 + backfill |
| `92d50bd` | fix-24c-3 | chain-position highlight + resubmitted snap trigger + test 678 repair |
| `1e3b69d` | fix-24d | builder autocomplete on Project Overview Builder/Owner card |
| `9c6b74f` | fix-24e | today-floor on projection anchors |
| `e4a05a7` | fix-24f | wizard / RPC stop pre-creating empty placeholder cycles (only cycle 0) |
| (no commit) | fix-24g | investigation only — diagnosed the floor was already working; Bobby's case was a no-learner default issue → became fix-24h |
| `681a53f` | fix-24h | default 210d when no cycle activity and no learner data |
| `67d8f97` | fix-24i | intake-anchored learner clock + cross-juris fallback + per-type defaults + min-sample gate |
| `b1945f5` | fix-25a-b | gate intake_accepted snap to design cycle only (cycle 0) |
| `947b3f6` | fix-25c | wizard "ACQ Target Date" writes `expected_issue` (Schedule Health column source) |
| `75a11f3` | fix-25d | instant highlight, tab follows snap, Permitting category auto-select (also covers 25f) |
| `103e10e` | fix-26 | Design strip reads/writes cycle 0 per V1 model + legacy fallback + 77-permit data migration |
| `dedda0d` | fix-26a | DateCell catches RPC validation errors, surfaces clean toast, ref-reset for recovery |
| `98dbabf` | fix-25e | permit status pill derives from cycle state (Schedule Health + Dashboard) |

### Files created in this session
- `src/lib/permitStatus.ts` — `derivePermitStatus(permit)` helper (fix-25e)
- `src/__tests__/PermitDetailV2Fix25d.test.tsx` — 7 tests
- `src/__tests__/PermitDetailV2Fix26.test.tsx` — 6 tests
- `src/__tests__/PermitDetailV2Fix26a.test.tsx` — 6 tests
- `src/__tests__/permitStatus.test.ts` — 13 tests
- `src/__tests__/ProjectOverviewBuilderCell.test.tsx` — 4 tests (fix-24d)

### Files significantly modified
- `src/lib/permitHelpers.ts` — full rewrite for chain-position rule (fix-24c-2 → fix-24c-3 → fix-26)
- `src/lib/projectedApproval.ts` — `flooredAnchor` helper, `effectiveAvg` logic, intake-anchored clock
- `src/lib/scheduleBenchmarks.ts` — `extractSample` anchors at `c0.intake_accepted`; `LearnedEstimate.avgIntakeToApproval`; `PER_TYPE_DEFAULT_DAYS` + `MIN_SAMPLES_FOR_LEARNER`; `computeForFilter` + cross-juris fallback ladder
- `src/components/ProjectDetail/PermitDetailV2.tsx` — DateCell commit-on-change + catch, tab auto-advance, activeStage auto-flip, Design strip reads/writes cycle 0 with legacy fallback
- `src/components/ProjectDetail/ScheduleHealthTable.tsx` — PERMIT STATUS column uses `derivePermitStatus`
- `src/components/Dashboard/AddrGroup.tsx` — permit row status uses `derivePermitStatus`
- `src/components/wizard/PermitAssignmentRow.tsx` + `wizardState.ts` + `NewProjectWizard.tsx` + `Step2Questionnaire.tsx` + `Step3Permits.tsx` — ACQ Target Date binds to `expected_issue`
- `src/hooks/useUpsertPermitCycle.ts` — error toast strips RPC prefix; doc comment updated for snap rules
- `src/hooks/useCreateProjectWithPermits.ts` — `PermitInput.expected_issue` field
- `src/components/ProjectDetail/ProjectDetailHeader.tsx` — Builder/Owner card uses `BuilderAutocompleteField` + `fillFromBuilder` (fix-24d)
- `src/components/builder/BuilderAutocompleteField.tsx` — added optional `onBlur` prop

### Supabase migrations applied to prod (project `eibnmwthkcuumyclyxoe`)
- `fix_24c_2_snap_update_if_null` — snap UPDATE-if-NULL on existing N+1
- `fix_24c_3_snap_on_resubmitted_too` — resubmitted snap branch for review cycles
- `fix_24f_no_placeholder_cycles` — `bp_create_project_with_permits` inserts only cycle 0
- `fix_25a_b_intake_snap_gated_to_design` — intake snap gated to `cycle_index = 0`
- `fix_25c_rpc_extract_expected_issue` — RPC extracts `expected_issue` from per-permit jsonb
- (No migration name) fix-26 data migration via `execute_sql` — moved 77 permits' design data cycle 1 → cycle 0; 20 all-NULL cycle 1s deleted; 55 cycle 1s had submitted restored from cycle 0; 1 stray cycle 1.intake_accepted cleared on permit 276

### Key product / architectural decisions locked this session
- **V1 cycle indexing model:** cycle 0 = design phase, cycle 1+ = review cycles. Bobby's intake_accepted is design-only.
- **Snap rules:** `intake_accepted` on cycle 0 → snap creates cycle 1.submitted. `resubmitted` on cycle ≥1 → snap creates cycle N+1.submitted. No other field triggers snap.
- **Highlight rule:** pure chain-position (no date sorting). Design chain `[intake_accepted, submitted]` reversed; review chain `[resubmitted, corr_issued, city_target, submitted]` reversed.
- **Estimator floors at today:** any past anchor used to project a future event substitutes today (see `flooredAnchor` in `projectedApproval.ts`).
- **Per-type defaults:** when learner is silent AND no cycle activity, estimator uses `defaultDaysForType(permit.type)`. BP=210d, Demolition=60d, ULS=90d, etc.
- **Learner clock:** `c0.intake_accepted → approval_date`. Permits without `c0.intake_accepted` drop out. Bobby explicitly REJECTED backfilling from `permits.intake_date` (the scraper field — semantically the team's submission date, not city intake acceptance).
- **Wizard ACQ Target Date:** binds to `permits.expected_issue` (the column Schedule Health labels "ACQ Target"). `permits.target_submit` is no longer collected by the wizard.

---

## Current state

**No work in progress.** All commits pushed. Render auto-deploys typically complete in 1-2 minutes. Bobby is restarting his PC and will smoke fix-25e + likely fix-26 + earlier when he returns.

The repo is at a natural break point. No mid-debug, no mid-refactor, no failing tests.

---

## Next steps

1. **Wait for Bobby's smoke report.** Most likely first actions on resume:
   - Bobby opens 1327 → checks Schedule Health PERMIT STATUS column. Per fix-25e, expected labels:
     - PAR/Pre-Sub: "City Target (Cycle 1)" + 2026-06-08 (chain-position: city_target above submitted in review chain)
     - SDOT Tree: "Submitted (Cycle 2)" + 2026-05-22 (cycle 2 from earlier resubmitted snap)
     - IPR: "Initial Submit" + 2026-05-29 (cycle 0 only)
     - Building Permit / Demolition / ULS: "Pre-Submittal — GO" (no date — fallback to stored)
   - Bobby opens any old permit with approval — should now show "Approved" + date instead of stale wizard text.
   - Bobby tests Design strip on a fresh permit. Per fix-26: Design strip writes cycle 0; intake on cycle 0 fires snap to create cycle 1 with submitted=intake; tab auto-advances to Cycle 1 (fix-25d).
   - Bobby tests invalid date entry (intake < submitted). Per fix-26a: clean toast, no console spam, can recover by typing valid date.

2. **If Bobby reports a bug:** standard pattern — diagnose first, then ask before code changes for non-trivial issues.

3. **If Bobby moves to a new feature:** the documented backlog still has:
   - **25-FEAT-F:** reviewer status column (depends on scraper expansion — not pure code)
   - **25-FEAT-G:** learner kicking in for PAR/Pre-sub (process change, not code)
   - **fix-24i deferred work:** per-round intake-anchored clocks, editable per-type defaults UI, outlier filtering / weighted-by-recency averages
   - Custom status pill colors per state (cosmetic; mentioned in fix-25e summary)

---

## Open questions / blockers

**None blocking.** A few items flagged but explicitly accepted by Bobby:

1. **Permit 338's `c0.intake_accepted` stays NULL** (Bobby rejected backfill from `permits.intake_date` in fix-24i because the scraper captures submission-date semantics, not intake-acceptance). Consequence: the lone approved Seattle BP doesn't contribute to the intake-anchored learner; all Seattle BP projections fall back to the 210d per-type default. Will resolve organically as the team enters real `intake_accepted` dates on completed permits.

2. **1327's `target_submit` is NULL post fix-25c migration** (we moved values → expected_issue, NULLed target_submit). For those 6 permits, the estimator falls back to per-type defaults from today. If a planned submission date matters, Bobby can set it via Project Settings.

3. **Auto-memory may be stale post-fix-26.** `~/.claude/projects/C--Users-robertd/memory/project_v2_cycle_indexing.md` and `project_cycle_date_rule.md` were last updated during fix-24c-3 / fix-25a-b. They still hold up (cycle 0 is the design slot, snap gates are correct) but don't yet reflect that the FRONTEND now actually reads/writes cycle 0 (pre-fix-26 it filtered cycle 0 out). The `project_placeholder_cycle_todo.md` was marked RESOLVED in fix-24f. Worth a refresh pass when there's downtime, but not blocking.

---

## Important context

### Key files

- `src/lib/permitHelpers.ts` — `getHighlightedMilestone(permit)` chain-position rule + `HighlightTarget` type. Used by PermitDetailV2 highlight, `derivePermitStatus`, and probably future surfaces.
- `src/lib/permitStatus.ts` — `derivePermitStatus(permit)` returns `{ label, date, derived }`. Used by ScheduleHealthTable + AddrGroup. Does NOT replace `permits.status` raw reads in `reportMetrics.ts` (search haystack) or `PermitDetailV2`'s editable input.
- `src/lib/projectedApproval.ts` — `computeProjectedApproval(input)` + `flooredAnchor` + per-cycle walk. Three consumers: ScheduleEstimator widget, ScheduleHealthTable column, DrawScheduleGrid.
- `src/lib/scheduleBenchmarks.ts` — `computeLearnedSchedule` (cross-juris fallback), `extractSample` (intake-anchored), `PER_TYPE_DEFAULT_DAYS`, `MIN_SAMPLES_FOR_LEARNER = 3`, `DEFAULT_AVG_INTAKE_TO_APPROVAL = 210`, `defaultDaysForType(type)`.
- `src/components/ProjectDetail/PermitDetailV2.tsx` — large file (~1700 lines). Important sub-functions: `DateStrip`, `DateCell` (commit-on-change + catch lives here), `commitDesignField`, `commitCycleField`, the two `useEffect`s for tab auto-advance + activeStage flip.
- `src/hooks/useUpsertPermitCycle.ts` — header comment documents the snap rules (intake on cycle 0, resubmitted on cycle ≥1).

### Supabase MCP

Production project_id: `eibnmwthkcuumyclyxoe`. Staging project_id: `zcitvqcstiikipyrylks` (per memory, staging is RPC-stale; apply migrations directly to prod after side-function smoke).

Use `mcp__claude_ai_Supabase__execute_sql` for verification queries. Use `mcp__claude_ai_Supabase__apply_migration` for DDL. Multi-statement queries via execute_sql only return the LAST statement's result — split into separate calls if you need all results.

### RPC current state in prod

- `bp_create_project_with_permits` — fix-25c version. Inserts only `cycle_index = 0`. Extracts both `target_submit` and `expected_issue` from per-permit jsonb.
- `bp_upsert_permit_cycle_row` — fix-25a-b version. Intake snap gated to `cycle_index = 0`. Resubmitted snap gated to `cycle_index >= 1`. Both follow INSERT-or-UPDATE-if-NULL on cycle N+1.

### Data shape in prod (as of session end)

- All permits have cycle 0 (created by `bp_create_project_with_permits`).
- Cycle 0 holds design data (`submitted` / `intake_accepted`).
- Cycle 1+ are review cycles. `intake_accepted` on review cycles is invariant: 0 rows in prod have it populated post fix-26.
- `permits.target_submit` is NULL for permits created via wizard post fix-25c. Older permits may have it set.
- `permits.expected_issue` is populated when the user entered an "ACQ Target Date" via wizard post fix-25c.
- The scraper still populates `permits.intake_date` (a SUBMISSION date, NOT intake-acceptance). Do not conflate with `c0.intake_accepted`.

### Test counts

734/734 vitest. 60 test files. Suite runs in ~18-20s. Common patterns:
- `vi.hoisted(() => vi.fn())` for shared mocks across tests
- `QueryClient` per test for React Query isolation
- Helper-level pure tests in `src/__tests__/*.ts`
- Component tests in `src/__tests__/*.test.tsx` with stubbed hooks via `vi.mock`

### Auto-memory location

`C:\Users\robertd\.claude\projects\C--Users-robertd\memory\`. `MEMORY.md` is the index (always loaded into context). Individual `.md` files hold facts. Update sparingly — see "Open questions / blockers" #3 for which files may need refresh.

### Workflow conventions Bobby uses

- **Smoke before promote** for RPC migrations: install a side-named copy via `execute_sql`, run scenarios in a `DO $smoke$ ... RAISE EXCEPTION 'SMOKE_OK: ...'` block to roll back test data, drop the side function, then `apply_migration` the real version.
- **Discovery before broad data UPDATEs:** count rows first, ask if count is "high" (>20) before sweeping. Bobby has answered "go ahead" on broader cleanups when the filter is conservative.
- **Commit messages:** `fix(scope): short summary (fix-XXX)` lowercase, present tense. Body explains why + what changed. Always end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` via HEREDOC.
- **Push to main after each fix.** Render auto-deploys in 1-2 min. No PRs.
- **`/ultrareview` is user-triggered** and billed — never spawn it.
- **AskUserQuestion** for non-trivial product decisions or anything beyond literal spec scope. Don't decide unilaterally on data migrations or semantic model changes.
