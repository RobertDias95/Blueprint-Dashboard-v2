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
import { makeEmptyWizardState } from '../components/wizard/wizardState';

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
          product_types: ['Townhouse'],
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

  it('fix-107: lead_da threads through project_data to the RPC payload', async () => {
    // Step 1's Lead DA must reach bp_create_project_with_permits via
    // p_project_data.lead_da so the BP gets auto-placed at that DA's
    // first available draw_schedule slot. Hook-level wire test pins
    // the JSON shape; the slot-finding math lives in the SQL function
    // (verified in the migration's MCP sandbox dry-run).
    mocks.setResult({
      data: [
        {
          project_id: '33333333-3333-3333-3333-333333333333',
          permit_ids: [30000],
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
        address: '500 Pike St',
        juris: 'Seattle',
        project_data: { lead_da: 'Trevor' },
        permits: [{ type: 'Building Permit', task_template_ids: [] }],
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data).toMatchObject({ lead_da: 'Trevor' });
  });

  // fix-126: four redesign-concept fields thread through project_data
  // verbatim. The RPC handles NULLIF on its end. On a reuse=true
  // redesign the caller is expected to send empty `permits` — the RPC
  // skips permit creation either way (defensive).
  it('fix-126: redesign fields (parent FK, trigger, reuse, notes) thread through project_data', async () => {
    mocks.setResult({
      data: [
        {
          project_id: 'r-1111-1111-1111-111111111111',
          permit_ids: [],
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
        address: '500 Pike St [Redesign 1]',
        juris: 'Seattle',
        project_data: {
          redesign_of_project_id: 'parent-uuid-here',
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: true,
          redesign_notes: 'Builder asked for 4-plex layout instead of 3.',
        },
        permits: [], // reuse=true → wizard sends empty
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data).toMatchObject({
      redesign_of_project_id: 'parent-uuid-here',
      redesign_trigger: 'builder',
      redesign_reuses_original_permit: true,
      redesign_notes: 'Builder asked for 4-plex layout instead of 3.',
    });
    expect(args.p_permits).toEqual([]);
  });

  // fix-216: reused_from_project_id threads through project_data verbatim so
  // the RPC can store the reuse provenance link (the copied product/units are
  // sent as ordinary product_types + unit_types).
  it('fix-216: reused_from_project_id threads through project_data', async () => {
    mocks.setResult({
      data: [
        { project_id: '55555555-5555-5555-5555-555555555555', permit_ids: [50000], conflict: false },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProjectWithPermits(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        address: '77 Reuse Way',
        juris: 'Seattle',
        project_data: {
          reused_from_project_id: 'source-uuid-here',
          product_types: ['SFR'],
        },
        permits: [],
      });
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data).toMatchObject({
      reused_from_project_id: 'source-uuid-here',
      product_types: ['SFR'],
    });
  });

  // fix-122: three new project-level fields. The hook passes them
  // through verbatim into p_project_data — the RPC handles NULLIF on
  // its end (extended in fix_122_b migration). Mirrors fix-107's
  // lead_da wire test.
  it('fix-122: num_lots / is_corner_lot / closing_date thread through project_data', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '44444444-4444-4444-4444-444444444444',
          permit_ids: [40000],
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
        address: '700 Cherry St',
        juris: 'Seattle',
        project_data: {
          num_lots: 3,
          is_corner_lot: true,
          closing_date: '2026-09-30',
        },
        permits: [{ type: 'Building Permit', task_template_ids: [] }],
      });
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data).toMatchObject({
      num_lots: 3,
      is_corner_lot: true,
      closing_date: '2026-09-30',
    });
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
    });
    // fix-91: ENT/DM dropdowns removed from Step 1 (derive on Step 3).
    // Set the ACQ Target instead so the BP row's expected_issue lands.
    fireEvent.change(screen.getByTestId('wizard-acq-target'), {
      target: { value: '2026-09-15' },
    });
    fireEvent.change(screen.getByTestId('wizard-zone'), {
      target: { value: 'LR2' },
    });
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 4
    fireEvent.click(screen.getByTestId('wizard-save'));

    const createCalls = () =>
      mocks.rpcFn.mock.calls.filter(
        (c) => c[0] === 'bp_create_project_with_permits',
      );
    await waitFor(() => {
      expect(createCalls()).toHaveLength(1);
    });
    const args = createCalls()[0][1] as {
      p_address: string;
      p_juris: string;
      p_project_data: {
        entitlement_lead: string | null;
        design_manager: string | null;
        zone: string | null;
        product_types: string[];
      };
      p_permits: { type: string; task_template_ids: string[]; expected_issue?: string }[];
    };
    expect(args.p_address).toBe('123 Main');
    expect(args.p_juris).toBe('Seattle');
    // fix-91: no DA was picked on Step 3 → ent_lead routes to null.
    expect(args.p_project_data.entitlement_lead).toBeNull();
    expect(args.p_project_data.design_manager).toBeNull();
    expect(args.p_project_data.zone).toBe('LR2');
    // fix-91: BP inherits the Step-1 ACQ Target as its expected_issue.
    const bpInPayload = args.p_permits.find((p) => p.type === 'Building Permit');
    expect(bpInPayload?.expected_issue).toBe('2026-09-15');
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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
    // fix-175: owner LLC address (-> catalog) + per-project point-of-contact.
    fireEvent.change(screen.getByTestId('wizard-builder-address'), {
      target: { value: '123 Owner LLC Way, Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-poc-name'), {
      target: { value: 'Dana Deal' },
    });
    fireEvent.change(screen.getByTestId('wizard-poc-email'), {
      target: { value: 'dana@deal.test' },
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
    expect(args.p_project_data.builder_address).toBe('123 Owner LLC Way, Seattle');
    expect(args.p_project_data.poc_name).toBe('Dana Deal');
    expect(args.p_project_data.poc_email).toBe('dana@deal.test');
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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
    // fix-175: address + POC are optional too — empty -> null on the wire.
    expect(args.p_project_data.builder_address).toBeNull();
    expect(args.p_project_data.poc_name).toBeNull();
    expect(args.p_project_data.poc_email).toBeNull();
  });

  // fix-122: end-to-end wizard flow with the three new fields. The
  // Step 1 inputs use string-typed values; the submit handler converts
  // num_lots via intOrNull, is_corner_lot via boolFromTri, closing_date
  // via strOrNull. Pins the wire shape so the RPC sees clean types.
  it('fix-122: three new fields flow through wizard submit with correct wire types', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '77777777-7777-7777-7777-777777777777',
          permit_ids: [70000],
          conflict: false,
        },
      ],
      error: null,
    });

    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '900 Subdivision Ln' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByTestId('wizard-num-lots'), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByTestId('wizard-is-corner-lot'), {
      target: { value: 'yes' },
    });
    fireEvent.change(screen.getByTestId('wizard-closing-date'), {
      target: { value: '2026-09-30' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data.num_lots).toBe(5);
    expect(args.p_project_data.is_corner_lot).toBe(true);
    expect(args.p_project_data.closing_date).toBe('2026-09-30');
  });

  // fix-122: defaults flow as null when the user leaves them blank — the
  // wizard must not silently default Corner to false (the schema lets
  // historical projects sit at NULL).
  it('fix-122: blank num_lots / is_corner_lot / closing_date land as null on the wire', async () => {
    mocks.setResult({
      data: [
        {
          project_id: '88888888-8888-8888-8888-888888888888',
          permit_ids: [80000],
          conflict: false,
        },
      ],
      error: null,
    });

    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '901 Skipped Ln' },
    });
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '4' },
    });
    // Leave Lots / Corner / Closing untouched.
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    });
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_project_data.num_lots).toBeNull();
    expect(args.p_project_data.is_corner_lot).toBeNull();
    expect(args.p_project_data.closing_date).toBeNull();
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '2' },
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

  // fix-88: Units is a required step-1 field. 2 prod projects were
  // saved with NULL units before this gate. Same banner pattern as the
  // address + juris gates that already existed.
  describe('fix-88: Units required at Step 1', () => {
    it('Next on Step 1 with empty Units shows the inline validation banner', () => {
      renderWizard();
      fireEvent.change(screen.getByTestId('wizard-address'), {
        target: { value: '123 Main' },
      });
      fireEvent.change(screen.getByTestId('wizard-juris'), {
        target: { value: 'Seattle' },
      });
      // Units left at the empty default → step gate fails.
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
        /Units count is required/i,
      );
      expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    });

    it('Next on Step 1 with Units=0 also fails the gate', () => {
      renderWizard();
      fireEvent.change(screen.getByTestId('wizard-address'), {
        target: { value: '123 Main' },
      });
      fireEvent.change(screen.getByTestId('wizard-juris'), {
        target: { value: 'Seattle' },
      });
      fireEvent.change(screen.getByTestId('wizard-units'), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
        /Units count is required/i,
      );
      expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    });

    it('typing a positive integer clears the banner and lets Step 2 render on Next', () => {
      renderWizard();
      fireEvent.change(screen.getByTestId('wizard-address'), {
        target: { value: '123 Main' },
      });
      fireEvent.change(screen.getByTestId('wizard-juris'), {
        target: { value: 'Seattle' },
      });
      fireEvent.click(screen.getByTestId('wizard-next')); // banner fires
      expect(screen.getByTestId('wizard-validation')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('wizard-units'), {
        target: { value: '4' },
      });
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    });

    it('clearing Units after advancing re-blocks Next on Step 1 (defence in depth)', () => {
      // Walk to step 2 with valid units, jump back to step 1 (tabs only
      // allow backward), wipe Units, click Next → the gate re-fires.
      renderWizard();
      fireEvent.change(screen.getByTestId('wizard-address'), {
        target: { value: '123 Main' },
      });
      fireEvent.change(screen.getByTestId('wizard-juris'), {
        target: { value: 'Seattle' },
      });
      fireEvent.change(screen.getByTestId('wizard-units'), {
        target: { value: '2' },
      });
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
      // Back to step 1, wipe Units.
      fireEvent.click(screen.getByTestId('wizard-step-tab-1'));
      fireEvent.change(screen.getByTestId('wizard-units'), {
        target: { value: '' },
      });
      // Next must NOT advance — banner appears.
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
        /Units count is required/i,
      );
      expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    });
  });

  // fix-126: redesign mode. The wizard opens with an `initialState` seed
  // that carries redesign_of_project_id (and prefilled site/proposal/
  // builder fields). Step 1 renders a redesign header + a Redesign
  // Details section; Step 3 conditionally renders a reuse banner when
  // reuses=yes and the submit path sends empty permits[] in that case.
  describe('fix-126: redesign mode', () => {
    function renderWizardWithSeed(seed: import('../components/wizard/wizardState').WizardState) {
      const { wrapper: Wrapper } = setup();
      const utils = render(
        <Wrapper>
          <NewProjectWizard
            open={true}
            onClose={vi.fn()}
            initialState={seed}
          />
        </Wrapper>,
      );
      return utils;
    }

    function makeRedesignSeed(over: Partial<import('../components/wizard/wizardState').WizardState> = {}): import('../components/wizard/wizardState').WizardState {
      const empty = makeEmptyWizardState();
      return {
        ...empty,
        // Seeded by the "Spawn Redesign" entry point in real life.
        address: '500 Pike St [Redesign 1]',
        juris: 'Seattle',
        units: '4',
        redesign_of_project_id: 'parent-uuid',
        redesign_of_project_address: '500 Pike St',
        ...over,
      };
    }

    it('renders the redesign header on Step 1 with the original address', () => {
      renderWizardWithSeed(makeRedesignSeed());
      expect(screen.getByTestId('wizard-redesign-header')).toBeInTheDocument();
      expect(
        screen.getByTestId('wizard-redesign-header-original').textContent,
      ).toBe('500 Pike St');
    });

    it('Redesign Details section renders trigger + reuse + notes inputs', () => {
      renderWizardWithSeed(makeRedesignSeed());
      expect(screen.getByTestId('wizard-section-redesign')).toBeInTheDocument();
      const trigger = screen.getByTestId('wizard-redesign-trigger') as HTMLSelectElement;
      expect([...trigger.options].map((o) => o.value)).toEqual([
        '', 'builder', 'ceo', 'acquisitions', 'design_mgmt',
        'design_associate', 'city_correction', 'market', 'other',
      ]);
      const reuse = screen.getByTestId('wizard-redesign-reuses') as HTMLSelectElement;
      expect([...reuse.options].map((o) => o.value)).toEqual(['', 'yes', 'no']);
      expect(screen.getByTestId('wizard-redesign-notes')).toBeInTheDocument();
    });

    it('non-redesign wizard does NOT render the redesign header or section', () => {
      // Standard new-project open (no initialState).
      const { wrapper: Wrapper } = setup();
      render(
        <Wrapper>
          <NewProjectWizard open={true} onClose={vi.fn()} />
        </Wrapper>,
      );
      expect(screen.queryByTestId('wizard-redesign-header')).toBeNull();
      expect(screen.queryByTestId('wizard-section-redesign')).toBeNull();
    });

    it('reuse=yes shows the Step 3 reuse banner and hides permit rows', () => {
      renderWizardWithSeed(
        makeRedesignSeed({
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: 'yes',
        }),
      );
      // Advance through Steps 1 → 2 → 3.
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      // Step 3 reuse banner replaces the permit row UI.
      expect(
        screen.getByTestId('wizard-step-3-reuse-banner'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('wizard-step-3-add-permit'),
      ).toBeNull();
    });

    it('reuse=no Step 3 renders normal permit rows', () => {
      renderWizardWithSeed(
        makeRedesignSeed({
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: 'no',
        }),
      );
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      expect(
        screen.queryByTestId('wizard-step-3-reuse-banner'),
      ).toBeNull();
      expect(
        screen.getByTestId('wizard-step-3-add-permit'),
      ).toBeInTheDocument();
    });

    it('submit with trigger=builder + reuse=yes sends empty permits + four redesign fields', async () => {
      mocks.setResult({
        data: [
          {
            project_id: 'redesign-uuid',
            permit_ids: [],
            conflict: false,
          },
        ],
        error: null,
      });
      renderWizardWithSeed(
        makeRedesignSeed({
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: 'yes',
          redesign_notes: 'Builder wanted 4-plex',
        }),
      );
      // fix-144: reuse=yes now requires a Redesign DD phase. Toggle manual
      // dates FIRST (so no auto-place lookahead fires), then pick DA + dates.
      fireEvent.click(screen.getByTestId('wizard-redesign-dd-manual-toggle'));
      fireEvent.change(screen.getByTestId('wizard-redesign-dd-da'), {
        target: { value: 'Trevor' },
      });
      fireEvent.change(screen.getByTestId('wizard-redesign-dd-start'), {
        target: { value: '2026-06-15' },
      });
      fireEvent.change(screen.getByTestId('wizard-redesign-dd-end'), {
        target: { value: '2026-07-17' },
      });
      // Advance to Step 4 + submit. No permit changes in Step 3 because
      // the banner replaces the row UI.
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-save'));
      const createCall = () =>
        mocks.rpcFn.mock.calls.find(
          (c) => c[0] === 'bp_create_project_with_permits',
        );
      await waitFor(() => expect(createCall()).toBeTruthy());
      const args = createCall()![1];
      expect(args.p_project_data).toMatchObject({
        redesign_of_project_id: 'parent-uuid',
        redesign_trigger: 'builder',
        redesign_reuses_original_permit: true,
        redesign_notes: 'Builder wanted 4-plex',
      });
      expect(args.p_permits).toEqual([]);
      // fix-144: the redesign DD phase rides along so the RPC builds the lane.
      expect(args.p_redesign_dd_phase).toMatchObject({
        da: 'Trevor',
        dd_start: '2026-06-15',
        dd_end: '2026-07-17',
      });
    });

    it('submit with trigger blank shows validation banner + stays on Step 1', () => {
      renderWizardWithSeed(
        makeRedesignSeed({
          redesign_reuses_original_permit: 'yes',
        }),
      );
      // Advance + try to save without picking trigger.
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-next'));
      fireEvent.click(screen.getByTestId('wizard-save'));
      // Wizard bounces back to Step 1 with the validation banner.
      expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
      expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
        /Trigger Source/i,
      );
      // No RPC fired.
      expect(mocks.rpcFn).not.toHaveBeenCalled();
    });
  });
});
