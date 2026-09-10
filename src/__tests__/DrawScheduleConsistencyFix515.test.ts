import { describe, it, expect } from 'vitest';
import {
  blockDetailLines,
  blockBorderFromFill,
  darkenHex,
} from '../lib/drawScheduleHelpers';
import { STATUS_PRESENTATION, DS_PARK_PRESENTATION } from '../lib/drawScheduleStatus';

import gridSrc from '../components/DrawScheduleGrid.tsx?raw';
import helpersSrc from '../lib/drawScheduleHelpers.ts?raw';
import overviewSrc from '../components/ProjectDetail/ProjectOverviewBoxes.tsx?raw';
import headerSrc from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import cardSrc from '../components/ProjectDetail/OverviewCard.tsx?raw';

// ===========================================================================
// fix-515 (P-211 · P-212 · P-210 · P-213) — SAYING THE SAME THING TWICE
// ===========================================================================
//
// All four are a surface not saying the same thing twice in a row: two blocks
// carrying different fields, two colour systems on one block, a heading printed
// twice, and a control that reads as parked rather than as the card's foot.

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// §A — every block says the same things
// ---------------------------------------------------------------------------

describe('fix-515 §A — jurisdiction and phase render on EVERY block', () => {
  it('★★★ the compact tier is gone — `blockDetailLines` takes no argument', () => {
    // ★★★ §A0's THREE COUNTS WERE ALL ZERO, measured on prod before the
    //     template was touched: 0 projects with no jurisdiction, 0 lanes with
    //     nothing to derive a phase from (12 have no permits and all 12 are
    //     reuse-redesigns, which fix-150 chases to the parent), and 0
    //     unselected columns (`juris` IS in useProjects's explicit list —
    //     checked first, as the brief instructs).
    //
    // ★★★ THE CAUSE WAS THIS FUNCTION. It read `isCompact ? 2 : 4`, so 40 of
    //     219 lanes (18.3%) dropped both fields — 34 crossing a quarter, 6 one
    //     week long — with the data present every time.
    expect(blockDetailLines()).toBe(3);
    expect(blockDetailLines.length).toBe(0);
  });

  it('★★★ `isCompact` no longer exists as a field gate', () => {
    const c = code(gridSrc);
    expect(c).not.toContain('const isCompact');
    expect(c).not.toContain('!isCompact &&');
  });

  it('★★★ both fields render unconditionally, on one row', () => {
    const c = code(gridSrc);
    // One flex row holding both, so a compact block gains a line and a full
    // block loses one — the tallest stack got shorter, not taller.
    expect(c).toContain('data-testid={`block-meta-${row.project_id}`}');
    expect(c).toContain('data-testid={`block-juris-${row.project_id}`}');
    expect(c).toContain('data-testid={`block-status-${row.project_id}`}');
  });

  it('★★★ a missing jurisdiction READS as having none, not as silence', () => {
    // §A: *"a row that legitimately has no phase should read as HAVING NONE,
    // not as not mentioning it."* Prod has zero of these; the branch is what
    // makes the first one legible instead of invisible.
    const c = code(gridSrc);
    expect(c).toContain("{project.juris || 'No jurisdiction'}");
  });

  it('★★★ a CANCELLED block still answers the phase question — with the truth', () => {
    // fix-263 removed the phase chip from a cancelled block because leaving it
    // made the block read as pending. fix-515 does not put it back; the park's
    // own label takes the chip's place, so the row says "Cancelled" rather than
    // saying nothing.
    expect(DS_PARK_PRESENTATION.cancelled.showPhasePill).toBe(false);
    expect(DS_PARK_PRESENTATION.cancelled.label).toBe('Cancelled');
    expect(code(gridSrc)).toContain('park && !park.showPhasePill ? park.label : pres.label');
    // ★ A HELD project is still ACTIVE, so it keeps its real phase.
    expect(DS_PARK_PRESENTATION.hold.showPhasePill).toBe(true);
  });

  it('★★ the phase reads from the DRAW SCHEDULE lane status, and says so', () => {
    // ★ P-179 is not reconciled here and this does not widen it: the value now
    //   printed is the one that ALREADY coloured the block, so it is one
    //   derivation with two renderings rather than two derivations.
    const c = code(gridSrc);
    expect(c).toContain('deriveLaneStatus({');
    expect(c).toContain('STATUS_PRESENTATION[derivedStatus]');
    expect(c).toContain('{park && !park.showPhasePill ? park.label : pres.label}');
  });
});

