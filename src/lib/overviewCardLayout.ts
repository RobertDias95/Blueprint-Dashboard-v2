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

// ---------------------------------------------------------------------------
// ★★★ WHAT fix-423 MEASURED, AND IT CORRECTS BOTH OF THE ABOVE ONCE MORE
// ---------------------------------------------------------------------------
//
// Bobby, 2026-08-27: *"In milestones, the dates no longer fit… there's enough
// space to take a little bit of width out of Builder/Owner and give that to
// Milestones so the dates can completely render."*
//
// ★★★ THE MILESTONES FLOOR WAS NEVER MEASURED, AND ITS STATED REASON WAS
// FALSE. fix-417 wrote *"Dates and short state words; it reflows"* and set 140.
// Four of this card's nine rows are `<input type="date">`, and **an input does
// not reflow** — the identical finding fix-417 made two cards to the right, for
// Builder/Owner, in this same table. Measured in Chrome against the built
// stylesheet at this card's own 11px semibold: a bare date input is **100px**,
// its row (80px label + 6px gap + 14px of box) is **200px**, and the card's
// min-content is **222px**. It has been rendering **140px at 1280 and 1440 and
// 169px at 1920** — short by 82 and by 53 — which is the clipping Bobby is
// looking at. The floor is DERIVED from those parts now, not typed.
//
// ★★★ AND THE ROW HAS TO WRAP, because five honest floors do not fit one
// line. They total `OVERVIEW_ROW_MIN_WIDTH`, so the five cards cannot share a
// line below a **1788px window** (1632 with the ribbon collapsed) — and what
// happens below that today is the sideways scroll fix-422 reported and this
// sequence exists to remove. See `OVERVIEW_ROW_RESPONSIVE_CSS`.

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

// ---------------------------------------------------------------------------
// ★★★ fix-423 — THE MILESTONES ROW, IN PARTS, SO ITS FLOOR CANNOT BE GUESSED
// ---------------------------------------------------------------------------
//
// Every row on that card is one shape (fix-311 #56): a fixed label column, a
// gap, then a box that either holds a date input or prints the same date.
//
//     [ label ][            box            ]
//
// ★ EVERY NUMBER BELOW WAS MEASURED IN CHROME against the built stylesheet,
//   not estimated from a character count. A test asserts each against the
//   Tailwind class the component actually renders, so a class change that moves
//   one of them fails the build rather than silently re-opening the clipping.

/** `MILESTONE_LABEL_CLASS`'s `w-20`. Sized for "Intake Accepted", the longest
 *  label on the card, which measures 63.9px at its 9px — 16px of headroom. */
export const MILESTONE_LABEL_WIDTH = 80;

/** The `gap-1.5` between the label and the box. */
export const MILESTONE_LABEL_GAP = 6;

/** `MILESTONE_BOX_CLASS`'s own chrome: `px-1.5` (12) + 1px of border a side. */
export const MILESTONE_BOX_CHROME = 14;

/**
 * ★★★ WHAT A NATIVE `<input type="date">` NEEDS AT THIS CARD'S 11px SEMIBOLD.
 *
 * Measured, not estimated: 100px. That is `MM/DD/YYYY` — which the browser
 * renders from ITS OWN locale and which cannot be shortened (fix-320) — plus
 * the calendar picker indicator, which is an affordance and not decoration.
 *
 * ★★ AND IT DOES NOT WRAP. Below this the value scrolls out of the box and
 * the reader sees `09/1`. Same mechanism fix-417 measured for the Builder/Owner
 * email inputs; it is why this card's floor is HARD and not a preference.
 */
export const MILESTONE_DATE_INPUT_MIN = 100;

