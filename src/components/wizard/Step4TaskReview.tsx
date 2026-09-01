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
//
// ===========================================================================
// ★★★ fix-472 §2 (P-126) — IN BACKFILL MODE THE DEFAULT INVERTS
// ===========================================================================
//
// Bobby: *"in the add new project, at the very top, backfill historical
// project, when checking this, we dont want tasks or milestones created."*
//
// fix-470 gated the SILENT path (`bp_create_lifecycle_task`). This is the
// VISIBLE one: Step 4 default-checks every applicable template and
// `bp_create_project_with_permits` inserts whatever is checked.
//
// ★★ THE PROD EVIDENCE IS HIM DOING IT BY HAND. 16 backfilled projects, 41
// permits, **0 non-auto tasks** — against 94 templates in the table. Zero is
// not luck: he has cleared the checklist by hand, once per project, sixteen
// times. He is about to enter a year of 2024 projects.
//
// ★ THE STEP IS NOT HIDDEN AND NOT SKIPPED, and that is deliberate. What makes
//   this benign is that Step 4 SHOWS what it will create — nothing is minted
//   behind anyone's back, unlike the lifecycle path fix-470 had to gate in the
//   database. Hiding the step would turn a visible choice into an invisible
//   one, which is the opposite of the fix. Templates stay selectable: a
//   backfill that genuinely wants one task can still tick it.
//
// ★ NON-BACKFILL MODE IS UNTOUCHED — same first-visit seed, same guard, same
//   everything.

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
  /** rowId → the backfill mode it was seeded under, so a mid-wizard flip of
   *  the checkbox can re-apply the OTHER default. */
  const seededRef = useRef<Map<string, boolean>>(new Map());
  /** ★★★ rowId → the user has changed this row's ticks themselves.
   *
   *  ★★ THE TWO HALVES OF §2 GENUINELY CONFLICT, AND THIS IS THE RESOLUTION.
   *  "Toggling the checkbox mid-wizard re-applies the default" and "never
   *  discard a selection the user made by hand" cannot both hold once somebody
   *  has ticked something. The brief's tie-break is to keep the user's choice,
   *  so a flip re-seeds only rows nobody has touched.
   *
   *  ★ AND THAT IS NOT A COMPROMISE, IT IS THE RIGHT LINE: an all-checked row
   *  the WIZARD checked is not a choice, it is our default, so replacing it
   *  discards nothing. A row the person edited is a choice, and a checkbox at
   *  the top of Step 1 must not silently undo work done on Step 4. */
  const touchedRef = useRef<Set<string>>(new Set());

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
  // all applicable templates — or, in backfill mode, none of them. Deferred to
  // useEffect so we don't mutate state during render.
  const backfill = value.backfill_mode;
  useEffect(() => {
    if (tplQ.isLoading) return;
    let patched = false;
    const nextPermits: WizardPermit[] = value.permits.map((p) => p);
    for (const p of selectedPermits) {
      const seenUnder = seededRef.current.get(p.rowId);
      const firstVisit = seenUnder === undefined;
      // ★ A mode FLIP re-seeds — but only a row the user has not edited.
      const modeFlipped = !firstVisit && seenUnder !== backfill;
      if (!firstVisit && !modeFlipped) continue;
      if (modeFlipped && touchedRef.current.has(p.rowId)) {
        // Their choice stands; record the mode so it is not asked again.
        seededRef.current.set(p.rowId, backfill);
        continue;
      }
      seededRef.current.set(p.rowId, backfill);

      const tpls = templatesByRow.get(p.rowId) ?? [];
      const idx = nextPermits.findIndex((x) => x.rowId === p.rowId);
      if (idx < 0) continue;

      if (backfill) {
        // ★★ Nothing is checked. `taskTemplateIds = []` is already the shape
        //    submit reads as "create no tasks for this permit", so backfill
        //    mode simply never leaves that state — no new signal, no new
        //    field, and the same code path on submit.
        if (nextPermits[idx].taskTemplateIds.length > 0) {
          nextPermits[idx] = { ...nextPermits[idx], taskTemplateIds: [] };
          patched = true;
        }
        continue;
      }

      // ★ NON-BACKFILL: unchanged from fix-22. Only auto-seed when the permit
      //   has not been touched in Step 4 yet (taskTemplateIds==[]). If the
      //   user explicitly cleared all, they would have hit Clear All — that's
      //   a deliberate choice we preserve.
      if (tpls.length === 0) continue;
      if (p.taskTemplateIds.length === 0 && !touchedRef.current.has(p.rowId)) {
        nextPermits[idx] = {
          ...nextPermits[idx],
          taskTemplateIds: tpls.map((t) => t.id),
        };
        patched = true;
      }
    }
    if (patched) onChange({ permits: nextPermits });
    // We intentionally exclude onChange from deps — TanStack-style stable
    // callback. seededRef stops re-runs from re-seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPermits, templatesByRow, tplQ.isLoading, backfill]);

  function setIds(rowId: string, ids: string[]) {
    // ★ Every route into this function is a person clicking: a checkbox, Select
    //   all, or Clear all. That is what `touched` means, and it is why the flag
    //   is set here rather than in three callers that could drift.
    touchedRef.current.add(rowId);
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
