import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import { schematicWindow, SCHEMATIC_LEAD_DAYS } from '../lib/schematicWindow';
import { shownDate } from '../test/milestoneDate';

// fix-309, the Project Overview half — register #49, #51, #52, #53, #55.
//
// The through-line of all five is that the card row was a ragged staircase of
// slightly-wrong labels. Key dates listed things that are not key dates, the
// draw window carried a duration nobody reads, the two date fields were named
// after the draw schedule rather than the phase they belong to, the schematic
// window that precedes DD was nowhere on the screen, and every card was as tall
// as its own content.
//
// ★ NOTHING IN THE DATABASE IS RENAMED. dd_start / dd_end / bp_set_bp_dd_dates
// are untouched; the label test below asserts the WRITE, not just the word.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const ddMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    id: 'p-309',
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
    project_id: 'p-309',
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
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} />,
    { wrapper },
  );
}

beforeEach(() => {
  ddMutateAsync.mockReset();
  ddMutateAsync.mockResolvedValue({ overlapKind: null });
  drawRowsRef.current = [
    {
      project_id: 'p-309',
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

/** The Key dates section of the Milestones card. */
function keyDatesSection(): HTMLElement {
  const card = screen.getByTestId('pd-milestones-card');
  return within(card).getByText('Key dates').parentElement as HTMLElement;
}

// ------------------------------------------------------------------- #51 --

describe('fix-309 #51: Key dates is GO Date then Closing date, and nothing else', () => {
  it('renders exactly those two, in that order', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const section = keyDatesSection();
    const text = section.textContent ?? '';
    expect(text).toContain('GO Date');
    expect(text).toContain('Closing');
    // In that order — GO first, because every project starts with the GO date.
    expect(text.indexOf('GO Date')).toBeLessThan(text.indexOf('Closing'));
  });

  it('does not carry Target Submit any more — it moved under the DD window', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const section = keyDatesSection();
    expect(within(section).queryByTestId('pd-target-submit')).toBeNull();
    expect(section.textContent ?? '').not.toMatch(/target/i);
    // ...but it is still on the card, and still editable. Moving a row out of
    // "Key dates" must not delete it.
    const card = screen.getByTestId('pd-milestones-card');
    const input = within(card).getByTestId('pd-target-submit');
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it('is the same two rows on the permit-less branch, not a different card', () => {
    renderHeader(projectFixture(), []);
    const text = keyDatesSection().textContent ?? '';
    expect(text).toContain('GO Date');
    expect(text).toContain('Closing');
    expect(text.indexOf('GO Date')).toBeLessThan(text.indexOf('Closing'));
  });
});

// ------------------------------------------------------------------- #49 --

describe('fix-309 #49: the duration line is gone', () => {
  it('renders no Duration anywhere on the Milestones card', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ dd_start: '2026-06-01', dd_end: '2026-07-03' } as Partial<PermitWithCycles>)],
    );
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).queryByText(/duration/i)).toBeNull();
    // The regression that would sneak it back: a bare "N weeks" readout with a
    // different label. The number it was computed from is 4.7 weeks / 32 days.
    expect(card.textContent ?? '').not.toMatch(/\d+\s*(weeks?|wks?|days?)\b/i);
  });
});

// ------------------------------------------------------------------- #52 --

describe('fix-309 #52: the labels read DD start / DD end — display only', () => {
  it('shows the new words and not the old ones', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('DD start')).toBeInTheDocument();
    expect(within(card).getByText('DD end')).toBeInTheDocument();
    expect(within(card).queryByText('Draw Start')).toBeNull();
    expect(within(card).queryByText('Draw End')).toBeNull();
  });

  it('keeps the test ids, which are the DB vocabulary', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.getByTestId('pd-bp-dd_start')).toBeInTheDocument();
    expect(screen.getByTestId('pd-bp-dd_end')).toBeInTheDocument();
  });

  // ★ The assertion the brief asks for: assert the WRITE, not the label. A
  // rename that reached the payload would turn a wording change into a
  // migration, and this is what catches it.
  it('writes ddStart / ddEnd through bp_set_bp_dd_dates, with no renamed key', async () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    // commitDd refuses a half-filled pair, so both are set before the blur.
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-07-03' } });
    fireEvent.blur(end);

    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalled());
    const arg = ddMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toHaveProperty('ddStart');
    expect(arg).toHaveProperty('ddEnd');
    expect(arg.ddStart).toBe('2026-06-01');
    const keys = Object.keys(arg).join(',');
    expect(keys).not.toMatch(/draw/i);
    expect(keys).not.toMatch(/schematic|sd_/i);
  });
});

// ------------------------------------------------------------------- #53 --

