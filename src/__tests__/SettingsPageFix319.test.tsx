import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import routerSrc from '../router.tsx?raw';
import {
  DEFAULT_SETTINGS_PATH,
  SETTINGS_SECTIONS,
  sectionForPath,
  visibleSettingsSections,
} from '../lib/settingsSections';
import {
  RIBBON_ENTRIES,
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  allRibbonRoutes,
  ribbonExemptPaths,
} from '../lib/ribbonNav';

// fix-319 (register #76–#77) — Settings is a page, and Phase Durations moved
// into it.
//
//   Bobby: "Technically this belongs in the Settings, in the permit info. Also,
//   Settings should no longer be a pop-up screen — it should just use the
//   screen vs a pop-up."
//
// ★★ THE TRAP THE BRIEF WARNED ABOUT DOES NOT EXIST, and finding that out is
// what made this simple. The brief says the modal's Reporting tab is "a
// DIFFERENT screen from the Reporting hub at the same-looking path", and that
// routing the sections under /settings/:id would collide with the hub fix-317
// routes the whole Reports group through.
//
// They are THE SAME COMPONENT. ReportingHubPage was eighteen lines — a heading
// around <AdminReportingTab /> — and its own comment said "The modal section
// and this page share AdminReportingTab — single source of truth."
//
// So there was nothing to disambiguate: /settings/reporting has always been the
// Settings → Reporting section. No prefix, no moved hub, no renamed id. The
// wrapper page is retired because the Settings page supplies the heading, and
// the ribbon entry keeps working untouched — asserted below, twice.

const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'editor' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: { user: { id: 'u1' } },
      user: { id: 'u1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: authState.role }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../lib/supabase', () => {
  const chain = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: {
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => chain),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
    supabaseUrl: 'http://test.local',
  };
});

// The six section components each drag in their own data layer. Stubbed so
// this suite tests the PAGE — which section renders, who may reach it — rather
// than re-testing six screens that have their own suites.
vi.mock('../components/Settings/AdminAccountTab', () => ({
  default: () => <div data-testid="stub-section-account" />,
}));
vi.mock('../components/Settings/AdminTeamTab', () => ({
  default: () => <div data-testid="stub-section-team" />,
}));
vi.mock('../components/Settings/AdminProjectsTab', () => ({
  default: () => <div data-testid="stub-section-projects" />,
}));
vi.mock('../components/Settings/AdminPermitsTab', () => ({
  default: () => <div data-testid="stub-section-permits" />,
}));
vi.mock('../components/Settings/AdminScheduleTab', () => ({
  default: () => <div data-testid="stub-section-schedule" />,
}));
vi.mock('../components/Settings/AdminReportingTab', () => ({
  default: () => <div data-testid="stub-section-reporting" />,
}));

import SettingsPage from '../pages/SettingsPage';
import Ribbon from '../components/Ribbon';