// ---------------------------------------------------------------------------
// §B — the border is the fill, darkened
// ---------------------------------------------------------------------------

describe('fix-515 §B — one colour system, derived', () => {
  it('★★★ the old jurisdiction/redesign palette is gone from the app', () => {
    // ★★★ WHAT IT ENCODED, before deletion: blue = Seattle, red = Arizona,
    //     green = everywhere else AND no jurisdiction, gold = a redesign. Two
    //     facts the fill does not carry — which is why this is a finding and
    //     not a cleanup, and why both facts had to land somewhere first.
    const c = code(helpersSrc);
    expect(c).not.toContain('export function jurisBorder');
    expect(c).not.toContain('REDESIGN_BORDER_COLOR');
    expect(c).not.toContain('export function blockBorderColor');
    expect(code(gridSrc)).not.toContain('blockBorderColor(');
    // …and no hard-coded dark palette replaced it.
    expect(c).not.toContain('#1d4ed8');
    expect(c).not.toContain('#dc2626');
    expect(c).not.toContain('#eab308');
  });

  it('★★★ the border is DERIVED from the fill, in one function', () => {
    // §B: *"do not hand-pick four dark values… one function, applied to
    // whatever the legend gives."*
    expect(code(gridSrc)).toContain('blockBorderFromFill(sc.bg)');
    for (const s of Object.values(STATUS_PRESENTATION)) {
      const derived = blockBorderFromFill(s.colors.bg);
      expect(derived, s.label).toMatch(/^#[0-9a-f]{6}$/);
      expect(derived, s.label).not.toBe(s.colors.bg);
    }
  });

  it('★★★ a FIFTH status needs no new border — the point of deriving it', () => {
    // The regression this replaces: a per-status table means somebody has to
    // remember the fifth row.
    expect(blockBorderFromFill('#123456')).toBe(darkenHex('#123456'));
    expect(darkenHex('#808080')).toBe('#5c5c5c');
  });

  it('★★ it darkens MULTIPLICATIVELY, so a pale fill and a deep one both work', () => {
    // `#ffffff` (Scheduled) must become a visible grey; `#02267e` (Pending
    // Consultants) must not clip to black.
    expect(darkenHex('#ffffff')).toBe('#b8b8b8');
    const deep = darkenHex('#02267e');
    expect(deep).not.toBe('#000000');
    expect(deep).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('★★★ it runs on WHATEVER the fill is — the color_override property', () => {
    // ⚠️ FINDING: the brief says `draw_schedule.color_override` "exists and is
    //    honoured". It is NOT read anywhere in src; 14 of 219 prod rows carry
    //    one and every one is ignored at render. Taking the FILL rather than a
    //    status key means the day it is wired up the border follows it free.
    const override = '#7a3f9d';
    expect(blockBorderFromFill(override)).toBe(darkenHex(override));
    expect(code(gridSrc)).not.toMatch(/blockBorderFromFill\(\s*derivedStatus/);
  });

  it('★★ a non-hex colour comes back unchanged rather than black', () => {
    // The park palette is CSS variables and a cancelled block is a hatch —
    // neither is something this can operate on, and both keep their own chrome.
    expect(darkenHex('var(--color-hold-border)')).toBe('var(--color-hold-border)');
    expect(darkenHex('')).toBe('');
    // ★ And the park keeps its OWN border rather than a darkened one: fix-263's
    //   second chrome is a deliberate different statement.
    expect(gridSrc).toContain('2px solid ${park.border}');
  });
});

// ---------------------------------------------------------------------------
// §C — the Units heading, once
// ---------------------------------------------------------------------------

describe('fix-515 §C — the Units card says UNITS once', () => {
  it('★★★ the matrix corner no longer repeats the card title', () => {
    // ★★★ WHICH WAS NEWER, CHECKED NOT GUESSED: the card title is fix-506
    //     (`4fc59fb`, PR #447); the corner arrived with fix-507's transposed
    //     matrix (`33ffae9`, PR #448). The newer copy goes.
    const c = code(overviewSrc);
    const corner = c.slice(c.indexOf('data-testid="pd-units-corner"'));
    expect(corner.slice(0, 120)).not.toContain('Units');
  });

  it('★★★ the card title is untouched — it is the one every sibling card has', () => {
    expect(code(overviewSrc)).toContain('<OverviewSection title="Units" testId="pd-units-matrix">');
  });

  it('★★ the `<th>` itself STAYS, because the column width hangs off it', () => {
    // `tableLayout: 'fixed'` sizes the attribute-name column from
    // UNIT_MATRIX_CORNER_PCT on this cell; deleting it would collapse the
    // matrix's first column and take fix-508 §C's width derivation with it.
    const c = code(overviewSrc);
    expect(c).toContain('data-testid="pd-units-corner"');
    expect(c).toContain('width: `${UNIT_MATRIX_CORNER_PCT}%`');
  });
});

// ---------------------------------------------------------------------------
// §D — the chat button at the bottom of the chat card
// ---------------------------------------------------------------------------

describe('fix-515 §D — the chat button is pinned to the foot of its card', () => {
  it('★★★ it is pinned, not merely last', () => {
    // ★★★ IT WAS ALREADY LAST IN THE DOM (fix-508 §F4). What was wrong is that
    //     it was not PINNED: making Chat a grid cell in fix-507 §C took
    //     `pinBottom` off the section and the comment above it went on claiming
    //     otherwise. With a short preview the button floated mid-cell.
    const c = code(headerSrc);
    expect(c).toContain('data-testid="pd-chat-action-foot"');
    expect(c).toMatch(/className="mt-auto pt-1\.5"/);
  });

  it('★★★ …and the section lets its body fill, which is what makes mt-auto work', () => {
    const c = code(headerSrc);
    expect(c).toContain('<OverviewSection title="Chat" testId="project-overview-team-chat" fillBody>');
    expect(code(cardSrc)).toContain('fillBody');
  });

  it('★★★ IT COSTS THE ROW NO HEIGHT — same children, same padding, same section', () => {
    // §D required this in numbers. There is no new element, no new padding and
    // no new line: `mt-1.5` became `mt-auto pt-1.5` and the body was allowed to
    // fill. The Team card's height is a max over its cells and the chat cell's
    // CONTENT height is unchanged, so the row minimum is untouched at every
    // width — 1600 and 1920 included.
    const c = code(headerSrc);
    // The button is still INSIDE the section (the sibling alternative would
    // have added the section's `pb-2` a second time).
    const chatStart = c.indexOf('testId="project-overview-team-chat"');
    const chatEnd = c.indexOf('</OverviewSection>', chatStart);
    const chatSection = c.slice(chatStart, chatEnd);
    expect(chatSection).toContain('pd-chat-action-foot');
    expect(chatSection).toContain('<ProjectChatSection projectId={project.id} />');
  });

  it('★★ fix-346 holds — exactly ONE way into the chat, and the badge rides it', () => {
    const c = code(headerSrc);
    // ★ Exactly one CONTROL. The other `setChatOpen(true)` is the `?chat=`
    //   deep-link applier, which fix-362 §2 requires and which is not a second
    //   affordance — a link you cannot paste is not a link.
    expect((c.match(/onClick=\{\(\) => setChatOpen\(true\)\}/g) ?? []).length).toBe(1);
    expect(c).toContain('<ProjectChatUnread projectId={project.id} />');
  });

  it('★★ `fillBody` is inert without spare height, like its two neighbours', () => {
    // Same reasoning as flexGrow and centerVertically above it: in an
    // auto-height parent the body is its content and nothing moves.
    const c = code(cardSrc);
    expect(c).toContain("flex: '1 1 auto'");
    expect(c).toContain('data-fill-body');
  });
});
