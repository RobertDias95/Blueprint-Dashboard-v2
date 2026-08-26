import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    <QueryClientProvider client={queryClient}>
      {/* ★ fix-335 §7: the Milestones card ends in a <Link> to this
          project's block on the draw schedule, so the card needs a router
          around it. It has always had one in the app — this card only ever
          renders inside /project/:id — so the harness is catching up with the
          real mount rather than acquiring a new dependency. */}
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
    // ★ fix-311 added the Permit intake section, which says the same plain
    // thing on this branch — Target Submit and Intake Accepted both hang off
    // the BP, so with no BP there is nothing to box. Hence getAll: the message
    // is now under both headings, which is the intended treatment rather than a
    // duplicate.
    expect(within(card).getAllByText('No building permit')).toHaveLength(2);
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

// ★ fix-310 renamed the second section "Draw window" -> "DD window". fix-296's
// point is untouched: TWO sections, Key dates first, the dd_start / dd_end pair
// living in the second one. Only the word changed.
describe('fix-296 two sections, not one list', () => {
  it('splits Key dates from the DD window', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('Key dates')).toBeInTheDocument();
    expect(within(card).getByText('DD window')).toBeInTheDocument();
    expect(within(card).queryByText('Draw window')).toBeNull();
  });

  it('puts the DD dates in the DD window and the milestones in Key dates', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    const sections = within(card).getAllByText(/^(Key dates|DD window)$/);
    // Key dates leads — it preserves the reading order the card has always had
    // and it is what the card is now named for.
    expect(sections[0]).toHaveTextContent('Key dates');
    expect(sections[1]).toHaveTextContent('DD window');

    const drawSection = sections[1].closest('section') as HTMLElement;
    expect(within(drawSection).getByTestId('pd-bp-dd_start')).toBeInTheDocument();
    expect(within(drawSection).getByTestId('pd-bp-dd_end')).toBeInTheDocument();
    expect(within(drawSection).queryByText('GO Date')).toBeNull();
  });

  // fix-290's pattern: a third section costs nothing because each carries its
  // own separator.
  it('each section carries its own top border, so a third can be added', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    const keyDates = within(card).getByText('Key dates').closest('section') as HTMLElement;
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

// ===========================================================================
// ★★ fix-335 §7 — the draw-schedule button at the foot of Milestones
// ===========================================================================
//
// Bobby: "Under milestones, at the bottom, underneath permit date, we want a
// button that from there will take you to the draw schedule."
//
// ★ THE QUARTER IS ON THE BUTTON'S FACE, and that is the whole design. fix-182
// renders a different board per quarter, so "the draw schedule" is ambiguous
// and a bare link would be making a promise it cannot keep. Naming the quarter
// turns a jump into a statement. The URL-building rules live in
// drawScheduleLink.test.ts; this is the card's half.
describe('fix-335 §7: Milestones ends with a link to the block', () => {
  // ★ The label is quarter-relative, so the clock is pinned — a floating one
  // would make this test mean something different every three months (fix-206).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 17, 12, 0, 0)); // 2026-08-17, Q3
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('★ names the quarter the block starts in, and links there', () => {
    drawRowsRef.current = [
      { project_id: 'p-296', da_assigned: 'Ainsley', updated_at: 'x', start_week: '2026-09-07', end_week: '2026-10-05' },
    ];
    renderHeader(projectFixture(), [bpFixture()]);
    const link = screen.getByTestId('pd-draw-schedule-link');
    expect(link.dataset.hasBlock).toBe('true');
    expect(link.dataset.quarter).toBe('2026-Q3');
    expect(link.textContent).toContain('Draw schedule');
    expect(link.textContent).toContain('Q3 2026');
    expect(link.getAttribute('href')).toBe(
      '/draw-schedule?project=p-296&quarter=2026-Q3',
    );
  });

  // ★★ A block in a DIFFERENT quarter from today's must not silently send you
  // to today's board — that is the dead link fix-182's layout makes possible.
  it('★★ a block in another quarter names THAT quarter, not this one', () => {
    drawRowsRef.current = [
      { project_id: 'p-296', da_assigned: 'Ainsley', updated_at: 'x', start_week: '2027-01-04', end_week: '2027-02-01' },
    ];
    renderHeader(projectFixture(), [bpFixture()]);
    const link = screen.getByTestId('pd-draw-schedule-link');
    expect(link.textContent).toContain('Q1 2027');
    expect(link.getAttribute('href')).toContain('quarter=2027-Q1');
  });

  // ★★ AND A PROJECT WITH NO BLOCK STILL GETS A WORKING LINK. fix-335 §8 allows
  // exactly one inert control in this ticket and it is not this one, so the
  // button goes to the live board and a second line says why there is nothing
  // to jump to. Not disabled, not hidden, not a dead href.
  it('★★ no block: still a real link, and it says so', () => {
    drawRowsRef.current = [];
    renderHeader(projectFixture(), [bpFixture()]);
    const link = screen.getByTestId('pd-draw-schedule-link');
    expect(link.dataset.hasBlock).toBe('false');
    expect(link.getAttribute('href')).toBe('/draw-schedule');
    expect(link.textContent).not.toMatch(/Q[1-4]/);
    expect(link.hasAttribute('disabled')).toBe(false);
    expect(
      screen.getByTestId('pd-draw-schedule-unscheduled').textContent,
    ).toMatch(/Not scheduled yet/i);
  });

  it('sits at the FOOT of the card, under Permit intake', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-milestones-card');
    const sections = Array.from(card.querySelectorAll(':scope > section'));
    expect(sections[sections.length - 1]).toBe(
      screen.getByTestId('pd-draw-schedule-section'),
    );
  });
});

