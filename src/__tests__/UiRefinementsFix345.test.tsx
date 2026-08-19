import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import chromeSrc from '../components/Chrome.tsx?raw';
import ribbonSrc from '../components/Ribbon.tsx?raw';
import {
  RIBBON_ENTRIES,
  SHAREPOINT_URL,
  activeRibbonTarget,
  allRibbonExternals,
  allRibbonRoutes,
  isRibbonEntryActive,
  ribbonExemptPaths,
  visibleEntries,
} from '../lib/ribbonNav';
import {
  BRAND_LOCKUP_DROP,
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_RULE_ROW,
  BRAND_LOCKUP_SRC_H,
  SHELL_HEADER_HEIGHT,
} from '../lib/shellMetrics';

// fix-345 §2 and §4 — the header lockup, and SharePoint as an ordinary row.
//
// ★ §1 (the Today button) is asserted in DrawScheduleGrid.test.tsx and §3 (the
// three uniform card buttons) in MilestonesCard.test.tsx, each beside the
// harness that already renders the surface. This file is the shell.

vi.mock('../lib/supabase', () => {
  const channelChain = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
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

const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'editor' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'u1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: authState.role }],
      activeTenantId: 't1',
      setSession: vi.fn(),
      setInitialized: vi.fn(),
    }),
}));

vi.mock('../components/NewProjectWizard', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="wizard-stub" /> : null,
}));

import Ribbon from '../components/Ribbon';
import Chrome from '../components/Chrome';

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function renderRibbon(at = '/dashboard') {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter initialEntries={[at]}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function renderShell(at = '/dashboard') {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter initialEntries={[at]}>
        <Chrome />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  authState.role = 'admin';
});

// ===========================================================================
// ★★ §2 — the header lockup, 2.5x bigger, and "the" lowercase
// ===========================================================================

// ★★★ fix-351 REPLACED THE TWO-ELEMENT LOCKUP WITH ONE IMAGE, so the four tests
// that measured a mark BESIDE styled text no longer have two things to measure.
// The rules they encoded all survive, retargeted onto the artwork:
//
//   "the" is lowercase, in the string not in CSS   → it is in Bobby's file now,
//                                                    and nothing renders it twice
//   the lockup is 2.5x fix-335's size              → it is bigger still, and the
//                                                    floor is asserted below
//   the mark is downscaled, never enlarged         → 355px of source into 72px
//   the gap keeps the two from crowding            → there is no gap; there are
//                                                    no two things
//
// ★ The one that could NOT be carried across is the lowercase "the". Measured
// off bridge-logo-2026.png, the word is drawn in capitals. That is Bobby's
// artwork and this repo's standing rule is that it is referenced, never
// redrawn — so it is flagged in the PR rather than fixed here or asserted away.
describe('fix-345 §2: the header lockup, now one image', () => {
  it('★★ one element, not a mark beside styled text', () => {
    renderShell();
    const centre = screen.getByTestId('chrome-brand-center');
    expect(centre.children).toHaveLength(1);
    expect(screen.queryByTestId('chrome-brand-title')).toBeNull();
    // ★ And the app sets no type here at all, so there is nothing for a
    // text-transform to shout — fix-345's original concern, now unreachable.
    expect(centre.textContent).toBe('');
    expect(chromeSrc).not.toMatch(/textTransform/);
  });

  // ★ Bobby: "we want the logo and Bridge at least 2-3x bigger." fix-345 shipped
  // a 65px mark; the lockup is 72px tall and carries the words inside that,
  // so the artwork grew again rather than shrinking to fit.
  it('★★ the lockup is sized from the shared metric, and it grew', () => {
    renderShell();
    const img = screen
      .getByTestId('chrome-brand-center')
      .querySelector('img') as HTMLImageElement;
    expect(parseFloat(img.style.height)).toBe(BRAND_LOCKUP_HEIGHT);
    // Width is left to the file's own aspect — a caller's number can never
    // stretch the artwork.
    expect(img.style.width).toBe('auto');
    expect(BRAND_LOCKUP_HEIGHT).toBeGreaterThanOrEqual(65);
  });

  // ★ The artwork can take it: the source is 355px tall, so 72px is a downscale
  // by ~5x. The ribbon's Blueprint lockup is the opposite case — 144px IS the
  // artwork (fix-335 §1) — which is why only one of the two ever grows.
  it('★ the lockup is still downscaled, never enlarged', () => {
    renderShell();
    const img = screen
      .getByTestId('chrome-brand-center')
      .querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/bridge-logo-2026/);
    expect(BRAND_LOCKUP_HEIGHT).toBeLessThan(BRAND_LOCKUP_SRC_H);
  });
});

