import { weekKeyToQuarterOffset } from './drawScheduleHelpers';
import { quarterOffsetToString, quarterStringToOffset } from './teamQuarterHelpers';

// ★★ fix-335 §7 — the link from a project to its block on the draw schedule.
//
// Bobby: "Under milestones, at the bottom, underneath permit date, we want a
// button that from there will take you to the draw schedule."
//
// ★ DECIDED: it lands on THIS PROJECT'S BLOCK — scrolled to and ringed, inside
// the full schedule, not filtered down to one lane. The draw schedule's value is
// the neighbours: who else is on that DA, what is either side of you. A view
// filtered to one block answers a question nobody asked.
//
// ---------------------------------------------------------------------------
// ★★★ THE CONSTRAINT IS fix-182'S QUARTER-VERSIONED LAYOUT
// ---------------------------------------------------------------------------
//
// The grid does not render one board — it renders a board PER QUARTER, and past
// quarters render as they looked at the time (saved layouts, DA rosters as they
// were). "Go to the draw schedule" is therefore an incomplete instruction: go to
// WHICH quarter's schedule? Landing on today's and finding nothing is the dead
// link the brief warns about, and it is silent — the block exists, you are
// merely looking at the wrong quarter.
//
// ★ SO THE LINK NAMES THE QUARTER, in the URL and on the button's face. It is
// derived from the block's OWN start_week, so it cannot name a quarter the block
// is absent from. You always land where the block starts.
//
// ★ AND THE QUARTER TRAVELS AS 'YYYY-Qn', NOT AS AN OFFSET. The grid's internal
// state is an offset from the current quarter — a number that means something
// different tomorrow. Pasting `?quarter=2` into chat, or opening it after the
// quarter turns, would land somewhere else. An absolute quarter string is stable
// for as long as the link exists; the grid converts it back on arrival.
//
// ★★ A PROJECT WITH NO BLOCK AT ALL still gets a working button, because
// fix-335 §8 allows exactly one inert control in this ticket and it is not this
// one. It drops both parameters and goes to the live schedule — a real
// destination, honestly labelled, where the answer to "where is this project?"
// is visibly "not on the board". The button's own text is what says so.

export interface DrawScheduleTarget {
  /** Where the button goes. Always a real route. */
  href: string;
  /** 'YYYY-Qn' the block starts in, or null when there is no block. */
  quarter: string | null;
  /** 'Q3 2026' — the quarter, as a person reads it. Null with no block. */
  quarterLabel: string | null;
  /** Does this project have a scheduled block to land on? */
  hasBlock: boolean;
}

/** '2026-Q3' → 'Q3 2026'. Matches getQuarterLabel's wording so the button and
 *  the grid's own quarter navigator say the same thing. */
export function humanQuarter(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return m ? `Q${m[2]} ${m[1]}` : quarter;
}

/** Where the Milestones card's Draw schedule button should point.
 *
 *  `startWeek` is the project's `draw_schedule.start_week`, or null/undefined
 *  when it has no row — the caller already holds that row for the overlap
 *  prompt, so this costs no extra query. */
export function drawScheduleTarget(
  projectId: string,
  startWeek: string | null | undefined,
  now: Date = new Date(),
): DrawScheduleTarget {
  if (!startWeek) {
    return {
      href: '/draw-schedule',
      quarter: null,
      quarterLabel: null,
      hasBlock: false,
    };
  }
  const quarter = quarterOffsetToString(weekKeyToQuarterOffset(startWeek, now), now);
  return {
    href: `/draw-schedule?project=${encodeURIComponent(projectId)}&quarter=${quarter}`,
    quarter,
    quarterLabel: humanQuarter(quarter),
    hasBlock: true,
  };
}

/** The grid's side of the same contract: read the two parameters back.
 *
 *  ★ A malformed or absent quarter resolves to offset 0 rather than throwing —
 *  a hand-edited URL should land you on this quarter's board, not on a blank
 *  screen. quarterStringToOffset already returns 0 for anything unparseable. */
export function parseDrawScheduleFocus(
  search: URLSearchParams,
  now: Date = new Date(),
): { projectId: string | null; quarterOffset: number } {
  const projectId = search.get('project');
  const quarter = search.get('quarter');
  return {
    projectId: projectId && projectId.trim() !== '' ? projectId : null,
    quarterOffset: quarter ? quarterStringToOffset(quarter, now) : 0,
  };
}
