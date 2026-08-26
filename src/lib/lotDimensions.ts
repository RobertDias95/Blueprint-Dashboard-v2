// ===========================================================================
// ★★★ fix-411 §2 (P-051) — LOT DIMENSIONS READ AS WHOLE FEET
// ===========================================================================
//
// Bobby, 2026-08-26: *"the lot length dimension, some of them have decimal
// places, like 100.47 or 120.5, and we don't want decimal points… normal
// rounding, .5 or higher rounds up, .49 or lower rounds down."*
//
// ---------------------------------------------------------------------------
// ★★★ DISPLAY ONLY. THE STORED VALUE NEVER MOVES.
// ---------------------------------------------------------------------------
//
// `projects.lot_width` / `lot_depth` are `numeric` and stay exactly as they
// are: no migration, no UPDATE, no rounding on write. Measured on prod
// 2026-08-26 — 14 projects have a fractional width and 23 a fractional depth,
// max scale 2 — and every one of those is a surveyed number somebody typed. The
// complaint is that they are NOISY TO READ, not that they are wrong.
//
// ★★ WHICH IS WHY THIS IS A FORMATTER AND NOT A SETTER, and why it is
// deliberately NOT applied to the editable inputs. The Site card on Project
// Overview, the Project Settings modal and the wizard's Step 1 all render
// `lot_width` into an `<input type="number">` whose blur COMMITS the draft.
// Rounding the draft would write the rounded number back to the database on the
// next blur — a data change through the back door, from a ticket whose first
// line is "display only". Those three are listed in the fix-411 PR as
// deliberately unchanged.
//
// ★ SORTING ALSO KEEPS THE REAL NUMBER. The Library sorts on `row.lotWidth`,
// the unrounded value, so 100.47 and 100.4 keep their true order even though
// both render "100". Rounding first would make the order arbitrary inside each
// whole foot.
//
// ---------------------------------------------------------------------------
// ★★★ AND IT MUST NOT REACH UNIT DIMENSIONS.
// ---------------------------------------------------------------------------
//
// The per-unit `width_ft` / `depth_ft` inside `projects.unit_types` are DESIGN
// dimensions, where half-feet are real and meaningful: measured on prod
// 2026-08-26, **102 of 232 unit rows have a fractional width and 81 a
// fractional depth**. A 20.5ft-wide townhouse is 20.5ft wide. This helper is
// named for the LOT on purpose so that a call site rounding a unit reads
// obviously wrong.

/**
 * ★★★ fix-415 SCOPE B — THE SAME RULE, NOW ON THE WRITE PATH.
 *
 * Bobby, 2026-08-26: *"we want the unrounded numbers to match their updated UI
 * number… you can update the stored values to also reflect that."*
 *
 * ★★ fix-411 §2's header below says the stored value must never move, and says
 * why. That was right for a DISPLAY ticket and Bobby has since ruled the other
 * way, so the note stays as the record of a superseded decision rather than
 * being quietly deleted — but this function is the one the write paths call.
 *
 * ★★★ AND IT IS CALLED ON COMMIT, NEVER ON KEYSTROKE. Rounding an input as it
 * is typed destroys the value before the user has finished it: typing "100.5"
 * would become "100" at the "100." keystroke and the ".5" would land nowhere.
 * Every call site below is a blur or a submit.
 *
 * ★ NULL passes through as NULL. A missing dimension is missing, not zero.
 */
export function roundLotForStorage(
  n: number | null | undefined,
): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return roundLotFeet(n);
}

/** ★ The one place the rule is written down: `Math.round`, which is half-up for
 *  positive numbers — 100.47 → 100, 100.5 → 101, 120.5 → 121. Lot dimensions
 *  are never negative, so the half-up/half-away-from-zero distinction that
 *  makes `Math.round(-0.5) === -0` cannot arise here. */
export function roundLotFeet(n: number): number {
  return Math.round(n);
}

/**
 * A lot dimension as a whole number of feet, for rendering.
 *
 * ★ `null` / `undefined` / a non-finite number return `null` rather than the
 * string "NaN". A missing dimension is a missing dimension: the caller decides
 * what an absent value looks like (every current one renders an em dash), and
 * "NaN×NaN" in a table is the failure this signature exists to prevent.
 */
export function formatLotFeet(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return String(roundLotFeet(n));
}

/**
 * The "W×D" pair, or null when either half is missing.
 *
 * ★ BOTH OR NEITHER. A lot with a width and no depth is not "40×" — every
 * surface that shows the pair already treats a half-known lot as unknown, and
 * putting that rule here keeps the two call sites from drifting on it.
 */
export function formatLotPair(
  width: number | null | undefined,
  depth: number | null | undefined,
): string | null {
  const w = formatLotFeet(width);
  const d = formatLotFeet(depth);
  if (w === null || d === null) return null;
  return `${w}×${d}`;
}
