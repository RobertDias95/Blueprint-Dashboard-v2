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
  /** fix-205: stories for this unit-type structure (1–4+). Optional — older
   *  rows predate the field. Stored in the same projects.unit_types JSONB
   *  array (no migration). null/absent = not entered ("—"). */
  stories?: number | null;
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
  /** fix-222: the project's Schematic Designer(s), sourced from the Schematic
   *  Team roster in the New Project wizard. Persisted as text[] (single now,
   *  multiple allowed). 'Schematic Team' template tasks + the "Schematic
   *  Designer" co-assignee token route to these names. */
  schematic_designer?: string[] | null;
  /** fix-22 Migration 1+2: physical/scheduling fields moved from permits
   *  → projects as the single source of truth. Backfilled from each
   *  project's Building Permit; conflicts recorded in audit_log. */
  go_date?: string | null;
  units?: number | null;
  /** fix-122: count of distinct LOTS (e.g. a 5-lot subdivision). Distinct
   *  from `units` (a 5-lot subdivision could yield 20 units; a 1-lot
   *  4-plex has 1 lot + 4 units). Positive integer or null; check
   *  constraint `num_lots_positive` rejects 0. */
  num_lots?: number | null;
  /** fix-122: corner-lot flag. Same dimensions feel very different on a
   *  corner because unit/parking layout options change — used by the
   *  Library so a 50x100 corner is comparable apples-to-apples to a
   *  50x100 mid-block. */
  is_corner_lot?: boolean | null;
  /** fix-122: closing/escrow date. Informational only — surfaces "we
   *  have permits but builder won't issue until closing." No math, no
   *  cascades, no alerts. */
  closing_date?: string | null;
  zone?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  unit_types?: UnitType[] | null;
  parking_type?: string | null;
  parking_stalls?: number | null;
  alley?: string | null;
  /** fix-91: was a single text column, now an array. A single site can
   *  legitimately carry multiple product types (SFR + Attached Units +
   *  Cottages). Always present as an array (NOT NULL DEFAULT '{}'); empty
   *  means "none selected". */
  product_types?: string[] | null;
  project_tags?: string[] | null;
  /** fix-22-final Migration 6: builder/owner contact fields. v1 stored
   *  these inside a `builder: {name, company, email, phone}` object;
   *  v2 promotes them to flat columns so the matrix view + reports can
   *  read them without a JSONB lookup. */
  builder_name?: string | null;
  builder_company?: string | null;
  builder_email?: string | null;
  builder_phone?: string | null;
  /** fix-175: owner LLC address. Denormalized display cache of the builder
   *  entity's address (canonical copy lives on builders.address), mirroring
   *  the builder_name/company/email/phone pattern so the Overview cell can
   *  read/write it via the plain projects UPDATE path. */
  builder_address?: string | null;
  /** fix-175: per-project point-of-contact. Unlike the builder entity fields
   *  these are NOT promoted to the builders catalog — the contact can differ
   *  deal-to-deal, so they live only on the project. */
  poc_name?: string | null;
  poc_email?: string | null;
  /** fix-126: redesign concept. When set, this project is a redesign
   *  of the referenced parent project. Site facts (address, lot, juris)
   *  are shared by convention; the redesign carries its own copies of
   *  those columns but the original remains canonical for the parcel.
   *  NULL = standalone project (not a redesign). FK enforced. */
  redesign_of_project_id?: string | null;
  /** fix-126: why this redesign exists. Controlled vocab via the DB-side
   *  redesign_trigger_vocab CHECK constraint; the UI exposes 8 values
   *  with display labels in REDESIGN_TRIGGER_LABELS (see helpers). NULL
   *  permitted at insert (wizard may patch later). */
  redesign_trigger?: RedesignTrigger | null;
  /** fix-126: when true the redesign is metadata only — no permits get
   *  created on submit (draw schedule block + project row only). When
   *  false (or null) the redesign gets its own permit set, same as a
   *  new project. */
  redesign_reuses_original_permit?: boolean | null;
  /** fix-126: free-form context on the redesign (what changed, who
   *  decided, market signal, etc.). */
  redesign_notes?: string | null;
  /** fix-216: REUSE provenance. When set, this NEW project was templated off a
   *  DIFFERENT existing project — its product_types + unit_types were COPIED
   *  ONCE from that source at creation (or via Settings). This is a copy-once
   *  link, NOT a live mirror: the project owns its own values afterward and
   *  manual edits always win. Distinct from redesign_of_project_id (a new
   *  version of the SAME project). Live on prod (self-FK ON DELETE SET NULL;
   *  CHECK id <> reused_from_project_id; indexed). Optional `?` to match every
   *  other nullable Project column here (Project literals in fixtures omit it);
   *  the value is `string | null` at runtime. */
  reused_from_project_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** fix-167: a project On-Hold interval. A project may have many holds over
 *  time (history); the ACTIVE hold is the one with `hold_end === null`, and
 *  there is at most one active hold per project (DB partial unique index).
 *  Phase 1 records + displays these; they change NO calculations (Phase 2
 *  wires the clock/projection math). `reason` references the editable
 *  app_config `holdReasonOptions` list. Dates are ISO 'YYYY-MM-DD'. */
