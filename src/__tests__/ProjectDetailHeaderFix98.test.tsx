import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { OCCConflictError } from '../lib/occ';
import { queryKeys } from '../lib/queryKeys';

// fix-98: UnitDimensions auto-recovers from OCC churn. Cam was hitting
// the "Unit Dimensions was modified by someone else" toast 2-3 times in
// a row on the same project — the cache's expected_updated_at wasn't
// advancing between clicks because the hook's onError invalidate is
// async (the rollback restores the stale snapshot while the refetch is
// in-flight). UnitDimensions now does a silent first save, catches
// OCCConflictError, awaits the refetch, and retries ONCE with the
// fresh updated_at.

const T = 'test-tenant-uuid';
const OLD_TOKEN = '2026-05-15T12:00:00Z';
const NEW_TOKEN = '2026-05-15T12:05:00Z';

const updateMutateAsync = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: toastMock }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-test',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: OLD_TOKEN,
    updated_at: OLD_TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function setup(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  toastMock.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('UnitDimensions — fix-98 OCC auto-recovery', () => {
  it('happy path: the first save fires with silentOnOcc=true and the project\'s current updated_at', async () => {
    updateMutateAsync.mockResolvedValueOnce({
      id: 'p-test',
      updated_at: NEW_TOKEN,
    });
    setup();
    // Compact mode renders two inputs since unit_types is empty/single-unnamed.
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const call = updateMutateAsync.mock.calls[0][0];
    expect(call.expectedUpdatedAt).toBe(OLD_TOKEN);
    expect(call.silentOnOcc).toBe(true);
    expect(call.fieldLabel).toBe('Unit Dimensions');
    expect(call.patch.unit_types[0].width_ft).toBe(40);
  });

  it('OCC → refetch → retry ONCE with the fresh token (and silentOnOcc=false on the retry)', async () => {
    // First attempt OCCs. Second attempt (post-refetch with fresh token) succeeds.
    updateMutateAsync
      .mockRejectedValueOnce(new OCCConflictError(0, 'Unit Dimensions'))
      .mockResolvedValueOnce({ id: 'p-test', updated_at: NEW_TOKEN });

    const { queryClient } = setup();
    // Simulate what the hook's invalidateQueries + the refetch chain
    // would land in the cache (the test mocks the mutation directly so
    // there's no real network refetch — patch the cache here to mirror
    // what refetchQueries would deliver).
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    // Defer the cache patch until refetchQueries is awaited inside
    // writeTypes. queryClient.setQueryData wins the race because the
    // refetchQueries call resolves immediately when there are no
    // active observers attached to a real fetchFn.
    queryClient.setQueryData(queryKeys.projects(T), [
      projectFixture({ updated_at: NEW_TOKEN }),
    ]);
    fireEvent.blur(wInput);

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(2));
    const first = updateMutateAsync.mock.calls[0][0];
    const second = updateMutateAsync.mock.calls[1][0];
    expect(first.expectedUpdatedAt).toBe(OLD_TOKEN);
    expect(first.silentOnOcc).toBe(true);
    // Retry pulls the fresh token + drops silentOnOcc so a real
    // second concurrent edit still surfaces the hook's existing toast.
    expect(second.expectedUpdatedAt).toBe(NEW_TOKEN);
    expect(second.silentOnOcc).toBeUndefined();
    expect(second.patch.unit_types[0].width_ft).toBe(40);
  });

  it('OCC + refetch returns the SAME stale token → no retry, manually push the OCC toast', async () => {
    // First attempt OCCs. The refetch lands the same updated_at back
    // in the cache (backend stuck OR an immediate-rollback race);
    // there is no fresh token to retry with — surface the OCC error
    // to the user.
    updateMutateAsync.mockRejectedValueOnce(
      new OCCConflictError(0, 'Unit Dimensions'),
    );
    setup(); // cache stays at OLD_TOKEN
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    // No retry — the cache didn't move forward.
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
    });
    expect(toastMock.mock.calls[0][0]).toContain(
      'Unit Dimensions was modified by someone else',
    );
    expect(toastMock.mock.calls[0][1]).toBe('warn');
  });

  it('NON-OCC error from the first attempt is re-thrown — no refetch, no retry', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('network glitch'));
    setup();
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    // No second call — we only auto-recover OCC, not generic errors.
    await new Promise((r) => setTimeout(r, 20));
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
  });
});

