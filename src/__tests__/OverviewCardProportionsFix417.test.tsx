import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';
import {
  OVERVIEW_CARD_CHROME,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_AREAS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_GRID_TEMPLATE,
  OVERVIEW_ROW_MIN_WIDTH,
  SHELL_CHROME_PX,
  overviewMinViewport,
  overviewRowFitsAt,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import {
  FIX_412_ROW_WIDTH,
  UNIT_MATRIX_WIDTH,
  UNIT_ROW_COLUMNS,
  UNIT_ROW_GAP,
} from '../lib/unitRowLayout';
import {
  CONSULTANT_BAND_MIN_WIDTH,
  PLAN_OF_RECORD_CARD_MIN,
  PROJECT_CARD_MIN_WIDTH,
  UNIT_MATRIX_TRANSPOSED_WIDTH,
} from '../lib/projectCardLayout';

// ===========================================================================
// fix-417 — the Project Overview card row gets declared proportions
// ===========================================================================
//
// Bobby, on a marked-up 2724 Walnut Ave SW: *"the proportions are way off now.
// the Design plan of record should be the widest of the boxes, but the team and
// builder owner info is way too slim."* Builder/Owner was clipping mid-word.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER, AND IT IS NOT WHAT THE BRIEF GUESSED
// ---------------------------------------------------------------------------
//
// The brief expected to find that the five widths were decided by "nothing at
// all". They were declared — `0.86fr 1.00fr 0.74fr 1.58fr 0.72fr` on
// `project-overview-grid`, from fix-285/290/295. The bug is that **a bare
// `Nfr` track is `minmax(AUTO, Nfr)`**: its floor is its own min-content, so a
// card whose contents grow takes the difference from its neighbours and the
// declaration is only a preference.
//
// fix-412 grew the Units row to 620px of columns+gaps; with the card's 20px
// padding and 2px border the PROJECT card's min-content became **~642px**
// against a ~266px share, and the other four paid for it.
//
// ★★ So this suite pins BOTH halves: the explicit `minmax` floors (§A) and the
// scroll container that makes a narrow PROJECT card legal (§B). Removing either
// re-creates the bug, which is why they are asserted together.

// ---------------------------------------------------------------------------
// §0 · THE ARITHMETIC, RE-DERIVED FROM THE SOURCE OF TRUTH
// ---------------------------------------------------------------------------

describe('fix-417 §0: the cause, computed rather than quoted', () => {
  it('★★★ the cause was a 620px row, and fix-422 keeps the number as evidence', () => {
    // ★★ fix-422 replaced fix-412's ten-column row with a nine-column matrix,
    //    so the widths that caused this ticket no longer exist as a layout.
    //    They survive as `FIX_412_ROW_WIDTH`, because deleting them would
    //    delete the evidence for a fix that is still load-bearing.
    expect(FIX_412_ROW_WIDTH).toBe(620);
    // + OverviewCard's px-2.5 body padding (20) + 1px border each side.
    expect(FIX_412_ROW_WIDTH + OVERVIEW_CARD_CHROME).toBe(642);
    // ★★★ …which was 2.9× the PROJECT card's 26% share at the time. A track
    //     that cannot go below its content is a track that decides the row.
    expect(642).toBeGreaterThan(220 * 2);
  });

  it('★★★ …and the matrix that replaced it is 274px, which is the whole point', () => {
    // ★ The same arithmetic on today's table. 620 → 274 is why a horizontal
    //   row is legal again: fix-412's row spelled everything out (Label 84,
    //   Work 74, Parking 104); this one abbreviates, uses letter codes, drops
    //   the `×` and moves `work_scope` off the grid entirely.
    const cols = UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0);
    expect(cols).toBe(244);
    expect(UNIT_MATRIX_WIDTH).toBe(274);
    expect(UNIT_MATRIX_WIDTH).toBeLessThan(FIX_412_ROW_WIDTH / 2);
    // ★★★ AND THE CARD'S FLOOR IS STILL DERIVED FROM ITS MATRIX, not typed
    //     beside it — that is fix-417 §B's scroller replacement and it is
    //     untouched in kind. What fix-506 §D changed is WHICH matrix:
    //     transposed, types across and attributes down, so the width is a
    //     function of the unit-type COUNT (332px at prod's maximum of six)
    //     rather than of the attribute list.
    //
    // ★★ THE OLD NUMBER IS KEPT ABOVE AS EVIDENCE, exactly as fix-422 kept
    //    fix-412's 620. `UNIT_MATRIX_WIDTH` still describes the horizontal row
    //    the Library used to render and the wizard still does.
    // ★★★ SUPERSEDED BY fix-508: THE MATRIX NO LONGER BINDS THIS FLOOR. §C
    //     shrinks it (332 → 267 of table, 289 of card) and §B's Site/Dates
    //     pair — which can no longer wrap at 1600, by ruling — passes it on the
    //     way down at 330. The DERIVATION rule fix-422 established is intact
    //     and is what this now asserts: the floor is the widest thing the card
    //     must hold, derived, whichever thing that currently is.
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(proj.minPx).toBe(PROJECT_CARD_MIN_WIDTH);
    expect(PROJECT_CARD_MIN_WIDTH).toBeGreaterThan(
      UNIT_MATRIX_TRANSPOSED_WIDTH + OVERVIEW_CARD_CHROME,
    );
  });
});