/** What one editable row needs — the widest row on the card. */
// ===========================================================================
// ★★★ fix-475 (P-116) — THE CONSULTANT PILL, MEASURED
// ===========================================================================
//
// ★★★ THE MOCK IS NOT MEASURING THE CONTROL THE APP SHIPS, and that is the
// whole width story of this ticket. `overview_consultants_v6.html` draws the
// two dates as PLAIN TEXT inputs with a `mm/dd/yyyy` placeholder — 140px each —
// which is why its column can be 250px wide. The app cannot: every
// server-committing date goes through `BufferedDateInput`, which renders a
// native `<input type="date">` (fix-073's rule — a raw onChange saves transient
// garbage on every intermediate keystroke).
//
// Measured in Chrome by `harness/consultant-column-floor.html`:
//
//     native <input type="date"> @ 10.5px          103px
//     native <input type="date"> @ 11px semibold   106px   (cross-check:
//                                    MILESTONE_DATE_INPUT_MIN says 100)
//     the mock's plain text box    @ 10.5px        140px
//
// ★★ SO THE MOCK'S SIDE-BY-SIDE DATES COST 252px OF FLOOR — 103 + 103 + gap,
// plus pill padding and card chrome. Against a budget of 190 (what `builder`
// vacates) that is not close, and §3's rule is that OVERVIEW_ROW_MIN_WIDTH must
// not increase.
//
// ★★★ STACKING THE PAIR COSTS HEIGHT INSTEAD, AND THIS CARD HAS HEIGHT. It is
// a list that grows with the page; the ROW has no width to give. Every ruled
// requirement survives — *"always two, always editable, same two slots on every
// pill"* says nothing about their arrangement — and the floor lands at 144px.
// The deviation from the mock is stated in the PR with the measurement.
export const CONSULTANT_DATE_INPUT_MIN = 103;

/** The status pill's fixed column in the mock. It is the widest single thing in
 *  a stacked pill, so it — not the date — sets the floor. */
export const CONSULTANT_STATUS_WIDTH = 104;

/** `.cbody` padding (8+8) plus the pill's 1px border each side. */
export const CONSULTANT_PILL_CHROME = 18;

/** ★ DERIVED, like MILESTONE_ROW_MIN_WIDTH below: change a padding and this
 *  floor moves in the same build. */
export const CONSULTANT_CARD_MIN_WIDTH =
  Math.max(CONSULTANT_DATE_INPUT_MIN, CONSULTANT_STATUS_WIDTH) +
  CONSULTANT_PILL_CHROME +
  OVERVIEW_CARD_CHROME;

