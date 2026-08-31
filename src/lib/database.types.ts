// Q2: Hand-typed row shapes for the tables v2 reads. Narrow on purpose —
// we type the columns the read paths actually consume. Write paths in Q3+
// will tighten unknown[] payloads to typed mutation inputs.
//
// Field names mirror the Supabase schema exactly (snake_case). UI helpers
// translate to camelCase where useful, but the wire format stays canonical.

// fix-330: the attachment shape lives with the upload/limit rules that produce
// it, not here — importing it keeps ONE definition rather than a wire copy that
// can drift from the validator.
import type { ChatAttachment } from './chatAttachments';

export type Stage = 'de' | 'pm' | 'co' | 'ap' | 'is';

/** fix-22: per-unit-type sub-row stored as jsonb on projects.unit_types.
 *  Wizard's UnitTypesEditor reads/writes this shape. */
/** ★★★ fix-402: how a unit parks. A CLOSED SET — Bobby: *"by unit it's broken
 *  down: is it a garage, is it surface, is it both"*.
 *
 *  ★★★ `none` IS A RECORDED ANSWER, and that is the whole reason it is in the
 *  set. "This unit has no parking" is a fact somebody entered; NULL is the
 *  absence of a fact. Conflating them is fix-386's rule broken, and it is why
 *  the set has four members rather than three plus a NULL. */
export const PARKING_KINDS = ['garage', 'surface', 'both', 'none'] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

export function isParkingKind(v: unknown): v is ParkingKind {
  return typeof v === 'string' && (PARKING_KINDS as readonly string[]).includes(v);
}

/** ★ fix-412: re-exported here so `UnitType` can name it without importing
 *  from a module that imports this one. The vocabulary, the labels and the
 *  filter predicate all live in lib/unitWorkScope — this is the type alone. */
export type WorkScope = 'none' | 'performed';

export interface UnitType {
  label: string;
  width_ft: number | null;
  depth_ft: number | null;
  qty: number;
  /** fix-205: stories for this unit-type structure (1–4+). Optional — older
   *  rows predate the field. Stored in the same projects.unit_types JSONB
   *  array (no migration). null/absent = not entered ("—"). */
  stories?: number | null;
  // ★★★ fix-402 — PARKING MOVES FROM THE SITE TO THE UNIT.
  //
  // Bobby, 2026-08-25: *"Remove [parking] from the holistic site and merge that
  // under the units for proposal … by unit it's broken down: is it a garage, is
  // it surface, is it both, and how many stalls per unit."*
  //
  // ★★ THE SAME JSONB ARRAY, NO MIGRATION — fix-205's precedent exactly. Units
  // live in `projects.unit_types`; `stories` joined them this way and so do
  // these three. The closed set is enforced by the parser and the editor
  // dropdown rather than a DB CHECK, because a CHECK cannot reach inside a
  // JSONB array element without rejecting every legacy row.
  //
  // ★★★ ALL THREE START NULL ON EVERY ROW, AND NOTHING PRE-FILLS THEM. 231 unit
  // rows across 102 projects on prod as of 2026-08-25; the team backfills by
  // hand. NULL means NOT RECORDED — never "none", never 0, never false.
  /** garage · surface · both · none. null = not recorded. */
  parking_kind?: ParkingKind | null;
  /** Stalls for this unit. 0 is a recorded zero; null is not recorded. */
  parking_stalls?: number | null;
  /** Bobby: *"just a yes or no, roof deck"*. null = not recorded. */
  roof_deck?: boolean | null;
  /** ★★★ fix-412 (Scope B): on a Remodel, was work actually performed?
   *
   *  `'performed'` · `'none'` · **absent/null = nobody has answered**, which is
   *  the state Bobby asked for — *"at intake the scope is often unknown and
   *  needs to be identifiable later"*. All 234 unit objects on prod lack this
   *  key today and therefore read as unanswered, which is true of every one of
   *  them.
   *
   *  ★ Hand-typed, like the rest of this file. Optional for the same reason
   *  `parking_kind` is: 230 of 234 units predate that key too, and a required
   *  field would make every stored unit object invalid. */
  work_scope?: WorkScope | null;
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
  /** ★ fix-410 (P-040): is the lot a regular rectangle — equal widths, equal
   *  lengths? `null` = nobody has said, and it must never render as "Yes".
   *
   *  ★★ Hand-typed, like everything in this file. The column is nullable with
   *  NO DDL default on purpose: the FORM carries Bobby's "default should be
   *  yes", the COLUMN does not, so a create path that omits the key records
   *  "not answered" rather than a claim. Optional here for the same reason
   *  `is_corner_lot` is — a fixture that predates the column stays valid. */
  is_regular_shape?: boolean | null;
  /** fix-122: closing/escrow date. Informational only — surfaces "we
   *  have permits but builder won't issue until closing." No math, no
   *  cascades, no alerts. */
  closing_date?: string | null;
  zone?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  unit_types?: UnitType[] | null;
  /** @deprecated ★★★ fix-402 — SITE-LEVEL PARKING IS ARCHIVED AND CLEARED.
   *
   *  Bobby, 2026-08-25: *"Remove [parking] from the holistic site and merge
   *  that under the units for proposal."* Parking is a per-UNIT property now —
   *  see UnitType.parking_kind / parking_stalls above.
   *
   *  ★★ THE COLUMNS STILL EXIST AND ARE NULL ON ALL 202 PROJECTS (re-measured
   *  2026-08-30 by fix-456: 0 non-null of 202, for both). The 182 rows that
   *  carried a value were copied to `_parking_site_archive_2026_08_25` first
   *  (181 types, 180 stall counts), because the site answers are the only
   *  record of what the team believed before the per-unit book is backfilled.
   *
   *  ★ Nothing reads these any more; they are kept typed so the archive story
   *  is discoverable from the type rather than only from a migration file.
   *
   *  ★★★ fix-456 (P-036) PROPOSED DELETING THESE TWO DECLARATIONS AND DID NOT,
   *  ON PURPOSE. The reasoning is the line directly above: removing them would
   *  delete the only pointer to `_parking_site_archive_2026_08_25` outside a
   *  migration file, which is the opposite of what fix-402 decided. And the
   *  columns are still THERE — the drop is written but unapplied, in
   *  `migrations/fix_456_drop_backup_tables_PENDING_APPROVAL.sql`, awaiting
   *  Bobby. A type that denies a live column is a worse lie than a
   *  `@deprecated` one that explains it.
   *
   *  ★★ WHEN BOBBY APPLIES THAT DROP, DELETE THESE TWO DECLARATIONS IN THE SAME
   *  CHANGE, so the type and the database never disagree. fix-456 also found a
   *  SECOND parking record — `_fix22_permits_dropped_cols_snapshot`, 171 stalls
   *  and 30 types from when these lived on `permits` — and neither archive
   *  table carries a drop statement, deliberately. See
   *  migrations/BACKUP_TABLE_INVENTORY.md. */
  parking_type?: string | null;
  /** @deprecated fix-402 — see parking_type above. */
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
  /**
   * ★★★ fix-386: did the person creating this project tick "Backfill?" in the
   * wizard's Step 1?
   *
   * ★★★ NULL MEANS NOT RECORDED, NEVER "no" — fix-363's rule. Every project
   * created before fix-386 is null, because nobody was ever asked to store the
   * answer; the checkbox existed (fix-143 used it to unlock the manual DD
   * dates) and the answer was discarded. Reading a null as false would claim
   * ~300 historical projects are definitely not backfills, which is a claim
   * nobody made and which fix-378's measurements contradict.
   *
   * ★★ WHAT IT DOES: `true` suppresses fix-378's plan-date milestones outright
   * — the person who entered the project said it was history. `false` does NOT
   * un-suppress them; the date inference still runs. See milestoneIsHistory in
   * lib/myBoard.ts for that asymmetry and why it exists.
   *
   * Hand-typed, like every column here — V2 never runs `supabase gen types`.
   */
  is_backfill?: boolean | null;
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
  /** fix-265: the free-text qualifier on that reuse relationship — what Gena
   *  writes by hand today ("Units are Similar to 13515 27th? XL?", "7315 Jones
   *  Ave NW (W/O GAR)"). reused_from_project_id carries the LINK; this carries
   *  the nuance that makes the link useful to an outside engineer. Surfaced in
   *  the vendor schedule forecast. NOT redesign_notes, which is redesign-scoped.
   *  Added by migrations/fix_265_vendor_schedule_forecast.sql — optional here
   *  because that migration is not applied yet, and because the shared
   *  useProjects() select deliberately does not fetch it (see
   *  useVendorReportExtras). */
  reuse_notes?: string | null;
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
  /** fix-262: which KIND of park this row records.
   *   'hold'      — paused, but the project is still ACTIVE.
   *   'cancelled' — no longer active: the step after hold, before delete.
   *  At most one OPEN row (hold_end === null) of EITHER kind per project.
   *  Optional on the hand-typed interface so pre-fix-262 fixtures stay valid;
   *  the column is NOT NULL DEFAULT 'hold' in the DB, so a missing value reads
   *  as a hold. */
  kind?: ProjectHoldKind;
}

