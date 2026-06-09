import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  makeEmptyWizardState,
  type WizardState,
  type WizardPermit,
} from '../components/wizard/wizardState';

// fix-143: "Backfill historical project" wizard mode.
//   - Toggle at the top of Step 1.
//   - Role pickers (acq_lead + lead_da on Step 1; ent + per-permit da on
//     Step 3) open to inactive + former members with a status suffix. (DM has
//     no picker — it's derived from the DA — so there are 3 pickable roles.)
//   - Manual DD Start / DD End inputs (BP only), Monday/Friday-snapped on
//     submit, replace auto-placement; required once a lead DA is picked.
//   - Soft tenure warning when a DD date falls outside the DA's tenure.
//   - The created draw_schedule lane is flagged manually_placed.

const T = 'test-tenant-uuid';

// rpc mock: dispatch by name so bp_ent_lead_for_da resolves to null (not the
// default []), and the create RPC returns a project_id.
const rpcFn = vi.hoisted(() => vi.fn());
const createResult = vi.hoisted(() => ({
  current: {
    data: [
      { project_id: '99999999-9999-9999-9999-999999999999', permit_ids: [1], conflict: false },
    ] as unknown,
    error: null as Error | null,
  },
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      if (name === 'bp_create_project_with_permits') {
        return Promise.resolve(createResult.current);
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
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
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Active + inactive/former members across the pickable roles.
const TEAM = [
  { id: 'ent-bobby', name: 'Bobby', role: 'ent_lead', active: true, former: false },
  { id: 'ent-old', name: 'OldEnt', role: 'ent_lead', active: false, former: false },
  { id: 'acq-jake', name: 'Jake', role: 'acq_lead', active: true, former: false },
  { id: 'acq-old', name: 'OldAcq', role: 'acq_lead', active: false, former: false },
  { id: 'da-trevor', name: 'Trevor', role: 'da', active: true, former: false },
  // inactive, ended 2026-Q1
  {
    id: 'da-chad',
    name: 'Chad',
    role: 'da',
    active: false,
    former: false,
    active_start_quarter: null,
    active_end_quarter: '2026-Q1',
  },
  // former
  { id: 'da-gus', name: 'Gus', role: 'da', active: false, former: true },
].map((m) => ({
  email: null,
  notes: null,
  updated_at: '',
  active_start_quarter: null,
  active_end_quarter: null,
  ...m,
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
      map: new Map<string, unknown>(),
      data: [], isLoading: false, error: null, refetch: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useDaTeamRouting', async (importActual) => {
  const actual =
    await importActual<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual, // keep real daHasRoutingFor + lookupEntLeadForDa
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
import Step3Permits from '../components/wizard/Step3Permits';
import NewProjectWizard from '../components/NewProjectWizard';

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Stateful harness for a single wizard step (Step1/Step3). */
function StepHarness({
  initial,
  render: renderStep,
}: {
  initial: WizardState;
  render: (
    value: WizardState,
    onChange: (p: Partial<WizardState>) => void,
  ) => ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        {renderStep(value, (p) => setValue((v) => ({ ...v, ...p })))}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderStep1(initial: WizardState) {
  return render(
    <StepHarness
      initial={initial}
      render={(value, onChange) => (
        <Step1ProjectInfo value={value} onChange={onChange} />
      )}
    />,
  );
}

function renderStep3(initial: WizardState) {
  return render(
    <StepHarness
      initial={initial}
      render={(value, onChange) => (
        <Step3Permits value={value} onChange={onChange} />
      )}
    />,
  );
}

function renderWizard() {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <NewProjectWizard open onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcFn.mockClear();
  navigate.mockClear();
  placeOnDa.mockClear();
  createResult.current = {
    data: [
      { project_id: '99999999-9999-9999-9999-999999999999', permit_ids: [1], conflict: false },
    ],
    error: null,
  };
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('Step 1 — backfill toggle OFF (normal mode unchanged)', () => {
  it('hides manual DD inputs and lists only active members', () => {
    renderStep1(makeEmptyWizardState());
    expect(screen.queryByTestId('wizard-backfill-dd-start')).toBeNull();
    expect(screen.queryByTestId('wizard-backfill-dd-end')).toBeNull();
    // Inactive members are filtered out entirely when the toggle is off.
    expect(
      screen.queryByTestId('wizard-role-acq_lead-option-inactive-acq-old'),
    ).toBeNull();
    expect(
      screen.queryByTestId('wizard-role-da-option-inactive-da-chad'),
    ).toBeNull();
    // Active members still present.
    expect(screen.getByTestId('wizard-lead-da-opt-Trevor')).toBeTruthy();
  });
});

describe('Step 1 — backfill toggle ON', () => {
  const onState = (): WizardState => ({
    ...makeEmptyWizardState(),
    backfill_mode: true,
    juris: 'Seattle',
  });

  it('shows the manual DD inputs', () => {
    renderStep1(onState());
    expect(screen.getByTestId('wizard-backfill-dd-start')).toBeTruthy();
    expect(screen.getByTestId('wizard-backfill-dd-end')).toBeTruthy();
  });

  it('acq_lead + lead_da pickers list inactive/former members with a status suffix', () => {
    renderStep1(onState());
    const acqOld = screen.getByTestId(
      'wizard-role-acq_lead-option-inactive-acq-old',
    );
    expect(acqOld.textContent).toBe('OldAcq (inactive)');
    const chad = screen.getByTestId('wizard-role-da-option-inactive-da-chad');
    expect(chad.textContent).toBe('Chad (inactive, ended 2026-Q1)');
    const gus = screen.getByTestId('wizard-role-da-option-inactive-da-gus');
    expect(gus.textContent).toBe('Gus (former)');
  });

  it('shows the tenure warning when a DD date falls outside the DA window', () => {
    renderStep1({
      ...onState(),
      lead_da: 'Chad', // ended 2026-Q1 (Mar 31)
      backfill_dd_start: '2026-08-01', // Q3 — outside
    });
    const warn = screen.getByTestId('wizard-backfill-tenure-warning');
    expect(warn.textContent).toContain('Chad');
    expect(warn.textContent).toContain('2026-Q1');
  });

  it('hides the tenure warning when the DD date is within tenure', () => {
    renderStep1({
      ...onState(),
      lead_da: 'Chad', // ended 2026-Q1
      backfill_dd_start: '2026-02-15', // in Q1
    });
    expect(screen.queryByTestId('wizard-backfill-tenure-warning')).toBeNull();
  });
});

describe('Step 3 — per-permit pickers open to inactive when backfill ON', () => {
  function bf(): WizardState {
    const bp: WizardPermit = {
      rowId: 'bp1', type: 'Building Permit', selected: true,
      ent_lead: '', dm: '', da: 'Chad', dual_da: '', architect: '', num: '',
      expected_issue: '', target_submit: '', manuallyEdited: {}, taskTemplateIds: [],
    };
    const demo: WizardPermit = { ...bp, rowId: 'demo1', type: 'Demolition', da: '' };
    return {
      ...makeEmptyWizardState(),
      backfill_mode: true,
      juris: 'Seattle',
      permits: [bp, demo],
    };
  }

  it('ENT picker lists the inactive ent member; per-permit DA picker lists inactive/former DAs', () => {
    renderStep3(bf());
    // ENT inactive option on the (non-BP) Demolition row.
    expect(
      screen.getAllByTestId('wizard-role-ent_lead-option-inactive-ent-old')
        .length,
    ).toBeGreaterThan(0);
    // DA inactive + former options on the editable Demolition DA select.
    expect(
      screen.getAllByTestId('wizard-role-da-option-inactive-da-chad').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId('wizard-role-da-option-inactive-da-gus').length,
    ).toBeGreaterThan(0);
  });
});

describe('Full wizard — submit', () => {
  function fillStep1Basics() {
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '100 Historic Ave' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
    });
  }
  function gotoStep4AndSave() {
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 4
    fireEvent.click(screen.getByTestId('wizard-save'));
  }
  const createArgs = () =>
    rpcFn.mock.calls.find((c) => c[0] === 'bp_create_project_with_permits')?.[1] as
      | {
          p_manually_placed: boolean;
          p_permits: { type: string; dd_start?: string; dd_end?: string }[];
        }
      | undefined;

  it('fires create with the manual DD dates on the BP + manually_placed=true', async () => {
    renderWizard();
    fillStep1Basics();
    fireEvent.click(screen.getByTestId('wizard-backfill-mode-toggle'));
    fireEvent.change(screen.getByTestId('wizard-lead-da'), {
      target: { value: 'Chad' },
    });
    fireEvent.change(screen.getByTestId('wizard-backfill-dd-start'), {
      target: { value: '2026-06-15' }, // Monday
    });
    fireEvent.change(screen.getByTestId('wizard-backfill-dd-end'), {
      target: { value: '2026-07-17' }, // Friday
    });
    gotoStep4AndSave();

    await waitFor(() => expect(createArgs()).toBeTruthy());
    const args = createArgs()!;
    expect(args.p_manually_placed).toBe(true);
    const bp = args.p_permits.find((p) => p.type === 'Building Permit');
    expect(bp?.dd_start).toBe('2026-06-15');
    expect(bp?.dd_end).toBe('2026-07-17');
  });

  it('Monday-snaps a Saturday dd_start before sending', async () => {
    renderWizard();
    fillStep1Basics();
    fireEvent.click(screen.getByTestId('wizard-backfill-mode-toggle'));
    fireEvent.change(screen.getByTestId('wizard-lead-da'), {
      target: { value: 'Chad' },
    });
    fireEvent.change(screen.getByTestId('wizard-backfill-dd-start'), {
      target: { value: '2026-06-13' }, // Saturday → forward to Mon 06-15
    });
    fireEvent.change(screen.getByTestId('wizard-backfill-dd-end'), {
      target: { value: '2026-07-17' },
    });
    gotoStep4AndSave();

    await waitFor(() => expect(createArgs()).toBeTruthy());
    const bp = createArgs()!.p_permits.find((p) => p.type === 'Building Permit');
    expect(bp?.dd_start).toBe('2026-06-15');
  });

  it('blocks submit when backfill DD dates are blank but a DA is picked', async () => {
    renderWizard();
    fillStep1Basics();
    fireEvent.click(screen.getByTestId('wizard-backfill-mode-toggle'));
    fireEvent.change(screen.getByTestId('wizard-lead-da'), {
      target: { value: 'Chad' },
    });
    // Leave DD inputs blank.
    gotoStep4AndSave();

    await waitFor(() =>
      expect(screen.getByTestId('wizard-validation').textContent).toMatch(
        /DD Start and DD End/i,
      ),
    );
    expect(createArgs()).toBeFalsy();
  });
});
