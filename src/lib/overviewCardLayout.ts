import { UNIT_MATRIX_WIDTH } from './unitRowLayout';

// ===========================================================================
// ★★★ fix-417 — THE PROJECT OVERVIEW CARD ROW GETS DECLARED PROPORTIONS
// ★★★ fix-422 — …AND THE CHROME IT WAS MEASURED AGAINST WAS WRONG BY 278px
// ===========================================================================
//
// Bobby, on a marked-up screenshot of 2724 Walnut Ave SW: *"this update messed
// up the ui on project overview. the proportions are way off now. the Design
// plan of record should be the widest of the boxes, but the team and builder
// owner info is way too slim."* Builder/Owner was clipping mid-word.
//
// ---------------------------------------------------------------------------
// ★★★ A BARE `1fr` TRACK IS `minmax(auto, 1fr)` — fix-417's finding, unchanged
// ---------------------------------------------------------------------------
//
// The row already declared `0.86fr 1.00fr 0.74fr 1.58fr 0.72fr`. A bare `fr`
// track's MINIMUM is its own min-content, so a card whose contents grow takes
// the difference from its neighbours and the declaration is only a preference.
// `minmax(<px>, <fr>)` replaces that automatic minimum with an explicit one and
// is the entire mechanism. That much is as fix-417 left it.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT fix-422 FOUND: THE ROW IS 278px NARROWER THAN fix-417 BELIEVED
// ---------------------------------------------------------------------------
//
// fix-417 modelled the chrome between the viewport and this row as *"ribbon 212
// · shell p-6 48 · header px-4 32"* = 292px, and asserted 988px of row at a
// 1280px viewport. It walked three of the seven boxes. The real chain, read off
// the DOM from `<main>` down, is:
//
//     Ribbon.tsx WIDTH_EXPANDED                       212   (56 collapsed)
//     Chrome.tsx  <main class="… p-6">                 48
//     ProjectDetail body row `px-3`                    24
//     ★ pd-left-rail — THE PERMITS SIDEBAR            240   ← never counted
//     ★ its `gap-3` to the right pillbox               12   ← never counted
//     ★ pd-right-pillbox `border`                       2   ← never counted
//     ProjectDetailHeader root `px-4`                  32
//                                                    ----
//                                            570 expanded / 414 collapsed
//
// ★★★ SO THE ROW GETS 710px AT 1280 EXPANDED, NOT 988. The permits rail is a
// fixed 240px column that is ALWAYS rendered — including on the overview, where
// no permit is selected — and it was simply missed. fix-417's own test asserted
// the wrong number confidently, which is how it survived.
//
// ★★ THE CONSEQUENCE IS ALREADY SHIPPED AND PREDATES THIS TICKET: fix-417's
// five floors need 970px, so at 1280 (either ribbon state) and at 1440 with the
// ribbon expanded the row does not fit and the right pillbox — whose
// `overflow-y-auto` makes its `overflow-x` compute to `auto` — scrolls
// sideways. Reported rather than silently absorbed into this ticket's numbers.

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
 * ★ `OverviewCard`'s own chrome: `px-2.5` body padding (20) + 1px border a side.
 *   The 22px fix-417 §0 used to turn 620px of unit row into a 642px card.
 */
export const OVERVIEW_CARD_CHROME = 22;

/**
 * ★★★ THE FLOORS ARE RE-DERIVED FROM WHAT EACH CARD ACTUALLY HOLDS.
 *
 * fix-417 set them by scaling Bobby's proposal to fit a row that turned out not
 * to exist. This ticket sets each one from its card's content and says which
 * are HARD and which are soft, because that distinction is what decides who
 * gives way when the row is short:
 *
 *   HARD — the card CLIPS or truncates below the number.
 *     · Project      a CSS grid inside an `overflow-hidden` card.
 *     · Builder/Owner  `<input>` values, which do not wrap.
 *   SOFT — the card reflows and stays readable.
 *     · Milestones, Team, Plan of Record.
 *
 * ★★ AND BOBBY'S STANDING RULING SURVIVES: the Plan of Record is the largest
 * SHARE (29%) and the largest FLOOR (310), so it is the widest card at every
 * width — the thing fix-417 was raised to fix. Scope 10(ii) offered its floor
 * as the place to find room; taking it demotes the Plan of Record below Project
 * at EVERY width, not just narrow ones, so it was measured and refused. See the
 * PR body for the numbers.
 */
