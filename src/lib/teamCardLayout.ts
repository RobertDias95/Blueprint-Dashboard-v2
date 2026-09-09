import {
  OVERVIEW_CARD_CHROME,
  TEAM_INTERNAL_COLUMN_MIN,
} from './overviewCardLayout';

// ===========================================================================
// ★★★ fix-507 §C (P-176) — THE TEAM CARD GOES THREE COLUMNS, AND CHAT MOVES
// ===========================================================================
//
// This is **fix-506's stated deviation #1 coming home.** That ticket built the
// consultant band exactly as the v14 mock draws it and then kept the card's
// existing STACKED sections above it, saying so in the PR:
//
//     "v14 draws Builder/Owner and Internal on the LEFT with Chat top-right, in
//      a three-column `tgrid`, and this card keeps its existing stacked
//      sections … Trading two shipped layout contracts for a column
//      arrangement is a bad trade to make unasked, so it is flagged in the PR
//      instead of taken."
//
// Bobby has now asked for it, and it is also the single largest lever on §D:
// measured in Chrome on the shipped app at 1920, Team is **the tallest card in
// the row on both measurement projects** — 773 on `233 31st Ave E` and 721 on
// `403 W Dravus St`, against Project's 603/605 and Plan of Record's 411. Chat
// stacked underneath Builder/Owner and Internal costs its full height; beside
// them it costs nothing, because the two blocks in column 1 are taller.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT fix-345's HEIGHT DISTRIBUTION DOES UNDER THIS GRID — THE ANSWER
// ---------------------------------------------------------------------------
//
// fix-506's caution was specific and it was right to raise it: `OverviewCard`
// distributes spare height across its DIRECT `OverviewSection` children
// (fix-331 §1, `flexGrow: 1` on each), and fix-345 §3 pins the Chat button to
// the card's floor with `flexGrow: 0` + `marginTop: auto`. fix-418 wrapped
// three sections in a container inside the PROJECT card and silently swallowed
// exactly that distribution.
//
// ★★★ NEITHER CONTRACT IS DELETED, AND NEITHER IS WORKED AROUND.
//
//   · **fix-345 §3 is untouched.** The Chat BUTTON's section is still a direct
//     child of the card and still `pinBottom`, so it still takes no share and
//     still lands on the card's floor — the same baseline Project's draw-
//     schedule link and Site data's Connect link sit on. Nothing about the
//     button moved; what moved is the chat PREVIEW, which was never what
//     fix-345 pinned.
//
//   · **fix-331 §1 still distributes, over two children instead of four.** The
//     grid below is itself a growing child (`flex-grow: 1`), so the card's
//     spare height splits between the team grid and the consultant band, and
//     WITHIN the grid it goes to the Internal row (`grid-template-rows: auto
//     1fr`). That is what the mock draws — `.tgrid{grid-template-rows:auto 1fr
//     auto}` — and it is the fix-418 trap avoided rather than re-sprung: the
//     wrapper is not a passive box that eats the growth, it is a declared
//     participant in it.
//
//   ★ In practice the Team card has NO spare height to distribute on either
//     measurement project, because it is the card that SETS the row's height
//     (the row is `align-items: stretch`, so its height is the max over the
//     cells — fix-423). The distribution matters on projects where some other
//     card is taller, and there it behaves as described above.
//
// ---------------------------------------------------------------------------
// ★★★ AND IT COLLAPSES BY QUERY, BECAUSE THE MOCK HAS NO NARROW STATE
// ---------------------------------------------------------------------------
//
// `.tgrid` is drawn at one width. Team's FLOOR is 162px (one consultant pill
// plus card chrome — fix-506), and a three-column grid at 162 would hand the
// chat cell about 95px, which is not a chat preview, it is a column of broken
// words. fix-423's rule — *"a layout that asks for width the row cannot always
// give is not a floor"* — so the three columns are a CONTAINER QUERY on the
// card and the default is the stacked card fix-506 shipped. Below the
// threshold the render is byte-for-byte today's, which is the degraded state
// this repo keeps choosing on purpose.

/** What column 1 needs: one Internal row at its measured minimum, plus the
 *  section's own `px-2.5` and the card's border. */
export const TEAM_GRID_COLUMN_1_MIN =
  TEAM_INTERNAL_COLUMN_MIN + OVERVIEW_CARD_CHROME;

