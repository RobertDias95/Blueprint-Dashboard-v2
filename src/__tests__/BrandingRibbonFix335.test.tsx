import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// ★ `?inline` gives the asset back as a base64 data URI, which is how the
// dimension check below reads the real files. node:fs is not an option: this
// project's app tsconfig carries only `vite/client` types, the same reason
// noGuessedSleeps and phaseDurationsReadOnly use `?raw`.
import lockupPng from '../assets/brand/blueprint-logo-lockup.png?inline';
import iconPng from '../assets/brand/blueprint-logo-icon.png?inline';
import originalPng from '../assets/brand/blueprint-original-logo.png?inline';
import ribbonSrc from '../components/Ribbon.tsx?raw';
import chromeSrc from '../components/Chrome.tsx?raw';
import {
  RIBBON_ENTRIES,
  SHAREPOINT_URL,
  activeRibbonTarget,
  allRibbonExternals,
  allRibbonRoutes,
  isLinkActive,
  isRibbonEntryActive,
  ribbonExemptPaths,
  visibleEntries,
} from '../lib/ribbonNav';
import {
  BLUEPRINT_ICON_SIZE,
  BLUEPRINT_LOCKUP_WIDTH,
} from '../components/BlueprintMark';
// ★ fix-345 §2 grew the header and the ribbon's brand block together. They read
// ONE constant now, so this suite reads it too rather than restating a number
// that is allowed to change.
import { SHELL_HEADER_HEIGHT } from '../lib/shellMetrics';

// fix-335 — branding, the ribbon, and the things that should tie back.
//
// Nine display changes, no migration, no business logic. What is asserted here
// is the four that carry a real risk of quietly regressing: the artwork's
// dimensions (§1), the centred header (§2), the SharePoint gate that must NOT
// exist (§4), and — the one that has now been wrong four tickets running — how
// many ribbon entries may claim to be the page you are on (§5).

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
// §1 — the original Blueprint logo
// ===========================================================================

/** Width and height straight out of a PNG's IHDR chunk — bytes 16..24 of the
 *  file, fixed by the format, so this needs no image library. Reading the REAL
 *  files is the point: it makes "rendered 1:1" a fact about the artwork rather
 *  than two numbers agreeing with each other. */
function pngSize(dataUri: string, name: string): { w: number; h: number } {
  expect(dataUri.startsWith('data:image/png;base64,'), `${name} is not a PNG`).toBe(true);
  const bin = atob(dataUri.slice('data:image/png;base64,'.length));
  const at = (i: number) =>
    (bin.charCodeAt(i) << 24) |
    (bin.charCodeAt(i + 1) << 16) |
    (bin.charCodeAt(i + 2) << 8) |
    bin.charCodeAt(i + 3);
  expect(bin.slice(1, 4)).toBe('PNG');
  return { w: at(16), h: at(20) };
}

