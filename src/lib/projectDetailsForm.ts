import type { PermitWithCycles, Project } from './database.types';
import type { ProjectDataTab } from './projectDataTabs';

// ===========================================================================
// ★★★ fix-514 §A/§B/§C (P-191) — THE FORM BEHIND PROJECT DETAILS
// ===========================================================================
//
// Bobby, 2026-09-09: *"Project Data, Project Settings, all merged under one
// house into **Project Details**, and anything that was editable in the
// previous one needs to be editable here. So there's no more Project
// Settings."*
//
// ★★★ THIS IS `ProjectSettingsModal`'s FORM STATE, LIFTED OUT OF ITS MODAL.
//     The 1,433-line modal is deleted; what it *knew* is not. Its `FormState`,
//     `initForm` and `permitToRow` move here unchanged in shape, so the atomic
//     `bp_update_project_with_permits` save that fix-36 built keeps working
//     byte for byte and the merge is a MOVE rather than a rewrite. A rewrite
//     of eighteen fields against the same RPC is the fix-415 defect class —
//     two write paths for one column — applied to a whole form at once.
//
// ★★ AND IT LIVES IN `lib`, NOT BESIDE THE COMPONENT, because
//    `react-refresh/only-export-components` is an ERROR in this repo: a
//    component file may export components and types and nothing else. Same
//    rule that moved helpers in fix-403, fix-408, fix-499 and fix-506.

export interface ProjectScalarFields {
  go_date: string;
  units: string;
  zone: string;
  lot_width: string;
  lot_depth: string;
  /** ★ fix-488 §A: the TYPED lot area in square feet. Blank is a real answer. */
  lot_size_sf: string;
  alley: string;
  /** fix-91: an array (multi-select). */
  product_types: string[];
  entitlement_lead: string;
  design_manager: string;
  /** ★ fix-487 (P-144): the project's Construction Admin. */
  construction_admin: string;
  /** fix-175: per-project point-of-contact (NOT a builder catalog field). */
  poc_name: string;
  poc_email: string;
}

export interface BpRoleFields {
  da: string;
}

export interface BuilderFlatFields {
  builder_name: string;
  builder_company: string;
  builder_email: string;
  builder_phone: string;
  builder_address: string;
}

export interface PermitRow {
  id: number | null;
  isNew: boolean;
  isDeleted: boolean;
  type: string;
  ent_lead: string;
  da: string;
  portal_url: string;
  num: string;
  struct_address: string;
  /**
   * ★★★ fix-514 §G (P-221) — THE ACQ DATE, PER PERMIT. THE NEW FIELD.
   *
   * fix-513 §E was briefed to move `PermitDetailV2`'s `expected_issue` editor
   * into Project Data and **correctly refused**: Project Data's `AcqDateRow`
   * addresses `bp.id` and nothing else, and 153 non-Building-Permit permits
   * across 105 projects carry a DIFFERENT ACQ date by design — a ULS is seeded
   * at `bp_acq + 120` days. Moving the control would have stranded all 153
   * while Schedule Health kept deriving a per-permit target from a value
   * nobody could edit.
   *
   * ★★ The refusal was the requirement. A form that already addresses permits
   *    ROW BY ROW is the surface that can hold this, so the field rides in the
   *    same atomic save as the row's type, ENT and DA — one write, one OCC
   *    token, no new RPC. That is what lets `PermitDetailV2`'s editor go and
   *    P-207's writer count fall from two to one.
   */
  expected_issue: string;
  /**
   * ★★★ fix-517 §E — THE ONE FIELD fix-514's PERMITS TAB DID NOT HAVE.
   *
   * `QuickEditPermitModal` held Permit Type · ENT/DA/CA · Permit Number ·
   * Sub-permit of · Structure Address · Portal URL, and this tab already held
   * every one of those except this. §E deletes the modal, so the field comes
   * here rather than becoming uneditable — 3 of 685 prod permits are
   * sub-permits, and fix-194 built the marker to keep them out of every
   * rollup, so an unclearable one is a permanently mis-counted permit.
   *
   * ★ A STRING, like every other box on this form: it is a `<select>` value,
   *   `''` means "not a sub-permit", and the save converts once.
   */
  parent_permit_id: string;
  updated_at?: string | null;
}

