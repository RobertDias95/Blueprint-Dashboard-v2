import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleRow, PermitWithCycles, Project } from '../lib/database.types';

// fix-145: inline DD-phase editor for a reuse-redesign (no BP permit). Behavior
// tests render the editor directly; gating tests render the full
// ProjectDetailHeader to confirm DDPhaseCell only mounts the editor for a
// reuse-redesign with no BP.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const ddMutate = vi.hoisted(() => vi.fn());
const drawRows = vi.hoisted(() => ({ current: [] as DrawScheduleRow[] }));
// fix-146: controllable inherited-permit result per test.
const inherited = vi.hoisted(
  () => ({ current: null as { id: number; type: string; status: string | null; updated_at: string } | null }),
);

vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutate: ddMutate, isPending: false }),
}));
vi.mock('../hooks/useOriginalPermitForRedesign', () => ({
  useOriginalPermitForRedesign: () => ({ data: inherited.current, isLoading: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRows.current, isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { id: 'da1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da2', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
// ProjectDetailHeader's other hooks — inert stubs (gating tests render it).
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

import ReuseRedesignDdEditor from '../components/ProjectDetail/ReuseRedesignDdEditor';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St [Redesign 1]',
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
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    redesign_of_project_id: 'parent-uuid',
    redesign_reuses_original_permit: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

function drawRow(over: Partial<DrawScheduleRow> = {}): DrawScheduleRow {
  return {
    project_id: 'p1',
    da_assigned: 'Trevor',
    start_week: '2026-06-15',
    end_week: '2026-07-13',
    status: 'Corrections',
    manual_status: false,
    manually_placed: true,
    dd_start: '2026-06-15',
    dd_end: '2026-07-17',
    notes: null,
    color_override: null,
    status_override: null,
    updated_at: 'tok-1',
    ...over,
  };
}

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={qc()}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  ddMutate.mockReset();
  drawRows.current = [];
  inherited.current = null;
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    // fix-220: the DD-phase editor writes draw_schedule (admin-only). These
    // behavior tests exercise the editing path, so put the caller in an admin
    // membership (useIsTenantAdmin reads memberships, not user.role).
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('<ReuseRedesignDdEditor /> behavior', () => {
  it('pre-fills DA / dates / status from the existing draw_schedule row', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    expect((screen.getByTestId('redesign-dd-editor-da') as HTMLSelectElement).value).toBe('Trevor');
    expect((screen.getByTestId('redesign-dd-editor-start') as HTMLInputElement).value).toBe('2026-06-15');
    expect((screen.getByTestId('redesign-dd-editor-end') as HTMLInputElement).value).toBe('2026-07-17');
    expect((screen.getByTestId('redesign-dd-editor-status') as HTMLSelectElement).value).toBe('Corrections');
  });

  it('editing the DA and saving fires the mutation with the new DA + OCC token', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    fireEvent.change(screen.getByTestId('redesign-dd-editor-da'), { target: { value: 'Cam' } });
    fireEvent.click(screen.getByTestId('redesign-dd-editor-save'));
    expect(ddMutate).toHaveBeenCalledTimes(1);
    expect(ddMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        da: 'Cam',
        dd_start: '2026-06-15',
        dd_end: '2026-07-17',
        status: 'Corrections',
        expectedUpdatedAt: 'tok-1',
      }),
    );
  });

  it('snaps an edited dd_start forward to Monday in the save payload', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    fireEvent.change(screen.getByTestId('redesign-dd-editor-start'), {
      target: { value: '2026-06-16' }, // Tuesday → Mon 2026-06-22
    });
    fireEvent.click(screen.getByTestId('redesign-dd-editor-save'));
    expect(ddMutate).toHaveBeenCalledWith(
      expect.objectContaining({ dd_start: '2026-06-22' }),
    );
  });

  it('snaps an edited dd_end to the Friday of its end-week in the save payload', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    fireEvent.change(screen.getByTestId('redesign-dd-editor-end'), {
      target: { value: '2026-07-15' }, // Wed → Friday of its week = 2026-07-17
    });
    fireEvent.click(screen.getByTestId('redesign-dd-editor-save'));
    expect(ddMutate).toHaveBeenCalledWith(
      expect.objectContaining({ dd_end: '2026-07-17' }),
    );
  });

  it('persists a status change in the save payload', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    fireEvent.change(screen.getByTestId('redesign-dd-editor-status'), {
      target: { value: 'Approved' },
    });
    fireEvent.click(screen.getByTestId('redesign-dd-editor-save'));
    expect(ddMutate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Approved' }),
    );
  });

  it('disables Save until something changes', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    const save = screen.getByTestId('redesign-dd-editor-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('redesign-dd-editor-da'), { target: { value: 'Cam' } });
    expect(save.disabled).toBe(false);
  });
});

