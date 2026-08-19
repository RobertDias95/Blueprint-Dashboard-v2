import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import indexHtml from '../../index.html?raw';
import chromeSrc from '../components/Chrome.tsx?raw';
import markSrc from '../components/BridgeMark.tsx?raw';
import metricsSrc from '../lib/shellMetrics.ts?raw';
import ribbonSrc from '../components/Ribbon.tsx?raw';
import lockupPng from '../assets/brand/bridge-logo-2026.png?inline';
import iconPng from '../assets/brand/bridge-icon-2026-256.png?inline';
import {
  BRAND_LOCKUP_DROP,
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_RULE_ROW,
  BRAND_LOCKUP_SRC_H,
  BRAND_LOCKUP_SRC_W,
  BRAND_LOCKUP_WIDTH,
  SHELL_BORDER_WIDTH,
  SHELL_HEADER_HEIGHT,
} from '../lib/shellMetrics';

// ===========================================================================
// fix-351 — the new Bridge logo, and its line becomes the header's rule
// ===========================================================================
//
// Bobby: *"One thing we like is the blue line that comes from the bridge
// connecting to the break line of the white header."*
//
// ★★★ THAT IS A 1px REQUIREMENT, so this file asserts arithmetic, not vibes.
// Three things must land on one y: the artwork's own lower rule, the header's
// bottom border, and the ribbon's bottom border — the last two being the SAME
// shared constant, which is not allowed to move to make the first one fit.
//
// ★★ EVERY NUMBER HERE WAS MEASURED OFF THE PIXELS, by decoding
// bridge-logo-2026.png and sampling alpha per row at x >= 1200 — clear of the
// bridge illustration, so only the full-width rules contribute:
//
//     upper rule   rows 314–323   alpha centroid y = 319.53
//     lower rule   rows 341–350   alpha centroid y = 346.26   ← the baseline
//     blue         rgb(79, 99, 177) — NOT fix-320's #1d3f6e
//
// ★ The brief said "rows 321–323 and 344–346"; those are the leading edges. The
// derived quantity it gave — the lower rule at ~97.5% of the height — is what
// the measurement confirms: 346.26 / 355 = 97.54%.
//
// ★ The rendered geometry was then checked in a REAL BROWSER (headless Chrome,
// the header's box model reproduced at 1024/1104/1280/1440/1920). jsdom has no
// layout engine, so the numbers live in the PR and what is asserted here is the
// arithmetic that produced them.

