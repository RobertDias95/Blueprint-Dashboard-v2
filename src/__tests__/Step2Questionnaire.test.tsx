import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import Step2Questionnaire from '../components/wizard/Step2Questionnaire';
import {
  makeEmptyWizardState,
  type WizardState,
} from '../components/wizard/wizardState';

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'PAR/Pre-Sub', is_builtin: true, notes: null },
      { name: 'SDOT Tree', is_builtin: true, notes: null },
      { name: 'ECA Waiver', is_builtin: true, notes: null },
      { name: 'Boundary Adj', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const statsState: { data: unknown } = { data: [] };
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({
    data: statsState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function setup(initial: WizardState = makeEmptyWizardState()) {
  const onChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(
    <Step2Questionnaire value={initial} onChange={onChange} />,
    { wrapper },
  );
  return { ...utils, onChange };
}

beforeEach(() => {
  statsState.data = [];
});

describe('<Step2Questionnaire />', () => {
  it('Building Permit is always rendered, checked, and disabled (locked-on)', () => {
    statsState.data = [];
    const init = makeEmptyWizardState();
    init.juris = 'Bellevue';
    setup(init);
    const bpBox = screen.getByTestId('wizard-q-flat-checkbox-Building Permit') as HTMLInputElement;
    expect(bpBox.checked).toBe(true);
    expect(bpBox.disabled).toBe(true);
  });

  it('falls back to a flat catalog when total_projects_in_juris < 5', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 3,
        total_projects_in_juris: 3,
        usage_fraction: 1.0,
        usage_pct_display: null,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Bellevue';
    setup(init);
    expect(screen.getByTestId('wizard-q-flat-section')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-q-commonly-section')).toBeNull();
    expect(
      screen.getByText(/Not enough history in Bellevue yet/i),
    ).toBeInTheDocument();
  });

  it('with stats N>=5: buckets permits into Commonly / Sometimes / Other', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
      {
        permit_type: 'Demolition',
        projects_with_this_permit: 6,
        total_projects_in_juris: 8,
        usage_fraction: 0.75,
        usage_pct_display: 75,
      },
      {
        permit_type: 'PAR/Pre-Sub',
        projects_with_this_permit: 3,
        total_projects_in_juris: 8,
        usage_fraction: 0.375,
        usage_pct_display: 38,
      },
      {
        permit_type: 'SDOT Tree',
        projects_with_this_permit: 1,
        total_projects_in_juris: 8,
        usage_fraction: 0.125,
        usage_pct_display: 13,
      },
      {
        permit_type: 'ECA Waiver',
        projects_with_this_permit: 0,
        total_projects_in_juris: 8,
        usage_fraction: 0.0,
        usage_pct_display: 0,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    setup(init);

    // Commonly: BP + Demolition
    expect(
      screen.getByTestId('wizard-q-commonly-item-Building Permit'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('wizard-q-commonly-item-Demolition'),
    ).toBeInTheDocument();
    // Sometimes: PAR/Pre-Sub + SDOT Tree
    expect(
      screen.getByTestId('wizard-q-sometimes-item-PAR/Pre-Sub'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('wizard-q-sometimes-item-SDOT Tree'),
    ).toBeInTheDocument();
    // Other: ECA Waiver + Boundary Adj (no stats row → frac=0)
    expect(
      screen.getByTestId('wizard-q-other-item-ECA Waiver'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('wizard-q-other-item-Boundary Adj'),
    ).toBeInTheDocument();

    // % badge renders.
    expect(screen.getByTestId('wizard-q-commonly-pct-Demolition')).toHaveTextContent('75%');
  });

  it('toggling a non-BP permit adds it to value.permits with selected=true', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
      {
        permit_type: 'Demolition',
        projects_with_this_permit: 6,
        total_projects_in_juris: 8,
        usage_fraction: 0.75,
        usage_pct_display: 75,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.entitlement_lead = 'Bobby';
    init.design_manager = 'Jade';
    const { onChange } = setup(init);
    fireEvent.click(
      screen.getByTestId('wizard-q-commonly-checkbox-Demolition'),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as Partial<WizardState>;
    expect(patch.permits).toHaveLength(1);
    expect(patch.permits![0].type).toBe('Demolition');
    expect(patch.permits![0].selected).toBe(true);
    expect(patch.permits![0].ent_lead).toBe('Bobby');
    expect(patch.permits![0].dm).toBe('Jade');
  });

  it('clicking the locked-on Building Permit checkbox is a no-op', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    const { onChange } = setup(init);
    fireEvent.click(
      screen.getByTestId('wizard-q-commonly-checkbox-Building Permit'),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the v1 description under each permit name when available', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
      {
        permit_type: 'Demolition',
        projects_with_this_permit: 5,
        total_projects_in_juris: 8,
        usage_fraction: 0.625,
        usage_pct_display: 63,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    setup(init);
    // Building Permit description sourced from v1's hintMap.
    expect(
      screen.getByTestId('wizard-q-commonly-desc-Building Permit'),
    ).toHaveTextContent(
      /Required for new construction or major structural work/i,
    );
    expect(
      screen.getByTestId('wizard-q-commonly-desc-Demolition'),
    ).toHaveTextContent(/Tearing down an existing structure/i);
  });

  it('omits the description block entirely for permit types not in v1 hintMap', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    setup(init);
    // Boundary Adj is in usePermitTypes fixture but not in PERMIT_DESCRIPTIONS.
    // No description block should render (no broken-looking empty space).
    expect(
      screen.queryByTestId('wizard-q-other-desc-Boundary Adj'),
    ).toBeNull();
  });

  it('first "sometimes" item is badged as recommended', () => {
    statsState.data = [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
      {
        permit_type: 'PAR/Pre-Sub',
        projects_with_this_permit: 3,
        total_projects_in_juris: 8,
        usage_fraction: 0.375,
        usage_pct_display: 38,
      },
    ];
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    setup(init);
    const row = screen.getByTestId('wizard-q-sometimes-item-PAR/Pre-Sub');
    expect(row).toHaveTextContent(/recommended/i);
  });
});
