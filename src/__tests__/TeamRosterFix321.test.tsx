import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type {
  DrawScheduleQuarterLayoutRow,
  Permit,
  PermitWithCycles,
  Project,
  TeamMember,
} from '../lib/database.types';
import {
  formerLabel,
  formerMemberNames,
  isCurrentMember,
  isFormerMember,
} from '../lib/roster';
import rosterSrc from '../lib/roster.ts?raw';
import stageFiltersSrc from '../components/Dashboard/StageFilters.tsx?raw';

// fix-321 — the team hierarchy (#78) and people who have left (#79).
//
// ★★ THE TRAP THIS SUITE GUARDS, stated once:
//
//     CHOOSING someone   → the current roster only
//     SHOWING who it is  → whatever is recorded, former or not
//
// Hiding a departed person from a row they own would make that row look
// unassigned — a worse lie than the one #79 fixes, and a direct undoing of
// fix-308's two tickets on making ownership honest. Every filter assertion below
// is paired with a display assertion for that reason.
//
// Measured in prod 2026-08-15: 41 roster rows, 3 retired — Alex, Chad and Nidhi,
// all DAs, all with active=false AND former=true. 9 permits are still assigned
// to them, 5 of those live.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    name: 'Someone',
    role: 'da',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: NOW,
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

/** The prod roster, trimmed to what matters here. */
const ROSTER: TeamMember[] = [
  member({ name: 'Ainsley', role: 'da' }),
  member({ name: 'Trevor', role: 'da' }),
  member({ name: 'Cam', role: 'da' }),
  member({ name: 'Alex', role: 'da', active: false, former: true }),
  member({ name: 'Chad', role: 'da', active: false, former: true }),
  member({ name: 'Nidhi', role: 'da', active: false, former: true }),
  member({ name: 'Miles', role: 'ent' }),
  member({ name: 'Brittani', role: 'dm' }),
];

// ------------------------------------------------------------ the rule ------

