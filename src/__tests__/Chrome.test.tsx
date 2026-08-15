import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Q2: Chrome nav lock test.
// Q9.5.a: rewritten for v1-parity top-nav — logo=home + 4 tabs + gear.
//
// ★ fix-313 RETARGETED THIS FILE to the Blueprint Bridge shell. The top tab bar
// and the logo-as-home-button are GONE, replaced by the left ribbon; the gear
// moved into the ribbon; the top bar now carries search, the bells and the user
// chip. Every contract this file protected is still asserted — it just moved:
//   * ONE bell (fix-298 Phase 2)             — unchanged, still here
//   * the error-triage badge is not a bell    — unchanged
//   * Reports is admin-only (fix-234)         — now the whole ribbon GROUP
//   * no Trends entry (fix-trends-subtab)     — now a ribbon label check
//   * no "Settings" LINK, it is a button      — still true, in the ribbon
//   * "Draw Schedule" survived fix-310        — still asserted
//   * no inline Sign Out                      — unchanged
// What is gone is asserted GONE rather than dropped from the file, because
// "the tab bar was removed" is itself a contract now.

// fix-27: extended to cover supabase.rpc and supabase.channel so the
// NotificationBell mounted by Chrome doesn't blow up. The bell's
// underlying useScraperActivity hook hits both.
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

// fix-234: role is configurable per test so we can assert the admin-only
// Reports tab appears for admins and is hidden for editors.
const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'editor' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: authState.role }],
      activeTenantId: 'test-tenant',
      setSession: vi.fn(),
      setInitialized: vi.fn(),
    }),
}));

// SettingsModal pulls in the Admin*Tab tree which pulls in lots of
// data hooks. Stub it for the Chrome-level structural tests; the modal
// itself gets its own component tests later.
// ★ fix-319 #76: SettingsModal.tsx was DELETED — Settings is a page now, so
// there is no dialog to stub.

// fix-313 #61: Chrome mounts the wizard now (the ribbon opens it), and the real
// one drags in the whole four-step tree. Stubbed the same way as the modal.
vi.mock('../components/NewProjectWizard', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="wizard-stub">wizard open</div> : null,
}));

import Chrome from '../components/Chrome';

