import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-141: the DD Phase date pickers (DDPhaseEditor in ProjectDetailHeader) must
// Monday-align before sending to bp_set_bp_dd_dates. dd_start forward-snaps to
// the next Monday (Bobby's locked direction — the field the Draw Schedule grid
// keys lanes off; a non-Monday there is what made 6605's lane invisible). dd_end
// becomes the Friday of its own end-week (end-week Monday + 4), preserving the
// Monday+4 convention regardless of the weekday the user picked. The snap is
// silent — no warning, picker stays unrestricted.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const ddMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
// Everything else the header touches — inert stubs.
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-141',
    address: '6605 57th Ave NE',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: '2026-06-05',
    units: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

function bpFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-141',
    type: 'Building Permit',
    num: 'BP-100',
    status: null,
    portal_url: null,
    struct_address: null,
    ent_lead: null,
    dm: null,
    da: 'Ainsley',
    dual_da: null,
    architect: null,
    kickoff_date: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    target_submit: null,
    target_submit_is_manual: false,
    intake_date: null,
    approval_date: null,
    actual_issue: null,
    corr_rounds: null,
    extras: null,
    last_scraper_update_at: null,
    nickname: null,
    cycle_model: null,
    view_cycle: null,
    notes: null,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderHeader(project: Project, permits: PermitWithCycles[]) {
  const bp =
    permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} />,
    { wrapper },
  );
}

beforeEach(() => {
  ddMutateAsync.mockReset();
  ddMutateAsync.mockResolvedValue({ overlapKind: null });
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
  } as never);
});

describe('<ProjectDetailHeader /> DD Phase Monday-snap (fix-141)', () => {
  it('forward-snaps a Saturday dd_start to the following Monday and recomputes dd_end to the Friday of its end-week', async () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;

    // Sat 2026-06-13 → Mon 2026-06-15 (the exact 6605 manual-fix target).
    fireEvent.change(start, { target: { value: '2026-06-13' } });
    // Wed 2026-07-15 → its end-week Friday = 2026-07-17.
    fireEvent.change(end, { target: { value: '2026-07-15' } });
    fireEvent.blur(end);

    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalledTimes(1));
    expect(ddMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-141',
        ddStart: '2026-06-15',
        ddEnd: '2026-07-17',
      }),
    );
  });

  it('leaves an already Monday/Friday pair unchanged (no redundant write)', async () => {
    // bp already at Mon dd_start / Fri dd_end → blur with no edit is a no-op.
    renderHeader(
      projectFixture(),
      [bpFixture({ dd_start: '2026-06-15', dd_end: '2026-07-17' })],
    );
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    fireEvent.blur(end);
    // give any async path a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(ddMutateAsync).not.toHaveBeenCalled();
  });

  it('clears both dates (both null) without snapping', async () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ dd_start: '2026-06-15', dd_end: '2026-07-17' })],
    );
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.change(end, { target: { value: '' } });
    fireEvent.blur(end);
    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalledTimes(1));
    expect(ddMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ ddStart: null, ddEnd: null }),
    );
  });
});
