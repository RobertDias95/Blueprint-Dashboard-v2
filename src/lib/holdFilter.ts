// fix-178: the three-way hold filter shared by the Dashboard and Project List.
// A project is "held" iff it has an ACTIVE hold today (callers pass that boolean,
// computed from activeHoldProjectIds — the canonical active-hold helper). Default
// is 'all'; no persistence (resets to All each load, per the brief).

export type HoldFilterMode = 'all' | 'only' | 'exclude';

export const HOLD_FILTER_DEFAULT: HoldFilterMode = 'all';

/** Pure predicate: should an item with `isHeld` show under `mode`? */
export function passesHoldFilter(isHeld: boolean, mode: HoldFilterMode): boolean {
  if (mode === 'only') return isHeld;
  if (mode === 'exclude') return !isHeld;
  return true; // 'all'
}
