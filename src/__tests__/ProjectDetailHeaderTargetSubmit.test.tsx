import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-66: Target Submit inline-edit in the DD Phase cell on Project
// Overview, anchored on the project's Building Permit. Writes
// permits.target_submit via the same useUpdateProjectWithPermits RPC
// the modal + fix-62/63 use; the DB trigger flips target_submit_is_manual
// so the client never sends it.
//
// Pinned contracts:
//   - input pre-populated from the BP's target_submit
//   - blur sends permit_upserts[0] = {id, expected_updated_at,
//     target_submit} with NO target_submit_is_manual key, projectPatch {}
//   - clearing sends target_submit: null
//   - out_conflict (kind='permit') surfaces the refresh toast + keeps the
//     typed value
//   - project with no Building Permit renders disabled "—" (no input)
//   - lowest-id Building Permit is the anchor when several exist

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const mutateAsync = vi.hoisted(() => vi.fn());
const pushToastMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: pushToastMock,
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));
// Sibling header cells / DD start-end machinery — inert stubs.
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-ts-1',
    address: '742 Evergreen Terrace',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: '2026-06-01',
    units: null,
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
    created_at: NOW,
    updated_at: '2026-05-15T12:00:00Z',
    ...over,
  } as Project;
}

function permitFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-ts-1',
    type: 'Building Permit',
    num: 'BP-100',
    status: null,
    portal_url: null,
    struct_address: null,
    ent_lead: null,
    dm: null,
    da: null,
    dual_da: null,
    architect: null,
    kickoff_date: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    target_submit: '2026-07-01',
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
  // ProjectDetailHeader computes the DD-phase `bp` from the prop we pass.
  // We pass the same lowest-id BP (or permits[0]) so DDPhaseEditor mounts.
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
  mutateAsync.mockReset();
  pushToastMock.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
  } as never);
});

describe('<ProjectDetailHeader /> Target Submit DD Phase (fix-66)', () => {
  it('renders the input pre-populated from the BP target_submit', () => {
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-07-01');
  });

  it('renders empty input when BP target_submit is null', () => {
    const bp = permitFixture({ id: 100, target_submit: null });
    renderHeader(projectFixture(), [bp]);
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('blur sends a permit_upsert without target_submit_is_manual', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 100, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const project = projectFixture({ id: 'p-99', updated_at: '2026-05-15T12:00:00Z' });
    const bp = permitFixture({
      id: 100,
      project_id: 'p-99',
      target_submit: '2026-07-01',
      updated_at: '2026-05-14T09:00:00Z',
    });
    renderHeader(project, [bp]);

    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-15' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const arg = mutateAsync.mock.calls[0][0];
    expect(arg).toEqual({
      projectId: 'p-99',
      projectExpectedUpdatedAt: '2026-05-15T12:00:00Z',
      projectPatch: {},
      permitUpserts: [
        {
          id: 100,
          expected_updated_at: '2026-05-14T09:00:00Z',
          target_submit: '2026-08-15',
        },
      ],
      permitDeletes: [],
    });
    // Critically: the manual flag is the trigger's job — never sent.
    expect(
      'target_submit_is_manual' in arg.permitUpserts[0],
    ).toBe(false);
  });

  it('clearing the input sends target_submit: null', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 100, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);

    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const arg = mutateAsync.mock.calls[0][0] as {
      permitUpserts: { target_submit: string | null }[];
    };
    expect(arg.permitUpserts[0].target_submit).toBeNull();
  });

  it('no-op blur (unchanged value) does NOT call the mutation', () => {
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.blur(input);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('conflict (kind="permit") surfaces the refresh toast and keeps the typed value', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: true,
      conflictKind: 'permit',
      conflictId: '100',
      projectUpdatedAt: null,
      permits: [],
    });
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);

    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-09' } });
    fireEvent.blur(input);

    await waitFor(() => expect(pushToastMock).toHaveBeenCalled());
    const args = pushToastMock.mock.calls[0];
    expect(args[0]).toMatch(/modified elsewhere/i);
    expect(args[1]).toBe('warn');
    expect(input.value).toBe('2026-09-09');
  });

  it('Enter triggers a save with the typed value', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 100, updated_at: '2026-05-15T12:00:01Z' }],
    });
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);

    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const arg = mutateAsync.mock.calls[0][0] as {
      permitUpserts: { target_submit: string | null }[];
    };
    expect(arg.permitUpserts[0].target_submit).toBe('2026-10-20');
  });

  it('Esc resets the draft to the stored value and does NOT save', () => {
    const bp = permitFixture({ id: 100, target_submit: '2026-07-01' });
    renderHeader(projectFixture(), [bp]);
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    expect(input.value).toBe('2026-12-31');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('2026-07-01');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('project with no Building Permit renders disabled "—" (no input)', () => {
    // A single non-BP permit: DDPhaseEditor still mounts (page bp =
    // permits[0]), but the strict BP anchor is null → "—".
    const demo = permitFixture({
      id: 200,
      type: 'Demolition',
      num: 'DM-200',
      target_submit: '2026-07-01',
    });
    renderHeader(projectFixture(), [demo]);
    expect(screen.queryByTestId('pd-target-submit')).toBeNull();
    expect(screen.getByTestId('pd-target-submit-empty').textContent).toBe('—');
  });

  it('anchors on the lowest-id Building Permit when several exist', async () => {
    mutateAsync.mockResolvedValueOnce({
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: '2026-05-15T12:00:01Z',
      permits: [{ id: 50, updated_at: '2026-05-15T12:00:01Z' }],
    });
    // Two BPs (id 90, id 50) + a demo. The lowest-id BP (50) anchors.
    const bp90 = permitFixture({ id: 90, target_submit: '2026-07-01', updated_at: 'A' });
    const bp50 = permitFixture({ id: 50, target_submit: '2026-06-15', updated_at: 'B' });
    const demo = permitFixture({ id: 10, type: 'Demolition', target_submit: '2026-05-01' });
    renderHeader(projectFixture(), [bp90, bp50, demo]);

    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    // Pre-populated from id 50 (lowest BP), not id 90.
    expect(input.value).toBe('2026-06-15');

    fireEvent.change(input, { target: { value: '2026-08-01' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const arg = mutateAsync.mock.calls[0][0] as {
      permitUpserts: { id: number; expected_updated_at?: string }[];
    };
    expect(arg.permitUpserts[0].id).toBe(50);
    expect(arg.permitUpserts[0].expected_updated_at).toBe('B');
  });
});