export const MILESTONE_ROW_MIN_WIDTH =
  MILESTONE_LABEL_WIDTH +
  MILESTONE_LABEL_GAP +
  MILESTONE_BOX_CHROME +
  MILESTONE_DATE_INPUT_MIN;

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
    // ★ fix-423: 13 → 16, and Bobby said where it comes from — *"take a little
    //   bit of width out of Builder/Owner and give that to Milestones"*.
    //   Builder gives 19 → 16; its FLOOR is untouched (see below).
    pct: 16,
    // ★★★ DERIVED, NOT TYPED — the discipline fix-422 applied to `proj`.
    minPx: MILESTONE_ROW_MIN_WIDTH + OVERVIEW_CARD_CHROME,
    floorReason:
      '★★★ HARD, and DERIVED. fix-417 called this SOFT — "Dates and short ' +
      'state words, all of which reflow" — and set 140 on that reading. It is ' +
      'FALSE: four of the nine rows are `<input type="date">`, and an input ' +
      'does NOT reflow, which is the very finding fix-417 made for ' +
      'Builder/Owner three rows down this same table. Measured in Chrome at ' +
      "the card's 11px semibold: the input alone is 100px, its row 200px, the " +
      'card 222px. It had been rendering 140px at 1280/1440 and 169px at 1920, ' +
      'so the dates clipped at EVERY width — which is what Bobby is looking ' +
      "at. The floor is the row's parts plus the card chrome now, computed, so " +
      'a label or padding change moves it in the same build.',
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
      'SOFT, and fix-423 DELIBERATELY LEFT IT AT 160 against its own brief, ' +
      'which asked for 185 to hold the new two-up Internal block. Raising it ' +
      'puts the wrapped first line (Milestones + Project + Team) at 728px ' +
      'against the 710px this row gets at a 1280 window, which re-opens the ' +
      'sideways scroll the whole sequence exists to close. So the two-up is a ' +
      'CONTAINER QUERY inside the card instead (TEAM_INTERNAL_TWO_UP_MIN): it ' +
      'appears whenever the card is wide enough to hold it — which is every ' +
      'width Bobby works at — and the card stacks gracefully when it is not. ' +
      'A layout that asks for width the row cannot always give is not a floor.',
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
    // ★★★ fix-475 (P-116): `builder` LEAVES and `consultants` takes its slot.
    //     Builder/Owner is not deleted — it becomes the Team card's top
    //     section, collapsed to Owner + Business with a disclosure.
    key: 'consultants',
    title: 'Consultants',
    // ★ The SHARE is inherited from Builder/Owner unchanged. fix-423 tuned
    //   these five percentages against each other and this ticket has no
    //   measurement that says any of them should move; changing a share
    //   without one would undo that tuning by accident.
    pct: 16,
    // ★★★ DERIVED, NOT TYPED — the discipline fix-422 applied to `proj` and
    //     fix-423 to `dd`.
    minPx: CONSULTANT_CARD_MIN_WIDTH,
    floorReason:
      '★★★ HARD, DERIVED, and 46px BELOW the floor it replaces — see ' +
      'harness/consultant-column-floor.html for the Chrome measurement. The ' +
      'binding part is a native <input type="date">: 103px at this pill\'s ' +
      '10.5px, which the mock hides by drawing PLAIN TEXT boxes it can size ' +
      'freely. The app commits dates through BufferedDateInput, so it gets the ' +
      "browser's own control and the browser's own minimum. Side by side, as " +
      'the mock draws them, the two dates alone cost 252px of floor against ' +
      'the 190 Builder/Owner vacates — so the PAIR STACKS. That trades width, ' +
      'which this row has none of, for height, which a list-shaped card has. ' +
      'The floor is then the widest single control (the 104px status pill) ' +
      'plus the pill chrome plus the card chrome, computed — so a padding ' +
      'change moves it in the same build.',
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
  const gaps = (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP;
  const space = rowPx - gaps;
  const size = OVERVIEW_CARD_COLUMNS.map((c) => c.minPx);
  const frozen = OVERVIEW_CARD_COLUMNS.map(() => false);
  // ★ Freeze, re-share, repeat — because freezing one track raises every other
  //   track's share, which can push a SECOND track under its floor.
  for (let pass = 0; pass < OVERVIEW_CARD_COLUMNS.length; pass += 1) {
    let left = space;
    let fr = 0;
    OVERVIEW_CARD_COLUMNS.forEach((c, i) => {
      if (frozen[i]) left -= size[i];
      else fr += c.pct;
    });
    if (fr === 0) break;
    const unit = left / fr;
    let changed = false;
    OVERVIEW_CARD_COLUMNS.forEach((c, i) => {
      if (frozen[i]) return;
      const share = c.pct * unit;
      if (share < c.minPx) {
        frozen[i] = true;
        size[i] = c.minPx;
        changed = true;
      } else {
        size[i] = share;
      }
    });
    if (!changed) break;
  }
  return size;
}

