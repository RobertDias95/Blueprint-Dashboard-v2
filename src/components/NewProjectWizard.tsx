import { useMemo, useState } from 'react';
import { roundLotForStorage } from '../lib/lotDimensions';
import { Link, useNavigate } from 'react-router-dom';
import { useOriginState } from '../hooks/useOriginState';
import {
  useCreateProjectWithPermits,
  type PermitInput,
  type ProjectData,
} from '../hooks/useCreateProjectWithPermits';
import { useJurisdictions } from '../hooks/useJurisdictions';
import { usePermitTypes } from '../hooks/usePermitTypes';
import { usePlaceNewProjectOnDa } from '../hooks/usePlaceNewProjectOnDa';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import Step1ProjectInfo from './wizard/Step1ProjectInfo';
import DuplicateAddressWarning from './wizard/DuplicateAddressWarning';
import { useDuplicateAddressCheck } from '../hooks/useDuplicateAddressCheck';
import { normalizeAddress } from '../lib/addressMatch';
import Step2Questionnaire from './wizard/Step2Questionnaire';
import Step3Permits from './wizard/Step3Permits';
import Step4TaskReview from './wizard/Step4TaskReview';
import {
  applySeeding,
  makeEmptyWizardState,
  newPermitRowId,
  unitsIsValid,
  type WizardPermit,
  type WizardState,
} from './wizard/wizardState';
import { pushToast } from '../stores/toastStore';
import { findDmForDa } from './wizard/dmRouting';
import { useDmDaGroups } from '../hooks/useDmDaGroups';
import { lookupEntLeadForDa } from '../hooks/useDaTeamRouting';
import { snapToMonday, addDays } from '../lib/dateUtils';
import type { RedesignTrigger } from '../lib/database.types';

// fix-22: 4-step Stepper-driven New Project wizard. Replaces v2's
// previous single-screen wizard with the V1 flow (Project Info →
// Questionnaire → Permits → Task Review). Server-side handling:
// bp_create_project_with_permits accepts a structured p_project_data
// for the 13 project-level fields and a task_template_ids[] per permit.
//
// Cross-step contract:
//   - Step 1 collects 15 project-level fields (incl. role defaults).
//   - Step 2 toggles which permit types to create. Building Permit is
//     always selected + locked. Newly checked permits get a new
//     WizardPermit row seeded from Step 1's defaults.
//   - Step 3 lets the user override ent_lead/dm/da/target_submit/num
//     per permit. Building Permit is always in the list (auto-injected
//     if Step 2 didn't seed it).
//   - Step 4 toggles per-permit task templates. Default-checks every
//     applicable template on first visit; "Clear all" is a real signal.
//
// Submit walks the WizardState into the RPC payload, lazily adding the
// Building Permit row if Step 2/3 hasn't.

const BUILDING_PERMIT = 'Building Permit';

interface Props {
  open: boolean;
  onClose: () => void;
  /** fix-126: when provided, the wizard initializes with this seed
   *  instead of an empty state. Used by ProjectDetail's "Spawn
   *  Redesign" entry point — see makeRedesignWizardState in
   *  wizardState.ts. The state is reset back to this seed each time
   *  the wizard opens, so reopening from the same parent yields a
   *  fresh prefilled form. When omitted the wizard uses
   *  makeEmptyWizardState (the default new-project flow). */
  initialState?: WizardState;
}

type StepIndex = 1 | 2 | 3 | 4;
const STEPS: { idx: StepIndex; label: string }[] = [
  { idx: 1, label: 'Project Info' },
  { idx: 2, label: 'Questionnaire' },
  { idx: 3, label: 'Permits' },
  { idx: 4, label: 'Task Review' },
];

function makeBpPermit(state: WizardState): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type: BUILDING_PERMIT,
    selected: true,
    // fix-91: Step 1 no longer collects ent_lead / design_manager; the
    // BP is born blank on both fields and Step 3's DA pick fills
    // ent_lead via bp_ent_lead_for_da.
    ent_lead: '',
    dm: '',
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    // fix-91: inherit the Step-1 ACQ Target as the BP's initial
    // expected_issue. Per-permit overrides on Step 3 still win.
    expected_issue: state.acq_target,
    target_submit: '',
    manuallyEdited: {},
    taskTemplateIds: [],
  };
}