// ===========================================================================
// ★★★ fix-335 §8 — the Connect button, the one placeholder in the ticket
// ===========================================================================
//
// ★★ HELD ON 2026-08-16 because nobody knew what URL it should open and Bobby
// had just said nothing ships as a placeholder. He has now waived that,
// knowingly, having been told he was waiving it: "connect is currently an app
// on our PCs. we can just use a placeholder button for it until we get to this
// point."
//
// ★★★ SO IT SHIPS, AND IT MUST BE HONEST. The failure that set the rule was
// never the label — it was that nobody had chosen what the control would do,
// and the UI hid that behind a date-shaped promise.
describe('fix-335 §8: Connect is visibly not wired up yet', () => {
  it('★★ reads as not-yet-working BEFORE it is clicked', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const btn = screen.getByTestId('pd-connect-button') as HTMLButtonElement;
    // Not a live-looking button that silently does nothing: it is disabled, so
    // the click never happens and the cursor says so on the way in.
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.className).toContain('border-dashed');
    expect(btn.className).toContain('cursor-not-allowed');
  });

  // ★ NO INVENTED DATE. The face states a fact about today — checkable, already
  // true, promising nothing — rather than a forecast nobody has made.
  it('★ says "Connect" and "no link yet", and nothing about the future', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const btn = screen.getByTestId('pd-connect-button');
    expect(btn.textContent).toContain('Connect');
    expect(btn.textContent).toMatch(/no link yet/i);
    expect(btn.textContent).not.toMatch(/soon|later|coming|shortly|Q[1-4]|20\d\d/i);
    expect(btn.getAttribute('title')).toMatch(/application on our PCs/i);
  });

  it('sits at the foot of the Project card', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(card.querySelectorAll(':scope > section'));
    expect(sections[sections.length - 1]).toBe(
      screen.getByTestId('pd-connect-section'),
    );
  });

  // ★★★ AND IT IS THE ONLY ONE. Everything else fix-335 adds works, so the
  // waiver stays a waiver for one named control rather than a new habit. The
  // marker is declared in the DOM precisely so this is a question the whole app
  // can be asked, rather than a list somebody has to keep up to date.
  it('★★★ it is the only inert control fix-335 shipped', () => {
    const modules = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(modules)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      // ★ fix-345 §3 moved the button's markup into the shared <OverviewAction>,
      // so the attribute is passed as a prop rather than written as JSX. Both
      // spellings are hunted, which is what keeps this a question about the
      // whole tree rather than about one file's formatting.
      .filter(([, src]) => /data-placeholder(="true"|': 'true')/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual(['../components/ProjectDetail/ProjectDetailHeader.tsx']);

    renderHeader(projectFixture(), [bpFixture()]);
    // The other control this ticket added to these cards is live.
    expect(
      (screen.getByTestId('pd-draw-schedule-link') as HTMLAnchorElement).getAttribute('href'),
    ).toContain('/draw-schedule');
  });
});

