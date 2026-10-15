# Permit-type census: what would a brand-new permit type miss? (fix-679)

Read-only census, written 2026-10-15. Nothing here changed code behaviour, schema or production data.

**The requirement (Bobby, 10-15):** add a type in Settings today, and it captures data, gets scraped, learns its timings and gets automatic dates, with no code change. Renaming types is out of scope.

**Sources read:**
- the live prod database (`eibnmwthkcuumyclyxoe`): `pg_proc`, triggers, views, CHECK constraints, policies, indexes, `app_config`, `task_templates`
- v2 `src/` at `c69f6d9`
- the scraper repo `Blueprint-Dashboard-` at `origin/main` `46631a0`, read with `git show` / `git grep` only

## Headline

**A new type is listed and stored everywhere, but it never gets an automatic Target Submit, and nothing an admin can set in Settings fixes that.**
- The server picks each non-BP type's starting date (its "anchor") in a hard-coded `CASE` in `bp_recompute_target_submits`, with `ELSE NULL`.
- The frontend copies that `CASE` in `anchorFor()` and hides the Settings offset box for any type that isn't in it.
- §B proves this on prod: the new permit's Target Submit stays NULL, even after a `target_submit_formulas` row is added.

This is already happening to 4 of today's 18 types: **PPR, STFI, Vault and WAC**.
- STFI has a formula row (offset 3), but its one permit still has a NULL Target Submit.
- PPR has 3 of its 19 permits with no target.

Three more findings change what "it will learn" means today:

1. **No Target Submit learns while a Settings formula row exists.** `bp_learn_target_submit_days` returns the `target_submit_formulas` offset *before* it averages any history. That ordering is fix-249's "policy beats learner". All 13 anchored types have a formula row, so none of them learns.
   - Seen in §B: ECA Waiver returns 14, which is its formula value, not an average.
   - A new type is therefore caught both ways. With no formula row it falls into `ELSE NULL`. With one, it would never learn.
2. **The Grading / Clearing (21) and LSM (27) formula rows are never read.** Those two types copy the Building Permit's target and skip the offset lookup entirely.
3. **Durations do learn.** Intake→approval and the per-cycle clocks (`bp_learn_days_explain`) learn per type and city from `bp_duration_stats` for any type. With no history and no `permit_type_defaults` row, a new type gets the Building Permit's 210 days.

**The scraper never assigns or writes `permits.type`.** It carries whatever the Bridge holds, and never reads `permit_types`.
- In Seattle, records are routed by **permit-number shape**. A number that doesn't match a known pattern goes to the building-permit dataset.
- So a new Accela-only record type comes back `not_found` on every run and is never updated. This is what happened to PPR before it got its own branch.
- **A new city is code work**: an adapter or MBP mapping. No Settings row can make it.

## Counts per class

| Area | GENERIC | ANCHOR-ONLY | DEGRADES | SILENT GAP | WRONG |
|---|---|---|---|---|---|
| Database (rows / sites) | 6 / 16 | 5 / 17 | 3 / 3 | 3 / 3 | 0 / 0 |
| v2 `src/` (rows / sites) | 6 / 22 | 4 / 49 | 10 / 17 | 5 / 10 | 0 / 0 |
| Scraper `permit_scraper/` (rows / sites) | 5 / 9 | 0 / 0 | 8 / 26 | 1 / 4 | 1 / 2 |
| Indexer `file_indexer/` (rows / sites) | 4 / 6 | 0 / 0 | 3 / 6 | 1 / 5 | 0 / 0 |

How to read the table:
- A **row** groups sites that behave the same way. A **site** is one function, object or code location.
- **Database sites:** the 23 public functions that contain a permit-type literal, plus the tables and config keyed by type.
- **Classes:**
  - **GENERIC:** works for any type.
  - **ANCHOR-ONLY:** names `Building Permit` as the project's anchor, which is correct for a new type.
  - **DEGRADES:** a new type gets a sensible fallback.
  - **SILENT GAP:** a new type gets nothing, with no error.
  - **WRONG:** a new type is treated as something it is not.

## §A — The census

### A1. Live prod database