describe('fix-335 §1: the ribbon carries the original Blueprint logo', () => {
  it('the expanded ribbon renders the Blueprint lockup, not the Bridge illustration', () => {
    renderRibbon();
    const img = screen.getByTestId('blueprint-mark') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/blueprint-logo-lockup/);
    expect(img.dataset.logoVariant).toBe('lockup');
    // ★ The Bridge artwork is not merely resized here — it is not in the ribbon
    // at all. It moved to the header (§2).
    expect(screen.getByTestId('ribbon').innerHTML).not.toMatch(/bridge-logo/);
  });

  it('the collapsed rail renders the roundel, square', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    const img = screen.getByTestId('blueprint-mark') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/blueprint-logo-icon/);
    expect(parseFloat(img.style.width)).toBe(parseFloat(img.style.height));
    expect(parseFloat(img.style.width)).toBeLessThanOrEqual(56 - 8);
  });

  // ★★ THE PROPORTION CHECK THE BRIEF ASKED FOR, done against the files rather
  // than against an assumption. Both crops render at EXACTLY their native size,
  // so neither is ever upscaled — which is the sharpest this artwork can be.
  it('★★ both variants render 1:1 — the artwork is never upscaled', () => {
    const lockup = pngSize(lockupPng, 'lockup');
    const icon = pngSize(iconPng, 'icon');
    expect(BLUEPRINT_LOCKUP_WIDTH).toBe(lockup.w);
    expect(BLUEPRINT_ICON_SIZE).toBe(icon.w);
    expect(icon.w).toBe(icon.h); // a circle in a square box

    renderRibbon();
    expect(parseFloat((screen.getByTestId('blueprint-mark') as HTMLImageElement).style.width))
      .toBe(lockup.w);
  });

  // ★★ AND THE CROP IS WHY IT FITS. Bobby's file is 200x57 with the mark
  // occupying only 144x28 of it, plus a captured grey rule on the last row —
  // see BlueprintMark. Rendering the raw canvas at the ribbon's width would
  // have drawn a mark three-quarters the size, floating, above a second border
  // line. The source file is kept beside the crops, unmodified, so the
  // derivation stays checkable.
  it('★★ the supplied original is kept unmodified, and the crops come from it', () => {
    expect(pngSize(originalPng, 'original')).toEqual({ w: 200, h: 57 });
    const lockup = pngSize(lockupPng, 'lockup');
    expect(lockup.w).toBeLessThan(200);
    expect(lockup.h).toBeLessThan(57);
  });

  // ★ 144 in a 212px ribbon with 16px of padding either side. fix-325's 212 was
  // set by the longest nav label and the foot row, NOT by the logo, so the new
  // mark did not move the ribbon and must not.
  it('★ fits inside the ribbon, and the ribbon did not move to accommodate it', () => {
    renderRibbon();
    const img = screen.getByTestId('blueprint-mark') as HTMLImageElement;
    expect(parseFloat(img.style.width)).toBeLessThanOrEqual(212 - 32);
    expect(img.style.height).toBe('auto');
    expect(screen.getByTestId('ribbon').style.width).toBe('212px');
    // ★ fix-345 §2: the block is 80px now, and its height is no longer this
    // file's business — see the border-alignment test below, which is the rule
    // the number was ever standing in for.
    expect(screen.getByTestId('ribbon-brand').style.height).toBe(
      `${SHELL_HEADER_HEIGHT}px`,
    );
  });

  it('★ has a text alternative — the ribbon has no words left to speak', () => {
    renderRibbon();
    expect(screen.getByTestId('blueprint-mark').getAttribute('alt')).toBe('Blueprint');
  });
});

// ===========================================================================
// §2 — "The Bridge" moves into the white header, centred
// ===========================================================================

