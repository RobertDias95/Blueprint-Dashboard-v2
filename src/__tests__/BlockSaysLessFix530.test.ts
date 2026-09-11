import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  BLOCK_DATE_LINES,
  blockFieldPlan,
  blockMajorityInRange,
  blockStackHeight,
  metaWantsStack,
} from '../lib/drawScheduleHelpers';
import { DS_PARK_PRESENTATION } from '../lib/drawScheduleStatus';
import { displayAddress, hasRedesignSuffix } from '../lib/displayAddress';

// ===========================================================================
// fix-530 — the block says less and means more (P-245)
// ===========================================================================
//
// ★ Source assertions strip comments first. Eleventh recording of the
//   gravestone trap in this repo.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');
const grid = () => read('src/components/DrawScheduleGrid.tsx');

// ---------------------------------------------------------------------------
// §A — a short block drops fields, not font size
// ---------------------------------------------------------------------------

/** ★★★ MEASURED AT BOTH WIDTHS, which is §A's requirement: *"decide by measured
 *  space, not by week count."* A DA column is `minmax(90px, 1fr)` across the
 *  viewport minus the week label — so at **1600** twelve columns land near
 *  120px and at **1920** near 147px, which changes the address font, its line
 *  count, and therefore most of the stack. The same 2-week block is a different
 *  amount of room at the two widths, and that is the point. */
const AT_1600 = { addressFontPx: 9, detailFontPx: 8 };
const AT_1920 = { addressFontPx: 11, detailFontPx: 9 };

/** A week of block height, as the grid draws it — `BASE_ROW_H`. ★ Read from the
 *  grid rather than guessed: fix-516 shipped a mock-up pixel as a measurement
 *  and this is the same class of number. */
const WEEK_PX = 28;

/** ★ `220 North 58th Street` — Bobby's own example, and the reason the rule
 *  bites where it does. At a 120px column it wraps to THREE lines, which is
 *  what eats the budget; a short address on the same 2-week block keeps its
 *  meta row, and that is correct. */
const LONG_ADDRESS_LINES = 3;

