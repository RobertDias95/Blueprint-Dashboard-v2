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

// ⚠️⚠️ THE LEARN-WINDOW TESTS BELOW ARE SUPERSEDED BY fix-611 §E.1 — AND THEY
//       WERE NEVER WRONG ABOUT THE CODE. They asserted exactly what the input did:
//       clamp to 30–730 and save on blur. Every one of those assertions passed.
//
// ⚖️ Bobby, 2026-09-30: **"Learning window per city: REMOVE."**
//
// ★★★ AND THE REASON IS THE THING THESE TESTS COULD NOT SEE: the number never
//     reached the estimator. `getLearnWindow(juris)` in lib/scheduleBenchmarks
//     discards its argument and returns the flat default. So the clamping was
//     correct, the save was correct, and the value did nothing — under a paragraph
//     telling people it set the schedule baseline. A test that proves an input
//     saves cannot tell you whether anything reads it.
//
// ★ What replaces them is the assertion that the surface is GONE, which is the
//   only thing left to protect: `jurisdictions.learn_window_days` still exists
//   (no migration) and `getLearnWindow` still has its one caller, so nothing but
//   the two editors changed.
describe('<AdminScheduleTab /> — after §E.1', () => {
  it('★★★ the per-city learning-window table is gone', () => {
    renderIt(<AdminScheduleTab />);
    expect(screen.getByTestId('admin-schedule-tab')).toBeInTheDocument();
    // no row, no input, for any city
    expect(screen.queryByTestId('schedule-row-Seattle')).toBeNull();
    expect(screen.queryByTestId('schedule-row-Bellevue')).toBeNull();
    expect(screen.queryByTestId('schedule-window-Seattle')).toBeNull();
    // ★★ and the copy that claimed it drove Schedule Benchmarks is gone with it
    expect(screen.queryByText(/Learning Window/i)).toBeNull();
    expect(screen.queryByText(/Schedule Benchmarks/i)).toBeNull();
  });

  it('★★ what the tab holds now is the per-type schedule, both halves', () => {
    // §B: the target-submit formulas moved here from AdminPermitsTab so the two
    // halves of one question are one card. fix-613 makes them one table.
    renderIt(<AdminScheduleTab />);
    expect(
      screen.getByTestId('settings-subblock-Target submit (per type × city)'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-subblock-Intake → approval defaults (per type)'),
    ).toBeInTheDocument();
  });

  it('★ a non-admin still gets the read-only banner', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt(<AdminScheduleTab />);
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
  });
});

// fix-197: the <AdminConsultantsTab /> describe was removed — that Settings
// tab (the app_config.consultantTypes editor + the dead consultant_firms
// registry editor) was dropped once external team consolidated onto the
// projects.external_team blob and nothing read consultantTypes anymore.