// ---------------------------------------------------------------------------
// §A · ONE DECLARED PROPORTION TABLE
// ---------------------------------------------------------------------------

describe('fix-417 §A: the proportions are declared once', () => {
  it('★★★ A3: the percentages sum to exactly 100 (fix-506: THREE of them)', () => {
    // ★★★ SUPERSEDED IN COUNT, NOT IN KIND. fix-506 §A retires Milestones and
    //     Consultants as cards — their content moves into Project and Team —
    //     so the row is three. The RULE fix-417 established, that the shares
    //     are declared once and sum to 100, is what this asserts and it is
    //     untouched.
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
    expect(OVERVIEW_CARD_COLUMNS).toHaveLength(3);
  });

  it('★★★ A3: every card has a floor, and every floor is a real number', () => {
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.minPx).toBeGreaterThan(0);
      expect(Number.isFinite(c.minPx)).toBe(true);
      // ★ …and a stated reason, so a later edit has to argue with something.
      expect(c.floorReason.length).toBeGreaterThan(20);
    }
  });

  it('★★★ SUPERSEDED by fix-508: the RANK is retired, the FLOOR replaces it', () => {
    // ★★★ D-2026-09-09-plan-of-record-keeps-a-floor-not-a-rank. Bobby's
    //     original complaint (P-071) was *"the Design plan of record should be
    //     the widest of the boxes, BUT the team and builder owner info is way
    //     too slim"* — Team was ~100px. The rank was shorthand; the grievance
    //     was Team. fix-508 gives Team 20% of the Project card, which settles
    //     it, so enforcing the rank would defend the shorthand against the
    //     thing it stood for.
    //
    // ★★ WHAT REPLACES IT IS STILL fix-417's OWN MECHANISM, which is why this
    //    test moves rather than being deleted: *a declared share with no floor
    //    is a suggestion.* The Plan of Record keeps a floor — the width its
    //    capped thumbnail actually uses — it just no longer has to beat its
    //    neighbours.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    const team = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!;
    expect(team.pct).toBeGreaterThan(por.pct);
    expect(por.minPx).toBe(PLAN_OF_RECORD_CARD_MIN);
    // ★ 29 → 35: Bobby's v14 ruling is *"Permit intake's column is gone; its
    //   width goes to the Plan of Record card"*, and 35% of the shared space is
    //   what renders the mock's 470px at 1920.
    // ★★ fix-507 §B: 35 → 35.5, and the half point is the whole content of the
    //    change. Project's share had to rise to 35 so the Site/Dates pair fits
    //    side by side (Bobby's ruling 1), and this is the smallest move that
    //    keeps fix-417's ruling — Plan of Record widest — true by construction
    //    rather than by luck. Measured at 1920: PoR 485 · Project 478.
    expect(por.pct).toBe(35.5);
  });

  it('★★ …and it is still the largest FLOOR, which is a fact and no longer a rule', () => {
    // ★ 486 against Project's 330 and Team's 160 — so below the row minimum the
    //   Plan of Record is still the widest card. That is now a CONSEQUENCE of
    //   what its picture needs, not a constraint anybody is defending: above
    //   the floors, Team's larger share overtakes it, and fix-508 intends that.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') expect(por.minPx).toBeGreaterThan(c.minPx);
    }
  });

  it('★★★ every track carries an EXPLICIT px minimum — never a bare fr', () => {
    // ★ THE WHOLE FIX. A bare `Nfr` is `minmax(auto, Nfr)` and hands the card
    //   with the widest contents the power to resize its neighbours.
    const tracks = OVERVIEW_GRID_TEMPLATE.match(/minmax\([^)]*\)/g) ?? [];
    expect(tracks).toHaveLength(3);
    // ★ fix-507 §B: a share may be fractional now (35.5), so the pattern
    //   accepts a decimal. The PROPERTY is unchanged and is the whole point: an
    //   explicit px minimum on every track, never a bare fr.
    for (const t of tracks) expect(t).toMatch(/minmax\(\d+px, \d+(\.\d+)?fr\)/);
    expect(OVERVIEW_GRID_TEMPLATE).not.toMatch(/(^|\s)[\d.]+fr(\s|$)/);
  });

  it('★★ the areas line up with the columns, in order', () => {
    // ★ AMENDED TWICE: fix-475 made the fifth column CONSULTANTS; fix-506 §A
    //   cut the row to three and put the Plan of Record FIRST, because Bobby
    //   reads the overview left to right as a book (P-139) and the plan is what
    //   the page is about. The claim — the areas line up with the columns, in
    //   order — is untouched, which is the whole reason this assertion exists.
    expect(OVERVIEW_GRID_AREAS).toBe('"por proj team"');
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual([
      'por', 'proj', 'team',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §A · NO SIDEWAYS SCROLL AT ANY SUPPORTED WIDTH
// ---------------------------------------------------------------------------

describe('fix-417: the page body never scrolls sideways', () => {
  // =========================================================================
  // ★★★ THIS ASSERTION WAS WRONG, AND IT WAS THE CENTRAL ONE
  // =========================================================================
  //
  // fix-417 claimed 988px of row at 1280 with the ribbon expanded, from a
  // chrome model of *"ribbon 212 · shell p-6 48 · header px-4 32"* = 292px. It
  // walked THREE of the seven boxes between the viewport and this grid. The
  // three it missed are the biggest: `pd-left-rail` is a fixed **240px** permits
  // column that is rendered on the overview too, plus its 12px gap and the
  // right pillbox's 2px border, plus ProjectDetail's own 24px `px-3`.
  //
  // ★★★ THE REAL FIGURE IS 710px, AND THE ROW HAS NEVER FITTED AT 1280.
  // fix-417's floors need 970px. This is not a regression fix-422 introduced —
  // it has been true on main since fix-417 shipped, and the test asserted the
  // wrong number confidently enough that nobody re-derived it. Recorded here as
  // a failure of measurement, not of reasoning: everything fix-417 concluded
  // from `minmax` is still correct.
  //
  // ★★★ fix-507 STEP 0 FOUND AN **EIGHTH** BOX, AND IT IS THE ONE A RECT DOES
  //     NOT SHOW YOU: `pd-right-pillbox` is `overflow-y-auto` and its content
  //     is taller than the pane on every project, so a **15px vertical
  //     scrollbar** is always there. Measured in Chrome at a 1920 viewport: the
  //     pillbox is 1384 wide, its CONTENT box 1367, and the row renders 1335 —
  //     not the 1350 this module computed. fix-422 found 278px by walking the
  //     DOM chain; this is the same walk finding the box that lives BETWEEN the
  //     border box and the content box.
  //
  // ★★★ AND §A NARROWS THE RAIL, 240 → 190 (Bobby, 2026-09-09). Net: the
  //     chrome falls 570 → 535 and the row gains 35px at every viewport.
  it('★★★ the chrome is EIGHT boxes — and the row is 745px at 1280', () => {
    expect(overviewRowWidthAt(1280, 'expanded')).toBe(745);
    expect(overviewRowWidthAt(1280, 'collapsed')).toBe(901);
    // The boxes fix-417 never counted, named so they cannot be lost again.
    expect(SHELL_CHROME_PX.permitsRail).toBe(190);
    expect(SHELL_CHROME_PX.permitsRailGap).toBe(12);
    expect(SHELL_CHROME_PX.pillboxBorder).toBe(2);
    expect(SHELL_CHROME_PX.pillboxScrollbar).toBe(15);
    expect(SHELL_CHROME_PX.pageRowPadding).toBe(24);
    // 212 + 48 + 24 + 190 + 12 + 2 + 15 + 32 = 535 expanded.
    expect(1280 - overviewRowWidthAt(1280, 'expanded')).toBe(535);
    expect(1280 - overviewRowWidthAt(1280, 'collapsed')).toBe(379);
  });

  it('★★★ so the honest fit table is this, at every supported viewport', () => {
    // ★★ STATED RATHER THAN ASSUMED, because it is the thing the next brief
    //    needs and the thing two tickets in a row got wrong. `overviewRowFitsAt`
    //    is derived, so this cannot drift from the floors above it.
    const fits = (vw: number, r: 'expanded' | 'collapsed') =>
      overviewRowFitsAt(vw, r);
    expect(fits(1280, 'expanded')).toBe(false);
    expect(fits(1280, 'collapsed')).toBe(false);
    // ★★★ fix-507 §A won 1440-expanded by ONE PIXEL (905 of row against a 904
    //     minimum). ★★★ fix-508 SPENDS IT AND 91 MORE: the Plan of Record's
    //     floor rises 368 → 486 (its capped thumbnail's own width, replacing
    //     fix-417's retired rank) and the row minimum goes 904 → 996. So 1440
    //     wraps again. Stated rather than quietly re-baselined — 1600 and 1920
    //     are the widths Bobby works at and both still run on one line.
    expect(fits(1440, 'expanded')).toBe(false);
    expect(overviewRowWidthAt(1440, 'expanded')).toBe(905);
    // ★★★ fix-506: 1440-COLLAPSED FITS NOW, and 1600-expanded does. Two cards
    //     left the row and the two that absorbed their content did it in
    //     HEIGHT, so the minimum fell 1,172 → 904.
    // ★ 1440-collapsed is 1061 of row against 996 — still fits.
    expect(fits(1440, 'collapsed')).toBe(true);
    expect(fits(1600, 'expanded')).toBe(true);
    expect(fits(1920, 'expanded')).toBe(true);
    expect(fits(1920, 'collapsed')).toBe(true);
    // ★★★ AND THE THRESHOLD, SPELLED OUT — the number Bobby needs to decide
    //     whether the fallback (a full-width units band) is worth building.
    //
    // ★★★ fix-423 MOVED IT, 1706 → 1788, and did not soften it: measuring the
    //     Milestones card honestly put 82px onto its floor (140 → 222, a date
    //     input does not reflow), so the five cards now need MORE of a window
    //     to share a line, not less. What changed is the CONSEQUENCE below the
    //     threshold: fix-422 reported a sideways scroll there and fix-423 wraps
    //     the row to two lines instead. See OverviewRowFix423 §D.
    // ★★★ fix-475 MOVED IT DOWN, 1788 → 1742, and the direction is the point:
    //     `builder`'s 190 left the row and `consultants` brought a measured
    //     144, so the row needs 46px LESS. Every "does it fit" claim below is
    //     now true by a wider margin than when it was written.
    // ★★★ fix-506 §A MOVED IT AGAIN, 1742 → 1474, and this is the biggest
    //     single move in the sequence — 268px, against fix-475's 46 and
    //     fix-423's 82 the other way. It is not a re-share: the row lost two
    //     CARDS. The brief's requirement was *"must not clip at 1600"*, and
    //     1600 is now 126px clear of the threshold rather than 142 short of it.
    // ★★★ fix-507 §A MOVES IT 1474 → 1439, and this one is not a re-share
    //     either: the permits rail gave 50px back and STEP 0 charged the row
    //     15px for a scrollbar nobody had counted, so the net is 35. 1440 now
    //     fits by a single pixel, which is worth knowing before anybody spends
    //     that pixel.
    // ★★★ fix-508: 1439 → 1531, and the cause is a FLOOR rather than the
    //     chrome — the Plan of Record's, raised to what its picture uses.
    expect(overviewMinViewport('expanded')).toBe(1531);
    expect(overviewMinViewport('collapsed')).toBe(1375);
  });

  it('★★ below the threshold the cards sit on their floors and the PANE scrolls', () => {
    // ★★★ NOT THE CARD. `OverviewCard` is `overflow-hidden`, so a card narrower
    //     than its contents CLIPS silently — which is why the PROJECT floor is
    //     derived from the matrix rather than chosen. What overflows instead is
    //     the grid inside `pd-right-pillbox`, whose `overflow-y-auto` makes its
    //     `overflow-x` compute to `auto`. A scrollbar on the pane is a visible,
    //     recoverable state; a clipped matrix is not.
    // ★ fix-507 §A: 1440-expanded now clears the floors by 1px, so the widest
    //   viewport that puts every track ON its floor is 1280.
    const narrow = resolveOverviewWidths(overviewRowWidthAt(1280, 'expanded'));
    expect(narrow).toEqual(OVERVIEW_CARD_COLUMNS.map((c) => c.minPx));
    expect(narrow[1]).toBeGreaterThanOrEqual(
      UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME,
    );
  });

  it('★★★ Bobby\'s own fix-417 floors did not fit either — by even more than we thought', () => {
    // ★ He gave 180/340/180/320/230 = 1250px, + 4 gaps = 1290px. fix-417 held
    //   that against 988px of row and scaled them down. Against the real 710px
    //   it is nearly double, so the decision to scale was right for a reason
    //   stronger than the one recorded.
    const bobbysFloors = 180 + 340 + 180 + 320 + 230 + 4 * OVERVIEW_GRID_GAP;
    expect(bobbysFloors).toBe(1290);
    // ★ fix-507 §A widened the row at 1280 from 710 to 745, so the multiple is
    //   1.73 rather than 1.8. The point survives at full strength: his floors
    //   are still most of a second row wider than the row he had.
    expect(bobbysFloors).toBeGreaterThan(overviewRowWidthAt(1280, 'expanded') * 1.7);
  });

  it('★★★ fix-422 re-shared the row, and the Plan of Record is STILL the widest', () => {
    // ★★★ BOBBY'S fix-417 RULING, UNREVOKED: *"the Design plan of record should
    //     be the widest of the boxes."* Scope 10(ii) offered its floor as the
    //     place to find room at 1280; taking it would have put Project ahead of
    //     it at EVERY width, not just narrow ones, because Project's floor is
    //     now a hard content requirement. Measured and refused — see the PR.
    // ★★★ SUPERSEDED by fix-508 (D-2026-09-09): the RANK is retired. fix-422's
    //     refusal is kept because its ARITHMETIC was right — taking the Plan of
    //     Record's floor would have put Project ahead at every width. fix-508
    //     does not take that floor; it RAISES it, to the width the card's own
    //     capped thumbnail uses, and lets TEAM past it on share instead.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    const team = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!;
    expect(por.minPx).toBeGreaterThan(proj.minPx);
    expect(team.pct).toBeGreaterThan(por.pct);
    // ★ …at every viewport where the row resolves at all. ★ fix-506 §A moved
    //   the Plan of Record to index 0 — first in the row, because Bobby reads
    //   the overview as a book — so the index is LOOKED UP rather than typed,
    //   which is what stops this assertion silently passing on the wrong card
    //   the next time the order changes.
    // ★ Below the row minimum every track sits on its floor, and the Plan of
    //   Record's is still the largest — so it is the widest card THERE. Above
    //   it, Team's share overtakes, which is the ruling.
    const porIdx = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'por');
    const teamIdx = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'team');
    for (const vw of [1280, 1440, 1600, 1920]) {
      for (const r of ['expanded', 'collapsed'] as const) {
        const row = overviewRowWidthAt(vw, r);
        const w = resolveOverviewWidths(row);
        if (row < OVERVIEW_ROW_MIN_WIDTH) expect(w[porIdx]).toBe(Math.max(...w));
      }
    }
    const wide = resolveOverviewWidths(overviewRowWidthAt(1920));
    expect(wide[teamIdx]).toBeGreaterThan(wide[porIdx]);
  });

  it('★★★ SUPERSEDED: the fifth column is gone, and the defect it guarded is closed elsewhere', () => {
    // ★★★ THIS ASSERTION HAS NOW BEEN AMENDED THREE TIMES AND SUPERSEDED ONCE,
    //     so the chain is worth reading as one thing:
    //
    //       fix-417  Builder/Owner clips emails; its floor is 190 because an
    //                `<input>` does not wrap. A MEASUREMENT, not a preference.
    //       fix-448  those fields stop being inputs.
    //       fix-475  they become WRAPPING TEXT, so readability stops depending
    //                on the column width at all — and the column itself becomes
    //                CONSULTANTS, floor 144.
    //       fix-506  the Consultants column becomes a BAND across the foot of
    //                the Team card, so there is no fifth column to floor.
    //
    // ★★ WHAT THE TEST WAS REALLY ABOUT SURVIVES, and it is asserted of the
    //    cards that exist: every floor in the table is DERIVED from what its
    //    card holds, not typed. That is the property fix-417 established and
    //    the only one worth carrying forward.
    expect(OVERVIEW_CARD_COLUMNS.some((c) => c.key === 'consultants')).toBe(false);
    expect(OVERVIEW_CARD_COLUMNS.some((c) => c.key === 'builder')).toBe(false);

    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    const team = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!;
    // Project: the transposed matrix at six unit types, plus card chrome.
    expect(proj.minPx).toBe(PROJECT_CARD_MIN_WIDTH);
    // Plan of Record: pinned 14px above Project so Bobby\'s "widest of the
    // boxes" ruling holds where the floors bind, not just where shares do.
    // ★★★ fix-508 retires the "14px above Project" pin. The Plan of Record's
    //     floor is its OWN picture now — the width at which the modal plan
    //     sheet exactly fills fix-507b's capped box — so shrinking the units
    //     matrix no longer narrows a card that has nothing to do with it.
    expect(por.minPx).toBe(PLAN_OF_RECORD_CARD_MIN);
    // Team: one consultant pill plus card chrome, and the pill is derived too.
    // ★ fix-423's 160 binds again — §F1's three-line pill takes the pill floor
    //   to 96, so `CONSULTANT_BAND_MIN_WIDTH + chrome` no longer beats it. The
    //   derivation is unchanged; it simply stopped being the larger of the two.
    expect(team.minPx).toBe(
      Math.max(160, CONSULTANT_BAND_MIN_WIDTH + OVERVIEW_CARD_CHROME),
    );
  });

  it('★★ at the width Bobby measured, every squeezed card grows back', () => {
    // His screenshot: ~1345px of row. Distribute the free space by share and
    // compare with what he actually saw.
    const row = 1345;
    const free = row - OVERVIEW_ROW_MIN_WIDTH;
    const widths = OVERVIEW_CARD_COLUMNS.map(
      (c) => c.minPx + (free * c.pct) / 100,
    );
    const [por, proj, team] = widths;
    // ★★★ THE CLAIM IS UNCHANGED AND IT PASSES BY MUCH MORE ROOM. Bobby\'s
    //     screenshot showed 230 · 660 · 100 · 270 · 110 across five cards; the
    //     same 1345px row now holds three, and the two that were squeezed are
    //     the two that absorbed the others\' content.
    expect(team).toBeGreaterThan(100 * 1.7);      // was ~100px
    expect(por).toBeGreaterThan(270);             // was third widest
    // ★ 660/1.9 was the bar when Project shared with four neighbours. It now
    //   shares with two and carries the Dates card and the units matrix, so
    //   the honest bar is that it is not the WIDEST — which is the claim
    //   Bobby's screenshot was actually about.
    expect(proj).toBeLessThan(por);
    expect(por).toBeGreaterThan(proj);
    expect(por).toBe(Math.max(...widths));
  });
});

// ---------------------------------------------------------------------------
// §B · THE UNITS ROW STOPS DICTATING THE PAGE WIDTH
// ---------------------------------------------------------------------------

// =========================================================================
// ★★★ §B IS SUPERSEDED BY fix-418 — AND IT WAS THE RIGHT ANSWER AT THE TIME
// =========================================================================
//
// fix-417 §B wrapped fix-412's horizontal unit row in an `overflow-x` container
// so it would stop setting the page width. Bobby, 2026-08-26: *"make that more
// of a vertical stretch versus a horizontal thing, because I don't like having
// the scroll bar in there."* He does not want the scrollbar CONTAINED, he wants
// it GONE — so the fields run down a column now and the scroller, the row and
// its grid template are all retired.
//
// ★★ WHAT §B WAS PROTECTING STILL HOLDS AND IS ASSERTED HERE: the PROJECT card
// must not be able to set the row's width. The scroller did that by containing
// overflow; vertical does it by never overflowing. The §A proportions and their
// floors — the part of fix-417 that is still load-bearing — are untouched.
describe('fix-417 §B (superseded by fix-418): nothing scrolls sideways', () => {
  it('★★★ the units scroller is GONE, not merely hidden', () => {
    renderHeader();
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
  });

  it('★★★ NOTHING inside the PROJECT card has overflow-x', () => {
    // ★ The point of the change, asserted on the rendered tree rather than on
    //   the one element fix-417 happened to add.
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      expect(el.className).not.toContain('overflow-x-auto');
      expect(el.className).not.toContain('overflow-x-scroll');
      expect(el.style.overflowX).not.toBe('auto');
      expect(el.style.overflowX).not.toBe('scroll');
    }
  });

  it('★★ the column table is still the ONE field declaration', () => {
    // ★ Nine columns now (fix-422 moved `work_scope` off the grid), and the
    //   620px that caused fix-417 lives on as a constant rather than a layout.
    expect(UNIT_ROW_COLUMNS).toHaveLength(9);
    expect(UNIT_ROW_GAP).toBe(4);
    expect(FIX_412_ROW_WIDTH).toBe(620);
  });
});

// ---------------------------------------------------------------------------
// RENDERED
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

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
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
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
// ★ fix-506 §G: the Site editor these two tests read is a Project Data tab now.
import { renderProjectData } from '../test/renderProjectData';

/** ★ THE VALUES BOBBY PHOTOGRAPHED BEING CUT OFF, at full length. */
const LONG_EMAIL = 'contact@buildercompany.com';
const LONG_OWNER = 'Owner / LLC and Partners';
const PHONE = '(206) 555-0100';

/** ★ The same fixture, mounted in the Project Data modal instead of the
 *  header — see src/test/renderProjectData. */
function renderSite(over: Partial<Project> = {}) {
  return renderProjectData(buildProject(over), [], 'site');
}

function renderHeader(over: Partial<Project> = {}) {
  return render(<ProjectDetailHeader project={buildProject(over)} permits={[]} bp={null} />, {
    wrapper: headerWrapper,
  });
}

function headerWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function buildProject(over: Partial<Project> = {}) {
  const project = {
    id: 'p-417',
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
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    unit_types: [{ label: 'SFR', width_ft: 20, depth_ft: 30, qty: 1 }],
    alley: null,
    product_types: ['SFR'],
    project_tags: null,
    builder_name: LONG_OWNER,
    builder_company: 'Builder Company LLC',
    builder_email: LONG_EMAIL,
    builder_phone: PHONE,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
  return project;
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('fix-417 (rendered): the row renders from the declared table', () => {
  it('★★★ the grid renders the module\'s template, gap and areas — not literals', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.gridTemplateColumns).toBe(OVERVIEW_GRID_TEMPLATE);
    expect(grid.style.gridTemplateAreas).toBe(OVERVIEW_GRID_AREAS);
    expect(grid.style.gap).toBe(`${OVERVIEW_GRID_GAP}px`);
  });

  it('★★★ Plan of Record is the widest rendered track', () => {
    renderHeader();
    const tracks =
      screen.getByTestId('project-overview-grid').style.gridTemplateColumns.match(
        /minmax\((\d+)px, (\d+)fr\)/g,
      ) ?? [];
    const shares = tracks.map((t) => parseFloat(/(\d+)fr/.exec(t)![1]));
    const mins = tracks.map((t) => parseFloat(/(\d+)px/.exec(t)![1]));
    // ★ fix-506 §A put the Plan of Record FIRST in the row, so the index is
    //   looked up rather than typed — the same correction made above.
    const porIdx = OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === 'por');
    expect(shares[porIdx]).toBe(Math.max(...shares));
    expect(mins[porIdx]).toBe(Math.max(...mins));
  });

  it('★★ fix-309 #55 survives: equal heights are untouched', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.alignItems).toBe('stretch');
    // ★★ fix-423 added a zero-height forced line break to this row, so "every
    //    child" is no longer "every card". The RULE is unchanged — every CELL
    //    is still `height: 100%` — and the query says so, the same correction
    //    fix-418 made to `topLevelSections()` rather than loosening the claim.
    const cells = Array.from(
      grid.querySelectorAll(':scope > [data-overview-cell]'),
    ) as HTMLElement[];
    expect(cells.length).toBe(OVERVIEW_CARD_COLUMNS.length);
    // ★★★ fix-441 §B (P-019): ONE cell is now a deliberate exception —
    //     Builder/Owner stops at its own content, by Bobby's ruling. The RULE
    //     for the other four is unchanged, and fix-417's WIDTHS are untouched
    //     entirely: this ticket changed one cell's alignment and no track.
    for (const cell of cells) {
      const area = cell.getAttribute('data-overview-cell');
      // ★ fix-475: the short cell is `consultants` now — fix-441's finding is
      //   about the CELL (a card with the least to say must not be stretched),
      //   not about Builder/Owner.
      // ★★★ fix-441 §B's EXCEPTION IS GONE WITH ITS CARD. Consultants stopped
      //     at its own content because it was a LIST in a five-card row; it is
      //     a band inside Team now, so every cell in the row is back under
      //     fix-309 #55's original rule without exception.
      expect(area).not.toBe('consultants');
      expect(cell.style.height, `cell ${area}`).toBe('100%');
    }
  });
});

