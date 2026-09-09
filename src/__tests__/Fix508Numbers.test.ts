import { describe, it, expect } from 'vitest';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_ROW_MIN_WIDTH,
  overviewMinViewport,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import {
  CONSULTANT_PILL_COMPACT_MIN,
  CONSULTANT_PILL_UNTRUNCATED_MIN,
  DATES_CARD_MIN_WIDTH,
  DATES_LABEL_WIDTH,
  PLAN_OF_RECORD_CARD_MIN,
  PLAN_SHEET_MODAL_ASPECT,
  POR_CARD_WIDTH_AT_REFERENCE,
  POR_IMAGE_MAX_HEIGHT,
  PROJECT_CARD_BORDER,
  PROJECT_CARD_MIN_WIDTH,
  SITE_DATA_MIN_WIDTH,
  SITE_DATES_SIDE_BY_SIDE_MARGIN,
  SITE_DATES_SIDE_BY_SIDE_MIN,
  SITE_WIDEST_ROW_MEASURED,
  SITE_WIDEST_ROW_ON_PROD,
  UNIT_MATRIX_LABEL_COL,
  UNIT_MATRIX_TRANSPOSED_WIDTH,
  UNIT_MATRIX_TYPE_COL,
  UNIT_MATRIX_TYPE_STEPS,
} from '../lib/projectCardLayout';
import {
  CHAT_BUTTON_MIN,
  TEAM_GRID_CARD_MIN,
  TEAM_GRID_CHAT_MIN,
  TEAM_GRID_COLUMN_1_MIN,
} from '../lib/teamCardLayout';
import { STAGE_FULL_LABEL, STAGE_ORDER } from '../lib/stageLabel';

// ===========================================================================
// ★★★ fix-508 STEP 0 — THE OVERVIEW REDRAWN, IN DERIVED NUMBERS
// ===========================================================================
//
// Every number here comes out of the same modules the app renders from, and
// every one was confirmed in Chrome against the live app on `233 31st Ave E`
// (2 units · 6 consultants · 6 permits) and `403 W Dravus St` (6 units · 3
// consultants). Full table in docs/FIX_508_OVERVIEW_MEASUREMENT.md.
//
// ---------------------------------------------------------------------------
// ★★★ THE ONE THAT EXPLAINS THE OTHERS: TWO EARLIER fix-508 BRIEFS WERE VOID
// ---------------------------------------------------------------------------
//
// Both were written to find **77px** so the Site/Dates pair could sit side by
// side — one by tightening the pair, one by narrowing the permits rail into
// deeper truncation. The 77 was measured against a pair needing **475**, and
// the 296 of that which was the Dates card is the two-by-two quadrant grid §B
// deletes. One column of the same rows is **156**.
//
// **The deficit was a fact about the drawing, not about the shell.** It is not
// closed here; it is withdrawn. → [[do-not-brief-a-layout-that-is-still-being-
// redesigned]]
//
//     the pair          475 → 320
//     Project's floor   354 → 330   (and the PAIR binds it now, not the matrix)
//     the row minimum   904 → 996   (the Plan of Record's new floor)
//
// ---------------------------------------------------------------------------
// THE ROW, AT 1920 AND 1600, AFTER (Chrome, live app, ribbon expanded)
// ---------------------------------------------------------------------------
//
//                     1920                    1600
//   Plan of Record    486  (its floor)        486  (its floor)
//   Project           382  (−20%, Bobby's)    330  (its floor)
//   Team              497  (the widest card)  231
//   Site beside Dates yes, 60px of margin     yes, 8px of margin
//   Team's 3 columns  yes                     yes, by 18px

