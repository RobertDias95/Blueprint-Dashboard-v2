import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, UnitType } from '../lib/database.types';
import {
  FIX_412_ROW_WIDTH,
  FIX_418_DATA_FIELDS,
  FIX_422_MATRIX_COLUMNS,
  FIX_422_MATRIX_GAP,
  FIX_422_MATRIX_ROW_GAP,
  FIX_422_MATRIX_ROW_HEIGHT,
  FIX_422_MATRIX_WIDTH,
  UNIT_CONFIG_FIELDS,
  fix418BandHeight,
  fix422BandHeight,
  unitFieldHint,
  unitFieldLabel,
} from '../lib/unitConfigFields';
import editorsSource from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
import {
  OVERVIEW_CARD_CHROME,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_ROW_MIN_WIDTH,
  SHELL_CHROME_PX,
  overviewMinViewport,
  overviewRowFitsAt,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import { parkingLabel, roofDeckLabel, storiesLabel } from '../lib/unitVocabulary';

// ===========================================================================
// fix-422 — the unit matrix, and the five cards re-shared around it
// ===========================================================================
//
// Bobby, 2026-08-27:
//
//   *"When you have more than two different unit dimensions, the page gets way
//    too vertically long, and it stretches out milestones, team, design plan of
//    record, builder/owner… go back to horizontal."*
//   *"For type, the box is way too wide — we only need it as wide as duplex or
//    cottage."* · *"Parking can be like P … Roof deck could be RD, and it just
//    needs to show a Y."* · *"I don't think we need the X between width and
//    depth."* · *"If someone hovered their cursor over QTY, or STY, or P, or S,
//    there'd be a summary of what that is."* · *"Maybe the stack goes proposal,
//    site, then unit dimensions at the bottom of that category."*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER, AND IT CONTRADICTS THE BRIEF ON EVERY NUMBER
// ---------------------------------------------------------------------------
//
// The brief asked to be corrected and it needs to be, twice:
//
//   · it estimated the PROJECT card at 244 / 296 / 423px expanded at
//     1280 / 1440 / 1920. The real figures are 220 / 220 / 319 — because
//   · fix-417's `overviewRowWidthAt` was **278px optimistic**. It modelled the
//     chrome as ribbon + shell padding + header padding and never counted the
//     240px permits rail, its 12px gap, the pillbox border or ProjectDetail's
//     own `px-3`. The row gets 710px at 1280, not 988.
//
// ★★★ SO THE PREMISE OF SCOPE 9 IS FALSE. "PROJECT is over-wide at every
// viewport — 423px at 1920" was arithmetic on the wrong row width. At 319px
// with a 274px matrix inside it, PROJECT is very nearly exactly right, and
// there is no spare width in the row to hand to Team or Builder/Owner. What was
// actually wrong is the FLOORS, and one of their stated reasons was already
// false on main — see §D.

// ---------------------------------------------------------------------------
// §A · THE MATRIX, DECLARED ONCE
// ---------------------------------------------------------------------------

// ===========================================================================
// ★★★ fix-572 §C (P-277) — §A IS RETIRED: THE MATRIX IT DECLARED IS GONE
// ===========================================================================
//
// Bobby, 2026-09-15: *"unit configuration… in one swoop, you can cleanly and
// quickly organize"* — and, on the Type cell, that he could not read it.
//
// ★★★ §A'S LAST ASSERTION WAS THE ONE THAT BROKE IT. *"Type is sized for
//     `Cottages`… expect(type.width).toBe(52)"*, with the rest of the suite
//     proving an off-registry label truncates cleanly at that width (§8).
//     **Measured in Chrome on 2026-09-15: at 52px the modal's Type dropdown
//     renders `D…` for `Detached`** — every registry value truncates, not only
//     the off-registry ones, because a `<select>` spends part of its box on a
//     chevron that a `<span>` does not. §8 measured the truncation of a SPAN.
//
// ★★ SO THE RETIREMENT IS NOT A CHANGE OF TASTE. Rationing ran to its end: a
//    52px Type, a 22px Qty and a 26px Roof Deck are what 266px of matrix buys,
//    and the last of that width was spent making `3+B` fit (fix-562 §A). §C
//    stops rationing instead of re-cutting the ration.
//
// ★★★ AND EVERY NUMBER §A DECLARED IS KEPT, in `lib/unitConfigFields` under
//     names that say they are history — 266, its 4px gap, its 8 columns, and
//     fix-412's 620. fix-422 kept fix-412's 620 for exactly this reason and
//     said so: *"deleting them would delete the evidence for a fix that is
//     still load-bearing."* fix-417's floor arithmetic still cites them.
describe('fix-422 §A (retired by fix-572 §C): what the matrix measured, kept', () => {
  it('★★★ the 266px and its parts survive as evidence, as literals', () => {
    // ★★ fix-562's OWN LESSON, WHICH IS WHY THESE ARE LITERALS: a historical
    //    measurement derived from a live list is not a measurement. When
    //    `fix418BandHeight` counted today's columns, removing one silently
    //    rewrote fix-418's shipped past by 20px per block.
    expect(FIX_422_MATRIX_WIDTH).toBe(266);
    expect(FIX_422_MATRIX_GAP).toBe(4);
    expect(FIX_422_MATRIX_COLUMNS).toBe(8);
    // ★ The comparison §A existed to make: horizontal was legal because it was
    //   less than half of fix-412's spelled-out row.
    expect(FIX_422_MATRIX_WIDTH).toBeLessThan(FIX_412_ROW_WIDTH / 2);
  });

  it('★★★ the abbreviations that 266px paid for are gone from the form', () => {
    // ★★★ THE RULING §A ENFORCED — *"sized to what they hold"* — IS WHAT §C
    //     delivers, by removing the size constraint rather than tuning it.
    //     `Type · W · D · Qty · Sty · P · RD` was the most a 266px row could
    //     say; every one of those is a whole word now.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.label)).toEqual([
      'Type',
      'Quantity',
      'Width',
      'Depth',
      'Unit Size',
      'Stories',
      'Parking',
      'Roof Deck',
    ]);
    // ★ fix-562 §A's removal is still enforced: `#` never comes back.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.key)).not.toContain('parking_stalls');
  });

  it('★★ SCOPE 3 SURVIVES WHERE IT WAS MADE: still no `×` between W and D', () => {
    // Bobby: *"I don't think we need the X between width and depth."* §A
    // expressed it as a tighter 2px gap, which was how a grid groups a pair.
    // The fields are separate labelled boxes now, so the grammar comes from the
    // labels — but the `×` must not come back, and that is still assertable.
    // ⚠️ Scoped to the unit block ON PURPOSE. `editorsSource` also holds the
    //    SITE card's lot row, whose `20 × 30` separator fix-422 never ruled on
    //    and this ticket does not touch — an unscoped grep would assert a rule
    //    Bobby made about one row against a different one.
    const blockJsx = editorsSource.slice(
      editorsSource.indexOf('function UnitConfigBlock('),
      editorsSource.indexOf('function AddUnitTypeButton('),
    );
    expect(blockJsx.length).toBeGreaterThan(500);
    expect(blockJsx).not.toContain('×</span>');
    expect(UNIT_CONFIG_FIELDS.map((c) => c.label)).not.toContain('×');
  });
});

