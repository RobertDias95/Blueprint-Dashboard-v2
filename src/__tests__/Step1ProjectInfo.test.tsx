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

  it('adding a project tag fires onChange with the appended array', () => {
    const { onChange } = setup();
    const tagInput = screen.getByTestId('wizard-tag-input') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'corner-lot' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({
      project_tags: ['corner-lot'],
    });
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
});
