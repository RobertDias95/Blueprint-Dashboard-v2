import type { UnitType } from '../../lib/database.types';
import {
  seedExpectedIssue,
  seedTargetSubmit,
} from '../../lib/permitSeedingDefaults';

const BUILDING_PERMIT = 'Building Permit';

/** fix-88: Units count is required at submit. Returns true when the
 *  string value parses to a finite number > 0. Empty string, '0', and
 *  negatives all fail. 2 prod projects (2724 Walnut Ave SW + 1 other)
 *  were saved with NULL units before this gate existed — Bobby spotted
 *  the gap when the Proposal section rendered without a Units value. */
export function unitsIsValid(units: string): boolean {
  const trimmed = units.trim();
  if (trimmed === '') return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

// fix-22: shared state shape threaded through the 4-step wizard. Step 1
// fills project-level fields; Step 2 picks which permits to create;
// Step 3 lets the user override per-permit assignments (ent_lead etc.);
// Step 4 lets the user toggle which task templates to instantiate. The
// final submit walks this object into the bp_create_project_with_permits
// RPC payload.
//
// All fields are nullable / empty-string by default so the form can be
// constructed before any input. The RPC layer (useCreateProjectWithPermits)
// converts empties to null on the wire.

/** One row in WizardState.permits — represents a permit to be created.
 *  `selected` toggles inclusion via Step 2; `taskTemplateIds` is the
 *  Step 4 checked-task set. Sub-fields ent_lead/dm/da/etc. default in
 *  Step 3 from project-level values but can be overridden per permit. */
export interface WizardPermit {
  /** Stable identity for React lists and cross-step refs. */
  rowId: string;
  /** Catalog name from permit_types. Building Permit is always selected. */
  type: string;
  selected: boolean;
  /** Per-permit overrides — default in Step 3 from Step 1's
   *  entitlement_lead / design_manager. */
  ent_lead: string;
  dm: string;
  da: string;
  dual_da: string;
  architect: string;
  /** Optional permit number — usually filled later. */
  num: string;
  /** fix-25c: ACQ Target Date = team's target ISSUE date. Lands on
   *  permits.expected_issue (the column Schedule Health reads as
   *  "ACQ Target"). */
  expected_issue: string;
  /** fix-25-feat-h: planned submission date. Lands on
   *  permits.target_submit. Optional everywhere — for Building Permits
   *  the bp_set_bp_dd_dates cascade fills this from dd_end + 14 once
   *  DD dates are entered, so leaving it blank at wizard time is the
   *  default expectation. For non-BP types, this is the only surface
   *  that anchors the team's planned submit date at creation. */
  target_submit: string;
  /** fix-Phase-B: which seed fields the user has hand-edited. Auto-seeding
   *  (see applySeeding) never overwrites a field flagged true here. New rows
   *  start with {} so both fields are seedable until touched. */
  manuallyEdited: { expected_issue?: boolean; target_submit?: boolean };
  /** Set in Step 4. Empty array = create no tasks for this permit. */
  taskTemplateIds: string[];
}

export interface WizardState {
  // Step 1 — Project Info
  address: string;
  juris: string;
  notes: string;
  /** fix-91: derived on submit (not asked in Step 1 anymore). Step 3's
   *  BP DA pick → bp_ent_lead_for_da looks up the routed ent_lead;
   *  handleSubmit also writes this to projects.entitlement_lead so the
   *  project-wholistic column stays populated for reports + lists. */
  entitlement_lead: string;
  /** fix-91: same story as entitlement_lead — derived from the BP's DA
   *  via dm_da_groups + written to projects.design_manager on submit. */
  design_manager: string;
  acq_lead: string;
  go_date: string;
  /** fix-91: BP's expected_issue, captured on Step 1 so Phase B's
   *  reactive seeding (applySeeding) has an anchor before the user
   *  reaches Step 3. When Step 3 builds the BP row, it inherits this
   *  value as its initial expected_issue. Optional. */
  acq_target: string;
  units: string;
  zone: string;
  lot_width: string;
  lot_depth: string;
  unit_types: UnitType[];
  parking_type: string;
  parking_stalls: string;
  alley: string;
  /** fix-91: array now. A site can legitimately have multiple types
   *  (SFR + Attached Units + Cottages). Pick list comes from the
   *  app_config.productTypeOptions key (AdminProjectsTab edits). */
  product_types: string[];
  project_tags: string[];
  // Step 1 — Builder / Owner (fix-22-final / Migration 6)
  builder_name: string;
  builder_company: string;
  builder_email: string;
  builder_phone: string;

  // Step 2 + Step 3 + Step 4 — Permits list
  permits: WizardPermit[];
}

let _nextRowId = 1;
export function newPermitRowId(): string {
  return `wp-${_nextRowId++}`;
}

export function makeEmptyWizardState(): WizardState {
  return {
    address: '',
    juris: '',
    notes: '',
    entitlement_lead: '',
    design_manager: '',
    acq_lead: '',
    go_date: '',
    acq_target: '',
    units: '',
    zone: '',
    lot_width: '',
    lot_depth: '',
    unit_types: [],
    parking_type: '',
    parking_stalls: '',
    alley: '',
    product_types: [],
    project_tags: [],
    builder_name: '',
    builder_company: '',
    builder_email: '',
    builder_phone: '',
    permits: [],
  };
}

/** V1 parity: vocab matches Blueprint-Dashboard-/index.html lines 1395-1400.
 *  Listed as fix-23 cleanup target — once production data is normalized,
 *  these can be reconsidered. For now match v1 exactly so a Bobby's new-
 *  project entries store the same vocabulary as historical data. */
export const PARKING_TYPE_OPTIONS = [
  'None',
  'Surface',
  'Garage',
  'Both',
] as const;

export const ALLEY_OPTIONS = ['Yes', 'No'] as const;

export const PRODUCT_TYPE_OPTIONS = [
  'SFR',
  'SFR w/ Accessory Units',
  'Attached Units',
  'Cottages',
] as const;

/** V1 parity: short helpful hints rendered under each permit name in
 *  the Step 2 questionnaire. Sourced from Blueprint-Dashboard-/index.html
 *  lines 6397-6409 (v1's hintMap). v2 catalog adds SDOT Tree (variant of
 *  v1's "SDOT" entry — reused that wording). Types not in v1's map
 *  (IPR, LBA, Condo, Short Plat, SIP) intentionally have no entry so
 *  Step 2 renders no description rather than fabricating one. */
// fix-Phase-B: reactive seeding. Given the current wizard state, fill each
// non-Building-Permit row's expected_issue / target_submit from the per-type
// rules — EXCEPT fields the user has manually edited (manuallyEdited[F]) and
// the Building Permit's own expected_issue (it IS the anchor). Anchors: the
// project GO date + the FIRST Building Permit's expected_issue. Pure: returns
// the same state object when nothing changed so callers can skip needless
// renders. Run this after every wizard-state change (see NewProjectWizard's
// patch) so GO-date / BP-ACQ / permit add-remove / type changes re-seed.
export function applySeeding(state: WizardState): WizardState {
  const goDate = state.go_date || '';
  const bp = state.permits.find((p) => p.type === BUILDING_PERMIT);
  // fix-91: acq_target is the canonical Step 1 ACQ Target input. Once the
  // BP row exists (Step 3 onward) its expected_issue mirrors acq_target
  // and a per-permit edit there overrides; before then the BP row hasn't
  // been built yet so we fall back to acq_target so seeding can already
  // start firing for non-BP rows when Step 3 mounts.
  const bpAcq = bp?.expected_issue || state.acq_target || '';
  const anchors = { goDate, bpAcq };

  let changed = false;
  const permits = state.permits.map((p) => {
    // The Building Permit's fields are never auto-seeded here (its ACQ is the
    // user-entered anchor; its target_submit is engine-derived server-side).
    if (p.type === BUILDING_PERMIT) return p;
    const me = p.manuallyEdited ?? {};
    let expected_issue = p.expected_issue;
    let target_submit = p.target_submit;
    if (!me.expected_issue) {
      const seed = seedExpectedIssue(p.type, anchors);
      // Don't clobber an existing value with nothing when the anchor's unset.
      if (seed !== null) expected_issue = seed;
    }
    if (!me.target_submit) {
      const seed = seedTargetSubmit(p.type, anchors);
      if (seed !== null) target_submit = seed;
    }
    if (expected_issue === p.expected_issue && target_submit === p.target_submit) {
      return p;
    }
    changed = true;
    return { ...p, expected_issue, target_submit };
  });

  return changed ? { ...state, permits } : state;
}

export const PERMIT_DESCRIPTIONS: Record<string, string> = {
  'Building Permit':
    'Required for new construction or major structural work',
  Demolition: 'Tearing down an existing structure before construction',
  'Grading / Clearing':
    'Earthwork, cut/fill, retaining walls, tree clearing at scale',
  TRAO: 'Tree Removal Authorization — protected trees impacted',
  'ECA Waiver': 'Environmentally Critical Area on site',
  ULS: 'Utility local service connections — water/sewer/storm',
  LSM: 'Lot size modification or boundary adjustment',
  'PPR (Post-Permit Revision)':
    'Changes to approved plans during/after construction',
  PPR: 'Pre-application or post-permit design revisions',
  'PAR/Pre-Sub': 'Pre-application review submission',
  SDOT: 'Seattle Dept of Transportation permit — ROW, curbs, trees',
  'SDOT Tree':
    'Seattle Dept of Transportation tree review — ROW, curbs, trees',
};
