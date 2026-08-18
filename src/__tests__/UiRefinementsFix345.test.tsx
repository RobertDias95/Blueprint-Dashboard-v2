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
  BRAND_LOCKUP_GAP,
  BRAND_MARK_SIZE,
  BRAND_TITLE_SIZE,
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

describe('fix-345 §2: the header reads "the Bridge", much larger', () => {
  it('★ a lowercase t, and the rest of the name untouched', () => {
    renderShell();
    const title = screen.getByTestId('chrome-brand-title');
    expect(title.textContent).toBe('the Bridge');
    // ★ Bobby: "Bridge is fine the way it is spelt." So the capital B stays and
    // only the article changed.
    expect(title.textContent).not.toBe('The Bridge');
    expect(title.textContent).not.toMatch(/THE BRIDGE|the bridge/);
  });

  // ★★ NOT text-transform. A CSS trick would leave the string capitalised in
  // the DOM, in the accessible name a screen reader announces and in the
  // clipboard — three places quietly disagreeing with the screen.
  it('★★ the lowercase is in the string, not painted on with CSS', () => {
    renderShell();
    const title = screen.getByTestId('chrome-brand-title');
    expect(getComputedStyle(title).textTransform).not.toBe('lowercase');
    expect(chromeSrc).toContain('the Bridge');
    expect(chromeSrc).not.toMatch(/textTransform/);
  });

  // ★ Bobby: "we want the logo and Bridge at least 2-3x bigger." fix-335 shipped
  // a 26px mark and 16.5px text; this is 2.5x both, inside the range he named
  // and the largest that still reads as a header rather than a banner.
  it('★★ the mark and the text are 2.5x their fix-335 sizes', () => {
    renderShell();
    const img = screen
      .getByTestId('chrome-brand-center')
      .querySelector('img') as HTMLImageElement;
    expect(parseFloat(img.style.width)).toBe(BRAND_MARK_SIZE);
    expect(BRAND_MARK_SIZE / 26).toBeCloseTo(2.5, 1);

    const title = screen.getByTestId('chrome-brand-title');
    expect(parseFloat(title.style.fontSize)).toBe(BRAND_TITLE_SIZE);
    expect(BRAND_TITLE_SIZE / 16.5).toBeCloseTo(2.5, 1);

    // ★ At least 2x, the floor the brief set. Asserted separately from the exact
    // multiplier so a future retune cannot slip under it unnoticed.
    expect(BRAND_MARK_SIZE).toBeGreaterThanOrEqual(52);
    expect(BRAND_TITLE_SIZE).toBeGreaterThanOrEqual(33);
  });

  it('the gap grew with them, so the two do not crowd each other', () => {
    renderShell();
    expect(screen.getByTestId('chrome-brand-center').style.gap).toBe(
      BRAND_LOCKUP_GAP + 'px',
    );
    expect(BRAND_LOCKUP_GAP).toBeGreaterThan(8);
  });

  // ★ The mark can take it: the source is 256px square, so 65px is still a
  // downscale. The ribbon's Blueprint lockup is the opposite case — 144px IS
  // the artwork (fix-335 §1) — which is why only one of the two grew.
  it('★ the enlarged mark is still the tab icon, and still downscaled', () => {
    renderShell();
    const img = screen
      .getByTestId('chrome-brand-center')
      .querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/bridge-favicon-256/);
    expect(BRAND_MARK_SIZE).toBeLessThan(256);
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
    expect(BRAND_MARK_SIZE).toBeLessThan(SHELL_HEADER_HEIGHT);
    expect(BRAND_TITLE_SIZE).toBeLessThan(SHELL_HEADER_HEIGHT);
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