/** Source with BOTH comment forms removed — `//` lines and block comments,
 *  which is what a JSX comment is.
 *
 *  ★ Every absence assertion in this file runs through here. These components
 *  quote the markup they replaced and the instruction they came from, and a
 *  test that cannot tell prose from code would forbid a file from explaining
 *  its own history. RealLogoFix322 has stripped `//` for the same reason since
 *  it was written; fix-351 needed the block form too, because Chrome.tsx quotes
 *  the very `<span>` it deleted. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const state = vi.hoisted(() => ({ name: 'Bobby' as string | null }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({
      session: { user: { id: 'u1' } },
      user: { id: 'u1', email: 'x@test' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], notes: null, scope: 'permit' },
    userId: 'u1',
    isLoading: false,
  }),
  useScopeMode: () => ({ mode: 'all', setMode: vi.fn(), identity: { name: state.name } }),
}));
vi.mock('../components/BoardBell', () => ({ default: () => <div data-testid="board-bell-button" /> }));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
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

import Chrome from '../components/Chrome';
import BridgeMark from '../components/BridgeMark';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.name = 'Bobby';
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// §1 — one lockup replaces a mark and styled text
// ---------------------------------------------------------------------------

describe('fix-351 §1: the header is one image now', () => {
  it('★★ renders the new lockup, and nothing else, in the centred block', () => {
    wrap(<Chrome />);
    const centre = screen.getByTestId('chrome-brand-center');
    const img = centre.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/bridge-logo-2026/);
    expect(img.dataset.logoVariant).toBe('lockup');
    expect(centre.children).toHaveLength(1);
  });

  it('★★ the separate icon and the styled wordmark are GONE', () => {
    wrap(<Chrome />);
    expect(screen.queryByTestId('chrome-brand-title')).toBeNull();
    const centre = screen.getByTestId('chrome-brand-center');
    expect(centre.querySelector('span')).toBeNull();
    expect(centre.textContent).toBe('');
    // Not merely unmounted — gone from the CODE, so there is no switched-off
    // second renderer for the next person to find. Comments stripped first: the
    // file explains what it used to render and quotes the instruction it came
    // from, and a test that cannot tell prose from code would forbid saying so.
    const chromeCode = stripComments(chromeSrc);
    expect(chromeCode).not.toContain('chrome-brand-title');
    expect(chromeCode).not.toContain('the Bridge');
  });

  it('★★★ BRAND_NAVY and BRAND_TITLE_SIZE are gone from the source', () => {
    // The brief asks for absence, not disuse. A constant describing nothing is
    // how the next person concludes the wordmark is meant to come back — and
    // this one would have been the WRONG VALUE if revived: the new artwork's
    // rules are rgb(79, 99, 177), not #1d3f6e.
    const code = stripComments;
    expect(code(chromeSrc)).not.toContain('BRAND_NAVY');
    expect(code(chromeSrc)).not.toContain('#1d3f6e');
    expect(code(metricsSrc)).not.toContain('BRAND_TITLE_SIZE');
    // ★ Its two neighbours went the same way and for the same reason: one image
    // has no gap between two things, and its size is a HEIGHT now because the
    // alignment is computed from the height.
    expect(code(metricsSrc)).not.toContain('BRAND_MARK_SIZE');
    expect(code(metricsSrc)).not.toContain('BRAND_LOCKUP_GAP');
  });

  it('★★ the words did not leave the accessible tree with the <span>', () => {
    // The product's name was real text. It is inside a picture now, so without
    // alt text it would have left the accessible name, the clipboard and every
    // screen reader at once — the exact failure fix-345 §2 refused when it wrote
    // the lowercase "t" out in full rather than using text-transform.
    wrap(<Chrome />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.getAttribute('alt')).toMatch(/The Bridge/);
    expect(img.getAttribute('alt')!.trim()).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// §2 — the line has three consumers and they all agree
// ---------------------------------------------------------------------------

describe('fix-351 §2: the artwork\'s rule lands on the header\'s border', () => {
  it('★★★ the drop is derived from the measured rule row, not chosen by eye', () => {
    // The centred block is `absolute inset-y-0`, so its bottom is the header's
    // PADDING box — the border's top edge. Two terms get the artwork's rule from
    // there onto the middle of the border:
    const expected =
      SHELL_BORDER_WIDTH / 2 +
      BRAND_LOCKUP_HEIGHT * (1 - BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H);
    expect(BRAND_LOCKUP_DROP).toBeCloseTo(expected, 10);
    expect(BRAND_LOCKUP_DROP).toBeCloseTo(2.2726, 3);
  });

  it('★★★ and the rule therefore lands on the border to within a hundredth of a pixel', () => {
    // Where the image's bottom edge sits, in header coordinates:
    const imgBottom =
      SHELL_HEADER_HEIGHT - SHELL_BORDER_WIDTH + BRAND_LOCKUP_DROP;
    // Where the artwork's own rule sits inside that image:
    const ruleY =
      imgBottom - BRAND_LOCKUP_HEIGHT * (1 - BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H);
    // Where the header's border's centre line is:
    const borderCentre = SHELL_HEADER_HEIGHT - SHELL_BORDER_WIDTH / 2;
    expect(Math.abs(ruleY - borderCentre)).toBeLessThan(0.01);
  });

  it('★★★ SHELL_HEADER_HEIGHT is still the ONE source for both borders', () => {
    // The whole reason the artwork moves instead of the header: this constant is
    // shared so the header's rule and the ribbon's rule cannot drift and stop
    // forming one line across the top (fix-325, re-derived by fix-322, kept by
    // fix-335 and fix-345). Bending it to suit one image would break the very
    // line the image is trying to join.
    expect(chromeSrc).toContain('SHELL_HEADER_HEIGHT');
    expect(ribbonSrc).toContain('SHELL_HEADER_HEIGHT');
    expect(chromeSrc).not.toMatch(/height:\s*\d+\s*[,}]/);
    expect(metricsSrc).toMatch(/export const SHELL_HEADER_HEIGHT = \d+;/);
  });

  it('★★ the header and the ribbon brand block are the same height, as before', () => {
    wrap(<Chrome />);
    const header = screen.getByTestId('chrome-header');
    const brand = screen.getByTestId('ribbon-brand');
    expect(header.style.height).toBe(brand.style.height);
    expect(header.style.height).toBe(SHELL_HEADER_HEIGHT + 'px');
  });

  it('★★ the block is bottom-anchored and dropped by exactly that amount', () => {
    wrap(<Chrome />);
    const centre = screen.getByTestId('chrome-brand-center');
    // items-end, not items-center: ending the block puts the image's bottom on
    // the border's top edge, and the drop takes it the rest of the way.
    expect(centre.className).toContain('items-end');
    expect(centre.className).not.toContain('items-center');
    expect(centre.style.marginBottom).toBe(`-${BRAND_LOCKUP_DROP}px`);
  });

  it('★ the artwork above its rule still fits inside the bar, with air', () => {
    const aboveTheRule =
      BRAND_LOCKUP_HEIGHT * (BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H);
    expect(aboveTheRule).toBeLessThan(SHELL_HEADER_HEIGHT);
    expect(SHELL_HEADER_HEIGHT - aboveTheRule).toBeGreaterThan(5);
  });

  it('★ the lockup is height-driven, so the alignment cannot depend on the aspect', () => {
    wrap(<Chrome />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.style.height).toBe(`${BRAND_LOCKUP_HEIGHT}px`);
    expect(img.style.width).toBe('auto');
    // The width that follows from the file's own pixels.
    expect(BRAND_LOCKUP_WIDTH).toBeCloseTo(411.72, 2);
  });
});

// ---------------------------------------------------------------------------
// §2b — the measurements are of the real file, not of a number in a comment
// ---------------------------------------------------------------------------

describe('fix-351 §2b: the constants describe the file that ships', () => {
  /** Read a PNG's IHDR straight out of the bytes Vite inlined. */
  function pngSize(dataUri: string): { w: number; h: number } {
    const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const bin = atob(b64);
    const at = (i: number) => bin.charCodeAt(i);
    const be32 = (i: number) =>
      (at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3);
    // 8-byte signature, then the IHDR chunk: 4 len + 4 type + width + height.
    return { w: be32(16) >>> 0, h: be32(20) >>> 0 };
  }

  it('★★★ the lockup really is 2030 × 355 — the alignment rests on it', () => {
    // If somebody swaps the file for one with a different aspect or a different
    // amount of padding under the rule, BRAND_LOCKUP_RULE_ROW stops describing
    // it and the line silently stops meeting. This is the guard for that.
    const { w, h } = pngSize(lockupPng);
    expect(w).toBe(BRAND_LOCKUP_SRC_W);
    expect(h).toBe(BRAND_LOCKUP_SRC_H);
    expect(w / h).toBeCloseTo(5.7183, 3);
  });

  it('★★ the rule row is inside the file, near its baseline', () => {
    expect(BRAND_LOCKUP_RULE_ROW).toBeLessThan(BRAND_LOCKUP_SRC_H);
    expect(BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H).toBeGreaterThan(0.95);
    expect(BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H).toBeCloseTo(0.9754, 4);
  });

  it('★★ the square really is square — the reason it exists at all', () => {
    const { w, h } = pngSize(iconPng);
    expect(w).toBe(h);
    expect(w).toBe(256);
  });

  // ★★★ THE SUPERSEDED ARTWORK IS DELETED, NOT LEFT LYING NEXT TO THE LIVE FILE.
  //
  // ★ This is not tidiness. fix-325 exists BECAUSE a stale brand file was still
  // being served: Bobby, seeing it in use — "the tab has the old logo as well."
  // The two public/ copies are shipped in every deploy and index.html no longer
  // names them, so a bookmark could still fetch the OLD mark and show it in a
  // tab. The src/assets/ copies are the same trap one folder over: five files
  // sharing a naming family with the live one, none of them imported.
  //
  // ★ The two names that survive are NEGATIVE assertions in fix-322/325/326
  // ("the tab never carries the wide illustration"), which do not need the file
  // to exist — the rule outlived the artwork, which is the whole pattern here.
  it('★★★ no superseded bridge artwork is left in the tree', () => {
    const brand = Object.keys(
      import.meta.glob('../assets/brand/*.png', { eager: true }),
    ).map((p) => p.split('/').pop());
    const bridge = brand.filter((f) => f!.startsWith('bridge-')).sort();
    expect(bridge).toEqual([
      'bridge-favicon-2026-32.png',
      'bridge-icon-2026-256.png',
      'bridge-logo-2026.png',
    ]);
    // ★ And the Blueprint marks are untouched — a different company mark with a
    // different job (fix-335 §1), and not this ticket's business.
    expect(brand).toContain('blueprint-logo-lockup.png');
    expect(brand).toContain('blueprint-logo-icon.png');
  });
});

