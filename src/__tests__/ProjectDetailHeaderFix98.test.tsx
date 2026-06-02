import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { OCCConflictError } from '../lib/occ';
import { queryKeys } from '../lib/queryKeys';

// fix-98 + fix-99: UnitDimensions's bespoke OCC-recovery dance moved
// into useUpdateProject's mutationFn (fix-99) so every caller of the
// hook inherits the same auto-retry path for free. UnitDimensions.
// writeTypes is now a single mutateAsync call — these tests pin the
// resulting user-visible behavior at the COMPONENT layer; the
// recovery wire itself is exercised at the hook layer in
// useUpdateProjectFix99.test.tsx.

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

describe('UnitDimensions — fix-99 single mutateAsync call (recovery in hook)', () => {
  it('happy path: writeTypes fires ONE mutateAsync with the project\'s current updated_at and no silentOnOcc flag', async () => {
    updateMutateAsync.mockResolvedValueOnce({
      id: 'p-test',
      updated_at: NEW_TOKEN,
    });
    setup();
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const call = updateMutateAsync.mock.calls[0][0];
    expect(call.expectedUpdatedAt).toBe(OLD_TOKEN);
    // fix-99: writeTypes no longer opts into silentOnOcc — the hook
    // handles the retry + toast lifecycle on its own.
    expect(call.silentOnOcc).toBeUndefined();
    expect(call.fieldLabel).toBe('Unit Dimensions');
    expect(call.patch.unit_types[0].width_ft).toBe(40);
  });

  it('OCC rejection: writeTypes calls mutateAsync exactly ONCE and pushes no extra toast (hook owns both)', async () => {
    // fix-99: OCC recovery moved into the hook. From the component's
    // POV, mutateAsync is called once; the hook may internally retry,
    // but writeTypes doesn't manage that wire anymore. The toast (if
    // any) comes from the hook's onError — writeTypes doesn't push.
    updateMutateAsync.mockRejectedValueOnce(
      new OCCConflictError(0, 'Unit Dimensions'),
    );
    setup();
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    // The component-side .catch in writeTypes swallows so the void
    // caller stays unhandled-rejection-free. The mocked hook itself
    // doesn't push the toast (the test stubs mutateAsync directly).
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('NON-OCC rejection: writeTypes still only calls mutateAsync once and surfaces no errors to the void caller', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('network glitch'));
    setup();
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '40' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    // No second call — auto-recovery for OCC lives in the hook now
    // (and only fires on OCC, never on a generic error). The
    // .catch in writeTypes prevents an unhandled-promise-rejection.
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
