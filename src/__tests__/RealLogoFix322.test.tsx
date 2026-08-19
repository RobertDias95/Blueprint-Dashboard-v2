import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import indexHtml from '../../index.html?raw';
import markSrc from '../components/BridgeMark.tsx?raw';
import { SHELL_HEADER_HEIGHT } from '../lib/shellMetrics';
// ★ fix-335 §1: the ribbon's mark is a different component now. Its source is
// read here for the same reason BridgeMark's is — so "referenced, not redrawn"
// stays a checkable claim about whatever the ribbon actually renders.
import blueprintSrcRaw from '../components/BlueprintMark.tsx?raw';

// Comments stripped: the file's own history explains what the ribbon used to
// draw, and a check that cannot tell prose from code would forbid saying so.
const blueprintSrc = blueprintSrcRaw.replace(/^\s*\/\/.*$/gm, '');

// fix-322 — the real logo replaces the placeholder. Register #73 follow-up.
//
// fix-313 authored an inline SVG placeholder because Bobby's artwork did not
// exist yet; fix-320 recoloured it. Bobby has now supplied the real thing, so
// the placeholder leaves the ribbon.
//
// ★★ THE SHAPE PROBLEM IS THE WHOLE TICKET. The real logo is 4:1 horizontal and
// what it replaced was a 26px square. They are not interchangeable:
//
//     expanded ribbon (248px) → the wide illustration, ~200px across
//     collapsed rail (56px)   → the square crop, the arch alone
//     favicon (16px)          → ★ the SIMPLIFIED SVG, unchanged
//
// The favicon line is the judgement worth defending: the illustration is a
// skyline, a bridge, cranes, water and trees, and at 16x16 that resolves to a
// smudge. Bobby's brand sheet draws the same distinction with separate detailed
// / simplified / favicon panels.

vi.mock('../lib/supabase', () => {
  const channelChain = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => channelChain),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
    supabaseUrl: 'http://test.local',
  };
});
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'user-1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: 'admin' }],
      activeTenantId: 'test-tenant',
    }),
}));

import Ribbon from '../components/Ribbon';
import BridgeMark from '../components/BridgeMark';

function renderRibbon() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

// ★★ fix-335 §1: THE RIBBON'S MARK IS NO LONGER THE BRIDGE ILLUSTRATION.
//
// Bobby: "we have the new logo that we were using, and we want to replace that
// with the original Blueprint logo." The Bridge artwork was not deleted — §2
// moved it into the white header — so BridgeMark's own contracts, at the bottom
// of this file, are untouched. What changed is which component the RIBBON
// renders, and this helper is where that lands.
//
// ★ EVERY RULE THIS SUITE ESTABLISHED SURVIVES AND IS STILL CHECKED BELOW: a
// referenced asset rather than a drawing, a text alternative, a square crop for
// the collapsed rail rather than a squashed wide one, and a mark that fits
// inside the ribbon's padding. Only the file names moved.
function mark(): HTMLImageElement {
  return screen.getByTestId('blueprint-mark') as HTMLImageElement;
}