// ===========================================================================
// ★★★ §2 — and the border across the top of the screen stays ONE line
// ===========================================================================

describe('fix-345 §2: the ribbon and the header grew together', () => {
  // ★★★ THE CONSTRAINT THAT MADE THIS MORE THAN A FONT SIZE. Ribbon's brand
  // block is the same height as the header ON PURPOSE, so their bottom borders
  // form a single rule across the top of the screen — fix-325's reasoning,
  // re-derived by fix-322 after trying the alternative. Grow one alone and the
  // line breaks.
  it('★★★ the brand block and the header are the same height', () => {
    renderShell();
    const header = screen.getByTestId('chrome-header');
    const brand = screen.getByTestId('ribbon-brand');
    expect(header.style.height).toBe(brand.style.height);
    expect(header.style.height).toBe(SHELL_HEADER_HEIGHT + 'px');
  });

  // ★★ AND THEY CANNOT DRIFT. It was the literal 56 written twice in two files,
  // which survived three tickets only because nobody changed it. One constant
  // now, imported by both — so this holds at whatever height it is set to,
  // which is the version that survives the next resize.
  it('★★ neither file holds its own opinion about the number', () => {
    expect(chromeSrc).toContain('SHELL_HEADER_HEIGHT');
    expect(ribbonSrc).toContain('SHELL_HEADER_HEIGHT');
    expect(chromeSrc).not.toMatch(/height:\s*56\b/);
    expect(ribbonSrc).not.toMatch(/height:\s*56\b/);
  });

  it('it is taller than it was, because 56 could not hold 2x', () => {
    expect(SHELL_HEADER_HEIGHT).toBeGreaterThan(56);
    // ★ …and the lockup still fits inside it with air, which is the whole
    // reason the bar had to grow rather than the lockup being squeezed.
    //
    // ★★ fix-351 makes this precise rather than approximate. What has to fit
    // ABOVE the border is the artwork down to its own rule — 97.54% of the
    // height — and the remainder deliberately hangs below, which is how the
    // rule meets the border at all.
    const aboveTheRule =
      BRAND_LOCKUP_HEIGHT * (BRAND_LOCKUP_RULE_ROW / BRAND_LOCKUP_SRC_H);
    expect(aboveTheRule).toBeLessThan(SHELL_HEADER_HEIGHT);
    // And it is not rattling around in there either — the bar is sized for it.
    expect(aboveTheRule).toBeGreaterThan(SHELL_HEADER_HEIGHT * 0.8);
    expect(BRAND_LOCKUP_DROP).toBeGreaterThan(0);
  });

  it('the collapsed rail keeps the same block height too', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(screen.getByTestId('ribbon-brand').style.height).toBe(
      SHELL_HEADER_HEIGHT + 'px',
    );
  });

  // ★ The Blueprint lockup did NOT grow with the block. 144px is the artwork
  // (fix-335 §1 decoded the file), so anything larger upscales the one mark in
  // the app already at its ceiling. A taller block with a 1:1 logo beats an
  // exactly-filled block with a soft one.
  it('★ the ribbon logo stayed 1:1 rather than being stretched to fill', () => {
    renderRibbon();
    const logo = screen.getByTestId('blueprint-mark') as HTMLImageElement;
    expect(parseFloat(logo.style.width)).toBe(144);
    expect(logo.style.height).toBe('auto');
  });
});

// ===========================================================================
// §4 — SharePoint as an ordinary row, below Reports
// ===========================================================================