export const OVERVIEW_CARD_COLUMNS: readonly OverviewCardColumn[] = [
  {
    key: 'dd',
    title: 'Milestones',
    pct: 13,
    minPx: 140,
    floorReason:
      'SOFT. Dates and short state words, all of which reflow — the one card ' +
      'that was already getting its fair share before fix-417, and the one ' +
      'that can afford to give a point of share back to the cards that cannot.',
  },
  {
    key: 'proj',
    title: 'Project',
    pct: 22,
    // ★★★ DERIVED, NOT TYPED. See UNIT_MATRIX_WIDTH — widen a matrix column and
    //     this floor widens in the same build.
    minPx: UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME,
    floorReason:
      '★ HARD, and DERIVED from UNIT_MATRIX_WIDTH. fix-417 justified 220px ' +
      'with "its widest content — the Units row — SCROLLS inside the card now ' +
      '(fix-417 §B)". fix-418 DELETED that scroller, so the justification has ' +
      'been false on main since ef9b0eb and the card has been free to clip its ' +
      'own contents. OverviewCard is `overflow-hidden`: a card narrower than ' +
      'the matrix does not scroll, it truncates silently. So the floor is the ' +
      'matrix plus the card chrome, computed, and the two can never disagree.',
  },
  {
    key: 'team',
    title: 'Team',
    pct: 17,
    minPx: 160,
    floorReason:
      'SOFT but raised 20px. Bobby: "the team … is way too slim". It stacks ' +
      'Internal over External, each a name beside a role chip; a 20-character ' +
      'name at this card\'s 10px needs ~110px before the chip wraps under it.',
  },
  {
    key: 'por',
    title: 'Design Plan of Record',
    pct: 29,
    // ★★★ MUST EXCEED THE PROJECT FLOOR. Bobby's fix-417 ruling — "the Design
    //     plan of record should be the widest of the boxes" — is a statement
    //     about EVERY width, and below ~1130px of row the floors are the only
    //     thing deciding. +14 over Project is the smallest margin that keeps it
    //     true without taking more than the row can spare.
    minPx: UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME + 14,
    floorReason:
      'SOFT content (a plan thumbnail scales) but a HARD ordering constraint: ' +
      'Bobby ruled this the widest box, and a floor below Project\'s would ' +
      'demote it everywhere the floors bind. Pinned just above Project\'s so ' +
      'the ruling holds at every width for the least width taken.',
  },
  {
    key: 'builder',
    title: 'Builder / Owner',
    pct: 19,
    minPx: 190,
    floorReason:
      '★ HARD, and UNCHANGED — this is fix-417\'s reported defect and its ' +
      'measurement stands. These are <input> elements and an input does NOT ' +
      'wrap; its value scrolls out of sight, which is the "clipping mid-word" ' +
      'Bobby photographed. 190px holds a full email at 12px bold.',
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
 * ★★★ `minmax(<px>, <fr>)`, NEVER a bare `fr`. A bare `fr` silently means
 * `minmax(auto, …)` and hands any card the power to resize its neighbours.
 */
export const OVERVIEW_GRID_TEMPLATE: string = OVERVIEW_CARD_COLUMNS.map(
  (c) => `minmax(${c.minPx}px, ${c.pct}fr)`,
).join(' ');

/** Every floor plus every gap — the narrowest the row can be without the page
 *  scrolling sideways. */
export const OVERVIEW_ROW_MIN_WIDTH: number =
  OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0) +
  (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP;

/**
 * ★★★ THE CHROME BETWEEN THE VIEWPORT AND THIS ROW — ALL SEVEN BOXES.
 *
 * ★★ fix-417 listed three of these and was 278px optimistic as a result. Each
 * entry names the file and class it is read from, so the next person to change
 * a padding can find what depends on it.
 */
export const SHELL_CHROME_PX = {
  /** Ribbon.tsx `WIDTH_EXPANDED` — and expanded is the default. */
  ribbonExpanded: 212,
  /** Ribbon.tsx `WIDTH_COLLAPSED`. */
  ribbonCollapsed: 56,
  /** Chrome.tsx `<main class="… p-6">`. */
  shellPadding: 24 * 2,
  /** ProjectDetail.tsx body row `px-3`. */
  pageRowPadding: 12 * 2,
  /** ★ ProjectDetail.tsx `pd-left-rail` — a fixed 240px permits column that is
   *  rendered on the overview too. The box fix-417 missed. */
  permitsRail: 240,
  /** ★ …and its `gap-3` to the right pillbox. */
  permitsRailGap: 12,
  /** ★ `pd-right-pillbox` `border` — 1px a side. */
  pillboxBorder: 2,
  /** ProjectDetailHeader.tsx root `px-4`. */
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
    viewportPx -
    r -
    SHELL_CHROME_PX.shellPadding -
    SHELL_CHROME_PX.pageRowPadding -
    SHELL_CHROME_PX.permitsRail -
    SHELL_CHROME_PX.permitsRailGap -
    SHELL_CHROME_PX.pillboxBorder -
    SHELL_CHROME_PX.headerPadding
  );
}

/** Whether all five cards fit at their floors — i.e. the pane does not scroll
 *  sideways. */
export function overviewRowFitsAt(
  viewportPx: number,
  ribbon: 'expanded' | 'collapsed' = 'expanded',
): boolean {
  return overviewRowWidthAt(viewportPx, ribbon) >= OVERVIEW_ROW_MIN_WIDTH;
}

/** The narrowest viewport at which all five cards fit at their floors. */
export function overviewMinViewport(
  ribbon: 'expanded' | 'collapsed' = 'expanded',
): number {
  return (
    OVERVIEW_ROW_MIN_WIDTH +
    (ribbon === 'expanded'
      ? SHELL_CHROME_PX.ribbonExpanded
      : SHELL_CHROME_PX.ribbonCollapsed) +
    SHELL_CHROME_PX.shellPadding +
    SHELL_CHROME_PX.pageRowPadding +
    SHELL_CHROME_PX.permitsRail +
    SHELL_CHROME_PX.permitsRailGap +
    SHELL_CHROME_PX.pillboxBorder +
    SHELL_CHROME_PX.headerPadding
  );
}

/**
 * Each card's resolved width for a given row width — the grid's own algorithm,
 * so a test can measure what jsdom cannot render.
 *
 * ★ Below `OVERVIEW_ROW_MIN_WIDTH` every track sits on its floor and the row
 *   overflows its container; above it, the free space is split by `pct`.
 */
export function resolveOverviewWidths(rowPx: number): number[] {
  const free =
    rowPx -
    (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP -
    OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0);
  return OVERVIEW_CARD_COLUMNS.map((c) =>
    free <= 0 ? c.minPx : c.minPx + (free * c.pct) / 100,
  );
}