beforeEach(() => {
  authState.role = 'admin';
  window.localStorage.clear();
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// #76 — a page, not a dialog
// ---------------------------------------------------------------------------

describe('fix-319 #76: Settings is a page', () => {
  it('★★ renders as a page with no dialog anywhere', () => {
    renderAt('/settings/account');
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    // The modal's own markers are gone for good.
    expect(screen.queryByTestId('settings-modal')).toBeNull();
    expect(screen.queryByTestId('settings-modal-overlay')).toBeNull();
    expect(screen.queryByTestId('settings-modal-close')).toBeNull();
    expect(screen.queryByTestId('settings-modal-done')).toBeNull();
  });

  it('★ SettingsModal.tsx is gone from the tree entirely', async () => {
    // Not merely unmounted — removed, so nothing can re-open it by accident.
    const chromeSrc = (await import('../components/Chrome.tsx?raw')).default;
    // The IMPORT and the mount, not the word — the comment above them
    // explains the removal and should be allowed to say the name.
    expect(chromeSrc).not.toContain("import SettingsModal");
    expect(chromeSrc).not.toContain('<SettingsModal');
    expect(chromeSrc).not.toContain('settingsOpen');
  });

  // ★ Each section reachable by URL, and it survives a reload — which is what
  // "a section is part of the URL" has to mean.
  it('★★ every section renders from its own URL', () => {
    for (const s of SETTINGS_SECTIONS) {
      const { unmount } = renderAt(s.path);
      expect(
        screen.getByTestId(`stub-section-${s.id}`),
        `${s.path} must render the ${s.id} section`,
      ).toBeInTheDocument();
      // The rail marks it, so the page agrees with the URL.
      expect(screen.getByTestId(`settings-nav-${s.id}`).dataset.active).toBe('true');
      unmount();
    }
  });

  it('★ and clicking the rail navigates — asserted on the resolved route', () => {
    function Probe() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    const router = createMemoryRouter(
      [{ path: '*', element: (<><SettingsPage /><Probe /></>) }],
      { initialEntries: ['/settings/account'] },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('settings-nav-permits'));
    expect(screen.getByTestId('where').textContent).toBe('/settings/permits');
  });

  it('bare /settings no longer bounces to the dashboard', () => {
    expect(routerSrc).toMatch(
      /path: 'settings', element: <Navigate to="\/settings\/account" replace \/>/,
    );
    expect(DEFAULT_SETTINGS_PATH).toBe('/settings/account');
  });

  it('every section route is STATIC — no dynamic segment to swallow the others', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(routerSrc).toContain(`path: '${s.path.replace(/^\//, '')}'`);
    }
    // A /settings/:id would sit beside /settings/errors and could shadow it.
    expect(routerSrc).not.toContain("path: 'settings/:");
  });
});

// ---------------------------------------------------------------------------
// ★★ The two paths that must not break
// ---------------------------------------------------------------------------

describe('fix-319 ★★ /settings/reporting and /settings/errors still work', () => {
  // ★★★ fix-367 MOVED the shelf out of Settings — "Saved Reports should just be
  // the reporting feature, and then system settings would lose the Reporting
  // tab" — so these two assertions were retargeted rather than deleted. What
  // fix-319 was protecting is that the ADDRESS still resolves and the ribbon
  // still reaches the shelf; both are still true, at /reports/saved.
  it('★★ /settings/reporting still resolves — as a redirect, not a section', () => {
    expect(routerSrc).toContain("path: 'settings/reporting'");
    expect(routerSrc).toMatch(/settings\/reporting[\s\S]{0,200}Navigate to="\/reports\/saved"/);
    // ★ It is no longer a Settings SECTION, which is the half Bobby asked for.
    expect(sectionForPath('/settings/reporting')).toBeNull();
    expect(SETTINGS_SECTIONS.map((s) => s.path)).not.toContain('/settings/reporting');
  });

  it('★★ and the ribbon entry still reaches the shelf, at its new address', () => {
    expect(allRibbonRoutes()).toContain('/reports/saved');
    expect(allRibbonRoutes()).not.toContain('/settings/reporting');
    const reports = RIBBON_ENTRIES.find((e) => e.kind === 'group' && e.group.id === 'reports');
    const kids = reports!.kind === 'group' ? reports!.group.children : [];
    // ★ fix-317's decision — the group reads Overview + Saved reports — stands.
    expect(kids.find((k) => k.to === '/reports/saved')!.label).toBe('Saved reports');
  });

  it('★★ /settings/errors still reaches error triage, untouched', () => {
    expect(routerSrc).toContain("path: 'settings/errors'");
    expect(routerSrc).toContain('<ErrorsPage />');
    // It is NOT a Settings section, so the page never claims it.
    expect(sectionForPath('/settings/errors')).toBeNull();
    expect(SETTINGS_SECTIONS.map((s) => s.path)).not.toContain('/settings/errors');
  });

  it('the retired wrapper is gone, and nothing still imports it', () => {
    expect(routerSrc).not.toContain("import ReportingHubPage");
    expect(routerSrc).not.toContain('<ReportingHubPage');
  });
});