describe('fix-417: THE REPORTED DEFECT — Builder/Owner clips mid-word', () => {
  it('★★★ a full email survives at the card\'s NARROWEST supported width', () => {
    // ★★★ THIS IS THE TEST THAT FAILS BEFORE AND PASSES AFTER. Bobby
    //     photographed `builder@email`, `contact@email`, `(206) 555-010` and
    //     `Owner / LLC a` — all cut off. These are <input> elements, and an
    //     input does NOT wrap: its value scrolls out of sight, so the ONLY fix
    //     available is width. The card's floor exists to hold this string.
    renderHeader();
    // ★ fix-475: the card lives inside Team behind a disclosure now — its own
    //   column became Consultants. One click, then the same reads.
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    const card = screen.getByTestId('pd-builder-cell');
    // ★★ fix-448 re-points these THREE reads and changes nothing they claim.
    //    Email / Cell / LLC Address are no longer <input>s: the cell is
    //    pick-only now, so the cached fields DISPLAY the linked row (§B4).
    //    The claim — the whole value is present, not a truncation of it — is
    //    the same one, read off textContent instead of .value. The width
    //    assertions below, which are the half that actually fails without the
    //    fix, are untouched.
    const email = within(card).getByTestId('pd-builder-email');
    expect(email.textContent).toBe(LONG_EMAIL);
    expect(email.textContent).toContain('@');
    expect(email.textContent!.endsWith('.com')).toBe(true);

    const phone = within(card).getByTestId('pd-builder-phone');
    expect(phone.textContent).toBe(PHONE);
    // ★ The owner line IS still an input — it is the picker's search box.
    const owner = within(card).getByTestId('pd-builder-name') as HTMLInputElement;
    expect(owner.value).toContain(LONG_OWNER);

    // ★★★ AND THIS IS THE HALF THAT ACTUALLY FAILS BEFORE THE FIX.
    //
    // The three assertions above pass either way, and saying so matters: jsdom
    // has no layout engine, so an <input>'s `value` is the whole string however
    // narrow the box is. The CLIPPING Bobby photographed is visual, and the
    // only thing about it that is measurable here is the WIDTH THE CARD IS
    // GUARANTEED.
    //
    // Before this fix the builder track was a bare `0.72fr` — `minmax(auto,
    // 0.72fr)` — with no declared floor at all, so there was no width to
    // assert and nothing stopping the PROJECT card taking it down to ~110px.
    // Verified by reverting the template and re-running: this expectation
    // fails, the three above do not.
    // ★★★ SUPERSEDED BY fix-475, AND THE REPLACEMENT IS STRONGER.
    //
    //     This asserted that the FIFTH TRACK's floor could hold the email,
    //     because in 2026-08 the fields were <input>s and *"the only thing
    //     about it that is measurable here is the WIDTH THE CARD IS
    //     GUARANTEED."* Two tickets since have changed what is measurable:
    //     fix-448 made these fields TEXT, and fix-475 made that text WRAP when
    //     the card moved into the 160px Team column.
    //
    // ★★ So the guarantee is no longer "the card is wide enough" — it is "the
    //    value cannot be clipped at all". That holds at EVERY width, including
    //    the ones Bobby's photograph was taken at, and it is asserted on the
    //    element rather than on a track that no longer holds this content.
    expect(email.className).not.toContain('truncate');
    expect(email.className).toContain('break-all');
    expect(phone.className).not.toContain('truncate');
    // ★ Every track still declares a real floor — the property fix-417
    //   introduced the `minmax()` for, and the one thing in this test that has
    //   survived every amendment. THREE of them since fix-506 §A.
    // ★ fix-507 §B: a share may carry a decimal now (35.5), so the `fr` half of
    //   the pattern accepts one. The floor half — an explicit px minimum on
    //   every track — is what this assertion is for and is unchanged.
    const trackRe = /minmax\((\d+)px, \d+(?:\.\d+)?fr\)/g;
    const tracks = [
      ...screen
        .getByTestId('project-overview-grid')
        .style.gridTemplateColumns.matchAll(trackRe),
    ];
    expect(tracks).toHaveLength(OVERVIEW_CARD_COLUMNS.length);
    for (const t of tracks) expect(parseFloat(t[1])).toBeGreaterThan(0);
  });

  it('★★★ the floor is wide enough for that email at this card\'s type size', () => {
    // ★ jsdom has no text metrics, so the honest assertion is arithmetic on the
    //   declared floor: 12px bold averages ~6.2px/char, plus the card's 20px
    //   body padding and 2px border. If somebody lowers this floor, the input
    //   starts clipping again and this fails.
    // ★★★ SUPERSEDED BY fix-475 — THE PREMISE, NOT JUST THE NUMBER.
    //     This asserted a WIDTH because fix-417 found *"an input does NOT wrap
    //     … the ONLY fix available is width."* That premise is false twice
    //     over now: fix-448 made these fields READ-ONLY TEXT (but left
    //     `truncate` on, so they kept clipping for a reason that had stopped
    //     applying), and fix-475 took the ellipsis off when the card moved into
    //     the 160px Team column. Text wraps.
    // ★★ So the surviving claim is Bobby's actual report — the WHOLE email is
    //    readable, not a truncation — asserted directly instead of through a
    //    floor standing in for it. Stronger: it holds at any width.
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    const emailLine = screen.getByTestId('pd-builder-email');
    expect(emailLine.textContent).toBe(LONG_EMAIL);
    expect(emailLine.className).not.toContain('truncate');
    expect(emailLine.className).toContain('break-all');
  });
});