describe('fix-335 §2: the product name is centred in the white header', () => {
  it('the ribbon has lost the wordmark entirely, not merely hidden it', () => {
    renderRibbon();
    expect(screen.queryByTestId('ribbon-wordmark')).toBeNull();
    expect(screen.queryByTestId('ribbon-wordmark-row')).toBeNull();
    expect(screen.getByTestId('ribbon').textContent).not.toMatch(/The Bridge/);
    // Gone from the source too — no switched-off second renderer to find later.
    expect(ribbonSrc).not.toContain('ribbon-wordmark');
  });

  // ★★★ fix-351 — THE MARK AND THE WORDS ARE ONE IMAGE NOW.
  //
  // Bobby's instruction was "in the center of all the screens in that white
  // area, it's going to read logo, The Bridge", and this asserted it as two
  // elements in that order because that is what the header assembled. His new
  // artwork IS that lockup — bridge, the words, and the two rules — so the
  // order is inside the file and there is nothing left for the app to order.
  //
  // ★ THE SENTENCE THAT CHANGED: "the tab icon, then the words" became "one
  // image carrying both". What did NOT change is that the centre of the white
  // bar reads logo-then-name on every screen, which the next test still proves.
  //
  // ★★ The words did not leave the accessible tree. They moved from a <span>
  // into the image's alt text, which is the only place they can live once the
  // artwork carries them — asserted here, because "it renders a picture" would
  // pass while a screen reader heard nothing.
  it('the header reads: one lockup carrying the mark and the name', () => {
    renderShell();
    const centre = screen.getByTestId('chrome-brand-center');
    const img = centre.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/bridge-logo-2026/);
    expect(img.dataset.logoVariant).toBe('lockup');
    expect(img.getAttribute('alt')).toMatch(/The Bridge/);
    // ★ And nothing renders the name a second time underneath the picture.
    expect(screen.queryByTestId('chrome-brand-title')).toBeNull();
    expect(centre.children).toHaveLength(1);
    expect(centre.firstElementChild).toBe(img);
  });

  // ★★ On EVERY top-level screen, which is the part of the instruction most
  // easily half-delivered. It is in the shell's header, so it cannot be
  // per-page — and this proves that rather than assuming it.
  it('★★ on every top-level screen', () => {
    for (const route of ['/dashboard', '/draw-schedule', '/board', '/projects', '/library']) {
      const view = renderShell(route);
      // ★ fix-351: the name is in the artwork, so the thing to look for is the
      // lockup's alt text rather than a <span>'s textContent. Same claim.
      const img = screen
        .getByTestId('chrome-brand-center')
        .querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('alt'), `missing on ${route}`).toMatch(/The Bridge/);
      view.unmount();
    }
  });

  // ★★ CENTRED AGAINST THE BAR, NOT AGAINST THE FLEX REMAINDER. In the flow it
  // would shift as the signed-in person's name changed length, so it would sit
  // in a different place on two people's screens.
  it('★★ is pinned to the middle and cannot drift with the user chip', () => {
    renderShell();
    const centre = screen.getByTestId('chrome-brand-center');
    expect(centre.className).toContain('absolute');
    expect(centre.style.left).toBe('50%');
    expect(centre.style.transform).toBe('translateX(-50%)');
    // Out of the flow entirely: it is not one of the header's flex children in
    // any way the bell or the chip can push around.
    expect(centre.className).toContain('pointer-events-none');
  });

  // ★★ THE COLLISION CHECK, and it found one — at a width nobody works at.
  // Because the block is absolute, the bell and the chip cannot make room for
  // it; rendered and measured at real widths, the two clear each other by
  // ~150px at 1280 and ~25px at 1024, and start to touch below about 980. So
  // it drops out under `lg` rather than letting a bell cross the last letters
  // of the name. jsdom has no layout engine, so this asserts the RULE — the
  // measurement is in the PR, per the same honesty fix-325 used for its width.
  // ★ fix-345 §2 made the lockup 2.5x wider, so the floor moved with it: 129px
  // of clearance at 1280 reaches zero at about 1022px, which is within a pixel
  // of `lg`. The breakpoint went up to `xl` and the measurements are in the PR.
  it('★★ it yields rather than colliding on a window too narrow for both', () => {
    renderShell();
    const centre = screen.getByTestId('chrome-brand-center');
    expect(centre.className).toContain('hidden');
    expect(centre.className).toContain('xl:flex');
    expect(centre.className).not.toContain('lg:flex');
  });

  // ★ THE CENTRE WAS FREE, verified rather than assumed. fix-331 §5 deleted the
  // search bar and §7 the initials circle; page titles like "Project Overview"
  // are page-level headers inside <main>, not in this bar.
  it('★ nothing else occupies the centre of the bar', () => {
    renderShell();
    const header = screen.getByTestId('chrome-header');
    expect(screen.queryByTestId('chrome-search')).toBeNull();
    // The header's own children are: the centred lockup (absolute), the flex
    // spacer, the bell and the user chip. Nothing else.
    expect(header.children).toHaveLength(4);
    expect(screen.getByTestId('board-bell-button')).toBeInTheDocument();
    expect(screen.getByTestId('chrome-user-chip')).toBeInTheDocument();
    // ★ The page's own content is in <main>, a different box — so a page
    // heading cannot collide with this no matter what it says.
    expect(screen.getByTestId('bridge-pane').contains(
      screen.getByTestId('chrome-brand-center'),
    )).toBe(false);
  });

  // ★★★ fix-351 — fix-320's contract is now DISCHARGED BY THE ASSET.
  //
  // It asserted three things about a styled <span>: navy #1d3f6e, weight >= 700,
  // and never shouted caps. There is no <span>; Bobby's artwork carries the
  // words, and its rules are rgb(79, 99, 177), not #1d3f6e.
  //
  // ★ THE RULE THAT SURVIVES is the one underneath those three: the app does not
  // get to restyle the brand. It is stronger now than a constant could make it —
  // the name is pixels in a referenced file, so no theme token, no font weight
  // and no text-transform in this codebase can reach it. That is what this
  // asserts; DisplayPolishFix320 asserts the absence of the constant.
  it('★ fix-320\'s wordmark treatment is the artwork\'s now, not the CSS\'s', () => {
    renderShell();
    const centre = screen.getByTestId('chrome-brand-center');
    // Nothing in the brand block is text the app styles.
    expect(centre.textContent).toBe('');
    expect(centre.querySelector('span')).toBeNull();
    const img = centre.querySelector('img') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    // ★ And it is a REFERENCED image, never a drawing — fix-322's rule, on the
    // one element that now carries the entire wordmark.
    expect(centre.querySelector('svg')).toBeNull();
    expect(centre.innerHTML).not.toMatch(/<path|viewBox/);
    // ★ And not merely unmounted: the styled <span> is gone from the source, so
    // the next person finds one place that renders the product's name rather
    // than two with one of them switched off.
    expect(chromeSrc).not.toContain('chrome-brand-title');
  });
});

