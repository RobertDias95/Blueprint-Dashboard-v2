import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  makeEmptyWizardState,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-144: Redesign DD phase. A redesign with redesign_reuses_original_permit
// = true creates no permits — so without this it lands on the Project list with
// NO Draw Schedule lane. The wizard now requires a DD phase (DA + dd_start +
// dd_end) when reuse is on and the RPC builds a manually_placed lane from it.

const T = 'test-tenant-uuid';

const rpcFn = vi.hoisted(() => vi.fn());
const createResult = vi.hoisted(() => ({
  current: {
    data: [
      { project_id: 'redesign-uuid', permit_ids: [], conflict: false },
    ] as unknown,
    error: null as Error | null,
  },
}));
// Auto-place suggestion returned by bp_next_available_da_slot.
const slotRow = vi.hoisted(() => ({
  current: { slot_start: '2026-06-15', slot_end: '2026-07-10' } as
    | { slot_start: string; slot_end: string }
    | null,
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      if (name === 'bp_create_project_with_permits') {
        return Promise.resolve(createResult.current);
      }
      if (name === 'bp_next_available_da_slot') {
        return Promise.resolve({
          data: slotRow.current ? [slotRow.current] : [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [{ name: 'Building Permit', is_builtin: true, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

const TEAM = [
  { id: 'ent-bobby', name: 'Bobby', role: 'ent_lead', active: true, former: false },
  { id: 'acq-jake', name: 'Jake', role: 'acq_lead', active: true, former: false },
  { id: 'da-trevor', name: 'Trevor', role: 'da', active: true, former: false },
  {
    id: 'da-chad', name: 'Chad', role: 'da', active: false, former: false,
    active_start_quarter: null, active_end_quarter: '2026-Q1',
  },
].map((m) => ({
  email: null, notes: null, updated_at: '',
  active_start_quarter: null, active_end_quarter: null, ...m,
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: TEAM,
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({
      map: new Map<string, unknown>(), data: [], isLoading: false, error: null, refetch: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useDaTeamRouting', async (importActual) => {
  const actual =
    await importActual<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual,
    useDaTeamRouting: () => ({
      data: [{ da: 'Trevor', jurisdiction: 'Seattle' }],
      isLoading: false, error: null, refetch: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [], subtasks: [], byScope: new Map(),
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
const placeOnDa = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({ mutateAsync: placeOnDa, isPending: false }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import Step1ProjectInfo from '../components/wizard/Step1ProjectInfo';
import NewProjectWizard from '../components/NewProjectWizard';

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function StepHarness({ initial }: { initial: WizardState }) {
  const [value, setValue] = useState(initial);
  return (
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <Step1ProjectInfo
          value={value}
          onChange={(p) => setValue((v) => ({ ...v, ...p }))}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function redesignState(over: Partial<WizardState> = {}): WizardState {
  return {
    ...makeEmptyWizardState(),
    address: '500 Pike St [Redesign 1]',
    juris: 'Seattle',
    units: '2',
    redesign_of_project_id: 'parent-uuid',
    redesign_of_project_address: '500 Pike St',
    redesign_trigger: 'builder',
    redesign_reuses_original_permit: 'yes',
    ...over,
  };
}

function renderWizard(initialState: WizardState) {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <NewProjectWizard open onClose={vi.fn()} initialState={initialState} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcFn.mockClear();
  navigate.mockClear();
  placeOnDa.mockClear();
  slotRow.current = { slot_start: '2026-06-15', slot_end: '2026-07-10' };
  createResult.current = {
    data: [{ project_id: 'redesign-uuid', permit_ids: [], conflict: false }],
    error: null,
  };
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('Redesign DD phase — Step 1 section', () => {
  it('does not render when redesign does NOT reuse the original permit', () => {
    render(<StepHarness initial={redesignState({ redesign_reuses_original_permit: 'no' })} />);
    expect(screen.queryByTestId('wizard-section-redesign-dd')).toBeNull();
  });

  it('renders when reuse=yes, with a blank DA default', () => {
    render(<StepHarness initial={redesignState()} />);
    expect(screen.getByTestId('wizard-section-redesign-dd')).toBeTruthy();
    const da = screen.getByTestId('wizard-redesign-dd-da') as HTMLSelectElement;
    expect(da.value).toBe('');
  });

  it('auto-place mode fills the dates read-only when a DA is picked', async () => {
    render(<StepHarness initial={redesignState()} />);
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-da'), {
      target: { value: 'Trevor' },
    });
    const start = () => screen.getByTestId('wizard-redesign-dd-start') as HTMLInputElement;
    await waitFor(() => expect(start().value).toBe('2026-06-15'));
    expect(
      (screen.getByTestId('wizard-redesign-dd-end') as HTMLInputElement).value,
    ).toBe('2026-07-10');
    // Read-only in auto-place mode.
    expect(start().readOnly).toBe(true);
  });

  it('flipping the manual toggle makes the dates editable and keeps the auto values', async () => {
    render(<StepHarness initial={redesignState()} />);
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-da'), {
      target: { value: 'Trevor' },
    });
    const start = () => screen.getByTestId('wizard-redesign-dd-start') as HTMLInputElement;
    await waitFor(() => expect(start().value).toBe('2026-06-15'));
    fireEvent.click(screen.getByTestId('wizard-redesign-dd-manual-toggle'));
    // Value stays; field is now editable.
    expect(start().value).toBe('2026-06-15');
    expect(start().readOnly).toBe(false);
  });

  it('backfill mode forces manual (toggle hidden) and opens the DA picker to inactive', () => {
    render(<StepHarness initial={redesignState({ backfill_mode: true })} />);
    // Manual toggle hidden in backfill mode.
    expect(screen.queryByTestId('wizard-redesign-dd-manual-toggle')).toBeNull();
    // Dates editable (not auto-placed).
    expect(
      (screen.getByTestId('wizard-redesign-dd-start') as HTMLInputElement).readOnly,
    ).toBe(false);
    // Inactive DA listed in the redesign DD picker specifically (the lead-DA
    // picker also opens to inactive in backfill mode, hence the scoping).
    const chad = within(screen.getByTestId('wizard-redesign-dd-da')).getByTestId(
      'wizard-role-da-option-inactive-da-chad',
    );
    expect(chad.textContent).toBe('Chad (inactive, ended 2026-Q1)');
  });

  it('shows the tenure warning for an out-of-window inactive DA (backfill mode)', () => {
    render(
      <StepHarness
        initial={redesignState({
          backfill_mode: true,
          redesign_dd_da: 'Chad', // ended 2026-Q1
          redesign_dd_start: '2026-08-01', // Q3 — outside
        })}
      />,
    );
    const warn = screen.getByTestId('wizard-redesign-dd-tenure-warning');
    expect(warn.textContent).toContain('Chad');
    expect(warn.textContent).toContain('2026-Q1');
  });
});

describe('Redesign DD phase — full wizard submit', () => {
  function gotoStep4AndSave() {
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));
  }
  const createCall = () =>
    rpcFn.mock.calls.find((c) => c[0] === 'bp_create_project_with_permits')?.[1] as
      | { p_redesign_dd_phase?: { da: string; dd_start: string; dd_end: string } }
      | undefined;

  it('blocks submit when the DD phase is blank', async () => {
    renderWizard(redesignState());
    gotoStep4AndSave();
    await waitFor(() =>
      expect(screen.getByTestId('wizard-validation').textContent).toMatch(
        /Redesign DD phase/i,
      ),
    );
    expect(createCall()).toBeFalsy();
  });

  it('sends redesign_dd_phase and Monday-snaps a Saturday dd_start', async () => {
    renderWizard(redesignState());
    // Manual mode first (avoid the auto-place lookahead), then DA + dates.
    fireEvent.click(screen.getByTestId('wizard-redesign-dd-manual-toggle'));
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-da'), {
      target: { value: 'Trevor' },
    });
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-start'), {
      target: { value: '2026-06-13' }, // Saturday → Mon 2026-06-15
    });
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-end'), {
      target: { value: '2026-07-17' }, // Friday
    });
    gotoStep4AndSave();

    await waitFor(() => expect(createCall()).toBeTruthy());
    expect(createCall()!.p_redesign_dd_phase).toEqual({
      da: 'Trevor',
      dd_start: '2026-06-15',
      dd_end: '2026-07-17',
    });
  });
});
