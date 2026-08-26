// ===========================================================================
// fix-418 — the PROJECT card's interior, declared once
// ===========================================================================
//
// Bobby, 2026-08-26: *"I think what we kind of have inside of project is maybe
// proposal, site, and then those are two vertically stacked columns, and then
// to the right of both of those is unit dimensions, and that reads vertically."*
//
// ★★★ WHY THIS IS A MODULE AND NOT TWO TAILWIND LITERALS.
// The two column minimums ARE the breakpoint. `min-w-[165px]` in a class string
// is a number no test can read and no later edit has to argue with — and
// fix-412 and fix-417 were both caused by exactly that: a layout decided in
// several places at once, each half-right. So the widths live here, the JSX
// applies them through `style`, and the suite asserts the rendered tree against
// this table rather than against a copy of it.
//
// ★★★ AND `flex-wrap` IS THE BREAKPOINT — there is no media query.
// When the interior cannot give both columns their minimum, the second wraps
// onto its own line and the card stacks. That is Scope A4 satisfied
// STRUCTURALLY: a media query would be a third number to keep in step with the
// card's share, and the card's share depends on the viewport AND the ribbon.

/** Gap between the two interior columns, px (Tailwind `gap-2.5`). */
export const PROJECT_INTERIOR_GAP = 10;

/**
 * Minimum width of the left column (PROPOSAL above SITE), px.
 *
 * ★ Set by the SITE rows, which are the widest thing in it: a `~36px` label
 * beside a select that must still show "Residential Small Lot" without the
 * value itself becoming the card's min-content.
 */
export const PROJECT_LEFT_MIN_WIDTH = 165;

/**
 * Minimum width of ONE vertical unit block, px — and therefore of the right
 * column, whose minimum is one block.
 *
 * ★ A `UnitField` is a 30px label + a 4px gap + its control. 110px leaves the
 * control ~76px, which fits "Detached garage" truncated and every numeric
 * input at full width. Below that the label would have to go above the value
 * and the block would double in height.
 */
export const UNIT_BLOCK_MIN_WIDTH = 110;

/**
 * `OverviewCard`'s own chrome: `px-2.5` body padding (20) + 1px border a side.
 * ★ Same 22px fix-417 §0 used to turn 620px of unit row into a 642px card.
 */
export const OVERVIEW_CARD_CHROME = 22;

/** Interior width the two columns actually get, for a card `cardPx` wide. */
export function projectInteriorWidthAt(cardPx: number): number {
  return cardPx - OVERVIEW_CARD_CHROME;
}

/** The interior width at which the second column stops wrapping. */
export const PROJECT_TWO_COLUMN_MIN_INTERIOR =
  PROJECT_LEFT_MIN_WIDTH + PROJECT_INTERIOR_GAP + UNIT_BLOCK_MIN_WIDTH;

/** True when a card `cardPx` wide can show both columns side by side. */
export function projectCardIsTwoColumn(cardPx: number): boolean {
  return projectInteriorWidthAt(cardPx) >= PROJECT_TWO_COLUMN_MIN_INTERIOR;
}

/**
 * ★★★ STEP 0's MEASUREMENTS, kept because the fit is genuinely tight and the
 * brief's guess was wrong.
 *
 * The brief expected the PROJECT card to be ~257px at 1280. It is **~225px**:
 * fix-417's five floors total 970px against 988px of row at 1280 expanded, so
 * almost nothing is left to distribute by share and the 26% barely applies.
 *
 * ★★ The consequence, stated plainly rather than hidden: the two-column form
 * appears from roughly a 1600px window with the ribbon expanded, or 1440px
 * with it collapsed. Below that the same content stacks — which is the honest
 * price of leaving Plan of Record the widest card, as Bobby ruled in fix-417.
 * Taking the room from the other four instead is explicitly out of scope.
 */
export const PROJECT_CARD_MEASUREMENTS: readonly {
  vw: number;
  ribbon: 'expanded' | 'collapsed';
  cardPx: number;
}[] = [
  { vw: 1280, ribbon: 'expanded', cardPx: 225 },
  { vw: 1280, ribbon: 'collapsed', cardPx: 265 },
  { vw: 1440, ribbon: 'expanded', cardPx: 266 },
  { vw: 1440, ribbon: 'collapsed', cardPx: 307 },
  { vw: 1920, ribbon: 'expanded', cardPx: 391 },
  { vw: 1920, ribbon: 'collapsed', cardPx: 432 },
];
