import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-296: the first card on the project overview was called "DD Phase" and its
// two date fields were called "Start" and "End".
//
// None of those names survives a new person reading the screen. "DD Phase" is
// internal shorthand; "Start"/"End" do not say WHAT starts and ends — they are
// the project's draw-schedule block, which is a different thing from the permit
// dates sitting inches away on the same card.
//
// The data and the behaviour were already right. This suite pins the words, the
// section split, and — the part that actually carries risk — that the
// draw-schedule conflict flows still work after the fields moved between
// sections.
//
// ★ NOTHING IN THE DATABASE IS RENAMED. dd_start / dd_end / bp_set_bp_dd_dates
// stay exactly as they are; a schema rename would turn a label change into a
// migration. The tests below assert the NEW label writes the OLD column.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const ddMutateAsync = vi.hoisted(() => vi.fn());
const resolveOverlapAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({
    mutateAsync: resolveOverlapAsync,
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The overlap + NP branches need a draw_schedule lane with a DA assigned --
// without one commitDd falls through silently, so an empty list would make the
// conflict tests pass for the wrong reason.
const drawRowsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRowsRef.current, isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-296',
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
    product_types: [],
    project_tags: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

function bpFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-296',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: null,
    dd_end: null,
    target_submit: null,
    target_submit_is_manual: false,
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
  resolveOverlapAsync.mockReset();
  resolveOverlapAsync.mockResolvedValue({});
  drawRowsRef.current = [
    {
      project_id: 'p-296',
      da_assigned: 'Ainsley',
      updated_at: '2026-05-14T09:00:00Z',
      start_week: '2026-06-01',
      end_week: '2026-07-03',
    },
  ];
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// --------------------------------------------------------- all three branches --

describe('fix-296 the card is called Milestones, on every branch', () => {
  it('the normal editor (a project with a building permit)', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getAllByTestId('overview-card-banner')[0])
      .toHaveTextContent('Milestones');
  });

  it('the no-building-permit branch', () => {
    renderHeader(projectFixture(), []);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getAllByTestId('overview-card-banner')[0])
      .toHaveTextContent('Milestones');
    expect(within(card).getByText('No building permit')).toBeInTheDocument();
  });

  // ★ fix-145 added this branch precisely because it used to render a dead
  // placeholder. A rename must not regress it back to one.
  it('the reuse-redesign branch renders the inline lane editor, not a placeholder', () => {
    renderHeader(
      projectFixture({
        redesign_of_project_id: 'parent-1',
        redesign_reuses_original_permit: true,
      } as Partial<Project>),
      [],
    );
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getAllByTestId('overview-card-banner')[0])
      .toHaveTextContent('Milestones');
    expect(screen.getByTestId('redesign-dd-editor-start')).toBeInTheDocument();
    expect(within(card).queryByText('No building permit')).toBeNull();
  });

  it('no branch still says "DD Phase"', () => {
    for (const [project, permits] of [
      [projectFixture(), [bpFixture()]],
      [projectFixture(), []],
      [projectFixture({
        redesign_of_project_id: 'parent-1',
        redesign_reuses_original_permit: true,
      } as Partial<Project>), []],
    ] as Array<[Project, PermitWithCycles[]]>) {
      const { unmount } = renderHeader(project, permits);
      expect(screen.queryByTestId('pd-dd-phase-card')).toBeNull();
      expect(screen.queryByText('DD Phase')).toBeNull();
      unmount();
    }
  });
});

// ------------------------------------------------------------------ the labels --

describe('fix-296 the labels say what they mean', () => {
  // ★ fix-309 #52 renamed these two BACK to "DD start" / "DD end". fix-296's
  // point survives intact — the bare words "Start" and "End" were the problem,
  // and they are still absent. Only the qualifier changed, and it changed
  // because Bobby asked for the DD wording on this card.
  it('renders DD start and DD end, never the bare words Start and End', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('DD start')).toBeInTheDocument();
    expect(within(card).getByText('DD end')).toBeInTheDocument();
    // The bare words are what made these ambiguous next to the permit dates.
    expect(within(card).queryByText('Start')).toBeNull();
    expect(within(card).queryByText('End')).toBeNull();
  });

  // The reuse-redesign editor is a different COMPONENT (ReuseRedesignDdEditor)
  // rendering the same two fields on the same card. #52 named only the
  // Milestones card, but leaving this one on "Draw Start" would put two names
  // for one concept inches apart on one screen — which is the exact split
  // fix-296b existed to close. Renamed with it.
  it('the reuse-redesign editor uses the same two words as the main card', () => {
    renderHeader(
      projectFixture({
        redesign_of_project_id: 'parent-1',
        redesign_reuses_original_permit: true,
      } as Partial<Project>),
      [],
    );
    expect(screen.getByText('DD start')).toBeInTheDocument();
    expect(screen.getByText('DD end')).toBeInTheDocument();
    expect(screen.queryByText('Draw Start')).toBeNull();
    expect(screen.queryByText('Draw End')).toBeNull();
  });

  it('GO Date and Target Submit are unchanged', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('GO Date')).toBeInTheDocument();
    // Target Submit labels its input via aria-label rather than visible text.
    expect(within(card).getByLabelText('Target Submit')).toBeInTheDocument();
  });

  it('GO Date is still read-only and still says where to change it', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const row = screen.getByText('GO Date').parentElement as HTMLElement;
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(row.querySelector('input')).toBeNull();
    expect(row.innerHTML).toContain('Project Settings');
  });
});