describe('fix-508 §A/§B — the Project card empties out', () => {
  it('★★★ Site loses ` derived`, and the row that binds it CHANGES', () => {
    // ★ fix-507 measured `Lot size 4,400 sf derived` at 147 and made it the
    //   floor. §A takes the suffix off the face (P-192 owns the RULE about when
    //   a size may be derived; this is display only), so the widest realisable
    //   row is `Lot 100 × varies` at 134.
    expect(SITE_WIDEST_ROW_MEASURED).toBe(134);
    expect(SITE_DATA_MIN_WIDTH).toBe(154);
    // ★★ AND THE `varies` STATE IS REACHABLE BUT UNOCCUPIED — measured on prod
    //    2026-09-09, ZERO projects have a typed lot size with exactly one of
    //    width/depth. The floor covers it anyway (fix-422: the widest content
    //    the card CAN hold), and what it costs is recorded rather than argued:
    //    the widest row that exists today is `Zone MIO-37-LR3` at 119.
    expect(SITE_WIDEST_ROW_ON_PROD).toBe(119);
    expect(SITE_WIDEST_ROW_MEASURED - SITE_WIDEST_ROW_ON_PROD).toBe(15);
  });

  it('★★★ the Dates card is ONE column, and that is the whole ticket', () => {
    // ★★★ 296 → 156. Two label tracks and two date tracks side by side against
    //     one of each. The label is sized for §D's longest new row.
    expect(DATES_LABEL_WIDTH).toBe(66);
    expect(DATES_CARD_MIN_WIDTH).toBe(156);
    // ★ …and the flipped forms are SHORTER — `Accepted intake` 64, `Approved`
    //   40 — so neither flip can re-flow the card. Asserted as the property:
    //   the label track is at least as wide as the longest label that can
    //   appear in it.
    expect(DATES_LABEL_WIDTH).toBeGreaterThanOrEqual(64);
  });

  it('★★★ so the pair needs 320 where it needed 475', () => {
    expect(SITE_DATES_SIDE_BY_SIDE_MIN).toBe(320);
    expect(475 - SITE_DATES_SIDE_BY_SIDE_MIN).toBe(155);
  });
});

describe('fix-508 §C — the units matrix shrinks, and hands over the floor', () => {
  it('★★★ the padding falls and the TYPE STEP does not', () => {
    // §C's stated bound: nothing below the `normal` step, because P-189 is
    // making this card more legible rather than less.
    expect(UNIT_MATRIX_TYPE_STEPS.normal.cell).toBe(10);
    expect(UNIT_MATRIX_TYPE_STEPS.big.cell).toBe(11);
    // ★ What moved is padding: 6 → 4 across, 5 → 3 down (8 → 6 at `big`).
    expect(UNIT_MATRIX_TYPE_STEPS.normal.padX).toBe(4);
    expect(UNIT_MATRIX_TYPE_STEPS.normal.padY).toBe(3);
    expect(UNIT_MATRIX_TYPE_STEPS.big.padY).toBe(6);
  });

  it('★★★ the columns are DERIVED from what they must hold at the floor', () => {
    // Measured in Chrome at the `normal` face:
    //   value, widest (`1,850` · `31.75`)          24
    //   `Unit 6` whole                             38
    //   `Unit 6` wrapped, widest line — `Unit`     28   ← the floor holds this
    //   `Roof deck`                                47
    expect(UNIT_MATRIX_TYPE_COL).toBe(36);
    expect(UNIT_MATRIX_LABEL_COL).toBe(51);
    expect(UNIT_MATRIX_TRANSPOSED_WIDTH).toBe(267);
    // ★★ THE ORDINAL MAY WRAP AT THE FLOOR AND MAY NEVER TRUNCATE. Two short
    //    lines reading `Unit` / `6` identify the column exactly as well as one
    //    line; `Uni…` would not. That single decision is the difference between
    //    a 36px column and a 50px one, and 6 × 14 is 84px of Project card.
    expect(UNIT_MATRIX_TYPE_COL).toBeLessThan(38 + 2 * 4);
  });

  it('★★★ …and the PAIR takes the Project floor off it', () => {
    // ★ The matrix has bound this floor since fix-422. §C takes it to 289 of
    //   card and §B's pair — which can no longer wrap at 1600, by ruling —
    //   passes it on the way down at 330.
    expect(UNIT_MATRIX_TRANSPOSED_WIDTH + 22).toBe(289);
    expect(
      SITE_DATES_SIDE_BY_SIDE_MIN + PROJECT_CARD_BORDER + SITE_DATES_SIDE_BY_SIDE_MARGIN,
    ).toBe(330);
    expect(PROJECT_CARD_MIN_WIDTH).toBe(330);
    // ★★ THE MARGIN IS IN THE FLOOR, not only in a test: a breakpoint met to
    //    the pixel is one rounding error from stacking. STOP (b) asked for ≥ 8.
    expect(SITE_DATES_SIDE_BY_SIDE_MARGIN).toBe(8);
  });
});

