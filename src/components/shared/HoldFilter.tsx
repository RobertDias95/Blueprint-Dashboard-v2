import { chipStyle } from '../../lib/chipStyle';
import type { HoldFilterMode } from '../../lib/holdFilter';

// ===========================================================================
// ★★★ fix-451 §C (P-100) — THREE BUTTONS BECOME ONE DROPDOWN
// ===========================================================================
//
// Bobby, 2026-08-30: *"can we merge all and holds too into a drop down,
// declutter this view"*, and the rule behind it — a control that picks one of
// a list of PEERS is a dropdown; a control that flips ONE state stays a
// button. All / Only holds / Exclude holds are three peers, so they are a
// dropdown. Active only, BOT, Show held work and Co-assigned each flip one
// state, so they stay buttons. That is why this file changed and they did not.
//
// ★★★ PRESENTATION ONLY. `HoldFilterMode`, `passesHoldFilter` and
// `HOLD_FILTER_DEFAULT` in lib/holdFilter are UNTOUCHED — the predicate is
// pinned by holdFilter.test.ts and this ticket has no opinion about it. The
// props are unchanged too (`mode`, `onChange`, `testid`), so both consumers
// pick it up without edits.
//
// ★★ AND THE TWO CONSUMERS KEEP THEIR DIFFERENT MEMORIES. The Dashboard
// persists `holdMode` through persistFilters; the Project List deliberately
// does not (fix-178: *"resets to All each load"*). Two considered behaviours,
// not drift — this component stays stateless so neither is disturbed.

const OPTIONS: ReadonlyArray<{ mode: HoldFilterMode; label: string }> = [
  { mode: 'all', label: 'All holds' },
  { mode: 'only', label: 'Only holds' },
  { mode: 'exclude', label: 'Exclude holds' },
];

export default function HoldFilter({
  mode,
  onChange,
  testid = 'hold-filter',
}: {
  mode: HoldFilterMode;
  onChange: (mode: HoldFilterMode) => void;
  testid?: string;
}) {
  // ★★★ §C4 — A NON-DEFAULT STATE IS VISIBLE WITHOUT OPENING THE CONTROL.
  //
  // This is the cost a dropdown charges that three chips did not: the choice
  // stops being on screen. It is paid twice over — the closed control reads
  // "Only holds" / "Exclude holds" as its own label, AND it carries the active
  // tint `chipStyle` gives an active chip, so a filtered list never looks like
  // an unfiltered one.
  const active = mode !== 'all';
  return (
    <select
      value={mode}
      onChange={(e) => onChange(e.target.value as HoldFilterMode)}
      className="text-[11px] px-2 py-1 rounded border font-bold"
      style={chipStyle(active, 'surface')}
      aria-label="Filter by hold status"
      data-testid={testid}
      data-mode={mode}
    >
      {OPTIONS.map((o) => (
        // ★ The per-mode ids ride on the OPTIONS now. They were the three
        //   buttons' ids; keeping them here means a test that reached for
        //   `${testid}-only` still finds an element, and one that CLICKED it
        //   changes to selecting the value — the handful of those are named in
        //   the fix-451 PR body.
        <option key={o.mode} value={o.mode} data-testid={`${testid}-${o.mode}`}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
