import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Q2: Chrome nav lock test.
// Q9.5.a: rewritten for v1-parity top-nav — logo=home + 4 tabs (no
// Dashboard tab, no Settings tab) + ⚙ gear button that opens the
// System Settings modal. Sign-out moved into the modal's Account
// section, no longer in the topbar.

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

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: 'admin' }],
      activeTenantId: 'test-tenant',
      setSession: vi.fn(),
      setInitialized: vi.fn(),
    }),
}));

// SettingsModal pulls in the Admin*Tab tree which pulls in lots of
// data hooks. Stub it for the Chrome-level structural tests; the modal
// itself gets its own component tests later.
vi.mock('../components/SettingsModal', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-modal-stub">modal open</div> : null,
}));

import Chrome from '../components/Chrome';

describe('<Chrome /> Q9.5.a top-nav restructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders the v1-parity nav tabs in order (Trends folded into Reports)', () => {
    renderIt();
    // fix-trends-subtab: Trends moved out of the top nav and back into
    // Reports as a sub-tab, so the nav is the 4 v1-parity tabs only.
    // fix-28: NotificationBell is also a <Link> (to /activity) but lives
    // outside the <nav>, so we scope this assertion to <nav> children.
    const expected = ['Draw Schedule', 'Project View', 'My Tasks', 'Reports'];
    const nav = screen.getByTestId('chrome-nav');
    const links = Array.from(nav.querySelectorAll('a'));
    const labels = links.map((a) => a.textContent?.trim());
    expect(labels).toEqual(expected);
  });

  it('does NOT render a Trends nav tab (fix-trends-subtab)', () => {
    renderIt();
    const nav = screen.getByTestId('chrome-nav');
    const labels = Array.from(nav.querySelectorAll('a')).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).not.toContain('Trends');
  });

  it('does NOT render a "Dashboard" nav tab (logo handles home navigation)', () => {
    renderIt();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).not.toContain('Dashboard');
  });

  it('does NOT render a "Settings" nav tab (gear button opens the modal instead)', () => {
    renderIt();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).not.toContain('Settings');
  });

  it('renders the Blueprint logo as a clickable home button', () => {
    renderIt();
    expect(screen.getByTestId('chrome-home')).toBeInTheDocument();
    expect(screen.getByTestId('chrome-home').textContent).toMatch(/Blueprint/);
  });

  it('renders a ⚙ Settings gear button that opens the System Settings modal on click', () => {
    renderIt();
    const gear = screen.getByTestId('chrome-settings-gear');
    expect(gear).toBeInTheDocument();
    expect(gear.textContent).toMatch(/Settings/);
    // Modal should NOT render until clicked.
    expect(screen.queryByTestId('settings-modal-stub')).not.toBeInTheDocument();
    fireEvent.click(gear);
    expect(screen.getByTestId('settings-modal-stub')).toBeInTheDocument();
  });

  it('does NOT render an inline Sign Out button in the topbar (moved to Settings → Account)', () => {
    renderIt();
    expect(
      screen.queryByRole('button', { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });
});