describe('fix-508 — fix-417 retired: a FLOOR, not a rank', () => {
  it('★★★ the Plan of Record floor is the width its capped sheet uses', () => {
    // ★★★ Bobby's two constants, verified as he asked:
    //     485 − 22 = 463 of image; 463 ÷ 1.54525 = 299.63 → cap 300.
    expect(POR_CARD_WIDTH_AT_REFERENCE).toBe(485);
    expect(PLAN_SHEET_MODAL_ASPECT).toBeCloseTo(1400 / 906, 6);
    expect(POR_IMAGE_MAX_HEIGHT).toBe(300);
    // ★ Inverting the cap gives **486**, one pixel up, because the cap rounded
    //   up. Reported rather than smoothed over — and the floor takes the
    //   derived number, so the two constants check each other.
    expect(PLAN_OF_RECORD_CARD_MIN).toBe(486);
    expect(PLAN_OF_RECORD_CARD_MIN - POR_CARD_WIDTH_AT_REFERENCE).toBe(1);
  });

  it('★★★ TEAM IS THE WIDEST CARD NOW, and that is the ruling', () => {
    const [por, proj, team] = resolveOverviewWidths(overviewRowWidthAt(1920)).map((n) =>
      Math.round(n),
    );
    expect([por, proj, team]).toEqual([486, 382, 497]);
    // ★★★ D-2026-09-09: the RANK is retired. fix-417's *"the Design plan of
    //     record is the widest of the boxes"* was shorthand for Team being
    //     crushed to ~100px, and fix-508 settles that grievance directly.
    expect(team).toBeGreaterThan(por);
    // ★ …and Bobby's 20% is what produced it: 478 × 0.8 = 382.
    expect(Math.round(478 * 0.8)).toBe(proj);
  });

  it('★★★ the FLOOR replaces the rank, because a share with no floor is a suggestion', () => {
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    expect(por.minPx).toBe(PLAN_OF_RECORD_CARD_MIN);
    // ★ It no longer depends on its NEIGHBOUR's floor, which is the structural
    //   half of the change: fix-506/507 pinned it 14px above Project's, so
    //   shrinking the units matrix would have narrowed the Plan of Record for
    //   a reason nobody could read off the screen.
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(por.minPx - proj.minPx).not.toBe(14);
    // ★ And at 1600 it is what actually binds.
    expect(Math.round(resolveOverviewWidths(overviewRowWidthAt(1600))[0])).toBe(486);
  });

  it('★★ the row minimum rises, and the wrap point with it', () => {
    // 486 + 330 + 160 + 20. ★ Team's floor is 160 again — §F1's pill floor
    //   (96 + 22 of chrome) no longer beats fix-423's 160.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(996);
    expect(overviewMinViewport('expanded')).toBe(1531);
    expect(overviewMinViewport('collapsed')).toBe(1375);
    // ★★ SO 1440 WRAPS AGAIN. fix-507 won it by a single pixel; the Plan of
    //    Record's floor spends it and 115 more. Stated, not buried: 1600 and
    //    1920 are the widths Bobby works at and both run on one line.
    expect(overviewRowWidthAt(1440)).toBeLessThan(OVERVIEW_ROW_MIN_WIDTH);
    expect(overviewRowWidthAt(1600)).toBeGreaterThan(OVERVIEW_ROW_MIN_WIDTH);
  });
});

describe('fix-508 §B — and the pair fits at BOTH viewports, with margin', () => {
  it.each([
    [1920, 60],
    [1600, 8],
  ])('★★★ at %i the pair has %i px to spare', (vw, margin) => {
    const body = Math.round(resolveOverviewWidths(overviewRowWidthAt(vw))[1]) - PROJECT_CARD_BORDER;
    expect(body - SITE_DATES_SIDE_BY_SIDE_MIN).toBe(margin);
    // ★★★ STOP (b): *"If the pair does not now fit side by side at 1600 with
    //     real margin (≥ 8px), stop."* It does, at both.
    expect(body - SITE_DATES_SIDE_BY_SIDE_MIN).toBeGreaterThanOrEqual(
      SITE_DATES_SIDE_BY_SIDE_MARGIN,
    );
  });
});