describe('<ReuseRedesignDdEditor /> inherited permit status (fix-146)', () => {
  it('renders the inherited line with the parent BP status', () => {
    drawRows.current = [drawRow()];
    inherited.current = {
      id: 10235,
      type: 'Building Permit',
      status: 'Pre-Submittal — GO',
      updated_at: 'p-tok',
    };
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    expect(screen.getByTestId('redesign-dd-editor-inherited')).toBeTruthy();
    expect(
      screen.getByTestId('redesign-dd-editor-inherited-value').textContent,
    ).toBe('Pre-Submittal — GO');
  });

  it('hides the inherited line when there is no parent BP', () => {
    drawRows.current = [drawRow()];
    inherited.current = null;
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    expect(screen.queryByTestId('redesign-dd-editor-inherited')).toBeNull();
    // Editor still renders normally.
    expect(screen.getByTestId('redesign-dd-editor-da')).toBeTruthy();
  });

  it('shows an em dash when the inherited status is null', () => {
    drawRows.current = [drawRow()];
    inherited.current = {
      id: 10235,
      type: 'Building Permit',
      status: null,
      updated_at: 'p-tok',
    };
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    expect(
      screen.getByTestId('redesign-dd-editor-inherited-value').textContent,
    ).toBe('—');
  });

  it('labels the editable status dropdown "Lane Status"', () => {
    drawRows.current = [drawRow()];
    wrap(<ReuseRedesignDdEditor project={projectFixture()} />);
    expect(
      screen.getByTestId('redesign-dd-editor-status-label').textContent,
    ).toBe('Lane Status');
  });
});

describe('DD Phase cell gating (ProjectDetailHeader)', () => {
  function renderHeader(project: Project, permits: PermitWithCycles[]) {
    const bp =
      permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
    return render(
      <QueryClientProvider client={qc()}>
        <ProjectDetailHeader project={project} permits={permits} bp={bp} allProjects={[]} />
      </QueryClientProvider>,
    );
  }
  function bpFixture(): PermitWithCycles {
    return {
      id: 1, project_id: 'p1', type: 'Building Permit', num: 'BP-1', status: null,
      portal_url: null, struct_address: null, ent_lead: null, dm: null, da: 'Trevor',
      dual_da: null, architect: null, kickoff_date: null, dd_start: '2026-06-15',
      dd_end: '2026-07-17', expected_issue: null, target_submit: null,
      target_submit_is_manual: false, intake_date: null, approval_date: null,
      actual_issue: null, corr_rounds: null, extras: null, last_scraper_update_at: null,
      nickname: null, cycle_model: null, view_cycle: null, notes: null,
      created_at: NOW, updated_at: NOW, permit_cycles: [],
    } as unknown as PermitWithCycles;
  }

  it('renders the editor for a reuse-redesign with no BP', () => {
    drawRows.current = [drawRow()];
    renderHeader(projectFixture(), []);
    expect(screen.getByTestId('redesign-dd-editor')).toBeTruthy();
    expect(screen.queryByText('No building permit')).toBeNull();
  });

  it('shows "No building permit" for a normal project with no BP', () => {
    renderHeader(
      projectFixture({ redesign_of_project_id: null, redesign_reuses_original_permit: null }),
      [],
    );
    expect(screen.queryByTestId('redesign-dd-editor')).toBeNull();
    expect(screen.getByText('No building permit')).toBeTruthy();
  });

  it('does not render the editor when the redesign has a BP permit', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.queryByTestId('redesign-dd-editor')).toBeNull();
  });
});