Facts checked:
- `permit_types` has 18 rows with columns (`name`, `is_builtin`, `notes`) and no tenant.
- `permit_type_defaults` has 15 rows; `target_submit_formulas` has 15.
- `permits.type` is free text: no foreign key to `permit_types` and no CHECK.
- No view, CHECK constraint, RLS policy or index contains a type literal.
- In `app_config`, only `permitTypeDescriptions` is keyed by type. `projectTagOptions` contains "SIP", "TRAO", "LBA" and "Short Plat", but as project tags, not types.
- Triggers re-run `bp_recompute_target_submits` on every permit insert or update (`bp_trg_permits_target_submit_ins/upd`), on project changes and on cycle changes. So the NULL in §B is the steady state, not a missed call.

The 23 functions that contain a type literal (my count is 37 literal hits in `bp_recompute_target_submits`; the brief counted 19, probably just the `'Building Permit'` hits):

| Where | What it does | A new type gets | Class |
|---|---|---|---|
| `bp_recompute_target_submits`: the non-BP `v_candidate := CASE v_permit.type` (13 branches) | Picks each non-BP type's anchor (`go_date` / BP target / BP c0 intake / BP c1 resubmit / BP issue) plus its offset | **`ELSE NULL`: no automatic Target Submit until the permit is actually submitted** (then c0 `submitted` is used). A formula row for the type is never consulted, because `bp_learn_target_submit_days` is only called from inside the branches. Today this also covers PPR, STFI, Vault and WAC | **SILENT GAP** |
| `bp_recompute_target_submits`: `v_projected := CASE v_permit.type` | Marks the target as "projected" when its anchor is itself projected | `ELSE false`. Consistent while there is no target | DEGRADES |
| `bp_recompute_target_submits`: the BP block and BP loop (`type = 'Building Permit'`, `dd_end + learn(...,'dd_end') or 21`) | Derives the BP's target and the project's projected intake, c1 and issue dates | Unaffected: a new type is never the anchor | ANCHOR-ONLY |
| `bp_learn_target_submit_days`: the last-resort `v_default := CASE p_type` (12 branches) | Day count used when there is no formula row and no history | `ELSE NULL` | **SILENT GAP** |
| `bp_learn_target_submit_days`: the formula lookup plus 90/180/365/all-time averages on `p.type = p_type`; `bp_target_submit_offset` | Policy, then learned average | Works for any type. ★ But the formula row returns **before** the averaging, so a type with a row never learns | GENERIC |
| `bp_learn_target_submit_days` / `bp_target_submit_benchmark`: `LATERAL … bp.type = 'Building Permit'` | Finds the BP's c0 intake, c1 resubmit or issue date as an anchor | Correct: these anchors *are* the BP's dates | ANCHOR-ONLY |
| `bp_learn_days_explain`: tier 6 `CASE p_type … ELSE 210` | Hard-coded intake→approval fallback (c1 = ÷3) | 210 days, the Building Permit figure, unless a `permit_type_defaults` row exists. §B: `days=210 tier=hardcoded` | DEGRADES |
| `bp_learn_days_explain` tiers 1–5 (`bp_duration_stats` by type × city × cycle, then `permit_type_defaults`); `bp_learn_days`; `bp_duration_stats` | Learned durations, clamped by policy | Learns from its own history like any type | GENERIC |
| `bp_create_project_with_permits` (5 hits) | Wizard RPC: records the first BP; seeds BP target = `dd_end + 21`; mirrors the primary DD | Saves the target the wizard sends, else NULL (then the recompute leaves it NULL). The BP logic itself is correct | ANCHOR-ONLY |
| Draw schedule / DA / DD family (11): `bp_resolve_da_overlap`, `bp_move_draw_schedule_da`, `bp_place_new_project_on_da`, `bp_shift_da_blocks_up`, `bp_update_draw_schedule_with_dd_sync`, `bp_set_bp_dd_dates`, `bp_draw_schedule_dd_mismatches`, `bp_reassign_project_da`, `bp_inherited_da_for_project`, `bp_cascade_ent_lead_for_project`, `bp_project_team_names` | The design window, DD dates, DA and Permitting Lead belong to the project's BP | Correct: a new type is never the design permit | ANCHOR-ONLY |
| `bp_trg_cycle_cr_thread`, `bp_post_cr_notice` | CR threads and the corrections notice are BP-only (fix-381 / fix-643) | Nothing, like every non-BP type, by design | ANCHOR-ONLY |
| `bp_permit_results_ready_autotask`: `NEW.type IN ('SDOT Tree','PAR/Pre-Sub','ECA Waiver','ULS')` | The "results ready" task fires on **approval** for no-issuance types, else on **issue** | Treated as a type that issues a document. If the type never issues one, the task never fires | DEGRADES |
| `bp_sync_intake_record_from_permit`: `NOT IN ('Building Permit','Demolition')` (permits insert/update triggers) | Mirrors a Seattle intake date into `intake_records` | Skipped: no intake record | **SILENT GAP** |
| `bp_derived_dm_for_permit`, `bp_trg_permit_derive_dm`, `bp_dm_gap_report` (`= 'ULS'`) | ULS carries no DA or DM; every other type derives its DM from its DA | Normal DA→DM derivation | GENERIC |
| `bp_seed_template_tasks`, `bp_add_template_tasks_to_permit` (`tt.permit_type = v_type`) | Task templates matched by the row's own type | No tasks until an admin adds templates in Settings | GENERIC |
| Type-keyed tables and config: `permit_types`, `permit_type_defaults`, `target_submit_formulas`, `task_templates.permit_type`, `app_config.permitTypeDescriptions`; plus `permits.type` free text | Settings-editable rows per type | Accepts any type | GENERIC |