describe('fix-508 §F — the consultant pill, and the chat cell', () => {
  it('★★★ the pill floor is what CANNOT reflow — the two dates', () => {
    // ★★★ 140 → 96. fix-506's sum had a `status + gap + firm` term because
    //     those two shared a line; §F1 gives the firm the pill's full width, so
    //     the term is gone and only line 3 is incompressible.
    expect(CONSULTANT_PILL_COMPACT_MIN).toBe(96);
    // ★★ THE ALTERNATIVE WAS MEASURED AND REFUSED, so the trade is visible
    //    rather than re-litigated: flooring at line 1 (the widest in-use
    //    discipline, un-truncated, plus the status button) is 171, which would
    //    put three pills at 513 against the 475 the Team card gets even after
    //    this ticket's re-share — the band would wrap at every width and the
    //    reshape would cost the height it exists to save.
    expect(CONSULTANT_PILL_UNTRUNCATED_MIN).toBe(171);
    expect(CONSULTANT_PILL_UNTRUNCATED_MIN * 3).toBeGreaterThan(497 - 22);
    expect(CONSULTANT_PILL_COMPACT_MIN * 3).toBeLessThan(497 - 22);
  });

  it('★★★ the chat cell floor is its BUTTON, because §F4 put one in it', () => {
    // ★ fix-507 §C set 150 as a judgement about a PREVIEW. §F4 moves the
    //   `Chat · N →` control into the cell, and it is `whitespace-nowrap` in an
    //   `overflow-hidden` card — it clips rather than reflowing. Measured at
    //   its widest face, `Chat · 128`.
    expect(CHAT_BUTTON_MIN).toBe(83);
    expect(TEAM_GRID_CHAT_MIN).toBe(103);
    expect(TEAM_GRID_CARD_MIN).toBe(TEAM_GRID_COLUMN_1_MIN + TEAM_GRID_CHAT_MIN);
    expect(TEAM_GRID_CARD_MIN).toBe(213);
  });

  it('★★★ …and THAT is what keeps the three columns at 1600', () => {
    // ★★★ The residual Bobby asked me to report, and where it went. With the
    //     Plan of Record on its 486 floor, Team gets **231** at 1600. Against
    //     fix-507's unmeasured 150 the threshold was 260 and the grid would
    //     have collapsed — handing back the 276px §C won there — on the
    //     strength of a number nobody had checked.
    // ★ 229 by the module's own `fr` algorithm, 231 as Chrome lays it out —
    //   sub-pixel distribution across three frozen-then-shared tracks. Both
    //   clear the threshold, and the assertion is on the PROPERTY rather than
    //   on either rounding.
    const team = Math.round(resolveOverviewWidths(overviewRowWidthAt(1600))[2]);
    expect(team).toBe(229);
    expect(team).toBeGreaterThanOrEqual(TEAM_GRID_CARD_MIN);
    expect(team - TEAM_GRID_CARD_MIN).toBe(16);
  });
});

describe('fix-508 §E — the permits rail groups by phase', () => {
  it('★★★ the words are the Pipeline’s, in one place', () => {
    // ★ They were a private map inside `Dashboard/AddrGroup.tsx` (fix-364,
    //   *"one concept, one term"*). fix-104 created `lib/stageLabel` because
    //   the stage map was about to be copied into the sidebar for a third
    //   time; §E moves them rather than copying them a fourth.
    expect(STAGE_FULL_LABEL).toEqual({
      de: 'Design & Engineering',
      pm: 'Permitting',
      co: 'Corrections',
      ap: 'Approved',
      is: 'Issued',
    });
  });

  it('★★★ fix-421’s band order survives INSIDE the phase order', () => {
    // *"issued should be at the bottom, redesign should be above that, and then
    //  all the other active and ongoing permits should be above that."*
    expect(STAGE_ORDER).toEqual(['de', 'pm', 'co', 'ap', 'is']);
    expect(STAGE_ORDER[STAGE_ORDER.length - 1]).toBe('is');
  });
});

describe('fix-508 — the shares still sum to 100 and every floor states its reason', () => {
  it('★★ the table, as this ticket leaves it', () => {
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.pct)).toEqual([35.5, 28, 36.5]);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.minPx)).toEqual([486, 330, 160]);
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.floorReason.length, c.key).toBeGreaterThan(40);
      expect(c.floorReason, c.key).toMatch(/HARD|SOFT/);
    }
    // ★ …and the floors plus the gaps ARE the row minimum, derived not typed.
    expect(
      OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0) + 2 * OVERVIEW_GRID_GAP,
    ).toBe(OVERVIEW_ROW_MIN_WIDTH);
  });
});
