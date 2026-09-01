/// <reference types="node" />
// ★ Node types are pulled in FOR THIS FILE ONLY, not added to tsconfig's
//   `types` array. This suite is the one place in the app that must read a real
//   file off disk (see the `indexCss` note below); putting `node` in the shared
//   config would make `process` and `Buffer` ambient in every browser module
//   too, which is a much larger change than this ticket asked for.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matrixSource from '../components/LibraryMatrix.tsx?raw';
import planOfRecordSource from '../lib/planOfRecord.ts?raw';
import {
  LIBRARY_GROUP_MIX,
  SITE_PALETTE,
  UNIT_PALETTE,
  cardBorderStyle,
  chipStyle,
} from '../lib/libraryGroupPalette';
import {
  DEFAULT_LIBRARY_SORT,
  SORTABLE_COLUMNS,
  isSortableColumn,
  sortLibraryRows,
  type LibraryRow,
  type SortState,
} from '../lib/libraryHelpers';
import { loadLibraryFilters } from '../lib/surfaceFilterPrefs';

// ===========================================================================
// fix-406 — the layers still don't separate, and Lots leaves the table
// ===========================================================================
//
// Bobby, 2026-08-26, looking at the LIVE fix-402 screen:
//
//   "i think this ui looks good, but you can see in the site and unit search
//    boxes, there is still a lot of gray on gray clashing with letters,
//    backgrounds, boxes etc. also, we can remove lots from the vertical bar
//    below for the sort column as it isnt really relevant here."
//
// Round two of the complaint that produced fix-402's split: the STRUCTURE
// landed, the CONTRAST did not.
//
// ★★★ AND THE HEADLINE FINDING IS THAT ONE OF THE TWO CHIPS HAD NO COLOUR AT
// ALL. fix-402 wrote the SITE chip against `var(--color-ok-bg)` and
// `var(--color-ok)` — **neither is defined anywhere in this app**. An undefined
// custom property with no fallback makes the declaration invalid at
// computed-value time, so all three inline styles were dropped and the chip
// rendered bare. It was not a colour that was too subtle; it was no colour.
// §1 asserts that, because a "make it more contrasty" ticket that never finds
// the missing variable would just have picked a louder shade of nothing.

// ---------------------------------------------------------------------------
// Token plumbing — the app's own palette, read from the app's own stylesheet
// ---------------------------------------------------------------------------

/** Every `--color-*` in `index.css`'s `:root`, as written. Read from the real
 *  file so "these values are derived from the app's tokens" is a claim this
 *  suite can actually check rather than a comment.
 *
 *  ★ READ WITH `fs`, NOT `import '../index.css?raw'`. Vitest processes CSS
 *  imports and hands back an empty string, so the `?raw` form silently yields
 *  ZERO tokens — and every lookup below would be `undefined`, which reads as
 *  "the token is absent" and would have made §1's headline assertion pass for
 *  entirely the wrong reason. */
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

const TOKENS: Record<string, string> = Object.fromEntries(
  [...indexCss.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [
    m[1]!,
    m[2]!.toLowerCase(),
  ]),
);

/** ★ jsdom normalises an inline colour to `rgb(r, g, b)`, so a hex comparison
 *  always fails. Compare in jsdom's own form. */
function asRendered(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/** ★★ COMMENT-STRIPPED. This component's own source now EXPLAINS the missing
 *  `--color-ok` at length, so a raw `not.toContain('--color-ok')` would fail on
 *  the note describing the fix. The trap fix-387, fix-390, fix-395 and fix-405
 *  each hit; stripped here rather than rediscovered. */
const matrixCode = matrixSource
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
  .split(/\r?\n/)
  .map((l) => (l.trim().startsWith('//') ? '' : l.replace(/\s\/\/.*$/, '')))
  .join('\n');

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** `color-mix(in srgb, a P%, b)` — the sRGB mix the palette documents. */
function mix(a: string, b: string, pctA: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = pctA / 100;
  const ch = (x: number, y: number) =>
    Math.round(x * f + y * (1 - f))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Rendering harness — the same shape LibraryMatrix.test.tsx uses
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 3,
      num_lots: 4,
      is_corner_lot: true,
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      unit_types: [{ label: 'Cottage 1', width_ft: 25, depth_ft: 60, qty: 1 }],
      updated_at: '2026-06-25T10:00:00Z',
    },
  ],
  permits: [],
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: new Map<string, unknown>() }) };
});