describe('fix-309 #53: the schematic window is derived, never stored', () => {
  it('is DD start minus four weeks, ending at DD start', () => {
    expect(SCHEMATIC_LEAD_DAYS).toBe(28);
    expect(schematicWindow('2026-06-01')).toEqual({
      start: '2026-05-04',
      end: '2026-06-01',
    });
  });

  // ★ fix-311 split the one combined `start → end` string into SD start and SD
  // end so the two sit parallel with DD start / DD end. The WINDOW is unchanged
  // — same deriver, same two dates, two rows instead of one.
  it('renders that window above the DD row', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ dd_start: '2026-06-01', dd_end: '2026-07-03' } as Partial<PermitWithCycles>)],
    );
    // ★ fix-320 #1: read-only rows render the browser's short date, not ISO.
    // The WINDOW is what this test is about, so it names the ISO dates and asks
    // the shared helper what they render as.
    expect(screen.getByTestId('pd-sd-start')).toHaveTextContent(shownDate('2026-05-04'));
    expect(screen.getByTestId('pd-sd-end')).toHaveTextContent(shownDate('2026-06-01'));
    // Above, not below: the schematic phase precedes DD.
    const card = screen.getByTestId('pd-milestones-card');
    const text = card.textContent ?? '';
    expect(text.indexOf('SD')).toBeLessThan(text.indexOf('DD start'));
  });

  // ★ Derived means it MOVES. If it were stored at create time this passes on
  // the first render and silently rots on the second.
  it('moves when DD start moves', () => {
    renderHeader(
      projectFixture(),
      [bpFixture({ dd_start: '2026-06-01', dd_end: '2026-07-03' } as Partial<PermitWithCycles>)],
    );
    expect(screen.getByTestId('pd-sd-start')).toHaveTextContent(shownDate('2026-05-04'));

    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-29' } });
    expect(screen.getByTestId('pd-sd-start')).toHaveTextContent(shownDate('2026-06-01'));
    expect(screen.getByTestId('pd-sd-end')).toHaveTextContent(shownDate('2026-06-29'));
  });

  it('renders no window at all when DD start is null — never a garbage date', () => {
    renderHeader(projectFixture(), [bpFixture({ dd_start: null } as Partial<PermitWithCycles>)]);
    expect(screen.queryByTestId('pd-sd-start')).toBeNull();
    expect(screen.queryByTestId('pd-sd-end')).toBeNull();
    expect(screen.getByTestId('pd-milestones-card').textContent ?? '').not.toMatch(
      /NaN|Invalid|1970/,
    );
    // And the deriver agrees, for the inputs a form can actually produce.
    expect(schematicWindow(null)).toBeNull();
    expect(schematicWindow('')).toBeNull();
    expect(schematicWindow('  ')).toBeNull();
    expect(schematicWindow('not-a-date')).toBeNull();
  });
});

// ------------------------------------------------------------------- #55 --

// ★ The brief asks for "assert the computed heights match, not that a class is
// present". jsdom has NO layout engine — every getBoundingClientRect() is zero
// and every offsetHeight is 0, so a literal pixel comparison would pass
// vacuously whatever the CSS said, which is worse than not asserting it.
//
// So this asserts the two computed style values that produce equal heights, on
// the real rendered elements: the grid stretches its items, and every cell is
// height:100%. Both are read back from getComputedStyle, not from a className —
// a class swap that dropped the behaviour fails here. The pixel check itself
// belongs in a browser, and is noted as such rather than faked.
describe('fix-309 #55: the card row is one equal-height band', () => {
  function cells(): Record<string, HTMLElement> {
    const grid = screen.getByTestId('project-overview-grid');
    const out: Record<string, HTMLElement> = {};
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const area = el.style.gridArea?.split(' ')[0];
      if (area) out[area] = el;
    }
    return out;
  }

  it('stretches every cell to the tallest, which is the Plan of Record', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const grid = screen.getByTestId('project-overview-grid');
    expect(getComputedStyle(grid).alignItems).toBe('stretch');

    const c = cells();
    for (const area of ['dd', 'proj', 'team', 'por', 'builder']) {
      expect(c[area], `missing cell: ${area}`).toBeTruthy();
      expect(getComputedStyle(c[area]).height, `cell ${area} does not stretch`).toBe('100%');
    }
  });

  it('the cards themselves fill their cell rather than sitting at content height', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    // Milestones is the shortest card and the one the complaint named. If the
    // OverviewCard shell does not fill, stretching the cell achieves nothing.
    const card = screen.getByTestId('pd-milestones-card');
    expect(getComputedStyle(card).height).toBe('100%');
  });

  it('does not shrink the Plan of Record to match the others', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const grid = screen.getByTestId('project-overview-grid');
    const cols = grid.style.gridTemplateColumns.trim().split(/\s+/).map(parseFloat);
    // fix-295's width survives: por is still the widest column.
    expect(Math.max(...cols)).toBe(cols[3]);
    // And nothing caps its height — a max-height would shrink it to the others.
    const por = cells().por;
    expect(por.style.maxHeight).toBeFalsy();
    expect(getComputedStyle(por).maxHeight).not.toMatch(/px/);
  });
});