// ---------------------------------------------------------------------------
// ★ Admin gating — a route is guessable in a way a modal tab was not
// ---------------------------------------------------------------------------

describe('fix-319 ★ admin gating survives the move to URLs', () => {
  it('the flags are exactly the ones the modal had', () => {
    const byId = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s.adminOnly]));
    expect(byId).toEqual({
      account: false,
      team: true,
      projects: true,
      permits: true,
      schedule: true,
      // ★ fix-367: `reporting` is no longer a section. Its admin gate moved to
      // the route (<AdminRoute> on /reports/saved), which is where fix-234 put
      // every other Reports gate.
    });
  });

  it('a non-admin sees only Account in the rail', () => {
    authState.role = 'editor';
    renderAt('/settings/account');
    expect(screen.getByTestId('settings-nav-account')).toBeInTheDocument();
    for (const s of SETTINGS_SECTIONS.filter((x) => x.adminOnly)) {
      expect(screen.queryByTestId(`settings-nav-${s.id}`), s.id).toBeNull();
    }
    expect(visibleSettingsSections(false).map((s) => s.id)).toEqual(['account']);
  });

  // ★ THE ONE THAT MATTERS: typing the URL. Hiding a rail entry is not a gate.
  it('★★ every admin-only section route is wrapped in AdminRoute', () => {
    for (const s of SETTINGS_SECTIONS.filter((x) => x.adminOnly)) {
      const path = s.path.replace(/^\//, '');
      expect(
        routerSrc,
        `${s.path} must be AdminRoute-wrapped — a route is guessable`,
      ).toContain(`path: '${path}', element: <AdminRoute><SettingsPage /></AdminRoute>`);
    }
    // ...and Account deliberately is NOT, so the assertion is not vacuous and
    // a non-admin still has somewhere to land.
    expect(routerSrc).toContain("path: 'settings/account', element: <SettingsPage />");
  });

  it('and the page falls back rather than rendering an admin section to an editor', () => {
    authState.role = 'editor';
    // Even if a non-admin somehow reaches the component at an admin path (a
    // role change mid-session), the body shows Account, not Team.
    renderAt('/settings/team');
    expect(screen.getByTestId('stub-section-account')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-section-team')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #77 — Phase Durations
// ---------------------------------------------------------------------------

describe('fix-319 #77: Phase Durations lives in Settings → Permits', () => {
  it('★ AdminPermitsTab mounts it, unchanged', async () => {
    const src = (await import('../components/Settings/AdminPermitsTab.tsx?raw')).default;
    expect(src).toContain('<PhaseDurationsReport />');
    expect(src).toContain("from '../../pages/PhaseDurationsReport'");
  });

  // ★ The brief asked me to check the relationship rather than stack two
  // panels. It sits directly under the target-submit formulas, with a line
  // saying why: those are the target, this is what happened.
  it('★ and it is placed against the targets it is evidence for', async () => {
    const src = (await import('../components/Settings/AdminPermitsTab.tsx?raw')).default;
    const formulas = src.indexOf('<TargetSubmitFormulasEditor');
    const durations = src.indexOf('<PhaseDurationsReport');
    expect(formulas).toBeGreaterThan(-1);
    expect(durations).toBeGreaterThan(formulas);
    // The connecting copy, not just adjacency.
    expect(src).toContain('phase-durations-context');
    expect(src).toMatch(/target/i);
    // ★ And it points at the OTHER editor these also inform, which the brief
    // expected on this tab but which actually lives on Settings → Schedule.
    expect(src).toMatch(/Settings → Schedule/);
  });

  it('★ /reports/phase-durations REDIRECTS rather than 404ing', () => {
    expect(routerSrc).toContain("path: 'reports/phase-durations'");
    expect(routerSrc).toMatch(/<Navigate to="\/settings\/permits" replace \/>/);
    // The component was not deleted — the tab needs it.
    expect(routerSrc).not.toContain('<PhaseDurationsReport />');
  });

  // ★ fix-331 §8 added Project View between them. fix-319's point — Phase
  // durations is out, the group is not a duplicate shelf — is unchanged.
  it('★★ so the Reports group reads Overview + Project View + Saved reports', () => {
    const reports = RIBBON_ENTRIES.find((e) => e.kind === 'group' && e.group.id === 'reports');
    const kids = reports!.kind === 'group' ? reports!.group.children : [];
    expect(kids.map((k) => k.label)).toEqual([
      'Overview',
      'Project View',
      'Saved reports',
    ]);
    expect(kids.map((k) => k.label)).not.toContain('Phase durations');
  });
});

// ---------------------------------------------------------------------------
// The ribbon + the coverage guard
// ---------------------------------------------------------------------------

describe('fix-319: the ribbon and the guard', () => {
  it('★ Settings is a ribbon LINK now, not a button', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Ribbon onAddProject={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('ribbon-link-/settings')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-settings')).toBeNull();
  });

  function declaredRoutes(src: string): string[] {
    const out: string[] = [];
    const re = /path:\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const p = m[1]!;
      if (p === '*' || p === '/' || p.includes(':')) continue;
      out.push(p.startsWith('/') ? p : `/${p}`);
    }
    return [...new Set(out)];
  }

  it('★ every declared route is in the ribbon or exempt, with a reason', () => {
    const missing = declaredRoutes(routerSrc).filter(
      (r) => !allRibbonRoutes().includes(r) && !ribbonExemptPaths().includes(r),
    );
    expect(missing, `unreachable by clicking: ${missing.join(', ')}`).toEqual([]);
    for (const e of ROUTES_INTENTIONALLY_NOT_IN_RIBBON) {
      expect(e.why.length, e.path).toBeGreaterThan(25);
    }
  });

  // ★ The guard caught a real contradiction while I was building this:
  // /settings was still exempted from when it was a redirect, and it is a
  // ribbon destination now. A path may not be in both lists.
  it('★ /settings is in the ribbon and NOT exempt — the two lists never overlap', () => {
    expect(allRibbonRoutes()).toContain('/settings');
    expect(ribbonExemptPaths()).not.toContain('/settings');
    for (const p of ribbonExemptPaths()) {
      expect(allRibbonRoutes(), `${p} is both exempt and in the ribbon`).not.toContain(p);
    }
  });

  it('the five section deep-links carry reasons naming the page', () => {
    // ★ fix-367: no exception needed any more — `reporting` left the list.
    for (const s of SETTINGS_SECTIONS) {
      const e = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find((x) => x.path === s.path);
      expect(e, `${s.path} must be exempted`).toBeTruthy();
      expect(e!.why).toMatch(/Settings page/);
    }
  });
});

// ---------------------------------------------------------------------------
// The layout contract
// ---------------------------------------------------------------------------

// jsdom has no layout engine, so this asserts OVERFLOW OWNERSHIP, which is the
// contract — not a getBoundingClientRect comparison, which would pass
// vacuously whatever the CSS said.
describe('fix-319: Settings does not scroll the page', () => {
  it('★ the page hides its own overflow and the content panel owns the scroll', () => {
    renderAt('/settings/account');
    const page = screen.getByTestId('settings-page');
    expect(getComputedStyle(page).overflow).toBe('hidden');
    expect(page.className).toContain('h-full');

    const content = screen.getByTestId('settings-content');
    expect(content.className).toContain('overflow-auto');
    expect(content.className).toContain('min-h-0');
    // The rail scrolls independently rather than stretching the page.
    expect(screen.getByTestId('settings-nav').className).toContain('overflow-y-auto');
  });

  it('the rail lists only what the viewer may open', () => {
    renderAt('/settings/account');
    const nav = screen.getByTestId('settings-nav');
    expect(within(nav).getAllByRole('link')).toHaveLength(SETTINGS_SECTIONS.length);
  });
});
