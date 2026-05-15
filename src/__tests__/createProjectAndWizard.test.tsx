import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

const T = 'test-tenant-uuid';

// fix-22: Wire-shape tests for useCreateProjectWithPermits (new payload
// including p_project_data + task_template_ids) and integration tests
// for the 4-step NewProjectWizard.

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown; error: Error | null } = {
    data: [],
    error: null,
  };
  const rpcFn = vi.fn();
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve(resolveResult);
    },
  };
  return {
    builder,
    rpcFn,
    setResult: (r: { data: unknown; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

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

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'PAR/Pre-Sub', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { id: '1', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '2', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '3', name: 'Jake', role: 'acq_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-2', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({
    data: [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
    ],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [],
    subtasks: [],
    byScope: new Map(),
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import { useCreateProjectWithPermits } from '../hooks/useCreateProjectWithPermits';
import NewProjectWizard from '../components/NewProjectWizard';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  navigate.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ============================================================
// useCreateProjectWithPermits hook — fix-22 RPC shape
// ============================================================

describe('useCreateProjectWithPermits (fix-22 signature)', () => {
  it('fires bp_create_project_with_permits with p_project_data + task_template_ids', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '11111111-1111-1111-1111-111111111111',
          permit_ids: [10000, 10001],
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        address: '123 Main St',
        juris: 'Seattle',
        notes: 'first project',
        project_data: {
          entitlement_lead: 'Bobby',
          design_manager: 'Jade',
          acq_lead: 'Jake',
          units: 4,
          zone: 'LR2',
          lot_width: 40,
          lot_depth: 100,
          parking_type: 'attached',
          parking_stalls: 4,
          alley: 'yes',
          product_type: 'Townhouse',
          project_tags: ['corner-lot'],
        },
        permits: [
          {
            type: 'Building Permit',
            da: 'Trevor',
            task_template_ids: ['tpl-1', 'tpl-2'],
          },
          { type: 'PAR/Pre-Sub', task_template_ids: [] },
        ],
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_create_project_with_permits');
    expect(args.p_tenant_id).toBe(T);
    expect(args.p_address).toBe('123 Main St');
    expect(args.p_juris).toBe('Seattle');
    expect(args.p_notes).toBe('first project');
    expect(args.p_project_data).toMatchObject({
      entitlement_lead: 'Bobby',
      design_manager: 'Jade',
      zone: 'LR2',
      project_tags: ['corner-lot'],
    });
    expect(args.p_permits).toEqual([
      {
        type: 'Building Permit',
        da: 'Trevor',
        task_template_ids: ['tpl-1', 'tpl-2'],
      },
      { type: 'PAR/Pre-Sub', task_template_ids: [] },
    ]);
  });

  it('fix-25c: passes per-permit expected_issue through to the RPC payload', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '22222222-2222-2222-2222-222222222222',
          permit_ids: [20000, 20001],
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        address: '999 Pine Ln',
        juris: 'Seattle',
        project_data: {},
        permits: [
          {
            type: 'Building Permit',
            expected_issue: '2026-08-15',
            task_template_ids: [],
          },
          {
            type: 'Demolition',
            target_submit: '2026-10-01', // separate field still flows
            task_template_ids: [],
          },
        ],
      });
    });

    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_permits).toEqual([
      {
        type: 'Building Permit',
        expected_issue: '2026-08-15',
        task_template_ids: [],
      },
      {
        type: 'Demolition',
        target_submit: '2026-10-01',
        task_template_ids: [],
      },
    ]);
  });

  it('surfaces conflict=true to the caller without throwing', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '22222222-2222-2222-2222-222222222222',
          permit_ids: [],
          conflict: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper,
    });

    type Response = Awaited<ReturnType<typeof result.current.mutateAsync>>;
    let response: Response | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        address: '123 Main St',
        juris: 'Seattle',
        project_data: {},
        permits: [{ type: 'Building Permit', task_template_ids: [] }],
      });
    });
    expect(response).toBeDefined();
    expect(response!.conflict).toBe(true);
    expect(response!.project_id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('emits an error toast on RPC failure and rejects', async () => {
    mocks.setResult({ data: null, error: new Error('connection refused') });

    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          address: '123 Main St',
          juris: 'Seattle',
          project_data: {},
          permits: [{ type: 'Building Permit', task_template_ids: [] }],
        }),
      ).rejects.toThrow(/connection refused/i);
    });

    await waitFor(() => {
      const err = useToastStore.getState().toasts.find((t) => t.kind === 'error');
      expect(err).toBeTruthy();
      expect(err?.message).toMatch(/connection refused/i);
    });
  });
});

// ============================================================
// <NewProjectWizard /> — 4-step Stepper integration
// ============================================================