import LibraryMatrix from '../components/LibraryMatrix';

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LibraryMatrix />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// §1 · THE ROOT CAUSE — a chip painted with a variable that does not exist
// ---------------------------------------------------------------------------

describe('fix-406 §1: the SITE chip had no colour, not a weak one', () => {
  it('★★★ `--color-ok` is defined NOWHERE in the app stylesheet', () => {
    // This is the whole diagnosis in one assertion. If a later ticket defines
    // the token, this fails and somebody re-reads the note above — which is the
    // correct outcome, because the Library would then be the odd surface out.
    // ★★ THE SANITY CHECK COMES FIRST, and it is not decoration. If the
    //    stylesheet failed to load, EVERY token reads `undefined` and the two
    //    assertions below pass for entirely the wrong reason — "the token is
    //    absent" and "I read nothing" are indistinguishable otherwise.
    expect(Object.keys(TOKENS).length).toBeGreaterThan(20);
    expect(TOKENS['--color-is']).toBe('#0891b2');
    expect(TOKENS['--color-jv']).toBe('#7c3aed');

    // ★★★ fix-441 §A INVERTS THIS PIN, AND THE CHAIN IS THE POINT.
    //
    //   fix-406  found `--color-ok` dead, fixed the Library, and REPORTED
    //            that planOfRecord read it too — pinned, not fixed.
    //   fix-407  fixed planOfRecord (and found `--color-wa` dead as well),
    //            by rewriting those chips to read `co` / `pm` directly.
    //   fix-441  found EIGHT more sites still reading the dead names across
    //            five files, and defined the tokens instead of chasing the
    //            readers one ticket at a time.
    //
    // ★★ THE INK IS NOT THE RAW TOKEN — it is fix-407's own 65/35 recipe, for
    //    fix-406's reason: `--color-co` on `--color-co-bg` measures 2.86:1 and
    //    `--color-pm` on `--color-pm-bg` measures 3.32:1, both under the 4.5
    //    floor. See the note in index.css.
    expect(TOKENS['--color-ok']).toBe('#0c6e5b');
    // ★ The tint is an ALIAS (`var(--color-pm-bg)`), so it is deliberately not
    //   a hex in :root and this hex-only reader does not see it. Asserted on
    //   the stylesheet text instead, which is where the alias lives.
    expect(indexCss).toContain('--color-ok-bg:     var(--color-pm-bg);');
  });

  it('★★★ and the Library no longer reads it', () => {
    // ★ Asserted on the CODE, not the file: the source now explains the missing
    //   variable in prose, so the raw text still contains the string.
    expect(matrixCode).not.toContain('--color-ok');
    expect(matrixSource).toContain('--color-ok'); // ...in a comment, deliberately
  });

  it('★★★ planOfRecord read the same dead token — FIXED in fix-407', () => {
    // ★★ WHAT THIS TEST USED TO SAY, and why it said it:
    //
    //   "the SAME undefined token is STILL read by planOfRecord — REPORTED"
    //   expect(planOfRecordSource).toContain('var(--color-ok)');
    //
    // fix-406 found the second surface and deliberately did NOT fix it — the
    // brief said *"do not restyle beyond the Library filter panel + table"* —
    // so it pinned the finding instead, precisely so it could not evaporate.
    // fix-407 §4 fixed it, and the pin inverts. THE MECHANISM WORKED: a
    // reported-not-fixed finding survived a ticket boundary as a test.
    //
    // ★★★ AND fix-406'S REPORT WAS INCOMPLETE. It named `--color-ok`
    // (schematic). `marketing` read `var(--color-wa)`, equally undefined — so
    // TWO of the card's three chips painted nothing, not one.
    // ★ Comment-stripped — planOfRecord now EXPLAINS the dead tokens at
    //   length, so the raw file still contains both strings. Same trap this
    //   suite's own `matrixCode` exists for.
    const porCode = planOfRecordSource
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(/\r?\n/)
      .map((l) => (l.trim().startsWith('//') ? '' : l))
      .join('\n');
    expect(porCode).not.toContain('var(--color-ok)');
    expect(porCode).not.toContain('var(--color-wa)');
    // ★★★ fix-441: the tokens are REAL now, and this file still does not read
    //     them — which is right. planOfRecord states resolved hexes on purpose
    //     (a stylesheet expression cannot be measured), so it keeps its own
    //     numbers; what changed is that the eight OTHER sites finally paint.
    expect(TOKENS['--color-ok']).toBe('#0c6e5b');
    expect(TOKENS['--color-wa']).toBe('#965a1a');
  });
});