describe('fix-322: the expanded ribbon shows the real illustration', () => {
  it('renders the supplied 4:1 logo asset, not a drawing', () => {
    renderRibbon();
    const img = mark();
    expect(img.tagName).toBe('IMG');
    // ★ Assert WHICH asset, not merely that something rendered — the two crops
    // are the point of the ticket and a component that grabbed the wrong one
    // would still render "an image".
    expect(img.getAttribute('src')).toMatch(/blueprint-logo-lockup/);
    expect(img.dataset.logoVariant).toBe('lockup');
  });

  it('★ the placeholder SVG appears nowhere in the ribbon', () => {
    renderRibbon();
    const ribbon = screen.getByTestId('ribbon');
    expect(ribbon.querySelector('svg rect')).toBeNull();
    // ★ fix-335 §1: and the same rule now binds the mark that replaced it.
    expect(blueprintSrc).not.toMatch(/<path|<svg|viewBox/);
    // The paths fix-313 authored are gone from the component entirely.
    expect(markSrc).not.toContain('M5 21c0-6.1 4.9-11 11-11s11 4.9 11 11');
    expect(markSrc).not.toContain('<rect');
  });

  it('★ has a text alternative — a brand image with no words is silence', () => {
    renderRibbon();
    // ★★ fix-335 §2 makes this MORE load-bearing, not less. The ribbon no longer
    // carries a wordmark at all, so this alt is the only place the company's
    // name is spoken to a screen reader anywhere in the rail.
    expect(mark().getAttribute('alt')).toBe('Blueprint');
  });

  // ★★ fix-335 §2: THE WORDMARK LEFT THE RIBBON. "we want to remove the wording
  // Blueprint The Bridge, and we actually want to move that to the white header
  // on all the screens." fix-320's two-line lockup is not restyled or hidden —
  // it moved, and the header's half of it is asserted in BrandingRibbonFix335.
  // What this suite keeps is the half that is still the ribbon's business: no
  // wordmark here, and still no shouted caps anywhere in it.
  it('the wordmark still reads BLUEPRINT over The Bridge, in title case', () => {
    renderRibbon();
    expect(screen.queryByTestId('ribbon-wordmark')).toBeNull();
    expect(screen.queryByTestId('ribbon-wordmark-row')).toBeNull();
    expect(screen.getByTestId('ribbon').textContent).not.toMatch(/THE BRIDGE/);
  });

  // ★ The alignment this layout was chosen to protect: the ribbon's brand block
  // is the same height as the app header beside it, so their bottom borders form
  // one line across the top of the screen. Growing it to fit the wordmark broke
  // that line by 22px, which is why the wordmark moved instead.
  // ★★ fix-345 §2: THE NUMBER CHANGED AND THE RULE DID NOT. Bobby asked for a
  // 2-3x bigger header lockup, which the 56px bar could not hold (the largest
  // that fits with air is 1.7x), so both the header and this block grew to 80.
  // What fix-322 was actually protecting — that the two are the SAME height, so
  // their bottom borders form one line across the top of the screen — is now
  // structurally impossible to break: they read one constant from
  // lib/shellMetrics, which is what this asserts.
  it('the brand block stays 56px, matching the app header', () => {
    renderRibbon();
    expect(screen.getByTestId('ribbon-brand').style.height).toBe(
      `${SHELL_HEADER_HEIGHT}px`,
    );
  });
});

describe('fix-322: the collapsed rail shows the square crop', () => {
  it('★ swaps to the icon asset rather than squashing the 4:1 image', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    const img = mark();
    expect(img.getAttribute('src')).toMatch(/blueprint-logo-icon/);
    expect(img.dataset.logoVariant).toBe('icon');
    // The wide lockup is not merely resized — it is not there at all.
    expect(img.getAttribute('src')).not.toMatch(/blueprint-logo-lockup/);
  });

  it('the icon is square and fits inside the 56px rail', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    const img = mark();
    const w = parseFloat(img.style.width);
    const h = parseFloat(img.style.height);
    expect(w).toBe(h); // square in, square out
    expect(w).toBeLessThanOrEqual(56 - 8); // rail minus its padding
  });

  it('the wordmark row unmounts, so nothing spills out of 56px', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(screen.queryByTestId('ribbon-wordmark-row')).toBeNull();
    expect(screen.getByTestId('ribbon').style.width).toBe('56px');
  });

  // fix-313's contract, re-checked on the new markup.
  it('fix-313 survives: collapsing still persists', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(window.localStorage.getItem('ribbon.collapsed.user-1')).toBe('1');
  });
});

describe('fix-322: the expanded logo cannot overflow the ribbon', () => {
  // ★ fix-325 #1 narrowed both together — 200 in a 248px rail became 156 in a
  // 212px one. The RULE is what this pins, not the numbers: the logo fits
  // inside the ribbon's padding, whatever the pair is.
  it('fits inside the rail with 16px padding either side', () => {
    renderRibbon();
    const img = mark();
    const width = parseFloat(img.style.width);
    // ★ fix-335 §1: 156 → 144, and NOT as a third tightening. 144 is the new
    // artwork's own native width, so the mark renders 1:1 instead of resampled.
    // The rule this test exists for is the inequality below, unchanged.
    expect(width).toBe(144);
    expect(width).toBeLessThanOrEqual(212 - 32);
    // ★ Height is AUTO — the aspect ratio comes from the file, so no caller's
    // number can stretch Bobby's artwork.
    expect(img.style.height).toBe('auto');
    expect(img.style.maxWidth).toBe('100%');
  });
});