describe('<NewProjectWizard />', () => {
  function renderWizard(props?: { onClose?: () => void }) {
    const onClose = props?.onClose ?? vi.fn();
    const { wrapper: Wrapper } = setup();
    const utils = render(
      <Wrapper>
        <NewProjectWizard open={true} onClose={onClose} />
      </Wrapper>,
    );
    return { ...utils, onClose };
  }

  it('opens on Step 1 with all 4 tabs visible', () => {
    renderWizard();
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-tab-1')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-tab-4')).toBeInTheDocument();
  });

  it('Next on Step 1 with empty address shows inline validation and stays on Step 1', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
      /Please enter a project address/i,
    );
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
  });

  it('Next on Step 1 with empty juris shows inline validation', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
      /Please pick a jurisdiction/i,
    );
  });

  it('advances through all 4 steps when Step 1 inputs are valid', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument();
    // On Step 4, Next is replaced by Save.
    expect(screen.getByTestId('wizard-save')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-next')).toBeNull();
  });

  it('clicking a tab for a previous step jumps back', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-step-tab-1'));
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
  });

  it('submitting from Step 4 fires RPC with p_project_data + auto-injected Building Permit', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '33333333-3333-3333-3333-333333333333',
          permit_ids: [10000],
          conflict: false,
        },
      ],
      error: null,
    });

    const { onClose } = renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-entitlement-lead'), {
      target: { value: 'Bobby' },
    });
    fireEvent.change(screen.getByTestId('wizard-zone'), {
      target: { value: 'LR2' },
    });
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 4
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_address).toBe('123 Main');
    expect(args.p_juris).toBe('Seattle');
    expect(args.p_project_data.entitlement_lead).toBe('Bobby');
    expect(args.p_project_data.zone).toBe('LR2');
    // Building Permit was auto-injected even though user didn't visit Step 3.
    const permits = args.p_permits as { type: string; task_template_ids: string[] }[];
    expect(permits.some((p) => p.type === 'Building Permit')).toBe(true);
    expect(permits[0]).toHaveProperty('task_template_ids');

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        '/project/33333333-3333-3333-3333-333333333333',
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('Builder / Owner fields land in p_project_data on submit (Migrations 6+7)', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '55555555-5555-5555-5555-555555555555',
          permit_ids: [10000],
          conflict: false,
        },
      ],
      error: null,
    });

    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '500 Builder Way' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-builder-name'), {
      target: { value: 'Jane Builder' },
    });
    fireEvent.change(screen.getByTestId('wizard-builder-company'), {
      target: { value: 'Acme Builders LLC' },
    });
    fireEvent.change(screen.getByTestId('wizard-builder-email'), {
      target: { value: 'jane@acme.test' },
    });
    fireEvent.change(screen.getByTestId('wizard-builder-phone'), {
      target: { value: '(206) 555-0100' },
    });
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> 4
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data.builder_name).toBe('Jane Builder');
    expect(args.p_project_data.builder_company).toBe('Acme Builders LLC');
    expect(args.p_project_data.builder_email).toBe('jane@acme.test');
    expect(args.p_project_data.builder_phone).toBe('(206) 555-0100');
  });

  it('omits empty Builder fields (renders as null on the wire)', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '66666666-6666-6666-6666-666666666666',
          permit_ids: [10000],
          conflict: false,
        },
      ],
      error: null,
    });

    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '600 No Builder Ave' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    // Skip Builder section entirely.
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    // strOrNull('') → null. Each builder field empties to null on the wire.
    expect(args.p_project_data.builder_name).toBeNull();
    expect(args.p_project_data.builder_company).toBeNull();
    expect(args.p_project_data.builder_email).toBeNull();
    expect(args.p_project_data.builder_phone).toBeNull();
  });

  it('on conflict=true: shows view-existing UX and does NOT navigate', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '44444444-4444-4444-4444-444444444444',
          permit_ids: [],
          conflict: true,
        },
      ],
      error: null,
    });

    const { onClose } = renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(
        screen.getByText(/This address already exists/i),
      ).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('wizard-view-existing'));
    expect(navigate).toHaveBeenCalledWith(
      '/project/44444444-4444-4444-4444-444444444444',
    );
  });

  it('preserves form data on RPC error (modal stays open)', async () => {
    mocks.setResult({ data: null, error: new Error('boom') });

    const { onClose } = renderWizard();
    const addressInput = screen.getByTestId('wizard-address') as HTMLInputElement;
    fireEvent.change(addressInput, { target: { value: '999 Oak Ave' } });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      const err = useToastStore.getState().toasts.find((t) => t.kind === 'error');
      expect(err?.message).toMatch(/boom/i);
    });
    expect(onClose).not.toHaveBeenCalled();
    // Jump back to Step 1 — form data still present.
    fireEvent.click(screen.getByTestId('wizard-step-tab-1'));
    expect(
      (screen.getByTestId('wizard-address') as HTMLInputElement).value,
    ).toBe('999 Oak Ave');
  });
});