// ---------------------------------------------------------------------------
// §2 · THE PALETTE — derived from the app's tokens, and measurably readable
// ---------------------------------------------------------------------------

describe('fix-406 §2: two hues, both derived, both readable', () => {
  it('★★★ every value is a MIX OF THE APP\'S OWN TOKENS, recomputed here', () => {
    // The brief: *"reuse them rather than inventing hexes"*. This replays the
    // arithmetic the palette documents, from the tokens as they appear in
    // index.css. If somebody hand-tweaks a hex, this fails.
    const teal = TOKENS['--color-is']!;
    const purple = TOKENS['--color-jv']!;
    const ink = TOKENS['--color-text']!;
    const grey = TOKENS['--color-border']!;

    expect(SITE_PALETTE.chipBg).toBe(TOKENS['--color-is-bg']);
    expect(UNIT_PALETTE.chipBg).toBe(TOKENS['--color-jv-bg']);

    expect(SITE_PALETTE.chipText).toBe(
      mix(teal, ink, LIBRARY_GROUP_MIX.chipTextHuePct),
    );
    expect(UNIT_PALETTE.chipText).toBe(
      mix(purple, ink, LIBRARY_GROUP_MIX.chipTextHuePct),
    );
    expect(SITE_PALETTE.cardBorder).toBe(
      mix(teal, grey, LIBRARY_GROUP_MIX.cardBorderHuePct),
    );
    expect(UNIT_PALETTE.cardBorder).toBe(
      mix(purple, grey, LIBRARY_GROUP_MIX.cardBorderHuePct),
    );
  });

  it('★★★ THE SQUINT TEST, AS A NUMBER: chip ink clears 4.5:1 on its tint', () => {
    expect(contrast(SITE_PALETTE.chipText, SITE_PALETTE.chipBg)).toBeGreaterThan(4.5);
    expect(contrast(UNIT_PALETTE.chipText, UNIT_PALETTE.chipBg)).toBeGreaterThan(4.5);
  });

  it('★★★ ...and the OBVIOUS treatment would have failed on the SITE half', () => {
    // ★★ THE MEASUREMENT, AND IT IS ASYMMETRIC — which is why the ink is
    // darkened for BOTH rather than for the one that needed it.
    //
    //   `text-is` on `bg-is-bg`  (the stage-badge treatment) → 3.29:1  ✗
    //   `text-jv` on `bg-jv-bg`                              → 4.80:1  ✓
    //
    // Teal at full strength does NOT clear 4.5:1, so reaching for the obvious
    // token — the one every stage badge in this very table uses — would have
    // shipped Bobby's complaint a third time on the SITE card while the UNIT
    // card looked fine. Treating the two differently would have been worse: two
    // chips of the same idea rendered by two different rules is how they drift.
    const naiveSite = contrast(TOKENS['--color-is']!, TOKENS['--color-is-bg']!);
    const naiveUnit = contrast(TOKENS['--color-jv']!, TOKENS['--color-jv-bg']!);
    expect(naiveSite).toBeLessThan(4.5); // ← the one that failed
    expect(naiveUnit).toBeGreaterThan(4.5); // ← the one that did not
    // ★ Both are improved anyway, by the same rule.
    expect(contrast(SITE_PALETTE.chipText, SITE_PALETTE.chipBg)).toBeGreaterThan(naiveSite);
    expect(contrast(UNIT_PALETTE.chipText, UNIT_PALETTE.chipBg)).toBeGreaterThan(naiveUnit);
  });

  it('★★ the two hues are actually DIFFERENT hues, not two greys', () => {
    // Bobby's complaint is that everything reads the same. Two chips that are
    // both "some dark blue" would technically pass the contrast test above and
    // fail the actual request, so the separation is asserted directly.
    const [sr, sg, sb] = rgb(SITE_PALETTE.chipText);
    const [ur, ug, ub] = rgb(UNIT_PALETTE.chipText);
    const distance = Math.abs(sr - ur) + Math.abs(sg - ug) + Math.abs(sb - ub);
    expect(distance).toBeGreaterThan(120);
    // ★ Teal is blue-dominant-with-green; purple is blue-dominant-with-red.
    expect(sg).toBeGreaterThan(sr); // teal: more green than red
    expect(ur).toBeGreaterThan(ug); // purple: more red than green
  });

  it('★★ the card border carries the colour and the card FILL does not', () => {
    // The brief: *"the chip, the card border, nothing else needs the color."*
    // A tinted fill would put a coloured wash behind every white field box and
    // undo the layering this ticket exists to create.
    expect(Object.keys(cardBorderStyle(SITE_PALETTE))).toEqual(['borderColor']);
    expect(chipStyle(UNIT_PALETTE)).toEqual({
      background: UNIT_PALETTE.chipBg,
      color: UNIT_PALETTE.chipText,
      border: `1px solid ${UNIT_PALETTE.chipText}`,
    });
  });
});

