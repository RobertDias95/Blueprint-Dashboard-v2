import type { ReactNode } from 'react';
import { chipStyle, type ChipSurface } from '../../lib/chipStyle';

// ===========================================================================
// ★★★ fix-483 §B (P-137) — ONE BLUE TOGGLE, EVERYWHERE
// ===========================================================================
//
// Bobby, 2026-09-02: *"on pipeline it's like a blue highlight. We want that
// toggle feature to be consistent whether we're on agenda or the library."*
//
// ---------------------------------------------------------------------------
// ★★★ WHAT WAS ACTUALLY WRONG: THREE CHROMES FOR ONE IDEA
// ---------------------------------------------------------------------------
// Enumerated across `src/` (the inventory is in the fix-483 PR body). Three
// controls were the same two-state view switch wearing three different coats:
//
//   Pipeline / Dashboard / My Tasks   ScopeToggle — `chipStyle`, DE blue
//   Library  SITE / UNIT              a solid `--color-text` fill (fix-406)
//   Agenda   Open / Closed            an inverted tab pair on an `--s3` strip
//
// Each was defensible where it was written and none of them knew about the
// others. This is the one they now share.
//
// ---------------------------------------------------------------------------
// ★★ WHY A NEW COMPONENT AND NOT `ScopeToggle` WITH LABEL PROPS
// ---------------------------------------------------------------------------
// The brief asks to *"generalise ScopeToggle to take its two labels (and test
// ids) as props"*. Done in substance — the generic control is here and
// `ScopeToggle` is now a thin wrapper over it — but the labels are NOT pushed
// out to `ScopeToggle`'s four call sites (Dashboard, My Tasks, Project List,
// Waiting On). Those four all mean the same thing and must keep saying the same
// words; making each one spell out "My Work" / "Everyone" is exactly how they
// would drift. The wrapper also makes *"byte-identical on the Pipeline"*
// trivially true rather than something to re-verify at four sites.
//
// ★★★ AND THE LIBRARY USES `ToggleChip` DIRECTLY, NOT `TwoStateToggle`. Its two
// halves live in two different cards — SITE's heading and UNIT's heading — so
// there is no wrapper that could contain both. Extracting the CHIP is what lets
// the Library's pill be the same object as the Pipeline's half while sitting
// where the design needs it. `chipStyle` is the shared truth underneath both.

export interface ToggleOption<T extends string> {
  value: T;
  /** ReactNode, not string — the Agenda's halves carry a live count. */
  label: ReactNode;
  testid: string;
  /** Tooltip. Optional so a half without one renders NO `title` attribute,
   *  which is what keeps ScopeToggle byte-identical (only "My Work" had one). */
  title?: string;
}

/**
 * One half of a two-state toggle: a pill that is DE blue when it is the chosen
 * one and the named surface when it is not.
 *
 * ★ Exported because a caller may need the halves apart — see the Library note
 *   above. A caller that can keep them together should use `TwoStateToggle`.
 */
export function ToggleChip({
  active,
  onClick,
  testid,
  title,
  surface = 'surface',
  data,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  title?: string;
  surface?: ChipSurface;
  /** Extra data-* attributes. Explicit rather than spread, so a typo cannot
   *  silently become an unrendered attribute (the OverviewAction pattern). */
  data?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-3 py-1 rounded border font-bold"
      style={chipStyle(active, surface)}
      data-testid={testid}
      aria-pressed={active}
      title={title}
      {...data}
    >
      {children}
    </button>
  );
}

/**
 * Two halves, exactly one of them chosen.
 *
 * ★ TWO, not N. `BoardLensControl`'s associate row and What's New's kind
 *   filter are multi-state and are deliberately NOT this — see the inventory
 *   in the fix-483 PR body for what was converted and what was left.
 */
export default function TwoStateToggle<T extends string>({
  value,
  onChange,
  options,
  testid,
  ariaLabel,
  surface = 'surface',
}: {
  value: T;
  onChange: (next: T) => void;
  /** Exactly two — a tuple, so a third cannot be added without a type error. */
  options: readonly [ToggleOption<T>, ToggleOption<T>];
  testid: string;
  ariaLabel: string;
  surface?: ChipSurface;
}) {
  return (
    <div
      className="inline-flex items-center gap-1"
      data-testid={testid}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <ToggleChip
          key={o.value}
          active={value === o.value}
          onClick={() => onChange(o.value)}
          testid={o.testid}
          title={o.title}
          surface={surface}
        >
          {o.label}
        </ToggleChip>
      ))}
    </div>
  );
}