### A2. v2 `src/` (non-test code; What's New and Guide text out of scope)

Every permit-type picker and filter reads `permit_types` through `usePermitTypes()` (`src/hooks/usePermitTypes.ts:16`). No option list is hard-coded.

| Where | What it does | A new type gets | Class |
|---|---|---|---|
| `usePermitTypes` callers (13): `NewProjectWizard.tsx:148,195`, `Step2Questionnaire.tsx:59`, `Step3Permits.tsx:104`, `IntakeTracker.tsx:71`, `AdminProjectsTab.tsx:43`, `TaskTemplateEditor.tsx:84`, `PerTypeScheduleTable.tsx:65`, `PermitTypeEditor.tsx:43`, `useProjectDetailsForm.ts:116`, `Trends.tsx:145`, `useFilterRegistries.ts:31`, `useSettingsSearchIndex.ts:51` | Pickers, filters and Settings rows | Listed everywhere | GENERIC |
| `usePermitDescriptions.ts:27-40`, `wizardState.ts:650` `PERMIT_DESCRIPTION_SEED` | Wizard help text (`app_config`) | Empty until typed into `PermitTypeEditor.tsx:177` | GENERIC |
| Task templates (`TaskTemplateEditor`, `Step4TaskReview`), keyed by type × city | Wizard task list | None until an admin adds templates | GENERIC |
| `permitDmDerivation.ts:46,88` (twin of the DB ULS rule) | Only ULS is excluded from DM derivation | Normal derivation | GENERIC |
| `projectedApproval.ts:569` (ULS sibling branch), `:817` `defaultDaysForType` | ULS-only route | Standard own-cycle route | GENERIC |
| `effectiveIssued.ts:36-69`, permit stage, `csvExport` | Issued counts, stage, CSV | Works (CSV prints the raw type) | GENERIC |
| **`anchorFor` `targetSubmitLearner.ts:65-91`** (twin of the server `CASE`); callers `:177`, `:315`, `useTargetSubmitBenchmark.ts:71,105`, `TargetSubmitBenchmarkNote.tsx:45`, `PerTypeScheduleTable.tsx:182` | Which date the Target Submit counts from | `'none'`. **Settings hides the offset box ("no anchor — no automatic target")**, so an admin cannot fix it | **SILENT GAP** |
| `Trends.tsx:1869-1875` `eligibleTypes` | The target-submit learner table | Dropped from the table | **SILENT GAP** |
| `HARDCODED_TARGET_SUBMIT_OFFSETS` `targetSubmitLearner.ts:46` (read `:329`, `Trends.tsx:1905`) | Last-resort offset (twin of the old `WHEN` branches) | `null` | **SILENT GAP** |
| `SEEDING_RULES` `permitSeedingDefaults.ts:43-60` | Wizard pre-fills ACQ Target and Target Submit | Nothing pre-filled (the same is true today for Condo, LBA, SIP and others) | **SILENT GAP** |
| `SeattleIntakeRow` `PermitDetailV2.tsx:569` | Seattle intake date field, BP and Demolition only | No intake field | **SILENT GAP** |
| `isTargetSubmitProjected` `targetSubmitPolicy.ts:226-243` (twin of `v_projected`) | The "projected" flag | `false` | DEGRADES |
| `HARDCODED_INTAKE_TO_APPROVAL` `durationLadder.ts:93` (fallback `:206`) | Duration fallback | Learned value, then policy, then 210 days | DEGRADES |
| `PER_TYPE_DEFAULT_DAYS` `scheduleBenchmarks.ts:83` (`:130`) | Default intake→approval days | Settings row, else 210 | DEGRADES |
| `NO_ISSUANCE_PERMIT_TYPES` `permitTypeTaxonomy.ts:22` (read `reviewerRollup.ts:165`) | Shows all reviewers approved once a no-issuance permit is approved | Treated as a type that issues a document | DEGRADES |
| `APPROVED_NOT_ISSUED_TYPES` `permitStatus.ts:60` | "Approved — Not Issued" label | Raw portal status text | DEGRADES |
| `LAND_USE_PERMIT_TYPES` `landUsePhase.ts:63` | Land-use phase badge | Only if its number ends `-LU` | DEGRADES |
| `NOT_TRACKED_PERMIT_TYPES` `permitTracking.ts:40` (read `PermitDetailV2.tsx:474`, `ScheduleHealthTable.tsx:780,1029`) | "Not tracked — update manually" marker | Assumed tracked. Misleading if the scraper can't read its portal | DEGRADES |
| `TYPE_COLOR` `IntakeTracker.tsx:56` | Type colour | `text-muted` | DEGRADES |
| `TYPE_SHORT` `reviewerDueEstimate.ts:191` | BP / Demo abbreviation in a tooltip | Full name | DEGRADES |
| Nickname labels (5): `AddrGroup.tsx:559`, `TaskCard.tsx:79`, `PermitDetailV2.tsx:404`, `ScheduleHealthTable.tsx:345`, `WeeklyUpdatesReport.tsx:59` | "BP — nickname" | Plain type name | DEGRADES |
| `crNotice.ts:43` (twin of `bp_post_cr_notice`) | Corrections notice, BP only | None, like all non-BP types | ANCHOR-ONLY |
| "BP, else first permit" lookups (15): `DrawScheduleGrid.tsx:474,1438`, `ProjectBlockPopup.tsx:104`, `pages/ProjectDetail.tsx:257`, `useProjectDetailsForm.ts:493,558`, `ProjectChatModal.tsx:152`, `libraryHelpers.ts:111`, `projectDetailsForm.ts:197`, `projectViewHelpers.ts:322`, `trendsDrillIn.ts:173`, `reportMetrics.ts:593`, `useProjectMessages.ts:406`, `drawScheduleStatus.ts:303,408` | The project's primary permit | Correct: projects without a BP already fall back | ANCHOR-ONLY |
| Strict BP anchors (8): `ProjectDataEditors.tsx:507`, `useSetBpDdDates.ts:193`, `useUpdateDrawSchedule.ts:152`, `targetSubmitLearner.ts:221`, `projectedApproval.ts:426`, `drawScheduleDdAudit.ts:66`, `projectDdStart.ts:45`, `useOriginalPermitForRedesign.ts:41` | DD dates, the Target Submit anchor, draw cascade, redesign | Correct by design | ANCHOR-ONLY |
| Wizard BP lock and default row (25): `NewProjectWizard.tsx:87,439,454,576,589,591`, `wizardState.ts:514,546,569`, `Step3Permits.tsx:49,237,248,311,402,403,560`, `Step2Questionnaire.tsx:64,85,99,101,125,130`, `Step4TaskReview.tsx:72`, `useProjectDetailsForm.ts:376`, `IntakeTracker.tsx:898` | BP always selected; new rows default to BP | Correct: the new type is opt-in (pre-ticked when it is on ≥ 50% of the city's projects) | ANCHOR-ONLY |

**TS twins that must change in lockstep with a DB or scraper list:**
- `anchorFor` and `isTargetSubmitProjected`, with the `CASE` in `bp_recompute_target_submits`
- `HARDCODED_TARGET_SUBMIT_OFFSETS`, with the `bp_learn_target_submit_days` default
- `HARDCODED_INTAKE_TO_APPROVAL`, with `bp_learn_days_explain` tier 6
- `NO_ISSUANCE_PERMIT_TYPES`, with `bp_permit_results_ready_autotask` and the scraper's set
- `crNotice`, with `bp_post_cr_notice`
- `permitDmDerivation`, with the DB ULS rule

### A3. Scraper (`permit_scraper/scrape_permits.py`, origin/main `46631a0`)

The scraper loads `permits.type` (`:5439`, `:5669`, `:10663`) and never writes it. No PATCH body includes `type`. Nothing reads `permit_types`. So **no portal-record → type mapping exists**: the type is whatever a person picked in the Bridge.

| Where | What it does | A new type gets | Class |
|---|---|---|---|
| `:5439`, `:5669`, `:10663` | Load `permits.type` into `TrackedPermit.permit_type` | Carried as-is | GENERIC |
| **`fetch_one` `:14641-14666`, `_module_for` `:1604-1624`** | Seattle routing. Only `type == "PPR"` routes by type. Otherwise the number decides: `SDOTTRLA*` / `SUSIP*` / `SPUE-IPR*` / `-NNPA` / `-TR` go to Accela, `-LU` goes to land use, **anything else goes to the building-permit dataset** | A new Accela-only record falls into the BP path and comes back `not_found` on every run, never updated. This is what PPR did ("0/3, last_scraper_update_at NULL") before its branch | **WRONG** |
| `fetch_one` `:14674`, `JURIS_ID_BY_NAME` `:161`, `fetch_mbp` `:11996`, `_adapter_family_for` `:352`, `_juris_supports_number_lookup` `:366` | Adapter by city: Seattle, 15 MyBuildingPermit cities, Redmond | **A new city** gets an `unsupported_jurisdiction` error, which goes to triage. Nothing is written | DEGRADES |
| `fetch_mbp` `:12018` (`"SelectedPermitTypes": ""`) | MBP searches by number, with no type filter | Works | GENERIC |
| `:13721-13722`, `REDMOND_PERMIT_MODULE_ID` `:14016` / `:14204` | Redmond searches only the *Permit* module | A record in another module is `not_found`, and logged | DEGRADES |
| `_MBP_DETAIL_JURISDICTIONS` `:12399`, `_MBP_DISCIPLINE_BY_JURIS` `:12405`, `_MBP_STATUS_BY_JURIS` `:12450` | Cycle and reviewer detail for 4 MBP cities | A new MBP city gets its status, but no cycles or reviewers | DEGRADES |
| Accela module gate `:11098`, `_parse_accela_workflow` `:5196-5201` | Parses the workflow only for `SDOTSUPermits`, `Permits` and `DPDPermits` | A new module gets `module_unsupported`: status and issue date land, but no cycles; it reaches triage | DEGRADES |
| `_EXPECTED_UNSUPPORTED_MODULES` `:1647` (`:7832`), `_DEFERRED_MODULE_TAGS` `:10259` (`:10317`) | Suppress triage for `DPDEnforcement` / `SPUEngineering`, and the missing-reviewer check for ipr / trao | A new type living in those modules gets no cycles, and the error is suppressed | **SILENT GAP** |
| `is_landuse` `:11114`, `is_sip` `:11118` | Parser chosen by number (`-LU`, `SUSIP`) | Follows the number | GENERIC |
| `NO_ISSUANCE_PERMIT_TYPES` `:2079` (`:8104`, `:8164`) — identical to v2's set | Only these types may fill `actual_issue` from the final workflow event | Treated as a type that issues a document: the documented safe default (`:2074-2077`) | DEGRADES |
| `BP_DEMO_PERMIT_TYPES` `:2092` (`:8063`) | BP and Demo approval-date ladder | The general `readytoissuedate` rule | DEGRADES |
| `FEE_PAID_ISSUES_PERMIT_TYPES` `:2262`, `FLAGGED_FEE_PAID_TYPES` `:2299`, `_type_issues_on_fee_payment` `:2308` (`:8140`) | PPR / STFI take the fee-paid date as the issue date | Published issue date only | DEGRADES |
| `FEE_PHASE_LABEL_BY_TYPE` `:2291`, `fee_phase_label_for` `:2320` (`:11156`) | Which workflow step holds the fee | "Issuance" | DEGRADES |
| `_CYCLE_RELEVANT_PERMIT_FIELDS` `:7144` | A human edit to `type` blocks that run's cycle write | Any value | GENERIC |
| `:14849`, `:15065` | Type copied into the patch payload and the log | Any value | GENERIC |

**What the scraper needs to map a new city's record type.** All of this is code, not config.
- **New MBP city:**
  - add it to `JURIS_ID_BY_NAME` (`:161`);
  - for cycles, also add it to `_MBP_DETAIL_JURISDICTIONS` plus the per-city discipline and status maps (`:12399-12450`).
- **New portal:** write a new `fetch_<city>` adapter and city set, wired into `fetch_one` (`:14632`), `_module_for` (`:1604`), `_adapter_family_for` (`:352`), `_juris_supports_number_lookup` (`:366`) and the portal-host lists (`:305-313`).
- **New Seattle record type:** add a number-pattern or type branch (like PPR's at `:14648`) to **both** `fetch_one` and `_module_for`. Otherwise it defaults to the BP dataset.
- **New Accela module:** add it to the gate (`:11098`) and the dispatcher (`:5196`), with a workflow parser.
- **The type's issuance behaviour:** add its name to `NO_ISSUANCE_PERMIT_TYPES` (identical to v2), `BP_DEMO_PERMIT_TYPES`, or `FEE_PAID_ISSUES_PERMIT_TYPES` + `FEE_PHASE_LABEL_BY_TYPE`. The name must match `permits.type` exactly.

### A4. Indexer (`file_indexer/`, origin/main `46631a0`)

| Where | What it does | A new type gets | Class |
|---|---|---|---|
| `db.py:245`, `linkage.py` `resolve_permit` | Links a letter to a permit by building ↔ `struct_address`, or by exact number | Type never read | GENERIC |
| `linkage.py` `PERMIT_TOKEN` | Strips junk from a number in a letter header (2 number shapes) | A new number shape matches only exactly, so the letter may stay unlinked | DEGRADES |
| `parsers/corrections.py:248` `LTR_PERMIT`, `:256` `LTR_LSM` (`:598`) | East-side letter number prefixes (BLD / BLDG / CTR / CGD / PRJ / PLN / ENG) | A new prefix pulls no number and falls back to address | DEGRADES |
| **`scan.py:64` `TRACK_CONTAINERS` ("demo", "ppr", "post permit", "lsm"), `:75`, `:81` (`:171`, `:213`); SQL twin `bp_correction_track_folder`** | Finds correction folders inside per-type subfolders | A new type's own subfolder (e.g. `Vault/Corrections I`) is never scanned. Its rounds show in the missing-letter worklist as having no letter | **SILENT GAP** |
| `db.py:470`, `reconciliation.py:210`, views `correction_reconciliation` / `correction_missing_worklist` | Expected rounds = 1..`corr_rounds`; `permit_type` is passed through | Included | GENERIC |
| `parsers/classify.py:115`, `parsers/corrections.py:156` `DISC_FIX` | Theme by discipline (keyed by city, not type) | "Unclassified" or title-cased | DEGRADES |
| `db.py:384` → `design_guidance_task.py:405` | Design-guidance task on the lowest-id permit | Type ignored | GENERIC |
| `share_folder.py:88` `rename_successor` | `- BP` → `- <DA initials>` folder rename | Any last segment | GENERIC |

## §B — The rolled-back proof (prod, nothing committed)

- **Project:** 3020 E Yesler Way (`ca1817a2-…`), Seattle, with GO date 2026-09-21 and Building Permit 10741, whose target is 2026-10-12.
- **How it ran:** one transaction (`BEGIN; DO $$ … $$; ROLLBACK;`). The `DO` block ends in `RAISE EXCEPTION`, which carries the outputs back and guarantees the rollback.
- **Steps:**
  1. Insert `permit_types('Test Type 679')`.
  2. Insert a permit of that type on the project. The insert trigger runs the recompute.
  3. Call `bp_recompute_target_submits` and read the new permit.
  4. Call both learners.
  5. Add a `target_submit_formulas` row (offset 10), as Settings would, and recompute again.

Output, verbatim:

```
fix-679 probe (rolled back)
project=ca1817a2-7147-4714-9f92-7112b57b866c juris=Seattle go_date=2026-09-21 new_permit_id=10902
recompute #1 returned=0 -> Test Type 679 target_submit=<NULL> is_projected=f
bp_learn_target_submit_days('Test Type 679',Seattle,'go_date')=<NULL>
  (control: ECA Waiver same call=14)
bp_learn_days_explain('Test Type 679',Seattle,'intake_to_approval') -> days=210 tier=hardcoded
after adding target_submit_formulas row offset 10: recompute #2 returned=0 -> target_submit=<NULL>
BP 10741 target before=2026-10-12 after=2026-10-12 ; other permits on project changed=0
```

**Read back afterwards:**
- `permit_types` rows named 'Test Type 679' = 0
- permits of that type, or with id 10902 = 0
- formula rows for it = 0
- total permits = 861, and max id = 10901: unchanged

**What it shows:**
- **Expected NULL, got NULL.** A formula row does not help. Settings cannot rescue the type.
- **`bp_learn_target_submit_days` returns NULL** for an unknown type with no formula row and no history. With the formula row it would return 10, but the recompute never asks.
- **The ECA Waiver control returns 14,** its formula row, which is not the learned average.

## §C — Fix plan (proposed, not built)

**Goal:** a type added in Settings gets an anchor and a starting offset. From then on it gets an automatic Target Submit, learns from its own submissions, and the scraper either picks it up or says loudly that it can't.

| # | Ticket | Size | Depends on |
|---|---|---|---|
| 1 | **Target Submit reads the type's anchor from a table (DB).** See the details below the table | **M** | — |
| 2 | **Frontend reads the same columns.** `anchorFor`, `isTargetSubmitProjected` and `HARDCODED_TARGET_SUBMIT_OFFSETS` read the `permit_types` columns through `usePermitTypes` instead of a `switch`. `Trends` `eligibleTypes` follows. Delete the twins; a guard test asserts that no `case 'Building Permit':`-style type switch remains in these files | S | 1 |
| 3 | **Settings: "Target Submit counts from".** Add an anchor picker and starting-days box to `PermitTypeEditor`, and require them when adding a type. `PerTypeScheduleTable` shows the offset box whenever the anchor isn't `none`. The add-type form explains that the learner takes over once there are submissions | S | 1, 2 |
| 4 | **Wizard seeding for any type.** `SEEDING_RULES` derives the Target Submit pre-fill from the type's anchor and offset instead of its own type list | S | 1, 2 |
| 5 | **Type behaviour flags in `permit_types`.** Columns: `issues_document`, `tracked_by_scraper`, `is_land_use`, `seattle_intake`.<br>Backfill exactly from `NO_ISSUANCE_PERMIT_TYPES`, `NOT_TRACKED_PERMIT_TYPES`, `LAND_USE_PERMIT_TYPES` and the BP/Demo intake rule. Then point `bp_permit_results_ready_autotask`, `bp_sync_intake_record_from_permit` and the 4 TS sets at them, and expose them as Settings checkboxes. The same zero-diff proof as ticket 1, run on the trigger outputs | M | 1 |
| 6 | **Scraper reads the type list (scraper repo).**<br>Read `NO_ISSUANCE_PERMIT_TYPES` from `permit_types.issues_document`, which retires the hand-kept parity rule.<br>In Seattle, a permit whose type is not BP / Demolition and whose number matches no known pattern raises a triage item, instead of `not_found` forever on the BP dataset. Keep the fee-paid and BP/Demo ladders as code (they encode portal behaviour) | S–M | 5 |
| 7 | **Indexer folder names from `permit_types`.** Build `TRACK_CONTAINERS` and its SQL twin `bp_correction_track_folder` from the type names plus today's aliases ("post permit"), so a new type's subfolder is scanned | S | — |
| — | **New city or new portal** stays code work by nature: an MBP mapping (S per city) or a new adapter (M–L per portal). The runbook is the "What the scraper needs" list at the end of §A3 | per city | — |

**Ticket 1 in detail:**
- Add `permit_types.ts_anchor` (CHECK in `dd_end`, `go_date`, `bp_c0_intake`, `bp_c1_resub`, `bp_actual_issue`, `mirror_bp`, `none`) and `permit_types.ts_default_offset_days`.
- Backfill today's exact `CASE` values:
  - G&C / LSM → `mirror_bp`
  - Demolition `bp_c0_intake` 37
  - ECA / PAR / SDOT Tree / TRAO `go_date` 10
  - LBA / Short Plat / SIP `go_date` 37
  - IPR / ULS `bp_c1_resub` 7
  - Condo `bp_actual_issue` 129
  - BP `dd_end` 21
  - PPR / STFI / Vault / WAC → `none`
- `bp_recompute_target_submits` replaces both `CASE`s with one lookup: candidate = anchor date + `COALESCE(learn(type, juris, anchor), ts_default_offset_days)`. "Projected" is derived from the anchor (go_date → false, mirror → false, bp_c0_intake → intake projected, bp_c1_resub → c1 projected, bp_actual_issue → issue projected), which is exactly today's `v_projected` table.
- `bp_learn_target_submit_days`'s last resort reads `ts_default_offset_days`.
- No new behaviour for existing permits.

Order: **1 → 2 → 3 → 4**. That is the whole of Bobby's requirement for dates. **5 → 6** next, and **7** at any time.

**How ticket 1 proves zero behaviour change:** one `BEGIN … ROLLBACK` probe on prod, then the same steps for real.
1. Snapshot `(id, target_submit, target_submit_is_projected)` for all 861 permits.
2. Snapshot `bp_learn_target_submit_days(type, juris, anchor, tenant)` for every type × city × anchor actually in use.
3. Apply the migration.
4. Run `bp_recompute_target_submits` for **every** project.
5. Diff both snapshots. **Expected: 0 rows differ.**
6. A mirror test pins the backfilled table against the old `CASE` text, so a wrong backfill fails CI.
7. Base the `CREATE OR REPLACE` on the live `pg_get_functiondef`, patched by anchor, and suppress the `updated_at` / OCC triggers during the backfill.

### Questions for Bobby (each with a recommended answer)

1. **Should a Settings offset stop learning?**
   - Today a `target_submit_formulas` row *overrides* the learner (fix-249 "policy beats learner"). That is why no current type learns its Target Submit.
   - **Recommended:** keep the formula row as an explicit override, unchanged for the 13 types. Make the new `ts_default_offset_days` a *starting point only*, used until the type has its own submissions. So a new type learns by default, and nobody's current dates move.
2. **What anchor should a new type default to?**
   - **Recommended:** require a choice when the type is added, with "GO date" preselected. 7 of the 13 anchored types use it.
3. **Should PPR, STFI, Vault and WAC get automatic targets?** They get none today.
   - **Recommended:** backfill them as `none` in ticket 1 (zero change), then set them in Settings as a separate, visible decision.
   - STFI already has a formula row (3 days), which suggests someone expected it to work. My suggestion for STFI is GO date + 3.
4. **Does a new type issue a permit document?**
   - **Recommended:** a Settings checkbox, default **on**. That matches today's safe default in both the Bridge and the scraper.
5. **Should the dead G&C (21) and LSM (27) formula rows be removed?**
   - Those types mirror the BP's target and never read their offset.
   - **Recommended:** leave them, and label them in Settings as "follows the Building Permit's target". Deleting them changes nothing, but would surprise whoever set them.

## Guide impact

None. This is a doc-only change.

**No code behaviour, schema or production data changed.**