// ===========================================================================
// ★★★ fix-423 — THE ROW WRAPS BELOW THE WIDTH WHERE IT FITS
// ===========================================================================
//
// fix-422 reported, and did not fix, that the five floors do not fit the row at
// 1280 or at 1440-expanded, so `pd-right-pillbox` scrolls sideways. This
// ticket's honest Milestones floor makes that worse, not better:
// OVERVIEW_ROW_MIN_WIDTH is 1218px and the row gets 710 at 1280 and 870 at
// 1440. **A sideways scroll is what this whole sequence exists to remove**, so
// the row wraps instead.
//
// ★★★ THE BREAKPOINT IS THE ROW'S OWN WIDTH, NOT THE VIEWPORT'S. The ribbon
// collapses without the window changing size (156px), so a media query would be
// wrong half the time — it would have to guess a state it cannot see. A
// CONTAINER query on the header, whose content box IS the row, is right in both
// ribbon states by construction. Verified in Chrome: the switch happens at
// exactly OVERVIEW_ROW_MIN_WIDTH of CONTENT box, which is why the padding does
// not have to be subtracted here.
//
// ★★★ WIDE STAYS A GRID; ONLY THE WRAPPED BAND IS FLEX. `fr` means "share of
// the row" and `flex-grow` means "share of the LEFTOVER" — they are different
// contracts, and fix-417's percentages are written in the first one. So the
// five-across layout keeps its grid template exactly, and flex is used only
// where the row has already broken and there is no five-column contract left to
// honour. That is also why the grid template stays an INLINE style: three
// suites (fix-309, fix-331, fix-417) read it off the element, and the narrow
// band overrides it with `!important` rather than moving it out from under
// them.
//
// ★★ THE BREAK IS AN ELEMENT, because flex chooses its own break points and
// they are wrong just under the threshold: at 1217px of row it fits FOUR cards
// on line one and leaves Builder/Owner alone on a 1217px line. A zero-height
// `flex-basis: 100%` child after Team pins the grouping Bobby's row reads in —
// Milestones · Project · Team, then Plan of Record · Builder/Owner — and it is
// `display: none` in both the wide band and the very narrow one.

/** The class on the row itself. The wide layout is its inline style; this is
 *  what the container query reaches for. */
export const OVERVIEW_ROW_CLASS = 'pd-overview-row';

/** The class on the zero-height forced line break. */
export const OVERVIEW_ROW_BREAK_CLASS = 'pd-overview-break';

/** The container name the query is scoped to. */
export const OVERVIEW_ROW_CONTAINER = 'pd-overview';

/** ★ The attribute each cell carries, so the narrow band can give it its share
 *  and its floor without depending on child order. */
export const OVERVIEW_CELL_ATTR = 'data-overview-cell';

/** How many cards sit on the first line once the row wraps. Milestones,
 *  Project, Team — Bobby's reading order, unbroken. */
export const OVERVIEW_ROW_LINE_1_COUNT = 3;

/**
 * What the wrapped FIRST line needs. ★ This is the number that decides whether
 * 1280 still scrolls: it is 698px against the 710px the row gets there, and it
 * is the reason `team.minPx` stayed at 160 instead of rising to 185.
 */
export const OVERVIEW_ROW_LINE_1_MIN_WIDTH: number =
  OVERVIEW_CARD_COLUMNS.slice(0, OVERVIEW_ROW_LINE_1_COUNT).reduce(
    (a, c) => a + c.minPx,
    0,
  ) +
  (OVERVIEW_ROW_LINE_1_COUNT - 1) * OVERVIEW_GRID_GAP;

/** What the wrapped SECOND line needs — Plan of Record and Builder/Owner. */
export const OVERVIEW_ROW_LINE_2_MIN_WIDTH: number =
  OVERVIEW_CARD_COLUMNS.slice(OVERVIEW_ROW_LINE_1_COUNT).reduce(
    (a, c) => a + c.minPx,
    0,
  ) +
  (OVERVIEW_CARD_COLUMNS.length - OVERVIEW_ROW_LINE_1_COUNT - 1) *
    OVERVIEW_GRID_GAP;

/** The narrowest viewport that still holds all five on ONE line — i.e. where
 *  the row wraps. `overviewMinViewport` is the same number; this name is what
 *  the PR body and the tests talk about. */
export function overviewWrapViewport(
  ribbon: 'expanded' | 'collapsed' = 'expanded',
): number {
  return overviewMinViewport(ribbon);
}

/** Which line a card lands on at a given row width. 0 = the row has not
 *  wrapped. */
