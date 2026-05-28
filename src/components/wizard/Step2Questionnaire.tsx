import { useMemo } from 'react';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useJurisPermitStats } from '../../hooks/useJurisPermitStats';
import QuestionnaireSection, {
  type QuestionnaireItem,
} from './QuestionnaireSection';
import {
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from './wizardState';

// fix-22 Step 2 — Permit Questionnaire.
//
// Bucketing rules (spec):
//   Commonly  : stats.usage_fraction >= 0.5
//   Sometimes : 0.05 <= stats.usage_fraction < 0.5
//   Other     : the rest of the catalog
//
// Building Permit is ALWAYS in the Commonly bucket with the checkbox
// locked-on. When the juris has < 5 projects, bp_get_juris_permit_stats
// still returns rows (with usage_pct_display=null per Migration 4) but
// usage_fraction may be high on tiny N — that's noisy, so we collapse
// to a flat catalog with only Building Permit pre-checked. Spec calls
// this "skip the Commonly/Sometimes buckets entirely; show the full
// catalog flat."

const BUILDING_PERMIT = 'Building Permit';

interface Props {
  value: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

function makePermit(type: string, selected: boolean, defaults: WizardState): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type,
    selected,
    ent_lead: defaults.entitlement_lead,
    dm: defaults.design_manager,
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

export default function Step2Questionnaire({ value, onChange }: Props) {
  const typesQ = usePermitTypes();
  const statsQ = useJurisPermitStats(value.juris);

  const allTypes = useMemo(() => {
    const list = (typesQ.data ?? []).map((t) => t.name);
    if (!list.includes(BUILDING_PERMIT)) list.unshift(BUILDING_PERMIT);
    return list;
  }, [typesQ.data]);

  const stats = statsQ.data ?? [];
  const totalInJuris = stats[0]?.total_projects_in_juris ?? 0;
  /** Spec known risk #2 + Step 2 fallback: < 5 projects in juris == not
   *  enough signal. Show flat catalog, no buckets, no %. */
  const fallback = totalInJuris < 5;

  const statsByType = useMemo(() => {
    const m = new Map<string, (typeof stats)[number]>();
    for (const s of stats) m.set(s.permit_type, s);
    return m;
  }, [stats]);

  const { commonly, sometimes, otherCatalog, flat } = useMemo(() => {
    if (fallback) {
      const flatItems: QuestionnaireItem[] = allTypes.map((type) => ({
        type,
        pct: null,
        lockedOn: type === BUILDING_PERMIT,
      }));
      return { commonly: [], sometimes: [], otherCatalog: [], flat: flatItems };
    }
    const commonlyArr: QuestionnaireItem[] = [];
    const sometimesArr: QuestionnaireItem[] = [];
    const otherArr: QuestionnaireItem[] = [];
    for (const type of allTypes) {
      const s = statsByType.get(type);
      const frac = s?.usage_fraction ?? 0;
      const pct = s?.usage_pct_display ?? null;
      const item: QuestionnaireItem = {
        type,
        pct,
        lockedOn: type === BUILDING_PERMIT,
      };
      if (type === BUILDING_PERMIT || frac >= 0.5) {
        commonlyArr.push(item);
      } else if (frac >= 0.05) {
        sometimesArr.push(item);
      } else {
        otherArr.push(item);
      }
    }
    // Mark the most-used "sometimes" permit as "recommended" per spec.
    if (sometimesArr.length > 0) {
      sometimesArr[0] = { ...sometimesArr[0], badge: 'recommended' };
    }
    return {
      commonly: commonlyArr,
      sometimes: sometimesArr,
      otherCatalog: otherArr,
      flat: [],
    };
  }, [allTypes, statsByType, fallback]);

  /** Map of type → selected. Building Permit is always true (lockedOn). */
  const selectedByType = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const p of value.permits) m[p.type] = p.selected;
    m[BUILDING_PERMIT] = true;
    return m;
  }, [value.permits]);

  function toggle(type: string, next: boolean) {
    if (type === BUILDING_PERMIT) return;
    const existing = value.permits.find((p) => p.type === type);
    if (existing) {
      // Update selection in-place.
      onChange({
        permits: value.permits.map((p) =>
          p.type === type ? { ...p, selected: next } : p,
        ),
      });
    } else if (next) {
      // Add a new permit row for this type with project-level defaults.
      onChange({
        permits: [...value.permits, makePermit(type, true, value)],
      });
    }
  }

  // Auto-seed Building Permit row on first render if missing. We do this
  // via a deferred effect-free check on render — calling onChange in
  // useEffect would trigger a render loop; calling onChange during render
  // is forbidden. So we let Step 3 / final submit guarantee the BP row
  // (see Step3Permits' selectedPermits filter — it adds BP if missing).

  return (
    <div className="space-y-4" data-testid="wizard-step-2">
      <div className="text-[12px] text-muted">
        Which permits will this project need?{' '}
        {value.juris && !statsQ.isLoading && !fallback && (
          <span className="text-dim">
            Suggestions based on {totalInJuris} other projects in {value.juris}.
          </span>
        )}
        {value.juris && !statsQ.isLoading && fallback && (
          <span className="text-dim">
            Not enough history in {value.juris} yet — showing full catalog.
          </span>
        )}
        {!value.juris && (
          <span className="text-co">
            Pick a jurisdiction in Step 1 to get usage hints.
          </span>
        )}
      </div>

      {fallback ? (
        <QuestionnaireSection
          title="All Permit Types"
          items={flat}
          selectedByType={selectedByType}
          onToggle={toggle}
          testIdPrefix="wizard-q-flat"
        />
      ) : (
        <>
          <QuestionnaireSection
            title="Commonly used"
            items={commonly}
            selectedByType={selectedByType}
            onToggle={toggle}
            testIdPrefix="wizard-q-commonly"
          />
          <QuestionnaireSection
            title="Sometimes used"
            items={sometimes}
            selectedByType={selectedByType}
            onToggle={toggle}
            testIdPrefix="wizard-q-sometimes"
          />
          <QuestionnaireSection
            title="Other"
            items={otherCatalog}
            selectedByType={selectedByType}
            onToggle={toggle}
            testIdPrefix="wizard-q-other"
          />
        </>
      )}
    </div>
  );
}
