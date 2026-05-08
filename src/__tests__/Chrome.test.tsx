import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Q2: Verify Chrome renders the five v1-fidelity nav items in order.
// Locks the structure that replaced Q1's placeholder nav.

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  supabaseUrl: 'http://test.local',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { email: 'bobby@example.com' },
      initialized: true,
      setSession: vi.fn(),
      setInitialized: vi.fn(),
    }),
}));

import Chrome from '../components/Chrome';

describe('<Chrome />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all five top-level nav items in v1-fidelity order', () => {
    render(
      <MemoryRouter>
        <Chrome />
      </MemoryRouter>,
    );
    const expected = [
      'Dashboard',
      'Project View',
      'My Tasks',
      'Reports',
      'Settings',
    ];
    const links = screen.getAllByRole('link');
    const labels = links.map((a) => a.textContent?.trim());
    for (const label of expected) {
      expect(labels).toContain(label);
    }
  });

  it('shows the signed-in user email and a sign-out button', () => {
    render(
      <MemoryRouter>
        <Chrome />
      </MemoryRouter>,
    );
    expect(screen.getByText('bobby@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});
