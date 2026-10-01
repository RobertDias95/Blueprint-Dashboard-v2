import PermitTypeDefaultsEditor from './PermitTypeDefaultsEditor';
import TargetSubmitFormulasEditor from './TargetSubmitFormulasEditor';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import SettingsBlock, { SettingsSubBlock } from './SettingsBlock';

// ===========================================================================
// ★★★ fix-611 §E.1 — THE LEARNING WINDOWS BLOCK IS GONE
// ===========================================================================
//
// ⚖️ Bobby, 2026-09-30: **"Learning window per city: REMOVE."**
//
// This tab was a table of one number per jurisdiction, under a heading that said
// it set *"how many days back to look for approved permits when building the
// learned-schedule baseline (Reports → Schedule Benchmarks)"*.
//
// ★★★ IT SAID THAT, AND IT WAS NOT TRUE. `getLearnWindow(juris)` in
//     lib/scheduleBenchmarks.ts reads:
//
//         export function getLearnWindow(juris: string): number {
//           void juris;
//           return LEARN_WINDOW_DEFAULT;
//         }
//
//     The argument is discarded. The per-city number has never reached the
//     estimator — the module's own note says the cascade *"subsumes per-juris
//     window tuning"* — so 19 cities each had an editable field that changed
//     nothing, above a paragraph telling people it changed the schedule. Removing
//     the two editing surfaces therefore alters NO arithmetic, which is the
//     reason this is safe to do in a layout ticket.
//
// ★★ WHAT STAYS: `jurisdictions.learn_window_days` (no migration), the RPC
//    parameter, and `getLearnWindow` itself — it still has one caller
//    (`computeLearnedSchedule`), so §E.1's "if it has no caller left, delete it,
//    otherwise leave it and say so" resolves to leaving it.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS NOW
// ---------------------------------------------------------------------------
// The second half of Dates & targets' "Per-type schedule" card. The first half —
// the per-type × per-city target-submit formulas — is rendered by AdminPermitsTab,
// which the `dates` category mounts beside this one. fix-319 #77's own comment
// flagged that the two halves of one question sat on two different tabs and
// declined to move either; this is where they finally meet, and fix-613 makes
// them a single table.
//
// ★ `PermitTypeDefaultsEditor` is mounted with the same (absent) props it always
//   had — it owns its own admin gate. Nothing inside it changed.

export default function AdminScheduleTab() {
  const isAdmin = useIsTenantAdmin();

  return (
    <div className="space-y-3" data-testid="admin-schedule-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit the per-type schedule.
        </div>
      )}
      {/* ★★ ONE CARD, TWO SUB-HEADINGS — §B's shape for a merged block. Both
          editors are mounted exactly as they were, with the props they had. */}
      <SettingsBlock id="per-type-schedule">
        <SettingsSubBlock title="Target submit (per type × city)">
          <TargetSubmitFormulasEditor readOnly={!isAdmin} />
        </SettingsSubBlock>
        <SettingsSubBlock title="Intake → approval defaults (per type)">
          <PermitTypeDefaultsEditor />
        </SettingsSubBlock>
      </SettingsBlock>
    </div>
  );
}
