# Settings reconciliation census

**Ticket:** fix-607 · **Feeds:** P-166 (Settings overhaul, step 1 of 2) · **Read against:** `origin/main` `fc730d3`, prod `eibnmwthkcuumyclyxoe`, 2026-09-30.
**What this is:** a fact sheet answering Bobby's second ask — *"everything is syncing from one end to another"*. For every block in Settings: where it is stored, who can edit it, what reads it, and what *should* read it but does not.
**What this is not:** a layout proposal. Navigation (categories, collapsing, search) is Bobby's pick from Cowork's mock.

**Method.** Every row is derived from code — the table, RPC or `app_config` key was grepped, not the label. Tests are excluded from "readers". Prod was read only (counts and key listings); nothing was written.
⚠️ Several database functions (`bp_set_app_config_key`, `bp_upsert_jurisdiction`, `bp_upsert_permit_type`, `bp_upsert_permit_type_default`, `bp_rename_da/dm`) are **not in `migrations/`** — prod is ahead of the repo. Where a row depends on such a function's body or its server-side gate, it says *"definition not in repo"*.

**fix-606** (Waiting On read by three pickers) had **not merged** when this was written. The Waiting On rows below describe `fc730d3`.

---

## Block count

| tab | route | blocks |
|---|---|---|
| Account | `/settings/account` | 3 |
| Team | `/settings/team` | 20 |
| Lists & Catalogs | `/settings/projects` | 13 |
| Permits | `/settings/permits` | 5 |
| Schedule | `/settings/schedule` | 2 |
| **Total** | | **43** |