/**
 * What the chat cell needs.
 *
 * ★ fix-507 §C set this to 150 — *"the width at which that line still carries
 *   three or four words"* — which was a judgement about a PREVIEW, and the only
 *   thing in the cell was a preview.
 *
 * ★★★ fix-508 §F4 PUT A BUTTON IN THE CELL, and that changes what the floor
 *     IS rather than how big it should be. The `Chat · N →` control is
 *     `w-full h-[26px] whitespace-nowrap` — it cannot reflow, and the card is
 *     `overflow-hidden`, so below its own width it CLIPS. The preview above it
 *     is text that truncates.
 *
 * ★★★ SO THE FLOOR IS THE BUTTON, and this is the same reasoning §F1 applies
 *     to the consultant pill one section earlier: **a floor is what cannot
 *     reflow.** Measured in Chrome at the widest face the button can ever
 *     carry — `Chat · 128`, three digits of post count — it needs 83px, plus
 *     the section's own `px-2.5`.
 *
 * ★★ AND IT MATTERS AT 1600, which is why it is derived rather than left at a
 *    judgement: 150 put the three-column threshold at 260 and Team gets 231
 *    there once the Plan of Record takes its new floor. A 150 that was never
 *    measured would have collapsed the grid — and handed back fix-507 §C's
 *    1600 win — on the strength of a number nobody had checked.
 */
export const CHAT_BUTTON_MIN = 83;

export const TEAM_GRID_CHAT_MIN = CHAT_BUTTON_MIN + 20;

/** The card width at which the three-column arrangement appears.
 *  ★ A container query measures the container's CONTENT box, so the card's own
 *    border is NOT added here — see `PROJECT_CARD_BORDER` for the render that
 *    established that, and fix-423 for the first time this repo found it. */
export const TEAM_GRID_CARD_MIN = TEAM_GRID_COLUMN_1_MIN + TEAM_GRID_CHAT_MIN;

/** The mock's `.tgrid{grid-template-columns:1.1fr 1fr 1fr}` with Chat at
 *  `grid-column:2/4` — i.e. column 1 takes 1.1 of 3.1 and Chat the rest. */
export const TEAM_GRID_COLUMNS = '1.1fr 2fr';

/** The containment context, on the Team card. */
export const TEAM_CARD_CONTAINER = 'pd-team';

/** The class on the Team card. */
export const TEAM_CARD_CLASS = 'pd-team-card-box';

/** The class on the grid that holds Builder/Owner, Internal and Chat. */
export const TEAM_GRID_CLASS = 'pd-team-grid';

/** Column 1 — Builder/Owner over Internal. */
export const TEAM_GRID_COLUMN_1_CLASS = 'pd-team-grid-col1';

/** The chat cell — the mock's `.chatcell{grid-column:2/4;grid-row:1/3}`. */
export const TEAM_GRID_CHAT_CLASS = 'pd-team-grid-chat';

/**
 * The Team card's stylesheet.
 *
 * ★ Generated in TS from the constants above — a `?raw` CSS import reads EMPTY
 *   under vitest (fix-406), and the threshold is a number a test must be able
 *   to assert against the same source the browser reads.
 *
 * ★ STACKED IS THE DEFAULT. The three columns are the query, so a card too
 *   narrow to hold them — or a browser without container queries — renders the
 *   card fix-506 shipped rather than a squeezed version of the new one.
 */
export const TEAM_GRID_CSS: string = [
  `.${TEAM_CARD_CLASS}{container-type:inline-size;container-name:${TEAM_CARD_CONTAINER}}`,
  // ★ Stacked: the grid is a plain column, so its three children sit in the
  //   order they always have — Builder/Owner, Internal, Chat.
  `.${TEAM_GRID_CLASS}{display:flex;flex-direction:column;flex-grow:1;flex-shrink:0;min-width:0}`,
  `.${TEAM_GRID_COLUMN_1_CLASS},.${TEAM_GRID_CHAT_CLASS}{display:flex;flex-direction:column;min-width:0}`,
  `@container ${TEAM_CARD_CONTAINER} (min-width:${TEAM_GRID_CARD_MIN}px){`,
  `.${TEAM_GRID_CLASS}{display:grid;grid-template-columns:${TEAM_GRID_COLUMNS};` +
    `grid-template-rows:auto 1fr}`,
  `.${TEAM_GRID_COLUMN_1_CLASS}{grid-column:1;grid-row:1/3}`,
  // ★ The mock's `.tgrid>.cell{border-right}` seen from the other side: the
  //   chat cell draws the rule, so column 1 keeps the section borders it
  //   already has and nothing needs a `:last-child` exception.
  `.${TEAM_GRID_CHAT_CLASS}{grid-column:2/3;grid-row:1/3;` +
    `border-left:1px solid var(--color-border)}`,
  // ★ In the grid the chat section is no longer the third thing down the card,
  //   so its own `border-top` would draw a rule across the top of the cell that
  //   lines up with nothing. The vertical rule is what separates it now.
  `.${TEAM_GRID_CHAT_CLASS}>section{border-top:0}`,
  '}',
].join('\n');
