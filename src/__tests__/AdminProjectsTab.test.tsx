import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: smoke tests for AdminProjectsTab + the four catalog editors.
// Hooks are mocked so the component renders synchronously; mutate fns
// captured via shared vi.fn() handles for assertion.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsertJuris: vi.fn(),
  deleteJuris: vi.fn(),
  upsertType: vi.fn(),
  deleteType: vi.fn(),
  setKey: vi.fn(),
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [
      { name: 'Bellevue', learn_window_days: 120, notes: null },
      { name: 'Seattle', learn_window_days: null, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'IPR', is_builtin: false, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    map: new Map<string, unknown>([
      // fix-92: the catalog editor now reads + writes the
      // 'productTypeOptions' key (same key the wizard + Library filter
      // consume). Pre-fix-92 tests stored under 'productTypes' which
      // matched the broken editor — they're updated alongside.
      ['productTypeOptions', ['SFR', 'Attached Units']],
      ['projectTagOptions', ['ECA', 'SIP']],
      // fix-167: Hold Reasons editable list.
      ['holdReasonOptions', ['MHA', 'Financing / capital decision']],
    ]),
  }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  },
}));

vi.mock('../hooks/useUpsertJurisdiction', () => ({
  useUpsertJurisdiction: () => ({ mutate: mocks.upsertJuris }),
}));
vi.mock('../hooks/useDeleteJurisdiction', () => ({
  useDeleteJurisdiction: () => ({ mutate: mocks.deleteJuris }),
}));
vi.mock('../hooks/useUpsertPermitType', () => ({
  useUpsertPermitType: () => ({ mutate: mocks.upsertType }),
}));
vi.mock('../hooks/useDeletePermitType', () => ({
  useDeletePermitType: () => ({ mutate: mocks.deleteType }),
}));
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({ mutate: mocks.setKey }),
}));

import AdminProjectsTab from '../components/Settings/AdminProjectsTab';

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
      <AdminProjectsTab />
    </QueryClientProvider>,
  );
}