export interface ProjectDetailsFormState {
  address: string;
  juris: string;
  acq_lead: string;
  archived: boolean;
  /** ★★ fix-386: `null` is "not recorded" and is a distinct third state. */
  is_backfill: boolean | null;
  projectFields: ProjectScalarFields;
  builder: BuilderFlatFields;
  bpRole: BpRoleFields;
  permits: PermitRow[];
}

export function permitToRow(p: PermitWithCycles): PermitRow {
  return {
    id: p.id,
    isNew: false,
    isDeleted: false,
    type: p.type ?? '',
    ent_lead: p.ent_lead ?? '',
    da: p.da ?? '',
    portal_url: p.portal_url ?? '',
    num: p.num ?? '',
    struct_address: p.struct_address ?? '',
    expected_issue: p.expected_issue ?? '',
    parent_permit_id:
      p.parent_permit_id != null ? String(p.parent_permit_id) : '',
    updated_at: p.updated_at,
  };
}

export function initProjectDetailsForm(
  project: Project,
  permits: PermitWithCycles[],
): ProjectDetailsFormState {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  return {
    address: project.address ?? '',
    juris: project.juris ?? '',
    acq_lead: project.acq_lead ?? '',
    archived: !!project.archived,
    is_backfill: project.is_backfill ?? null,
    builder: {
      builder_name: project.builder_name ?? '',
      builder_company: project.builder_company ?? '',
      builder_email: project.builder_email ?? '',
      builder_phone: project.builder_phone ?? '',
      builder_address: project.builder_address ?? '',
    },
    projectFields: {
      go_date: project.go_date ?? '',
      units: project.units != null ? String(project.units) : '',
      zone: project.zone ?? '',
      lot_width: project.lot_width != null ? String(project.lot_width) : '',
      lot_depth: project.lot_depth != null ? String(project.lot_depth) : '',
      lot_size_sf: project.lot_size_sf != null ? String(project.lot_size_sf) : '',
      alley: project.alley ?? '',
      product_types: Array.isArray(project.product_types) ? project.product_types : [],
      entitlement_lead: project.entitlement_lead ?? '',
      construction_admin: project.construction_admin ?? '',
      design_manager: project.design_manager ?? '',
      poc_name: project.poc_name ?? '',
      poc_email: project.poc_email ?? '',
    },
    bpRole: { da: bp?.da ?? '' },
    permits: permits.map(permitToRow),
  };
}

// ===========================================================================
// ★★★ §B (P-191) — SAVE vs EXIT IS A DIRTY-STATE CONTRACT, NOT A LABEL
// ===========================================================================
//
// Bobby: *"if you're making a change, then instead of clicking Done it says
// **Save**, and if you don't make a change you have the X at the top and it
// would say **Exit** versus Done."*
//
// ★★★ ONE FLAG FOR THE WHOLE MODAL, NOT ONE PER TAB. §B says so explicitly and
//     the reason is worth keeping: a per-tab flag is how two tabs end up
//     disagreeing about whether the modal is clean, and the person is then
//     shown `Exit` while holding an unsaved edit on the tab they are not
//     looking at. The comparison below is over the WHOLE form, so switching
//     tabs cannot change the answer.
//
// ★★ AND IT IS A COMPARISON, NOT A TOUCHED-FLAG. `onChange` setting
//    `dirty = true` would call a field dirty after you typed a character and
//    deleted it again, which is the state the button is supposed to
//    distinguish. Comparing against the form as it was initialised means
//    "changed it back" reads as clean, which is what a person means by it.
//
// ★ THE FIELDS THAT ARE NOT IN THIS FORM ARE NOT IN THIS COMPARISON, and that
//   is correct rather than a gap: the per-field tabs (Site data's zone/lot
//   rows, Dates, Unit dimensions, Consultants) commit on blur through their
//   own hooks and were never part of a draft. `Save` here means "commit the
//   atomic form"; those tabs have already saved by the time you look at them,
//   which is what their own captions have said since fix-506.