// ---------------------------------------------------------------------------
// §3 · WHAT ACTUALLY RENDERS
// ---------------------------------------------------------------------------

describe('fix-406 §3: the two cards carry their colours on screen', () => {
  // ★★★ fix-447 INVERTS THE CHIP HALF OF THIS PIN, BY RULING, AND KEEPS THE
  //     CARD-BORDER HALF UNTOUCHED.
  //
  // Bobby, 2026-08-26 (P-055), looking at what fix-406 shipped: the SITE/UNIT
  // pills *"read as decoration — smaller than the fields they head, and the
  // teal-vs-purple colour split is doing work that typography should do"*. He
  // asked for *"a clear heading over a clear subheading — bigger than the field
  // labels, and without the colour difference."*
  //
  // ★★ SO fix-406 WAS RIGHT AND IS SUPERSEDED, NOT MISTAKEN (fix-400's rule).
  // Its finding — that the chip was rendering with NO colour because
  // `--color-ok` does not exist — was real, and fixing it is what let anyone
  // see the chip clearly enough to judge that it should not be a chip at all.
  //
  // ★★★ THE BORDERS STAY, and the assertion on them is deliberately unchanged:
  // they do a job the heading cannot, which is to say which card you are in
  // when you are scrolled down among the fields with the heading off-screen.
  it('★★★ fix-406 → fix-447: the hue leaves the panel — heading AND card border', () => {
    renderIt();
    const siteChip = screen.getByTestId('filter-chip-site');
    const unitChip = screen.getByTestId('filter-chip-unit');
    // ★★★ ONE INK PER STATE, NOT ONE INK PER GROUP — which is the precise
    //     thing Bobby asked for. The two headings differ only by which is
    //     ACTIVE: SITE is on by default, so it takes the text ink and UNIT the
    //     muted one. Swap the view and the inks swap with it, which proves the
    //     colour is carrying STATE and not identity.
    // ★★★ AMENDED BY fix-467 §2, AND THE CLAIM ABOVE IS UNCHANGED. Bobby then
    //     asked for *"something less subtle than just the under line"* — so the
    //     state is now carried by a FILLED segment rather than by ink + a 2px
    //     rule, and the ink lives on the label span inside the button rather
    //     than on the button itself. **"One ink per STATE, not one ink per
    //     GROUP" is exactly as true as it was**, and it is still what these
    //     four lines prove; only where the property is read from moved.
    const inkOf = (el: HTMLElement) =>
      (el.querySelector('span') as HTMLElement).style.color;
    const siteInk = inkOf(siteChip);
    const unitInk = inkOf(unitChip);
    expect(siteInk).toBe('var(--color-surface)'); // active: white on the fill
    expect(unitInk).toBe('var(--color-text)'); // inactive: text on white
    fireEvent.click(unitChip);
    expect(inkOf(screen.getByTestId('filter-chip-site'))).toBe(unitInk);
    expect(inkOf(screen.getByTestId('filter-chip-unit'))).toBe(siteInk);
    fireEvent.click(screen.getByTestId('filter-chip-site'));

    // ★★ THE BACKGROUND IS NOW THE SIGNAL, WHERE IT USED TO BE `transparent`.
    //    fix-447 removed a tinted pill that read as decoration; fix-467 adds a
    //    FILLED one that reads as state. The difference is what the fill means,
    //    and it is measurable: the two segment fills sit 15.19:1 apart, against
    //    the 1.30:1 that separated the two HUES this suite retired.
    expect(siteChip.style.background).toBe('var(--color-text)');
    expect(unitChip.style.background).toBe('var(--color-surface)');

    // ★★★ THE PROPERTY THAT MUST NEVER CHANGE, AND THE REASON THIS FILE OWNS
    //     THIS TEST: no palette hue reaches either heading, in any state.
    //     Asserted over the whole rendered subtree rather than one property, so
    //     a future "just a small accent" fails here.
    for (const chip of [siteChip, unitChip]) {
      const html = chip.outerHTML;
      for (const hex of [
        SITE_PALETTE.chipText,
        SITE_PALETTE.chipBg,
        SITE_PALETTE.cardBorder,
        UNIT_PALETTE.chipText,
        UNIT_PALETTE.chipBg,
        UNIT_PALETTE.cardBorder,
      ]) {
        expect(html).not.toContain(hex);
        expect(html).not.toContain(asRendered(hex));
      }
    }

    // ★★★ AND THE CARD BORDERS WENT TOO — MEASURED, NOT PREFERRED.
    //
    // fix-447 §A2 allowed the tint to stay IF it cleared fix-406's floor.
    // Against the card surface (--color-s2, #e8edf3) it does not:
    //
    //     SITE #55abc4 → 2.23:1     UNIT #9a77e8 → 2.89:1
    //     the two against EACH OTHER → 1.30:1
    //
    // Neither clears 4.5:1, nor even WCAG's 3:1 non-text threshold — and 1.30:1
    // between them means the hue meant to tell the two cards apart was, by
    // measurement, almost the same hue twice. fix-406's own method found the
    // rest of Bobby's complaint.
    //
    // ★★ The PALETTE MODULE and its measurements above are untouched: they are
    //    the record of how those hexes were derived, and §1/§2 of this suite
    //    still recompute them from the app's tokens.
    const neutral = screen.getByTestId('filter-card-site').style.borderColor;
    expect(neutral).toBe('var(--color-border)');
    expect(screen.getByTestId('filter-card-unit').style.borderColor).toBe(neutral);
    expect(neutral).not.toBe(asRendered(SITE_PALETTE.cardBorder));
  });

  it('★★★ every field in the panel sits on the FIELD surface, not the card', () => {
    // The measured complaint: `bg-bg` (#f0f4f8) boxes on a `bg-s2` (#e8edf3)
    // card is a 2% luminance step — the box did not read as a box.
    renderIt();
    const fields = [
      'library-search',
      'filter-zone',
      'filter-juris',
      'filter-alley',
      'filter-corner',
      'filter-tag',
      'filter-parking-kind',
      'filter-stalls',
      'filter-roof-deck',
      'filter-stories',
      'filter-product-type',
      'lotw-target',
      'lotw-buf',
      'unitd-target',
    ];
    for (const id of fields) {
      const el = screen.getByTestId(id);
      expect(el.className, id).toContain('bg-surface');
      expect(el.className, id).not.toContain('bg-bg');
    }
  });

  it('★★★ ...and that surface is a REAL step above the card', () => {
    // Asserted on the VALUES, not just the class name — `bg-surface` is only an
    // improvement if #ffffff actually separates from #e8edf3.
    //
    // ★★ THE NUMBERS ARE SMALL BY NATURE and that is expected: this is a
    // surface-against-surface step, not text-against-background, so the useful
    // question is not "does it clear 4.5" but "is it meaningfully bigger than
    // what was there". Measured: #f0f4f8 on #e8edf3 = 1.065; #ffffff on
    // #e8edf3 = 1.177 — nearly triple the step away from flat, which combined
    // with the border and the hairline shadow is what makes a box a box.
    const card = TOKENS['--color-s2']!;
    const oldField = TOKENS['--color-bg']!;
    const newField = TOKENS['--color-surface']!;
    const oldStep = contrast(oldField, card) - 1;
    const newStep = contrast(newField, card) - 1;
    expect(oldStep).toBeLessThan(0.07);
    expect(newStep).toBeGreaterThan(2.5 * oldStep);
  });

  it('★★★ labels are readable, and the primary tier is still heavier', () => {
    renderIt();
    const card = TOKENS['--color-s2']!;
    // Secondary — the qualifier row.
    expect(contrast(TOKENS['--color-muted']!, card)).toBeGreaterThan(4.5);
    // Primary — width/depth, fix-402's ruling.
    expect(contrast(TOKENS['--color-text']!, card)).toBeGreaterThan(4.5);
    // ★★ AND THE OLD ONE FAILED. `text-dim` on the card measures ~2.4:1, below
    //    even the 3:1 large-text floor: this is Bobby's "clashing with letters".
    expect(contrast(TOKENS['--color-dim']!, card)).toBeLessThan(3);

    // ★★ The RANK survives — darkening everything equally would flatten the
    //    two tiers fix-402 established back into one list.
    const primary = screen.getByText('Lot Width (ft)');
    const secondary = screen.getByText('Zone');
    expect(primary.className).toContain('text-text');
    expect(primary.className).toContain('font-bold');
    expect(secondary.className).toContain('text-muted');
    expect(secondary.className).not.toContain('font-bold');
    expect(contrast(TOKENS['--color-text']!, card)).toBeGreaterThan(
      contrast(TOKENS['--color-muted']!, card),
    );
  });

  it('★★ no field in the panel is left on the old grey', () => {
    // A blanket sweep, so a box added later cannot quietly reintroduce it.
    const { container } = renderIt();
    const panel = screen.getByTestId('library-filters');
    for (const el of panel.querySelectorAll('input, select')) {
      expect(el.className, el.getAttribute('data-testid') ?? '').not.toMatch(
        /\bbg-bg\b/,
      );
    }
    expect(container).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §4 · LOTS LEAVES THE TABLE
// ---------------------------------------------------------------------------

describe('fix-406 §4: the Lots column and its sort are gone', () => {
  it('★★★ no Lots header, no Lots cell', () => {
    renderIt();
    expect(screen.queryByTestId('library-th-numLots')).toBeNull();
    expect(screen.queryByTestId('library-num-lots-a')).toBeNull();
    // ★ The fixture project HAS 4 lots, so this is the column being absent
    //   rather than the data being empty.
    expect(fixtures.projects[0]!.num_lots).toBe(4);
  });

  it('★★★ the ruling is recorded in the source', () => {
    const prose = matrixSource
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(\/\/|\*|\{?\/\*+)\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(prose).toContain(
      'we can remove lots from the vertical bar below for the sort column as it isnt really relevant here',
    );
    // ★★ ...and fix-402's earlier, narrower ruling is STILL there beside it.
    //    Superseded, not mistaken — the reversal is on the record.
    expect(prose).toContain('we dont need it as a filtering option for this screen');
  });

  it('★★ `numLots` left the sortable set with its column', () => {
    expect(SORTABLE_COLUMNS).not.toContain('numLots' as never);
    expect(isSortableColumn('numLots')).toBe(false);
    // ★ The columns that remain are all still sortable.
    for (const c of SORTABLE_COLUMNS) expect(isSortableColumn(c)).toBe(true);
  });

  it('★★ the header count and the colSpans agree', () => {
    // A stale colSpan is invisible until the table is empty and the message
    // sits under half the width. The empty-state span had in fact been wrong
    // since fix-402 added two columns; it is corrected here because this ticket
    // changes the count again.
    //
    // ★ fix-410 made it 14 — the SITE "Shape" column. The number is asserted
    //   rather than the columns enumerated, deliberately: this test's job is to
    //   FAIL when somebody adds or removes a column, so that the colSpans get
    //   updated with it. It did exactly that for fix-410, and again here.
    //
    // ★★★ fix-447 makes it 11: the caret cell went with fix-81's path, and
    //     Parking and Roof Deck went to the UNIT view, which is where the
    //     per-unit numbers they were summarising actually live.
    renderIt();
    const headers = screen
      .getByTestId('library-table')
      .querySelectorAll('thead th');
    expect(headers.length).toBe(11);
  });

  it('★★ fix-447: the UNIT table\'s header count and its colSpan agree too', () => {
    // The same trap, on the new table: a stale span is invisible until the
    // table is empty.
    renderIt();
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    const headers = screen
      .getByTestId('library-table-unit')
      .querySelectorAll('thead th');
    expect(headers.length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// §5 · A STALE LOTS SORT DEGRADES, IT DOES NOT CRASH
// ---------------------------------------------------------------------------

describe('fix-406 §5: an unrecognised sort column falls back cleanly', () => {
  const rows: LibraryRow[] = [
    { address: 'C', numLots: 1 },
    { address: 'A', numLots: 3 },
    { address: 'B', numLots: 2 },
  ].map((r) => ({
    projectId: r.address,
    address: r.address,
    juris: '',
    productTypes: [],
    units: 0,
    zone: '',
    lotWidth: 0,
    lotDepth: 0,
    alley: '',
    tags: [],
    stage: 'de' as const,
    unitTypes: [],
    numLots: r.numLots,
    isCornerLot: null,
    isRegularShape: null,
    updatedAt: null,
  }));

  /** A SortState carrying a column the app no longer knows. Cast because that
   *  is precisely the situation: TypeScript refuses it, and a value arriving
   *  from storage or a stale fixture has never had to satisfy TypeScript. */
  const stale = { col: 'numLots', asc: true } as unknown as SortState;

  it('★★★ sorting by a dead column does not throw', () => {
    // ★★ THIS WAS A REAL CRASH, NOT A HYPOTHETICAL. The function's last branch
    // is `a[col].localeCompare(...)`; for an unknown column `a[col]` is
    // `undefined`, and that throws a TypeError DURING RENDER — a blank Library,
    // not a wrong order.
    expect(() => sortLibraryRows(rows, stale)).not.toThrow();
  });

  it('★★★ it falls back to the default column — address', () => {
    expect(sortLibraryRows(rows, stale).map((r) => r.address)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(DEFAULT_LIBRARY_SORT.col).toBe('address');
  });

  it('★★ the DIRECTION the person chose is kept', () => {
    // Somebody holding a descending sort keeps descending when their column
    // disappears; resetting both would move the list twice for one lost thing.
    const staleDesc = { col: 'numLots', asc: false } as unknown as SortState;
    expect(sortLibraryRows(rows, staleDesc).map((r) => r.address)).toEqual([
      'C',
      'B',
      'A',
    ]);
  });

  it('★★ any junk column behaves the same way', () => {
    for (const junk of ['', 'parking', 'Address', '__proto__', 'toString']) {
      const s = { col: junk, asc: true } as unknown as SortState;
      expect(() => sortLibraryRows(rows, s), junk).not.toThrow();
      expect(sortLibraryRows(rows, s).map((r) => r.address), junk).toEqual([
        'A',
        'B',
        'C',
      ]);
    }
  });

  it('★★★ SORT WAS NEVER PERSISTED — so the only stale state is the FILTER blob', () => {
    // ★★ THE HONEST FINDING. The brief asks what a stale persisted lots-SORT
    // does; the answer is that fix-403 persists the filter panel and NOT the
    // sort (`useState(DEFAULT_LIBRARY_SORT)`, written by no one). So no such
    // value exists in anybody's sessionStorage today, and the guard above is
    // defence against a fixture, a future URL param, or a later ticket that
    // decides to persist it — not against an existing population.
    expect(matrixSource).not.toMatch(/saveLibraryFilters\([^)]*sort/);
    expect(matrixSource).not.toMatch(/sessionStorage[\s\S]{0,80}sort/);
  });

  it('★★★ ...and a pre-fix-402 filter blob carrying `numLots` decodes cleanly', () => {
    // The one stale shape that CAN exist: a session written before fix-402
    // removed the lots FILTER. fix-403's decoder reads field by field, so an
    // unknown key is ignored and every other filter still restores — rather
    // than one dead key emptying the panel.
    const userId = 'user-1';
    window.sessionStorage.setItem(
      `library.filters.${userId}`,
      JSON.stringify({
        view: 'site' as const,
        search: 'apple',
        zone: 'NR',
        numLots: 5,
        numLotsBuf: 1,
        parkingKind: 'garage',
      }),
    );
    const fallback = {
      // ★ fix-447: the new key. Default 'site' — the Library opens on SITE.
      view: 'site' as const,
      search: '',
      lotwTarget: null,
      lotwBuf: 2,
      lotdTarget: null,
      lotdBuf: 2,
      unitwTarget: null,
      unitwBuf: 2,
      unitdTarget: null,
      unitdBuf: 2,
      zone: '',
      alley: '',
      productTypes: [],
      tag: '',
      juris: '',
      isCornerLot: '' as const,
      isRegularShape: '' as const,
      stories: '' as const,
      parkingKind: '' as const,
      stalls: '' as const,
      roofDeck: '' as const,
      workScope: '' as const,
    };
    const loaded = loadLibraryFilters(userId, fallback);
    expect(loaded).not.toBeNull();
    expect(loaded!.search).toBe('apple');
    expect(loaded!.zone).toBe('NR');
    expect(loaded!.parkingKind).toBe('garage');
    // ★ The dead keys did not survive, and did not take the live ones with them.
    expect('numLots' in loaded!).toBe(false);
    expect('numLotsBuf' in loaded!).toBe(false);
  });
});