/** fix-262: the two kinds a project_holds row can be. Mirrors the DB CHECK. */
export type ProjectHoldKind = 'hold' | 'cancelled';

/**
 * ★★★ fix-390: ONE PERMIT deliberately paused, when the rest of its project is
 * still moving.
 *
 * Shaped like {@link ProjectHold} on purpose — same open/released lifecycle
 * (`hold_end === null` is open), same reason/note, same provenance — because it
 * is the same idea at a smaller scope, and fix-364's rule is one concept, one
 * term.
 *
 * ★★★ THERE IS NO `kind` UNION HERE, AND THAT IS THE POINT. fix-262 made CANCEL
 * a PROJECT outcome ("the step after hold, before delete") and an axis for
 * volume attribution. A single dead permit already has vocabulary — the
 * portal's **Withdrawn**, which fix-388 taught the board to respect. A
 * permit-level cancel would be a rival concept for a question already answered,
 * so the DB CHECK admits 'hold' and nothing else and this type says so.
 *
 * ★★ A permit hold NEVER derives project-level held state. One stuck ULS must
 * not paint the project its BP is moving through.
 */
export interface PermitHold {
  id: string;
  tenant_id: string;
  /** permits.id — integer, unlike ProjectHold's uuid project_id. */
  permit_id: number;
  reason: string;
  note: string | null;
  hold_start: string;
  hold_end: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Always 'hold'. Present so the row shape matches the table; the DB CHECK
   *  refuses anything else. */
  kind?: 'hold';
}

/** fix-262: a row's kind, defaulting to 'hold' for rows written before the
 *  column existed (and for fixtures that omit it). Use this rather than reading
 *  `.kind` directly so the default is applied in exactly one place. */