/** Controlled host so a test can flip the project prop in-place,
 *  mirroring what React Query does after a cache write. The host
 *  preserves the component tree (no remount), so UnitDimensionsCompact
 *  sees the new prop via the useEffect dep, not via a fresh mount. */
function ControlledHost({
  initial,
  hostRef,
}: {
  initial: Parameters<typeof ProjectDetailHeader>[0]['project'];
  hostRef: { setProject: (p: typeof initial) => void };
}) {
  const [project, setProject] = useState(initial);
  // Capturing setState into a test-controlled ref is deliberate — same
  // pattern as PermitDetailV2Fix25d's ControlledHost. The react-hooks
  // immutability rule flags any prop mutation, but the ref-object IS
  // the test's contract for flipping the project prop in-place.
  // eslint-disable-next-line react-hooks/immutability
  hostRef.setProject = setProject;
  return <ProjectDetailHeader project={project} permits={[]} bp={null} />;
}

function setupControlled(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hostRef: {
    setProject: (p: typeof project) => void;
  } = { setProject: () => {} };
  const utils = render(<ControlledHost initial={project} hostRef={hostRef} />, {
    wrapper,
  });
  return { ...utils, queryClient, hostRef };
}

describe('UnitDimensionsCompact — fix-98 dirty-flag prop sync', () => {
  it('clean (non-dirty) prop refresh updates the visible width input', async () => {
    const { hostRef } = setupControlled({
      unit_types: [{ label: '', width_ft: 30, depth_ft: 60, qty: 1 }],
    });
    expect(
      (screen.getByTestId('pd-units-compact-w') as HTMLInputElement).value,
    ).toBe('30');

    // Flip the project prop — what React Query would do after a
    // successful save lands in the cache. No remount; the
    // UnitDimensionsCompact useEffect re-syncs from the new prop.
    hostRef.setProject(
      projectFixture({
        unit_types: [{ label: '', width_ft: 45, depth_ft: 60, qty: 1 }],
      }),
    );
    await waitFor(() => {
      expect(
        (screen.getByTestId('pd-units-compact-w') as HTMLInputElement).value,
      ).toBe('45');
    });
  });

  it('dirty (mid-typing) inputs are preserved across a prop refresh', async () => {
    const { hostRef } = setupControlled({
      unit_types: [{ label: '', width_ft: 30, depth_ft: 60, qty: 1 }],
    });
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    // User starts typing. dirtyRef flips to true.
    fireEvent.change(wInput, { target: { value: '99' } });
    expect(wInput.value).toBe('99');

    // Prop refresh mid-edit — e.g. an OCC rollback puts the cache
    // back to the original width. The dirty flag must protect the
    // typed value or Bobby loses what he typed and has to start over.
    hostRef.setProject(
      projectFixture({
        unit_types: [{ label: '', width_ft: 30, depth_ft: 60, qty: 1 }],
      }),
    );
    // Without the dirty flag the input would revert to '30'.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      (screen.getByTestId('pd-units-compact-w') as HTMLInputElement).value,
    ).toBe('99');
  });

  it('blurring clears the dirty flag, so the NEXT prop refresh re-syncs', async () => {
    updateMutateAsync.mockResolvedValue({
      id: 'p-test',
      updated_at: NEW_TOKEN,
    });
    const { hostRef } = setupControlled({
      unit_types: [{ label: '', width_ft: 30, depth_ft: 60, qty: 1 }],
    });
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '99' } });
    fireEvent.blur(wInput);
    // Save fires; assume the server persists 99 and the cache patches
    // accordingly. The next prop refresh should NOT be blocked by the
    // (now-cleared) dirty flag.
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    hostRef.setProject(
      projectFixture({
        unit_types: [{ label: '', width_ft: 100, depth_ft: 60, qty: 1 }],
      }),
    );
    await waitFor(() => {
      expect(
        (screen.getByTestId('pd-units-compact-w') as HTMLInputElement).value,
      ).toBe('100');
    });
  });
});