// ---------------------------------------------------------------------------
// §B · HEIGHT — the thing the ticket is actually about
// ---------------------------------------------------------------------------

// ★★★ fix-572 §C — §B IS THE ONE SECTION THAT DOES **NOT** RETIRE, and a
//     reader will assume the opposite, because §C's blocks look like the
//     fix-418 stack §B was built to escape.
//
// ★★★ THE DIFFERENCE IS THE SURFACE, NOT THE SHAPE. §B's whole argument is
//     that the OVERVIEW card's five cards are `alignItems: stretch`
//     (fix-309 #55), so every pixel the units band spends is charged to
//     Milestones, Team, Plan of Record and Builder/Owner, which is why the
//     MARGINAL cost per type is the number that matters. §C's blocks are in a
//     MODAL that shares its height with nothing and scrolls; the Overview card
//     still renders fix-507/508's transposed matrix, untouched by this ticket.
//
// ★★ SO THESE NUMBERS STAY LIVE ASSERTIONS about the Overview, computed from
//    literals in `lib/unitConfigFields` rather than from a list that can move.
describe('fix-422 §B: the vertical cost per unit type', () => {
  it('★★★ SIX types now cost LESS than ONE type did under fix-418', () => {
    // ★★★ THE ACCEPTANCE CRITERION, AS ARITHMETIC. The brief asks that a
    //     six-type project's card row not exceed the other four cards' natural
    //     heights — which jsdom cannot measure, because it has no layout
    //     engine. This is the honest form of the same claim, computed from the
    //     declared model both layouts render(ed) from.
    expect(fix422BandHeight(6)).toBe(130);
    // ★★★ fix-562 §A: 186 is fix-418's SHIPPED block and it must not move when
    //     today's column list does. `fix418BandHeight` used to derive its field
    //     count from `UNIT_ROW_COLUMNS`, so removing the `#` column rewrote
    //     history to 166 — a counterfactual has to be pinned to what it
    //     counterfactualises. `FIX_418_DATA_FIELDS` is that pin.
    expect(FIX_418_DATA_FIELDS).toBe(8);
    expect(fix418BandHeight(1)).toBe(186);
    expect(fix422BandHeight(6)).toBeLessThan(fix418BandHeight(1));
    // ★★ And the number Bobby saw: the one six-type project in prod.
    expect(fix418BandHeight(6)).toBe(1146);
    expect(fix418BandHeight(6) - fix422BandHeight(6)).toBeGreaterThan(1000);
  });

  it('★★★ …and the cost per EXTRA type is one row, not one stack', () => {
    // ★ The five cards are `alignItems: stretch`, so this per-type figure is
    //   charged to Milestones, Team, Plan of Record and Builder/Owner too. That
    //   is why the marginal cost is the number that matters, not the total.
    const marginal = fix422BandHeight(3) - fix422BandHeight(2);
    expect(marginal).toBe(FIX_422_MATRIX_ROW_HEIGHT + FIX_422_MATRIX_ROW_GAP);
    expect(marginal).toBe(20);
    expect(fix418BandHeight(3) - fix418BandHeight(2)).toBeGreaterThan(
      marginal * 9,
    );
  });
});

// ---------------------------------------------------------------------------
// §C · THE CODES AND THE VOCABULARY
// ---------------------------------------------------------------------------

