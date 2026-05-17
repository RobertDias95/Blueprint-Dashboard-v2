import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Q2: Chrome nav lock test.
// Q9.5.a: rewritten for v1-parity top-nav — logo=home + 4 tabs (no
// Dashboard tab, no Settings tab) + ⚙ gear button that opens the
// System Settings modal. Sign-out moved into the modal's Account
// section, no longer in the topbar.

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  },
  supabaseUrl: 'http://test.local',
}));

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
    return render(
      <MemoryRouter>
        <Chrome />
      </MemoryRouter>,
    );
  }

  it('renders the v1-parity nav tabs in order, plus fix-25-feat-T Trends tab', () => {
    renderIt();
    // fix-25-feat-T appended a 5th tab "Trends" for operational performance.
    const expected = [
      'Draw Schedule',
      'Project View',
      'My Tasks',
      'Reports',
      'Trends',
    ];
    const links = screen.getAllByRole('link');
    const labels = links.map((a) => a.textContent?.trim());
    expect(labels).toEqual(expected);
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