export function overviewLineOf(key: string, rowPx: number): 0 | 1 | 2 {
  if (rowPx >= OVERVIEW_ROW_MIN_WIDTH) return 0;
  const i = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`overviewLineOf: no card named "${key}"`);
  // ★ Below the first line's own minimum the forced break is switched OFF and
  //   flex breaks wherever it must — the grouping is not promised there. It is
  //   below every viewport this app supports (a 1268px window).
  if (rowPx < OVERVIEW_ROW_LINE_1_MIN_WIDTH) return 0;
  return i < OVERVIEW_ROW_LINE_1_COUNT ? 1 : 2;
}

/**
 * The stylesheet the row renders with, generated from the constants above.
 *
 * ★ IT IS BUILT IN TS AND NOT IMPORTED FROM A `.css` FILE ON PURPOSE. A `?raw`
 *   import reads EMPTY under vitest (fix-406), so a CSS file could not be
 *   asserted — and these numbers are exactly the ones that must not drift.
 */
export const OVERVIEW_ROW_RESPONSIVE_CSS: string = [
  `.${OVERVIEW_ROW_BREAK_CLASS}{display:none}`,
  `@container ${OVERVIEW_ROW_CONTAINER} (max-width:${OVERVIEW_ROW_MIN_WIDTH - 0.02}px){`,
  `.${OVERVIEW_ROW_CLASS}{display:flex!important;flex-wrap:wrap!important;`,
  `grid-template-columns:none!important;grid-template-areas:none!important;`,
  `align-content:flex-start!important}`,
  // ★ `height:auto` is not tidying — it is load-bearing. The cells carry
  //   `height:100%` for the grid, and a flex item whose cross size is not
  //   `auto` is NOT stretched, so without this the cards on a line come out at
  //   three different heights and fix-309 #55 is silently lost when the row
  //   wraps. Measured before and after.
  `.${OVERVIEW_ROW_CLASS}>[${OVERVIEW_CELL_ATTR}]{height:auto!important;align-self:stretch!important}`,
  ...OVERVIEW_CARD_COLUMNS.map(
    (c) =>
      `.${OVERVIEW_ROW_CLASS}>[${OVERVIEW_CELL_ATTR}="${c.key}"]` +
      `{flex:${c.pct} 0 ${c.minPx}px;min-width:${c.minPx}px}`,
  ),
  '}',
  `@container ${OVERVIEW_ROW_CONTAINER} (min-width:${OVERVIEW_ROW_LINE_1_MIN_WIDTH}px) and (max-width:${OVERVIEW_ROW_MIN_WIDTH - 0.02}px){`,
  `.${OVERVIEW_ROW_BREAK_CLASS}{display:block!important;flex-basis:100%!important;height:0!important;margin:0!important}`,
  '}',
].join('\n');

// ===========================================================================
// ★★★ fix-423 — THE TEAM CARD'S INTERNAL BLOCK GOES TWO COLUMNS
// ===========================================================================
//
// Bobby, 2026-08-27: *"Could we do Acquisitions and Entitlement on the
// left-hand side of Internal, and then horizontally on the right SD, Design
// Manager, Design Associate? That might shrink the vertical height so Schedule
// Health moves up and is more visible."* He mocked it himself; the mock is the
// spec.
//
// ★★ THE ORDER IS STILL fix-321 #78's — *"acquisitions, entitlements, …
// schematic design — so SD — then design manager, then design associate"* —
// and it is declared ONCE here, with the column each row belongs to, so the
// two-up and the stacked fallback cannot tell two different stories. Read the
// list top to bottom and you get exactly the order the card used to stack in,
// which is what the wrapped state renders.
//
// ★★★ AND IT COLLAPSES BY WRAPPING, NOT BY A QUERY. Two flex columns with a
// declared minimum simply sit side by side when the card is wide enough and
// stack when it is not — and stacked they are indistinguishable from the five
// rows this replaces. No breakpoint to get wrong, and the narrow band (the
// wrapped row at a 1280 window, where Team renders 172px) degrades to today's
// card rather than to a squeezed version of the new one.