// ---------------------------------------------------------------------------
// ★★★ fix-418: A CARD'S SECTIONS ARE NO LONGER ALL DIRECT CHILDREN
// ---------------------------------------------------------------------------
//
// fix-418 put a two-column wrapper inside the PROJECT card (Proposal over Site
// on the left, Unit dimensions on the right), so `:scope > section` finds NONE
// of its distributing sections any more. The RULE is untouched — fix-331 §1
// still says every section that shares the card's height grows equally, and
// fix-345 §3 still says the pinned action takes no share of it.
//
// ★★ SO THE QUERY IS FIXED, NOT THE RULE, and it is fixed to say what the rule
// actually means: every TOP-LEVEL section of the card — one with no other
// section between it and the card — distributes. That is true of a one-column
// card and a two-column one, and it stays true of whatever shape comes next,
// which `:scope >` never was.
function topLevelSections(card: HTMLElement): HTMLElement[] {
  return (Array.from(card.querySelectorAll('section')) as HTMLElement[]).filter(
    (s) => {
      // ★★ BOUNDED TO THE CARD — AND THE CARD ITSELF IS A `<section>`.
      //   `closest('section')` walks the whole document, so an unbounded
      //   version finds the page's outer sections; and `OverviewCard`'s own
      //   root is a section, so "has a section ancestor inside the card"
      //   matches EVERY section in it. Both traps, both hit, both excluded
      //   here rather than by loosening what the test claims.
      const enclosing = s.parentElement?.closest('section');
      return enclosing == null || enclosing === card || !card.contains(enclosing);
    },
  );
}

// ===========================================================================
// ★★ fix-335 §6 — and fix-331 §1's distribution is UNCHANGED
// ===========================================================================
//
// The brief was explicit: "Do not reopen fix-331 §1's distribution — it stays
// exactly as it is; this is the single-section card only." §1's rule is that
// every section GROWS to take an equal share of the spare height and stays
// TOP-ALIGNED inside it, so a three-section card keeps its reading rhythm —
// Key dates, then DD window, then Permit intake, each starting where the eye
// expects. Centring those would move three headings off the line they start on.
describe('fix-335 §6: only the single-section card centres', () => {
  it('★★ the multi-section cards still grow and still top-align', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    for (const cardId of ['pd-milestones-card', 'pd-project-card']) {
      // ★ fix-418: through the PROJECT card's two-column wrapper. See
      //   topLevelSections() — the rule is unchanged, the query is.
      const sections = topLevelSections(screen.getByTestId(cardId));
      expect(sections.length, cardId).toBeGreaterThan(1);
      for (const s of sections) {
        // ★★ fix-345 §3: the pinned action at the card's foot takes NO share of
        // the spare height — that is the mechanism that lands all three cards'
        // buttons on one line. It is skipped here rather than the rule being
        // loosened, because fix-331 §1 governs the sections that SHARE the
        // space and this one deliberately does not.
        if (s.dataset.pinBottom === 'true') {
          expect(s.style.flexGrow).toBe('0');
          expect(s.style.marginTop).toBe('auto');
          continue;
        }
        // fix-331 §1: grows, never shrinks.
        expect(s.style.flexGrow).toBe('1');
        expect(s.style.flexShrink).toBe('0');
        // fix-335 §6 did NOT reach these.
        expect(s.dataset.centerVertically).toBeUndefined();
        expect(s.style.justifyContent).toBe('');
      }
    }
  });
});