describe('fix-530 §A — the priority order is address, then the date', () => {
  it('★★★ a SHORT block keeps the address and the date and drops the pair', () => {
    // ★★★ 102 of 220 blocks are two weeks or less — 46% of the board. Bobby:
    //     *"Prioritize address, and then we know that it's approved based on
    //     the legend. So then maybe just put the approval date."*
    const plan = blockFieldPlan({
      heightPx: WEEK_PX * 2,
      addressLines: LONG_ADDRESS_LINES,
      ...AT_1600,
      chipRedundant: false,
      metaFitsOneLine: true,
    });
    expect(plan.showMeta).toBe(false);
    expect(plan.metaStacks).toBe(false);
    // ★ The floor is never dropped: the address and the date's two rows.
    expect(plan.detailLines).toBe(BLOCK_DATE_LINES);
  });

  it('★★★ a TALL block keeps everything', () => {
    const plan = blockFieldPlan({
      heightPx: WEEK_PX * 6,
      addressLines: 1,
      ...AT_1920,
      chipRedundant: false,
      metaFitsOneLine: true,
    });
    expect(plan.showMeta).toBe(true);
    expect(plan.detailLines).toBeGreaterThan(BLOCK_DATE_LINES);
  });

  it('★★★ THE SAME BLOCK ANSWERS DIFFERENTLY AT 1600 AND AT 1920', () => {
    // ★★★ §A: *"A 2-week block at 1920 and at 1600 are different amounts of
    //     room, and fix-516 was the last time a mock-up pixel got shipped as a
    //     measurement."* At 1600 the address wraps to two lines and eats the
    //     budget; at 1920 it fits on one and the pair survives.
    const common = { heightPx: WEEK_PX * 2, chipRedundant: false, metaFitsOneLine: true };
    const narrow = blockFieldPlan({ ...common, addressLines: LONG_ADDRESS_LINES, ...AT_1600 });
    const wide = blockFieldPlan({ ...common, addressLines: 1, ...AT_1920 });
    expect(narrow.detailLines).toBeLessThan(wide.detailLines);
    expect(wide.showMeta).toBe(true);
  });

  it('★★★ the plan is measured against the SAME function the anchor uses', () => {
    // ★ Two measurements of one stack is how a block anchors for four rows and
    //   draws three. `blockFieldPlan` calls `blockStackHeight`, and the grid
    //   feeds the plan's own line count back into the anchor decision.
    const height = blockStackHeight(2, 9, 8, BLOCK_DATE_LINES + 1);
    const plan = blockFieldPlan({
      heightPx: height,
      addressLines: 2,
      addressFontPx: 9,
      detailFontPx: 8,
      chipRedundant: true,
      metaFitsOneLine: true,
    });
    expect(plan.detailLines).toBe(BLOCK_DATE_LINES + 1);
    expect(code(grid())).toContain('fieldPlan.detailLines');
  });

  it('★★★ NOTHING is decided by a week count', () => {
    // ⚠️ fix-DS-overflow-minimal keyed the field set to a TIER and fix-515 §A
    //    had to undo it. The plan takes pixels and fonts; there is no week
    //    count in its signature and none in its body.
    const helpers = code(read('src/lib/drawScheduleHelpers.ts'));
    const fn = helpers.slice(
      helpers.indexOf('export function blockFieldPlan'),
      helpers.indexOf('export function metaWantsStack'),
    );
    expect(fn).not.toMatch(/week/i);
    expect(fn).not.toMatch(/durationWeeks|tier/);
  });

  it('★★★ NO FIELD IS EVER TRUNCATED — the block drops it instead', () => {
    // ★★★ *"An omitted field sends the reader to the legend; a truncated one
    //     sends them nowhere."* This is how the board got `Edmo…`, `Sea…`,
    //     `Pho…` (P-224) and `0 SW Concord St [Redesig…`.
    // ★ The one surviving `textOverflow: ellipsis` is the jurisdiction's, and
    //   it is unreachable by construction: the pair only renders when the plan
    //   bought the row, and when it stacks the span owns the full width.
    const plan = blockFieldPlan({
      heightPx: WEEK_PX,
      addressLines: 3,
      ...AT_1600,
      chipRedundant: false,
      metaFitsOneLine: false,
    });
    expect(plan.showMeta).toBe(false);
  });

  it('★★ a pair that cannot fit side by side, with room for only one line, is dropped', () => {
    // ★ The alternative is `Edmo…`, and that is the case P-224 filed.
    const plan = blockFieldPlan({
      heightPx: blockStackHeight(1, 11, 9, BLOCK_DATE_LINES + 1),
      addressLines: 1,
      ...AT_1920,
      chipRedundant: false,
      metaFitsOneLine: false,
    });
    expect(plan.showMeta).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §B — the stack gate is about ROOM, not about status
// ---------------------------------------------------------------------------

describe('fix-530 §B — a tall non-approved block stacks; a short one does not', () => {
  // ★★★ BOTH DIRECTIONS AND BOTH STATUSES, because §B is [[P-239]]'s one-sided
  //     guard again: fix-521's condition happened to be right for Approved and
  //     wrong for everything else, and a test that only ever exercised the
  //     branch that worked is how that shipped.
  const tall = { heightPx: WEEK_PX * 6, addressLines: 1, ...AT_1920, metaFitsOneLine: true };
  const short = {
    heightPx: WEEK_PX * 2,
    addressLines: LONG_ADDRESS_LINES,
    ...AT_1600,
    metaFitsOneLine: true,
  };

  it('★★★ NOT approved + tall → stacks', () => {
    expect(blockFieldPlan({ ...tall, chipRedundant: false }).metaStacks).toBe(true);
  });

  it('★★★ NOT approved + short → does not stack', () => {
    expect(blockFieldPlan({ ...short, chipRedundant: false }).metaStacks).toBe(false);
  });

  it('★★★ approved + tall → no stack, because there is nothing to stack WITH', () => {
    // ★★★ AND THIS IS WHY fix-521 LOOKED FIXED FOR APPROVED. An `Approved` chip
    //     beside an `Approval` date is redundant (fix-521 rule 2), so the chip
    //     is DELETED and the row is one short string — which reads exactly like
    //     a successful stack. It never reached the width test at all.
    const plan = blockFieldPlan({ ...tall, chipRedundant: true });
    expect(plan.metaStacks).toBe(false);
    expect(plan.showMeta).toBe(true);
  });

  it('★★★ approved + short → the row goes entirely', () => {
    expect(blockFieldPlan({ ...short, chipRedundant: true }).showMeta).toBe(false);
  });

  it('★★★ the gate reads ROOM, never the status', () => {
    // ★ `metaWantsStack` takes two booleans and neither is a status. **The
    //   status is not a proxy for the room.**
    expect(metaWantsStack(false, true)).toBe(true);
    expect(metaWantsStack(false, false)).toBe(false);
    expect(metaWantsStack(true, true)).toBe(false);
    const helpers = code(read('src/lib/drawScheduleHelpers.ts'));
    const fn = helpers.slice(helpers.indexOf('export function metaWantsStack'));
    expect(fn.slice(0, 220)).not.toMatch(/approved|corrections|schematic/i);
  });

  it('★★ the grid no longer stacks on a width test alone', () => {
    const g = code(grid());
    expect(g).not.toContain('const metaStacks =\n                      !chipRedundant &&');
    expect(g).toContain('blockFieldPlan({');
  });
});

// ---------------------------------------------------------------------------
// §C — `[Redesign N]` comes off the display only
// ---------------------------------------------------------------------------

describe('fix-530 §C — the suffix is stripped at render, never in the data', () => {
  it('★★★ it strips the stored form, and only that', () => {
    // ★ 17 active projects, every one the exact form `[Redesign 1]`.
    expect(displayAddress('4000 SW Concord St [Redesign 1]')).toBe('4000 SW Concord St');
    expect(displayAddress('4000 SW Concord St [Redesign 12]')).toBe('4000 SW Concord St');
    expect(displayAddress('4000 SW Concord St [redesign]')).toBe('4000 SW Concord St');
    // ★★ A BRACKET THAT MEANS SOMETHING ELSE SURVIVES. The rule is anchored to
    //    the word and to the end of the string, because a generic
    //    bracket-stripper would quietly eat a lot number.
    expect(displayAddress('12 Main St [Lot 3]')).toBe('12 Main St [Lot 3]');
    expect(displayAddress('[Redesign 1] 12 Main St')).toBe('[Redesign 1] 12 Main St');
    expect(displayAddress(null)).toBe('');
  });

  it('★★ the trailing space goes with it', () => {
    // ★ Leaving it behind produces `4000 SW Concord St ` — invisible until it
    //   is centred, and then it is not.
    expect(displayAddress('4000 SW Concord St [Redesign 1]')).not.toMatch(/\s$/);
    expect(hasRedesignSuffix('4000 SW Concord St [Redesign 1]')).toBe(true);
    expect(hasRedesignSuffix('12 Main St [Lot 3]')).toBe(false);
  });

  it('★★★ ONE helper, and the board calls it rather than a local regex', () => {
    // ⚠️ *"One strip helper, used by every surface, not a regex per
    //    component."* This Brain has removed two-writers-of-one-rule three
    //    times.
    const g = code(grid());
    expect(g).toContain("from '../lib/displayAddress'");
    expect(g).toContain('displayAddress(project.address)');
    expect(g).not.toMatch(/replace\(\/.*redesign/i);
    const detail = code(read('src/pages/ProjectDetail.tsx'));
    expect(detail).toContain('displayAddress(');
  });

  it('★★★ NOTHING WRITES IT BACK — the address is the indexer’s join key', () => {
    // ⚠️⚠️ 17 addresses carry it, and that string is what fix-518b matches
    //      share folders on. Rewriting them would risk the plan of record for
    //      exactly the projects fix-524 taught to read through to their
    //      original's drawings.
    const lib = code(read('src/lib/displayAddress.ts'));
    expect(lib).not.toContain('update');
    expect(lib).not.toContain('supabase');
    for (const f of ['src/components/DrawScheduleGrid.tsx', 'src/pages/ProjectDetail.tsx']) {
      expect(code(read(f))).not.toMatch(/address:\s*displayAddress/);
    }
  });

  it('★★ the SEARCH haystack keeps the raw address, deliberately', () => {
    // ★ Somebody typing "redesign" into the board's search is looking for
    //   exactly these 17. Stripping here would make a stored fact unsearchable
    //   in order to tidy a label.
    const g = code(grid());
    expect(g).toContain('`${project.address} ${extra}` : project.address');
  });
});

// ---------------------------------------------------------------------------
// §D — the retired block says its state once
// ---------------------------------------------------------------------------

describe('fix-530 §D — one colour, one word, no strike', () => {
  it('★★★ NOTHING strikes an address any more', () => {
    for (const p of Object.values(DS_PARK_PRESENTATION)) {
      expect(p.strikeAddress).toBe(false);
    }
  });

  it('★★★ no surface draws a line through a retired thing', () => {
    // ★ The ruling is about the STATE, not about one screen: the block, the
    //   shared badge and the Library row all carried it and all lose it.
    for (const f of [
      'src/components/shared/RetiredBadge.tsx',
      'src/components/LibraryMatrix.tsx',
    ]) {
      expect(code(read(f))).not.toContain('line-through');
    }
  });

  it('★★★ the block prints the LEGEND’s word, once, and drops the meta row', () => {
    const g = code(grid());
    expect(g).toContain('block-retired-');
    expect(g).toContain('{park.label}');
    // ★★ `retiredBlock` is what removes the row — the same flag that already
    //    said "this state has no live phase".
    expect(g).toContain('const retiredBlock = park != null && !park.showPhasePill');
    expect(g).toContain('const showMeta = !retiredBlock && fieldPlan.showMeta');
    // ★★★ AND THE SUCCESSOR'S ADDRESS IS GONE. It was the third saying of the
    //     same fact, and it was the one that truncated: `0 SW Concord St
    //     [Redesig…`.
    expect(g).not.toContain('redesignByOriginalId');
    expect(g).not.toContain('block-redesigned-');
  });
});

// ---------------------------------------------------------------------------
// §E — a two-day tail does not create a column
// ---------------------------------------------------------------------------

describe('fix-530 §E — spillover renders, it does not create a lane', () => {
  const Q2 = ['2026-03-30', '2026-07-06'] as const;

  it('★★★ `2621 Eastlake Ave E` does not create Jade’s Q2 column', () => {
    // ★★★ 2026-06-29 → 2026-10-04. Q2's visible range ends in the first week of
    //     July, so ONE of its fourteen weeks is inside — 2 days of 98 by date.
    //     Jade is in neither `dm_da_groups` (12 rows, no Jade) nor the 2026-Q2
    //     layout (9 DA columns, no Jade), so that one week made her an ORPHAN
    //     LANE — her entire column. Bobby: *"it's kind of false advertising."*
    expect(blockMajorityInRange('2026-06-29', '2026-10-05', Q2[0], Q2[1])).toBe(false);
  });

  it('★★★ …and it DOES create her Q3 column, so the block is never lost', () => {
    // ⚠️ [[P-235]] cost exactly this: a project invisible to both lists. The
    //    block's majority is in Q3 and its lane appears there.
    expect(blockMajorityInRange('2026-06-29', '2026-10-05', '2026-06-29', '2026-10-05')).toBe(
      true,
    );
  });

  it('★★ an ordinary block still creates its own column', () => {
    expect(blockMajorityInRange('2026-04-06', '2026-05-25', Q2[0], Q2[1])).toBe(true);
    // ★ A single-week block is a majority of ITSELF — the inclusive-end trap.
    expect(blockMajorityInRange('2026-04-06', '2026-04-06', Q2[0], Q2[1])).toBe(true);
  });

  it('★★★ an exact half creates NO column, in either quarter', () => {
    // ★ Strictly more than half. The safe direction: it still renders in both,
    //   inside columns that exist for other reasons.
    // ★ 2026-06-29 → 2026-07-20 is four weeks; two of them (06-29, 07-06) are
    //   inside Q2's visible range. Exactly half, so neither quarter gains a
    //   lane from it.
    expect(blockMajorityInRange('2026-06-29', '2026-07-20', Q2[0], Q2[1])).toBe(false);
  });

  it('no overlap at all is not a majority', () => {
    expect(blockMajorityInRange('2026-08-03', '2026-09-07', Q2[0], Q2[1])).toBe(false);
    expect(blockMajorityInRange('', '2026-09-07', Q2[0], Q2[1])).toBe(false);
  });

  it('★★★ only `forcedDAs` changed — the edge weeks are untouched', () => {
    // ⚠️ *"Do NOT remove the edge weeks from the board — they are wanted; only
    //    the column rule changes."* `forcedDAs` exists to CREATE a lane for
    //    work that has none; the week list it is measured against is the same
    //    one the grid draws.
    const g = code(grid());
    expect(g).toContain('blockMajorityInRange(row.start_week, row.end_week, firstWeek, lastWeek)');
    expect(g).toContain('const firstWeek = weeks[0]');
    expect(g).toContain('const lastWeek = weeks[weeks.length - 1]');
  });
});