/** Convert the form's string-typed numerics to the wire shape. Empty or
 *  zero is null on the wire so the DB keeps clean NULLs. */
function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '' || t === '0' || t === '0.00') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : Math.trunc(n);
}
function strOrNull(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}
/** fix-122: tri-state Yes/No/blank → boolean | null. The Corner Lot
 *  select keeps blank as "user hasn't picked" so historical projects
 *  don't get silently flipped to a false answer on the wire. */
function boolFromTri(v: string): boolean | null {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

export default function NewProjectWizard({ open, onClose, initialState }: Props) {
  const navigate = useNavigate();
  // ★ fix-408: the wizard is a MODAL over whatever page you were on, so the
  //   project it creates opens with THAT page as its origin — Previous takes
  //   you back where you were working, not to a list you never opened.
  const originState = useOriginState();
  const create = useCreateProjectWithPermits();
  const placeOnDa = usePlaceNewProjectOnDa();
  // fix-220: manual DA placement writes draw_schedule, an admin-only mutation.
  // Project creation itself stays open to editors (the create RPC lays the
  // initial lane); for non-admins we simply skip the secondary explicit
  // placement, which would otherwise hit an RLS denial and toast an error.
  const canEditSchedule = useIsTenantAdmin();
  const jurisQ = useJurisdictions();
  const typesQ = usePermitTypes();
  // fix-91: derive project-level ent_lead + design_manager on submit
  // from the BP's DA. dmDaGroups is the source for DM; ent_lead routes
  // through bp_ent_lead_for_da. Cached in this hook so the submit path
  // doesn't refetch.
  const dmDaGroupsQ = useDmDaGroups();

  const [step, setStep] = useState<StepIndex>(1);
  // fix-126: seed from initialState (redesign mode) or fall back to the
  // empty new-project shape. The state-init lazy callback is preserved
  // so the initial render doesn't recompute the empty state every time.
  const [state, setState] = useState<WizardState>(
    () => initialState ?? makeEmptyWizardState(),
  );
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [conflictExistingId, setConflictExistingId] = useState<string | null>(
    null,
  );

  // ★★ fix-333: the duplicate-address check lives HERE, not inside Step 1.
  //
  // Submit needs the same verdict Step 1 is showing. Two instances of the hook
  // could disagree — one debounced past a keystroke the other has not seen — and
  // a backstop that disagrees with the banner is worse than no backstop.
  const duplicate = useDuplicateAddressCheck(
    state.address,
    state.redesign_of_project_id,
    open,
  );
  // ★ The acknowledgement is tied to the ADDRESS KEY, not to the raw string.
  // Saying "this is a different project" and then editing the address must
  // re-arm the warning — but adding a trailing space must not. The key is the
  // same value the match runs on, so the two can never disagree about whether
  // the address changed.
  //
  // ★ Stored as "the key that was acknowledged" and DERIVED, rather than a
  // boolean reset by an effect. An effect that setStates on a changed key is
  // the React Compiler's cascading-render warning, and it also renders one
  // frame claiming the new address is acknowledged before correcting itself.
  const [ackedKey, setAckedKey] = useState<string | null>(null);
  const dupKey = normalizeAddress(state.address).key;
  const dupAcknowledged = ackedKey !== null && ackedKey === dupKey;

  const jurisOptions = jurisQ.data ?? [];
  const typeOptions = typesQ.data ?? [];
  const catalogReady = jurisOptions.length > 0 && typeOptions.length > 0;

  function patch(p: Partial<WizardState>) {
    // fix-Phase-B: re-seed per-permit ACQ Target / Target Submit after every
    // change. applySeeding fills non-manually-edited fields from the GO date
    // + the BP's ACQ anchor, so editing any of those (or adding/removing a
    // permit) reactively updates the seeded defaults.
    setState((s) => applySeeding({ ...s, ...p }));
  }

  function reset() {
    // fix-126: reset back to the seed when one was passed (redesign mode)
    // so reopening the wizard from the same parent gets a fresh
    // prefilled form. Otherwise fall back to the empty new-project shape.
    setState(initialState ?? makeEmptyWizardState());
    setStep(1);
    setValidationErr(null);
    setConflictExistingId(null);
    setAckedKey(null);
  }
  function handleClose() {
    reset();
    onClose();
  }

  /** Per-step "ready to advance" check. Step 4 → submit. */
  const stepError = useMemo<string | null>(() => {
    if (step === 1) {
      if (!state.address.trim()) return 'Please enter a project address.';
      if (!state.juris.trim()) return 'Please pick a jurisdiction.';
      // fix-88: Units count is required at submit time. 2 prod projects
      // (2724 Walnut Ave SW + one other) were saved with NULL units
      // because the wizard never gated this; the badge on Project
      // Overview makes the existing ones visible, this gate prevents
      // any new ones.
      if (!unitsIsValid(state.units))
        return 'Units count is required (must be greater than 0).';
      return null;
    }
    if (step === 2) {
      // BP is always selected; we accept any state on Step 2.
      return null;
    }
    if (step === 3 || step === 4) {
      return null;
    }
    return null;
  }, [step, state.address, state.juris, state.units]);

  function goNext() {
    setValidationErr(null);
    if (stepError) {
      setValidationErr(stepError);
      return;
    }
    if (step < 4) setStep(((step as number) + 1) as StepIndex);
  }
  function goBack() {
    setValidationErr(null);
    if (step > 1) setStep(((step as number) - 1) as StepIndex);
  }

  async function handleSubmit() {
    setValidationErr(null);
    setConflictExistingId(null);

    if (!state.address.trim()) {
      setStep(1);
      setValidationErr('Please enter a project address.');
      return;
    }
    if (!state.juris.trim()) {
      setStep(1);
      setValidationErr('Please pick a jurisdiction.');
      return;
    }
    // fix-88: Units required at submit. Same banner pattern as the other
    // step-1 fields; Step1ProjectInfo reads validationErr-on-step-1 via
    // the showFieldErrors prop so the input goes red the moment the user
    // lands back on the step.
    if (!unitsIsValid(state.units)) {
      setStep(1);
      setValidationErr('Units count is required (must be greater than 0).');
      return;
    }

    // ★★ fix-333: THE BACKSTOP. The as-you-type banner is the real fix, but the
    // address can be edited after it settled — including on the way back through
    // Step 1 — so submit re-reads the same verdict before writing.
    //
    // ★ THIS IS NOT A BLOCK. It sends the person to the warning ONCE, and the
    // acknowledgement they give there lets the very next submit through. The
    // brief is unambiguous that neighbours must be creatable without a fight, so
    // only a genuine `duplicate` stops here — an expected redesign and a nearby
    // address never do.
    if (duplicate.verdict === 'duplicate' && !dupAcknowledged) {
      setStep(1);
      setValidationErr(
        'This address looks like a project that already exists — check the match below, then confirm to carry on.',
      );
      return;
    }

    // fix-126: redesign mode flag — hoisted here so the backfill-DD path below
    // can opt out. A redesign's DD window is owned solely by the Redesign DD
    // Phase section (fix-191), so the top-level backfill DD inputs are hidden
    // on the redesign path and must never feed the BP row on submit.
    const isRedesign = state.redesign_of_project_id !== '';

    // fix-143: backfill mode requires both manual DD dates once a lead DA is
    // picked — the manually-placed lane can't be built without them.
    // fix-191: never on a redesign (those inputs are hidden; lead_da is blank
    // on a redesign anyway, so this guard is belt-and-suspenders).
    if (
      !isRedesign &&
      state.backfill_mode &&
      state.lead_da.trim() !== '' &&
      (!state.backfill_dd_start || !state.backfill_dd_end)
    ) {
      setStep(1);
      setValidationErr(
        'Backfill mode: enter both DD Start and DD End for the Building Permit.',
      );
      return;
    }

    // fix-143: Monday-align the manual backfill DD dates (matches the fix-141
    // picker). dd_start → next Monday; dd_end → Friday of its end-week; guard
    // against a snapped end landing before the start.
    // fix-191: skipped on a redesign — the Redesign DD Phase is the single
    // source there, so stale backfill values never reach the BP permit.
    let backfillDdStart: string | null = null;
    let backfillDdEnd: string | null = null;
    if (
      !isRedesign &&
      state.backfill_mode &&
      state.backfill_dd_start &&
      state.backfill_dd_end
    ) {
      backfillDdStart = snapToMonday(state.backfill_dd_start, 'forward');
      backfillDdEnd = addDays(snapToMonday(state.backfill_dd_end, 'back'), 4);
      if (backfillDdStart && backfillDdEnd && backfillDdEnd < backfillDdStart) {
        backfillDdEnd = addDays(backfillDdStart, 4);
      }
    }

    // fix-126: redesign mode flags. Reuse=yes redesigns send empty
    // permits[] and the RPC short-circuits permit creation entirely.
    // Required trigger gate too — wizard validates Trigger Source
    // before submit (the dropdown defaults to '' so the user has to pick).
    // (isRedesign is hoisted above for the backfill-DD opt-out.)
    const isReuseRedesign =
      isRedesign && state.redesign_reuses_original_permit === 'yes';
    if (isRedesign && !state.redesign_trigger) {
      setStep(1);
      setValidationErr('Pick a redesign Trigger Source on Step 1.');
      return;
    }

    // fix-144/fix-158: the Redesign DD Phase builds the redesign's Draw Schedule
    // lane — for the reuses branch (no permits, its only path onto the schedule)
    // AND the own-permits branch (fix-158: the BP-based path misses non-BP
    // permits / ent-less redesigns). Require DA + both dates for EVERY redesign,
    // then Monday/Friday-snap (fix-141 helpers).
    let redesignDdStart: string | null = null;
    let redesignDdEnd: string | null = null;
    if (isRedesign) {
      if (
        !state.redesign_dd_da ||
        !state.redesign_dd_start ||
        !state.redesign_dd_end
      ) {
        setStep(1);
        setValidationErr(
          'Redesign draw schedule: enter DA, DD Start, and DD End.',
        );
        return;
      }
      redesignDdStart = snapToMonday(state.redesign_dd_start, 'forward');
      redesignDdEnd = addDays(snapToMonday(state.redesign_dd_end, 'back'), 4);
      if (redesignDdStart && redesignDdEnd && redesignDdEnd < redesignDdStart) {
        redesignDdEnd = addDays(redesignDdStart, 4);
      }
    }

    // Selected permits + auto-inject Building Permit if Steps 2/3 didn't.
    // Reuse=yes redesigns SKIP the BP auto-inject — the redesign creates
    // no permits at all.
    let selectedPermits: WizardPermit[] = [];
    if (!isReuseRedesign) {
      selectedPermits = state.permits.filter((p) => p.selected);
      if (!selectedPermits.some((p) => p.type === BUILDING_PERMIT)) {
        selectedPermits = [makeBpPermit(state), ...selectedPermits];
      }
    }

    // fix-91: derive project-level ent_lead + design_manager from the BP
    // permit's DA. We still write them to projects.* on submit even
    // though Step 1 stopped asking — downstream reads (reports, lists,
    // schedule-health) depend on those project-level columns. The
    // wizard state's entitlement_lead is whatever Step 3's DA-routing
    // lookup populated on the BP row; we use it as the project-level
    // fallback. If the BP row's ent_lead is still blank (DA not in
    // routing) we run one final lookup here defensively, then accept
    // whatever the user typed.
    const bpRow =
      selectedPermits.find((p) => p.type === BUILDING_PERMIT) ?? null;
    let derivedEntLead = bpRow?.ent_lead?.trim() ?? '';
    if (!derivedEntLead && bpRow?.da) {
      try {
        const routed = await lookupEntLeadForDa(
          bpRow.da,
          state.juris || null,
        );
        if (routed) derivedEntLead = routed;
      } catch {
        // Lookup failure is non-fatal — submit continues with a blank
        // project-level ent_lead. The user can fill it in via Project
        // Settings later.
      }
    }
    const derivedDm =
      bpRow?.da ? findDmForDa(bpRow.da, dmDaGroupsQ.rows) ?? '' : '';

    // Walk WizardState → RPC payload.
    const projectData: ProjectData = {
      entitlement_lead: strOrNull(derivedEntLead),
      design_manager: strOrNull(derivedDm),
      acq_lead: strOrNull(state.acq_lead),
      // fix-222: Schematic Designer → projects.schematic_designer (text[]).
      // Single picker today, so a 0- or 1-element array.
      schematic_designer: state.schematic_designer.trim()
        ? [state.schematic_designer.trim()]
        : [],
      go_date: strOrNull(state.go_date),
      units: intOrNull(state.units),
      zone: strOrNull(state.zone),
      // ★ fix-415 B2: rounded as the wizard submits — the third write path.
      //   Rounding here rather than in Step 1's onChange keeps a half-typed
      //   "100." intact while the user is still typing it.
      lot_width: roundLotForStorage(numOrNull(state.lot_width)),
      lot_depth: roundLotForStorage(numOrNull(state.lot_depth)),
      unit_types: state.unit_types.length > 0 ? state.unit_types : null,
      // ★ fix-402: site parking is gone — it lives on each unit now.
      alley: strOrNull(state.alley),
      // fix-91: send the multi-select array. Empty array is fine —
      // the RPC stores it as projects.product_types = '{}'.
      product_types: state.product_types,
      project_tags: state.project_tags.length > 0 ? state.project_tags : null,
      // fix-22-final / Migration 6 + 7: Builder/Owner contact fields.
      builder_name: strOrNull(state.builder_name),
      builder_company: strOrNull(state.builder_company),
      builder_email: strOrNull(state.builder_email),
      builder_phone: strOrNull(state.builder_phone),
      // fix-175: owner LLC address (-> builders catalog) + per-project POC.
      builder_address: strOrNull(state.builder_address),
      poc_name: strOrNull(state.poc_name),
      poc_email: strOrNull(state.poc_email),
      // ★★★ fix-386: the "Backfill?" answer is finally KEPT. Until now the
      // checkbox only unlocked the manual DD dates (fix-143) and the answer was
      // thrown away, which is why fix-378 had to INFER the same fact from
      // created_at. Sent unconditionally — true or false, never omitted — so
      // every project created from here has a recorded answer and the "not
      // recorded" null population only ever shrinks.
      is_backfill: state.backfill_mode,
      // fix-107: thread Step 1's Lead DA. When non-null the RPC calls
      // bp_next_available_da_slot to auto-place the BP at the DA's
      // first open slot (no overlap with any draw_schedule or
      // da_time_blocks block) and writes a matching draw_schedule row.
      lead_da: strOrNull(state.lead_da),
      // fix-122: three new project-level physical/closing fields.
      // num_lots: CHECK constraint enforces >=1, so intOrNull's empty
      // → null is the right "user didn't pick" representation.
      num_lots: intOrNull(state.num_lots),
      is_corner_lot: boolFromTri(state.is_corner_lot),
      // ★ fix-410: always a real boolean — the form has no blank state for it,
      //   so every project created here carries a recorded answer.
      is_regular_shape: boolFromTri(state.is_regular_shape),
      closing_date: strOrNull(state.closing_date),
      // fix-126: redesign payload. Only sent when the wizard was
      // opened from a "Spawn Redesign" entry point (parent FK is set);
      // for a fresh project all four columns stay NULL on the row.
      redesign_of_project_id: strOrNull(state.redesign_of_project_id),
      redesign_trigger:
        (strOrNull(state.redesign_trigger) as RedesignTrigger | null) ?? null,
      redesign_reuses_original_permit: boolFromTri(
        state.redesign_reuses_original_permit,
      ),
      redesign_notes: strOrNull(state.redesign_notes),
      // fix-216: reuse provenance link. Product types + unit types were already
      // copied into the form on source-select (copy-once); here we persist only
      // the link so the DA reuse metric + the "Reuse of <address>" badge work.
      reused_from_project_id: strOrNull(state.reused_from_project_id),
    };

    const permitsPayload: PermitInput[] = selectedPermits.map((p) => ({
      type: p.type,
      num: p.num.trim() || undefined,
      ent_lead: strOrNull(p.ent_lead) ?? undefined,
      dm: strOrNull(p.dm) ?? undefined,
      // fix-158: an own-permits redesign's DA comes from the Redesign DD Phase
      // section (the single DA for the redesign). Apply it to the created
      // permits so the permit DA matches the lane DA the RPC places from the
      // same section — keeping the BP↔lane DA sync trigger consistent.
      da:
        isRedesign && state.redesign_dd_da
          ? state.redesign_dd_da
          : strOrNull(p.da) ?? undefined,
      dual_da: strOrNull(p.dual_da) ?? undefined,
      architect: strOrNull(p.architect) ?? undefined,
      // fix-25c / fix-91: "ACQ Target" → expected_issue. The BP row
      // inherited state.acq_target via makeBpPermit; per-permit edits
      // on Step 3 win. Defense in depth: if the BP somehow lost its
      // value, fall back to state.acq_target.
      expected_issue:
        strOrNull(p.expected_issue) ??
        (p.type === BUILDING_PERMIT
          ? strOrNull(state.acq_target) ?? undefined
          : undefined),
      // fix-25-feat-h: optional Target Submit. For BPs the cascade
      // (bp_set_bp_dd_dates: dd_end + 14) will overwrite this once DD
      // dates land, so an empty string here is fine. Non-BPs rely on
      // this field as their only target_submit anchor.
      target_submit: strOrNull(p.target_submit) ?? undefined,
      task_template_ids: p.taskTemplateIds,
      // fix-143: inject the snapped manual DD dates onto the BP row only.
      // Their presence makes the RPC skip auto-placement and build a
      // manually-placed lane from them instead.
      dd_start:
        p.type === BUILDING_PERMIT ? backfillDdStart ?? undefined : undefined,
      dd_end:
        p.type === BUILDING_PERMIT ? backfillDdEnd ?? undefined : undefined,
    }));

    try {
      const result = await create.mutateAsync({
        address: state.address.trim(),
        juris: state.juris.trim(),
        notes: state.notes.trim() || undefined,
        project_data: projectData,
        permits: permitsPayload,
        // fix-143: flag the lane manually_placed when manual DD dates built it.
        manually_placed: !!(backfillDdStart && backfillDdEnd),
        // fix-144/fix-158: Redesign DD phase → the RPC places a manually_placed
        // lane for the redesign project. Sent for EVERY redesign: the reuses
        // branch (no permits) and the own-permits branch alike.
        redesign_dd_phase:
          isRedesign && redesignDdStart && redesignDdEnd
            ? {
                da: state.redesign_dd_da,
                dd_start: redesignDdStart,
                dd_end: redesignDdEnd,
              }
            : undefined,
      });

      if (result.conflict) {
        setConflictExistingId(result.project_id);
        return;
      }

      // Q9.5.f-fix-20 carry-over: auto-place on the first selected
      // permit's DA. Same UX semantics as before — silent fallback to
      // unscheduled lane if no DA was chosen.
      // fix-158: a redesign already had its lane placed by the RPC from the
      // Redesign DD Phase (redesign_dd_phase), so skip this — placeOnDa would
      // only early-return on the existing lane, or worse re-place at the DA's
      // frontier instead of the entered DD dates.
      const redesignLanePlaced =
        isRedesign && !!redesignDdStart && !!redesignDdEnd;
      const firstDa = selectedPermits.find((p) => p.da && p.da.trim() !== '')?.da;
      if (firstDa && !redesignLanePlaced && canEditSchedule) {
        try {
          await placeOnDa.mutateAsync({
            projectId: result.project_id,
            da: firstDa.trim(),
          });
        } catch {
          // Toast handled by the hook.
        }
      }

      // ★★★ fix-458 §C1 (P-106) — FLAG, NOT BLOCK.
      //
      // STEP 0d named THIS path: 14 of the 15 lead-less permits on prod share
      // their project's `created_at` to the microsecond, which is one
      // transaction — bp_create_project_with_permits. Twelve were created
      // 19–21 Aug in same-minute groups: one backfill import of already-issued
      // Seattle work.
      //
      // ★★ §C2: THE RESOLVER ALREADY RAN AND IS NOT DUPLICATED HERE. The block
      // above calls `lookupEntLeadForDa` (bp_ent_lead_for_da) exactly as fix-91
      // wrote it. It cannot help in the two cases that produced this gap:
      //   · 8 of the 15 permits have NO DA at all, so `if (!derivedEntLead &&
      //     bpRow?.da)` never even attempts a lookup, and
      //   · 5 name George, who is not on the active roster and so has no
      //     routing row for it to find.
      // A second resolution rule would not have found a lead either — there is
      // no lead to find. What was missing is that the wizard said NOTHING.
      //
      // ★★★ AND IT MUST NOT BLOCK. That import was legitimate work; a hard stop
      // would have meant twelve already-issued permits never entering the
      // system at all. The consequence is named instead, because it is not
      // obvious: entitlement tasks on a lead-less permit resolve to nobody and
      // appear on no board — which is how a client waited 66 days for approved
      // plans nobody could see were owed.
      if (!derivedEntLead) {
        pushToast(
          'Project created without an entitlement lead — its entitlement tasks ' +
            'will reach nobody until one is set. Settings → Team lists permits ' +
            'with no lead.',
          'warn',
        );
      }

      navigate(`/project/${result.project_id}`, { state: originState() });
      reset();
      onClose();
    } catch {
      // Toast already pushed by the hook's onError. Modal stays open
      // with form data intact.
    }
  }

  function handleViewExisting() {
    if (conflictExistingId) {
      navigate(`/project/${conflictExistingId}`, { state: originState() });
      reset();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-12 pb-12 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      data-testid="new-project-wizard"
      // ★★★ fix-411 §1 (P-049) — THE BACKDROP DOES NOTHING, DELIBERATELY.
      //
      // Bobby, 2026-08-26: *"when you are adding a new project, if you click
      // anywhere outside of the pop-up, it closes and you have to restart and
      // re-input all that information."*
      //
      // There WAS an `onClick` here calling handleClose(), and handleClose()
      // calls reset() — so one stray click did not merely close the dialog, it
      // threw away four steps of typing with no undo and no confirmation.
      //
      // ★★ ESCAPE DOES NOTHING EITHER, and that is not an omission — it is the
      // same decision. This component has never had a keydown handler (checked,
      // not assumed), so Escape was already inert; it is written down here so
      // nobody "fixes the inconsistency" by adding one. Escape would lose the
      // identical work for the identical reason.
      //
      // ★ THE TWO REAL EXITS ARE UNCHANGED: the × in the header and the Cancel
      // button at the foot, both of which still call handleClose(). This dialog
      // is now the deliberate exception among the app's overlays — the fix-411
      // PR carries the audit of the other sixteen, for Bobby to rule on
      // separately. It is the only one where a mis-click costs unrecoverable
      // input rather than a re-open.
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-[660px]">
        <header className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <h2
              id="wizard-title"
              className="text-base font-display font-extrabold text-text"
            >
              Add New Project
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-dim hover:text-text text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {/* V1-style underline strip stepper. Each step gets equal width;
              active step glows with the de colour + bottom border. */}
          <div
            className="flex gap-0"
            data-testid="wizard-stepper"
          >
            {STEPS.map((s) => {
              const isActive = step === s.idx;
              const isDone = step > s.idx;
              return (
                <button
                  key={s.idx}
                  type="button"
                  onClick={() => {
                    // allow jumping back to a completed step; not forward.
                    if (s.idx <= step) setStep(s.idx);
                  }}
                  data-testid={`wizard-step-tab-${s.idx}`}
                  className={
                    'flex-1 text-center text-[10px] uppercase tracking-[0.06em] font-display font-bold py-2 transition border-b-[3px] ' +
                    (isActive
                      ? 'text-de border-de'
                      : isDone
                        ? 'text-text border-border hover:text-de'
                        : 'text-dim border-border cursor-default')
                  }
                >
                  {s.idx} · {s.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="px-5 py-4 space-y-4">
          {!jurisQ.isLoading && !typesQ.isLoading && !catalogReady && (
            <div
              className="text-[12px] text-co bg-co-bg/40 border border-co-border rounded-md px-3 py-2"
              data-testid="wizard-empty-catalog"
            >
              {jurisOptions.length === 0 && typeOptions.length === 0
                ? 'No jurisdictions or permit types in the catalog yet. '
                : jurisOptions.length === 0
                  ? 'No jurisdictions in the catalog yet. '
                  : 'No permit types in the catalog yet. '}
              <Link to="/settings" className="underline font-semibold">
                Add them in Settings → Projects
              </Link>
              .
            </div>
          )}

          {validationErr && (
            <div
              className="text-[12px] text-co bg-co-bg/40 border border-co-border rounded-md px-3 py-2"
              data-testid="wizard-validation"
            >
              {validationErr}
            </div>
          )}

          {conflictExistingId && (
            <div className="text-[12px] text-jv bg-jv-bg/40 border border-jv-border rounded-md px-3 py-3 flex items-center justify-between gap-3">
              <span>This address already exists in the system.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleViewExisting}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-jv-border bg-surface text-jv font-semibold hover:bg-jv-bg/60 transition"
                  data-testid="wizard-view-existing"
                >
                  View existing project
                </button>
                <button
                  type="button"
                  onClick={() => setConflictExistingId(null)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-border bg-bg text-muted hover:bg-s2 transition"
                >
                  Pick a different address
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <Step1ProjectInfo
              value={state}
              onChange={patch}
              // fix-88: when the validation banner is showing on step 1,
              // also paint the field-level required errors red even if
              // the user hasn't blurred them yet — they need to see at
              // a glance WHICH field is the problem.
              showFieldErrors={validationErr !== null}
              // ★ fix-333: suppressed while the debounce is catching up, so a
              // half-typed address never flashes a verdict it is about to
              // change its mind about — "no warning and no flicker".
              // ★ The slot is ALWAYS rendered and carries the check's state,
              // even when there is nothing to say. That is what lets a test
              // wait for the check to SETTLE instead of sleeping on a guessed
              // duration — fix-300b's rule, and the guard that enforces it.
              // Without it, "no warning appeared" is indistinguishable from
              // "the debounce had not fired yet", which is precisely the silent
              // false-pass that ratchet exists to prevent.
              duplicateWarning={
                <div
                  data-testid="wizard-duplicate-slot"
                  data-state={duplicate.pending ? 'checking' : duplicate.verdict}
                  // ★ WHICH address the state above describes. "not checking"
                  // alone is racy: between two keystrokes there is an instant
                  // where the previous verdict is still on screen and settled,
                  // so a waiter can sample a stale answer and believe it. This
                  // makes the wait exact.
                  data-checked={duplicate.pending ? '' : duplicate.checkedAddress}
                >
                  {!duplicate.pending && (
                    <DuplicateAddressWarning
                      verdict={duplicate.verdict}
                      matches={duplicate.matches}
                      truncated={duplicate.truncated}
                      acknowledged={dupAcknowledged}
                      onAcknowledge={() => {
                        setAckedKey(dupKey);
                        setValidationErr(null);
                      }}
                    />
                  )}
                </div>
              }
            />
          )}
          {step === 2 && <Step2Questionnaire value={state} onChange={patch} />}
          {step === 3 && <Step3Permits value={state} onChange={patch} />}
          {step === 4 && <Step4TaskReview value={state} onChange={patch} />}
        </div>

        <footer className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-s2/60">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-surface text-text hover:bg-s2 transition"
            data-testid="wizard-cancel"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="text-xs px-3 py-1.5 rounded-md border border-border bg-surface text-text hover:bg-s2 transition"
                data-testid="wizard-back"
              >
                ← Back
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition"
                data-testid="wizard-next"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={create.isPending}
                className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 disabled:opacity-50 transition"
                data-testid="wizard-save"
              >
                {create.isPending ? 'Saving…' : '✓ Create Project'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