export interface ProjectHold {
  id: string;
  tenant_id: string;
  project_id: string;
  reason: string;
  note: string | null;
  hold_start: string;
  hold_end: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** fix-126: controlled-vocab union for projects.redesign_trigger. Mirrors
 *  the DB-side CHECK constraint. Keep in sync with the migration. */
export type RedesignTrigger =
  | 'builder'
  | 'ceo'
  | 'acquisitions'
  | 'design_mgmt'
  | 'design_associate'
  | 'city_correction'
  | 'market'
  | 'other';

/** fix-126: display labels for the 8 trigger values. Wizard <select> +
 *  Project Overview "Redesigns (N)" section render these instead of the
 *  raw enum values. */
export const REDESIGN_TRIGGER_LABELS: Record<RedesignTrigger, string> = {
  builder: 'Builder',
  ceo: 'CEO',
  acquisitions: 'Acquisitions',
  design_mgmt: 'Design Mgmt',
  design_associate: 'Design Associate',
  city_correction: 'City Correction',
  market: 'Market',
  other: 'Other',
};

/** Q9.5.e-fix-3: builders table row. Used by the Project Detail Builder/Owner
 * cell + the new-project wizard's builder picker. */
export interface Builder {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** fix-175: owner LLC address on the builder entity. Travels across that
   *  owner's projects via autofill-on-pick. */
  address: string | null;
  notes: string | null;
  active: boolean | null;
}

/** fix-227: one firm in the central External Team directory — a master list of
 *  consultant firms by discipline that POPULATES the per-project external-team
 *  picker's dropdown. The per-project blob (projects.external_team) stays the
 *  source of truth; this only supplies reusable options. `discipline` uses the
 *  canonical WAITING_ON_OPTIONS vocab (e.g. "Surveyor"). */
export interface ExternalTeamDirectoryFirm {
  id: string;
  discipline: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

/** fix-notes-1: unified notes row as returned by bp_list_project_notes
 * (author_name resolved server-side — profiles RLS is read-own-only).
 * permit_id NULL = holistic project note; set = per-permit note. */
export interface Note {
  id: string;
  project_id: string;
  permit_id: number | null;
  body: string;
  completed: boolean;
  completed_at: string | null;
  created_by: string | null;
  author_name: string | null;
  created_at: string;
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
  /** fix-194: sub/child-permit marker. When set, this permit is a placeholder
   *  reviewed under the referenced sibling permit (SAME project — enforced
   *  app-side; the marker UI only offers same-project permits). A child carries
   *  no independent review stage/status and is excluded from every dashboard
   *  metric/rollup via isSubPermit() (src/lib/subPermit.ts). The scraper still
   *  scrapes it normally; its scraped cycles/reviewers are simply ignored.
   *  NULL = standalone / parent permit. */
  parent_permit_id?: number | null;
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
  /** fix-169: land-use (LU) middle-phase milestones — set only on Seattle
   *  land-use records (*-LU: ULS/LBA/short-plat); NULL on every other permit.
   *  The land-use phase deriver (src/lib/landUsePhase.ts) reads these to drive
   *  the phase badge. Populated by the scraper (fix-78); NULL until then.
   *  ISO 'YYYY-MM-DD'. */
  design_review_date?: string | null;
  decision_published_date?: string | null;
  publication_end_date?: string | null;
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
  //   parking_type, parking_stalls, product_types, project_tags, go_date,
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
  /** NOT NULL. fix-79 collapses to two lifecycle PHASES: 'de' (Design &
   *  Engineering) and 'pm' (Permitting). Legacy 'co' rows were migrated into
   *  'pm'. Kept as `string` (rather than a union) so existing fixtures + raw
   *  SELECT shapes stay valid; the strict union lives on TaskNode below. */
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
  // fix-70 (v1-parity tasks). The discipline bucket drives the DERIVED primary
  // assignee (arch -> permits.da, ent -> permits.ent_lead); parent_task_id
  // gives single-level subtasks; done_at auto-stamps when completion_status
  // becomes 'Resolved'. Optional on the hand-typed interface so existing
  // fixtures/literals stay valid; the new task UI consumes the TaskNode RPC
  // shape (where these are required) rather than the raw PermitTask row.
  /** 'arch' | 'ent' — the discipline bucket. Null only on un-backfilled rows. */
  discipline?: 'arch' | 'ent' | null;
  /** Set on subtasks; null on top-level tasks. */
  parent_task_id?: string | null;
  /** Auto-stamped by trigger when completion_status -> 'Resolved'. */
  done_at?: string | null;
  /** fix-138-a: external-blocker discipline. Vocab owned by the
   *  TypeScript layer (see WAITING_ON_OPTIONS / WaitingOnDiscipline); no
   *  DB CHECK so the team can expand the list without migrations. Null =
   *  no external block. */
  waiting_on?: WaitingOnDiscipline | null;
  /** fix-138-a: priority flag (star). Defaults to false in the DB. */
  priority?: boolean | null;
  /** fix-138-a: free-form notes shown in the task detail panel. */
  notes?: string | null;
}

/** fix-138-a: controlled vocab for permit_tasks.waiting_on. Lives in TS
 *  (no DB CHECK) so the team can extend the list without a migration
 *  cycle. Matches the same pattern as the existing free-form `cat` +
 *  `assigned_to` text columns. The fix-139 reporting view will GROUP BY
 *  this string. */
export const WAITING_ON_OPTIONS = [
  'Civil',
  // fix-190d: canonical survey term is 'Surveyor' (matches the external-team
  // blob keys the editor writes). Was 'Survey' — migrated permit_tasks.waiting_on.
  'Surveyor',
  'Structural',
  'Arborist',
  'Geotech',
  'Mechanical',
  'Electrical',
  'Plumbing',
  'Energy',
  'Stormwater',
  'Landscape',
  'Architect',
  'Other',
] as const;
/** fix-139: the canonical discipline-vocab type, lifted from
 *  WAITING_ON_OPTIONS. Used by permit_tasks.waiting_on AND the external-team
 *  blob keys (projects.external_team) so a task's external blocker discipline
 *  and a project's assigned firm discipline share one vocabulary.
 *  fix-197: the normalized consultant_firms / project_external_teams types that
 *  also used this were dropped with the registry. */
export type WaitingOnDiscipline = (typeof WAITING_ON_OPTIONS)[number];
/** @deprecated fix-139: kept as an alias for back-compat — prefer
 *  WaitingOnDiscipline. Identical type. */
export type WaitingOnOption = WaitingOnDiscipline;

/** fix-140: one row from bp_list_waiting_on_tasks — a task whose waiting_on
 *  discipline is set, joined to its permit + project + the firm assigned for
 *  that discipline on that project. firm_* are NULL when the project has no
 *  firm assigned for the discipline; firm_active is false when the assigned
 *  firm has been archived (the row still surfaces, labelled "(archived)"). */
export interface WaitingOnTaskRow {
  task_id: string;
  task_text: string;
  bucket: string;
  waiting_on: WaitingOnDiscipline;
  firm_id: string | null;
  firm_name: string | null;
  firm_active: boolean | null;
  project_id: string;
  project_address: string | null;
  project_juris: string | null;
  permit_id: number;
  permit_type: string | null;
  assigned_to: string | null;
  priority: boolean | null;
  start_date: string | null;
  due_date: string | null;
  target_date: string | null;
  completion_status: string | null;
  done: boolean | null;
  done_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A co-assignee row (explicit; the primary assignee is derived, not stored).
 *  fix-70. */
export interface PermitTaskAssignee {
  id: string;
  task_id: string;
  assignee: string;
  created_at: string;
}

/** fix-155: lifecycle events the scraper / daily sweep fire a verification
 *  task at. Mirrors permit_tasks.auto_event (NULL for human tasks). */
export type AutoEvent =
  | 'intake_submitted'
  | 'intake_accepted'
  | 'corr_issued'
  | 'resubmitted'
  | 'number_entry'
  // fix-159: fired after N consecutive scraper guard-skips with a pending
  // portal change — "portal shows X, dashboard shows Y, reconcile".
  | 'scrape_reconcile'
  // fix-181: fired when a permit reaches "results available" — issued
  // (actual_issue set) for issuance types, or approved (approval_date set) for
  // no-issuance types — so the ent lead sends out the approved plans / results.
  | 'results_ready';

/** fix-70: a task as returned by bp_list_permit_tasks / bp_my_tasks. The
 *  `status` field is the permit_tasks.completion_status value
 *  ('Open' | 'In Progress' | 'Resolved'); `primary_assignee` is DERIVED from
 *  the permit's da/ent_lead at read time; `co_assignees` are the explicit
 *  join-table rows. */
export interface TaskNode {
  id: string;
  permit_id: number;
  parent_task_id: string | null;
  discipline: 'arch' | 'ent';
  /** fix-79: lifecycle PHASE. 'de' = task created before c0.submitted (Design
   *  & Engineering); 'pm' = task created after the permit was submitted to
   *  the city (Permitting / corrections). Drives the D&E/Permitting toggle
   *  on the permit detail tasks panel and the bucket filter in My Tasks. */
  bucket: 'de' | 'pm';
  text: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  start_date: string | null;
  target_date: string | null;
  /** fix-138-a: separate "due" date (different concept from target). */
  due_date?: string | null;
  done_at: string | null;
  sort_order: number;
  /** fix-138-a: explicit `assigned_to` text column. Distinct from
   *  primary_assignee (derived) and co_assignees (join table). */
  assigned_to?: string | null;
  /** fix-138-a: external party blocking this task ('Civil', 'Surveyor', …). */
  waiting_on?: WaitingOnDiscipline | null;
  /** fix-138-a: priority star. */
  priority?: boolean;
  /** fix-138-a: free-form notes. */
  notes?: string | null;
  /** fix-155: true for lifecycle auto-tasks (scraper-/sweep-generated). The
   *  team verifies these; they are never auto-completed. Drives the BOT badge
   *  and the BOT filter in My Tasks. Absent (treated as false) on older wire
   *  shapes. */
  is_auto_generated?: boolean;
  /** fix-155: which lifecycle event spawned this auto-task. null on human
   *  tasks and on pre-fix-155 wire shapes. */
  auto_event?: AutoEvent | null;
  /** Derived: arch -> permit.da, ent -> permit.ent_lead. May be null when the
   *  permit has no DA/ent_lead set. */
  primary_assignee: string | null;
  co_assignees: string[];
  /** Present on top-level tasks (from bp_list_permit_tasks); absent on
   *  subtasks and on bp_my_tasks rows. */
  subtasks?: TaskNode[];
}

/** fix-70: a row from bp_my_tasks — a task the caller is assigned to (implicit
 *  primary OR explicit co-assignee), with its project/permit context. */
export interface MyTaskNode extends TaskNode {
  project_id: string;
  project_address: string;
  permit_type: string | null;
  /** fix-224: the permit's DA — lets My Tasks resolve fix-222 co-assignee role
   *  tokens (design_associate / design_manager via dm_da_groups) for display,
   *  the same way the permit bar does. Optional: emitted by bp_list_tasks after
   *  the fix-224 migration; undefined before it lands (tokens fall back to their
   *  label). */
  permit_da?: string | null;
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
  /** fix-153: a TEAM key, not a person — 'Entitlements' / 'Architecture'
   *  (or a legacy literal name). Resolved to the specific permit's
   *  ent_lead / da at task-create time by bp_create_project_with_permits.
   *  Renamed from default_assignee. */
  default_team: string | null;
  /** fix-153: extra named co-assignees seeded onto permit_tasks.co_assignees
   *  at create time. Stored as text[]; defaults to []. May contain team_member
   *  names or free-text. */
  default_co_assignees: string[];
  /** fix-153: discipline that seeds permit_tasks.waiting_on at create time.
   *  Same controlled vocab as WAITING_ON_OPTIONS; null = no default block. */
  default_waiting_on: WaitingOnDiscipline | null;
  /** fix-223: RETIRED from the settings UI — it was unused (null on every
   *  template, no anchor, nothing computed a date from it). Dropped from the
   *  fetch select + upsert payload; the nullable column stays in place, unused.
   *  Optional to reflect it's vestigial (same treatment as `cat`). */
  default_target_offset?: number | null;
  /** fix-222: RETIRED from the settings UI — no cat label/picker is shown or
   *  edited anymore. The nullable column stays in place and is still carried
   *  verbatim through fetch/upsert so existing values persist (the create RPC
   *  still copies it onto permit_tasks.cat). Optional to reflect it's vestigial. */
  cat?: string | null;
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

// fix-154 — per-type × per-jurisdiction target_submit offset overrides.

/** One row from bp_list_target_submit_formulas. `jurisdiction` NULL is the
 *  "Base" row for the type (applies when no per-juris override exists). The
 *  offset is added to the type's in-code anchor (see anchorFor in
 *  targetSubmitLearner.ts) when the data learner has no samples. May be
 *  negative (team submits before the anchor). */
export interface TargetSubmitFormula {
  type: string;
  jurisdiction: string | null;
  offset_days: number;
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
  | 'acq_lead'
  // fix-222: Schematic Team roster — sources the New Project wizard's
  // "Schematic Designer" picker + routes 'Schematic Team' template tasks.
  | 'schematic';

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

/** fix-225: DA project handoff ledger row (project_da_handoffs). Each row = one
 *  ownership reassign of a project from `from_da` to `to_da`. Powers undo, the
 *  "shared" marker, and Phase-2 co-credit. Ownership only — the draw_schedule
 *  board block stays frozen under the original DA. */
export interface ProjectDaHandoff {
  id: string;
  project_id: string;
  from_da: string | null;
  to_da: string;
  effective_date: string | null;
  note: string | null;
  created_at: string;
}

/** Flat (dm_name, da_name) pair table. Q7.3.0 added updated_at for OCC. */
export interface DmDaGroupRow {
  id: string;
  dm_name: string;
  da_name: string;
  updated_at: string;
}

/** fix-182a: per-quarter saved Draw Schedule column layout. One row = one
 *  column, left-to-right by `position` (0..n) within a (tenant, quarter).
 *  `col_kind='da'` => a person column (da_name set); `col_kind='open'` =>
 *  placeholder lane (da_name NULL); `col_kind='dm'` (fix-190a) => a DM working a
 *  lane SOLO — no DA beneath them — with the DM's name in da_name (the lane-owner
 *  name the grid matches blocks on, like a 'da' column) and usually
 *  group_label=<DM> for a 1-wide manager header. `group_label` set => manager
 *  header spanning the contiguous run of columns sharing that label (free text —
 *  it need not be a `dm`-role member); NULL => standalone column. Frozen history:
 *  rename RPCs do NOT cascade here. Writes go through
 *  bp_upsert_quarter_layout_row / bp_delete_quarter_layout_row /
 *  bp_reorder_quarter_layout / bp_clone_quarter_layout. */
export interface DrawScheduleQuarterLayoutRow {
  id: string;
  quarter: string; // 'YYYY-Qn'
  position: number;
  col_kind: 'da' | 'open' | 'dm';
  da_name: string | null;
  group_label: string | null;
  label_override: string | null;
  /** fix-190b: top (regional/ent) tier above the DM groups — free text (e.g.
   *  "Miles, WA | Briana, AZ"). Contiguous columns sharing the same non-empty
   *  top_label form one top-tier span ACROSS DM groups. NULL/empty = no top
   *  header for this column (default; back-compat — a quarter with no top_labels
   *  renders with no top band). */
  top_label: string | null;
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
  /** fix-notes-4: the permit's NEWEST ACTIVE unified note (public.notes) —
   *  '' when none. Replaces the old report_notes single-note-per-permit. */
  note_body: string;
  /** fix-notes-4: id of that note (public.notes.id), null when the permit has
   *  no active note yet — the editor creates one on first save. */
  note_id: string | null;
  /** Present on corrections rows: latest cycle's corr_issued date. */
  corr_issued?: string | null;
  /** Present on upcoming-intake rows: the permit's target_submit date. */
  target_submit?: string | null;
  /** fix-221: present on approved-awaiting-issuance rows: the permit's
   *  approval_date (when the city finished review). */
  approval_date?: string | null;
}

/** One DA's section of the report. `da` is the grouping key
 *  (COALESCE(permits.da,'Unassigned')); `name` mirrors it for display. */
export interface WeeklyDaReportGroup {
  da: string;
  name: string;
  corrections: WeeklyDaReportRow[];
  upcoming_intakes: WeeklyDaReportRow[];
  /** fix-221: permits the city approved but hasn't issued (Issuance Prep).
   *  Optional so a client running before the RPC migration lands still parses
   *  (defaults to [] at the render site). */
  approved_awaiting_issuance?: WeeklyDaReportRow[];
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
