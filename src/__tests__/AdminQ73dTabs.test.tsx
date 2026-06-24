import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.3.d: smoke tests for the three bundled tabs — Account, Schedule,
// Consultants. Hooks mocked for synchronous render.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsertJuris: vi.fn(),
  setKey: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signOut: mocks.signOut },
  },
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [
      { name: 'Seattle', learn_window_days: 180, notes: null },
      { name: 'Bellevue', learn_window_days: null, notes: 'imported' },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertJurisdiction', () => ({
  useUpsertJurisdiction: () => ({ mutate: mocks.upsertJuris }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    map: new Map<string, unknown>(),
  }),
  readAppConfigStringArray: () => [],
}));
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({ mutate: mocks.setKey }),
}));

import AdminAccountTab from '../components/Settings/AdminAccountTab';
import AdminScheduleTab from '../components/Settings/AdminScheduleTab';

function renderIt(tab: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{tab}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
    user: { email: 'bobby@example.com' } as unknown as ReturnType<
      typeof useAuthStore.getState
    >['user'],
  });
});

describe('<AdminAccountTab />', () => {
  it('renders email + admin role pill + sign-out button', () => {
    renderIt(<AdminAccountTab />);
    expect(screen.getByTestId('account-email').textContent).toBe(
      'bobby@example.com',
    );
    expect(screen.getByTestId('account-role').textContent).toBe('Admin');
    expect(screen.getByTestId('account-signout')).toBeInTheDocument();
    expect(screen.getByTestId('account-tenants').textContent).toMatch(
      /1 membership/,
    );
  });

  it('Sign out calls supabase.auth.signOut + navigates to /login', async () => {
    renderIt(<AdminAccountTab />);
    fireEvent.click(screen.getByTestId('account-signout'));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    // navigate happens after the await; check next microtask.
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('Fallback when not signed in shows "Not signed in"', () => {
    useAuthStore.setState({
      activeTenantId: null,
      memberships: [],
      user: null,
    });
    renderIt(<AdminAccountTab />);
    expect(screen.getByTestId('account-email').textContent).toBe(
      'Not signed in',
    );
    // Falls back to viewer when no membership is active.
    expect(screen.getByTestId('account-role').textContent).toBe('Viewer');
  });

  it('Editor role renders with the Editor label', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt(<AdminAccountTab />);
    expect(screen.getByTestId('account-role').textContent).toBe('Editor');
  });
});

describe('<AdminScheduleTab />', () => {
  it('renders one row per jurisdiction with learn-window input', () => {
    renderIt(<AdminScheduleTab />);
    expect(screen.getByTestId('admin-schedule-tab')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-row-Seattle')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-row-Bellevue')).toBeInTheDocument();
    const seatInput = screen.getByTestId(
      'schedule-window-Seattle',
    ) as HTMLInputElement;
    expect(seatInput.value).toBe('180');
    // Null defaults to 180.
    const bellInput = screen.getByTestId(
      'schedule-window-Bellevue',
    ) as HTMLInputElement;
    expect(bellInput.value).toBe('180');
  });

  it('Blur with changed value fires upsert with clamped integer', () => {
    renderIt(<AdminScheduleTab />);
    const input = screen.getByTestId(
      'schedule-window-Seattle',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);
    expect(mocks.upsertJuris).toHaveBeenCalledWith({
      name: 'Seattle',
      learn_window_days: 250,
      notes: null,
    });
  });

  it('Below-min input clamps up to 30', () => {
    renderIt(<AdminScheduleTab />);
    const input = screen.getByTestId(
      'schedule-window-Seattle',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(mocks.upsertJuris).toHaveBeenLastCalledWith({
      name: 'Seattle',
      learn_window_days: 30,
      notes: null,
    });
  });

  it('Non-admin role disables the inputs', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt(<AdminScheduleTab />);
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    const input = screen.getByTestId(
      'schedule-window-Seattle',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

// fix-197: the <AdminConsultantsTab /> describe was removed — that Settings
// tab (the app_config.consultantTypes editor + the dead consultant_firms
// registry editor) was dropped once external team consolidated onto the
// projects.external_team blob and nothing read consultantTypes anymore.
