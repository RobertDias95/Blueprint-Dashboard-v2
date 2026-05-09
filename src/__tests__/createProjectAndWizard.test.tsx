import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useToastStore } from '../stores/toastStore';

// Q5: Wire-shape tests for useCreateProjectWithPermits + behavior tests for
// NewProjectWizard. Mocks supabase.rpc with a hoisted builder.

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
});

// ============================================================
// useCreateProjectWithPermits hook
// ============================================================

describe('useCreateProjectWithPermits', () => {
  it('fires bp_create_project_with_permits with the full input', async () => {
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
        permits: [
          { type: 'Building Permit', da: 'Trevor' },
          { type: 'Demolition' },
        ],
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_create_project_with_permits');
    expect(args.p_address).toBe('123 Main St');
    expect(args.p_juris).toBe('Seattle');
    expect(args.p_notes).toBe('first project');
    expect(args.p_permits).toEqual([
      { type: 'Building Permit', da: 'Trevor' },
      { type: 'Demolition' },
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
        permits: [{ type: 'Building Permit' }],
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
          permits: [{ type: 'Building Permit' }],
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
// NewProjectWizard component
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

  it('rejects empty address with inline validation error', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('wizard-save'));
    expect(
      screen.getByText(/Please enter a project address/i),
    ).toBeInTheDocument();
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('rejects when no permit rows are present', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '123 Main' },
    });
    // Remove the default starting row.
    const removeButton = screen.getAllByTitle(/Remove permit row/i)[0];
    fireEvent.click(removeButton);
    fireEvent.click(screen.getByTestId('wizard-save'));
    expect(
      screen.getByText(/Please add at least one permit type/i),
    ).toBeInTheDocument();
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('on success: closes the modal and navigates to /project/:id', async () => {
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
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        '/project/33333333-3333-3333-3333-333333333333',
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('on conflict=true: shows the "view existing" UX, does NOT auto-navigate', async () => {
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
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      expect(
        screen.getByText(/This address already exists/i),
      ).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Clicking "View existing project" should navigate now.
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
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => {
      const err = useToastStore.getState().toasts.find((t) => t.kind === 'error');
      expect(err?.message).toMatch(/boom/i);
    });
    expect(onClose).not.toHaveBeenCalled();
    // Form data is still in the modal.
    expect(addressInput.value).toBe('999 Oak Ave');
  });
});