describe('fix-345 §4: SharePoint is a row now, under Reports', () => {
  it('★ carries the SAME classes and spacing as a nav row', () => {
    renderRibbon();
    const sp = screen.getByTestId('ribbon-external-sharepoint');
    // Compared against an INACTIVE row: SharePoint can never be active, so an
    // active one would never be the right comparison.
    const myBoard = screen.getByTestId('ribbon-link-/board');
    expect(sp.className).toBe(myBoard.className.replace('relative ', ''));
    expect(sp.getAttribute('style')).toBe(myBoard.getAttribute('style'));
    // Not a chip any more: the bordered-button treatment is gone.
    expect(sp.className).not.toContain('border-border');
    expect(sp.className).not.toContain('justify-center');
  });

  // ★ Uniform in WEIGHT, not indistinguishable. It still leaves the app, so it
  // still says so — in a footnote rather than a box.
  it('★ keeps a small external mark, and the new-tab behaviour', () => {
    renderRibbon();
    expect(screen.getByTestId('ribbon-external-glyph').textContent).toBe('↗');
    const sp = screen.getByTestId('ribbon-external-sharepoint') as HTMLAnchorElement;
    expect(sp.getAttribute('target')).toBe('_blank');
    expect(sp.getAttribute('rel')).toBe('noopener noreferrer');
    expect(sp.getAttribute('href')).toBe(SHAREPOINT_URL);
  });

  it('sits below Reports and above the Settings separator', () => {
    const ids = RIBBON_ENTRIES.map((e) =>
      e.kind === 'link'
        ? e.link.to
        : e.kind === 'external'
          ? e.external.id
          : e.kind === 'group'
            ? e.group.id
            : e.id,
    );
    const i = ids.indexOf('sharepoint');
    expect(ids[i - 1]).toBe('reports');
    expect(ids[i + 1]).toBe('sep-2');
    expect(i).toBeLessThan(ids.indexOf('/settings'));
  });

  it('and renders in that order for a non-admin too', () => {
    authState.role = 'editor';
    renderRibbon();
    const rows = Array.from(
      screen.getByTestId('ribbon-nav').querySelectorAll('a'),
    ).map((a) => a.getAttribute('data-testid'));
    expect(rows).toEqual([
      'ribbon-link-/dashboard',
      'ribbon-link-/draw-schedule',
      'ribbon-link-/board',
      'ribbon-link-/library',
      'ribbon-external-sharepoint',
      // ★ fix-350: a non-admin sees What’s New too — asserted here rather than
      // only in its own suite, because THIS is the list that would have caught
      // it being gated by accident.
      'ribbon-link-/whats-new',
      'ribbon-link-/settings',
    ]);
  });

  // ★★ EVERYTHING STRUCTURAL SURVIVED THE RESTYLE. This is the half of fix-335
  // §4 that must not move: a separate entry kind, with an href and no route.
  it('★★ still something the coverage guard cannot mistake for a route', () => {
    expect(allRibbonExternals().map((e) => e.href)).toEqual([SHAREPOINT_URL]);
    expect(allRibbonRoutes()).not.toContain(SHAREPOINT_URL);
    expect(allRibbonRoutes()).not.toContain('sharepoint');
    expect(ribbonExemptPaths()).not.toContain(SHAREPOINT_URL);
    for (const r of allRibbonRoutes()) expect(r).not.toMatch(/^https?:/);
  });

  it('★★ and still never active, on any route', () => {
    for (const route of [...allRibbonRoutes(), '/settings/account', SHAREPOINT_URL]) {
      expect(activeRibbonTarget(route)).not.toBe(SHAREPOINT_URL);
      expect(activeRibbonTarget(route)).not.toBe('sharepoint');
    }
    renderRibbon();
    expect(
      screen.getByTestId('ribbon-external-sharepoint').getAttribute('data-active'),
    ).toBeNull();
  });

  it('still ungated — 23 of the 29 people in this tenant are editors', () => {
    expect(
      visibleEntries(false).some(
        (e) => e.kind === 'external' && e.external.id === 'sharepoint',
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// ★ fix-335 §5's guard, re-run over the reordered ribbon
// ===========================================================================

describe('fix-345: exactly one ribbon entry is still active', () => {
  function activeEntries(pathname: string): string[] {
    const out: string[] = [];
    for (const e of RIBBON_ENTRIES) {
      if (e.kind === 'link' && isRibbonEntryActive(e.link.to, pathname, e.link.exact)) {
        out.push(e.link.to);
      }
      if (e.kind === 'group') {
        for (const c of e.group.children) {
          if (isRibbonEntryActive(c.to, pathname, c.exact)) out.push(c.to);
        }
      }
    }
    return out;
  }

  // ★ A reorder is exactly the change fix-335 §5 built a PROPERTY for rather
  // than two regression tests: the guard does not care where the rows sit, so
  // it keeps holding without being edited.
  it('★ for every route the ribbon can reach, exactly one entry reports active', () => {
    for (const route of allRibbonRoutes()) {
      expect(activeEntries(route), 'for ' + route).toEqual([route]);
    }
  });

  it('and the Settings sections still light Settings', () => {
    for (const s of ['/settings/account', '/settings/team', '/settings/permits']) {
      expect(activeEntries(s), 'for ' + s).toEqual(['/settings']);
    }
  });
});