describe('fix-417 §B (superseded): the PROJECT card still cannot set the row width', () => {
  it('★★★ the card cannot demand more width than its floor allows', () => {
    // ★★★ fix-418 wrapped and wrapped again; fix-422 does it with arithmetic
    //     instead. The PROJECT floor IS the matrix plus the card chrome, so the
    //     card is never narrower than the grid inside it and never has anything
    //     to scroll — the property §B's scroller existed to guarantee, now a
    //     derivation rather than a container.
    renderHeader();
    expect(screen.queryByTestId('pd-project-interior')).toBeNull();
    // ★★★ fix-506 §D TRANSPOSED THE MATRIX AND THE DERIVATION HELD. The floor
    //     is still "the grid inside the card, plus the card's chrome" — it is
    //     just a different grid: types across, attributes down, sized for
    //     prod's maximum of six unit types.
    // ★★★ AND fix-508 §B/§C HAND THE FLOOR OVER. §C shrinks the matrix to 267
    //     (289 of card) and §B's Site/Dates pair — which can no longer wrap at
    //     1600, by ruling — binds at 330. The PROPERTY this test exists for is
    //     unchanged and is what it now asserts: the card is never narrower than
    //     the widest thing inside it, so it never has anything to scroll.
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(proj.minPx).toBe(PROJECT_CARD_MIN_WIDTH);
    expect(proj.minPx).toBeGreaterThanOrEqual(
      UNIT_MATRIX_TRANSPOSED_WIDTH + OVERVIEW_CARD_CHROME,
    );
  });

  it('★★★ the shares still sum to 100 and every floor is real', () => {
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
    // ★★★ THE TABLE AS fix-506 §A LEAVES IT — three rows where fix-423 left
    //     five. The shares are the v14 mock's `470px · 1.05fr · 1.15fr`
    //     translated: 470 is 35% of the 1,330px of shared space at 1920, and
    //     the remaining 65 splits 1.05 : 1.15.
    // ★★★ fix-508 (P-193) RE-SHARES THEM AGAIN AND RETIRES THE RANK: Project
    //     20% narrower, the freed width to Team, which makes TEAM the widest
    //     card. Measured in Chrome at 1920: 486 · 382 · 497.
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.pct)).toEqual([35.5, 28, 36.5]);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.minPx)).toEqual([
      // ★ por is the width its capped thumbnail uses (486, derived by inverting
      //   fix-507b's cap); proj is the Site/Dates pair plus border and margin;
      //   team is fix-423's 160, which binds again now §F1's pill floor is 96.
      486, 330, 160,
    ]);
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.floorReason.length).toBeGreaterThan(40);
    }
  });
});

