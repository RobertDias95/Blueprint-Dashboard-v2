import type { UnitType } from '../../lib/database.types';

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
   *  "ACQ Target"). Previously this field was bound to target_submit
   *  with a misleading "ACQ target submit" label — the values entered
   *  through the wizard never reached the display because the columns
   *  diverged. target_submit is no longer collected via the wizard;
   *  it stays NULL on new permits and can be set later via Project
   *  Settings if a planned submission date is needed. */
  expected_issue: string;
  /** Set in Step 4. Empty array = create no tasks for this permit. */
  taskTemplateIds: string[];
}

export interface WizardState {
  // Step 1 — Project Info
  address: string;
  juris: string;
  notes: string;
  entitlement_lead: string;
  design_manager: string;
  acq_lead: string;
  go_date: string;
  units: string;
  zone: string;
  lot_width: string;
  lot_depth: string;
  unit_types: UnitType[];
  parking_type: string;
  parking_stalls: string;
  alley: string;
  product_type: string;
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
    units: '',
    zone: '',
    lot_width: '',
    lot_depth: '',
    unit_types: [],
    parking_type: '',
    parking_stalls: '',
    alley: '',
    product_type: '',
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
