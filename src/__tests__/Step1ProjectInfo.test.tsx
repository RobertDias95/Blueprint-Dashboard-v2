import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import Step1ProjectInfo from '../components/wizard/Step1ProjectInfo';
import {
  makeEmptyWizardState,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-75: Project Tags is now a tenant-managed dropdown sourced from
// app_config.projectTagOptions (the same key AdminProjectsTab edits). Mock
// the hook with a small seed list + a way to override per test.
const appConfigMap = vi.hoisted(() => ({
  current: new Map<string, unknown>([
    ['projectTagOptions', ['ECA', 'SIP', 'TRAL', 'LBA', 'Short Plat']],
  ]),
}));
vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual, // keep the real readAppConfigStringArray helper
    useAppConfig: () => ({
      map: appConfigMap.current,
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [
      { name: 'Seattle', learn_window_days: 120, notes: null },
      { name: 'Bellevue', learn_window_days: 120, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    // Mirrors prod: Bobby + Briana exist under BOTH 'ent' and 'ent_lead';
    // Jake exists under both 'acq' and 'acq_lead'. Step 1 dedupes by name.
    all: [
      { id: '1a', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '1b', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '2', name: 'Alex', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '3', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '4', name: 'Lindsay', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '5a', name: 'Jake', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '5b', name: 'Jake', role: 'acq_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '6', name: 'Pat', role: 'acq', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '7', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '8', name: 'OldDM', role: 'dm', active: false, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [],
    formerDas: [],
    dms: [],
    ents: [],
    acqs: [],
    isLoading: false,
    error: null,
    data: [],
    refetch: vi.fn(),
  }),
}));

function setup(initial: WizardState = makeEmptyWizardState()) {
  const onChange = vi.fn();
  let state = initial;
  // Real Step1 only gets a single patch at a time. Track + merge them so
  // the rendered value reflects accumulated updates if a test wants that.
  function wrappedOnChange(patch: Partial<WizardState>) {
    state = { ...state, ...patch };
    onChange(patch);
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(
    <Step1ProjectInfo value={initial} onChange={wrappedOnChange} />,
    { wrapper },
  );
  return { ...utils, onChange, getState: () => state };
}

beforeEach(() => {
  // Reset any module-scoped singletons each test.
});

describe('<Step1ProjectInfo />', () => {
  it('renders Address + Jurisdiction inputs with empty defaults', () => {
    setup();
    const addr = screen.getByTestId('wizard-address') as HTMLInputElement;
    const juris = screen.getByTestId('wizard-juris') as HTMLSelectElement;
    expect(addr.value).toBe('');
    expect(juris.value).toBe('');
    expect([...juris.options].map((o) => o.value)).toEqual([
      '',
      'Seattle',
      'Bellevue',
    ]);
  });

  it('Entitlement Lead dropdown includes ent+ent_lead, deduped by name', () => {
    setup();
    const sel = screen.getByTestId('wizard-entitlement-lead') as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toContain('Bobby'); // ent + ent_lead — must appear ONCE
    expect(names).toContain('Alex'); // ent only
    expect(names.filter((n) => n === 'Bobby')).toHaveLength(1); // dedupe
    expect(names).not.toContain('Trevor'); // da
    expect(names).not.toContain('Jade'); // dm
  });

  it('Acquisition Lead dropdown includes acq+acq_lead, deduped by name', () => {
    setup();
    const sel = screen.getByTestId('wizard-acq-lead') as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toContain('Jake'); // acq + acq_lead — must appear ONCE
    expect(names).toContain('Pat'); // acq only
    expect(names.filter((n) => n === 'Jake')).toHaveLength(1); // dedupe
    expect(names).not.toContain('Bobby');
  });

  it('Design Manager dropdown filters role=dm and excludes inactive', () => {
    setup();
    const sel = screen.getByTestId('wizard-design-manager') as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toContain('Jade');
    expect(names).toContain('Lindsay');
    expect(names).not.toContain('OldDM'); // active=false
  });

  it('typing into Address fires onChange with the new value', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '999 Test Ave' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ address: '999 Test Ave' });
  });

  it('selecting Jurisdiction fires onChange', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ juris: 'Seattle' });
  });

  it('parking_type dropdown uses v1 vocabulary (None/Surface/Garage/Both)', () => {
    setup();
    const sel = screen.getByTestId('wizard-parking-type') as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toEqual(['', 'None', 'Surface', 'Garage', 'Both']);
  });

  it('alley dropdown uses v1 vocabulary (Yes/No, "" sentinel)', () => {
    setup();
    const sel = screen.getByTestId('wizard-alley') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'Yes', 'No']);
  });

  it('product_type dropdown uses v1 vocabulary (SFR / Cottages / Attached Units)', () => {
    setup();
    const sel = screen.getByTestId('wizard-product-type') as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toContain('SFR');
    expect(names).toContain('SFR w/ Accessory Units');
    expect(names).toContain('Attached Units');
    expect(names).toContain('Cottages');
  });

  it('treats lot_width="0" as missing — shows empty input', () => {
    const init = makeEmptyWizardState();
    init.lot_width = '0';
    setup(init);
    expect(
      (screen.getByTestId('wizard-lot-width') as HTMLInputElement).value,
    ).toBe('');
  });

  it('fix-75: project tags is a dropdown sourced from app_config.projectTagOptions (no free-form text input)', () => {
    setup();
    expect(screen.queryByTestId('wizard-tag-input')).toBeNull();
    const select = screen.getByTestId('wizard-tag-select') as HTMLSelectElement;
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toEqual(['', 'ECA', 'SIP', 'TRAL', 'LBA', 'Short Plat']);
  });

  it('fix-75: picking a tag from the dropdown fires onChange with the appended array', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-tag-select'), {
      target: { value: 'ECA' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ project_tags: ['ECA'] });
  });

  it('fix-75: a tag already on the project is filtered out of the dropdown (no duplicates)', () => {
    const init = makeEmptyWizardState();
    init.project_tags = ['ECA'];
    setup(init);
    const select = screen.getByTestId('wizard-tag-select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      'SIP',
      'TRAL',
      'LBA',
      'Short Plat',
    ]);
  });

  it('fix-75: a stored value NOT in the option list still renders as a removable chip (preserved)', () => {
    // Settings admins can curate the option list; previously-stored values
    // outside the current list must not be silently dropped.
    const init = makeEmptyWizardState();
    init.project_tags = ['legacy-custom-tag'];
    setup(init);
    expect(screen.getByTestId('wizard-tag-legacy-custom-tag')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-tag-remove-legacy-custom-tag')).toBeInTheDocument();
  });

  it('renders the UnitTypesEditor empty-state when unit_types is []', () => {
    setup();
    expect(screen.getByTestId('unit-types-editor')).toBeInTheDocument();
    expect(screen.getByText(/No unit types yet/i)).toBeInTheDocument();
  });

  it('renders the Builder / Owner section with 4 freeform inputs', () => {
    setup();
    expect(screen.getByTestId('wizard-section-builder')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-builder-name')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-builder-company')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-builder-email')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-builder-phone')).toBeInTheDocument();
  });

  it('typing into Builder Name fires onChange with the new value', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-builder-name'), {
      target: { value: 'Jane Builder' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ builder_name: 'Jane Builder' });
  });

  it('typing into Builder Company fires onChange with the new value', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-builder-company'), {
      target: { value: 'Acme Builders LLC' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      builder_company: 'Acme Builders LLC',
    });
  });

  it('Builder Email input has type=email for browser validation', () => {
    setup();
    expect(
      (screen.getByTestId('wizard-builder-email') as HTMLInputElement).type,
    ).toBe('email');
  });

  // fix-88: Units count is required at submit. Field shows red border +
  // inline error message after first blur OR after the parent flags
  // showFieldErrors (post-submit-attempt). 2 prod projects were saved
  // with NULL units before this gate.
  describe('fix-88: Units required validation', () => {
    it('does NOT yell on a fresh form (no blur yet, no submit attempt)', () => {
      setup();
      expect(screen.queryByTestId('wizard-units-error')).not.toBeInTheDocument();
      expect(
        screen
          .getByTestId('wizard-units')
          .getAttribute('data-units-error'),
      ).toBe('false');
    });

    it('blurring an empty Units field reveals the inline error', () => {
      setup();
      const units = screen.getByTestId('wizard-units');
      fireEvent.blur(units);
      expect(screen.getByTestId('wizard-units-error')).toBeInTheDocument();
      expect(units.getAttribute('data-units-error')).toBe('true');
      expect(units.getAttribute('aria-invalid')).toBe('true');
    });

    it('a Step1 mounted with a valid Units value renders no error (sanity)', () => {
      const init = makeEmptyWizardState();
      init.units = '4';
      setup(init);
      expect(screen.queryByTestId('wizard-units-error')).not.toBeInTheDocument();
      expect(
        screen
          .getByTestId('wizard-units')
          .getAttribute('data-units-error'),
      ).toBe('false');
    });

    it('"0" is treated as invalid (the bad-data trap — units = 0 ≠ real count)', () => {
      const init = makeEmptyWizardState();
      init.units = '0';
      setup(init);
      fireEvent.blur(screen.getByTestId('wizard-units'));
      expect(screen.getByTestId('wizard-units-error')).toBeInTheDocument();
    });

    it('a negative number is invalid', () => {
      const init = makeEmptyWizardState();
      init.units = '-2';
      setup(init);
      fireEvent.blur(screen.getByTestId('wizard-units'));
      expect(screen.getByTestId('wizard-units-error')).toBeInTheDocument();
    });

    it('showFieldErrors=true paints the error even without a blur (post-submit-attempt path)', () => {
      const onChange = vi.fn();
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      );
      render(
        <Step1ProjectInfo
          value={makeEmptyWizardState()}
          onChange={onChange}
          showFieldErrors
        />,
        { wrapper },
      );
      expect(screen.getByTestId('wizard-units-error')).toBeInTheDocument();
    });
  });
});