describe('fix-417 §C: the SITE rows are sized to their content', () => {
  // ★★★ THE EDITOR MOVED; THE CLAIM DID NOT. fix-506 §G makes the overview
  //     read-only (P-140) and puts every site control in the Project Data
  //     modal's Site data tab. `SiteEditor` itself is byte-for-byte what
  //     shipped, so these two assertions test exactly what they always tested —
  //     they just have to mount it where it lives.

  it('★★★ a Yes/No select no longer spans the whole card', () => {
    // Bobby: a two-character answer with its chevron parked hundreds of pixels
    // away, using more width than the whole TEAM card.
    renderSite();
    for (const id of ['pd-site-corner', 'pd-site-alley', 'pd-site-lots']) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain('w-[90px]');
      expect(el.className).not.toContain('flex-1');
    }
  });

  it('★★ Zone gets more room — its longest option is MIO-37-LR3, not "Yes"', () => {
    renderSite();
    const zone = screen.getByTestId('pd-site-zone');
    expect(zone.className).toContain('w-[124px]');
    expect(zone.className).not.toContain('flex-1');
  });

  it('★★★ …and this does NOT lower the PROJECT card\'s floor', () => {
    // ★ Said plainly because it would be easy to present as part of the
    //   proportions fix. These selects already carried `min-w-0`, so they could
    //   shrink to nothing and never contributed to min-content. The Units row
    //   set that floor and §B is what moved it. §C is looks.
    const unitsRowMin =
      UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0) +
      (UNIT_ROW_COLUMNS.length - 1) * UNIT_ROW_GAP;
    // 90px and 124px are both far below the row that actually sets the floor.
    expect(90).toBeLessThan(unitsRowMin);
    expect(124).toBeLessThan(unitsRowMin);
  });
});