// ---------------------------------------------------------------------------
// §3 — the browser tab
// ---------------------------------------------------------------------------

describe('fix-351 §3: the tab uses the square, never the lockup', () => {
  it('★★★ every icon link is the square crop', () => {
    const icons = indexHtml.match(/<link[^>]+rel="icon"[^>]*>/g) ?? [];
    expect(icons.length).toBe(2);
    for (const tag of icons) {
      expect(tag).toMatch(/bridge-(favicon-2026-32|icon-2026-256)\.png/);
    }
  });

  it('★★★ and the lockup is never the favicon — it is 5.72:1', () => {
    // In a 32px square it is an illegible smear; letterboxed it is ~6px tall.
    expect(indexHtml).not.toContain('bridge-logo-2026');
    expect(BRAND_LOCKUP_SRC_W / BRAND_LOCKUP_SRC_H).toBeGreaterThan(5);
  });

  it('★★ the public/ and src/assets/ split is kept, not collapsed', () => {
    // index.html references the tab's copy by a STABLE path because every
    // bookmark loads it directly; the in-app copies are imported so Vite
    // fingerprints them and a missing file fails the BUILD. fix-326 asserts
    // this split and the brief forbids collapsing it.
    expect(indexHtml).toMatch(/href="\/bridge-favicon-2026-32\.png"/);
    expect(markSrc).toMatch(/import .*'\.\.\/assets\/brand\/bridge-icon-2026-256\.png'/);
    expect(markSrc).not.toMatch(/from '\/bridge-/);
  });
});

// ---------------------------------------------------------------------------
// The standing contract
// ---------------------------------------------------------------------------

describe('fix-351: the artwork is referenced, never redrawn', () => {
  it('★★★ fix-322\'s grep survives, on the component and on the header', () => {
    // Comments stripped first: the files' own history explains what they used
    // to draw, and a test that cannot tell prose from code would forbid saying
    // so. (The same treatment RealLogoFix322 has always used.)
    const code = stripComments;
    expect(code(markSrc)).not.toMatch(/<path|<svg|viewBox/);
    expect(code(chromeSrc)).not.toMatch(/<path|<svg|viewBox/);
    expect(markSrc).toMatch(/import .*bridge-logo-2026\.png/);
    expect(markSrc).toMatch(/import .*bridge-icon-2026-256\.png/);
  });

  it('★ rendering it produces an <img>, not a drawing', () => {
    render(<BridgeMark />);
    const img = screen.getByTestId('bridge-mark');
    expect(img.tagName).toBe('IMG');
    expect(img.querySelector('path')).toBeNull();
  });

  it('★ and the square is still the only way to ask for something small', () => {
    render(<BridgeMark variant="icon" size={20} />);
    const img = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/bridge-icon-2026-256/);
    expect(img.style.width).toBe('20px');
    expect(img.style.height).toBe('20px');
  });
});