describe('<AdminProjectsTab /> Q7.3.a', () => {
  it('renders all 5 catalog sections + jurisdiction + permit-type rows', () => {
    renderIt();
    expect(screen.getByTestId('admin-projects-tab')).toBeInTheDocument();
    expect(screen.getByTestId('juris-list')).toBeInTheDocument();
    expect(screen.getByTestId('permit-types-list')).toBeInTheDocument();
    expect(screen.getByTestId('product-types-list')).toBeInTheDocument();
    expect(screen.getByTestId('project-tags-list')).toBeInTheDocument();
    // fix-167: Hold Reasons editor.
    expect(screen.getByTestId('hold-reasons-list')).toBeInTheDocument();
    expect(screen.getByTestId('hold-reasons-list-pill-MHA')).toBeInTheDocument();
    expect(screen.getByTestId('juris-list-pill-Bellevue')).toBeInTheDocument();
    expect(screen.getByTestId('juris-list-pill-Seattle')).toBeInTheDocument();
    expect(screen.getByTestId('permit-types-list-pill-Building Permit')).toBeInTheDocument();
    expect(screen.getByTestId('permit-types-list-pill-IPR')).toBeInTheDocument();
  });

  it('adding a jurisdiction calls bp_upsert_jurisdiction with default learn window', () => {
    renderIt();
    const input = screen.getByTestId('juris-list-add') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'TEST-Q73a' } });
    fireEvent.click(screen.getByTestId('juris-list-add-btn'));
    expect(mocks.upsertJuris).toHaveBeenCalledWith({
      name: 'TEST-Q73a',
      learn_window_days: 180,
      notes: null,
    });
  });

  it('removing a jurisdiction calls bp_delete_jurisdiction', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('juris-list-remove-Seattle'));
    expect(mocks.deleteJuris).toHaveBeenCalledWith({ name: 'Seattle' });
  });

  it('changing learn window commits onBlur with a clamped integer', () => {
    renderIt();
    const win = screen.getByTestId('juris-window-Bellevue') as HTMLInputElement;
    fireEvent.change(win, { target: { value: '250' } });
    fireEvent.blur(win);
    expect(mocks.upsertJuris).toHaveBeenCalledWith({
      name: 'Bellevue',
      learn_window_days: 250,
      notes: null,
    });
  });

  it('learn window clamps below-min input up to 30', () => {
    renderIt();
    const win = screen.getByTestId('juris-window-Bellevue') as HTMLInputElement;
    fireEvent.change(win, { target: { value: '5' } });
    fireEvent.blur(win);
    expect(mocks.upsertJuris).toHaveBeenLastCalledWith({
      name: 'Bellevue',
      learn_window_days: 30,
      notes: null,
    });
  });

  it('built-in permit types render a badge and lock removal', () => {
    renderIt();
    const builtin = screen.getByTestId('permit-types-list-pill-Building Permit');
    expect(builtin.textContent).toMatch(/built-in/i);
    expect(
      screen.queryByTestId('permit-types-list-remove-Building Permit'),
    ).not.toBeInTheDocument();
    // Non-builtin still has the remove button.
    expect(
      screen.getByTestId('permit-types-list-remove-IPR'),
    ).toBeInTheDocument();
  });

  it('fix-167: adding a hold reason extends holdReasonOptions via bp_set_app_config_key', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('hold-reasons-list-add'), {
      target: { value: 'Permit appeal pending' },
    });
    fireEvent.click(screen.getByTestId('hold-reasons-list-add-btn'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'holdReasonOptions',
      value: ['MHA', 'Financing / capital decision', 'Permit appeal pending'],
    });
  });

  it('fix-167: removing a hold reason rewrites holdReasonOptions without it', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('hold-reasons-list-remove-MHA'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'holdReasonOptions',
      value: ['Financing / capital decision'],
    });
  });

  it('adding a product type extends the existing array via bp_set_app_config_key', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('product-types-list-add'), {
      target: { value: 'Cottages' },
    });
    fireEvent.click(screen.getByTestId('product-types-list-add-btn'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'productTypeOptions',
      value: ['SFR', 'Attached Units', 'Cottages'],
    });
  });

  it('duplicate product type add is silently ignored', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('product-types-list-add'), {
      target: { value: 'SFR' },
    });
    fireEvent.click(screen.getByTestId('product-types-list-add-btn'));
    expect(mocks.setKey).not.toHaveBeenCalled();
  });

  it('removing a project tag rewrites the JSONB array minus the removed item', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-tags-list-remove-ECA'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'projectTagOptions',
      value: ['SIP'],
    });
  });

  // fix-92: parity with the projectTagOptions editor — removing a product
  // type rewrites the JSONB array minus the removed item, and the key
  // matches the one the wizard + Library filter actually consume.
  it('removing a product type rewrites the JSONB array minus the removed item', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('product-types-list-remove-SFR'));
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'productTypeOptions',
      value: ['Attached Units'],
    });
  });

  it('Enter key in product-types add-input submits the same as the Add button', () => {
    renderIt();
    const input = screen.getByTestId(
      'product-types-list-add',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Townhouse' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'productTypeOptions',
      value: ['SFR', 'Attached Units', 'Townhouse'],
    });
  });

  it('fix-92: the editor uses the same app_config key the wizard reads (productTypeOptions)', () => {
    // Regression guard: pre-fix-92 the editor wrote to 'productTypes'
    // while Step1ProjectInfo + libraryHelpers read 'productTypeOptions'.
    // Bobby's edits never reached the wizard's dropdown. This test pins
    // the contract — every product-type mutation MUST target the
    // 'productTypeOptions' key.
    renderIt();
    fireEvent.change(screen.getByTestId('product-types-list-add'), {
      target: { value: 'Studio' },
    });
    fireEvent.click(screen.getByTestId('product-types-list-add-btn'));
    fireEvent.click(screen.getByTestId('product-types-list-remove-Attached Units'));
    const keysUsed = mocks.setKey.mock.calls.map(
      (c) => (c[0] as { key: string }).key,
    );
    expect(new Set(keysUsed)).toEqual(new Set(['productTypeOptions']));
  });

  it('non-admin role shows read-only banner + hides add inputs', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt();
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByTestId('juris-list-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('juris-list-add-btn')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('juris-list-remove-Seattle'),
    ).not.toBeInTheDocument();
    // Learn-window number input still renders but is disabled.
    const win = screen.getByTestId('juris-window-Bellevue') as HTMLInputElement;
    expect(win.disabled).toBe(true);
  });

  it('Enter key in add-input submits the same as the Add button', () => {
    renderIt();
    const input = screen.getByTestId('project-tags-list-add') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'TRAL' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'projectTagOptions',
      value: ['ECA', 'SIP', 'TRAL'],
    });
  });
});
