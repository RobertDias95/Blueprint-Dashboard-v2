import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BLOCK_ADDRESS_CHAR_EM,
  BLOCK_ADDRESS_MAX_LINES,
  BLOCK_ADDRESS_MIN_FONT,
  BLOCK_STACK_GAP,
  BLOCK_STACK_PAD_Y,
  blockAddressFontPx,
  blockAddressLines,
  blockCentresStack,
  blockDetailLines,
  blockFontPx,
  blockStackHeight,
} from '../lib/drawScheduleHelpers';

// ===========================================================================
// ★★★ fix-484 §A (P-146) — THE BLOCK FITS, IS CENTRED, AND HAS NO ASTERISK
// ===========================================================================
//
// Bobby, 2026-09-02: *"when a project is on one quarter and goes to the next, it
// slams to the top or the bottom… it's going off the screen, a ton of colour and
// just a little bit of text."*
//
// ★★ THE PROJECT HE NAMED DOES NOT EXIST. Prod has no `540 3rd Ave N`; it has
// **548 3rd Ave N [Redesign 1]**, 2026-06-22 → 2026-08-17, which crosses the
// Q2/Q3 boundary. One digit. Every fixture below is that real row.
//
// The Chrome measurements are in the PR body and reproducible from
// harness/draw-block-fit-484.html.

const GRID_RAW = readFileSync(
  resolve(process.cwd(), 'src/components/DrawScheduleGrid.tsx'),
  'utf8',
);
/** ★★★ THE COMMENT-STRIPPING TRAP, SEVENTH TIME (fix-411, and fix-483 hit it
 *  again last night). Every §A3 assertion below is "this name does not appear"
 *  — and the note explaining WHY it left names it three times. Asserted against
 *  the CODE, so recording the reason cannot break the test that guards it. */
const GRID = GRID_RAW.split('\n')
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
  .join('\n');
const HARNESS = readFileSync(
  resolve(process.cwd(), 'src/harness/drawBlockFit484.tsx'),
  'utf8',
);

const ADDR = '548 3rd Ave N [Redesign 1]';
/** The real text box: DA column 116px at 1920 (13 DAs), less the block's 2px
 *  insets and 6px horizontal padding a side. */
const BOX_1920 = 100;
/** …and 90px at 1440, where the DA columns sit on their `DA_MIN_W` floor. */
const BOX_1440 = 74;

// ---------------------------------------------------------------------------
// §A1 — the anchor is a HEIGHT question
// ---------------------------------------------------------------------------
describe('fix-484 §A1: a block centres when its stack fits', () => {
  it('★★★ the seven-week tail of Bobby\'s block centres — it used to top-anchor', () => {
    // ★★★ THE DEFECT, AS ARITHMETIC. `justifyContent` read
    //     `isCompact ? 'flex-start' : 'center'`, and `isCompact` is
    //     `!!overflow || visibleSpan <= 1` — true for EVERY cross-quarter slice
    //     however tall. Seven week-rows at 1920's stretched rowH is 403px; the
    //     stack is ~60px. Measured in Chrome: the label sat **174px above the
    //     block's centre**, which is the screenshot.
    const height = 7 * 58 - 3; // rowH 58 at 1920×1080, measured
    const font = blockAddressFontPx(ADDR, BOX_1920, 17, BLOCK_ADDRESS_MIN_FONT);
    const lines = Math.min(
      BLOCK_ADDRESS_MAX_LINES,
      blockAddressLines(ADDR, font, BOX_1920),
    );
    const stack = blockStackHeight(lines, font, 13, blockDetailLines(true));
    expect(blockCentresStack(height, stack)).toBe(true);
  });

  it('★★★ …and a one-week block still top-anchors — fix-DS-address-anchor kept', () => {
    // ★★ THE REASON THAT SURVIVES: centring inside `overflow: hidden` clips the
    //    TOP of a stack taller than its box, and the address is the first child.
    //    That was always a question about HEIGHT; it is now asked as one.
    const height = 1 * 28 - 3; // one week at BASE_ROW_H
    const stack = blockStackHeight(2, 9.5, 8, blockDetailLines(true));
    expect(stack).toBeGreaterThan(height);
    expect(blockCentresStack(height, stack)).toBe(false);
  });

  it('★★ the boundary is exact, and it is a >= not a >', () => {
    expect(blockCentresStack(60, 60)).toBe(true);
    expect(blockCentresStack(59, 60)).toBe(false);
  });

  it('★★ a compact stack counts two detail lines, a full one counts four', () => {
    // compact → "Est. Approval" + the date. full → juris + status + those two.
    expect(blockDetailLines(true)).toBe(2);
    expect(blockDetailLines(false)).toBe(4);
    expect(
      blockStackHeight(1, 10, 8, blockDetailLines(false)),
    ).toBeGreaterThan(blockStackHeight(1, 10, 8, blockDetailLines(true)));
  });

  it('★ the stack height is built from NAMED parts, not a magic number', () => {
    // One address line at 10px, no detail lines: 11 + 0 + 0 gaps + 2 pad.
    expect(blockStackHeight(1, 10, 8, 0)).toBe(
      Math.ceil(10 * 1.1) + BLOCK_STACK_PAD_Y * 2,
    );
    expect(BLOCK_STACK_GAP).toBe(1);
    expect(BLOCK_STACK_PAD_Y).toBe(1);
  });

  it('★★★ the component asks the HEIGHT question, not the isCompact one', () => {
    // The regression this file exists to catch: `justifyContent` going back to
    // `isCompact`. `isCompact` must survive for FIELD SELECTION and nothing else.
    expect(GRID).toContain("justifyContent: centresStack ? 'center' : 'flex-start'");
    expect(GRID).not.toContain("justifyContent: isCompact ? 'flex-start' : 'center'");
    expect(GRID).toContain('const isCompact ='); // still decides which fields render
  });
});