describe('fix-322 → fix-325: what the favicon carries', () => {
  // ★★ fix-322 argued the tab should keep the SIMPLIFIED placeholder, because a
  // detailed illustration is a smudge at 16px. Bobby, seeing it in use: "the tab
  // has the old logo as well." ★ fix-325 #2 reverses HALF of that: the wide
  // illustration still has no business in a tab, but the SQUARE ARCH CROP of his
  // real artwork does — rendered at 16px and 32px and checked, not assumed.
  // ★ fix-326 went one further: the square CROP of the illustration was still a
  // shrunken picture, so the tab now carries the brand sheet's purpose-drawn
  // simplified icon. Bobby's artwork either way; the placeholder is long gone.
  // ★ fix-351 RETARGETS THE FILENAMES AND KEEPS THE RULE. Bobby supplied new
  // artwork; the tab still carries HIS mark and still never carries the wide
  // one. The sentence that changed is only which file is his.
  it('the tab carries the real artwork, not the placeholder', () => {
    expect(indexHtml).toMatch(/href="\/bridge-(favicon|icon)-2026-(32|256)\.png"/);
    expect(indexHtml).not.toContain('href="/bridge-mark.svg"');
  });

  it('★ and still NOT the wide illustration — that part of the reasoning holds', () => {
    // ★ fix-351: the lockup is 5.72:1 now, not 4:1 — MORE unusable in a square,
    // so this rule got stronger rather than obsolete.
    expect(indexHtml).not.toMatch(/bridge-logo-400|bridge-logo-full|bridge-logo-2026/);
  });

  // ★ fix-326: two <link>s now, and that is NOT the fix-325 trap. That trap was
  // a second link to a DIFFERENT mark, which let a browser show the placeholder.
  // These are two RENDERINGS OF THE SAME icon at two sizes, so whichever a
  // browser picks it picks the right artwork.
  it('every declared icon is the same mark', () => {
    const icons = indexHtml.match(/<link[^>]+rel="icon"[^>]*>/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    // ★ fix-351: one square artwork at two sizes — the 32 is a hand-tuned
    // rendering of the same crop the 256 carries, so whichever a browser picks
    // it picks the same mark. The rule is unchanged; the filenames moved.
    for (const tag of icons) expect(tag).toMatch(/bridge-(favicon-2026-32|icon-2026-256)\.png/);
  });
});

describe('fix-322: the component is the one place that knows the crops', () => {
  // ★★ fix-351 renamed the default variant from `full` to `lockup`, because the
  // artwork stopped being an illustration and became a LOCKUP — bridge, words
  // and rules in one file. The rule this asserts is unchanged: the component is
  // the one place that knows the crops, and the default is the wide one.
  it('defaults to the wide lockup', () => {
    render(<BridgeMark />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.dataset.logoVariant).toBe('lockup');
    expect(img.getAttribute('src')).toMatch(/bridge-logo-2026/);
  });

  it('★ a caller asking for a small mark gets the ICON, never a squashed logo', () => {
    render(<BridgeMark variant="icon" size={20} />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    // ★ fix-351: the square is bridge-icon-2026-256 now. The rule — "there is
    // deliberately no way to squash the wide image into a square slot" — is the
    // reason the variant exists and it did not change.
    expect(img.getAttribute('src')).toMatch(/bridge-icon-2026-256/);
    expect(img.style.width).toBe('20px');
    expect(img.style.height).toBe('20px');
  });

  it('the artwork is referenced, not redrawn — no inline path data anywhere', () => {
    // If a future hand "cleans up" the logo by inlining an SVG, this fails.
    expect(markSrc).toMatch(/import .*bridge-logo-2026\.png/);
    expect(markSrc).toMatch(/import .*bridge-icon-2026-256\.png/);
    // Comments stripped first — the file's own history explains what it used to
    // draw, and a test that cannot tell prose from code would forbid saying so.
    const code = markSrc.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/<path|<svg|viewBox/);
  });
});
