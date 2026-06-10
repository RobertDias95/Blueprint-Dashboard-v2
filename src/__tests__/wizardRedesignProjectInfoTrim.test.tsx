import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  makeEmptyWizardState,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-152: in redesign mode the wizard hides Project Info fields that never
// change from the parent (zone / lots / corner / closing / alley / parking /
// project-tags / ACQ Target) + the project-level Lead DA; GO Date becomes
// "Redesign GO Date" (trigger date, defaults to today). Inherited values stay
// in state (seeded by makeRedesignWizardState) and still submit.

const T = 'test-tenant-uuid';

const rpcFn = vi.hoisted(() => vi.fn());
const createResult = vi.hoisted(() => ({
  current: {
    data: [{ project_id: 'redesign-uuid', permit_ids: [], conflict: false }] as unknown,
    error: null as Error | null,
  },
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      if (name === 'bp_create_project_with_permits') return Promise.resolve(createResult.current);
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
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [{ id: 'da1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '', active_start_quarter: null, active_end_quarter: null }],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({ map: new Map(), data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useDaTeamRouting', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual,
    useDaTeamRouting: () => ({ data: [{ da: 'Trevor', jurisdiction: 'Seattle' }], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({ templates: [], subtasks: [], byScope: new Map(), isLoading: false, error: null, refetch: vi.fn() }),
}));
const placeOnDa = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({ mutateAsync: placeOnDa, isPending: false }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import Step1ProjectInfo from '../components/wizard/Step1ProjectInfo';
import NewProjectWizard from '../components/NewProjectWizard';

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function StepHarness({ initial }: { initial: WizardState }) {
  const [value, setValue] = useState(initial);
  return (
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <Step1ProjectInfo value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function normalState(): WizardState {
  return { ...makeEmptyWizardState(), juris: 'Seattle', units: '3' };
}
function redesignState(over: Partial<WizardState> = {}): WizardState {
  // Mimics makeRedesignWizardState: redesign FK + inherited static fields.
  return {
    ...makeEmptyWizardState(),
    address: '10150 NE 64th St [Redesign 1]',
    juris: 'Seattle',
    units: '3',
    zone: 'RM 3.6',
    num_lots: '1',
    is_corner_lot: 'no',
    closing_date: '2026-01-15',
    alley: 'Yes',
    parking_type: 'Garage',
    parking_stalls: '2',
    lot_width: '40',
    lot_depth: '100',
    project_tags: ['ECA'],
    redesign_of_project_id: 'parent-uuid',
    redesign_of_project_address: '10150 NE 64th St',
    redesign_trigger: 'builder',
    redesign_reuses_original_permit: 'yes',
    ...over,
  };
}

const HIDDEN_TESTIDS = [
  'wizard-zone',
  'wizard-lead-da',
  'wizard-acq-target',
  'wizard-num-lots',
  'wizard-is-corner-lot',
  'wizard-closing-date',
  'wizard-alley',
  'wizard-parking-type',
  'wizard-parking-stalls',
  'wizard-lot-width',
  'wizard-lot-depth',
];

beforeEach(() => {
  rpcFn.mockClear();
  navigate.mockClear();
  placeOnDa.mockClear();
  createResult.current = { data: [{ project_id: 'redesign-uuid', permit_ids: [], conflict: false }], error: null };
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] } as never);
});

describe('Step 1 — non-redesign renders the full field set', () => {
  it('shows zone / lead DA / ACQ Target / lots / closing / alley / parking / lot dims', () => {
    render(<StepHarness initial={normalState()} />);
    for (const tid of HIDDEN_TESTIDS) {
      expect(screen.getByTestId(tid)).toBeTruthy();
    }
    expect(screen.getByText('Go Date')).toBeTruthy();
  });
});

describe('Step 1 — redesign mode trims Project Info', () => {
  it('hides the inherited/duplicative fields', () => {
    render(<StepHarness initial={redesignState()} />);
    for (const tid of HIDDEN_TESTIDS) {
      expect(screen.queryByTestId(tid)).toBeNull();
    }
  });

  it('keeps Address / Jurisdiction / Units / Notes visible', () => {
    render(<StepHarness initial={redesignState()} />);
    expect(screen.getByTestId('wizard-address')).toBeTruthy();
    expect(screen.getByTestId('wizard-juris')).toBeTruthy();
    expect(screen.getByTestId('wizard-units')).toBeTruthy();
    expect(screen.getByTestId('wizard-notes')).toBeTruthy();
  });

  it('relabels GO Date → "Redesign GO Date"', () => {
    render(<StepHarness initial={redesignState({ go_date: '2026-03-01' })} />);
    expect(screen.getByText('Redesign GO Date')).toBeTruthy();
    expect(screen.queryByText('Go Date')).toBeNull();
  });

  it('defaults the Redesign GO Date to today when none is set', async () => {
    render(<StepHarness initial={redesignState({ go_date: '' })} />);
    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() =>
      expect((screen.getByTestId('wizard-go-date') as HTMLInputElement).value).toBe(today),
    );
  });

  it('hides the project-level Lead DA but keeps the Redesign DD Phase DA picker', () => {
    render(<StepHarness initial={redesignState()} />);
    expect(screen.queryByTestId('wizard-lead-da')).toBeNull();
    // reuses_permit=yes → the fix-144 Redesign DD Phase section renders its DA.
    expect(screen.getByTestId('wizard-redesign-dd-da')).toBeTruthy();
  });
});

describe('Full wizard — redesign submit carries inherited fields', () => {
  it('sends the parent-inherited static fields in p_project_data', async () => {
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter>
          <NewProjectWizard open onClose={vi.fn()} initialState={redesignState()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // fix-144: reuses=yes requires the Redesign DD phase. Manual dates avoid the
    // auto-place lookahead.
    fireEvent.click(screen.getByTestId('wizard-redesign-dd-manual-toggle'));
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-da'), { target: { value: 'Trevor' } });
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-start'), { target: { value: '2026-06-15' } });
    fireEvent.change(screen.getByTestId('wizard-redesign-dd-end'), { target: { value: '2026-07-17' } });
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 4
    fireEvent.click(screen.getByTestId('wizard-save'));

    const createCall = () =>
      rpcFn.mock.calls.find((c) => c[0] === 'bp_create_project_with_permits')?.[1] as
        | { p_project_data: Record<string, unknown>; p_permits: unknown[] }
        | undefined;
    await waitFor(() => expect(createCall()).toBeTruthy());
    const pd = createCall()!.p_project_data;
    expect(pd).toMatchObject({
      zone: 'RM 3.6',
      num_lots: 1,
      closing_date: '2026-01-15',
      alley: 'Yes',
      parking_type: 'Garage',
      parking_stalls: 2,
      project_tags: ['ECA'],
      redesign_of_project_id: 'parent-uuid',
      redesign_reuses_original_permit: true,
    });
    // reuses=yes → no permits created.
    expect(createCall()!.p_permits).toEqual([]);
  });
});
