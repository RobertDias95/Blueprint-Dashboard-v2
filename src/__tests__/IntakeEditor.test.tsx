import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q6.3.c: smoke tests for the Q6.3.c editor affordances added to the
// IntakeTracker. Mocks all hooks so we can assert the callback shapes
// fired by add/edit/remove/swap/placeholder-toggle.

const T = 'test-tenant-uuid';
const NOW = '2026-05-11T12:00:00Z';
const FIXED_TODAY = new Date(2026, 4, 11);

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  swap: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const NOW = '2026-05-11T12:00:00Z';
  return {
    intakes: [
      {
        id: 1,
        project_id: null,
        permit_id: null,
        address: '100 First St',
        permit_num: 'BP-100',
        permit_type: 'Building Permit',
        intake_date: '2026-05-13',
        is_placeholder: false,
        portal_url: 'https://city.example/100',
        link: null,
        created_at: null,
        updated_at: NOW,
      },
      {
        id: 2,
        project_id: null,
        permit_id: null,
        address: '200 Second Ave',
        permit_num: 'BP-200',
        permit_type: 'Demolition',
        intake_date: '2026-05-14',
        is_placeholder: true,
        portal_url: null,
        link: null,
        created_at: null,
        updated_at: NOW,
      },
    ],
  };
});

vi.mock('../hooks/useIntakeRecords', () => ({
  useIntakeRecords: () => ({
    data: fixtures.intakes,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'IPR', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertIntakeRecord', () => ({
  useUpsertIntakeRecord: () => ({ mutate: mocks.upsert }),
}));
vi.mock('../hooks/useDeleteIntakeRecord', () => ({
  useDeleteIntakeRecord: () => ({ mutate: mocks.remove }),
}));
vi.mock('../hooks/useSwapIntakeDates', () => ({
  useSwapIntakeDates: () => ({ mutate: mocks.swap }),
}));

import IntakeTracker from '../components/IntakeTracker';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  // jsdom doesn't define window.confirm; stub it to always accept so
  // the remove test path proceeds without a prompt.
  vi.stubGlobal('confirm', () => true);
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntakeTracker />
    </QueryClientProvider>,
  );
}

describe('<IntakeTracker /> Q6.3.c editor', () => {
  it('renders the add-row form + action buttons per row', () => {
    renderIt();
    expect(screen.getByTestId('intake-add-form')).toBeInTheDocument();
    expect(screen.getByTestId('intake-add-address')).toBeInTheDocument();
    expect(screen.getByTestId('intake-add-real')).toBeInTheDocument();
    expect(screen.getByTestId('intake-add-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('intake-remove-1')).toBeInTheDocument();
    expect(screen.getByTestId('intake-swap-1')).toBeInTheDocument();
  });

  it('Add form: "Add" button fires insert with is_placeholder=false', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('intake-add-address'), {
      target: { value: '300 Third Pl' },
    });
    fireEvent.change(screen.getByTestId('intake-add-num'), {
      target: { value: 'BP-300' },
    });
    fireEvent.change(screen.getByTestId('intake-add-date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByTestId('intake-add-real'));
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'insert',
      patch: {
        address: '300 Third Pl',
        permit_num: 'BP-300',
        permit_type: 'Building Permit',
        intake_date: '2026-06-01',
        portal_url: null,
        is_placeholder: false,
      },
    });
  });

  it('Add form: "+ Placeholder" button fires insert with is_placeholder=true', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('intake-add-address'), {
      target: { value: '400 Fourth Ln' },
    });
    fireEvent.click(screen.getByTestId('intake-add-placeholder'));
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'insert',
      patch: expect.objectContaining({
        address: '400 Fourth Ln',
        is_placeholder: true,
      }),
    });
  });

  it('Add form: Add disabled when address is empty', () => {
    renderIt();
    const realBtn = screen.getByTestId('intake-add-real') as HTMLButtonElement;
    expect(realBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('intake-add-address'), {
      target: { value: 'x' },
    });
    expect(realBtn.disabled).toBe(false);
  });

  it('Status badge click toggles is_placeholder', () => {
    renderIt();
    // Row 1: is_placeholder=false → click flips to true
    fireEvent.click(screen.getByTestId('intake-status-1'));
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      record: expect.objectContaining({ id: 1, is_placeholder: false }),
      patch: { is_placeholder: true },
    });
    // Row 2: is_placeholder=true → click flips to false
    fireEvent.click(screen.getByTestId('intake-status-2'));
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      record: expect.objectContaining({ id: 2, is_placeholder: true }),
      patch: { is_placeholder: false },
    });
  });

  it('Inline address edit commits on Enter', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('intake-addr-1'));
    const input = screen.getAllByTestId('intake-addr-1').pop() as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100 First St — updated' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      record: expect.objectContaining({ id: 1 }),
      patch: { address: '100 First St — updated' },
    });
  });

  it('Inline type select fires update with new permit_type', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('intake-type-1'), {
      target: { value: 'IPR' },
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      record: expect.objectContaining({ id: 1 }),
      patch: { permit_type: 'IPR' },
    });
  });

  it('× remove button fires delete with id + updated_at', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('intake-remove-1'));
    expect(mocks.remove).toHaveBeenCalledWith({ id: 1, updated_at: NOW });
  });

  it('Swap flow: 1st 🔀 sets pending; 2nd 🔀 on different row fires bp_swap_intake_dates', () => {
    renderIt();
    // No swap pending initially.
    expect(screen.queryByTestId('intake-swap-pending')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('intake-swap-1'));
    expect(screen.getByTestId('intake-swap-pending')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('intake-swap-2'));
    expect(mocks.swap).toHaveBeenCalledWith(
      { idA: 1, idB: 2, expectedA: NOW, expectedB: NOW },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('Swap flow: clicking the same row twice cancels selection without firing', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('intake-swap-1'));
    fireEvent.click(screen.getByTestId('intake-swap-1'));
    expect(mocks.swap).not.toHaveBeenCalled();
    expect(screen.queryByTestId('intake-swap-pending')).not.toBeInTheDocument();
  });

  it('Swap flow: Cancel button clears pending selection', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('intake-swap-1'));
    fireEvent.click(screen.getByTestId('intake-swap-cancel'));
    expect(screen.queryByTestId('intake-swap-pending')).not.toBeInTheDocument();
    expect(mocks.swap).not.toHaveBeenCalled();
  });

  it('Inline portal URL edit fires update', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('intake-url-1'));
    const input = screen.getAllByTestId('intake-url-1').pop() as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'https://city.example/100-new' },
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      record: expect.objectContaining({ id: 1 }),
      patch: { portal_url: 'https://city.example/100-new' },
    });
  });
});
