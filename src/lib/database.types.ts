// Q2: Hand-typed row shapes for the tables v2 reads. Narrow on purpose —
// we type the columns the read paths actually consume. Write paths in Q3+
// will tighten unknown[] payloads to typed mutation inputs.
//
// Field names mirror the Supabase schema exactly (snake_case). UI helpers
// translate to camelCase where useful, but the wire format stays canonical.

export type Stage = 'de' | 'pm' | 'co' | 'ap' | 'is';

export interface Project {
  id: string;
  address: string;
  juris: string | null;
  archived: boolean;
  notes: string | null;
  /** Q9.5.e-fix-3: JSONB map of consultant type → firm name. Shape:
   * `{ Civil: 'Facet', Surveyor: 'Emerald' }`. Empty object when unset. */
  external_team?: Record<string, string> | null;
  /** Q9.5.e-fix-3: FK to builders.id. Null when no builder/owner on file. */
  builder_id?: string | null;
  /** Q9.5.e-fix-3: JSONB array of permit ids in display order. v1 parity for
   * the permits sidebar drag-reorder feature (fix-4 wires the UI). */
  permit_order?: number[] | null;
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
  /** Q4 Migration 2 added these. Required for row-level OCC. */
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
  ent_lead: string | null;
  dual_da: string | null;
  go_date: string | null;
  target_submit: string | null;
  dd_start: string | null;
  dd_end: string | null;
  expected_issue: string | null;
  actual_issue: string | null;
  approval_date: string | null;
  intake_date: string | null;
  units: number | null;
  notes: string | null;
  cycle_model: string | null;
  view_cycle: number | null;
  kickoff_date: string | null;
  zone: string | null;
  product_type: string | null;
  project_tags: unknown;
  unit_types: unknown;
  parking_type: string | null;
  parking_stalls: number | null;
  /** Q6.3.a: dim columns used by the Library matrix view. Optional because
   * existing test fixtures + narrow read paths don't always carry them;
   * the matrix view selects them explicitly. */
  lot_width?: number | null;
  lot_depth?: number | null;
  alley?: string | null;
  corr_rounds: number | null;
  permit_owner: string | null;
  architect: string | null;
  nickname: string | null;
  struct_address: string | null;
  portal_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  manual_status: string | null;
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

export type TeamRole = 'da' | 'dm' | 'ent' | 'acq';

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

/** Tenant-scoped JSONB key/value store. `productTypes`, `projectTagOptions`,
 * `consultantTypes`, `wizQuestions`, etc. all live here under their own key.
 * v2 writes via the single-key bp_set_app_config_key RPC. */
export interface AppConfigEntry {
  key: string;
  value: unknown;
  updated_at: string | null;
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
