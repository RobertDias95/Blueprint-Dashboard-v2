// ===========================================================================
// ★★★ fix-417 — THE PROJECT OVERVIEW CARD ROW GETS DECLARED PROPORTIONS
// ===========================================================================
//
// Bobby, on a marked-up screenshot of 2724 Walnut Ave SW: *"this update messed
// up the ui on project overview. the proportions are way off now. the Design
// plan of record should be the widest of the boxes, but the team and builder
// owner info is way too slim."* Builder/Owner was clipping mid-word —
// `builder@email`, `(206) 555-010`, `Owner / LLC a`.
//
// ---------------------------------------------------------------------------
// ★★★ THE WIDTHS WERE ALREADY DECLARED. THAT IS NOT WHERE THE BUG WAS.
// ---------------------------------------------------------------------------
//
// The fix-417 brief guessed the row declared "nothing at all". It declared
// `gridTemplateColumns: '0.86fr 1.00fr 0.74fr 1.58fr 0.72fr'` — fix-285's
// shares, retuned by fix-290 and fix-295. The bug is subtler and worse:
//
//   ★★★ A BARE `1fr` TRACK IS `minmax(auto, 1fr)`. Its MINIMUM is the column's
//   min-content width, so a track can never shrink below what its contents
//   demand — and when one track blows past its share, the overflow is taken
//   from its neighbours in proportion. The declaration reads like a contract
//   and is only a preference.
//
// So when fix-412 widened the PROPOSAL → Units row, nothing broke loudly. The
// PROJECT card simply grew to its new min-content and the other four shrank to
// pay for it. Measured off Bobby's screenshot at ~1345px of row:
//
//     card          intended (fr)   actual        delta
//     MILESTONES        229px        ~230px        ok
//     PROJECT           266px        ~660px       +394   ← took it
//     TEAM              197px        ~100px       -97
//     PLAN OF RECORD    421px        ~270px      -151    ← the widest card, third
//     BUILDER/OWNER     192px        ~110px       -82    ← clipping
//
// ★★ THE ARITHMETIC, CONFIRMED. `unitRowLayout.UNIT_ROW_COLUMNS` totals 584px
// across ten columns plus nine 4px gaps = **620px**, and the card adds 20px of
// body padding and 2px of border: the PROJECT card's min-content is **~642px**
// against a 266px share. The brief's estimate of "roughly 130px larger than
// before fix-412" is right — the old row's selects auto-sized to about 488px.
//
// ★★★ SO `minmax(<px>, <fr>)` IS THE FIX, and it is load-bearing in a way the
// bare `fr` was not: giving the min an EXPLICIT length REPLACES the automatic
// `auto` minimum, so a track can finally be told to be narrower than its
// contents. That is only safe because fix-417 §B gives the Units row its own
// horizontal scroll — the floor and the overflow container are one change in
// two files, and removing either re-creates the bug.
//
// ---------------------------------------------------------------------------
// ★★ WHY THIS IS A MODULE AND NOT FIVE NUMBERS IN THE JSX
// ---------------------------------------------------------------------------
//
// The same move fix-412 made one level down, for the same reason. Inside the
// Units row the header and the row each declared their own widths and drifted
// four ways; out here the row declares shares that any card's contents can
// silently overrule. Declared once, in one place, with the intent written
// beside the number — and a test that fails if a later edit demotes the Plan of
// Record or lets the percentages stop summing to 100.

export interface OverviewCardColumn {
  /** Stable key, also the grid-area name. */
  key: string;
  /** The card's title, so the table reads as the row does. */
  title: string;
  /** Share of the row. The five sum to 100. */
  pct: number;
  /**
   * The floor, in px — what this card needs before it stops being usable.
   *
   * ★★ This REPLACES the track's automatic min-content minimum. Below this the
   * grid will not shrink the card; above it, `pct` decides.
   */
  minPx: number;
  /** Why the floor is that number and not another one. */
  floorReason: string;
}