/** Deep-equality over the form, field by field. */
export function projectDetailsFormIsDirty(
  initial: ProjectDetailsFormState,
  current: ProjectDetailsFormState,
): boolean {
  if (
    initial.address !== current.address ||
    initial.juris !== current.juris ||
    initial.acq_lead !== current.acq_lead ||
    initial.archived !== current.archived ||
    initial.is_backfill !== current.is_backfill ||
    initial.bpRole.da !== current.bpRole.da
  ) {
    return true;
  }
  for (const k of Object.keys(initial.builder) as (keyof BuilderFlatFields)[]) {
    if (initial.builder[k] !== current.builder[k]) return true;
  }
  for (const k of Object.keys(initial.projectFields) as (keyof ProjectScalarFields)[]) {
    const a = initial.projectFields[k];
    const b = current.projectFields[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = (a as string[]) ?? [];
      const bb = (b as string[]) ?? [];
      if (aa.length !== bb.length || aa.some((v, i) => v !== bb[i])) return true;
    } else if (a !== b) {
      return true;
    }
  }
  if (initial.permits.length !== current.permits.length) return true;
  for (let i = 0; i < current.permits.length; i++) {
    const a = initial.permits[i];
    const b = current.permits[i];
    // ★ A row APPENDED or REMOVED is dirty even before a character is typed —
    //   "+ Add Permit Type" is an edit, and so is marking one deleted.
    if (!a) return true;
    if (
      a.isDeleted !== b.isDeleted ||
      a.isNew !== b.isNew ||
      a.type !== b.type ||
      a.ent_lead !== b.ent_lead ||
      a.da !== b.da ||
      a.portal_url !== b.portal_url ||
      a.num !== b.num ||
      a.struct_address !== b.struct_address ||
      a.expected_issue !== b.expected_issue
    ) {
      return true;
    }
  }
  return false;
}

// ===========================================================================
// ★★★ §C (P-191) — SEARCH INSIDE PROJECT DETAILS
// ===========================================================================
//
// Bobby: *"right next to where it says Project Details, if there was a
// **search** — you type it in and it takes you to that tab, so you can see
// where that update actually lives."*
//
// ★★★ BUILT SO [[P-166-settings-needs-categories-and-search]] CAN REUSE IT.
//     §C says this is P-166's ask at project scale — *"same mechanism, smaller
//     tree. Build it here and P-166 inherits a working pattern."* So the
//     matcher below is generic over `{ key, label, terms }` and knows nothing
//     about projects: Settings can hand it its own sections tomorrow and get
//     the same behaviour without a second implementation.
//
// ★★ THE INDEX IS A DECLARED LIST, NOT A DOM SCRAPE. A search that reads
//    rendered labels only finds the tab you are already on — every other tab
//    is unmounted. Declaring the terms is also what lets a field be findable
//    by a name it is NOT labelled with: somebody looking for "ACQ" should land
//    on Permits, and somebody typing "square footage" should land on Units.

export interface SearchableEntry<K extends string = string> {
  /** Where a hit navigates to. */
  key: K;
  /** What the destination is called. */
  label: string;
  /** Everything this destination should be findable by, lower-cased. */
  terms: readonly string[];
}

/**
 * Rank entries against a query. Returns matches best-first, or `[]`.
 *
 * ★ A term that STARTS WITH the query outranks one that merely contains it, so
 *   typing "lot" offers "Lot width" before "Alley or lot line". Ties keep the
 *   declared order, which is the tab order — a stable answer beats a clever one.
 */
