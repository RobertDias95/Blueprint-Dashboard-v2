import { useEffect, useMemo, useRef } from 'react';
import { useTaskTemplates } from '../../hooks/useTaskTemplates';
import TaskReviewSection from './TaskReviewSection';
import type { TaskTemplate } from '../../lib/database.types';
import type { WizardPermit, WizardState } from './wizardState';

// fix-22 Step 4 — per-permit task toggles. The first time a permit row
// reaches Step 4 we default-check every applicable template (matching
// permit_type + jurisdiction). Subsequent renders preserve whatever the
// user has unchecked. A taskTemplateIds=[] is a real signal — "create no
// tasks for this permit" — and is respected on submit.

const BUILDING_PERMIT = 'Building Permit';
const ENT_ROLES = new Set(['ent', 'ent_lead']);
void ENT_ROLES; // referenced for parity with Step 3 — not used directly here.

interface Props {
  value: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

/** True when a template applies to a given (permit_type, juris) combo. */
function templateApplies(
  t: TaskTemplate,
  permitType: string,
  juris: string,
): boolean {
  if (t.permit_type !== permitType) return false;
  if (t.jurisdiction === null) return true;
  return t.jurisdiction === juris;
}

export default function Step4TaskReview({ value, onChange }: Props) {
  const tplQ = useTaskTemplates();
  const seededRef = useRef<Set<string>>(new Set());

  /** Subset of permits actually being created. */
  const selectedPermits = useMemo(() => {
    const list = value.permits.filter((p) => p.selected);
    if (!list.some((p) => p.type === BUILDING_PERMIT)) {
      // mirror Step 3's lazy BP auto-injection so the user never reaches
      // Step 4 without a BP row. The actual BP row is added on submit if
      // still missing.
    }
    return list;
  }, [value.permits]);

  /** Per-permit applicable template list. */
  const templatesByRow = useMemo(() => {
    const m = new Map<string, TaskTemplate[]>();
    for (const p of selectedPermits) {
      const list = (tplQ.templates ?? []).filter((t) =>
        templateApplies(t, p.type, value.juris),
      );
      // Sort by (sort_order ASC, text ASC) for stable display.
      list.sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.text.localeCompare(b.text),
      );
      m.set(p.rowId, list);
    }
    return m;
  }, [selectedPermits, tplQ.templates, value.juris]);

  // First-time seed: when a permit row hasn't been seen yet, default-check
  // all applicable templates. Deferred to useEffect so we don't mutate
  // state during render.
  useEffect(() => {
    if (tplQ.isLoading) return;
    let patched = false;
    const nextPermits: WizardPermit[] = value.permits.map((p) => p);
    for (const p of selectedPermits) {
      if (seededRef.current.has(p.rowId)) continue;
      seededRef.current.add(p.rowId);
      // Only auto-seed when the permit has not been touched in Step 4 yet
      // (taskTemplateIds==[]). If the user explicitly cleared all, they
      // would have hit Clear All — that's a deliberate choice we preserve.
      if (p.taskTemplateIds.length === 0) {
        const tpls = templatesByRow.get(p.rowId) ?? [];
        if (tpls.length === 0) continue;
        const idx = nextPermits.findIndex((x) => x.rowId === p.rowId);
        if (idx >= 0) {
          nextPermits[idx] = {
            ...nextPermits[idx],
            taskTemplateIds: tpls.map((t) => t.id),
          };
          patched = true;
        }
      }
    }
    if (patched) onChange({ permits: nextPermits });
    // We intentionally exclude onChange from deps — TanStack-style stable
    // callback. seededRef stops re-runs from re-seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPermits, templatesByRow, tplQ.isLoading]);

  function setIds(rowId: string, ids: string[]) {
    onChange({
      permits: value.permits.map((p) =>
        p.rowId === rowId ? { ...p, taskTemplateIds: ids } : p,
      ),
    });
  }

  function toggle(rowId: string, templateId: string, next: boolean) {
    const p = value.permits.find((x) => x.rowId === rowId);
    if (!p) return;
    const set = new Set(p.taskTemplateIds);
    if (next) set.add(templateId);
    else set.delete(templateId);
    setIds(rowId, Array.from(set));
  }

  function selectAll(rowId: string) {
    const tpls = templatesByRow.get(rowId) ?? [];
    setIds(
      rowId,
      tpls.map((t) => t.id),
    );
  }

  function clearAll(rowId: string) {
    setIds(rowId, []);
  }

  return (
    <div className="space-y-3" data-testid="wizard-step-4">
      <div className="text-[12px] text-muted">
        Pick which tasks to create up front. Unchecked tasks are NOT created
        — you can add them later from each permit's task list.
      </div>
      {tplQ.isLoading ? (
        <div className="text-[12px] text-dim">Loading task templates…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {selectedPermits.map((p) => (
            <TaskReviewSection
              key={p.rowId}
              permitRowId={p.rowId}
              permitType={p.type}
              templates={templatesByRow.get(p.rowId) ?? []}
              checkedIds={p.taskTemplateIds}
              onToggle={(tid, next) => toggle(p.rowId, tid, next)}
              onSelectAll={() => selectAll(p.rowId)}
              onClearAll={() => clearAll(p.rowId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
