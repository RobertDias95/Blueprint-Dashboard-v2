import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useCreateProjectWithPermits,
  type PermitInput,
  type ProjectData,
} from '../hooks/useCreateProjectWithPermits';
import { useJurisdictions } from '../hooks/useJurisdictions';
import { usePermitTypes } from '../hooks/usePermitTypes';
import { usePlaceNewProjectOnDa } from '../hooks/usePlaceNewProjectOnDa';
import Step1ProjectInfo from './wizard/Step1ProjectInfo';
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
    ent_lead: state.entitlement_lead,
    dm: state.design_manager,
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    expected_issue: '',
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

export default function NewProjectWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const create = useCreateProjectWithPermits();
  const placeOnDa = usePlaceNewProjectOnDa();
  const jurisQ = useJurisdictions();
  const typesQ = usePermitTypes();

  const [step, setStep] = useState<StepIndex>(1);
  const [state, setState] = useState<WizardState>(makeEmptyWizardState);
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [conflictExistingId, setConflictExistingId] = useState<string | null>(
    null,
  );

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
    setState(makeEmptyWizardState());
    setStep(1);
    setValidationErr(null);
    setConflictExistingId(null);
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

    // Walk WizardState → RPC payload.
    const projectData: ProjectData = {
      entitlement_lead: strOrNull(state.entitlement_lead),
      design_manager: strOrNull(state.design_manager),
      acq_lead: strOrNull(state.acq_lead),
      go_date: strOrNull(state.go_date),
      units: intOrNull(state.units),
      zone: strOrNull(state.zone),
      lot_width: numOrNull(state.lot_width),
      lot_depth: numOrNull(state.lot_depth),
      unit_types: state.unit_types.length > 0 ? state.unit_types : null,
      parking_type: strOrNull(state.parking_type),
      parking_stalls: intOrNull(state.parking_stalls),
      alley: strOrNull(state.alley),
      product_type: strOrNull(state.product_type),
      project_tags: state.project_tags.length > 0 ? state.project_tags : null,
      // fix-22-final / Migration 6 + 7: Builder/Owner contact fields.
      builder_name: strOrNull(state.builder_name),
      builder_company: strOrNull(state.builder_company),
      builder_email: strOrNull(state.builder_email),
      builder_phone: strOrNull(state.builder_phone),
    };

    // Selected permits + auto-inject Building Permit if Steps 2/3 didn't.
    let selectedPermits = state.permits.filter((p) => p.selected);
    if (!selectedPermits.some((p) => p.type === BUILDING_PERMIT)) {
      selectedPermits = [makeBpPermit(state), ...selectedPermits];
    }

    const permitsPayload: PermitInput[] = selectedPermits.map((p) => ({
      type: p.type,
      num: p.num.trim() || undefined,
      ent_lead: strOrNull(p.ent_lead) ?? undefined,
      dm: strOrNull(p.dm) ?? undefined,
      da: strOrNull(p.da) ?? undefined,
      dual_da: strOrNull(p.dual_da) ?? undefined,
      architect: strOrNull(p.architect) ?? undefined,
      // fix-25c: "ACQ Target Date" input → expected_issue (the column
      // Schedule Health reads).
      expected_issue: strOrNull(p.expected_issue) ?? undefined,
      // fix-25-feat-h: optional Target Submit. For BPs the cascade
      // (bp_set_bp_dd_dates: dd_end + 14) will overwrite this once DD
      // dates land, so an empty string here is fine. Non-BPs rely on
      // this field as their only target_submit anchor.
      target_submit: strOrNull(p.target_submit) ?? undefined,
      task_template_ids: p.taskTemplateIds,
    }));

    try {
      const result = await create.mutateAsync({
        address: state.address.trim(),
        juris: state.juris.trim(),
        notes: state.notes.trim() || undefined,
        project_data: projectData,
        permits: permitsPayload,
      });

      if (result.conflict) {
        setConflictExistingId(result.project_id);
        return;
      }

      // Q9.5.f-fix-20 carry-over: auto-place on the first selected
      // permit's DA. Same UX semantics as before — silent fallback to
      // unscheduled lane if no DA was chosen.
      const firstDa = selectedPermits.find((p) => p.da && p.da.trim() !== '')?.da;
      if (firstDa) {
        try {
          await placeOnDa.mutateAsync({
            projectId: result.project_id,
            da: firstDa.trim(),
          });
        } catch {
          // Toast handled by the hook.
        }
      }

      navigate(`/project/${result.project_id}`);
      reset();
      onClose();
    } catch {
      // Toast already pushed by the hook's onError. Modal stays open
      // with form data intact.
    }
  }

  function handleViewExisting() {
    if (conflictExistingId) {
      navigate(`/project/${conflictExistingId}`);
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
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
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