describe('fix-422 §C: a cell that does not conflate two answers', () => {
  // =========================================================================
  // ★★★ fix-562 §A SUPERSEDES THE LETTER CODES — AND NOT THE RULING BEHIND THEM
  // =========================================================================
  //
  // fix-422 painted `G` / `S` / `B` / `N` because the matrix cell was 26px,
  // and spent its §C arguing the one thing that mattered: **`none` is `N` and
  // only NULL is `—`**, because a recorded answer and the absence of one are
  // different facts (fix-402, fix-386).
  //
  // ★★★ BOBBY REPLACED THE VOCABULARY, NOT THE RULE. 2026-09-14: parking is
  //     *"one-car, two-car, three, four, or surface/none"* — `both` is gone by
  //     design, the count is inside the answer, and `surface` and `none` are
  //     ONE option because for a floor plan nothing is taken out of the
  //     building either way. So there is no `N`-vs-`—` pair left to defend:
  //     the recorded answer is `Surface / None` and only NULL is `—`.
  //
  // ★★ SUPERSEDED, NOT MISTAKEN (fix-400's rule). fix-422 read its evidence
  //    correctly — prod then held 4 NULLs against 1 recorded `none` — and the
  //    distinction it protected is asserted below in the new words rather than
  //    deleted with the old ones.

  it('★★★ a RECORDED answer and NOT RECORDED still render differently', () => {
    expect(parkingLabel(null, null)).toBe('—');
    expect(parkingLabel(undefined, undefined)).toBe('—');
    expect(parkingLabel('surface_none', null)).toBe('Surface / None');
    expect(parkingLabel('surface_none', null)).not.toBe(parkingLabel(null, null));
  });

  it('★★★ the count is INSIDE the answer, which is the whole ticket', () => {
    expect(parkingLabel('garage', 1)).toBe('1-car garage');
    expect(parkingLabel('garage', 2)).toBe('2-car garage');
    expect(parkingLabel('garage', 4)).toBe('4-car garage');
    // ★ A garage with no count has no label, so the pair is refused rather
    //   than half-rendered — see lib/unitVocabulary and parseUnitTypes.
    expect(parkingLabel('garage', null)).toBe('—');
  });

  it("★★ …and P's tooltip carries the new legend, including that distinction", () => {
    // ★ fix-572 §C: `unitFieldTooltip` is `unitFieldHint` — the summary now
    //   rides as the control's accessible name beside a VISIBLE word label,
    //   rather than being the only place the meaning existed.
    const t = unitFieldHint('parking_kind');
    expect(t).toContain('1-car garage');
    expect(t).toContain('Surface / None');
    // ★★ fix-572 §C SHORTENS THE LEGEND, and says so rather than weakening
    //    the assertion silently. The dash was a CELL GLYPH in a 26px matrix
    //    column; the form renders `Not recorded` as a named option in the
    //    dropdown itself, which is where fix-402's rule (a recorded `none`
    //    is not the absence of an answer) is now visible without a hover.
    expect(parkingLabel(null, null)).toBe('—');
    // ★★ fix-402's four kinds are nowhere in the legend any more.
    expect(t).not.toContain('B both');
  });

  it('★★★ roof deck is three answers plus the dash, with nothing conflated', () => {
    expect(roofDeckLabel(true, true)).toBe('W/ PH');
    expect(roofDeckLabel(true, false)).toBe('W/O PH');
    expect(roofDeckLabel(false, null)).toBe('None');
    expect(roofDeckLabel(null, null)).toBe('—');
    // ★ A recorded `None` is not the dash — the fix-422 ruling, in fix-562's
    //   vocabulary.
    expect(roofDeckLabel(false, null)).not.toBe(roofDeckLabel(null, null));
  });

  it('★★★ fix-562 §A: stories carries its basement, and `—` still means nobody said', () => {
    expect(storiesLabel(3, true)).toBe('3+B');
    expect(storiesLabel(3, false)).toBe('3');
    // ★★ A MODIFIER, not an independent field: no vocabulary entry means
    //    "3 storeys, basement unknown", so a missing flag beside a recorded
    //    count reads as no basement rather than as `—`.
    expect(storiesLabel(3, null)).toBe('3');
    expect(storiesLabel(null, null)).toBe('—');
  });

  it('★★★ `STALLS` IS NOWHERE — not a column, a header, a width or a tooltip', () => {
    // ★★★ fix-562 §A removed the field from the product. fix-422's `#` column
    //     was MINE rather than Bobby's ("Stalls could just be like S" would
    //     have put two different S-es 46px apart), and it leaves with the
    //     field it labelled.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.key)).not.toContain('parking_stalls');
    expect(UNIT_CONFIG_FIELDS.map((c) => c.label)).not.toContain('#');
    // ★ fix-572 §C: the thrower is `unitFieldHint`, and it still throws — a
    //   silent `undefined` renders as an unlabelled box, which is the exact
    //   defect this ticket is fixing.
    expect(() => unitFieldHint('parking_stalls' as never)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §D · THE RE-SHARE
// ---------------------------------------------------------------------------

describe('fix-422 §D: the five cards, re-shared against the real row', () => {
  it('★★★ the PROJECT floor was justified by a scroller that no longer exists', () => {
    // ★★★ STEP 0(d), CONFIRMED. fix-417 justified 220px with "its widest
    //     content — the Units row — SCROLLS inside the card now (fix-417 §B)".
    //     fix-418 deleted that scroller, so the justification has been false on
    //     main since ef9b0eb and the card has been free to clip its own
    //     contents — `OverviewCard` is `overflow-hidden`.
    // ★★★ THE FINDING SURVIVES; THE SENTENCE MOVED. fix-422's point was that a
    //     floor justified by a scroller fix-418 had deleted was a floor nobody
    //     could check — so the floor became a DERIVATION and the reason had to
    //     say so. fix-506 §D transposed the matrix and re-derived against it;
    //     what this asserts is the property, not the prose of one ticket.
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(proj.floorReason).toContain('DERIVED');
    expect(proj.floorReason).toMatch(/matrix/i);
    // ★★★ AND THE FLOOR IS STILL A DERIVATION, so the two cannot disagree.
    // ★★★ AND fix-508 §B/§C HAND THE FLOOR OVER, without touching the rule.
    //     §C shrinks the matrix to 267 (289 of card); §B's Site/Dates pair —
    //     which can no longer wrap at 1600, by ruling — binds at 330. fix-422's
    //     claim is that the floor is DERIVED from what the card must hold and
    //     is never typed beside it, and that is what this asserts.
    expect(proj.minPx).toBe(PROJECT_CARD_MIN_WIDTH);
    expect(proj.minPx).toBeGreaterThanOrEqual(
      UNIT_MATRIX_TRANSPOSED_WIDTH + OVERVIEW_CARD_CHROME,
    );
  });

  it('★★★ every floor states whether it is HARD or SOFT, and why', () => {
    // ★ Which cards CLIP below their floor and which merely reflow is what
    //   decides who gives way when the row is short. Saying so is the point.
    const byKey = Object.fromEntries(
      OVERVIEW_CARD_COLUMNS.map((c) => [c.key, c.floorReason]),
    );
    // ★★★ AMENDED TWICE — fix-475 swapped `builder` for `consultants`, and
    //     fix-506 §A cut the row to three. The CLAIM is unchanged and it is
    //     what makes the table useful: every floor says whether its card CLIPS
    //     below the number or merely reflows, because that is what decides who
    //     gives way when the row is short. Asserted of every column that is
    //     actually there, rather than of a list somebody has to keep in step.
    expect(byKey.proj).toContain('HARD');
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.floorReason, c.key).toMatch(/HARD|SOFT/);
      expect(c.floorReason.length, c.key).toBeGreaterThan(40);
    }
  });

  it('★★★ Plan of Record is STILL the widest card, at every width', () => {
    // Bobby's fix-417 ruling, unrevoked. Scope 10(ii) offered this floor as the
    // place to find room; taking it puts Project ahead of it EVERYWHERE, so it
    // was measured and refused.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    // ★★★ SUPERSEDED by fix-508 (D-2026-09-09): the RANK is retired and the
    //     FLOOR replaces it. fix-422's refusal to take width from this card is
    //     kept because its arithmetic was right; what changed is that Team is
    //     now allowed PAST it on share, which is the thing Bobby's original
    //     complaint was about. The floor half still holds at every width where
    //     floors decide.
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') {
        expect(por.minPx).toBeGreaterThan(c.minPx);
      }
    }
    // ★ fix-506 §A put the Plan of Record FIRST, so the index is looked up.
    const porIdx = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'por');
    const teamIdx = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'team');
    for (const vw of [1280, 1440, 1600, 1920, 2560]) {
      for (const r of ['expanded', 'collapsed'] as const) {
        const row = overviewRowWidthAt(vw, r);
        const w = resolveOverviewWidths(row);
        // Where the FLOORS decide, the Plan of Record is still the widest.
        if (row < OVERVIEW_ROW_MIN_WIDTH) expect(w[porIdx]).toBe(Math.max(...w));
      }
    }
    // ★★ Where the SHARES decide, Team is — the ruling, pinned so a later edit
    //    that quietly restores the rank fails here rather than on a screenshot.
    const wide = resolveOverviewWidths(overviewRowWidthAt(1920));
    expect(wide[teamIdx]).toBeGreaterThan(wide[porIdx]);
  });

  it('★★★ SUPERSEDED: the row stopped needing a lever, because it lost two cards', () => {
    // ★★★ fix-422's HONEST HALF, and it is the half worth keeping: it recorded
    //     that Team and Builder could only gain SHARE, not WIDTH, because at
    //     1920 the row's free space was 214px against 1,136px of floors — so
    //     the floors dominated and there was nothing to redistribute. Scope 9
    //     had expected to reclaim ~100px from an over-wide PROJECT card that
    //     did not exist.
    //
    // ★★★ fix-506 §A DID NOT FIND A LEVER EITHER. It removed two cards, and
    //     that is a different kind of answer: the floors total 904 instead of
    //     1,136, so at 1920 the free space is 426px and every card is above its
    //     floor with room to spare. The constraint fix-422 measured was real
    //     and it is simply no longer binding.
    const team = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!;
    expect(OVERVIEW_CARD_COLUMNS.some((c) => c.key === 'consultants')).toBe(false);
    expect(team.pct).toBeGreaterThan(15);

    // ★ fix-508: 389px of free space at 1920 rather than 481 — the Plan of
    //   Record's floor took 118 of it. Still an unwrapped row with room, which
    //   is the claim; the threshold moves with the floors it is measuring.
    const free = overviewRowWidthAt(1920, 'expanded') - OVERVIEW_ROW_MIN_WIDTH;
    expect(free).toBeGreaterThan(380);
    // ★★ …and every card is at or above its floor at 1920, which was the thing
    //    fix-422 could not say. ★ fix-508: the Plan of Record sits exactly ON
    //    its floor there, because that floor IS the width its picture uses —
    //    35.5% of 1,365 is 485 and the floor is 486, so the track freezes. That
    //    is the floor doing its job, not a card being squeezed.
    const w = resolveOverviewWidths(overviewRowWidthAt(1920, 'expanded'));
    OVERVIEW_CARD_COLUMNS.forEach((c, i) => {
      expect(w[i], c.key).toBeGreaterThanOrEqual(c.minPx);
    });
  });

  it('★★★ SCOPE 10: which remedy was used, recorded as arithmetic', () => {
    // (i)  TIGHTEN — applied and spent. 274px is abbreviations, letter codes,
    //      no separator and `work_scope` off the grid. The eight data columns
    //      alone are 228px; there is no meaningful slack left.
    // ★ fix-572 §C: the column list is retired, so the total it summed to is a
    //   literal here — a historical measurement must not be a function of a
    //   live list (fix-562 §A's lesson, and why 266 is a literal too).
    const dataOnly = 224;
    // ★ fix-562 §A: 228 → 224. Seven data columns instead of eight, two of them
    //   widened for their new dropdowns — see §A's 274 → 266 note.
    expect(dataOnly).toBe(224);
    expect(FIX_422_MATRIX_WIDTH - dataOnly).toBeLessThan(50);

    // (ii) TAKE IT FROM PLAN OF RECORD — REFUSED, and here is why in numbers.
    //      Its floor must EXCEED Project's or Bobby's "widest box" ruling fails
    //      at every width the floors bind, which below 1788px is all of them
    //      (fix-422 wrote 1706; fix-423's honest Milestones floor moved it).
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(por.minPx).toBeGreaterThan(proj.minPx);
    // ★★★ SUPERSEDED by fix-508: the 14px pin is GONE. It made the Plan of
    //     Record's floor a function of its neighbour's, so shrinking the units
    //     matrix would have narrowed a card that has nothing to do with it.
    //     The floor is the width the card's own capped thumbnail uses now, and
    //     the gap over Project is a consequence rather than a declaration —
    //     which is why this asserts the ORDER and not the margin.
    expect(por.minPx - proj.minPx).toBeGreaterThan(14);

    // (iii) …so the condition for the fallback IS met, and it is stated rather
    //       than quietly absorbed: below a 1706px window (ribbon expanded) the
    //       five-card row cannot hold the matrix at its floors. Building the
    //       full-width band is Bobby's call, not this ticket's.
    // ★★★ fix-423 ANSWERED THIS. The condition is still met — and by MORE
    //     than fix-422 recorded, since measuring Milestones honestly added 82px
    //     to the floors — but the fallback that shipped is not the full-width
    //     units band. It is the row WRAPPING to two lines below the threshold,
    //     which removes the sideways scroll without taking width from any card.
    //     Bobby has still not ruled on the band; nothing here pre-empts it.
    // ★★★ fix-475 MOVED THIS NUMBER DOWN, 1788 → 1742, and the direction is
    //     the point: `builder`'s 190px floor left the row and `consultants`
    //     brought a measured 144, so the whole row needs 46px LESS than it did.
    //     Every claim above survives — the condition for the fallback is still
    //     met, by 142px at a 1600 window — and the band is still Bobby's call.
    // ★★★ fix-506 §A ANSWERED (iii) BY REMOVING THE ROW'S THIRD AND FIFTH
    //     CARDS. The condition fix-422 recorded — *"below a 1706px window the
    //     five-card row cannot hold the matrix at its floors"* — is no longer
    //     met at all: the threshold is a 1474px window, so 1600 FITS. The
    //     full-width units band Bobby never ruled on is not needed, and this is
    //     the first ticket in the sequence that can say so.
    // ★★★ fix-507 §A MOVED IT AGAIN, 1474 → 1439, and by a route this ticket
    //     had not used before: not floors and not cards, but the CHROME. The
    //     permits rail went 240 → 190 (Bobby, 2026-09-09) and STEP 0 found a
    //     15px pillbox scrollbar this module had never counted — the EIGHTH box
    //     against fix-422's seven. Net 35px of extra row at every viewport, and
    //     1440-expanded now fits by a single pixel.
    // ★★★ AND fix-508 MOVES IT BACK UP, 1439 → 1531, by a FLOOR rather than by
    //     chrome: the Plan of Record's rises to the width its capped thumbnail
    //     uses (368 → 486), replacing fix-417's retired rank. 1440 wraps again;
    //     1600 and 1920 — the widths Bobby works at — still fit, which is the
    //     claim fix-422 wanted and the one that has to survive.
    // ★★★ AND fix-517 §A MOVES IT DOWN AGAIN, 1531 → 1329, by deleting a box
    //     rather than by re-sharing: the permits rail and its 12px gap. 1440
    //     fits once more, with 111px to spare instead of fix-507's one pixel.
    expect(overviewMinViewport('expanded')).toBe(1329);
    expect(overviewRowFitsAt(1440, 'expanded')).toBe(true);
    expect(overviewRowFitsAt(1600, 'expanded')).toBe(true);
    expect(overviewRowFitsAt(1920, 'expanded')).toBe(true);
  });

  it('★★★ the row has NEVER fitted at 1280 — this predates fix-422', () => {
    // ★★★ THE PRE-EXISTING DEFECT, held against fix-417's own floors so it
    //     cannot be read as something this ticket caused. 970px of floors
    //     against 710px of row: short by 260px on main today.
    // ★ fix-507 §A: 710 → 745 at 1280 (rail −50, scrollbar +15). The claim is
    //   unchanged and still true by a wide margin — fix-417's own floors needed
    //   970 — which is the point of holding it against a derived width rather
    //   than a remembered one.
    // ★ fix-517 §A: 745 → 947 at 1280, the rail and its gap having gone. The
    //   claim is unchanged and still true — fix-417's own floors needed 970 —
    //   which is the point of holding it against a DERIVED width rather than a
    //   remembered one. Three tickets have now moved this number and the
    //   assertion has never had to be rewritten to stay meaningful.
    expect(overviewRowWidthAt(1280, 'expanded')).toBe(947);
    expect(970).toBeGreaterThan(overviewRowWidthAt(1280, 'expanded'));
    // The boxes fix-417 never counted, together, are the whole gap. ★ fix-507
    // added the pillbox SCROLLBAR to that list — the one a rect does not show
    // you, because it lives between the border box and the content box — and
    // subtracted 50 from the rail, so 278 became 243. ★ fix-517 deletes the
    // rail and its gap outright, so 243 becomes 41.
    const missed =
      SHELL_CHROME_PX.pillboxBorder +
      SHELL_CHROME_PX.pillboxScrollbar +
      SHELL_CHROME_PX.pageRowPadding;
    expect(missed).toBe(41);
    expect(243 - missed).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// RENDERED
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const saves: { unit_types: UnitType[] }[] = [];

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync: vi.fn(async (v: { patch: Record<string, unknown> }) => {
      if (v?.patch && 'unit_types' in v.patch) {
        saves.push({ unit_types: v.patch.unit_types as UnitType[] });
      }
      return undefined;
    }),
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
// ★★★ fix-549 §B (P-255) — THIS SUITE IS ABOUT A PERMITTED USER.
//
// Every Project Data editor now asks `bp_may_write_project` before it renders an
// input, and the hook **fails closed** — so under a mocked supabase it answers
// "no" and every field would render read-only. That is the correct production
// behaviour and the wrong fixture for a suite about what the editor DOES.
//
// ★ Mocked permissive here, the same way this file already mocks its other
//   hooks: the refusal path has its own suite (`CamEditsAnyProjectFix549`).
vi.mock('../hooks/useMayWriteProject', () => ({
  useMayWriteProject: () => true,
}));

vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));


import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
// ★ fix-514 §A: the file and the component are `ProjectDetailsModal` now —
//   Project Settings is deleted and this is the one project modal.
import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';
import {
  PROJECT_CARD_MIN_WIDTH,
  UNIT_MATRIX_TRANSPOSED_WIDTH,
} from '../lib/projectCardLayout';

// ★ fix-486 (P-143): the registry is five values now, not eight.
const PRODUCT_TYPES = ['Detached', 'Attached', 'ADU', 'DADU', 'Remodel'];

/**
 * ★ The six-ROW project that exists in prod — the case Bobby reported.
 *
 * ★★ SIX ROWS, NOT SIX DISTINCT TYPES, and that distinction only appeared with
 *    fix-486: the vocabulary is five values while the prod project that started
 *    all this has six unit rows. Every §1/§2/§9 assertion below is about how
 *    many ROWS the band lays out, so the sixth cycles back to the first label.
 *    A registry label (rather than free text) is what matters — an off-list one
 *    renders read-only and would change what is being measured.
 */
const SIX_TYPES = Array.from({ length: 6 }, (_, i) => ({
  label: PRODUCT_TYPES[i % PRODUCT_TYPES.length],
  width_ft: 20 + i,
  depth_ft: 30 + i,
  qty: 1,
}));

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-422',
    address: '2724 Walnut Ave SW',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 6,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    unit_types: [
      { label: 'Attached', width_ft: 24, depth_ft: 40, qty: 2 },
      { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1 },
    ],
    alley: null,
    product_types: PRODUCT_TYPES,
    project_tags: null,
    builder_name: 'Owner LLC',
    builder_company: 'Builder Company LLC',
    builder_email: 'contact@builder.com',
    builder_phone: '(206) 555-0100',
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

// ★★★ fix-506 §G (P-140): `UnitDimensions` is the Project Data modal's **Units**
//     tab. The component is byte-for-byte what shipped — the brief's rule is
//     that every write goes through the same hooks, so §2 through §8 below
//     assert exactly what they asserted before and can still catch a
//     regression in the editor. Only the mount point moved.
function header(project: Project): ReactElement {
  return (
    <ProjectDetailsModal
      project={project}
      permits={[] as PermitWithCycles[]}
      bp={null}
      initialTab="units"
      onClose={() => {}}
    />
  );
}

/** ★ The three-box overview row, for the assertions that are about the CARD
 *  rather than about the editor. */
function overview(project: Project): ReactElement {
  return (
    <ProjectDetailHeader
      project={project}
      permits={[] as PermitWithCycles[]}
      bp={null}
    />
  );
}

function renderHeader(over: Partial<Project> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(header(makeProject(over)), { wrapper });
}

/** ★ Same providers, the overview instead of the modal. */
function renderOverview(over: Partial<Project> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(overview(makeProject(over)), { wrapper });
}

beforeEach(() => {
  saves.length = 0;
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ---------------------------------------------------------------------------
// §1 · BAND ORDER
// ---------------------------------------------------------------------------

describe('fix-422 §1 → fix-506 §B/§C/§D: the card\'s bands, re-cut', () => {
  // ★★★ BOBBY RE-CUT THIS CARD ON 2026-09-08, AND THE RULE fix-422 ESTABLISHED
  //     SURVIVED THE RE-CUT — which is the only reason these are inverted here
  //     rather than deleted.
  //
  //     fix-422's ruling: *"the stack goes proposal, site, then unit dimensions
  //     at the bottom of that category"*, and UNITS LAST **on purpose**, because
  //     it is the only band whose height varies with the data — at the foot it
  //     grows against the card's bottom edge, where the spare height already is.
  //
  // ★★★ v14 KEEPS UNITS LAST AND CHANGES WHAT IS ABOVE IT. Proposal is gone
  //     (its Units count is DERIVED from the unit rows now, and its type chips
  //     and redesign list moved to Project Data); Site data sits beside a new
  //     Dates card, as a wrapping pair. So the card reads: [Site | Dates] then
  //     the matrix — and the height argument is untouched.

  it('★★★ Site data and Dates sit above the matrix, and the matrix is LAST', () => {
    renderOverview({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    const pair = screen.getByTestId('pd-site-dates-pair');
    const units = screen.getByTestId('pd-units-matrix');
    expect(card).toContainElement(pair);
    expect(card).toContainElement(units);
    // ★ Units follows the pair in DOM order — `DOCUMENT_POSITION_FOLLOWING`.
    expect(pair.compareDocumentPosition(units) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('★★★ SUPERSEDED: there is no Proposal band, because its content moved', () => {
    renderOverview();
    expect(screen.queryByTestId('pd-project-proposal')).toBeNull();
    // ★★ The Units COUNT survives and is stronger: derived from the rows the
    //    matrix prints, so it cannot be stale or missing (fix-88's "⚠ missing"
    //    badge has nothing left to report).
    expect(screen.getByTestId('pd-site-units-count')).toBeInTheDocument();
  });

  it('★★★ UNITS IS STILL LAST, and still for the height reason', () => {
    // ★ The matrix is the only band whose height varies with the data — six
    //   unit types is six columns and a fixed eight rows, but a project with
    //   none prints an empty note. At the foot it grows into the spare height.
    renderOverview({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(card.querySelectorAll(':scope > section'));
    const notPinned = sections.filter(
      (sec) => (sec as HTMLElement).dataset.pinBottom !== 'true',
    );
    expect(notPinned[notPinned.length - 1]).toBe(
      screen.getByTestId('pd-units-matrix'),
    );
  });
});

// ---------------------------------------------------------------------------
// §2 · ONE HEADER, N ROWS
// ---------------------------------------------------------------------------

// ===========================================================================
// ★★★ fix-572 §C — §2 IS RE-AIMED: ONE BLOCK PER TYPE, NO HEADER ROW
// ===========================================================================
//
// ★★★ THE COUNTING RULE SURVIVES AND IS WHAT MATTERED. "N types produce
//     exactly N rows" catches the thing a restack breaks — a project with six
//     types rendering five editors, or one editor holding six types' values.
//     It reads `pd-unit-block` now.
//
// ★★★ THE HEADER RULE IS SATISFIED STRUCTURALLY AND CANNOT BE ASSERTED THE
//     OLD WAY. §2 pinned the header strip and every row to one
//     `gridTemplateColumns` so a header could not sit over the wrong control.
//     There is no header strip: each label is inside the same `<label>` as its
//     control (UnitsRowFix412 §C asserts that directly). Keeping a template
//     assertion here would be asserting the geometry of a layout nobody renders.
//
// ★★ AND §2'S SHARPEST FINDING IS CARRIED OVER VERBATIM: *"MERE PRESENCE
//    PROVES NOTHING"* — fix-418's vertical stack also contained all eight
//    controls. The property that separates the layouts is PARENTAGE, so this
//    asserts each control's parentage in the new shape rather than its presence.
describe('fix-422 §2 (re-aimed by fix-572 §C): one block per unit type', () => {
  it('★★★ N types produce exactly N blocks, for every N in prod', () => {
    // prod: 1 type ×15 · 2 ×56 · 3 ×22 · 4 ×9 · 6 ×1.
    for (const n of [2, 3, 4, 6]) {
      const { unmount } = renderHeader({
        unit_types: SIX_TYPES.slice(0, n),
      } as unknown as Partial<Project>);
      expect(screen.getAllByTestId('pd-unit-block')).toHaveLength(n);
      unmount();
    }
  });

  it('★★★ there is NO header strip left to drift against', () => {
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    expect(screen.queryAllByTestId('pd-unit-header')).toHaveLength(0);
    expect(screen.queryAllByTestId('pd-unit-row')).toHaveLength(0);
    // ★ Every block carries every field, labelled in place — six types, six
    //   complete forms, no shared strip that could describe the wrong one.
    for (const b of screen.getAllByTestId('pd-unit-block')) {
      for (const f of UNIT_CONFIG_FIELDS) {
        expect(
          within(b).getByTestId(`pd-unit-f-${f.key}-label`).textContent,
          f.key,
        ).toBe(f.label);
      }
    }
  });

  it('★★★ every control sits INSIDE its own labelled field — parentage, not presence', () => {
    // ★★★ §2'S LESSON, RE-AIMED. The first version of §2's test passed against
    //     pre-fix code because presence proves nothing. What *"every box is
    //     readable"* means structurally is that each control is inside the
    //     element that carries its word — not merely somewhere in the block.
    renderHeader();
    const block = screen.getAllByTestId('pd-unit-block')[0];
    const pairs: [string, string][] = [
      ['label', 'pd-unit-label-select'],
      ['qty', 'pd-unit-qty'],
      ['width_ft', 'pd-unit-w'],
      ['depth_ft', 'pd-unit-d'],
      ['size_sf', 'pd-unit-size'],
      ['stories', 'pd-unit-stories'],
      ['parking_kind', 'pd-unit-parking-kind'],
      ['roof_deck', 'pd-unit-roof-deck'],
    ];
    for (const [key, testid] of pairs) {
      const field = within(block).getByTestId(`pd-unit-f-${key}`);
      expect(within(field).getByTestId(testid), testid).toBeInTheDocument();
      expect(within(field).getByTestId(`pd-unit-f-${key}-label`).textContent).toBe(
        unitFieldLabel(key as never),
      );
    }
    // ★ fix-520 §B (P-226) SURVIVES, AT BLOCK SCOPE. Bobby: *"How do I know
    //   which unit I am updating sqft on?"* The type select says `Detached` on
    //   every block of a two-Detached project, so the block's own title carries
    //   the ordinal — one name for the whole form rather than one per row.
    expect(block.getAttribute('data-unit-label')).toBeTruthy();
    // ★★ ...and the remove control is the BLOCK's, not a ninth field.
    const remove = within(block).getByTestId('pd-unit-remove');
    expect(remove.closest('[data-testid^="pd-unit-f-"]')).toBeNull();
  });

  it('★★★ + Add type and per-block remove still work', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-units-add'));
    expect(saves[0].unit_types).toHaveLength(3);
    saves.length = 0;
    const blocks = screen.getAllByTestId('pd-unit-block');
    fireEvent.click(within(blocks[0]).getByTestId('pd-unit-remove'));
    expect(saves[0].unit_types.map((u) => u.label)).toEqual(['Remodel']);
  });
});

// ---------------------------------------------------------------------------
// §3 · TOOLTIPS — hover AND focus
// ---------------------------------------------------------------------------

// ===========================================================================
// ★★★ fix-572 §C — §3 IS ANSWERED RATHER THAN RETIRED
// ===========================================================================
//
// §3 existed because of a specific cost: *"With eight abbreviations — `P`,
// `#`, `RD`, `Sty` — a mouse-only tooltip leaves the matrix unreadable"*. The
// remedy was a focusable header button carrying the plain-language sentence, so
// the meaning was one hover OR one Tab away.
//
// ★★★ §C REMOVES THE ABBREVIATIONS, WHICH REMOVES THE COST. Every field reads
//     its whole word, visible, with no hover and no Tab. That is strictly more
//     than §3 delivered — and the header BUTTON goes with the header strip.
//
// ★★ THE SENTENCES ARE KEPT ANYWAY, as each control's accessible name. An
//    accessible name is worth having even when the visible label is a word, and
//    §3's list of the ones Bobby named by name still has to be covered.
describe('fix-422 §3 (answered by fix-572 §C): the meaning needs no hover', () => {
  it('★★★ every field shows its whole word, with no header button left', () => {
    renderHeader();
    for (const c of UNIT_CONFIG_FIELDS) {
      expect(screen.queryByTestId(`pd-unit-h-${c.key}`), c.key).toBeNull();
      expect(
        screen.getAllByTestId(`pd-unit-f-${c.key}-label`)[0].textContent,
        c.key,
      ).toBe(c.label);
    }
  });

  it('★★★ …and the sentence survives as the control’s accessible name', () => {
    // ★★ THE HALF THAT WOULD OTHERWISE BE LOST. A visible `Parking` says which
    //    field it is; it does not say that the answers run `1-car garage`
    //    through `4-car garage`, or `Surface / None`. §3's copy is what says
    //    that, so it moves onto the control rather than being deleted with the
    //    header that used to carry it.
    renderHeader();
    const block = screen.getAllByTestId('pd-unit-block')[0];
    expect(
      within(block).getByTestId('pd-unit-label-select').getAttribute('aria-label'),
    ).toBe(unitFieldHint('label'));
    expect(within(block).getByTestId('pd-unit-qty').getAttribute('aria-label')).toBe(
      unitFieldHint('qty'),
    );
  });

  it('★★ the ones Bobby named by name are all covered', () => {
    // *"If someone hovered their cursor over QTY, or STY, or P, or S…"*
    // ★ fix-562 §A: the `S` he named was Stalls, which no longer exists; the
    //   other three still do, and `roof_deck` is held to the same bar.
    for (const key of ['qty', 'stories', 'parking_kind', 'roof_deck'] as const) {
      expect(unitFieldHint(key).length, key).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 · CELLS: CODES, WORDS, AND THE EM DASH
// ---------------------------------------------------------------------------

// ===========================================================================
// ★★★ fix-572 §C — THE CELL SHOWS THE WORDS TOO, AND `CodedCell` IS DELETED
// ===========================================================================
//
// §4's title is now half a sentence: the menu still shows the words, and so
// does the closed control.
//
// ★★★ THE OVERLAY WAS ALWAYS A CONCESSION TO 26px. A native `<select>`'s
//     closed face is its selected option's own text, so painting `2G` over it
//     meant a real select at zero opacity underneath — the platform's keyboard,
//     type-ahead and a11y tree kept, only the face ours. Sound, and unnecessary
//     the moment the cell is not 26px. §C's fields are four equal tracks in a
//     760px modal, so the option's own text fits and the control is just a
//     control.
//
// ★★ ITS LAST CALLER WENT WITH IT. `code` was passed by the modal's unit row
//    and nowhere else — the Overview card has printed the answers in full since
//    fix-507/508 transposed the matrix, and the wizard never used it — so
//    `CodedCell`, `OVERLAY_CLASS`, `shortParking` and `shortRoofDeck` are
//    deleted rather than left as a shape a reader would believe was live.
//
// ★★★ AND WHAT §4 WAS REALLY ABOUT IS UNTOUCHED AND STILL ASSERTED BELOW: the
//     MENU is Bobby's words, read from `app_config` and never a literal in the
//     component; `none` is a recorded answer and only NULL is the dash.
describe('fix-422 §4 (fix-572 §C): the words in the menu, and in the cell', () => {
  it('★★★ parking renders the short answer in the cell and Bobby\'s words in the menu', () => {
    renderHeader({
      unit_types: [
        { label: 'Attached', qty: 1, parking_kind: 'garage', parking_count: 2 },
      ],
    } as unknown as Partial<Project>);
    const sel = screen.getByTestId('pd-unit-parking-kind') as HTMLSelectElement;
    // ★ The MENU is Bobby's words — his requirement, and the platform's own.
    //   ★★ And they come from `app_config.parkingOptions` (fix-232), not from a
    //      literal in the component: this list is the CANONICAL fallback, which
    //      is what a suite with no app_config sees.
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      '— not recorded',
      '1-car garage',
      '2-car garage',
      '3-car garage',
      '4-car garage',
      'Surface / None',
    ]);
    // ★★★ THE CLOSED CONTROL SAYS THE WHOLE ANSWER. No short form, no hover
    //     needed — fix-422's own rule about abbreviations, satisfied by not
    //     abbreviating.
    expect(sel.value).toBe('2-car garage');
    expect(sel.className).not.toContain('opacity-0');
    expect(sel.getAttribute('aria-label')).toBe('Parking');
  });

  it('★★★ each recorded answer paints its own short form', () => {
    for (const [unitPatch, face] of [
      // ★ fix-572 §C: the SHORT forms (`1G` / `4G` / `S`) are gone with the
      //   26px cell. The answers themselves are what the control shows, which
      //   is the vocabulary fix-562 §A gave it.
      [{ parking_kind: 'garage', parking_count: 1 }, '1-car garage'],
      [{ parking_kind: 'garage', parking_count: 4 }, '4-car garage'],
      [{ parking_kind: 'surface_none' }, 'Surface / None'],
    ] as const) {
      const { unmount } = renderHeader({
        unit_types: [{ label: 'Attached', qty: 1, ...unitPatch }],
      } as unknown as Partial<Project>);
      const sel = screen.getByTestId('pd-unit-parking-kind') as HTMLSelectElement;
      expect(sel.value).toBe(face);
      unmount();
    }
  });

  it('★★★ roof deck renders PH / RD / N / — with the words still in the menu', () => {
    for (const [unitPatch, face] of [
      // ★ fix-572 §C: `PH` / `RD` / `N` were the 26px faces. The control shows
      //   the answer; NOT RECORDED is still the empty value, and the menu
      //   still names it, which is the half fix-402's rule depends on.
      [{ roof_deck: true, penthouse: true }, 'W/ PH'],
      [{ roof_deck: true, penthouse: false }, 'W/O PH'],
      [{ roof_deck: false }, 'None'],
      [{}, ''],
    ] as const) {
      const { unmount } = renderHeader({
        unit_types: [{ label: 'Attached', qty: 1, ...unitPatch }],
      } as unknown as Partial<Project>);
      const sel = screen.getByTestId('pd-unit-roof-deck') as HTMLSelectElement;
      expect(sel.value).toBe(face);
      expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
        '— not recorded', 'W/ PH', 'W/O PH', 'None',
      ]);
      unmount();
    }
  });

  it('★★★ fix-562 §A: stories is a dropdown, and `3+B` needs no second form', () => {
    renderHeader({
      unit_types: [{ label: 'Attached', qty: 1, stories: 3, basement: true }],
    } as unknown as Partial<Project>);
    const sel = screen.getByTestId('pd-unit-stories') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      '— not recorded', '1', '1+B', '2', '2+B', '3', '3+B', '4', '4+B',
    ]);
    expect(sel.value).toBe('3+B');
  });

  it('★★★ an UNSET field renders an em dash, never an empty box', () => {
    // ★★ fix-402's rule, at the point it bites hardest: NULL is "nobody has
    //    said", and a blank cell says nothing at all. ★★★ After fix-562 §B's
    //    wipe this is the state of EVERY unit on prod, so it is the common case
    //    rather than the corner.
    renderHeader({
      unit_types: [{ label: 'Attached', qty: 1 }],
    } as unknown as Partial<Project>);
    // ★★ fix-572 §C: the em dash is the MENU's first option rather than a
    //    painted face, and the control sits on it — which is the same claim
    //    (fix-386/fix-402: a blank says nothing, `— not recorded` says nobody
    //    has answered) made where a person actually reads it.
    for (const t of ['pd-unit-parking-kind', 'pd-unit-roof-deck', 'pd-unit-stories']) {
      const sel = screen.getByTestId(t) as HTMLSelectElement;
      expect(sel.value, t).toBe('');
      expect(sel.options[sel.selectedIndex].textContent, t).toContain('—');
    }
    // The numeric cells say it with a placeholder, which is the same claim.
    for (const t of ['pd-unit-w', 'pd-unit-d']) {
      const el = screen.getByTestId(t) as HTMLInputElement;
      expect(el.value).toBe('');
      expect(el.getAttribute('placeholder')).toBe('—');
    }
  });

  it('★★★ picking a value writes BOTH PARTS of the answer through', () => {
    renderHeader({
      unit_types: [{ label: 'Attached', qty: 1 }],
    } as unknown as Partial<Project>);
    fireEvent.change(screen.getByTestId('pd-unit-parking-kind'), {
      target: { value: '3-car garage' },
    });
    // ★★★ THE POINT OF STORING THE PARTS: one pick, one write, both halves.
    //     A `(field, value)` callback would have had to fire twice and could
    //     land a kind with no count — the pair `parseUnitTypes` refuses.
    expect(saves[0].unit_types[0].parking_kind).toBe('garage');
    expect(saves[0].unit_types[0].parking_count).toBe(3);

    saves.length = 0;
    fireEvent.change(screen.getByTestId('pd-unit-stories'), {
      target: { value: '2+B' },
    });
    expect(saves[0].unit_types[0].stories).toBe(2);
    expect(saves[0].unit_types[0].basement).toBe(true);

    saves.length = 0;
    fireEvent.change(screen.getByTestId('pd-unit-roof-deck'), {
      target: { value: 'W/O PH' },
    });
    expect(saves[0].unit_types[0].roof_deck).toBe(true);
    expect(saves[0].unit_types[0].penthouse).toBe(false);
  });

  it('★★★ …and clearing it back to NOT RECORDED clears both parts too', () => {
    renderHeader({
      unit_types: [
        { label: 'Attached', qty: 1, parking_kind: 'garage', parking_count: 2 },
      ],
    } as unknown as Partial<Project>);
    fireEvent.change(screen.getByTestId('pd-unit-parking-kind'), {
      target: { value: '' },
    });
    expect(saves[0].unit_types[0].parking_kind).toBeNull();
    expect(saves[0].unit_types[0].parking_count).toBeNull();
  });
});

// ===========================================================================
// ★★★ fix-486 §D (P-143) — §7 IS RETIRED, BY NAME
// ===========================================================================
//
// RETIRED FROM `fix-422 §7: work_scope is a chip, not a column`
//   · it is NOT a matrix column, and the reason is its third state
//   · the chip appears only on a Remodel row, and carries all three states
//   · it sits under the row it belongs to, not beside another one
//
// ★★ THE REASONING IS WORTH KEEPING EVEN THOUGH THE FIELD IS NOT. §7 argued
//    that a three-state answer whose third state is "not yet answered" cannot
//    be a one-glyph cell, because any letter reads as an answer and `—` is
//    already spoken for by "not recorded". That rule still binds the next
//    field somebody proposes for this grid — it is recorded in
//    `lib/unitRowLayout`, above `UNIT_ROW_COLUMNS`, where a person adding a
//    column will meet it.
//
// ★ The two live consequences are asserted elsewhere rather than dropped:
//   `work_scope` is not in `UNIT_ROW_COLUMNS` (UnitsRowFix412 §C3) and no row
//   renders a work control (ProjectCardInteriorFix418, fix-486 §B).

// ---------------------------------------------------------------------------
// §8 · LONG LABELS
// ---------------------------------------------------------------------------

// ★★★ fix-572 §C — §8 SURVIVES, AND ITS SISTER MEASUREMENT IS WHAT KILLED
//     §A. §8 proved a 22-character OFF-REGISTRY label truncates cleanly at a
//     52px Type cell and keeps its full text on hover. True, and it measured a
//     `<span>`. Measured in Chrome 2026-09-15, the `<select>` beside it rendered
//     `D…` for `Detached` at the same width — a `<select>` spends part of its
//     box on a chevron — so EVERY registry value truncated, not only the long
//     off-registry ones.
//
// ★★ THE RULING IS KEPT WHERE IT IS STILL TRUE: a label longer than its field
//    truncates with the full text on hover, because sizing the field for the
//    worst case would tax every project that is not it. At 172px `Detached`
//    fits and `SFR w/ Accessory Units` still does not.
describe('fix-422 §8: an off-registry label truncates and stays readable', () => {
  it('★★★ a 22-character label truncates, with the full text on hover', () => {
    // ★ Sizing the Type column for the longest off-registry label would tax
    //   every row that is not one. 22 characters is the worst case this band
    //   has ever had to hold.
    //
    // ★★ fix-486 (P-143) KEPT THE STRING AND RETIRED THE STATISTIC. When this
    //    was written, 9 of 235 prod rows carried off-registry free text and
    //    "SFR w/ Accessory Units" was the longest. The remap mapped that label
    //    to Detached, so it exists nowhere on prod now — but the PROPERTY being
    //    asserted (a long label truncates and keeps its full text on hover) is
    //    about the cell, not about that string, and the string is still the
    //    honest worst case to prove it with.
    const LONG = 'SFR w/ Accessory Units';
    expect(LONG).toHaveLength(22);
    renderHeader({
      unit_types: [{ label: LONG, width_ft: null, depth_ft: null, qty: 1 }],
      product_types: [],
    } as unknown as unknown as Partial<Project>);
    const cell = screen.getByTestId('pd-unit-label-readonly');
    expect(cell.className).toContain('truncate');
    expect(cell.getAttribute('title')).toContain(LONG);
    expect(cell.textContent).toBe(LONG);
  });

  it('★★ a registry label on the dropdown truncates the same way', () => {
    renderHeader({
      unit_types: [{ label: 'Detached', qty: 1 }],
    } as unknown as Partial<Project>);
    const sel = screen.getByTestId('pd-unit-label-select');
    expect(sel.className).toContain('truncate');
    expect(sel.getAttribute('title')).toBe('Detached');
  });
});

// ---------------------------------------------------------------------------
// §9 · NO SCROLLER, AND fix-331 UNHARMED
// ---------------------------------------------------------------------------

describe('fix-422 §9: horizontal came back, the scrollbar did not', () => {
  it('★★★ nothing in the PROJECT card scrolls sideways — with SIX unit types', () => {
    // ★ Mounted on the OVERVIEW, because this is a claim about the card rather
    //   than about the editor. Six unit types is prod's maximum and it is what
    //   the card's floor is derived to hold.
    renderOverview({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      const cls = typeof el.className === 'string' ? el.className : '';
      expect(cls).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(el.style.overflowX).not.toBe('auto');
      expect(el.style.overflowX).not.toBe('scroll');
    }
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
  });

  it('★★★ fix-331 §1 is unharmed: every unpinned section still grows equally', () => {
    // ★ fix-418 needed `flex-1` on a wrapper to keep this alive; fix-422 has no
    //   wrapper, so the sections are the card's own children again and the rule
    //   applies natively. Asserted because it was a live regression yesterday.
    //
    // ★★★ fix-506 §B/§C PUT TWO OF THEM SIDE BY SIDE, AND THE RULE STILL HOLDS
    //     WHERE IT APPLIES. Site data and Dates are a `flex-wrap` PAIR inside
    //     the card now, so the card's own direct-section count is smaller — the
    //     matrix, plus whatever the pair contributes. The property fix-331 §1
    //     is about is that a DIRECT section is distributed rather than pinned,
    //     and that is what this asserts, of however many there are.
    renderOverview({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(
      card.querySelectorAll(':scope > section'),
    ) as HTMLElement[];
    const distributed = sections.filter((sec) => sec.dataset.pinBottom !== 'true');
    expect(distributed.length).toBeGreaterThanOrEqual(1);
    for (const sec of distributed) {
      expect(sec.style.flexGrow).toBe('1');
      expect(sec.style.flexShrink).toBe('0');
    }
    // ★★ AND THE PAIR IS INSIDE THE CARD, not wrapped around it — the fix-418
    //    trap this test was written for. A wrapper `<div>` between the card and
    //    its sections is what swallows the distribution.
    expect(card).toContainElement(screen.getByTestId('pd-site-dates-pair'));
  });
});
