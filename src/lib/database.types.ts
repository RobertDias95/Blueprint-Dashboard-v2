// Q2: Hand-typed row shapes for the tables v2 reads. Narrow on purpose —
// we type the columns the read paths actually consume. Write paths in Q3+
// will tighten unknown[] payloads to typed mutation inputs.
//
// Field names mirror the Supabase schema exactly (snake_case). UI helpers
// translate to camelCase where useful, but the wire format stays canonical.

export type Stage = 'de' | 'pm' | 'co' | 'ap' | 'is';

/** fix-22: per-unit-type sub-row stored as jsonb on projects.unit_types.
 *  Wizard's UnitTypesEditor reads/writes this shape. */
export interface UnitType {
  label: string;
  width_ft: number | null;
  depth_ft: number | null;
  qty: number;
}

export interface Project {
  id: string;
  address: string;
  juris: string | null;
  archived: boolean;
  notes: string | null;
  /** Q9.5.f-fix-10: ACQ Lead name on the project. 38/43 production rows
   *  have a value (Jake / Bobby / etc.). The hand-typed Project shape had
   *  missed this column — the projects table has had it since Q5.5. */
  acq_lead?: string | null;
  /** Q9.5.e-fix-3: JSONB map of consultant type → firm name. Shape:
   * `{ Civil: 'Facet', Surveyor: 'Emerald' }`. Empty object when unset. */
  external_team?: Record<string, string> | null;
  /** Q9.5.e-fix-3: FK to builders.id. Null when no builder/owner on file. */
  builder_id?: string | null;
  /** Q9.5.e-fix-3: JSONB array of permit ids in display order. v1 parity for
   * the permits sidebar drag-reorder feature (fix-4 wires the UI). */
  permit_order?: number[] | null;
  /** fix-22 Migration 1: NEW project-level role defaults. Wizard Step 1
   *  collects them; Step 3 uses them as per-permit defaults. Bobby's
   *  PAR/SDOT/ECA routing pattern is preserved on permits.ent_lead. */
  entitlement_lead?: string | null;
  design_manager?: string | null;
  /** fix-22 Migration 1+2: physical/scheduling fields moved from permits
   *  → projects as the single source of truth. Backfilled from each
   *  project's Building Permit; conflicts recorded in audit_log. */
  go_date?: string | null;
  units?: number | null;
  zone?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  unit_types?: UnitType[] | null;
  parking_type?: string | null;
  parking_stalls?: number | null;
  alley?: string | null;
  product_type?: string | null;
  project_tags?: string[] | null;
  /** fix-22-final Migration 6: builder/owner contact fields. v1 stored
   *  these inside a `builder: {name, company, email, phone}` object;
   *  v2 promotes them to flat columns so the matrix view + reports can
   *  read them without a JSONB lookup. */
  builder_name?: string | null;
  builder_company?: string | null;
  builder_email?: string | null;
  builder_phone?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Q9.5.e-fix-3: builders table row. Used by the Project Detail Builder/Owner
 * cell + the new-project wizard's builder picker. */
export interface Builder {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean | null;
}

/** Q9.5.e-fix-3: project_documents row. updated_at added by fix-3 migration
 * for row-level OCC via bp_upsert_project_document_row. */
export interface ProjectDocument {
  id: string;
  project_id: string;
  name: string;
  url: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  updated_at: string;
}

export interface PermitCycle {
  /** Q4: cycle id is now a uuid (verified via list_tables). Earlier draft had it
   * typed as number — that was wrong; the schema has used gen_random_uuid()
   * since the table was created. Fixed now that Q4 RPCs need it for OCC. */
  id: string;
  permit_id: number;
  cycle_index: number;
  submitted: string | null;
  city_target: string | null;
  corr_issued: string | null;
  resubmitted: string | null;
  intake_accepted: string | null;
  /** fix-30: per-cycle verification timestamp for intake_accepted. NULL
   *  means scraper observed but team hasn't manually verified yet.
   *  Populated by backfill (= cycle's updated_at) for all pre-existing
   *  intake_accepted values. Future writes via fix-30b's verify RPC
   *  will stamp NOW() when the team marks intake as verified. Until
   *  fix-30b ships, this column is read-only from v2's perspective —
   *  consumers can display it but don't write it. */
  intake_accepted_verified_at?: string | null;
  /** Q4 Migration 2 added these. Required for row-level OCC. */
  created_at: string;
  updated_at: string;
}

// fix-31: per-reviewer status captured by the scraper from the Accela
// workflow timeline. Each row is one reviewer's most-recent status on
// a given (permit, cycle) pair. The scraper upserts via
// bp_upsert_permit_cycle_reviewer; the dashboard fetches all rows for
// the active tenant via PostgREST SELECT (RLS auto-scopes).
export type ReviewerStatus =
  | 'approved'
  | 'corrections_required'
  | 'in_process'
  | 'in_review'
  | 'assigned'
  | 'pending'
  | 'not_required';

export interface PermitCycleReviewer {
  id: string;
  tenant_id: string;
  permit_id: number;
  cycle_index: number;
  reviewer_name: string;
  /** "Land Use", "Plan Review", etc. when the adapter knows it; null when
   *  the adapter can only see the reviewer's name without their role. */
  discipline: string | null;
  current_status: ReviewerStatus;
  last_event_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Permit {
  id: number;
  project_id: string;
  type: string | null;
  stage: string | null;
  stage_override: string | null;
  status: string | null;
  num: string | null;
  da: string | null;
  dm: string | null;
  /** Per-permit ENT override. Kept on permits intentionally (Bobby's
   *  PAR/SDOT/ECA routing pattern). projects.entitlement_lead carries the
   *  project-level default; this field overrides per permit. */
  ent_lead: string | null;
  dual_da: string | null;
  target_submit: string | null;
  dd_start: string | null;
  dd_end: string | null;
  expected_issue: string | null;
  actual_issue: string | null;
  approval_date: string | null;
  intake_date: string | null;
  notes: string | null;
  cycle_model: string | null;
  view_cycle: number | null;
  kickoff_date: string | null;
  corr_rounds: number | null;
  permit_owner: string | null;
  /** External design firm — kept per-permit (different permits at the
   *  same project can have different architects). */
  architect: string | null;
  nickname: string | null;
  struct_address: string | null;
  portal_url: string | null;
  /** Q9.5.f-fix-16 B: JSONB bag for per-permit ad-hoc settings. Currently
   *  used for `scheduleCycleOverride` (manual +/- on ScheduleEstimator). */
  extras?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  // fix-22 Migration 3 (pending): the following 15 fields moved from
  // permits → projects. The Permit interface intentionally NO LONGER
  // declares them so the compiler surfaces every site that needs to
  // read from the project instead. Removed:
  //   zone, alley, lot_width, lot_depth, units, unit_types,
  //   parking_type, parking_stalls, product_type, project_tags, go_date,
  //   builder_name, builder_company, builder_email, builder_phone
  // Read them via Project. ent_lead, dm, da, dual_da, architect,
  // kickoff_date STAY on Permit per spec.
}

/** Permit with cycles attached via Supabase nested select. */
export interface PermitWithCycles extends Permit {
  permit_cycles: PermitCycle[];
}

export interface PermitTask {
  /** uuid, gen_random_uuid */
  id: string;
  permit_id: number;
  /** NOT NULL — one of 'de' | 'pm' | 'co' (or extended buckets). */
  bucket: string;
  legacy_id: string | null;
  /** NOT NULL on the schema. */
  text: string;
  cat: string | null;
  is_jurisdiction_specific: boolean;
  start_date: string | null;
  due_date: string | null;
  target_date: string | null;
  /** Defaults to 'Open'. */
  completion_status: string;
  done: boolean;
  assigned_to: string | null;
  /** Defaults to 'de'. */
  stage: string;
  is_auto_generated: boolean;
  city_acceptance_check: boolean;
  cycle_idx: number | null;
  /** Defaults to 0. */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DrawScheduleRow {
  project_id: string;
  da_assigned: string | null;
  start_week: string | null;
  end_week: string | null;
  status: string | null;
  /** Q9.5.g: true when the user picked a status from the block popup
   *  (suppresses dsAutoStatus auto-override). Defaults to false. The hand-
   *  typed declaration previously had this as `string | null` — wrong; the
   *  DB column is boolean. Caught while wiring the status popup. */
  manual_status: boolean | null;
  manually_placed: boolean | null;
  dd_start: string | null;
  dd_end: string | null;
  notes: string | null;
  color_override: string | null;
  status_override: string | null;
  /** Q5.5.C: required for row-level OCC on the draw_schedule write path. */
  updated_at: string;
}

/** Q6.2.c: DA non-project blocks (vacation, training, redesign, etc.).
 * Rendered as grey overlays in DA columns. v2 client treats them as
 * read-only — admin editing is Q7+. */
export interface DaTimeBlock {
  id: string;
  da_name: string;
  /** v1 set: Vacation | Training | Redesign | Corrections | Other. */
  type: string;
  /** Human label; usually the same as `type` but can be more specific
   * (e.g., "Style Guide", "Cancelled Project (9022 36th Ave SW)"). */
  label: string | null;
  start_week: string;
  end_week: string;
  created_at?: string | null;
  /** Q7.3.0 added — used for row-level OCC by Q6.2.f edit flow. */
  updated_at: string;
}

/** Q6.3.b: corrected against information_schema. Earlier draft carried five
 * fields (juris, applicant, status, notes, raw) that never existed in the
 * DB — runtime worked because useIntakeRecords did `select('*')`, but the
 * typed shape was misleading. Worth a fuller audit pass at Q7+ for other
 * interfaces that may have drifted similarly. */
// Q7.3.c — task_templates + subtasks.

export type TemplateBucket = 'de' | 'pm' | 'co';

/** Tenant-scoped. jurisdiction=NULL means the template applies to ALL
 * jurisdictions (the "base" set in v1's mental model). Sorted by
 * sort_order; ties broken by text. */
export interface TaskTemplate {
  id: string;
  permit_type: string;
  jurisdiction: string | null;
  bucket: TemplateBucket;
  text: string;
  default_assignee: string | null;
  default_target_offset: number | null;
  cat: string | null;
  sort_order: number | null;
  updated_at: string;
}

/** Subtask under a task_template. FK CASCADE on template delete. */
export interface TaskTemplateSubtask {
  id: string;
  template_id: string;
  text: string;
  sort_order: number | null;
  updated_at: string;
}

// Q7.3.b — team_members + dm_da_groups.

/** Schema enforces `role` as text (no CHECK constraint). Audit shows both
 *  legacy + lead variants live (`ent` + `ent_lead`, `acq` + `acq_lead`).
 *  Listed as fix-23 cleanup; fix-22's wizard filters use `role IN (...)`
 *  forms to bridge the drift. */
export type TeamRole =
  | 'da'
  | 'dm'
  | 'ent'
  | 'ent_lead'
  | 'acq'
  | 'acq_lead';

/** Tenant-scoped roster. `active` flags currently-working members;
 * `former` flags DAs (and only DAs in v1's UX) who used to be on the
 * draw schedule and may still be referenced by historical permits. */
export interface TeamMember {
  id: string;
  name: string;
  role: TeamRole;
  active: boolean | null;
  former: boolean | null;
  email: string | null;
  notes: string | null;
  /** Q7.3.0 added — used for row-level OCC. */
  updated_at: string;
  /** fix-25-feat-b: per-quarter activity range. NULL on either side means
   *  open-ended (NULL start = always-active-from-beginning, NULL end =
   *  still-active). Storage format is 'YYYY-Qn' so lexical compare =
   *  chronological compare. */
  active_start_quarter: string | null;
  active_end_quarter: string | null;
}

/** Flat (dm_name, da_name) pair table. Q7.3.0 added updated_at for OCC. */
export interface DmDaGroupRow {
  id: string;
  dm_name: string;
  da_name: string;
  updated_at: string;
}

// Q7.3.a — admin catalog types.

/** Global catalog. PK=name; legacy `profiles.role='admin'` write gate.
 * `learn_window_days` per-juris override for Q7.2 schedule-benchmark learner. */
export interface Jurisdiction {
  name: string;
  learn_window_days: number | null;
  notes: string | null;
}

/** Global catalog of permit types ("Building Permit", "PAR/Pre-Sub", etc.).
 * `is_builtin` marks the v1 hardcoded types we ship with by default. */
export interface PermitType {
  name: string;
  is_builtin: boolean | null;
  notes: string | null;
}

/** fix-25-feat-Z: tenant-scoped per-type default overrides for the
 *  schedule estimator. PK = (tenant_id, type). intake_to_approval_days
 *  required; c1_resub_offset_days optional (NULL → falls through to
 *  intake_to_approval / 3 in the SQL learner). */
export interface PermitTypeDefault {
  type: string;
  intake_to_approval_days: number;
  c1_resub_offset_days: number | null;
  updated_at: string;
}

/** fix-22 Migration 4: per-juris permit usage stats from the
 *  juris_permit_stats matview, surfaced via bp_get_juris_permit_stats RPC.
 *  `usage_pct_display` is NULL when total_projects_in_juris < 5 (hide %). */
export interface JurisPermitStat {
  permit_type: string;
  projects_with_this_permit: number;
  total_projects_in_juris: number;
  usage_fraction: number;
  usage_pct_display: number | null;
}

/** Tenant-scoped JSONB key/value store. `productTypes`, `projectTagOptions`,
 * `consultantTypes`, `wizQuestions`, etc. all live here under their own key.
 * v2 writes via the single-key bp_set_app_config_key RPC. */
export interface AppConfigEntry {
  key: string;
  value: unknown;
  updated_at: string | null;
}

// fix-27: notification center activity feed. Shape mirrors the
// bp_fetch_scraper_activity RPC return (audit_log enriched with the
// joined permit + project).
export type ScraperActivityAction =
  | 'scrape_change_applied'
  | 'scrape_cycle_change_applied'
  | 'scrape_skipped_recent_manual_edit'
  | 'scrape_cycle_skipped_recent_manual_edit'
  | 'scrape_cycle_disagreement'
  | 'scrape_skipped'
  | 'manual_admin_correction'
  | string; // permissive — new audit actions render as generic

/** The `changes` jsonb is one of several shapes depending on action.
 *  Components must treat unknown keys gracefully. */
export interface ScraperActivityChanges {
  db?: Record<string, unknown> | null;
  observed?: Record<string, unknown> | null;
  applied?: Record<string, unknown> | null;
  disagreement?: Record<string, { db: unknown; observed: unknown }> | null;
  reason?: string | null;
  source?: string | null;
  scraper_run_at?: string | null;
  // manual_admin_correction
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ScraperActivityRow {
  id: number;
  created_at: string;
  action: ScraperActivityAction;
  row_id: string | null;
  changes: ScraperActivityChanges;
  permit_num: string | null;
  permit_type: string | null;
  address: string | null;
  juris: string | null;
  /** Populated when action is a cycle event; null otherwise. */
  cycle_index: number | null;
  /** fix-28: entitlement lead from permits.ent_lead. Drives the
   *  Activity page's per-lead filter (Bobby / Briana / Miles). */
  ent_lead: string | null;
  /** fix-61: city portal deep-link from permits.portal_url. ~79%
   *  populated in prod (160/202 permits). Frontend renders the permit
   *  number as an external link only when this is non-empty. */
  portal_url: string | null;
  /** fix-61: project uuid from permits.project_id, used by the
   *  Activity page's "Open Project" group header button. Reaches NULL
   *  only when the audit_log row_id doesn't resolve to a permit (LEFT
   *  JOIN miss); the button is hidden in that case. */
  project_id: string | null;
}

export interface IntakeRecord {
  id: number;
  /** FK to projects(id); nullable in DB (intakes can exist before a project is wired up). */
  project_id: string | null;
  /** FK to permits(id); nullable in DB. Drives the "Submitted" status badge
   * by looking at the linked permit's cycles. */
  permit_id: number | null;
  address: string | null;
  permit_num: string | null;
  /** "Building Permit" or "Demolition" per v1 conventions. */
  permit_type: string | null;
  intake_date: string | null;
  is_placeholder: boolean | null;
  /** City portal URL — makes the permit# clickable. Editor lands in Q7.3. */
  portal_url: string | null;
  /** Legacy duplicate of portal_url in some rows; prefer portal_url at read time. */
  link: string | null;
  created_at?: string | null;
  updated_at: string;
}

// ===========================================================
// fix-67: Weekly DA Update report (Reports hub Phase 1).
// ===========================================================

/** One persistent free-text note per permit. The note IS the
 *  carry-forward: it shows whenever the permit appears in the report and
 *  is edited in place. Backed by public.report_notes (one row per
 *  permit_id). */
export interface ReportNote {
  permit_id: number;
  tenant_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** A single permit row in either report section. Corrections rows carry
 *  `corr_issued`; upcoming-intake rows carry `target_submit`. Both share
 *  the rest of the shape. Shapes match the jsonb the
 *  bp_get_weekly_da_report RPC emits. */
export interface WeeklyDaReportRow {
  permit_id: number;
  project_id: string;
  address: string | null;
  juris: string | null;
  type: string | null;
  num: string | null;
  portal_url: string | null;
  cycle_index: number | null;
  ent_lead: string | null;
  da: string | null;
  /** The persistent note for this permit ('' when none). */
  note_body: string;
  /** Present on corrections rows: latest cycle's corr_issued date. */
  corr_issued?: string | null;
  /** Present on upcoming-intake rows: the permit's target_submit date. */
  target_submit?: string | null;
}

/** One DA's section of the report. `da` is the grouping key
 *  (COALESCE(permits.da,'Unassigned')); `name` mirrors it for display. */
export interface WeeklyDaReportGroup {
  da: string;
  name: string;
  corrections: WeeklyDaReportRow[];
  upcoming_intakes: WeeklyDaReportRow[];
}

/** Full payload returned by bp_get_weekly_da_report. */
export interface WeeklyDaReportPayload {
  das: WeeklyDaReportGroup[];
  generated_at: string;
  week_start: string;
  window_days: number;
}

/** Optional filters accepted by bp_get_weekly_da_report (p_filters jsonb).
 *  All keys optional; omitted/empty means "no filter on that field". */
export interface WeeklyDaReportFilters {
  ent_lead?: string;
  type?: string;
  status?: string;
  juris?: string;
  da?: string;
}

// ===========================================================
// fix-68: Reports hub Phase 2 — Settings -> Reporting.
// ===========================================================

/** A folder in the saved-reports tree. parent_id null = a root category.
 *  Backed by public.report_categories. */
export interface ReportCategory {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
}

/** A saved report entry. `kind='builtin'` rows render a hard-coded
 *  component looked up by `builtin_key` (e.g. 'weekly_da_update');
 *  `kind='custom'` rows (Phase 3) render from `spec`. Backed by
 *  public.saved_reports. The hub payload omits spec (P2 doesn't need it
 *  client-side); add it here if a future phase reads it. */
export interface SavedReport {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  kind: 'builtin' | 'custom';
  builtin_key: string | null;
  position: number;
}

/** Return shape of bp_list_report_hub: the full category tree + every
 *  saved report for the caller's tenant. */
export interface ReportHubPayload {
  categories: ReportCategory[];
  reports: SavedReport[];
}

// ===========================================================
// fix-69: Report builder (Reports hub Phase 3).
// ===========================================================

export type ReportColumnType =
  | 'text'
  | 'date'
  | 'number'
  | 'boolean'
  | 'enum';

export type ReportOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts_with'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

/** One selectable/filterable column in the builder catalog. `key` is the
 *  dotted path used in the saved spec (e.g. 'num', 'project.address').
 *  `operators` is the type-derived whitelist the runtime also enforces. */
export interface ReportBuilderColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  filterable: boolean;
  operators: ReportOperator[];
  source: 'direct' | 'parent.projects' | 'parent.permits';
  /** Present only for enum columns. */
  values?: string[];
}

export interface ReportBuilderEntity {
  key: string;
  label: string;
  columns: ReportBuilderColumn[];
  default_sort: { column: string; dir: 'asc' | 'desc' };
}

/** Return shape of bp_get_report_builder_catalog — the single source of
 *  truth the builder UI consumes and the runtime validates against. */
export interface ReportBuilderCatalog {
  version: number;
  entities: ReportBuilderEntity[];
}

/** One AND-combined filter in a saved spec. `value` is a scalar for most
 *  ops, an array for in/not_in, and absent for is_null/is_not_null. */
export interface ReportSpecFilter {
  column: string;
  op: ReportOperator;
  value?: string | number | boolean | Array<string | number> | null;
}

export interface ReportSpecSort {
  column: string;
  dir: 'asc' | 'desc';
}

/** The saved report definition, stored in saved_reports.spec (kind='custom').
 *  Validated server-side against the catalog on every run/preview/save. */
export interface ReportSpec {
  version: number;
  entity: string;
  columns: string[];
  filters: ReportSpecFilter[];
  sort: ReportSpecSort[];
  limit: number;
}

/** Runtime payload from bp_run_saved_report / bp_preview_report_spec. Each
 *  row is a flat object keyed by the spec's column keys. */
export interface CustomReportResult {
  rows: Array<Record<string, unknown>>;
  row_count: number;
  executed_at: string;
  spec_version: number;
}

/** Full saved-report row incl. spec (bp_get_saved_report) — used by the
 *  viewer's Edit + the builder's edit mode. */
export interface SavedReportDetail {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  kind: 'builtin' | 'custom';
  builtin_key: string | null;
  spec: ReportSpec;
  position: number;
}