describe('<Chrome /> fix-313 the Blueprint Bridge shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
  });

  function renderIt() {
    // fix-27: Chrome now mounts NotificationBell, which uses TanStack
    // Query — so the test tree needs a QueryClientProvider.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Chrome />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** Every ribbon entry label, in render order. Children of a closed group are
   *  not rendered, so this is the top level plus whatever is open.
   *  Read from `title` rather than textContent, because textContent also picks
   *  up the collapsed-ribbon icon glyph. */
  function ribbonLabels(): (string | null)[] {
    const nav = screen.getByTestId('ribbon-nav');
    return Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('title'));
  }

  it('renders the ribbon entries in the mockup order', () => {
    renderIt();
    // ★ fix-319 #76: Settings joined the top level as a LINK. It was a button
    // that opened a dialog; it is a page at /settings now.
    expect(ribbonLabels()).toEqual([
      'Pipeline',
      'My Board',
      'Project View',
      'Settings',
    ]);

    // ★ fix-310 renamed the DD-PHASE vocabulary from Draw to DD across ~14
    // surfaces. The Draw SCHEDULE is a different concept and keeps its name.
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-entitlements'));
    const withEnt = ribbonLabels();
    expect(withEnt).toContain('Draw Schedule');
    expect(withEnt.some((l) => l === 'DD Schedule')).toBe(false);
    expect(withEnt).toContain('Library');
    expect(withEnt).toContain('Activity');
  });

  // ★ #59: the top tab bar and the logo-home-button are GONE.
  it('★ renders no top tab bar and no logo home button', () => {
    renderIt();
    expect(screen.queryByTestId('chrome-nav')).toBeNull();
    expect(screen.queryByTestId('chrome-home')).toBeNull();
    expect(screen.queryByTestId('chrome-settings-gear')).toBeNull();
  });

  // ★ #59: search is new furniture and there is nothing to wire it to.
  it('★ renders search DISABLED with a coming-soon affordance, not a dead control', () => {
    renderIt();
    const search = screen.getByTestId('chrome-search');
    expect(search.dataset.disabled).toBe('true');
    expect(search.getAttribute('aria-disabled')).toBe('true');
    expect(search.textContent).toMatch(/coming soon/i);
    // It is not an input, so it cannot be typed into and look alive.
    expect(search.querySelector('input')).toBeNull();
  });

  it('keeps the user chip in the top bar', () => {
    renderIt();
    expect(screen.getByTestId('chrome-user-chip')).toBeInTheDocument();
  });

  // fix-298 Phase 2: ONE bell.
  it('★ renders exactly one bell — the board bell', () => {
    renderIt();
    expect(screen.getByTestId('board-bell-button')).toBeTruthy();
    // The scraper-activity bell (fix-27/28) is gone from the nav: same icon,
    // different meaning, and its content is now an oversight-only section on
    // the board. The /activity ROUTE is untouched.
    expect(screen.queryByTestId('notification-bell-button')).toBeNull();
  });

  it('the error-triage badge is NOT a bell and stays', () => {
    // Different icon (warning triangle) and a different question, so it was
    // never part of the two-bells problem.
    renderIt();
    expect(screen.getByTestId('error-triage-button')).toBeTruthy();
  });

  // fix-234, now applied to the whole ribbon GROUP.
  it('an admin sees the Reports group', () => {
    authState.role = 'admin';
    renderIt();
    expect(screen.getByTestId('ribbon-group-reports')).toBeInTheDocument();
  });

  it('★ a non-admin sees NO Reports group at all — not an empty one', () => {
    authState.role = 'editor';
    renderIt();
    expect(screen.queryByTestId('ribbon-group-reports')).toBeNull();
    // Not merely collapsed: none of the seven report routes is reachable.
    expect(screen.queryByTestId('ribbon-link-/reports/weekly-da')).toBeNull();
    expect(screen.queryByTestId('ribbon-link-/settings/reporting')).toBeNull();

    // Everything else still renders. fix-297: ★ Library is NOT admin-gated,
    // matching Draw Schedule — it has been reachable by everyone for as long
    // as it has existed. fix-298: neither is My Board.
    expect(ribbonLabels()).toEqual([
      'Pipeline',
      'My Board',
      'Project View',
      'Settings',
    ]);
    expect(screen.getByTestId('ribbon-group-entitlements')).toBeInTheDocument();
  });

  it('does NOT render a Trends entry (fix-trends-subtab)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(ribbonLabels()).not.toContain('Trends');
  });

  // ★ fix-313 #62: My Tasks is no longer a destination.
  it('★ renders no My Tasks entry — it merged into My Board', () => {
    renderIt();
    expect(ribbonLabels()).not.toContain('My Tasks');
    expect(screen.queryByTestId('ribbon-link-/my-tasks')).toBeNull();
  });

  // ★ fix-313 #63: the landing page is Pipeline. The ROUTE is unchanged.
  it('★ the landing entry reads Pipeline and still points at /dashboard', () => {
    renderIt();
    const pipeline = screen.getByTestId('ribbon-link-/dashboard');
    expect(pipeline.textContent).toMatch(/Pipeline/);
    expect(ribbonLabels()).not.toContain('Dashboard');
  });

  it('does NOT render a "Settings" nav tab (gear button opens the modal instead)', () => {
    renderIt();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).not.toContain('Settings');
  });

  // ★ #64: the brand mark and wordmark, top of the ribbon.
  it('renders the Blueprint Bridge mark and wordmark', () => {
    renderIt();
    // ★ fix-322: the brand block holds the real 4:1 logo and nothing else; the
    // wordmark sits in its own row under it, so this reads the ribbon.
    const brand = screen.getByTestId('ribbon');
    expect(brand.textContent).toMatch(/BLUEPRINT/);
    // ★ fix-320 #73: title case, not all caps — "maybe it doesn't need to be
    // all caps". The product name is the hero line now, so it is asserted as
    // the word it actually reads, capitals and all.
    expect(brand.textContent).toMatch(/The Bridge/);
    expect(brand.textContent).not.toMatch(/THE BRIDGE/);
    expect(screen.getByTestId('bridge-mark')).toBeInTheDocument();
  });

  // ★ fix-319 #76: Settings stopped being a modal. The contract inverts —
  // no dialog, and the ribbon entry navigates.
  it('★ Settings is a PAGE now — no modal is mounted at all', () => {
    renderIt();
    expect(screen.queryByTestId('ribbon-settings')).toBeNull();
    expect(screen.queryByTestId('settings-modal-stub')).toBeNull();
    expect(screen.getByTestId('ribbon-link-/settings')).toBeInTheDocument();
  });

  // ★ #61: one entry point to the wizard, in the ribbon, on every screen.
  it('★ Add a Project opens the wizard from the ribbon', () => {
    renderIt();
    expect(screen.queryByTestId('wizard-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('ribbon-add-project'));
    expect(screen.getByTestId('wizard-stub')).toBeInTheDocument();
  });

  it('does NOT render an inline Sign Out button in the topbar (moved to Settings → Account)', () => {
    renderIt();
    expect(
      screen.queryByRole('button', { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });
});