// ===========================================================================
// §3 — Library stands alone
// ===========================================================================

describe('fix-335 §3: Library is its own column', () => {
  it('is a top-level entry, and the Entitlements group is gone', () => {
    expect(
      RIBBON_ENTRIES.some((e) => e.kind === 'link' && e.link.to === '/library'),
    ).toBe(true);
    expect(
      RIBBON_ENTRIES.some((e) => e.kind === 'group' && e.group.id === 'entitlements'),
    ).toBe(false);
  });

  it('★ nothing became unreachable — the coverage guard still passes', () => {
    expect(allRibbonRoutes()).toContain('/library');
    // Not exempted instead of listed: it is a real, clickable entry.
    expect(ribbonExemptPaths()).not.toContain('/library');
  });

  it('renders as a top-level row with no expander', () => {
    renderRibbon();
    expect(screen.getByTestId('ribbon-link-/library')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-group-entitlements')).toBeNull();
    expect(screen.queryByTestId('ribbon-group-toggle-entitlements')).toBeNull();
  });

  it('a non-admin sees it too — it never was admin-gated', () => {
    authState.role = 'editor';
    renderRibbon();
    expect(screen.getByTestId('ribbon-link-/library')).toBeInTheDocument();
  });
});

// ===========================================================================
// §4 — a SharePoint button, for everyone
// ===========================================================================

describe('fix-335 §4: SharePoint, ungated and outside the app', () => {
  it('points at the exact site', () => {
    renderRibbon();
    const a = screen.getByTestId('ribbon-external-sharepoint') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(SHAREPOINT_URL);
    expect(SHAREPOINT_URL).toBe(
      'https://blueprintcap.sharepoint.com/sites/BlueprintDesignandEntitlementsStudio',
    );
  });

  it('★ opens in a new tab, without handing it a window.opener', () => {
    renderRibbon();
    const a = screen.getByTestId('ribbon-external-sharepoint') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  // ★★ THE ASSERTION THAT MATTERS. "this is accessible by everyone" — and 23 of
  // the 29 people in this tenant are editors, so a gate here would withhold the
  // studio's document site from almost the whole company.
  it('★★ a non-admin sees it', () => {
    authState.role = 'editor';
    renderRibbon();
    expect(screen.getByTestId('ribbon-external-sharepoint')).toBeInTheDocument();
    // And in the model, not just this render.
    const visible = visibleEntries(false);
    expect(visible.some((e) => e.kind === 'external' && e.external.id === 'sharepoint'))
      .toBe(true);
  });

  // ★★ fix-345 §4 INVERTED THE APPEARANCE HALF OF THIS. fix-335 built it as a
  // bordered chip so a control leaving the app would not read as a destination
  // inside it; Bobby has used it — "sticks out. Maybe it is just another word
  // like the other options so it is more uniform" — and he is right that a chip
  // in a column of eight text rows makes the loudest thing in the ribbon the one
  // nobody uses daily. It is a row now, with a small ↗ carrying the difference.
  //
  // ★ WHAT DID NOT INVERT is the half that mattered: it still can never be
  // "where you are". That is asserted here and again in the §5 guard.
  it('★ reads as a button, not as a nav destination', () => {
    renderRibbon();
    const a = screen.getByTestId('ribbon-external-sharepoint');
    // Uniform with the nav rows — literally the same classes, because Ribbon
    // calls itemClass()/itemStyle() rather than copying them. Compared against
    // an INACTIVE row: SharePoint can never be active, so an active one would
    // never be the right comparison. (This render is on /dashboard, so My Board
    // is the inactive neighbour.)
    const myBoard = screen.getByTestId('ribbon-link-/board');
    expect(a.className).toBe(myBoard.className.replace('relative ', ''));
    expect(a.getAttribute('style')).toBe(myBoard.getAttribute('style'));
    // ...but still visibly leaving.
    expect(screen.getByTestId('ribbon-external-glyph').textContent).toBe('↗');
    // It can never be "where you are": there is no active state to acquire.
    expect(a.getAttribute('data-active')).toBeNull();
    expect(a.dataset.external).toBe('true');
  });

  // ★★ THE ROUTE-COVERAGE EXEMPTION, AND IT IS STRUCTURAL. An external entry
  // carries an href and no `to`, so allRibbonRoutes() cannot see it — there is
  // no exemption row to write and none to forget. That is a stronger guarantee
  // than the list, and it is why §4 did not add one.
  it('★★ the coverage guard cannot mistake it for a route', () => {
    expect(allRibbonExternals().map((e) => e.href)).toEqual([SHAREPOINT_URL]);
    for (const route of allRibbonRoutes()) {
      expect(route.startsWith('/'), `${route} is not an app route`).toBe(true);
      expect(route).not.toMatch(/^https?:/);
    }
    expect(allRibbonRoutes()).not.toContain(SHAREPOINT_URL);
    // Not smuggled into the exemption list either — it is not a route at all.
    expect(ribbonExemptPaths()).not.toContain(SHAREPOINT_URL);
  });

  // ★ fix-345 §4 moved it up a tier — Bobby: "Maybe below reports?" — so the
  // content tier ends with it and the tier below the rule is the two
  // administrative entries again.
  it('sits in the bottom tier, after Settings', () => {
    const ids = RIBBON_ENTRIES.map((e) =>
      e.kind === 'link'
        ? e.link.to
        : e.kind === 'external'
          ? e.external.id
          : e.kind === 'group'
            ? e.group.id
            : e.id,
    );
    expect(ids.indexOf('sharepoint')).toBeGreaterThan(ids.indexOf('reports'));
    expect(ids.indexOf('sharepoint')).toBeLessThan(ids.indexOf('/settings'));
    // The last thing before the rule, so the reading order is: everywhere you
    // go, then the separator, then Settings.
    expect(ids[ids.indexOf('sharepoint') + 1]).toBe('sep-2');
  });
});

// ===========================================================================
// ★★★ §5 — at most ONE entry may claim to be the current page
// ===========================================================================

/** Every entry that reports itself active for this path. */
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

/** The same question asked the OLD way — prefix matching alone, which is what
 *  shipped. Used below to prove the defect was real. */
function activeEntriesOldWay(pathname: string): string[] {
  const out: string[] = [];
  for (const e of RIBBON_ENTRIES) {
    if (e.kind === 'link' && isLinkActive(e.link.to, pathname, e.link.exact)) {
      out.push(e.link.to);
    }
    if (e.kind === 'group') {
      for (const c of e.group.children) {
        if (isLinkActive(c.to, pathname, c.exact)) out.push(c.to);
      }
    }
  }
  return out;
}

describe('fix-335 §5: exactly one ribbon entry is active', () => {
  // ★★★ THE PROPERTY, over the whole ribbon rather than the two routes that
  // were reported. This is the fourth pass over the ribbon's active state; a
  // per-entry flag is what failed the previous three, so the guard is stated
  // once and holds for every entry that exists or is added.
  it('★★★ for EVERY route the ribbon can reach, exactly one entry reports active', () => {
    for (const route of allRibbonRoutes()) {
      expect(activeEntries(route), `for ${route}`).toEqual([route]);
    }
  });

  it('★★ /settings/errors — the one Bobby reported', () => {
    expect(activeEntriesOldWay('/settings/errors')).toEqual([
      '/settings',
      '/settings/errors',
    ]);
    expect(activeEntries('/settings/errors')).toEqual(['/settings/errors']);
  });

  // ★★ THE SECOND CASE, which nobody had reported. Settings was the parent of
  // TWO ribbon entries, so the same defect was live on Saved reports.
  //
  // ★★ fix-367 MOVED Saved reports out of Settings — it was never a setting —
  // to /reports/saved. The case it demonstrates is UNCHANGED, because the entry
  // is still the child of a parent entry: /reports owns the prefix, and only
  // the longest match may light. Retargeted rather than deleted, since what it
  // proves is the rule, not the address.
  it('★★ /reports/saved — the same entry, and its new home has no hazard', () => {
    // ★★ AND THE MOVE IMPROVED IT, which is worth recording. At its old
    // address this case needed the specificity tie-break: /settings claimed
    // /settings/reporting and both lit. Under /reports it does not, because
    // fix-315 marked the Overview entry `exact: true` so the parent never
    // claims a child at all — so even the OLD way lights exactly one.
    expect(activeEntriesOldWay('/reports/saved')).toEqual(['/reports/saved']);
    expect(activeEntries('/reports/saved')).toEqual(['/reports/saved']);
    // ★ /settings/errors above is still the case that needs specificity, so the
    // rule this file exists to prove is still demonstrated by a live example.
  });

  // ★★★ AND THE REASON `exact: true` ON SETTINGS WAS NOT THE ANSWER. It fixes
  // the two entries above by making /settings claim nothing but itself — and
  // /settings is ALSO the parent of five non-ribbon deep links reached from the
  // Settings rail. Under `exact` every one of those lights up nothing at all,
  // and the ribbon says "you are nowhere" on five real screens. Specificity
  // fixes both cases and breaks neither.
  it('★★★ and the Settings sections still light Settings', () => {
    for (const section of [
      '/settings/account',
      '/settings/team',
      '/settings/projects',
      '/settings/permits',
      '/settings/schedule',
    ]) {
      expect(activeEntries(section), `for ${section}`).toEqual(['/settings']);
      // Which is what `exact: true` would have destroyed.
      expect(isLinkActive('/settings', section, true)).toBe(false);
    }
  });

  // ★ fix-315's flag still does something specificity cannot: /reports' seven
  // children are not ribbon entries, so without `exact` the Overview entry
  // would light up while you read Corrections. Both mechanisms are needed.
  it('★ fix-315\'s `exact` still holds for /reports', () => {
    expect(activeEntries('/reports')).toEqual(['/reports']);
    expect(activeEntries('/reports/corrections')).toEqual([]);
    expect(activeRibbonTarget('/reports/corrections')).toBeNull();
  });

  it('the rendered ribbon agrees — one highlight, on the right row', () => {
    renderRibbon('/settings/errors');
    expect(screen.getByTestId('ribbon-link-/settings/errors').dataset.active).toBe('true');
    expect(screen.getByTestId('ribbon-link-/settings').dataset.active).toBe('false');
    const lit = Array.from(
      screen.getByTestId('ribbon-nav').querySelectorAll('[data-active="true"]'),
    );
    expect(lit).toHaveLength(1);
  });

  // ★ A group still shows it contains the active route when collapsed — the
  // "you are nowhere" fix from fix-313 #60 — and it resolves the same way, so a
  // group cannot light up for a path a more specific entry owns.
  it('a collapsed group still carries the state, and only the right one', () => {
    // ★ fix-367: Saved reports is /reports/saved now. Still inside the Reports
    // group, so the group still reports containing the active route — and
    // /settings, which used to be its parent, no longer has any claim at all.
    renderRibbon('/reports/saved');
    expect(screen.getByTestId('ribbon-group-reports').dataset.containsActive).toBe('true');
    expect(screen.getByTestId('ribbon-link-/settings').dataset.active).toBe('false');
    expect(screen.getByTestId('ribbon-link-/library').dataset.active).toBe('false');
  });

  // ★★ PROVE THE GUARD BITES. A test that would pass whatever the code did is
  // worse than none, and this ticket exists because the previous mechanism
  // silently stopped covering a new entry.
  it('★★ and the property FAILS if an entry stops resolving by specificity', () => {
    // Simulate the pre-fix behaviour on the route that started this: two
    // entries, one page. If isRibbonEntryActive ever degrades to isLinkActive,
    // the property test above turns red on exactly this input.
    expect(activeEntriesOldWay('/settings/errors').length).toBe(2);
    expect(activeEntries('/settings/errors').length).toBe(1);
  });
});
