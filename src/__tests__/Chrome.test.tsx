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

// fix-27: extended to cover supabase.rpc and supabase.channel so the bells
// Chrome mounts don't blow up — BoardBell's useScraperActivity hook hits both.
// (fix-326: this used to name NotificationBell, deleted as dead code.)
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
    // fix-27: Chrome mounts bells that use TanStack Query — so the test tree
    // needs a QueryClientProvider.
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
    // ★★ fix-331 §8, the third reorder: Draw Schedule joined the top tier,
    // My Board dropped to third, Project View moved UNDER Reports, and error
    // triage arrived from the top bar as an admin-only entry.
    // ★★ fix-335, the FOURTH reorder: §3 collapsed Entitlements so Library is
    // a top-level row, and §4 added SharePoint — the one entry that leaves the
    // app, visible to everyone.
    // ★ fix-345 §4, the FIFTH: SharePoint moved up under Reports, so the tier
    // below the rule is the two administrative entries again.
    expect(ribbonLabels()).toEqual([
      'Pipeline',
      'Draw Schedule',
      'My Board',
      'Library',
      'Blueprint Design and Entitlements Studio on SharePoint — opens in a new tab',
      'Settings',
      'Scraper and app errors needing triage',
    ]);

    // ★ fix-310 renamed the DD-PHASE vocabulary from Draw to DD across ~14
    // surfaces. The Draw SCHEDULE is a different concept and keeps its name.
    const withEnt = ribbonLabels();
    // ★ fix-331 §8: Draw Schedule is still reachable and still called that —
    // it is simply a top-tier entry now rather than a child of Entitlements.
    expect(withEnt).toContain('Draw Schedule');
    expect(withEnt.some((l) => l === 'DD Schedule')).toBe(false);
    expect(withEnt).toContain('Library');
    // ★ fix-325 #4/#5: Activity and Waiting On left this group — Activity to the
    // Reporting hub, Waiting On into the My Tasks switcher. Both routes still
    // resolve; neither is a tab any more.
    expect(withEnt).not.toContain('Activity');
    expect(withEnt).not.toContain('Waiting On');
  });

  // ★ #59: the top tab bar and the logo-home-button are GONE.
  it('★ renders no top tab bar and no logo home button', () => {
    renderIt();
    expect(screen.queryByTestId('chrome-nav')).toBeNull();
    expect(screen.queryByTestId('chrome-home')).toBeNull();
    expect(screen.queryByTestId('chrome-settings-gear')).toBeNull();
  });

  // ★★ SUPERSEDED BY fix-331 §5, inverted rather than deleted. #59 rendered
  // search disabled with an honest label, which was right for a shell that had
  // just been built. Bobby has since used it beside the real per-screen search:
  // "most screens have a search feature already, so it's kind of a redundant
  // thing." An honest placeholder is still a placeholder.
  it('★ fix-331 §5: there is no search bar in the top bar at all', () => {
    renderIt();
    expect(screen.queryByTestId('chrome-search')).toBeNull();
    expect(screen.getByTestId('chrome-header').textContent ?? '')
      .not.toMatch(/coming soon/i);
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

  // ★★ SUPERSEDED BY fix-331 §6. It was never part of the two-bells problem,
  // but it sat beside a bell every user needs while being an ADMIN tool over a
  // page of stack traces — and 23 of this tenant's 29 people are editors. It is
  // an admin-gated ribbon entry now, and the route is AdminRoute-wrapped too.
  it('★ fix-331 §6: error triage has left the top bar', () => {
    renderIt();
    expect(screen.queryByTestId('error-triage-button')).toBeNull();
    expect(screen.getByTestId('ribbon-link-/settings/errors')).toBeInTheDocument();
  });

  it('★ fix-331 §6: a non-admin sees no error-triage entry anywhere', () => {
    authState.role = 'editor';
    renderIt();
    expect(screen.queryByTestId('ribbon-link-/settings/errors')).toBeNull();
    expect(screen.queryByTestId('error-triage-button')).toBeNull();
  });

  // ★ fix-331 §7: the initials circle is gone. Bobby: "I don't know if it needs
  // to say the BO part, because it's not like a setting, there's no button
  // functionality." Name, position and the bell remain.
  it('★ fix-331 §7: the user chip has no initials circle', () => {
    renderIt();
    const chip = screen.getByTestId('chrome-user-chip');
    // The name/position block survives; the 29px rounded circle in front of it
    // does not. Asserted structurally — a name is only two lines of text now,
    // so there is no third element to be an avatar.
    expect(chip.textContent).toContain('Blueprint Services');
    expect(chip.querySelector('.rounded-full')).toBeNull();
    expect(chip.children).toHaveLength(1);
    // The bell is still to its left, in the same header.
    expect(screen.getByTestId('board-bell-button')).toBeTruthy();
  });

  // fix-234, now applied to the whole ribbon GROUP.
  it('an admin sees the Reports group', () => {
    authState.role = 'admin';
    renderIt();
    expect(screen.getByTestId('ribbon-group-reports')).toBeInTheDocument();
  });

  // ★★ SUPERSEDED BY fix-331 §8, and this is the change worth reading twice.
  //
  // fix-234's gate was all-or-nothing: a non-admin saw no Reports group. §8
  // moves PROJECT VIEW under Reports — and Project View is not admin-only.
  // Measured on prod 2026-08-17: 23 of the 29 people in this tenant are
  // . Keeping the group hidden wholesale would have deleted Project
  // View for 23 of 29 users, so the gate became per-child: the group renders
  // when the viewer can see at least one child, and a non-admin sees exactly
  // one — Project View. NO REPORT ROUTE IS REACHABLE, which is the part of
  // fix-234 that still matters and is asserted below.
  it('★ a non-admin sees the Reports group with ONLY Project View in it', () => {
    authState.role = 'editor';
    renderIt();
    expect(screen.getByTestId('ribbon-group-reports')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-link-/projects')).toBeInTheDocument();
    // Not merely collapsed: no report route is reachable.
    expect(screen.queryByTestId('ribbon-link-/reports')).toBeNull();
    expect(screen.queryByTestId('ribbon-link-/reports/weekly-da')).toBeNull();
    expect(screen.queryByTestId('ribbon-link-/settings/reporting')).toBeNull();

    // Everything else still renders. fix-297: ★ Library is NOT admin-gated,
    // matching Draw Schedule — it has been reachable by everyone for as long
    // as it has existed. fix-298: neither is My Board.
    // Everything a non-admin SHOULD have is here: the three top-tier screens,
    // Library, Settings, and Project View inside the group opened above.
    // No error-triage entry, and no report.
    //
    // ★★ fix-335 §4: AND SHAREPOINT, which is the assertion that matters most
    // in this test. "this is accessible by everyone" — 23 of the 29 people in
    // this tenant are editors, so a gate here would have withheld the studio's
    // document site from almost the whole company. The entry type carries no
    // adminOnly flag at all, so it cannot acquire one by accident.
    expect(ribbonLabels()).toEqual([
      'Pipeline',
      'Draw Schedule',
      'My Board',
      'Library',
      'Every project, searchable — open to everyone',
      'Blueprint Design and Entitlements Studio on SharePoint — opens in a new tab',
      'Settings',
    ]);
    // ★ fix-335 §3: Library is a top-level entry now, not a group.
    expect(screen.queryByTestId('ribbon-group-entitlements')).toBeNull();
    expect(screen.getByTestId('ribbon-link-/library')).toBeInTheDocument();
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
  // ★★ fix-335 §1/§2 SPLIT THIS IN TWO, which is the whole point of the change:
  // the COMPANY's mark is in the ribbon and the PRODUCT's name is in the header.
  // Bobby: "in the center of all the screens in that white area, it's going to
  // read logo, The Bridge."
  it('renders the Blueprint Bridge mark and wordmark', () => {
    renderIt();
    // The ribbon: the Blueprint logo, and no words at all.
    expect(screen.getByTestId('blueprint-mark')).toBeInTheDocument();
    const ribbon = screen.getByTestId('ribbon');
    expect(ribbon.textContent).not.toMatch(/The Bridge/);

    // The header: the product's lockup, centred.
    //
    // ★ fix-351 — ONE IMAGE. This asserted a mark beside styled text reading
    // "the Bridge"; Bobby's new artwork carries the mark AND the words, so the
    // name lives in the alt text and the centre renders no text of its own.
    // The claim is unchanged — the header names the product, centred, on every
    // screen — and the accessible name is where a test can still read it.
    const centre = screen.getByTestId('chrome-brand-center');
    const brand = screen.getByTestId('bridge-mark') as HTMLImageElement;
    expect(brand.getAttribute('alt')).toMatch(/The Bridge/);
    expect(brand.getAttribute('src')).toMatch(/bridge-logo-2026/);
    // Nothing renders the name a second time as text underneath the picture.
    expect(centre.textContent).toBe('');
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
