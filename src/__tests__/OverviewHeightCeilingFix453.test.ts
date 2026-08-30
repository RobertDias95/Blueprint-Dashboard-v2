import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_AREAS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_ROW_MIN_WIDTH,
  MILESTONE_ROW_MIN_WIDTH,
  MILESTONE_LABEL_WIDTH,
  MILESTONE_LABEL_GAP,
  MILESTONE_BOX_CHROME,
  MILESTONE_DATE_INPUT_MIN,
  resolveOverviewWidths,
  overviewRowWidthAt,
  overviewMinViewport,
} from '../lib/overviewCardLayout';

/**
 * ★★★ fix-453 (P-080) — WHY THIS TICKET SHIPPED A MEASUREMENT AND NO UI.
 *
 * The brief scoped a height cut across the PROJECT card AND Milestones, gated on
 * a measurement. The measurement (docs/FIX_453_OVERVIEW_HEIGHT_MEASUREMENT.md)
 * confirmed PROJECT is still the row's ceiling — and then killed the other half:
 *
 *   · P-080's premise is dead. It was raised against a label-ABOVE-control stack
 *     that could be two-upped. Every field in the card is `items-baseline` with
 *     the label BESIDE the value; there is no stack left to fold.
 *
 *   · Milestones is INCOMPRESSIBLE, and that is arithmetic rather than taste —
 *     which is the part this file exists to keep true.
 *
 * ★★★ THE LOAD-BEARING FACT: a Milestones row's minimum is DECLARED
 * (MILESTONE_ROW_MIN_WIDTH = 200px), and the Milestones card sits on a 222px
 * floor at every viewport this app supports. Two columns need >= 408px. There is
 * no width at which they fit, so the card's measured 412px height is a FLOOR and
 * no work on its neighbour can take the row below it.
 *
 * ★★ IF A FUTURE TICKET WIDENS THE MILESTONES COLUMN OR SHRINKS ITS ROW, THIS
 * SUITE IS WHERE THAT SURFACES — and the fix-453 ruling genuinely reopens. These
 * are not decorative pins: they are the reason nothing shipped.
 */
describe('fix-453 — the overview height ceiling, pinned', () => {
  const dd = () => OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'dd');

  it('the five cards are still ONE grid row, so the height is a MAX (0c)', () => {
    // A single-row template string: one quoted row, every card key inside it.
    expect(OVERVIEW_GRID_AREAS.match(/"/g)).toHaveLength(2);
    OVERVIEW_CARD_COLUMNS.forEach((c) => {
      expect(OVERVIEW_GRID_AREAS).toContain(c.key);
    });
    // If this ever becomes two rows the whole "tallest card sets the row"
    // premise — and this ticket's conclusion — stops applying.
    expect(OVERVIEW_GRID_AREAS.trim().split('\n')).toHaveLength(1);
  });

  it('a Milestones row minimum is 200px and is built from named parts', () => {
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(
      MILESTONE_LABEL_WIDTH +
        MILESTONE_LABEL_GAP +
        MILESTONE_BOX_CHROME +
        MILESTONE_DATE_INPUT_MIN,
    );
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(200);
  });

  it.each([1920, 1600, 1440, 1280])(
    'at %ipx the Milestones card is far too narrow for two columns of dates',
    (viewport) => {
      const rowPx = overviewRowWidthAt(viewport);
      const cardPx = resolveOverviewWidths(rowPx)[dd()];

      // Two-up needs two rows side by side plus a gutter between them.
      const twoUpNeeds = MILESTONE_ROW_MIN_WIDTH * 2 + OVERVIEW_GRID_GAP;
      expect(twoUpNeeds).toBe(410);

      expect(cardPx).toBeLessThan(twoUpNeeds);
      // ★ And not marginally: the card cannot even hold ONE row plus half of a
      //   second. This is why "make Milestones shorter" has no move that is not
      //   deleting one of its nine live date fields.
      expect(cardPx).toBeLessThan(MILESTONE_ROW_MIN_WIDTH * 1.5);
    },
  );

  it('the Milestones card sits on its floor at every supported viewport', () => {
    const floor = OVERVIEW_CARD_COLUMNS[dd()].minPx;
    // ★ 1788px is where all five cards stop fitting on one line; every viewport
    //   the team actually uses is at or below it, so the card is at its floor.
    expect(overviewMinViewport()).toBeGreaterThan(1440);
    [1920, 1600, 1440, 1280].forEach((viewport) => {
      const cardPx = resolveOverviewWidths(overviewRowWidthAt(viewport))[dd()];
      expect(cardPx).toBe(floor);
    });
    // The floor is barely wider than one row's own declared minimum — 22px of
    // slack, which is the whole story of this ticket in one number.
    expect(floor - MILESTONE_ROW_MIN_WIDTH).toBeLessThan(30);
  });

  it('a 1440px viewport puts the row BELOW its one-line minimum (it wraps)', () => {
    // The measurement table reports 1440 as a wrapped row on purpose; if this
    // flips, the "line 1 / line 2" halves of that table stop describing reality.
    expect(overviewRowWidthAt(1440)).toBeLessThan(OVERVIEW_ROW_MIN_WIDTH);
    expect(overviewRowWidthAt(1920)).toBeGreaterThan(OVERVIEW_ROW_MIN_WIDTH);
  });
});
