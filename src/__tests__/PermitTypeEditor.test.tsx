import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-288: the permit-type catalogue editor in Settings → Permits & Templates.
//
// The hooks it drives already existed and are tested elsewhere; what is under
// test here is the editing surface that was missing, and above all the guard:
//
//   ★ permits.type is a STRING, not a foreign key. Deleting a type that permits
//     still name does not fail — it leaves them pointing at a catalogue entry
//     that is gone, which surfaces months later as an unexplained blank. So a
//     type in use must not be deletable, and an unused one must still ask.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  setKey: vi.fn(),
}));

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Condo', is_builtin: false, notes: null },
      { name: 'Short Plat', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Two permits on Building Permit, one on Condo, NONE on Short Plat — the three
// cases the delete guard has to tell apart.
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [
      { id: 1, type: 'Building Permit' },
      { id: 2, type: 'Building Permit' },
      { id: 3, type: 'Condo' },
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
      ['permitTypeDescriptions', {
        'Building Permit': 'Required for new construction',
      }],
    ]),
  }),
  readAppConfigStringArray: () => [],
}));

vi.mock('../hooks/useUpsertPermitType', () => ({
  useUpsertPermitType: () => ({ mutate: mocks.upsert }),
}));
vi.mock('../hooks/useDeletePermitType', () => ({
  useDeletePermitType: () => ({ mutate: mocks.remove }),
}));
vi.mock('../hooks/useRenamePermitType', () => ({
  useRenamePermitType: () => ({ mutate: mocks.rename }),
}));
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({ mutate: mocks.setKey }),
}));

import PermitTypeEditor from '../components/Settings/PermitTypeEditor';

function renderEditor(readOnly = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<PermitTypeEditor readOnly={readOnly} />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-288 the catalogue is visible', () => {
  it('lists every permit type', () => {
    renderEditor();
    for (const t of ['Building Permit', 'Condo', 'Short Plat']) {
      expect(screen.getByTestId(`permit-type-row-${t}`)).toBeInTheDocument();
    }
  });

  it('states how many permits use each type', () => {
    renderEditor();
    expect(screen.getByTestId('permit-type-usage-Building Permit')).toHaveTextContent('2');
    expect(screen.getByTestId('permit-type-usage-Condo')).toHaveTextContent('1');
    expect(screen.getByTestId('permit-type-usage-Short Plat')).toHaveTextContent('0');
  });

  it('marks built-in types', () => {
    renderEditor();
    expect(screen.getByTestId('permit-type-builtin-Building Permit')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-type-builtin-Condo')).toBeNull();
  });
});

describe('fix-288 add', () => {
  it('adds a type', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('permit-type-add-input'), {
      target: { value: 'Sign Permit' },
    });
    fireEvent.click(screen.getByTestId('permit-type-add'));
    expect(mocks.upsert).toHaveBeenCalledWith({
      name: 'Sign Permit', is_builtin: false, notes: null,
    });
  });

  it('refuses a duplicate, case-insensitively', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('permit-type-add-input'), {
      target: { value: 'condo' },
    });
    fireEvent.click(screen.getByTestId('permit-type-add'));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('fix-288 rename', () => {
  it('renames through the RPC that moves the permits too', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('permit-type-rename-Condo'));
    const input = screen.getByTestId('permit-type-rename-input-Condo');
    fireEvent.change(input, { target: { value: 'Condominium' } });
    fireEvent.blur(input);
    expect(mocks.rename).toHaveBeenCalledWith({ from: 'Condo', to: 'Condominium' });
  });

  // ★ Renaming a type that 143 permits carry is the case that MUST go through
  // the RPC — an upsert+delete would orphan every one of them.
  it('renames an in-use type the same way, not by add-then-remove', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('permit-type-rename-Building Permit'));
    const input = screen.getByTestId('permit-type-rename-input-Building Permit');
    fireEvent.change(input, { target: { value: 'BP' } });
    fireEvent.blur(input);
    expect(mocks.rename).toHaveBeenCalledWith({ from: 'Building Permit', to: 'BP' });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('does nothing when the name is unchanged or blank', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('permit-type-rename-Condo'));
    fireEvent.blur(screen.getByTestId('permit-type-rename-input-Condo'));
    expect(mocks.rename).not.toHaveBeenCalled();
  });
});

describe('fix-288 ★ deleting a type in use is never silent', () => {
  it('offers no delete control at all for a type permits reference', () => {
    renderEditor();
    expect(screen.queryByTestId('permit-type-delete-Building Permit')).toBeNull();
    expect(screen.getByTestId('permit-type-delete-blocked-Building Permit'))
      .toHaveTextContent('in use');
    expect(screen.queryByTestId('permit-type-delete-Condo')).toBeNull();
  });

  it('says how many permits are in the way', () => {
    renderEditor();
    expect(
      screen.getByTestId('permit-type-delete-blocked-Building Permit')
        .getAttribute('title'),
    ).toContain('2 permits');
  });

  it('an unused type is deletable — but asks first', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('permit-type-delete-Short Plat'));
    // Nothing has been removed yet: the first click only asks.
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('permit-type-delete-confirm-Short Plat'));
    expect(mocks.remove).toHaveBeenCalledWith({ name: 'Short Plat' });
  });

  it('cancelling leaves the type alone', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('permit-type-delete-Short Plat'));
    fireEvent.click(screen.getByTestId('permit-type-delete-cancel-Short Plat'));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('permit-type-delete-Short Plat')).toBeInTheDocument();
  });
});

describe('fix-288 descriptions are editable here', () => {
  it('shows the stored description', () => {
    renderEditor();
    expect(screen.getByTestId('permit-type-desc-Building Permit'))
      .toHaveValue('Required for new construction');
  });

  it('shows an empty box for a type with none', () => {
    renderEditor();
    expect(screen.getByTestId('permit-type-desc-Condo')).toHaveValue('');
  });

  it('saves to app_config on blur, merged into the existing map', () => {
    renderEditor();
    const input = screen.getByTestId('permit-type-desc-Condo');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Condominium conversion' } });
    fireEvent.blur(input);
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'permitTypeDescriptions',
      value: {
        'Building Permit': 'Required for new construction',
        Condo: 'Condominium conversion',
      },
    });
  });

  it('clearing a description removes the key rather than storing an empty string', () => {
    renderEditor();
    const input = screen.getByTestId('permit-type-desc-Building Permit');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(mocks.setKey).toHaveBeenCalledWith({
      key: 'permitTypeDescriptions',
      value: {},
    });
  });

  it('does not save when nothing changed', () => {
    renderEditor();
    const input = screen.getByTestId('permit-type-desc-Building Permit');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(mocks.setKey).not.toHaveBeenCalled();
  });
});

describe('fix-288 read-only members', () => {
  it('can see the catalogue but change nothing', () => {
    renderEditor(true);
    expect(screen.getByTestId('permit-type-row-Condo')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-type-add')).toBeNull();
    expect(screen.queryByTestId('permit-type-rename-Condo')).toBeNull();
    expect(screen.queryByTestId('permit-type-delete-Short Plat')).toBeNull();
    expect(screen.getByTestId('permit-type-desc-Condo')).toBeDisabled();
  });
});
