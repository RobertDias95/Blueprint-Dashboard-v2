import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-87: nav warning triangle reads bp_new_error_count + navigates to
// /settings/errors.

const T = 'tenant-uuid';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import ErrorTriageBell from '../components/ErrorTriageBell';

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  rpcMock.mockReset();
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ErrorTriageBell />, { wrapper });
}

describe('<ErrorTriageBell /> (fix-87)', () => {
  it('shows the badge count from bp_new_error_count', async () => {
    rpcMock.mockResolvedValue({ data: 4, error: null });
    renderIt();
    await waitFor(() => {
      const badge = screen.getByTestId('error-triage-badge');
      expect(badge.textContent).toBe('4');
    });
  });

  it('hides the badge when count is 0', async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    renderIt();
    // No badge element when count is 0; the icon still renders.
    await waitFor(() =>
      expect(screen.getByTestId('error-triage-button')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('error-triage-badge')).not.toBeInTheDocument();
  });

  it('clamps display at 99+ when count exceeds 99', async () => {
    rpcMock.mockResolvedValue({ data: 250, error: null });
    renderIt();
    await waitFor(() => {
      expect(screen.getByTestId('error-triage-badge').textContent).toBe('99+');
    });
  });

  it('button is a link to /settings/errors', async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderIt();
    const link = await screen.findByTestId('error-triage-button');
    expect(link.getAttribute('href')).toBe('/settings/errors');
  });
});