/**
 * ★★★ BOBBY'S PERCENTAGES, KEPT EXACTLY. HIS FLOORS, ARGUED WITH.
 *
 * He gave both, and invited the floors to be argued with "if the measurements
 * disagree". They disagree, and by a lot:
 *
 *   his floors  180 + 340 + 180 + 320 + 230 = 1250px, + 4 gaps = **1290px**
 *
 * The narrowest layout this app supports is a **1280px viewport with the ribbon
 * EXPANDED** (212px — and expanded is the default, `loadRibbonCollapsed() ??
 * false`). After the shell's `p-6` (48px) and the header's `px-4` (32px) the
 * card row gets **988px**. Bobby's floors would overflow it by ~300px and the
 * page body would scroll sideways — which the same brief forbids.
 *
 * ★ So the floors are scaled to fit the narrowest supported row, and the
 *   PERCENTAGES — which are what actually decide the look at every width above
 *   ~1030px of row — are his, untouched. The floors only bind on a genuinely
 *   small window, and there they keep every card legible rather than pretty.
 *
 * ★★ AND THE ORDER SURVIVES AT BOTH ENDS: Plan of Record is the largest share
 * (29% > 26%) AND the largest floor (240 > 220), so it is the widest card at
 * every width, not just the wide ones. The test asserts both.
 */
export const OVERVIEW_CARD_COLUMNS: readonly OverviewCardColumn[] = [
  {
    key: 'dd',
    title: 'Milestones',
    pct: 14,
    minPx: 140,
    floorReason:
      'Dates and short state words; it reflows and was the one card already ' +
      'getting its fair share before this fix.',
  },
  {
    key: 'proj',
    title: 'Project',
    pct: 26,
    minPx: 220,
    floorReason:
      'Its widest content — the Units row — SCROLLS inside the card now ' +
      '(fix-417 §B), so its floor is what the Proposal/Site labels need, not ' +
      'the 642px the row used to impose on the whole page.',
  },
  {
    key: 'team',
    title: 'Team',
    pct: 15,
    minPx: 140,
    floorReason: 'Names and role chips, all of which wrap.',
  },
  {
    key: 'por',
    title: 'Design Plan of Record',
    pct: 29,
    minPx: 240,
    floorReason:
      'The only card whose content is genuinely resolution-bound (fix-295: a ' +
      'plan thumbnail). Largest share AND largest floor, so it is the widest ' +
      'card at every width.',
  },
  {
    key: 'builder',
    title: 'Builder / Owner',
    pct: 16,
    minPx: 190,
    floorReason:
      '★ THE REPORTED DEFECT. These are <input> elements, and an input does ' +
      'NOT wrap — its value scrolls out of sight, which is the "clipping ' +
      'mid-word" Bobby photographed. 190px holds a full email at the 12px ' +
      'bold this card uses; widening is the only fix available.',
  },
];

/** The five grid-area names, in render order. */
export const OVERVIEW_GRID_AREAS = `"${OVERVIEW_CARD_COLUMNS.map((c) => c.key).join(' ')}"`;

/** The gap between cards, px. Declared here so the template and any width
 *  arithmetic cannot disagree about it. */
export const OVERVIEW_GRID_GAP = 10;

/**
 * The `grid-template-columns` the row renders from.
 *
 * ★★★ `minmax(<px>, <fr>)`, NEVER a bare `fr`. The explicit length minimum is
 * the entire fix — see the header note. A bare `fr` silently means
 * `minmax(auto, …)` and hands any card the power to resize its neighbours.
 */
export const OVERVIEW_GRID_TEMPLATE: string = OVERVIEW_CARD_COLUMNS.map(
  (c) => `minmax(${c.minPx}px, ${c.pct}fr)`,
).join(' ');

/** Every floor plus every gap — the narrowest the row can be without the page
 *  scrolling sideways. Exported so a test can hold it against a real viewport
 *  rather than trusting the arithmetic in a comment. */
export const OVERVIEW_ROW_MIN_WIDTH: number =
  OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0) +
  (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP;

/**
 * ★ The chrome between the viewport and this row, so the test that says "the
 * page does not scroll sideways at 1280px" is measuring the real thing rather
 * than a number somebody typed.
 *
 *   ribbon 212 (EXPANDED — the default) · shell `p-6` 24×2 · header `px-4` 16×2
 */
export const SHELL_CHROME_PX = {
  ribbonExpanded: 212,
  ribbonCollapsed: 56,
  shellPadding: 24 * 2,
  headerPadding: 16 * 2,
} as const;

/** The width this row actually gets at a given viewport. */
export function overviewRowWidthAt(
  viewportPx: number,
  ribbon: 'expanded' | 'collapsed' = 'expanded',
): number {
  const r =
    ribbon === 'expanded'
      ? SHELL_CHROME_PX.ribbonExpanded
      : SHELL_CHROME_PX.ribbonCollapsed;
  return (
    viewportPx - r - SHELL_CHROME_PX.shellPadding - SHELL_CHROME_PX.headerPadding
  );
}