(The brief's quick read listed ~15 Team blocks. There are 20: it did not count **Construction admin**, **Inactive (other roles)**, or the per-role pill lists separately. Permits has a 5th block, **Phase Durations**, a read-out.)

**"Who can edit", once for all tabs.** Every Settings editor is gated in the browser by `useIsTenantAdmin()` (`tenant_memberships.role = 'admin'`) and passes `readOnly={!isAdmin}`. The server side varies:
- RLS `is_tenant_admin` (most roster tables);
- an admin check inside the RPC (`bp_upsert_mention_tag`);
- the legacy `profiles.role = 'admin'` (the global catalogues `permit_types` and `jurisdictions`, per `database.types.ts:1657`; the `admin-create-user` edge function);
- **no admin check at all** (see §1, gaps 26–27).

The column below says only where a block differs from that default.

---

## The census

Abbreviations: **RPC** = writes through a database function · **direct** = writes the table from the browser with `.from(table)` · **AC** = `app_config` key, written by `bp_set_app_config_key`.

### Account

| block | stores in | who can edit | every screen that reads it | should read it but use something else | duplicate homes | notes |
|---|---|---|---|---|---|---|
| Your picture (`AvatarControl`) | Storage object + `profiles.avatar_path`, via RPC `bp_set_avatar_path` (`hooks/useAvatars.ts:139,173`) | yourself; server allows own profile or `is_admin()` (`fix_505:251-261`) | `hooks/useAvatars.ts` (name→path index) → `<Avatar>` in `Chrome.tsx`, `ChatMessageRow.tsx`, `MentionTextarea.tsx`, `ProjectChatModal.tsx`, `ProjectDetailHeader.tsx` | — | Team → Names and emails → person dialog has the same control, admin-only (`PersonDetailsDialog.tsx:184-187`) — deliberate | keyed by roster name, not email |
| Sign-in info | nothing (reads `authStore`) | — | itself | — | — | **read-out** |
| DB tools (`DbToolsCard`) | nothing; exports 15 tables (`lib/exportBackup.ts:13-29`); import is a stub | admin only | itself | export omits `target_submit_formulas` and `permit_type_defaults` (two Settings tables) | — | **tool / read-out** |

### Team

All roster blocks read one query: `useTeamMembers()` → `.from('team_members')` (`hooks/useTeamMembers.ts:90`). It is split client-side into `activeDas`, `formerDas`, `dms`, `ents`, `acqs`, `schematics`, `cas` and `inactive`.

Prod roster (active `team_members` by role): da 12 · dm 5 · ent 4 · ent_lead 3 · acq 2 · acq_lead 5 · schematic 5 · ca 2 · director 1 · viewer 7.

| block | stores in | who can edit | every screen that reads it | should read it but use something else | duplicate homes | notes |
|---|---|---|---|---|---|---|
| Add person | edge function `admin-create-user`: `auth.users` + `team_members` + `tenant_memberships` + `profiles.role` (`supabase/functions/admin-create-user/index.ts:96-178`) | server gate is `profiles.role='admin'` (`handler.ts:332-342`), not the UI's `tenant_memberships` | the roster readers below; the login feeds `lib/selfScope.ts` (email → roster identity) | role list hand-written in 3 places: `lib/addPerson.ts:47-61`, `handler.ts:43-55`, `lib/roleLabels.ts` | every pill list's "Add…" box also creates a `team_members` row (name + role only, `AdminTeamTab.tsx:110-113`) | action |
| Design Associates | `team_members` role `da`. Add/restore: `bp_upsert_team_member_row`. Rename: `bp_rename_da` (cascade per `useRenameDA.ts:7-10`). Delete: `bp_delete_team_member_row` | default | `ReassignDaModal.tsx:44`, `ReuseRedesignDdEditor.tsx:74`, `wizard/Step1ProjectInfo.tsx:202,290`, `wizard/Step3Permits.tsx`, `hooks/useProjectDetailsForm.ts:302`, `pages/ProjectList.tsx:245`, `pages/MyTasks.tsx:691`, `DrawScheduleGrid.tsx:597-611`, `hooks/useBoardLens.ts:63-77`, `lib/myBoard.ts:2387`, `Reports/TeamTab.tsx:69`, `pages/ReportsTeamDetail.tsx:112`, and the DA Routing, Team Structure, Active Quarters and Quarter Layout blocks | `lib/myBoard.ts:2388` uses `active === true` instead of `isCurrentMember` | `app_config.das` — a stale copy, no reader (§2) | only DAs retire softly (`former=true`) |
| Active Quarters | `team_members.active_start_quarter/active_end_quarter`, RPC `bp_update_team_member_quarters` | default | `DrawScheduleGrid.tsx:601-717` (lanes per quarter), `QuarterLayoutEditor.tsx:244-256`, `wizard/Step1ProjectInfo.tsx:207,296`, `lib/teamMemberLabel.ts:24-26` → `wizard/PermitAssignmentRow.tsx`; server seed/clone (`fix_183_*`) | editable only for **current** DAs (`AdminTeamTab.tsx:225`), but `DrawScheduleGrid.tsx:607-613` reads it for former DAs too | overlaps `active`/`former` and each quarter's layout membership | DA-only; other roles have the columns, no editor |
| Design Managers | `team_members` role `dm`. Remove = **hard delete**. Rename: `bp_rename_dm` (`useRenameDM.ts:6-8`) | default | `useProjectDetailsForm.ts:301`, `pages/MyTasks.tsx:692`, Team Structure, Quarter Layout | rename does not reach `projects.design_manager` (read by `lib/workDataNames.ts:45`) | `app_config.dms`, stale (§2) | |
| Team Structure | `dm_da_groups`, RPCs `bp_upsert_dm_da_group_row` / `bp_delete_dm_da_group_row` | default | `useDmDaGroups` → `DrawScheduleGrid.tsx:208`, `NewProjectWizard.tsx:155`, `wizard/Step3Permits.tsx:96`, `ChatTaskFields.tsx:49`, `PermitDetailV2.tsx:2284`, `TaskDetailEditor.tsx:92`, `hooks/useTaskOwnership.ts:99`, `pages/MyTasks.tsx:837`, `hooks/useBoardLens.ts:37`, `pages/MyBoard.tsx:756`, `lib/permitDmDerivation.ts`, `lib/milestoneOwnership.ts`, `lib/selfScope.ts`; trigger `bp_trg_task_coassign_dm` | "active DA with no DM" computed 3 ways (§1, gap 30) | **`draw_schedule_quarter_layout.group_label`** records DM→DA grouping per quarter as well (§2); `app_config.dmDaGroups`, stale | |
| DA Routing (permitting lead) | `da_team_routing` (da, jurisdiction, ent_lead), RPCs `bp_upsert/delete_da_team_routing_row` | default | `NewProjectWizard.tsx:158`, `wizard/Step1ProjectInfo.tsx:170`, `wizard/Step3Permits.tsx:173`, `pages/MyBoard.tsx:758`; RPC `bp_ent_lead_for_da` from `DrawScheduleGrid.tsx:1373`, `NewProjectWizard.tsx:460`, `Step3Permits.tsx:378,447`; `bp_cascade_ent_lead_for_project` / `EntCascadePrompt.tsx` | the RPC's matching rule is re-implemented client-side (`hooks/useDaTeamRouting.ts:71-84`, `Step3Permits.tsx:171`) | — | |
| Departments | `team_members.department`, RPC `bp_set_team_department` | default | **nothing outside the panel** | — | a viewer's function is also free text in `team_members.notes` (`lib/selfScope.ts:54-66`) | setting with no consumer (the tab says "nothing gates on it") |
| Agenda members | `team_members.agenda_member`, RPC `bp_set_team_agenda_member` | default | `hooks/useAgendaMember.ts` → `Ribbon.tsx:129`, `lib/ribbonNav.ts:632,692`, `pages/Agenda.tsx:41-43`, `WeeklyUpdate/AgendaBlock.tsx:61`, `hooks/useWeeklyEdition.ts:64` | the agenda item composer offers the whole roster (`AgendaBlock.tsx:100-102`) | — | `/agenda` route itself is unguarded |
| Names and emails | `team_members.first_name/last_name/email`, RPC `bp_set_person_details`; picture via `bp_set_avatar_path` | default | `lib/roster.ts:171-188` → `useRosterFullName` → `ChatMessageRow.tsx:96`, `ProjectChatModal.tsx:1120`, `ProjectDetailHeader.tsx:705`; email → `lib/selfScope.ts` (who you are, everywhere), `lib/workDataNames.ts`, `useAvatars` | — | email also set by Add person; the **login's** email lives in `auth.users`/`profiles` and is not changed here | per-person data |
| Who the work data means | writes nothing; reads `projects`, `permits`, `draw_schedule`, `team_members`, `profiles` (`useAccountLinks.ts:76,87`) | — | itself | `WORK_DATA_COLUMNS` (`lib/workDataNames.ts:40-47`) omits `projects.acq_lead`, `projects.entitlement_lead`, `projects.construction_admin`, `permits.ca`, `permits.architect`, `permit_tasks.assigned_to` | — | **read-out** |
| Who is running what | writes nothing; RPC `bp_list_client_builds` | — (RLS: own row unless admin, `fix_589:115-121`) | itself | — | — | **read-out** |
| Permits with no permitting lead | `permits.ent_lead`, **direct** `.from('permits').update` (`hooks/useUpdatePermit.ts:42-46`) | default | `permits.ent_lead` is read app-wide (`lib/selfScope.ts`, `lib/unclaimedWork.ts`, My Tasks, My Board, Reports, Activity, Weekly DA, `PermitCard`) | its picker is a plain ENT list and ignores DA routing (`PermitsMissingLeadPanel.tsx:178-182`) | `ent_lead` is also set in Project Details (`ProjectDetailsForm.tsx:950-953`), the wizard (`PermitAssignmentRow.tsx:161`) and the routing cascade | **read-out + per-row editor** |
| Chat Tags | `mention_tags` + `mention_tag_members`, RPCs `bp_upsert/delete_mention_tag` (server refuses non-admin, `fix_347:269-272`) | default | `ProjectChatModal.tsx:136` (`lib/mentionTags.ts`, `@tag` resolution) | members are login ids (`bp_mentionable_people`), so a person without a login cannot be tagged | — | prod: 1 tag |
| Draw Schedule Layout (per quarter) | `draw_schedule_quarter_layout`, RPCs `bp_replace/clone/seed_*_quarter_layout`, `bp_restore_deleted_quarter_layout` | default | `useQuarterLayout` → `DrawScheduleGrid.tsx:716-718` | `group_label`/`top_label` are free text with a datalist (`QuarterLayoutEditor.tsx:861-875`) | DM grouping duplicates Team Structure (§2); `app_config.quarterTeams`, stale | |
| Entitlement leads | `team_members` role `ent`/`ent_lead`. Remove = hard delete. Rename = `bp_upsert_team_member_row`, **no cascade** (`AdminTeamTab.tsx:144-148`) | default | `useProjectDetailsForm.ts:298`, `Step3Permits.tsx:179`, `pages/ProjectList.tsx:236`, `pages/MyTasks.tsx:690,722`, DA Routing, Permits with no permitting lead, Quarter Layout, `lib/unclaimedWork.ts:93-100` | **`pages/ActivityPage.tsx:44` hard-codes `['Bobby','Briana','Miles']`**; `Reports/ReportsOverviewTab.tsx:175-179` builds ENT options from permit data | `app_config.entLeads`, stale | rename leaves `permits.ent_lead`, `da_team_routing.ent_lead`, `projects.entitlement_lead` on the old name |
| Acquisition leads | `team_members` role `acq`/`acq_lead`; no rename cascade | default | `useProjectDetailsForm.ts:303` → `ProjectDetailsForm.tsx:576`, `wizard/Step1ProjectInfo.tsx:152`, `pages/MyTasks.tsx:697` | `Step1ProjectInfo.tsx:67` re-declares the role set | `app_config.acqLeads`, stale **and drifted** (§2) | rename leaves `projects.acq_lead` |
| Schematic | `team_members` role `schematic`; no rename cascade | default | `wizard/Step1ProjectInfo.tsx:69,156`, `useProjectDetailsForm.ts:307`, `pages/MyTasks.tsx:699`, task routing token "Schematic Team" (`lib/taskTeam.ts`) | — | — | rename leaves `projects.schematic_designer[]` |
| Construction admin | `team_members` role `ca`; no rename cascade | default | `useProjectDetailsForm.ts:309` → `ProjectDetailsForm.tsx:647-656`, `pages/MyTasks.tsx:706` | `permits.ca` is read (`lib/selfScope.ts:448`, `PermitCard.tsx:59`) but **no screen writes it** | — | |
| Former DAs (alumni) | `team_members` role `da`, `former`; restore = upsert, × = hard delete | default | `formerMemberNames` (`lib/roster.ts`) → `Dashboard/StageFilters.tsx:59`, Team Structure, `QuarterLayoutEditor.tsx:20` | — | retirement is also expressed by the Active Quarters end | `app_config.formerDas` = `[]`, stale |
| Inactive (other roles) | writes nothing (`useTeamMembers().inactive`) | — | same as Former DAs | no screen can set `active=false` for a non-DA; their × buttons hard-delete (`AdminTeamTab.tsx:235,394,407,422,445`) | — | **read-out**; cannot reactivate |

### Lists & Catalogs

| block | stores in | who can edit | every screen that reads it | should read it but use something else | duplicate homes | notes |
|---|---|---|---|---|---|---|
| Jurisdictions | **table** `jurisdictions` (name, `learn_window_days`, notes), RPCs `bp_upsert_jurisdiction` / `bp_delete_jurisdiction` — prod **19** rows | server: legacy `profiles.role` | `wizard/Step1ProjectInfo.tsx:124,571`, `NewProjectWizard.tsx:196-198`, `useProjectDetailsForm.ts:672` → `ProjectDetailsForm.tsx:388`, `DaRoutingEditor.tsx:54,249`, `TargetSubmitFormulasEditor.tsx:41,125`, `TaskTemplateEditor.tsx:92,194`, `AdminScheduleTab.tsx:36` | **Library juris editor reads `app_config.jurisdictions`** (8 names) instead (`LibraryMatrix.tsx:461-464`); 9 juris *filters* build options from stored values (§1, gap 14) | `app_config.jurisdictions` (8 names, no Settings editor); `learn_window_days` also edited on Schedule | delete does not cascade (`useDeleteJurisdiction.ts:8-11`); prod: 0 projects with an off-list juris |
| Jurisdiction Links | AC `jurisdictionLinks` (prod: 8 cities) | default | `Ribbon.tsx:662` (city link folders) | — | — | unset key falls back to `DEFAULT_JURISDICTIONS` |
| Builders & Owners | table `builders` (prod 61), RPCs `bp_upsert_builder`, `bp_deactivate_builder`, `bp_merge_builders`, `bp_rename_builder_person` | **server has no admin check** (`fix_448:94-101,182-186,285`) | `builder/BuilderPicker.tsx:68` → `ProjectDetailHeader.tsx:1362` (sets `builder_id`); `builder/BuilderAutocompleteField.tsx:86` → wizard; `ProjectDetailsForm.tsx:709-713` (cached columns) | wizard builder fields are free text and never set `builder_id` (`Step1ProjectInfo.tsx:359-368`, `useCreateProjectWithPermits.ts`); autocomplete offers deactivated builders | `BuilderPicker.tsx:235,253` creates builders from Project Detail without an admin gate | unused direct-write hook `useBuilders.ts:54,63` |
| Permit Owner | AC `permitOwnerOptions` — **key not present on prod** (editor shows its defaults) | default | **only `AdminProjectsTab.tsx:121,123`** | nothing writes `permits.permit_owner`; `PermitCard.tsx:54` shows it as a lead fallback; search haystacks `reportMetrics.ts:721`, `Dashboard.tsx:473` | — | effectively a **read-out** (list + counts) |
| Zones | AC `zoneOptions` (prod 21) | default | `shared/ZoneSelect.tsx:46-47` → `ProjectDataEditors.tsx:964`, `Step1ProjectInfo.tsx:849`; `LibraryMatrix.tsx:306,759-767` (filter), `:1444,1863` (edit cell) | Library zone filter is registry-only, so a retired zone still on a project cannot be filtered for | — | prod: 0 projects with an off-list zone |
| Types (product types) | AC `productTypeOptions` (prod 5) | default | `Step1ProjectInfo.tsx:138,859`, `wizard/UnitTypesEditor.tsx:177-178`, `useProjectDetailsForm.ts:674` → `ProjectDetailsForm.tsx:481-485`, `LibraryMatrix.tsx:301,1001,1204,2026`, `lib/unitTypeNaming.ts:148` → `ProjectDataEditors.tsx:1507,1726` | Reports product-type filter from stored values (`ReportsOverviewTab.tsx:183-189`) | — | |
| Unit Parking | AC `parkingOptions` (prod 5) | default | `Step1ProjectInfo.tsx:144`, `ProjectDataEditors.tsx:1508`, `LibraryMatrix.tsx:312`, label composers e.g. `ProjectOverviewBoxes.tsx:578` | tooltip copies of the vocabulary (`ProjectOverviewBoxes.tsx:580`, `lib/unitConfigFields.ts:116`) | — | |
| Unit Roof Deck | AC `roofDeckOptions` (prod 3) | default | `Step1ProjectInfo.tsx:145`, `ProjectDataEditors.tsx:1509`, `LibraryMatrix.tsx:316` | tooltip copy `ProjectOverviewBoxes.tsx:588` | — | only 3 labels are storable (`unitVocabulary.ts:204-215`) — additions cannot be saved; reordering is the only effective edit |
| Unit Stories | AC `storiesOptions` (prod 8) | default | `Step1ProjectInfo.tsx:146`, `ProjectDataEditors.tsx:1510`, `LibraryMatrix.tsx:320` | — | — | |
| Project Tags | AC `projectTagOptions` (prod 9) | default | `Step1ProjectInfo.tsx:132,1085`, `ProjectDataEditors.tsx:1401,1424` | Reports tag filter from stored values (`ReportsOverviewTab.tsx:191-195`); the block's own empty state says "Used across Reports" (`AdminProjectsTab.tsx:458`) | — | |
| Hold Reasons | AC `holdReasonOptions` (prod 5) | default | `ProjectDetail/ProjectHold.tsx:67,153-163,361-373`, `PermitHold.tsx:57,146` → `HoldReasonMenu.tsx:170` | — | — | one list serves project and permit holds; prod: 0 holds with an off-list reason |
| Cancel Reasons | AC `cancelReasonOptions` (prod 7) | default | `ProjectDetail/ProjectHold.tsx:68,89,441` | — | — | |
| External Team Directory | table `external_team_directory` (prod 25), **direct** `.from(...).update/.insert` (`hooks/useExternalTeamDirectory.ts:82,100`); RLS admin write (`fix_227:60`) | default | `ProjectDetail/ConsultantBand.tsx:130-160,614-621`, `Reports/WaitingOnView.tsx:125-139`, `pages/VendorScheduleForecastReport.tsx:98,203` | its discipline set is the **constant** `WAITING_ON_OPTIONS` (`ExternalTeamDirectoryEditor.tsx:215-222`); a firm with another discipline never renders here | `ExternalFirmSelect.tsx:96` inserts too, but nothing imports it | `app_config.consultantTypes`, stale |

### Permits

| block | stores in | who can edit | every screen that reads it | should read it but use something else | duplicate homes | notes |
|---|---|---|---|---|---|---|
| Permit Types | table `permit_types` (name, is_builtin, notes; **global, no tenant_id**) — prod **18**; RPCs `bp_upsert/delete/rename_permit_type`. Descriptions: AC `permitTypeDescriptions` (prod 14) | server: legacy `profiles.role` | `usePermitTypes` → `IntakeTracker.tsx:71,95`, `NewProjectWizard.tsx:150,197`, `wizard/Step2Questionnaire.tsx:59-66`, `wizard/Step3Permits.tsx:102-105`, `ProjectDetailsForm.tsx:1205` (retired types marked since fix-605), `pages/Trends.tsx:134,157`, `TaskTemplateEditor.tsx:82`, `PermitTypeDefaultsEditor.tsx:24`; descriptions → `wizard/QuestionnaireSection.tsx:45` | per-type behaviour hard-coded in 9 TS + 3 SQL places (§1, gap 7); type filters from stored values (`StageFilters.tsx:65-83`, `ReportsOverviewTab.tsx:163-167`, `teamDetailRows.ts:80`) | descriptions in AC **and** a `permit_types.notes` column the editor only ever writes as `null` (`PermitTypeEditor.tsx:94`); `app_config.permitTypes` (7, stale); per-type facts across 3 tables (§2) | permits per type on prod: BP 284 · Demolition 225 · ULS 126 · PAR/Pre-Sub 41 · SDOT Tree 22 · PPR 18 · IPR 16 · TRAO 16 · Grading/Clearing 7 · LSM 5 · ECA Waiver 4 · LBA 4 · SIP 4 · Short Plat 2 · Condo 1 · STFI 1 · Vault 1 · WAC 0 (0 permits off-registry) |
| Task Templates | `task_templates` (87) + `task_template_subtasks` (87), RPCs `bp_upsert/delete_task_template_row`, `bp_*_task_template_subtask_row`, `bp_reorder_task_templates` | default | `wizard/Step4TaskReview.tsx:60,96-99` picks them → `useCreateProjectWithPermits.ts:163` → RPC `bp_create_project_with_permits` inserts `permit_tasks` (`fix_244:243-294`). **No trigger applies templates.** | the template's Waiting On select uses the constant (`TaskTemplateEditor.tsx:36,460`); `bp_update_project_with_permits` (`fix_382:265-283`) adds permits to an existing project **with no template tasks** | Waiting On vocabulary (next row) | `legacy_task_templates` (1 row) — not referenced in `src/` or `migrations/` |
| Waiting On | AC `waitingOnOptions` — **key not present on prod**; the effective list is `DEFAULT_WAITING_ON_OPTIONS` (`lib/waitingOn.ts`) | default | `TaskDetailEditor.tsx:83-84,508`, `PermitDetailV2.tsx:2414-2415,2663` (task pickers); `Reports/WaitingOnView.tsx` groups by the stored value | `TaskTemplateEditor.tsx:460` and `ExternalTeamDirectoryEditor.tsx:215-222` use the constant; type unions exclude `City` and added values (`database.types.ts:1089,1188,1381`) | two sources: the AC list and `WAITING_ON_OPTIONS` (`database.types.ts:1052`); `lib/consultants.ts:396` `FIXED_DISCIPLINES` is a third, 4-item list | prod `permit_tasks.waiting_on`: null 2,002 · Structural 35 · Surveyor 29 · Other 27 · Civil 26 · Architect 4 · Landscape/Arborist/Geotech/City/Energy 3 each · Stormwater 2 · Mechanical/Electrical 1 each |
| Target-submit formulas | `target_submit_formulas` (prod 15), RPCs `bp_upsert/delete_target_submit_formula`, read `bp_list_target_submit_formulas` | **server has no admin check**: SECURITY DEFINER + tenant check only; RLS `FOR ALL USING tenant` (`fix_154:47-49,115-170`) | SQL `bp_target_submit_offset` → `bp_learn_target_submit_days` → `bp_recompute_target_submits` (`fix_249`); `TargetSubmitBenchmarkNote.tsx:43,51` | `pages/Trends.tsx:1848-1856` computes targets client-side (learner first, then `HARDCODED_TARGET_SUBMIT_OFFSETS`) and never reads formulas; editor lists types from Base rows, not `permit_types` (`TargetSubmitFormulasEditor.tsx:45-51`) | per-type targets also on Schedule (§2); offsets also in code (`targetSubmitLearner.ts:42`, `fix_249:248`) | anchors are code-only (`anchorFor`) |
| Phase Durations | RPC `bp_phase_duration_grid` (read-only) | — | itself; also built-in report `phase_durations` (`lib/builtinReports.ts:41-43`) | — | — | **read-out**; its own 180-day window (`lib/phaseDurations.ts:44`) |

### Schedule

| block | stores in | who can edit | every screen that reads it | should read it but use something else | duplicate homes | notes |
|---|---|---|---|---|---|---|
| Learning windows | `jurisdictions.learn_window_days`, RPC `bp_upsert_jurisdiction` | server: legacy `profiles.role` | **nothing outside the two Settings editors** — no reader in `src/` or `migrations/` | `lib/scheduleBenchmarks.ts:127-130` `getLearnWindow(juris)` ignores `juris` and returns a flat 180; the learners use fixed 90/180/365/all tiers (`scheduleBenchmarks.ts:25`, `fix_249`, `fix_585`) | the same field is editable on Lists & Catalogs → Jurisdictions (`AdminProjectsTab.tsx:93-103`); three separate `180` defaults (`AdminScheduleTab.tsx:14`, `AdminProjectsTab.tsx:44`, `scheduleBenchmarks.ts:18`) | the block's copy says it drives Schedule Benchmarks (`AdminScheduleTab.tsx:50-54`) — it does not |
| Permit-type defaults | `permit_type_defaults` (prod 15), RPC `bp_upsert_permit_type_default`; row history (fix-590) | `useIsTenantAdmin` inside the editor | SQL `bp_learn_days_explain` / `bp_learn_days` (fix-585); `ScheduleHealthTable.tsx:183,222,308,376`, `hooks/useProjectedApprovalFor.ts:62,86,141` → `ProjectOverviewBoxes.tsx:324` → `projectedApproval.ts:697` | `DrawScheduleGrid.tsx:456-477` and `ScheduleEstimator.tsx:125-144` call `computeProjectedApproval` **without** `typeDefaultsOverride` and fall back to `PER_TYPE_DEFAULT_DAYS`, whose keys do not match the catalogue (`scheduleBenchmarks.ts:66-82`) | per-type facts on Permits (§2) | 3 catalogue types have no row: PPR (18 permits), Vault (1), WAC (0) |

---

## 1 · Broken or partial wiring

Deduplicated across tabs. **47 gaps.** Each one is either a list that a consumer ignores, a free-text escape, a direct write, a hard-coded copy, or a server check the screen implies but the server does not make.

**Lists a consumer ignores**

1. **The learning window is read by nothing.** `getLearnWindow` returns a flat 180 (`lib/scheduleBenchmarks.ts:127-130`). The copy at `AdminScheduleTab.tsx:50-54` says otherwise.
2. **Permit-type defaults are ignored by two estimators.** `DrawScheduleGrid.tsx:456` and `ProjectDetail/ScheduleEstimator.tsx:125` omit `typeDefaultsOverride`.
3. **The fallback `PER_TYPE_DEFAULT_DAYS` uses names not in the catalogue.** It has `Use Limitation`, `Land Use`, `LU`, `Pre-Application`, `PA` and `SDOT`, and lacks `SDOT Tree`, `PAR/Pre-Sub` and `ECA Waiver` (`lib/scheduleBenchmarks.ts:66-82`).
4. **Trends ignores target-submit formulas.** It runs learner-first, then hard-coded offsets — the opposite order to the server's fix-249 rule (`pages/Trends.tsx:1848-1856`, `lib/targetSubmitLearner.ts:42,322`).
5. **The formulas editor lists types from its own Base rows, not `permit_types`.** A new catalogue type never appears (`TargetSubmitFormulasEditor.tsx:45-51`).
6. **`anchorFor` sends an unknown type to `mirror_bp`.** `TargetSubmitBenchmarkNote` then renders nothing (`lib/targetSubmitLearner.ts:61-85`).
7. **Per-type behaviour the catalogue does not drive:**
   - `lib/targetSubmitLearner.ts:42,61`
   - `lib/durationLadder.ts:93`
   - `lib/permitSeedingDefaults.ts:43`
   - `lib/permitTypeTaxonomy.ts:22`
   - `lib/landUsePhase.ts:63`
   - `lib/permitTracking.ts:40`
   - `wizard/wizardState.ts:640`
   - `migrations/fix_249:248-259,629-652`
   - `migrations/fix_585:312-322`
8. **Permit-type rename moves only `permits.type`** (`fix_288:63-64`). It leaves `task_templates.permit_type`, `target_submit_formulas.type`, `permit_type_defaults.type`, the `permitTypeDescriptions` keys and every code table above on the old name.
9. **Permit-type filters come from stored values, not the catalogue:** `Dashboard/StageFilters.tsx:65-83`, `Reports/ReportsOverviewTab.tsx:163-167`, `lib/teamDetailRows.ts:80`.
10. **The task-template Waiting On select uses the constant, not the editable list** (`TaskTemplateEditor.tsx:36,460`). fix-606's territory.
11. **External Team Directory's discipline set is the constant** (`ExternalTeamDirectoryEditor.tsx:215-222`; also unused `lib/externalTeam.ts:87-98`, `hooks/useExternalTeamShowRules.ts:31`). This is documented as deliberate ("consultant vocabulary", `lib/waitingOn.ts:34-39`), but a firm whose discipline is outside the constant is invisible here.
12. **`waiting_on` / `default_waiting_on` are typed as the constant's union.** That excludes `City` and admin-added values (`database.types.ts:1089,1188,1381`; cast `useWaitingOnTasks.ts:160`).
13. **The Library jurisdiction editor reads `app_config.jurisdictions`** (8 names, no Settings editor), not the 19-row `jurisdictions` table (`LibraryMatrix.tsx:461-464`).
14. **Jurisdiction filters come from stored values:**
   - `Reports/ReportsOverviewTab.tsx:169-172`
   - `Reports/RedesignsTab.tsx:85-87`
   - `Reports/TeamTab.tsx:96-98`
   - `pages/Trends.tsx:256-258`
   - `pages/ProjectList.tsx:229-231`
   - `pages/PhaseDurationsReport.tsx:43`
   - `pages/WeeklyDaReport.tsx:123-124`
   - `lib/correctionsReport.ts:247`
   - `LibraryMatrix.tsx:446-449` (deliberate, per its comment)
15. **Product-type and tag filters in Reports come from stored values** (`ReportsOverviewTab.tsx:183-195`). The Project Tags block's empty state claims "Used across Reports" (`AdminProjectsTab.tsx:458`).
16. **The Library zone filter is registry-only,** so a retired zone still on a project cannot be filtered (`LibraryMatrix.tsx:306`).
17. **Permit Owner has no consumer.** Nothing writes `permits.permit_owner`, and `PermitCard.tsx:54` shows that column as a lead fallback.
18. **Unit roof deck stores only 3 fixed labels.** The editor's additions cannot be saved (`lib/unitVocabulary.ts:204-215`).
19. **Hard-coded unit vocabulary in tooltips:** `ProjectOverviewBoxes.tsx:580,588`, `lib/unitConfigFields.ts:116`.
20. **ENT names hard-coded:** `pages/ActivityPage.tsx:44` (`['Bobby','Briana','Miles']`, used at 105, 115). ENT filter options come from permit data (`ReportsOverviewTab.tsx:175-179`).
21. **Role sets re-declared instead of imported from `lib/roster.ts:63,79`:**
   - `wizard/Step1ProjectInfo.tsx:67`
   - `wizard/Step3Permits.tsx:36`
   - `wizard/Step4TaskReview.tsx:40`
   - `lib/unclaimedWork.ts:93`
   - inline role predicates in `useProjectDetailsForm.ts:298-309`, `ProjectList.tsx:236,245`, `MyTasks.tsx:690-724`
22. **"Who the work data means" misses six name columns** (`lib/workDataNames.ts:40-47`). Its text says "People above", but the section is called "Names and emails".
23. **Department has no reader** outside its own panel.
24. **The weekly SSS card always sees no recipients.** It passes the whole config map to `readVendorRecipients`, which expects the `vendorReportRecipients` value (`WeeklyUpdate/SssCard.tsx:46` vs `lib/vendorReportEmail.ts:47-54`). The forecast page passes it correctly.
25. **`humanizeKey` has no label for 7 keys,** so their save toasts show raw key names (`useSetAppConfigKey.ts:52-67`).

**Server checks the screen implies but the server does not make**

26. **Target-submit formulas:** the RPCs and RLS allow any tenant member to write (`fix_154:47-49,115-170`).
27. **Builders:** the RPCs check tenant only (`fix_448:94-101,182-186,285`), and `BuilderPicker.tsx:235,253` creates builders from Project Detail with no admin gate.
28. **The admin gate reads two different tables:** `tenant_memberships.role` (UI, `useIsTenantAdmin`) and `profiles.role` (edge function `handler.ts:332-342`; the global catalogues' RLS per `database.types.ts:1657`).

**Direct writes instead of an RPC**

29. **Permits with no permitting lead:** `.from('permits').update` (`hooks/useUpdatePermit.ts:42-46`). Its picker also ignores DA routing (`PermitsMissingLeadPanel.tsx:178-182`).
30. **External Team Directory:** `.from('external_team_directory').update/.insert` (`hooks/useExternalTeamDirectory.ts:82,100`). RLS is admin-only, so this is a pattern gap, not a hole.
31. **Write paths nothing calls:** `hooks/useBuilders.ts:54,63` (direct), `ProjectDetail/ExternalFirmSelect.tsx:96`, `hooks/useUpsertQuarterLayoutRow.ts`, `hooks/useDeleteQuarterLayoutRow.ts`, the hook in `hooks/useReorderQuarterLayout.ts`.

**Free text where a list exists**

32. **Wizard builder fields are free text and never set `builder_id`** (`Step1ProjectInfo.tsx:359-368`, `builder/BuilderAutocompleteField.tsx:167`). The autocomplete also offers deactivated builders (`:86`).
33. **Quarter layout `group_label`/`top_label` are free text with a datalist** (`QuarterLayoutEditor.tsx:861-875`).
34. **Each pill list's "Add…" box creates a bare roster row** (name + role, no email; `AdminTeamTab.tsx:110-113`). This is the source of names "Who the work data means" cannot map.
35. **A viewer's function is free text in `team_members.notes`** (`lib/selfScope.ts:54-66`).

**Roster lifecycle**

36. **Rename has no cascade for ENT/ACQ/Schematic/CA** (`AdminTeamTab.tsx:144-148`). DA/DM rename, per their hook comments, does not reach `da_team_routing`, `draw_schedule.da_assigned` or `projects.design_manager` (`useRenameDA.ts:7-10`, `useRenameDM.ts:6-8`). The SQL bodies are not in the repo, so this was not verified in SQL.
37. **Non-DA roles cannot be retired, only hard-deleted** (`AdminTeamTab.tsx:235,394,407,422,445`). "Inactive (other roles)" cannot reactivate anyone.
38. **Active Quarters is editable only for current DAs,** but it is read for former DAs (`DrawScheduleGrid.tsx:607-613`).
39. **`permits.ca` is read but no screen writes it** (`lib/selfScope.ts:448`, `PermitCard.tsx:59`). `useTeamMembers.ts:31-33` names a `QuickEditPermitModal` that does not exist.
40. **"Active DA with no DM" is computed three ways:** `lib/dmCoAssign.ts`, `hooks/useBoardLens.ts:63-77`, and `lib/myBoard.ts:2387-2392`, which uses `active === true`.
41. **The DA routing rule is re-implemented client-side** (`hooks/useDaTeamRouting.ts:71-84`, `Step3Permits.tsx:171`).
42. **Email lives in two tables** (`team_members.email` vs `auth.users`/`profiles`). Editing one does not update the other.
43. **Chat tags take login ids,** so a person without a login cannot be tagged.
44. **The agenda item composer offers the whole roster,** not agenda members (`WeeklyUpdate/AgendaBlock.tsx:100-102`).

**Task templates and backup**

45. **A permit added to an existing project gets no template tasks.** `bp_update_project_with_permits`, `fix_382:265-283`.
46. **Task Templates copy says Base applies "where no specific override exists".** Base rows are always applied alongside jurisdiction rows (`AdminPermitsTab.tsx:40-41` vs `Step4TaskReview.tsx:55`, `fix_244:294`).
47. **The backup omits `target_submit_formulas` and `permit_type_defaults`** (`lib/exportBackup.ts:13-29`).

---

## 2 · One thing, two homes

| the thing | home A | home B (and more) | state on prod |
|---|---|---|---|
| **Per-type schedule facts** | Permits → Target-submit formulas (`target_submit_formulas`: when we submit) | Schedule → Permit-type defaults (`permit_type_defaults`: intake→approval, c1 resubmit) · Permits → Permit Types (`permit_types`: the names) · code tables (§1, gaps 3, 7) | 15 / 15 / 18 rows; PPR, Vault and WAC have no defaults row. `AdminPermitsTab.tsx:56-77` already notes the split |
| **Learning window** | Schedule → Learning windows | Lists & Catalogs → Jurisdictions (per-row input) | same column `jurisdictions.learn_window_days`; read by nothing (§1, gap 1) |
| **Jurisdiction names** | table `jurisdictions` (Lists & Catalogs) | `app_config.jurisdictions` (no editor; read by the Library juris editor) | **19 vs 8 names** — the table has 11 cities the AC list lacks |
| **Permit-type names** | table `permit_types` (Permits) | `app_config.permitTypes` (no editor, no reader) | 18 vs 7; the 7 are a subset |
| **Permit-type descriptions** | `app_config.permitTypeDescriptions` (Permit Types editor writes here) | `permit_types.notes` column (the editor writes `null`, `PermitTypeEditor.tsx:94`) | 14 descriptions in AC |
| **DM → DA grouping** | Team Structure (`dm_da_groups`) | Draw Schedule Layout (`draw_schedule_quarter_layout.group_label`, per quarter, free text) · `app_config.dmDaGroups` (stale) | `TeamStructureEditor.tsx:29-56` records that the two disagreed |
| **Who is on the team** | `team_members` (all Team pill lists) | `app_config.das` / `dms` / `entLeads` / `acqLeads` / `formerDas` — **no reader in `src/`**; only two legacy RPCs (`bp_replace_app_config_and_roster`, `bp_finalize_app_config_extras`) that nothing calls | **drifted**: DA — `team_members` has Jade, AC does not · DM — Gena missing from AC · ACQ — AC has Caleb, Darin; `team_members` has Jason · ENT — match |
| **"On the team" for a DA** | `active` / `former` | Active Quarters range · quarter layout membership | three facts that can disagree |
| **A permit's permitting lead** | Team → Permits with no permitting lead | Project Details, wizard, the DA-routing cascade | four write paths, one column (`permits.ent_lead`) |
| **Waiting On vocabulary** | `app_config.waitingOnOptions` (Permits → Waiting On; key unset on prod) | `WAITING_ON_OPTIONS` constant (`database.types.ts:1052`) · `lib/consultants.ts:396` `FIXED_DISCIPLINES` · type union | 3 lists; see §1, gaps 10–12 |
| **Consultant disciplines** | External Team Directory (constant-keyed) | `app_config.consultantTypes` (3 entries, stale, no reader) | — |
| **Your picture** | Account | Team → Names and emails → person dialog | deliberate; same storage |
| **Email** | `team_members.email` (Names and emails) | `auth.users` / `profiles` (login) | Add person sets both; afterwards they are separate |

**Other `app_config` keys with no reader in `src/`:** `dmOrder`, `quarterTeams`, `wizQuestions`, `permitOrder`, `nextId`, `_ulsMigrated`, `learnThresholds` (`{}`). `design_guidance_task_enabled_at` is not referenced anywhere in this repo (`src/` or `migrations/`); whatever reads it lives elsewhere and was not checked. `vendorReportRecipients` **is** read (`VendorScheduleForecastReport.tsx:200`), but no Settings block edits it. `lib/vendorReportEmail.ts:83` says "Settings → Reporting holds" it, and that tab no longer exists (fix-367).

---

## 3 · Blocks that are not settings

These read out or diagnose; they do not configure. Listed, not moved.

| tab | block | what it is |
|---|---|---|
| Account | Sign-in info | who you are, signed in as which role |
| Account | DB tools | export (and a stub import) |
| Team | Who the work data means | diagnostic: names in project data that map to no login |
| Team | Who is running what | diagnostic: which app build each person last ran |
| Team | Permits with no permitting lead | worklist: permits missing `ent_lead`, with a per-row fixer (writes permit data, not a setting) |
| Team | Inactive (other roles) | display only; no control |
| Lists & Catalogs | Permit Owner | a list plus usage counts with no consumer (§1, gap 17) |
| Permits | Phase Durations | history read-out; "nothing here is editable and nothing here feeds a date" (its own copy) |

`Departments` is a real setting with **no consumer** (§1, gap 23), so it appears in the census rather than here.

---

*Document only. No app code, no migration, no production data changed.*