// ---------------------------------------------------------------------------
// §A2 — wrap, then shrink
// ---------------------------------------------------------------------------
describe('fix-484 §A2: the address wraps to two lines, then the font steps down', () => {
  it('★★★ Bobby\'s address fits two lines at 1920 without truncating', () => {
    const font = blockAddressFontPx(ADDR, BOX_1920, 17, BLOCK_ADDRESS_MIN_FONT);
    expect(font).toBeLessThan(17); // it stepped down from the ramp
    expect(font).toBeGreaterThanOrEqual(BLOCK_ADDRESS_MIN_FONT);
    expect(blockAddressLines(ADDR, font, BOX_1920)).toBeLessThanOrEqual(2);
  });

  it('★★★ …and at 1440, where the DA columns sit on their 90px floor', () => {
    const font = blockAddressFontPx(ADDR, BOX_1440, 15, BLOCK_ADDRESS_MIN_FONT);
    expect(font).toBe(BLOCK_ADDRESS_MIN_FONT); // all the way to the floor
    expect(blockAddressLines(ADDR, font, BOX_1440)).toBeLessThanOrEqual(2);
  });

  it('★★★ IT NEVER GOES BELOW THE FLOOR, even when nothing fits', () => {
    // A 30-character address in a 40px box cannot fit two lines at any size the
    // grid permits. The honest failure is small-and-readable plus the clamp's
    // ellipsis and the full address in `title` — not smaller-and-unreadable.
    const long = '13021 23rd Ave NE [Redesign 2]';
    expect(blockAddressFontPx(long, 40, 15, BLOCK_ADDRESS_MIN_FONT)).toBe(
      BLOCK_ADDRESS_MIN_FONT,
    );
    expect(blockAddressLines(long, BLOCK_ADDRESS_MIN_FONT, 40)).toBeGreaterThan(2);
  });

  it('★★★ THE FLOOR IS ABSOLUTE — not multiplied by textScale', () => {
    // ★★★ The harness caught this. At 1920×1080 `textScale` sits on its 1.7 cap,
    //     so a scaled floor would be 16.15px — and 16.15px in a 100px box holds
    //     11 characters a line, so a 26-character address cannot fit two lines
    //     at ANY permitted size. A floor that scales is a second ramp.
    expect(BLOCK_ADDRESS_MIN_FONT).toBe(9.5);
    expect(GRID).toContain('BLOCK_ADDRESS_MIN_FONT,');
    expect(GRID).not.toContain('BLOCK_ADDRESS_MIN_FONT * textScale');
  });

  it('★★ a short address keeps the ramp\'s size — nothing shrinks needlessly', () => {
    expect(blockAddressFontPx('12 Oak', BOX_1920, 15, BLOCK_ADDRESS_MIN_FONT)).toBe(15);
  });

  it('★★ wrapping breaks at SPACES — a long word cannot be split', () => {
    // Counted the way a browser wraps, not by dividing the string: a run with
    // no space in it sets the real minimum.
    expect(blockAddressLines('aaaa bbbb', 10, 100)).toBe(1);
    // One 30-character word at 10px needs 174px; it cannot share a line.
    expect(blockAddressLines('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa x', 10, 100)).toBe(2);
  });

  it('★★ a zero-width column degrades rather than dividing by nothing', () => {
    expect(blockAddressLines(ADDR, 10, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(blockAddressFontPx(ADDR, 0, 15, BLOCK_ADDRESS_MIN_FONT)).toBe(15);
  });

  it('★★★ the char advance ERRS WIDE of every real address', () => {
    // ★★ Measured in Chrome over the seven addresses the grid renders; the
    //    widest is "2724 Walnut Ave SW" at 0.5759 em/char. The constant sits
    //    ABOVE it on purpose: over-estimating steps the font down one notch
    //    early (legible); under-estimating truncates (the defect).
    expect(BLOCK_ADDRESS_CHAR_EM).toBeGreaterThan(0.5759);
    expect(BLOCK_ADDRESS_CHAR_EM).toBeLessThan(0.62); // …and not absurdly wide
  });

  it('★★ the component clamps to two lines and no longer uses nowrap', () => {
    expect(GRID).toContain('WebkitLineClamp: BLOCK_ADDRESS_MAX_LINES');
    expect(BLOCK_ADDRESS_MAX_LINES).toBe(2);
    const addr = GRID.slice(GRID.indexOf('data-testid={`block-address-'));
    expect(addr.slice(0, 400)).not.toContain("whiteSpace: 'nowrap'");
  });
});

// ---------------------------------------------------------------------------
// §A3 — the asterisk
// ---------------------------------------------------------------------------
describe('fix-484 §A3: the shared-project asterisk is gone', () => {
  it('★★★ the grid neither imports the hook nor draws the glyph', () => {
    expect(GRID).not.toContain('useProjectsWithHandoffs');
    expect(GRID).not.toContain('sharedProjectIds');
    expect(GRID).not.toContain("'✳ '");
    expect(GRID).not.toContain('data-shared');
    expect(GRID).not.toContain('Shared (DA reassigned)');
  });

  it('★★★ …and the HOOK stays, because it was not the asterisk', () => {
    // ★ The rule: "keep this, it is used elsewhere" must NAME the call site.
    //   `useProjectsWithHandoffs` had exactly one (this grid) and lost it — but
    //   the MODULE is the per-project handoff reader the editor uses, and
    //   deleting it would take that with it.
    const hook = readFileSync(
      resolve(process.cwd(), 'src/hooks/useProjectDaHandoffs.ts'),
      'utf8',
    );
    expect(hook).toContain('export function useProjectsWithHandoffs');
    expect(hook).toContain('useProjectDaHandoffs');
  });
});

// ---------------------------------------------------------------------------
// §A4 — the harness cannot drift from what it measures
// ---------------------------------------------------------------------------
describe('fix-484 §A4: the harness transcribes the grid honestly', () => {
  it('★★★ its four transcribed constants match the component', () => {
    // ★★ The harness cannot IMPORT them — `DrawScheduleGrid.tsx` is a component
    //    module and react-refresh forbids a non-component export. So it copies
    //    four numbers, and this is what stops the copy going stale and the
    //    measurements quietly describing a grid that no longer exists.
    for (const [name, decl] of [
      ['DA_MIN_W', 'const DA_MIN_W = 90;'],
      ['LABEL_W', 'const LABEL_W = 88;'],
      ['BASE_ROW_H', 'const BASE_ROW_H = 28;'],
    ] as const) {
      expect(GRID, name).toContain(decl);
      expect(HARNESS, name).toContain(decl);
    }
    // The block's padding, which sets the address's text box.
    expect(GRID).toContain("padding: '1px 6px'");
    expect(HARNESS).toContain('BLOCK_PAD_X = 6');
  });

  it('★★ and it measures the address box the way the component does', () => {
    expect(GRID).toContain('daColW - 2 * 2 - 6 * 2');
    expect(HARNESS).toContain('daColW - BLOCK_INSET * 2 - BLOCK_PAD_X * 2');
  });

  it('★ the ramp itself is untouched — this ticket changed the FLOOR and the wrap', () => {
    expect(blockFontPx(2)).toBe(7);
    expect(blockFontPx(8)).toBe(9);
    expect(blockFontPx(20)).toBe(9);
  });
});