// ---------------------------------------------------------------- the sections --

describe('fix-296 two sections, not one list', () => {
  it('splits Key dates from the Draw window', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('Key dates')).toBeInTheDocument();
    expect(within(card).getByText('Draw window')).toBeInTheDocument();
  });

  it('puts the draw dates in the Draw window and the milestones in Key dates', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    const sections = within(card).getAllByText(/^(Key dates|Draw window)$/);
    // Key dates leads — it preserves the reading order the card has always had
    // and it is what the card is now named for.
    expect(sections[0]).toHaveTextContent('Key dates');
    expect(sections[1]).toHaveTextContent('Draw window');

    const drawSection = sections[1].parentElement as HTMLElement;
    expect(within(drawSection).getByTestId('pd-bp-dd_start')).toBeInTheDocument();
    expect(within(drawSection).getByTestId('pd-bp-dd_end')).toBeInTheDocument();
    expect(within(drawSection).queryByText('GO Date')).toBeNull();
  });

  // fix-290's pattern: a third section costs nothing because each carries its
  // own separator.
  it('each section carries its own top border, so a third can be added', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    const keyDates = within(card).getByText('Key dates').parentElement as HTMLElement;
    expect(keyDates.className).toContain('first:border-t-0');
  });
});

// ------------------------------------------------- the columns are NOT renamed --

describe('fix-296 the rename is display-only', () => {
  it('Draw Start still writes dd_start and Draw End still writes dd_end', async () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    // commitDd deliberately refuses a half-filled pair, so both are set.
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-07-03' } });
    fireEvent.blur(end);
    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalled());
    const arg = ddMutateAsync.mock.calls[0][0];
    // ★ The DB vocabulary is untouched — only the label moved.
    expect(arg).toHaveProperty('ddStart');
    expect(Object.keys(arg).join(',')).not.toMatch(/drawStart/i);
  });
});

// --------------------------------------------- ★ the conflict flows still work --

describe('fix-296 the draw-schedule conflict flows survive the split', () => {
  // ★ THE RISK THIS TICKET CARRIES. PendingDdOverlap snapshots state at the
  // moment the conflict returns; moving the fields between sections must not
  // disturb that snapshot or the prompt it feeds.
  it('an overlap still raises the OverlapPrompt, and Push Down still resolves it', async () => {
    ddMutateAsync.mockResolvedValueOnce({
      overlapKind: 'project',
      overlapConflicts: [{ address: '123 Other St', da_assigned: 'Ainsley' }],
      drawScheduleUpdatedAt: '2026-05-14T09:00:00Z',
      proposedStartWeek: '2026-06-01',
      proposedEndWeek: '2026-07-03',
    });
    renderHeader(projectFixture(), [bpFixture()]);
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-07-03' } });
    fireEvent.blur(end);

    const prompt = await screen.findByTestId('overlap-prompt');
    expect(prompt).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('overlap-prompt-push-down'));
    await waitFor(() => expect(resolveOverlapAsync).toHaveBeenCalled());
  });

  it('the NP path still retries with forceNp', async () => {
    ddMutateAsync.mockResolvedValueOnce({
      overlapKind: 'np',
      overlapConflicts: [{ address: 'NP block', np_label: 'Holiday' }],
    });
    renderHeader(projectFixture(), [bpFixture()]);
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-07-03' } });
    fireEvent.blur(end);

    const prompt = await screen.findByTestId('np-warning-prompt');
    expect(prompt).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('np-warning-prompt-confirm'));

    await waitFor(() => {
      const forced = ddMutateAsync.mock.calls.some(
        (c) => c[0] && c[0].forceNp === true,
      );
      expect(forced).toBe(true);
    });
  });
});