/** `TeamRow`'s `w-8` role column. */
export const TEAM_ROLE_LABEL_WIDTH = 32;

/** `TeamRow`'s `gap-1` between the role and the name. */
export const TEAM_ROLE_LABEL_GAP = 4;

/**
 * What the NAME needs beside its role.
 *
 * ★ Measured on prod, 2026-08-27: the longest name across `acq_lead`,
 *   `entitlement_lead` and `design_manager` on active projects is 8 characters
 *   and the average is 5.4. "Meredith" measures 43.3px at this card's 10px
 *   bold; 52 leaves room for a ten-character name before anything wraps — and
 *   wrapping is the graceful failure here, not clipping, because these are
 *   spans and not inputs.
 */
export const TEAM_ROLE_VALUE_MIN = 52;

/** One internal column. */
export const TEAM_INTERNAL_COLUMN_MIN =
  TEAM_ROLE_LABEL_WIDTH + TEAM_ROLE_LABEL_GAP + TEAM_ROLE_VALUE_MIN;

/** Between the two columns. Wider than the 4px between rows, so the eye reads
 *  two columns rather than one grid of eight things. */
export const TEAM_INTERNAL_COLUMN_GUTTER = 8;

/** Between rows inside a column — `gap-1`, i.e. what the stack has today. */
export const TEAM_INTERNAL_ROW_GAP = 4;

/**
 * ★★ The width the INTERNAL SECTION BODY needs before the second column can sit
 * beside the first. Add `OVERVIEW_CARD_CHROME` for the width the CARD needs:
 * 206px, which the Team card exceeds at every width where the row has not
 * wrapped (217px at a 1920 window) and does not at the wrapped 1280 (172px).
 */
export const TEAM_INTERNAL_TWO_UP_MIN =
  TEAM_INTERNAL_COLUMN_MIN * 2 + TEAM_INTERNAL_COLUMN_GUTTER;

export interface TeamInternalRow {
  /** Which value this row shows.
   *  ★ fix-487 appends `ca`. Widening THIS union is what makes the sixth block
   *    a compiler problem rather than a silent omission: every
   *    `Record<TeamInternalRow['key'], …>` consumer must supply the value. */
  key: 'acq' | 'ent' | 'sd' | 'dm' | 'da' | 'ca';
  /** The abbreviation the card prints. */
  label: string;
  /** fix-321: the tier's full name, since the card shows abbreviations. */
  title: string;
  /** Bobby's mock: ACQ and ENT left, SD / DM / DA right. */
  column: 'left' | 'right';
}

/** ★ fix-321 #78's order, and fix-423's columns, in one list. */
export const TEAM_INTERNAL_ROWS: readonly TeamInternalRow[] = [
  { key: 'acq', label: 'ACQ', title: 'Acquisitions', column: 'left' },
  { key: 'ent', label: 'ENT', title: 'Entitlements', column: 'left' },
  { key: 'sd', label: 'SD', title: 'Schematic design', column: 'right' },
  { key: 'dm', label: 'DM', title: 'Design Manager', column: 'right' },
  { key: 'da', label: 'DA', title: 'Design Associate', column: 'right' },
  // ★★★ fix-487 (P-144) — the sixth block, AFTER Design Associate.
  //
  // fix-475's own note promised it: *"a sixth role added to the table appears
  // here for free."* It does — the card, the chat modal's avatar strip and the
  // fix-479 height harness all iterate this list.
  //
  // ★★ LAST, because the list is in the order the work happens: land,
  //    entitlement, schematic, manager, associate — and construction admin is
  //    post-permit-issuance, which is after all five.
  //
  // ★ `column: 'right'` is vestigial here: fix-475 replaced fix-423's two-up
  //   with one block per role. It is set consistently with its neighbours so
  //   the field keeps meaning something if the two-up ever returns.
  { key: 'ca', label: 'CA', title: 'Construction Admin', column: 'right' },
];