export function searchEntries<K extends string>(
  entries: readonly SearchableEntry<K>[],
  query: string,
): SearchableEntry<K>[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const scored: { entry: SearchableEntry<K>; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    let best = 0;
    for (const t of entry.terms) {
      if (t === q) best = Math.max(best, 3);
      else if (t.startsWith(q)) best = Math.max(best, 2);
      else if (t.includes(q)) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ entry, score: best, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.entry);
}

/**
 * ★★★ EVERY FIELD PROJECT DETAILS EDITS, AND WHICH TAB IT LIVES ON.
 *
 * ★★ This doubles as §A's completeness claim in a form a test can read. §A0
 *    enumerated what Project Settings still owned; every one of those entries
 *    is below with a tab that is not `null`, which is what "the leftover set is
 *    now zero" means operationally rather than rhetorically.
 */
export const PROJECT_DETAILS_SEARCH: readonly SearchableEntry<ProjectDataTab>[] = [
  // --- Site data -----------------------------------------------------------
  { key: 'site', label: 'Address', terms: ['address', 'project address', 'street'] },
  { key: 'site', label: 'Jurisdiction', terms: ['jurisdiction', 'juris', 'city'] },
  { key: 'site', label: 'Zone', terms: ['zone', 'zoning'] },
  { key: 'site', label: 'Lot width', terms: ['lot width', 'width', 'lot'] },
  { key: 'site', label: 'Lot depth', terms: ['lot depth', 'depth', 'lot'] },
  { key: 'site', label: 'Lot size', terms: ['lot size', 'square feet', 'sf', 'area'] },
  { key: 'site', label: 'Alley', terms: ['alley'] },
  { key: 'site', label: 'Corner lot', terms: ['corner', 'corner lot'] },
  { key: 'site', label: 'Project tags', terms: ['tags', 'project tags', 'tag'] },
  { key: 'site', label: 'Reuse of', terms: ['reuse', 'reused from', 'plan reuse'] },
  // --- Dates ---------------------------------------------------------------
  { key: 'dates', label: 'GO date', terms: ['go date', 'go'] },
  { key: 'dates', label: 'Closing date', terms: ['closing', 'closing date'] },
  { key: 'dates', label: 'DD start / DD end', terms: ['dd', 'dd start', 'dd end', 'design development'] },
  { key: 'dates', label: 'Target submit', terms: ['target submit', 'submit'] },
  { key: 'dates', label: 'ACQ date (Building Permit)', terms: ['acq date', 'acq'] },
  { key: 'dates', label: 'Intake accepted', terms: ['intake', 'intake accepted'] },
  // --- Units ---------------------------------------------------------------
  { key: 'units', label: 'Unit count', terms: ['unit count', 'units', 'number of units'] },
  { key: 'units', label: 'Unit width / depth', terms: ['unit width', 'unit depth', 'dimensions'] },
  { key: 'units', label: 'Unit size (sf)', terms: ['unit size', 'square footage', 'size sf', 'floor area'] },
  { key: 'units', label: 'Parking', terms: ['parking', 'stalls', 'garage'] },
  { key: 'units', label: 'Product types', terms: ['product type', 'product types', 'product'] },
  // --- Permits -------------------------------------------------------------
  { key: 'permits', label: 'Permit type', terms: ['permit type', 'permit', 'type'] },
  { key: 'permits', label: 'Permit number', terms: ['permit number', 'permit #', 'num'] },
  { key: 'permits', label: 'Permit portal URL', terms: ['portal', 'portal url', 'url', 'link'] },
  { key: 'permits', label: 'Structure address', terms: ['structure address', 'struct address'] },
  { key: 'permits', label: 'ACQ target date (per permit)', terms: ['acq target', 'acq', 'expected issue'] },
  { key: 'permits', label: 'Permit ENT lead / DA', terms: ['ent lead', 'da', 'design associate'] },
  // --- Builder / Owner -----------------------------------------------------
  { key: 'builder', label: 'Builder', terms: ['builder', 'owner', 'builder name', 'company'] },
  { key: 'builder', label: 'Point of contact', terms: ['point of contact', 'poc', 'contact'] },
  { key: 'builder', label: 'Contact email', terms: ['contact email', 'email'] },
  // --- Internal team -------------------------------------------------------
  { key: 'team', label: 'Acquisitions', terms: ['acquisitions', 'acq lead'] },
  { key: 'team', label: 'Entitlement lead', terms: ['entitlement lead', 'ent', 'entitlement'] },
  { key: 'team', label: 'Schematic designer', terms: ['schematic designer', 'schematic', 'sd'] },
  { key: 'team', label: 'Design manager', terms: ['design manager', 'dm'] },
  { key: 'team', label: 'Design associate', terms: ['design associate', 'da'] },
  { key: 'team', label: 'Construction admin', terms: ['construction admin', 'ca'] },
  // --- Consultants ---------------------------------------------------------
  { key: 'consultants', label: 'Consultants', terms: ['consultant', 'consultants', 'firm', 'discipline'] },
  // --- Plan of record ------------------------------------------------------
  { key: 'plan', label: 'Plan of record', terms: ['plan of record', 'plan', 'drawing', 'sheet'] },
  // --- Actions -------------------------------------------------------------
  { key: 'actions', label: 'Hold / cancel', terms: ['hold', 'on hold', 'cancel', 'cancelled'] },
  { key: 'actions', label: 'Archive', terms: ['archive', 'archived'] },
  { key: 'actions', label: 'Backfill', terms: ['backfill', 'is backfill'] },
  { key: 'actions', label: 'Reassign DA', terms: ['reassign', 'reassign da', 'handoff'] },
  { key: 'actions', label: 'Spawn redesign', terms: ['redesign', 'spawn redesign'] },
  { key: 'actions', label: 'Delete project', terms: ['delete', 'remove project'] },
];