export function holdKind(
  h: Pick<ProjectHold, 'kind'> | null | undefined,
): ProjectHoldKind {
  return h?.kind === 'cancelled' ? 'cancelled' : 'hold';
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
  /** ★★ fix-448: the OCC token. `builders` had NO updated_at and no created_at
   *  — confirmed on prod — so the registry editor could not check "has this
   *  changed since I read it" the way every other editor in the app does. The
   *  fix-448 migration adds the column plus the house `bp_set_updated_at`
   *  trigger; it is optional here because a row read through the older
   *  `useBuilderSearch` projection does not select it. */
  updated_at?: string | null;
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

/** fix-329: one message in a project's chat thread.
 *
 *  ★ APPEND-ONLY. There is no update or delete grant on project_messages, so a
 *  message is a record of what was said — which is what lets a task link back to
 *  one and still mean something. `updated_at` exists for a phase-2 edit trail
 *  and nothing writes it today.
 *
 *  `mentions` is a PARSED uuid[] of profiles.id, not names: the bell asks "did
 *  this mention me" for every message, and a name can change under a row while
 *  an id cannot. Safe to denormalize precisely because the row is immutable. */
export interface ProjectMessage {
  id: string;
  project_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  mentions: string[];
  /** fix-330: [{path,name,mime,size}] uploaded with this message. jsonb for the
   *  same reason `mentions` is a uuid[] — written once with an append-only row,
   *  always read with it, never queried on its own. */
  attachments: ChatAttachment[];
  created_at: string;
  /** The task created FROM this message, if any (fix-329's link-back). */
  task_id: string | null;
  task_text: string | null;
  /** ★ fix-330: WHICH permit that task landed on. The link-back can now name
   *  the permit instead of asserting the task went somewhere. */
  task_permit_id: number | null;

  // ── fix-334 ──────────────────────────────────────────────────────────────
  /** ★ NULL means this row IS a post; non-null means it is a reply under that
   *  post. Two levels only — the DB trigger refuses a third. */
  parent_message_id: string | null;
  /** A post's title. NULL on a reply; the CHECK constraint enforces the pair. */
  title: string | null;
  /** Stamped by the DB trigger when the body changes. */
  edited_at: string | null;
  /** Soft delete. ★ Nothing is ever hard deleted — a task can be created from a
   *  message, and the row has to outlive the words. */
  deleted_at: string | null;
  /** ★ The superseded text, appended BY THE DATABASE on every edit and on
   *  delete. A history the client wrote would be a claim about client code. */
  revisions: MessageRevision[];
  /** Posts only: live replies under this post. */
  reply_count: number | null;
  /** Posts only: the newest of the post and its live replies. */
  last_activity_at: string | null;
}

/** One superseded version of a message, written by
 *  `bp_trg_project_message_revision`. */
export interface MessageRevision {
  body: string;
  at: string;
  by: string | null;
  reason: 'edited' | 'deleted';
}

/** fix-329: someone who can be @-mentioned — a person who can actually open
 *  this tenant, so every mention can resolve to a notifiable user.
 *
 *  ★ fix-330: `name` is now a HUMAN NAME. It used to be an email address for
 *  every single person, because profiles.name is NULL on all 29 production
 *  logins — which is the real reason `@Miles` matched nobody. bp_mentionable_
 *  people resolves it through team_members.email (fix-176's mapping). */
export interface MentionablePerson {
  user_id: string;
  name: string | null;
  email: string | null;
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
  /** fix-251: NULL when the city has opened a review slot but not yet named a
   *  human for it (scraper fix-scraper-250). An unnamed slot is still an
   *  ACTIVELY PENDING review and must count as outstanding — do not filter
   *  these rows out. Anything calling .localeCompare/.trim/.toLowerCase on
   *  this must guard for null; use reviewerDisplayName() to render. */
  reviewer_name: string | null;
  /** "Land Use", "Plan Review", etc. when the adapter knows it; null when
   *  the adapter can only see the reviewer's name without their role. */
  discipline: string | null;
  current_status: ReviewerStatus;
  last_event_date: string | null;
  created_at: string;
  updated_at: string;
}

// fix-276: one row per numbered comment on a jurisdiction correction letter.
// Produced by the file_indexer in the scraper repo, which reads the on-prem
// Building Permits share and upserts here under service_role. The dashboard is
// a READER ONLY — `authenticated` holds SELECT and nothing else, so there is
// deliberately no write hook for this table.
//
// Hand-typed like the rest of this file. Narrow on purpose: these are the
// columns the Corrections panel consumes, not the full table (tenant_id,
// permit_id, source_folder, content_hash and the timestamps are not read).
export interface CorrectionItem {
  id: string;
  project_id: string;
  /** fix-279: the permit this letter belongs to, resolved by the indexer
   *  (fix-278). Set on 49.8% of production rows — east-side letters join on
   *  building = struct_address, Seattle ones on the permit number in the Accela
   *  header. NULL where the letter named no permit, or named one ambiguously:
   *  the indexer refuses to guess. Any permit-level slice therefore covers
   *  about half the corpus, which the report states rather than hides. */
  permit_id: number | null;
  /** The structure this letter is about, when the jurisdiction issues per
   *  building: 'SFR 1', 'DUPLEX 2'. NULL for Seattle, which issues one letter
   *  per discipline for the whole project — 1,881 of 2,194 production rows are
   *  NULL, so the building grouping level must be conditional. */
  building: string | null;
  /** 'Zoning', 'Drainage', 'OS', … NULL when neither the filename nor the
   *  letter text named one (113 production rows, including every row on
   *  10431 SE 19th St). Render via correctionDisciplineLabel(). */
  discipline: string | null;
  /** Review round. Nullable in the schema; non-null on every production row
   *  today. Rows without one still have to render, so they group into an
   *  "Unknown cycle" bucket rather than being dropped. */
  cycle: number | null;
  /** ISO date (YYYY-MM-DD) — a `date` column, so no timezone shifting. */
  letter_date: string | null;
  reviewer: string | null;
  item_no: number;
  subject: string | null;
  body: string | null;
  /** '; '-joined code citations, e.g. 'SMC 23.44.014; SMC 23.45.518'. */
  codes: string | null;
  /** Discipline-specific bucket from the indexer's 38-rule taxonomy. */
  category: string | null;
  /** Cross-jurisdiction rollup of `category` — the comparable axis. */
  theme: string | null;
  source_file: string;
  /** fix-283a: false when the indexer decided this row is not a review comment
   *  — drawing text captured from the other column of a two-column letter,
   *  letter boilerplate, or an item the reviewer marked informational. 141 of
   *  2,194 production rows.
   *
   *  ★ DEFAULTS TRUE IN THE DATABASE, so an unclassified row counts as a
   *  correction and the filter can only ever remove rows deliberately. Typed
   *  optional because rows fetched by a caller that does not select it are a
   *  legitimate shape — treat a missing value as `true`, which is what
   *  isRealCorrection() does. */
  is_correction?: boolean;
  /** fix-283a: which rule excluded the row — 'explicit' | 'boilerplate' |
   *  'drawing_text' | 'scrambled'. NULL whenever is_correction is true, and a
   *  CHECK constraint keeps the pair consistent. The rules live in the
   *  scraper's file_indexer/corrections_filter.py; this repo only reads. */
  exclusion_reason?: string | null;
}

// fix-285: a row of public.project_plan_of_record — the current design set for
// one project. EXACTLY ONE ROW PER PROJECT, guaranteed by the view's
// `distinct on (project_id)`, so this is queried with `.maybeSingle()`.
//
// ★ THE PRECEDENCE IS NOT THIS REPO'S TO DECIDE. fix-284 owns it:
// design_guidance (1) < schematic (2) < marketing (3), furthest stage present
// wins REGARDLESS OF FILE DATES. The view has already applied it. Nothing here
// re-derives a winner, re-ranks, or falls back to "newest" — a second
// implementation of that rule is a second answer waiting to disagree.
//
// Distinct from `is_current` on project_file_index, which means "newest
// renderable file WITHIN one set_type". This is "the set_type that outranks
// the others present".
//
// Read-only: `authenticated` has SELECT and nothing else, and the view is
// security_invoker so RLS still scopes rows to the caller's tenant.
export interface ProjectPlanOfRecordRow {
  project_id: string;
  tenant_id: string;
  /** project_file_index.id of the winning row. */
  file_index_id: string;
  /** 'design_guidance' | 'schematic' | 'marketing'. Typed as a union because
   *  the CHECK constraint on project_file_index enumerates exactly these, and
   *  the view drops anything ranking 0. */
  set_type: PlanOfRecordStage;
  /** 1 | 2 | 3 — fix-284's fixed order, carried through so the UI can order or
   *  compare without knowing the rule. */
  stage_rank: number;
  file_name: string;
  /** Full UNC path on the share. Shown verbatim and selectable — it is how a
   *  person actually opens the file. */
  unc_path: string;
  /** NULL for design guidance, which is a loose PDF at the project root rather
   *  than something inside a named folder (fix-284). */
  folder_name: string | null;
  modified_at: string;
  size_kb: number | null;
  /** Object path in the PRIVATE plan-thumbnails bucket, {project_id}/{set_type}.jpg.
   *  ★ NEVER a URL. The bucket is private; a URL is signed at read time and
   *  expires. Constructing a public URL from this would 400 — and if it ever
   *  stopped 400ing, it would mean drawing content had been made world-readable. */
  thumb_path: string | null;
  /** 'ok' | 'failed' | null(never attempted). Anything but 'ok' degrades the
   *  card to name/date/path — never a broken image, never an error. */
  thumb_status: 'ok' | 'failed' | null;
  thumb_generated_at: string | null;
}

export type PlanOfRecordStage = 'design_guidance' | 'schematic' | 'marketing';

// fix-358: one row of public.project_plan_of_record_verdict — the REASONING
// behind the card above, written by the file indexer (fix-356) and read here.
//
// ★★ THE SENTENCE IS THE PRODUCT. Bobby: "Hey, you had a couple of options here
// — why would you take that option versus the other option that you already
// had?" fix-356 answers that in one line and stores it; this app prints it.
//
// ★★★ THE VOCABULARY LIVES IN ONE LANGUAGE ON PURPOSE (fix-356 §4). `internal`,
// `review`, `draft`, `final`, "design guidance" and the reason codes behind them
// are Python. Rebuilding that sentence in TypeScript would be one rule in two
// languages, drifting from the day it shipped — so `verdict` is typed as opaque
// JSON here rather than as a shape this app could be tempted to reason over.
export interface ProjectPlanOfRecordVerdictRow {
  project_id: string;
  /** ★ NULL when NOTHING qualified — the state this ticket exists to render.
   *  33 of 138 projects are here today, and each one already carries the
   *  sentence that explains why. */
  stage: PlanOfRecordStage | null;
  file_name: string | null;
  unc_path: string | null;
  /** The ready-made explanation. Printed verbatim; never parsed. */
  sentence: string;
  /** ★ Deliberately `unknown`. The structured stages array is there for layout
   *  if it is ever needed, and reading it to RE-DERIVE the outcome is precisely
   *  the thing not to do. Typing it as `unknown` makes that a compile error
   *  rather than a temptation. */
  verdict: unknown;
  /** When the indexer last WALKED this project — not when anything changed. It
   *  only moves when Bobby runs the indexer, which is why staleness has to be
   *  visible on the card (fix-358 §3). */
  computed_at: string;
}

// fix-279: a row of public.correction_missing_worklist — an expected correction
// letter with nothing found on the share.
//
// ★ "NO LETTER FOUND" IS NOT "NOT FILED". The reconciliation cannot tell a
// letter that was never saved from one saved under a filename the indexer's
// parser does not recognise. Every row carries `status_note` saying exactly
// that, and the UI must repeat it — getting this wording wrong sends someone
// chasing a colleague over a file that exists.
//
// The view is security_invoker, so RLS on permits/projects still applies and
// this is a plain authenticated SELECT.
export interface CorrectionMissingWorklistRow {
  tenant_id: string;
  project_id: string;
  permit_id: number;
  permit_num: string | null;
  permit_type: string | null;
  address: string;
  juris: string | null;
  cycle: number;
  /** Disciplines the scraper saw reviewing that round, '; '-joined. NULL when
   *  the scraper never captured one — about a quarter of rows. */
  disciplines_expected: string | null;
  /** The date the city issued that round's corrections. */
  corr_issued: string | null;
  /** How long we have been missing it. NULL when there is no issue date. */
  days_since_corr_issued: number | null;
  project_parked: boolean;
  status_note: string;
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
  /** True when target_submit was hand-typed. The engine never overwrites a
   *  manual date — bp_recompute_target_submits skips these rows outright. */
  target_submit_is_manual?: boolean | null;
  /** fix-249: true when target_submit was derived from a PROJECTED anchor —
   *  a BP milestone (cycle-1 resubmit / intake / issue) that hasn't happened
   *  yet. The UI marks these so a projection isn't read as a firm date. */
  target_submit_is_projected?: boolean | null;
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
  /** fix-262: the completion_status this task held immediately before a project
   *  cancel swept it to 'Cancelled'. NULL unless the task is currently cancelled
   *  BY A SWEEP. There is no task history table and bp_trg_task_done_at clears
   *  done_at on any non-Resolved status, so this column is the entire restore
   *  mechanism — bp_restore_project reads it, restores it, then NULLs it. */
  prior_completion_status?: string | null;
  /** fix-138-a: external-blocker discipline. Vocab owned by the
   *  TypeScript layer (see WAITING_ON_OPTIONS / WaitingOnDiscipline); no
   *  DB CHECK so the team can expand the list without migrations. Null =
   *  no external block. */
  waiting_on?: WaitingOnDiscipline | null;
  /** fix-138-a: priority flag (star). Defaults to false in the DB. */
  priority?: boolean | null;
  /** fix-138-a: free-form notes shown in the task detail panel. */
  notes?: string | null;
  /** @deprecated ★★★ fix-459 §B (P-107) — DEAD COLUMN, LIVE-LOOKING NAME.
   *
   *  ★★★ THE LIVE SOURCE OF CO-ASSIGNMENT IS `permit_task_assignees` — 360 rows
   *  over 316 tasks, 100 of them open — surfaced to the app as
   *  `TaskNode.co_assignees` by the `bp_task_co_assignees` RPC. fix-224 unified
   *  assignment onto that join table and this array stayed behind.
   *
   *  ★★ THIS COLUMN IS NON-EMPTY ON **ZERO** ROWS of 1,643 (measured on prod
   *  2026-08-30). It is not "rarely used"; it has never held a value since the
   *  unification.
   *
   *  ★★★ IT HAS ALREADY PRODUCED A WRONG NUMBER IN A SHIPPED BRIEF. fix-458's
   *  brief said "157 unassigned, 143 still reachable", measured with
   *  `array_length(co_assignees,1)`. The true figures, taken off the join
   *  table, are **147 / 130 / 17**. The query ran, returned something entirely
   *  plausible, and was wrong — which is the whole reason this declaration
   *  exists rather than the column simply being left undocumented.
   *
   *  ★★ SO IT IS DECLARED IN ORDER TO WARN, NOT IN ORDER TO BE READ. Nothing in
   *  `src/` reads it (verified fix-459 §0b: every `co_assignees` in `src/` is
   *  either `TaskNode`'s RPC-surfaced field or the unrelated
   *  `task_templates.default_co_assignees`), and nothing should start. Read
   *  `TaskNode.co_assignees`.
   *
   *  ★ Two vestigial DATABASE readers remain and are deliberately untouched:
   *  `bp_task_touched_by_person` OR-s this array beside an
   *  `EXISTS … permit_task_assignees WHERE source='manual'` clause that already
   *  covers the case, and `bp_trg_permit_lead_cascade` edits it in place ("the
   *  legacy array column: edited within, never rebuilt"). **Both must be edited
   *  before this column can be dropped** — see
   *  `migrations/fix_456_drop_backup_tables_PENDING_APPROVAL.sql`, where the
   *  drop is written and awaiting Bobby.
   *
   *  ★ Same shape as fix-402's `projects.parking_type` / `.parking_stalls`:
   *  typed and deprecated so the story is discoverable from the type rather
   *  than only from a migration file. */
  co_assignees?: string[] | null;
}

/** fix-138-a: controlled vocab for permit_tasks.waiting_on. Lives in TS
 *  (no DB CHECK) so the team can extend the list without a migration
 *  cycle. Matches the same pattern as the existing free-form `cat` +
 *  `assigned_to` text columns. The fix-139 reporting view will GROUP BY
 *  this string. */
/** ★★ fix-364 §1: every value `permit_tasks.auto_closed_reason` may hold, and
 *  the same list the DB CHECK enforces.
 *
 *  ★★★ `superseded_by_intake_acceptance` was `superseded_intake_accepted` until
 *  fix-364. The old name described the EVIDENCE — the city accepted intake —
 *  and read like the rule Bobby EXCLUDED from fix-355 ("build it, minus
 *  intake_accepted"), which was a different thing entirely: closing tasks whose
 *  own job is `intake_accepted` (measured: it would have closed 0 of 17). Two
 *  different concepts with near-identical names, sitting next to each other in
 *  one feed. Renamed on 13 prod rows in the same migration, because leaving
 *  both spellings in circulation is worse than either. */
export const AUTO_CLOSED_REASONS = [
  'permit_issued',
  'superseded_by_intake_acceptance',
  'superseded_next_cycle',
  'superseded_resubmitted',
  'superseded_status_matched',
  'superseded_number_present',
  // ★★ fix-395: the chase task's own two deaths, and they are the negation of
  // its own mint gate — a task that would immediately auto-close is never
  // minted, so these only ever fire on a condition that died AFTER the mint.
  'superseded_city_responded',
  'superseded_target_changed',
  // ★★ fix-405: the two shapes no rule covered. Both say the PERMIT is dead
  // rather than that a cycle moved on, which is why they outrank every
  // per-event reason in the closer.
  'superseded_permit_withdrawn',
  'superseded_project_cancelled',
] as const;
export type AutoClosedReason = (typeof AUTO_CLOSED_REASONS)[number];

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
  | 'results_ready'
  // ★★★ fix-395: the only event fired by TIME rather than by a city action.
  // The city's review target has been chaseable — target plus one BUSINESS day
  // of grace, fix-305's `cityTargetChaseable` — for 7 straight days and nobody
  // has called them. Minted by the daily sweep (bp_generate_city_chase_tasks),
  // never by a trigger, because nothing HAPPENS on day 7; that is the problem.
  | 'city_target_chase';

/** ★ fix-460: which source a task row came from. 'permit' is every row that
 *  existed before this ticket; 'team' is a task with no permit. */
export type TaskSource = 'permit' | 'team';

/** fix-70: a task as returned by bp_list_permit_tasks / bp_my_tasks. The
 *  `status` field is the permit_tasks.completion_status value
 *  ('Open' | 'In Progress' | 'Resolved'); `primary_assignee` is DERIVED from
 *  the permit's da/ent_lead at read time; `co_assignees` are the explicit
 *  join-table rows. */
export interface TaskNode {
  id: string;
  /** ★★★ fix-460 (P-046): NULL on a TEAM TASK — a task that belongs to no
   *  permit. `permit_tasks.permit_id` is still `integer NOT NULL` and always
   *  will be; team tasks live in their own table and are UNIONed in by
   *  `bp_list_tasks`.
   *
   *  ★★ NULLABLE RATHER THAN A SENTINEL, AND THAT IS THE RULING IN TYPESCRIPT.
   *  Bobby, 2026-08-26: *"I'm not 100% sure I love the idea or concept around a
   *  fake project because it seems like we're putting a Band-Aid on a bigger
   *  problem."* A `permit_id` of `-1`, or a `project_address` of `''`, IS that
   *  fake permit in another costume — every consumer then has to know the magic
   *  value. `null` is the honest answer, and the compiler is what makes each
   *  consumer say out loud what it does with it. */
  permit_id: number | null;
  parent_task_id: string | null;
  discipline: 'arch' | 'ent';
  /** fix-79: lifecycle PHASE. 'de' = task created before c0.submitted (Design
   *  & Engineering); 'pm' = task created after the permit was submitted to
   *  the city (Permitting / corrections). Drives the D&E/Permitting toggle
   *  on the permit detail tasks panel and the bucket filter in My Tasks. */
  bucket: 'de' | 'pm';
  text: string;
  /** fix-262: 'Cancelled' joins the union — written only by a project cancel's
   *  server-side sweep, cleared only by bp_restore_project. Read predicates
   *  should go through taskStatus.isTaskLive rather than testing != 'Resolved'. */
  status: 'Open' | 'In Progress' | 'Resolved' | 'Cancelled';
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
  /** ★★ fix-337: why the SYSTEM closed this task — NULL when a person did.
   *
   *  Deliberately NOT `auto_event`, which says why a task was CREATED and
   *  drives the BOT badge: creation and closure are different facts and one
   *  column cannot hold both. Today the only value is 'permit_issued', written
   *  by bp_clear_tasks_for_issued_permit — the one-time clear AND the standing
   *  rule share it, so a person looking at a completed task can always tell it
   *  was not somebody's tick. */
  /** ★★ fix-364 §1: the FULL vocabulary. This said `'permit_issued' | null`
   *  until now, which had been wrong since fix-355 added five more values —
   *  a latent reader, and the kind that goes unnoticed because a narrower type
   *  never fails at runtime. The set matches the DB CHECK constraint exactly. */
  auto_closed_reason?: AutoClosedReason | null;
  /** fix-304: when the row was created. Added to bp_list_tasks so the bell can
   *  fold a bot task and the status flip that spawned it into ONE row
   *  (register #18) — the merge rule is a ~15-minute window and needs a
   *  timestamp. Optional: absent on wire shapes predating the migration. */
  created_at?: string | null;
  /** Derived: arch -> permit.da, ent -> permit.ent_lead. May be null when the
   *  permit has no DA/ent_lead set. */
  primary_assignee: string | null;
  co_assignees: string[];
  /** ★★★ fix-460 §A3: which table this row came from. The ONLY field the
   *  union added — every other field a permit task carries is byte-identical to
   *  what it was before. Absent on hand-built fixtures, which is why it is
   *  optional; `taskSource()` in lib/taskSource treats missing as 'permit'. */
  source?: TaskSource;
  /** ★★★ fix-462 (P-045): this team task is on the weekly agenda.
   *
   *  ★★ EMITTED ONLY ON THE TEAM BRANCH of `bp_list_tasks`. A permit task has
   *  no `agenda` key at all — which is why fix-460's byte-identity property
   *  survived this ticket and was re-proved against prod (1,643 rows, identical,
   *  zero permit rows carrying the key). Absent reads as falsy and is correct:
   *  a permit task cannot be an agenda item, because an agenda item is a team
   *  task.
   *
   *  ★★★ IT IS A SECOND PROPERTY OF ONE OBJECT, NOT A SECOND OBJECT. "Put it on
   *  the agenda" and "assign it" are two things true of the same row; nothing is
   *  copied and nothing syncs. That is the ruling this whole ticket rests on. */
  agenda?: boolean | null;
  /** Present on top-level tasks (from bp_list_permit_tasks); absent on
   *  subtasks and on bp_my_tasks rows. */
  subtasks?: TaskNode[];
}

/** fix-70: a row from bp_my_tasks — a task the caller is assigned to (implicit
 *  primary OR explicit co-assignee), with its project/permit context. */
export interface MyTaskNode extends TaskNode {
  /** ★ fix-460: NULL on a team task — see TaskNode.permit_id.
   *
   *  ★★★ A TEAM TASK'S `ref_project_id` IS DELIBERATELY NOT SURFACED HERE. The
   *  table can record which project a team task is ABOUT, but `bp_list_tasks`
   *  emits `project_id: null` regardless — because a project view filters on
   *  this field, and that is what makes "a team task never appears in a project
   *  view" true BY CONSTRUCTION rather than by a rule somebody has to remember. */
  project_id: string | null;
  project_address: string | null;
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
  /** fix-265: opt this block OUT of every vendor-facing report. Default false
   *  (everything is IN) — Bobby: "maybe we have the ability to take things off
   *  that don't count... we can use that as a learning module", so it is a
   *  per-block manual switch rather than a category rule, and what actually gets
   *  excluded is meant to teach us what the rule should be. Optional here
   *  because migrations/fix_265_vendor_schedule_forecast.sql is not applied yet;
   *  useDrawSchedule selects '*', so it appears on its own once it is. */
  exclude_from_vendor_reports?: boolean | null;
}

/** fix-265: one row of the vendor send ledger (public.vendor_report_state) —
 *  what an external vendor was LAST told about one project. Drives the New /
 *  Changed sections of the vendor schedule forecast. Written ONLY by
 *  bp_mark_vendor_report_sent, never by composing a draft. */
export interface VendorReportStateRow {
  tenant_id: string;
  vendor_key: string;
  project_id: string;
  sent_start_week: string | null;
  sent_dd_end: string | null;
  sent_status: string | null;
  sent_at: string;
  sent_by: string | null;
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
  /**
   * ★★ fix-384: optional link to the project this block is about.
   *
   * NULL on most rows and on every Vacation/Training block — a person's time
   * off has no project. It exists because draw_schedule is keyed by
   * project_id (one row per project), so a project's SECOND design window has
   * nowhere else to live, and people were typing the address into `label`.
   *
   * ★★★ A linked block is STILL NOT a project's design window. It never
   * reaches the vendor reports or deal volume, which read draw_schedule and
   * never this table.
   */
  project_id?: string | null;
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
/** ★★★ fix-461 — Bobby's four departments, 2026-08-26, FINAL.
 *
 *  ★ ACCOUNTING IS NOT ONE OF THEM. He said *"accounting, which is like EJ,
 *  Greg and them"* first and then settled on **Underwriting**; newest-first
 *  applies. Do not add a fifth and do not restore Accounting — the database
 *  CHECK constraint holds the same four. */
export type Department =
  | 'policy'
  | 'design_entitlements'
  | 'acquisitions'
  | 'underwriting';

export type TeamRole =
  | 'da'
  | 'dm'
  | 'ent'
  | 'ent_lead'
  | 'acq'
  | 'acq_lead'
  // fix-222: Schematic Team roster — sources the New Project wizard's
  // "Schematic Designer" picker + routes 'Schematic Team' template tasks.
  | 'schematic'
  // ★★ fix-343: added to the roster on prod 2026-08-18 — six people who are IN
  // the roster and are NEVER ASSIGNED WORK: EJ, Greg and Taylor (Underwriting),
  // Keenan (IT), Lucas (Policy) and Darin (CEO).
  //
  // ★ IT IS NOT A JOB TITLE. Their real function lives in `notes`, deliberately
  // kept out of `role` because `role` drives the assignment dropdowns — see
  // rosterRoleTitle (lib/roleLabels) for what gets printed, and
  // isAssignableMember (lib/roster) for why they are never offered.
  | 'viewer'
  // ★★★ fix-354 §6: Dave is the DIRECTOR over Design and Entitlements, and his
  // name plate still read "Schematic Design".
  //
  // ★ AN EARLIER ATTEMPT WROTE 'Director' INTO team_members.notes, WHICH
  // NOTHING RENDERS — Chrome asks rosterRoleTitle, which reads ROLE_TITLE[role],
  // and `notes` is only ever printed for a `viewer` (see roleLabels). That row
  // is misleading rather than wrong, which is worse.
  //
  // ★★ AND IT IS A SECOND ROW FOR HIM, NEVER A CHANGED ONE. A person holds one
  // row per role — Derry and Lindsay each hold `dm` AND `schematic` on prod —
  // so `director` alongside his existing `schematic` reads "Director · Schematic
  // Design" and he stays in every schematic list, picker and filter. Changing
  // the row he has would take him off the schematic team, which is not what was
  // asked: he genuinely does that work.
  | 'director';

/** Tenant-scoped roster. `active` flags currently-working members;
 * `former` flags DAs (and only DAs in v1's UX) who used to be on the
 * draw schedule and may still be referenced by historical permits. */
export interface TeamMember {
  id: string;
  /** ★★ THE JOIN KEY, and only that. ~2,209 rows across 11 columns in 7 tables
   *  point at this string with no FK and no cascade, so it is never written by
   *  a display fix — fix-343 added first_name/last_name beside it instead. */
  name: string;
  /** ★ fix-343 (data landed on prod 2026-08-18, populated for all 40 current
   *  rows): the person's real first and last name. `name` stays the key —
   *  "Bobby", "Fisk" — and these are what a display needs when the key alone is
   *  not enough. The avatar's initials are the first user: initialsOf('Bobby')
   *  is "BO"; initialsOf(rosterFullName(...)) is "BD". Optional because
   *  departed rows and older fixtures have neither. */
  first_name?: string | null;
  last_name?: string | null;
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
  /** fix-298: this person sees the company-wide board IN ADDITION TO their own
   *  role scope. ★ A FLAG, NOT A ROLE — additive, never a replacement. Bobby is
   *  ent_lead, Gena is dm, Dave is schematic, and each keeps their base scope;
   *  modelling oversight as a role would strip Gena's DM view to give her the
   *  wide one. One row per (name, role), so a person's flag is ORed across
   *  their rows — see resolveBoardViewer. Optional so fixtures predating
   *  fix-298 still typecheck. */
  is_oversight?: boolean | null;
  /** ★★★ fix-461 (P-045 prereq): which of the four departments this PERSON
   *  belongs to. Bobby, 2026-08-26: *"[Lucas is] a director, like Dave, but two
   *  different departments."* `role` mixes DISCIPLINE with SENIORITY and cannot
   *  express "director of X"; this is the axis that can.
   *
   *  ★★ NULL IS A FIRST-CLASS STATE, not an error. All 46 rows hold NULL the
   *  day this ships — Bobby classifies people himself, and "not yet classified"
   *  is a real answer the gap panel is built to show.
   *
   *  ★★★ IT IS A FACT ABOUT THE PERSON, THOUGH IT SITS ON A ROLE ROW. The
   *  roster is one row per (person, role) and six people carry two rows, so
   *  "Dave is Policy as a director and Design & Entitlements as a schematic
   *  designer" is expressible in the schema and is nonsense. A database trigger
   *  (`bp_trg_team_department_sync`) propagates any change to every row sharing
   *  the name and makes a new row inherit — so a split cannot be created by the
   *  editor, by hand SQL, or by the add-a-person path. Write it through
   *  `bp_set_team_department`, which takes a NAME, never a row id.
   *
   *  ★ A DEPARTMENT IS NOT A PERMISSION. Nothing gates on it and nothing may
   *  start to — admin/editor gating lives in `profiles.role`. */
  department?: Department | null;
  /** ★★★ fix-462 (P-045): this PERSON attends the weekly agenda meeting.
   *
   *  ★★ MEMBERSHIP IS A PER-PERSON CHECKBOX, NOT A DEPARTMENT — Bobby,
   *  2026-08-30, having been offered department gating and rejected it: gating
   *  by department means adding one person to the meeting moves their whole
   *  department, or you make an exception anyway.
   *
   *  ★★★ AND IT IS NOT A PERMISSION. It gates ONE ribbon entry and nothing
   *  else. Admin/editor gating lives in `profiles.role` and is untouched.
   *
   *  ★★ Same roster trap as `department`, same answer: it is a fact about the
   *  PERSON though it sits on a role row, and `bp_trg_team_agenda_member_sync`
   *  keeps every row sharing a name in agreement so nobody is ever HALF on the
   *  agenda. Write it through `bp_set_team_agenda_member`, which takes a NAME.
   *
   *  ★ It must appear in `useTeamMembers`'s EXPLICIT select list or it is
   *  invisible to every consumer — fix-386's trap, which fix-461 nearly shipped
   *  and a round-trip test now pins. */
  agenda_member?: boolean | null;
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
  /** ★ fix-346: the column order the table has always had and `useDmDaGroups`
   *  has always SELECTed — it was simply missing from this type. It is the
   *  tie-break `dmForDa` (and its SQL twin `bp_dm_for_da`) uses to resolve a
   *  duplicated `da_name` the same way everywhere. Optional because callers
   *  that build a row literal in tests do not need to care. */
  dm_order?: number | null;
  da_order?: number | null;
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

// ===========================================================================
// ★★★ fix-438 — public.permit_conditions (HAND-TYPED, like everything here)
// ===========================================================================
//
// Ruling, Bobby 2026-08-29: a standing condition is ONE ROW PER PERMIT PER
// CONDITION, updated each run, self-clearing, addressed to that permit's ENT
// lead, acknowledgeable, and never resolvable. See migrations/
// fix_438_permit_conditions.sql and lib/permitConditions.
//
// ★ THE THREE RPCs, quoted here because fix-439's scraper half calls the first
//   one and a signature that drifted would fail at run time, not at build:
//
//     bp_sync_permit_conditions(
//       p_permit_id integer, p_source text, p_conditions jsonb
//     ) RETURNS jsonb   -- {opened, updated, cleared}   service_role only
//
//     bp_acknowledge_permit_condition(p_id uuid) RETURNS jsonb   authenticated
//     bp_list_permit_conditions(p_open_only boolean DEFAULT true) RETURNS jsonb
//
// ★★ `p_conditions` is the FULL current set from that source for that permit:
//    [{ kind, cond_key, detail }]. Anything open, owned by that source and
//    ABSENT from it is cleared. An EMPTY ARRAY is meaningful and must be sent —
//    it is what clears the last condition on a permit.

/** One row of `permit_conditions`, as `bp_list_permit_conditions` returns it
 *  (joined to the permit + project for the words the notification needs).
 *
 *  ★ `detail_hash` is computed SERVER-SIDE by bp_condition_detail_hash over the
 *  MATERIAL part of `detail` — day counters and run timestamps stripped. The
 *  client compares it to `acknowledged_detail_hash` and never derives either;
 *  see lib/permitConditions for the measurement behind that decision. */
export interface PermitConditionDbRow {
  id: string;
  permit_id: number;
  project_id: string | null;
  permit_num: string | null;
  permit_type: string | null;
  address: string | null;
  /** A roster NAME (`permits.ent_lead`), never a user id. */
  ent_lead: string | null;
  /** Namespaced by its owning source: `scraper:mbp_resubmittal`. */
  kind: string;
  /** The disambiguator inside a kind — a cycle index, a field name. '' when
   *  the kind needs none; never NULL, because NULL is not equal to itself in
   *  the unique index that makes "one row per condition" true. */
  cond_key: string;
  detail: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  /** NULL means OPEN. */
  cleared_at: string | null;
  cleared_reason: string | null;
  acknowledged_at: string | null;
  acknowledged_detail_hash: string | null;
  detail_hash: string;
}