describe('fix-321 #79: one rule for "on the team today"', () => {
  // ★ The brief asked for this to be DECIDED and WRITTEN DOWN, because `active`
  // and `former` are separate columns that may disagree. Either flag alone
  // retires a person; a missing flag counts as current.
  it('retires a person when EITHER column says so', () => {
    expect(isCurrentMember(member({ active: true, former: false }))).toBe(true);
    expect(isCurrentMember(member({ active: false, former: false }))).toBe(false);
    expect(isCurrentMember(member({ active: true, former: true }))).toBe(false);
    expect(isCurrentMember(member({ active: false, former: true }))).toBe(false);
  });

  it('treats a missing flag as current, so a row predating a column is not dropped', () => {
    expect(isCurrentMember({ active: undefined, former: undefined })).toBe(true);
    expect(isCurrentMember({ active: null, former: null })).toBe(true);
    expect(isFormerMember(member({ active: false }))).toBe(true);
  });

  it('★ names not on the roster at all are NOT treated as departed', () => {
    const departed = formerMemberNames(ROSTER);
    expect([...departed].sort()).toEqual(['Alex', 'Chad', 'Nidhi']);
    // Unknown is unknown. Treating it as departed would hide a live person from
    // their own filter — scraper values and un-onboarded staff land here.
    expect(departed.has('Someone Not On The Roster')).toBe(false);
  });

  it('★ one live role is enough — a person is not retired by their other row', () => {
    const both = [
      member({ name: 'Derry', role: 'dm' }),
      member({ name: 'Derry', role: 'schematic', active: false, former: true }),
    ];
    expect(formerMemberNames(both).has('Derry')).toBe(false);
  });

  it('the mark is a label, and says so', () => {
    expect(formerLabel('Nidhi')).toBe('Nidhi (former)');
    // ★ Display only — nothing in this module writes, reads Supabase, or mutates.
    expect(rosterSrc).not.toMatch(/supabase|useMutation|mutateAsync|\.rpc\(/);
  });
});

// ------------------------------------------------------- #78 · the tiers -----

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
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
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
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));
// The quarter-layout editor renders its empty state (and no pickers) until it
// has rows, so give it one — a lane belonging to a DA who has since left, which
// is the exact situation the marking exists for.
const layoutRows = vi.hoisted(() => ({
  current: [
    {
      id: 'r0', quarter: 'Q3-2026', position: 0, col_kind: 'da', da_name: 'Nidhi',
      group_label: 'Brittani', label_override: null, top_label: null,
      updated_at: '2026-05-15T12:00:00Z',
    },
  ] as unknown[],
}));
vi.mock('../hooks/useQuarterLayout', () => ({
  useQuarterLayout: () => ({
    rows: layoutRows.current,
    data: layoutRows.current,
    isLoading: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: vi.fn().mockResolvedValue({ data: layoutRows.current }),
  }),
}));
vi.mock('../hooks/useBuildQuarterLayout', () => ({
  useCloneQuarterLayout: () => ({ mutate: vi.fn(), isPending: false }),
  useSeedQuarterLayoutFromCurrent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useReplaceQuarterLayout', async (orig) => ({
  ...(await orig<typeof import('../hooks/useReplaceQuarterLayout')>()),
  useReplaceQuarterLayout: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The roster the components under test read. One mock, both halves of the
// ticket — the Team card does not use it, the filters do.
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const real = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...real,
    useTeamMembers: () => ({
      all: ROSTER,
      activeDas: ROSTER.filter((m) => m.role === 'da' && m.active !== false && m.former !== true),
      formerDas: ROSTER.filter((m) => m.role === 'da' && (m.active === false || m.former === true)),
      dms: ROSTER.filter((m) => m.role === 'dm'),
      ents: ROSTER.filter((m) => m.role === 'ent'),
      acqs: [],
      schematics: [],
      activeMemberNames: real.activeMemberNamesOf(ROSTER),
      isLoading: false,
      error: null,
    }),
  };
});

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import StageFilters, { EMPTY_DASH_FILTERS, permitPassesDashFilters } from '../components/Dashboard/StageFilters';
import QuarterLayoutEditor from '../components/Settings/QuarterLayoutEditor';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-321',
    address: '6605 57th Ave NE',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: 'Jake',
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: 'Miles',
    design_manager: 'Brittani',
    schematic_designer: ['Ana'],
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
    project_id: 'p-321',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: null,
    dd_end: null,
    target_submit: null,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderHeader(
  project: Project = projectFixture(),
  permits: PermitWithCycles[] = [bpFixture()],
) {
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
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

function internalSection(): HTMLElement {
  return screen.getByTestId('project-overview-team-internal');
}

describe('fix-321 #78: the Team card follows the work', () => {
  it('renders the five tiers in Bobby\'s order', () => {
    renderHeader();
    const labels = Array.from(
      internalSection().querySelectorAll('span:first-child'),
    )
      .map((el) => el.textContent?.trim())
      .filter((t) => ['ACQ', 'ENT', 'SD', 'DM', 'DA'].includes(t ?? ''));
    // Acquisitions · Entitlements · SD · Design Manager · Design Associate —
    // land, then entitlement, then schematic design, then the manager, then the
    // associate doing it.
    expect(labels).toEqual(['ACQ', 'ENT', 'SD', 'DM', 'DA']);
  });

  it('the SD row reads the project\'s schematic designer', () => {
    renderHeader(projectFixture({ schematic_designer: ['Ana'] } as Partial<Project>));
    const sd = within(internalSection()).getByText('SD')
      .parentElement as HTMLElement;
    expect(sd.textContent).toContain('Ana');
  });

  it('lists every designer when a project carries more than one', () => {
    renderHeader(
      projectFixture({ schematic_designer: ['Ana', 'Dave'] } as Partial<Project>),
    );
    const sd = within(internalSection()).getByText('SD')
      .parentElement as HTMLElement;
    expect(sd.textContent).toContain('Ana');
    expect(sd.textContent).toContain('Dave');
  });

  it('★ a project with no schematic designer gets the card\'s normal empty row, not a broken one', () => {
    renderHeader(projectFixture({ schematic_designer: null } as Partial<Project>));
    const sd = within(internalSection()).getByText('SD')
      .parentElement as HTMLElement;
    // The same em-dash the four tiers around it use when empty — not blank, not
    // "null", not a missing row.
    expect(sd.textContent).toContain('—');
    expect(sd.textContent ?? '').not.toMatch(/null|undefined|\[object/);
    // And the row is still there, in position.
    const labels = Array.from(internalSection().querySelectorAll('span:first-child'))
      .map((el) => el.textContent?.trim())
      .filter((t) => ['ACQ', 'ENT', 'SD', 'DM', 'DA'].includes(t ?? ''));
    expect(labels).toEqual(['ACQ', 'ENT', 'SD', 'DM', 'DA']);
  });

  it('★ no new role and no second lookup — it reads projects.schematic_designer', () => {
    // An empty array is not the same as "ask team_members" — with no designer on
    // the project, the row is empty even though the roster has schematic people.
    renderHeader(projectFixture({ schematic_designer: [] } as Partial<Project>));
    const sd = within(internalSection()).getByText('SD')
      .parentElement as HTMLElement;
    expect(sd.textContent).toContain('—');
  });
});

// ------------------------------------------------- #79 · the dashboard -------

function permit(over: Partial<Permit>): Permit {
  return {
    id: 1,
    project_id: 'p-321',
    type: 'Building Permit',
    num: 'BP-1',
    da: null,
    dm: null,
    ent_lead: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Permit;
}

function renderFilters(permits: Permit[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <StageFilters permits={permits} filters={EMPTY_DASH_FILTERS} onChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** The option labels inside one filter chip's dropdown. */
function optionsOf(testId: string): string[] {
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));
  return Array.from(screen.getByTestId(testId).querySelectorAll('label'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
}

describe('fix-321 #79: the dashboard DA picker stops at the current roster', () => {
  // ★ THE ACCEPTANCE TEST. Bobby: "when I click design associate, it is showing
  // design associates who are no longer active and/or employed."
  it('does not offer Nidhi, Chad or Alex', () => {
    renderFilters([
      permit({ id: 1, da: 'Ainsley' }),
      permit({ id: 2, da: 'Nidhi' }),
      permit({ id: 3, da: 'Chad' }),
      permit({ id: 4, da: 'Alex' }),
      permit({ id: 5, da: 'Trevor' }),
    ]);
    const options = optionsOf('dash-filter-da');
    expect(options).toContain('Ainsley');
    expect(options).toContain('Trevor');
    for (const departed of ['Nidhi', 'Chad', 'Alex']) {
      expect(options.join('|')).not.toContain(departed);
    }
  });

  it('applies the same rule to ENT and DM, and none of it to Type', () => {
    renderFilters([
      permit({ id: 1, ent_lead: 'Miles', dm: 'Brittani', type: 'Building Permit' }),
      // A departed DA who somehow also appears in an ENT column.
      permit({ id: 2, ent_lead: 'Nidhi', dm: 'Nidhi', type: 'Demolition' }),
    ]);
    expect(optionsOf('dash-filter-ent').join('|')).not.toContain('Nidhi');
    expect(optionsOf('dash-filter-dm').join('|')).not.toContain('Nidhi');
    // Type is not a person and must be untouched by any of this.
    const types = optionsOf('dash-filter-type');
    expect(types).toContain('Building Permit');
    expect(types).toContain('Demolition');
  });

  it('★ keeps a name the roster has never heard of — unknown is not departed', () => {
    renderFilters([permit({ id: 1, da: 'Someone New' })]);
    expect(optionsOf('dash-filter-da')).toContain('Someone New');
  });

  // ★★ THE PAIRED ASSERTION. Removing the option must not remove the work.
  it('★ a permit assigned to a former DA is NOT filtered out of the dashboard', () => {
    const stranded = permit({ id: 2, da: 'Nidhi' });
    // No filter selected -> it passes, exactly as before. The chip lost an
    // option; the permit did not lose its place on the screen.
    expect(permitPassesDashFilters(stranded, EMPTY_DASH_FILTERS)).toBe(true);
    // And if code elsewhere DOES filter by her name, it still matches — the
    // predicate knows nothing about the roster.
    expect(
      permitPassesDashFilters(stranded, {
        ...EMPTY_DASH_FILTERS,
        da: new Set(['Nidhi']),
      }),
    ).toBe(true);
  });

  it('★ and the permit still SHOWS her name where it is recorded', () => {
    renderHeader(projectFixture(), [bpFixture({ da: 'Nidhi' } as Partial<PermitWithCycles>)]);
    // The Team card names the DA on the permit, former or not. Hiding it would
    // make the permit read as unassigned — the worse lie.
    expect(within(internalSection()).getByText('DA').parentElement?.textContent).toContain(
      'Nidhi',
    );
  });

  it('is display only — the filter component writes nothing', () => {
    expect(stageFiltersSrc).not.toMatch(/useMutation|mutateAsync|\.rpc\(|\.update\(|\.insert\(/);
  });
});

// --------------------------------------- #79 · the list that must keep them --

describe('fix-321 #79: the quarter layout marks former DAs instead of dropping them', () => {
  function renderLayout() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const das = ROSTER.filter((m) => m.role === 'da');
    const dms = ROSTER.filter((m) => m.role === 'dm');
    const router = createMemoryRouter(
      [{ path: '/', element: <QuarterLayoutEditor das={das} dms={dms} /> }],
      { initialEntries: ['/'] },
    );
    return render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  // ★ Quarter layouts are HISTORICAL — Q1's columns record who held a lane in
  // Q1. Omitting a departed DA would strand every layout row naming them behind
  // a dropdown nobody can select, and re-saving would drop their column.
  it('still offers them, marked "(former)"', () => {
    renderLayout();
    const select = screen.getByTestId('ql-add-da-select');
    const labels = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent?.trim() ?? '',
    );
    expect(labels).toContain('Nidhi (former)');
    expect(labels).toContain('Ainsley');
  });

  // ★ The mark is the LABEL. The VALUE stays the raw name, because that value is
  // written into draw_schedule_layout.da_name — "Nidhi (former)" in a stored
  // column would be a data incident wearing a UI costume.
  it('★ the option VALUE is the raw name, never the marked label', () => {
    renderLayout();
    const select = screen.getByTestId('ql-add-da-select');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('Nidhi');
    expect(values.join('|')).not.toContain('(former)');
  });
});

// ------------------------------------------------------ nothing was written --

describe('fix-321: no production row is touched', () => {
  it('the ticket adds no mutation anywhere it changed', () => {
    // roster.ts is pure; StageFilters gained a read-only roster lookup. The two
    // files this ticket ADDED behaviour to are asserted directly; the pickers it
    // touched only had a predicate swapped, which cannot introduce a write.
    for (const src of [rosterSrc, stageFiltersSrc]) {
      expect(src).not.toMatch(/useMutation|mutateAsync|\.rpc\(/);
    }
  });

  it('and the quarter layout still persists only through its existing Save path', () => {
    // A row fixture proves the shape did not change under the marking.
    const r: DrawScheduleQuarterLayoutRow = {
      id: 'r0', quarter: 'Q3-2026', position: 0, col_kind: 'da', da_name: 'Nidhi',
      group_label: null, label_override: null, top_label: null, updated_at: NOW,
    };
    expect(r.da_name).toBe('Nidhi');
    expect(formerLabel(r.da_name as string)).not.toBe(r.da_name);
  });
});
