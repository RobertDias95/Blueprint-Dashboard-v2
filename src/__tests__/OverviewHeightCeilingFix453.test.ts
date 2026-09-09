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
 *
 * ★★★ AND IT REOPENED, ON 2026-09-08. fix-506 §A did not find a width — it
 *     removed the card. See the inverted block below; the reasoning above is
 *     kept whole because it was right about the premise it had.
 */
describe('fix-453 — the overview height ceiling, pinned', () => {

  it('the cards are still ONE grid row, so the height is a MAX (0c)', () => {
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

  // =========================================================================
  // ★★★ SUPERSEDED BY fix-506 §A — THE MILESTONES CARD NO LONGER EXISTS
  // =========================================================================
  //
  // fix-453 shipped a MEASUREMENT and no UI, and its conclusion was that
  // Milestones is INCOMPRESSIBLE: its rows are 200px each because four of them
  // hold a native `<input type="date">`, its card sat on a 222px floor at every
  // supported viewport, and two columns need 410 — so there was no width at
  // which the card could be made shorter, and nothing shipped.
  //
  // ★★★ fix-506 DID NOT FIND A WIDTH. IT REMOVED THE CARD. Bobby's v14 folds
  //     those dates into the Project card as PRINTED text (the overview is
  //     read-only now, P-140), and a printed `07/06/2026` costs 60px against
  //     the 100 an editable one does — which is the whole of why the arithmetic
  //     changed. fix-453's reasoning was correct and is not being overturned:
  //     the premise it reasoned about is gone.
  //
  // ★★ AND THE NUMBERS MOVED THE WAY fix-453 SAID THEY WOULD IF THE PREMISE
  //    EVER CHANGED. Its closing note — *"if a future ticket widens the
  //    Milestones column or shrinks its row, this suite is where that surfaces
  //    and the ruling genuinely reopens"* — is exactly what happened, so these
  //    are inverted here rather than deleted.

  it('★★★ SUPERSEDED: there is no Milestones card, and no `dd` column', () => {
    expect(OVERVIEW_CARD_COLUMNS.some((c) => c.key === 'dd')).toBe(false);
    expect(OVERVIEW_GRID_AREAS).not.toContain('dd');
    // ★ Three cards, not five — Plan of Record · Project · Team.
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual([
      'por',
      'proj',
      'team',
    ]);
  });

  it('★★★ SUPERSEDED: the row got SHORTER by losing the card, not by shrinking it', () => {
    // fix-453's premise: no work on a neighbour could take the row below the
    // Milestones card's own height. True, and irrelevant once the card goes.
    //
    // ★ The row minimum falls 1,172 → 904, so the whole row now runs unwrapped
    //   from a narrower window than fix-453 measured as its wrap point.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBeLessThan(1172);
    expect(overviewMinViewport()).toBeLessThan(1788);
    // ★★ AND 1600 FITS ON ONE LINE, which it did not at any point in the
    //    fix-417 → fix-453 sequence. That is the headline of fix-506 §A.
    expect(overviewRowWidthAt(1600)).toBeGreaterThanOrEqual(OVERVIEW_ROW_MIN_WIDTH);
  });

  it('★★ the MILESTONE_* constants survive, because Project Data still uses them', () => {
    // ★★★ THE ROWS DID NOT DIE WITH THE CARD. `MilestoneDateRow` is the Dates
    //     tab of the Project Data modal now (fix-506 §G), so its declared
    //     minimum is still load-bearing — just for a 760px modal rather than a
    //     222px column, which is why it is no longer a constraint on the row.
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(200);
    expect(MILESTONE_ROW_MIN_WIDTH * 2 + OVERVIEW_GRID_GAP).toBe(410);
  });

  it('★★★ 1280 is the last wrapped viewport now — 1440 fits, by one pixel', () => {
    // ★ fix-506 left 1440 wrapped (870 against a 904 minimum) and 1600 not.
    //   fix-507 §A moves the LINE, not the floors: the permits rail gives back
    //   50px and STEP 0 charges the row 15 for the pillbox scrollbar it had
    //   never counted, so every viewport gains 35 and 1440 lands on 905 against
    //   904. The "line 1 / line 2" halves of fix-453's table now describe 1280.
    // ★★★ AND fix-508 HANDS 1440 BACK. The Plan of Record's floor rises to the
    //     width its capped thumbnail uses (368 → 486), so the row minimum goes
    //     904 → 996 and 1440's 905 no longer clears it. fix-507 won that
    //     viewport by a single pixel; this spends it and 91 more, deliberately.
    //     1600 and 1920 — the widths Bobby works at — both still run on one
    //     line, which is the claim that has to survive.
    expect(overviewRowWidthAt(1440)).toBe(905);
    expect(overviewRowWidthAt(1440)).toBeLessThan(OVERVIEW_ROW_MIN_WIDTH);
    expect(overviewRowWidthAt(1600)).toBeGreaterThan(OVERVIEW_ROW_MIN_WIDTH);
    expect(overviewRowWidthAt(1920)).toBeGreaterThan(OVERVIEW_ROW_MIN_WIDTH);
  });
});
