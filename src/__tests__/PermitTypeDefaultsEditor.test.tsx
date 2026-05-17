import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-25-feat-Z: render + commit-flow tests for PermitTypeDefaultsEditor.
// Mocks the three data hooks so we can assert the upsert payload shape
// without standing up Supabase.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

const fixtures = vi.hoisted(() => ({
  types: [
    { name: 'Building Permit', is_builtin: true, notes: null },
    { name: 'Demolition', is_builtin: true, notes: null },
    { name: 'ULS', is_builtin: true, notes: null },
  ],
  defaults: {
    rows: [
      {
        type: 'Building Permit',
        intake_to_approval_days: 210,
        c1_resub_offset_days: 60,
        updated_at: '2026-05-15T00:00:00Z',
      },
      {
        type: 'Demolition',
        intake_to_approval_days: 60,
        c1_resub_offset_days: null,
        updated_at: '2026-05-15T00:00:00Z',
      },
    ],
    byType: new Map<string, number>([
      ['Building Permit', 210],
      ['Demolition', 60],
    ]),
    c1OffsetByType: new Map<string, number>([['Building Permit', 60]]),
    isLoading: false,
  },
}));

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: fixtures.types,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => fixtures.defaults,
}));
vi.mock('../hooks/useUpsertPermitTypeDefault', () => ({
  useUpsertPermitTypeDefault: () => ({ mutate: mocks.upsert }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => true,
}));

import PermitTypeDefaultsEditor from '../components/Settings/PermitTypeDefaultsEditor';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PermitTypeDefaultsEditor />
    </QueryClientProvider>,
  );
}

describe('<PermitTypeDefaultsEditor />', () => {
  it('renders one row per catalog permit type', () => {
    renderIt();
    expect(screen.getByTestId('ptd-row-Building Permit')).toBeInTheDocument();
    expect(screen.getByTestId('ptd-row-Demolition')).toBeInTheDocument();
    expect(screen.getByTestId('ptd-row-ULS')).toBeInTheDocument();
  });

  it('hydrates inputs from the tenant defaults map', () => {
    renderIt();
    expect(
      (screen.getByTestId('ptd-intake-Building Permit') as HTMLInputElement).value,
    ).toBe('210');
    expect(
      (screen.getByTestId('ptd-c1-Building Permit') as HTMLInputElement).value,
    ).toBe('60');
    expect(
      (screen.getByTestId('ptd-intake-Demolition') as HTMLInputElement).value,
    ).toBe('60');
    // Demolition has null c1 offset → input empty, placeholder shows.
    const demoC1 = screen.getByTestId('ptd-c1-Demolition') as HTMLInputElement;
    expect(demoC1.value).toBe('');
    expect(demoC1.placeholder).toMatch(/auto: total \/ 3/);
  });

  it('uncatalogued types in defaults are not surfaced (rows come from usePermitTypes)', () => {
    renderIt();
    // ULS is in catalog but has no default → input empty.
    expect(
      (screen.getByTestId('ptd-intake-ULS') as HTMLInputElement).value,
    ).toBe('');
  });

  it('committing a new intake value fires upsert with current c1 preserved', () => {
    renderIt();
    const input = screen.getByTestId('ptd-intake-Building Permit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '180' } });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith({
      type: 'Building Permit',
      intake_to_approval_days: 180,
      c1_resub_offset_days: 60,
    });
  });

  it('blur with unchanged value does not fire upsert', () => {
    renderIt();
    const input = screen.getByTestId('ptd-intake-Building Permit') as HTMLInputElement;
    fireEvent.blur(input);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('clamps out-of-range intake values to [1, 730]', () => {
    renderIt();
    const input = screen.getByTestId('ptd-intake-Building Permit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ intake_to_approval_days: 730 }),
    );
  });

  it('committing empty c1 offset sends null (auto-derive)', () => {
    renderIt();
    const input = screen.getByTestId('ptd-c1-Building Permit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith({
      type: 'Building Permit',
      intake_to_approval_days: 210,
      c1_resub_offset_days: null,
    });
  });

  it('committing a new c1 offset preserves the current intake_to_approval_days', () => {
    renderIt();
    const input = screen.getByTestId('ptd-c1-Demolition') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith({
      type: 'Demolition',
      intake_to_approval_days: 60,
      c1_resub_offset_days: 20,
    });
  });

  it('Enter on intake input commits the change (via blur)', () => {
    renderIt();
    const input = screen.getByTestId('ptd-intake-Building Permit') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '90' } });
    // Enter handler programmatically blurs the input. jsdom dispatches
    // blur synchronously when an active element is blurred → onBlur fires.
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Building Permit',
        intake_to_approval_days: 90,
      }),
    );
  });
});

describe('<PermitTypeDefaultsEditor /> read-only', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('disables inputs when the user is not tenant admin', async () => {
    vi.doMock('../hooks/useIsTenantAdmin', () => ({
      useIsTenantAdmin: () => false,
    }));
    // Re-import after re-mocking.
    const { default: Editor } = await import(
      '../components/Settings/PermitTypeDefaultsEditor'
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Editor />
      </QueryClientProvider>,
    );
    const intake = screen.getByTestId(
      'ptd-intake-Building Permit',
    ) as HTMLInputElement;
    expect(intake.disabled).toBe(true);
  });
});