// ===========================================================================
// ★★★ fix-345 §3 — three uniform buttons, one per card, on one baseline
// ===========================================================================
//
// Bobby: "We really like the draw schedule link button. If we can make that
// uniform for Connect and chat. Make them all at the bottom and horizontally
// equally and vertically equal so it kind of points to here are 3 active
// buttons for each category with different functions."
//
// ★★★ "VERTICALLY EQUAL" IS THE HARD PART AND IT DOES NOT COME FROM BEING LAST.
// fix-331 §1 gives every section flexGrow:1, so the spare height splits evenly
// BETWEEN SECTIONS — and the three cards have different section counts (4 / 3 /
// 4). A button section taking a 1/4 share on one card and a 1/3 share on
// another puts its content at a different height on each, because the content
// sits at the top of whatever share it was given.
//
// The fix is to give the button section NO share: flexGrow:0 plus marginTop:auto
// pins it to the card's floor, the sections above keep distributing the spare
// between themselves, and the cards are already equal heights (fix-309 #55). All
// three buttons are then measured from the same edge.
//
// ★ jsdom has no layout engine, so what is asserted here is the MECHANISM. The
// rendered proof at 1280 and 1440 is in the PR.
describe('fix-345 §3: the three card buttons', () => {
  const CARDS = [
    ['pd-milestones-card', 'pd-draw-schedule-section', 'pd-draw-schedule-link'],
    ['pd-project-card', 'pd-connect-section', 'pd-connect-button'],
    ['project-overview-team', 'pd-chat-section', 'project-chat-open'],
  ] as const;

  it('★ every card ends with a pinned action section', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    for (const [cardId, sectionId] of CARDS) {
      const card = screen.getByTestId(cardId);
      const sections = Array.from(card.querySelectorAll(':scope > section'));
      expect(
        (sections[sections.length - 1] as HTMLElement).dataset.testid,
        cardId + ' does not end with its action',
      ).toBe(sectionId);
    }
  });

  // ★★ THE MECHANISM, on all three: no share of the spare height, and pushed to
  // the floor. This is what puts them on one line.
  it('★★★ the action section takes no share of the spare height', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    for (const [, sectionId] of CARDS) {
      const s = screen.getByTestId(sectionId);
      expect(s.dataset.pinBottom, sectionId).toBe('true');
      expect(s.style.flexGrow, sectionId).toBe('0');
      expect(s.style.marginTop, sectionId).toBe('auto');
      // Still never shrinks — fix-331's other half.
      expect(s.style.flexShrink, sectionId).toBe('0');
    }
  });

  // ★ AND fix-331 §1 STILL HOLDS ABOVE IT. The brief was explicit: that fix
  // exists because Bobby complained about voids, and this must not put one back.
  it('★ the sections above still distribute the spare height between themselves', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    for (const [cardId] of CARDS) {
      const card = screen.getByTestId(cardId);
      const distributed = topLevelSections(card).filter(
        (s) => s.dataset.pinBottom !== 'true',
      );
      expect(distributed.length, cardId).toBeGreaterThanOrEqual(2);
      // All equal, all growing — "distributed" means nobody is singled out.
      const grows = distributed.map((s) => s.style.flexGrow);
      expect(new Set(grows).size, cardId).toBe(1);
      expect(grows[0], cardId).toBe('1');
    }
  });

  it('★ all three are the same shape: same height, same width, same type', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const classes = CARDS.map(([, , btnId]) => screen.getByTestId(btnId).className);
    for (const c of classes) {
      expect(c).toContain('w-full');
      expect(c).toContain('h-[26px]');
      expect(c).toContain('text-[10.5px]');
      expect(c).toContain('justify-center');
      expect(c).toContain('whitespace-nowrap');
    }
    // ★ The geometry half is identical across all three — only the tone (live
    // vs the inert Connect placeholder) differs.
    const geometry = classes.map((c) =>
      c
        .split(' ')
        .filter((t) => !/^(border-|bg-|text-de|text-dim|hover:|cursor-)/.test(t))
        .join(' '),
    );
    expect(new Set(geometry).size).toBe(1);
  });
});

// ===========================================================================
// ★★ fix-345 §3 — one way into the chat, and it keeps the unread count
// ===========================================================================

describe('fix-345 §3: the Team card has exactly one way into the chat', () => {
  it('★★ the inline "Open chat →" link is gone; the button is the way in', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    // The preview is untouched — fix-346 §1 moved it down to sit directly above
    // the button, and its content is the same as it ever was.
    const preview = screen.getByTestId('project-chat-mini');
    expect(preview).toBeInTheDocument();
    // ★ And it contains no opener of its own. Two ways into one thread from one
    // card was the thing being removed — a quieter duplicate is still a
    // duplicate.
    expect(preview.querySelector('button')).toBeNull();
    expect(preview.textContent).not.toMatch(/Open chat/);

    // Exactly one control opens the modal, and it is the pinned action.
    const openers = screen.getAllByTestId('project-chat-open');
    expect(openers).toHaveLength(1);
    expect(screen.getByTestId('pd-chat-section').contains(openers[0])).toBe(true);
  });

  it('★ and it actually opens the modal', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    expect(screen.queryByTestId('project-chat-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('project-chat-open'));
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
  });

  // ★★ SUPERSEDED BY fix-346 §1, deliberately rewritten rather than deleted.
  // This assertion used to read "the chat PREVIEW did not move" and pinned it
  // between Internal and External, which is where fix-331 §3 put it and where
  // my own fix-345 brief told me to keep it. Bobby withdrew that: "move that
  // chat down below, above the chat button, so that it goes internal, external,
  // and then here's the chat section… and then the chat button."
  //
  // ★ What the test protects is unchanged — the ORDER of the whole card,
  // asserted whole rather than sliced down to the part that still passes — and
  // the count is still four sections, so fix-345 §3's pinning above is intact.
  it('★★ the card order is Internal, External, the preview, then the button', () => {
    renderHeader(projectFixture(), [bpFixture()]);
    const ids = Array.from(
      screen.getByTestId('project-overview-team').querySelectorAll(':scope > section'),
    ).map((s) => (s as HTMLElement).dataset.testid);
    expect(ids).toEqual([
      'project-overview-team-internal',
      'project-overview-team-external',
      'project-overview-team-chat',
      'pd-chat-section',
    ]);
  });
});
