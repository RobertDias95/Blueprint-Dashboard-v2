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
      { id: '9', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '10', name: 'Shire', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
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

// fix-96-c: Step 1's Lead DA picker reads da_team_routing to disable
// DAs that have no routing row for the project's juris. The default
// fixture routes Trevor for Seattle only and Cam via a NULL fallback;
// Shire has no routing row at all.
const routingRowsState = vi.hoisted(() => ({
  rows: [
    { da: 'Trevor', jurisdiction: 'Seattle' },
    { da: 'Cam', jurisdiction: null },
  ] as { da: string; jurisdiction: string | null }[],
}));
vi.mock('../hooks/useDaTeamRouting', async (importActual) => {
  const actual =
    await importActual<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual,
    useDaTeamRouting: () => ({
      data: routingRowsState.rows,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

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
  // fix-91: tests that mutate appConfigMap (e.g. seeding
  // productTypeOptions) would otherwise leak the modified map into the
  // next test that expects the default projectTagOptions. Reset to the
  // default map shape every test.
  appConfigMap.current = new Map<string, unknown>([
    ['projectTagOptions', ['ECA', 'SIP', 'TRAL', 'LBA', 'Short Plat']],
  ]);
  // fix-96-c: reset the routing fixture so tests that mutate it don't
  // bleed into siblings.
  routingRowsState.rows = [
    { da: 'Trevor', jurisdiction: 'Seattle' },
    { da: 'Cam', jurisdiction: null },
  ];
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

  // fix-91: Entitlement Lead + Design Manager dropdowns were removed
  // from Step 1 — they derive on Step 3 from the BP's DA pick. The
  // corresponding "no longer in the DOM" check below pins that.
  it('fix-91: Entitlement Lead + Design Manager dropdowns are gone from Step 1', () => {
    setup();
    expect(screen.queryByTestId('wizard-entitlement-lead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard-design-manager')).not.toBeInTheDocument();
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

  it('fix-91: Product Types is a multi-select sourced from app_config.productTypeOptions', () => {
    appConfigMap.current = new Map<string, unknown>([
      ['projectTagOptions', ['ECA', 'SIP', 'TRAL']],
      ['productTypeOptions', ['SFR', 'Attached Units', 'Cottages']],
    ]);
    setup();
    const sel = screen.getByTestId(
      'wizard-product-type-select',
    ) as HTMLSelectElement;
    const optionValues = [...sel.options].map((o) => o.value);
    expect(optionValues).toContain('SFR');
    expect(optionValues).toContain('Attached Units');
    expect(optionValues).toContain('Cottages');
  });

  it('fix-91: picking a product type appends it to the array', () => {
    appConfigMap.current = new Map<string, unknown>([
      ['projectTagOptions', []],
      ['productTypeOptions', ['SFR', 'Cottages', 'Townhouse']],
    ]);
    const { onChange } = setup();
    const sel = screen.getByTestId(
      'wizard-product-type-select',
    ) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'SFR' } });
    expect(onChange).toHaveBeenLastCalledWith({ product_types: ['SFR'] });
  });

  it('fix-91: picking a second product type appends to the existing array', () => {
    appConfigMap.current = new Map<string, unknown>([
      ['projectTagOptions', []],
      ['productTypeOptions', ['SFR', 'Cottages', 'Townhouse']],
    ]);
    // Pre-seed product_types so the component already has SFR; picking
    // Cottages should append (Step1 is controlled, so we mount with the
    // current state and verify the onChange delta).
    const init = makeEmptyWizardState();
    init.product_types = ['SFR'];
    const { onChange } = setup(init);
    fireEvent.change(
      screen.getByTestId('wizard-product-type-select'),
      { target: { value: 'Cottages' } },
    );
    expect(onChange).toHaveBeenLastCalledWith({
      product_types: ['SFR', 'Cottages'],
    });
  });

  it('fix-232: the product-type control is a dropdown (no free-text); an off-registry stored value still renders as a chip', () => {
    appConfigMap.current = new Map<string, unknown>([
      ['productTypeOptions', ['SFR', 'Cottages']],
    ]);
    const init = makeEmptyWizardState();
    init.product_types = ['LegacyCombo']; // off-registry — pruned from the catalog
    setup(init);
    const sel = screen.getByTestId('wizard-product-type-select');
    // Dropdown-only: a SELECT, never a free-text input.
    expect(sel.tagName).toBe('SELECT');
    // The pruned/off-registry stored value still displays (item 3 — no strand).
    expect(screen.getByTestId('wizard-product-type-LegacyCombo')).toBeInTheDocument();
  });

  it('fix-91: clicking × on a chip removes that product type', () => {
    const init = makeEmptyWizardState();
    init.product_types = ['SFR', 'Cottages'];
    const { onChange } = setup(init);
    fireEvent.click(screen.getByTestId('wizard-product-type-remove-SFR'));
    expect(onChange).toHaveBeenLastCalledWith({ product_types: ['Cottages'] });
  });

  it('fix-91: ACQ Target date input is on Step 1 + writes to wizard state', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTestId('wizard-acq-target'), {
      target: { value: '2026-09-15' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ acq_target: '2026-09-15' });
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

  // fix-96-c: project-level Lead DA picker. Mirrors Step 3's DA picker
  // behavior — same active-DA roster (team_members role='da'), same
  // juris-aware routing filter (unrouted DAs render disabled with a
  // "(not routed)" suffix). Optional — the field starts at — unassigned —
  // and a project can be created without a DA assigned.
  describe('fix-96-c: Lead DA picker', () => {
    it('renders the Lead DA select with — unassigned — default', () => {
      setup();
      const sel = screen.getByTestId('wizard-lead-da') as HTMLSelectElement;
      expect(sel.value).toBe('');
      // First option is the unassigned sentinel.
      expect(sel.options[0].value).toBe('');
    });

    it('picking a DA fires onChange with lead_da set', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Seattle';
      const { onChange } = setup(init);
      fireEvent.change(screen.getByTestId('wizard-lead-da'), {
        target: { value: 'Trevor' },
      });
      expect(onChange).toHaveBeenLastCalledWith({ lead_da: 'Trevor' });
    });

    it('roster is sourced from team_members where role="da" (alphabetical)', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Seattle';
      setup(init);
      const sel = screen.getByTestId('wizard-lead-da') as HTMLSelectElement;
      const names = [...sel.options].map((o) => o.value).filter((v) => v !== '');
      expect(names).toEqual(['Cam', 'Shire', 'Trevor']);
    });

    it('a DA routed for the project juris (Trevor + Seattle) is enabled', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Seattle';
      setup(init);
      const opt = screen.getByTestId(
        'wizard-lead-da-opt-Trevor',
      ) as HTMLOptionElement;
      expect(opt.disabled).toBe(false);
      expect(opt.getAttribute('data-routing-disabled')).toBe('false');
      expect(opt.textContent).toBe('Trevor');
    });

    it('a NULL-juris fallback row (Cam) is enabled for any juris', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Bellevue';
      setup(init);
      const opt = screen.getByTestId(
        'wizard-lead-da-opt-Cam',
      ) as HTMLOptionElement;
      expect(opt.disabled).toBe(false);
    });

    it('a DA with no routing row at all (Shire) is disabled + tagged "(not routed)"', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Seattle';
      setup(init);
      const opt = screen.getByTestId(
        'wizard-lead-da-opt-Shire',
      ) as HTMLOptionElement;
      expect(opt.disabled).toBe(true);
      expect(opt.getAttribute('data-routing-disabled')).toBe('true');
      expect(opt.textContent).toContain('(not routed)');
    });

    it('a juris-specific row (Trevor + Seattle) is disabled for a different juris (Bellevue)', () => {
      const init = makeEmptyWizardState();
      init.juris = 'Bellevue';
      setup(init);
      const opt = screen.getByTestId(
        'wizard-lead-da-opt-Trevor',
      ) as HTMLOptionElement;
      expect(opt.disabled).toBe(true);
      expect(opt.textContent).toContain('(not routed)');
    });
  });

  // fix-122: three new project-level fields — num_lots (dropdown 1-20),
  // is_corner_lot (Yes/No/blank tri-state), closing_date (date input).
  // All three nullable; defaults show the "—" sentinel; user picks fire
  // a single onChange patch keyed by the WizardState field name.
  describe('fix-122: num_lots / is_corner_lot / closing_date inputs', () => {
    it('Number of Lots dropdown renders blank + 1-20 (21 options)', () => {
      setup();
      const sel = screen.getByTestId('wizard-num-lots') as HTMLSelectElement;
      const values = [...sel.options].map((o) => o.value);
      expect(values[0]).toBe('');
      // Tail option is 20, length matches.
      expect(values).toHaveLength(21);
      expect(values[20]).toBe('20');
    });

    it('picking a Lots value fires onChange with the string number', () => {
      const { onChange } = setup();
      fireEvent.change(screen.getByTestId('wizard-num-lots'), {
        target: { value: '5' },
      });
      expect(onChange).toHaveBeenLastCalledWith({ num_lots: '5' });
    });

    it('Corner Lot dropdown is tri-state (blank/yes/no)', () => {
      setup();
      const sel = screen.getByTestId(
        'wizard-is-corner-lot',
      ) as HTMLSelectElement;
      expect([...sel.options].map((o) => o.value)).toEqual(['', 'yes', 'no']);
    });

    it('picking a Corner Lot value fires onChange', () => {
      const { onChange } = setup();
      fireEvent.change(screen.getByTestId('wizard-is-corner-lot'), {
        target: { value: 'yes' },
      });
      expect(onChange).toHaveBeenLastCalledWith({ is_corner_lot: 'yes' });
    });

    it('Closing Date input renders empty by default', () => {
      setup();
      const input = screen.getByTestId(
        'wizard-closing-date',
      ) as HTMLInputElement;
      expect(input.type).toBe('date');
      expect(input.value).toBe('');
    });

    it('typing a Closing Date fires onChange with the ISO string', () => {
      const { onChange } = setup();
      fireEvent.change(screen.getByTestId('wizard-closing-date'), {
        target: { value: '2026-12-31' },
      });
      expect(onChange).toHaveBeenLastCalledWith({
        closing_date: '2026-12-31',
      });
    });
  });
});
