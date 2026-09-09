import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderProjectData } from '../test/renderProjectData';
import {
  DATES_CARD_MIN_WIDTH,
  PROJECT_CARD_CLASS,
  SITE_DATA_MIN_WIDTH,
  SITE_DATES_PAIR_CLASS,
  SITE_DATES_RESPONSIVE_CSS,
  SITE_DATES_SIDE_BY_SIDE_CARD_MIN,
} from '../lib/projectCardLayout';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// fix-290: one card = one banner + one or more stacked sections.
//
// Two things are under test, and they are the two the ticket exists for:
//
//   1. ★ THE SITE BLOCK IS BACK. fix-285 narrowed the Project card into a fifth
//      of the screen and then split THAT in half for Proposal and Site. Site was
//      still fetched and still rendered — it was simply too narrow to read,
//      which from the desk is the same thing as missing. Zone, Lot, Lots,
//      Corner, Alley, Parking and Stalls are read off this screen daily.
//
//   2. EVERY CARD WEARS THE SAME BANNER. Before this they were five species:
//      a centred title inside the padding, the same wrapped in a second bordered
//      box, a fixed 240px column with a left border, and one real banner. The
//      parity assertion below is what stops a sixth card inventing a seventh.
//
// ★ PlanOfRecordCard is deliberately NOT mocked here (the fix-285 layout suite
// mocks it). Banner parity is meaningless if one of the five is a stub.

const T = 'test-tenant-uuid';

vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpdatePermit: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
// The real card, with only its data mocked — so its real banner is rendered.
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));


import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import NotesPanel from '../components/ProjectDetail/NotesPanel';

/** A project with every Site column populated — the fields §1 of the brief
 *  lists, with the values the mockup shows. */
const PROJECT = {
  id: 'p1',
  tenant_id: T,
  address: '10044 37th Ave SW',
  juris: 'Seattle',
  units: 3,
  updated_at: '2026-05-15T12:00:00Z',
  external_team: {},
  zone: 'NR',
  lot_width: 61,
  lot_depth: 192,
  lot_size_sf: null,
  num_lots: 1,
  is_corner_lot: false,
  alley: 'No',
  parking_type: 'Both',
  parking_stalls: 5,
} as unknown as Project;

/** The same project with every one of those columns NULL — the state a project
 *  is in before anyone fills the site in, which must render rather than crash. */
const EMPTY_PROJECT = {
  id: 'p2',
  tenant_id: T,
  address: '1 Nowhere St',
  juris: 'Seattle',
  updated_at: '2026-05-15T12:00:00Z',
  external_team: {},
  zone: null,
  lot_width: null,
  lot_depth: null,
  lot_size_sf: null,
  num_lots: null,
  is_corner_lot: null,
  alley: null,
  parking_type: null,
  parking_stalls: null,
} as unknown as Project;

/** ★ fix-506 §G: the Site editor is a Project Data tab now — see
 *  src/test/renderProjectData. `makeProject` is this file's fixture. */
function makeProject(): Project {
  return PROJECT;
}

function renderHeader(project: Project = PROJECT) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ------------------------------------------------- ★ the restored Site block --

describe('fix-290 → fix-506: the Site block, and where its editors went', () => {
  // ★★★ fix-290 EXISTED BECAUSE SITE WAS SQUEEZED OUT OF VIEW. Proposal and
  //     Site sat side by side in a `1fr 1fr` grid inside a fifth of the screen,
  //     so each half was ~10% of the viewport and Site stopped being LEGIBLE —
  //     which from the desk is the same thing as gone. Stacking them gave each
  //     the card's full width, and that is the claim this suite pins.
  //
  // ★★★ v14 KEEPS THE CLAIM AND CHANGES THE SHAPE TWICE OVER. **Proposal** is
  //     retired (its Units count is derived from the unit rows now; its type
  //     chips and redesign list are Project Data's), and **Site data** is a
  //     READ-ONLY box beside a new Dates card — a `flex-wrap` pair, so the two
  //     sit side by side only where the card can genuinely hold both, and stack
  //     where it cannot. fix-290's defect cannot recur by construction: below
  //     475px of card body they are stacked, exactly as fix-290 left them.
  //
  // ★★ THE FIELDS ARE ALL STILL HERE — as text on the overview, as the same
  //    controls in the modal's Site data tab. Both are asserted.

  it('★★★ SUPERSEDED: the pair is a two-column GRID with a declared breakpoint', () => {
    // ★★★ fix-506 MADE IT A `flex-wrap` PAIR — side by side wherever it fits,
    //     stacked where it does not — and the reasoning was sound. What killed
    //     it is that the "wherever it fits" branch NEVER FIRED: measured in
    //     Chrome on the shipped app, the Project card's body is 406px at 1920
    //     against the 475 the pair needs, so every real machine got the
    //     fallback. That is P-174, and Bobby's ruling 1 closes it — *"Site data
    //     sits beside Dates on every machine."*
    //
    // ★★ SO THE ARRANGEMENT IS THE MOCK'S `.pstrip` NOW, and the fallback is a
    //    CONTAINER QUERY on the card rather than an accident of wrapping. The
    //    tracks carry the two boxes' own floors, which is what fix-506's flex
    //    bases were for — the property survives the mechanism.
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    const pair = within(card).getByTestId('pd-site-dates-pair');
    const site = within(card).getByTestId('pd-site-dates-site');
    const dates = within(card).getByTestId('pd-site-dates-dates');
    expect(pair.className).toContain(SITE_DATES_PAIR_CLASS);
    expect(pair.className).not.toContain('flex-wrap');
    expect(site.parentElement).toBe(dates.parentElement);
    // ★ The floors are in the STYLESHEET now, generated from the same
    //   constants — a `?raw` CSS import reads empty under vitest (fix-406), so
    //   the rule is built in TS and read here from the same source the browser
    //   gets.
    expect(SITE_DATES_RESPONSIVE_CSS).toContain(
      `minmax(${SITE_DATA_MIN_WIDTH}px,1fr) minmax(${DATES_CARD_MIN_WIDTH}px,1.25fr)`,
    );
    expect(SITE_DATES_RESPONSIVE_CSS).toContain(
      `(min-width:${SITE_DATES_SIDE_BY_SIDE_CARD_MIN}px)`,
    );
    // ★★ …and the CARD carries the containment context the query needs. Without
    //    it the rule matches nothing and the pair silently stacks for ever,
    //    which is exactly the state this ticket exists to end.
    expect(card.className).toContain(PROJECT_CARD_CLASS);
  });

  it('★★★ SUPERSEDED: there is no Proposal section, and its content moved', () => {
    renderHeader();
    expect(screen.queryByTestId('pd-project-proposal')).toBeNull();
    // The Units count survives, derived from the rows the matrix prints.
    expect(screen.getByTestId('pd-site-units-count')).toBeInTheDocument();
  });

  // The list from §1 of the brief, field by field — READ-ONLY on the overview.
  it.each([
    ['zone-row', 'Zone'],
    ['corner-row', 'Corner'],
    ['alley-row', 'Alley'],
    // ★★★ fix-402 removed 'parking' and 'stalls' by ruling — parking is a
    //     per-UNIT field now. ★★★ fix-506 §C removes 'lots': `num_lots` is not
    //     on Bobby's v14 row list. It still edits in Project Data; it is simply
    //     not one of the eight things he reads here.
  ])('renders the %s row', (testid, label) => {
    renderHeader();
    const site = screen.getByTestId('pd-site-data');
    expect(within(site).getByTestId(`pd-site-${testid}`)).toBeInTheDocument();
    expect(within(site).getByText(label)).toBeInTheDocument();
  });

  it('renders lot width AND depth as one printed pair', () => {
    // ★ `lotSizeView` builds `60 × 125`, or `60 × varies` when one dimension is
    //   blank beside a typed size — fix-488's rule, unchanged.
    renderHeader();
    const site = screen.getByTestId('pd-site-data');
    expect(within(site).getByTestId('pd-site-lot-row').textContent).toContain('61');
    expect(within(site).getByTestId('pd-site-lot-row').textContent).toContain('192');
  });

  it('shows the stored values, populated from projects', () => {
    renderHeader();
    const site = screen.getByTestId('pd-site-data');
    expect(within(site).getByTestId('pd-site-zone-row').textContent).toContain('NR');
    expect(within(site).getByTestId('pd-site-corner-row').textContent).toContain('No');
    expect(within(site).getByTestId('pd-site-alley-row').textContent).toContain('No');
    // ★ fix-402: the two site parking rows are gone — asserted absent rather
    //   than merely dropped, so a re-introduction is caught here.
    expect(within(site).queryByTestId('pd-site-parking')).toBeNull();
    expect(within(site).queryByTestId('pd-site-stalls')).toBeNull();
  });

  it('renders every field as an em dash, and never "null", when the columns are NULL', () => {
    // ★★★ THE STATE A NEW PROJECT IS IN before anybody fills the site in, and
    //     the reason this fixture exists: a card that printed the STRING
    //     "null" would be worse than one that printed nothing.
    //
    // ★★ fix-506 §C strengthens the claim rather than weakening it. The old
    //    editable rows rendered an empty `<input>`, which is indistinguishable
    //    from a field somebody cleared on purpose; the read-only box prints an
    //    EM DASH, which is fix-386's vocabulary for NOT RECORDED and says so.
    renderHeader(EMPTY_PROJECT);
    const site = screen.getByTestId('pd-site-data');
    for (const id of ['pd-site-zone-row', 'pd-site-lot-row', 'pd-site-corner-row', 'pd-site-alley-row']) {
      const row = within(site).getByTestId(id);
      expect(row.textContent, id).toContain('—');
      expect(row.textContent, id).not.toMatch(/null|undefined|NaN/);
    }
  });

  it('★★★ and every one of them is still EDITABLE, in Project Data', () => {
    // ★★ P-140 makes the overview read-only; it does not make the fields
    //    read-only. `SiteEditor` is byte-for-byte what shipped.
    cleanup();
    renderProjectData(makeProject(), [], 'site');
    for (const id of ['pd-site-zone', 'pd-site-lots', 'pd-site-corner', 'pd-site-alley']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('pd-site-lot-w')).toBeInTheDocument();
    expect(screen.getByTestId('pd-site-lot-d')).toBeInTheDocument();
  });
});

const CARDS: Array<[string, string]> = [
  // ★★★ fix-506 §A: THREE. fix-296 renamed DD Phase to Milestones and fix-475
  //     put Consultants in Builder/Owner's slot; both of those cards are
  //     retired now — the dates are the Project card's Dates box and the
  //     consultant pills are a band inside Team. fix-290's contract is about
  //     the row's CARDS, so it is asserted of the cards that are there.
  ['plan-of-record-card', 'Design Plan of Record'],
  ['pd-project-card', 'Project'],
  ['project-overview-team', 'Team'],
];

// ★ fix-309 #54 moved Notes OUT of the header, to the bottom of Schedule
// health. It is still an OverviewCard and fix-290's contract still binds it —
// it just is not reachable from renderHeader() any more, so it is rendered
// standalone below rather than dropped from the suite.
const NOTES_CARD: [string, string] = ['notes-panel', 'Notes'];

function renderNotes() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotesPanel projectId={PROJECT.id} variant="card" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('fix-290 every card wears the same banner', () => {
  it.each(CARDS)('%s has a banner reading "%s"', (testId, title) => {
    renderHeader();
    const banner = within(screen.getByTestId(testId)).getAllByTestId(
      'overview-card-banner',
    )[0];
    expect(banner).toHaveTextContent(title);
  });

  // ★ THE ASSERTION THE BRIEF ASKS FOR: identical MARKUP, not merely similar
  // looks. A future card that hand-rolls its own header fails here.
  it('renders byte-identical banner classes on every card', () => {
    renderHeader();
    const banners = screen.getAllByTestId('overview-card-banner');
    expect(banners).toHaveLength(CARDS.length);
    const [first, ...rest] = banners;
    for (const b of rest) {
      expect(b.className).toBe(first.className);
      expect(b.tagName).toBe(first.tagName);
    }

    // ...and Notes, now that it lives elsewhere, matches the same markup.
    renderNotes();
    const notesBanner = within(screen.getByTestId(NOTES_CARD[0])).getAllByTestId(
      'overview-card-banner',
    )[0];
    expect(notesBanner).toHaveTextContent(NOTES_CARD[1]);
    expect(notesBanner.className).toBe(first.className);
    expect(notesBanner.tagName).toBe(first.tagName);
  });

  it('puts the banner first inside its card, above the content', () => {
    renderHeader();
    renderNotes();
    for (const [testId] of [...CARDS, NOTES_CARD]) {
      const card = screen.getByTestId(testId);
      const banner = within(card).getAllByTestId('overview-card-banner')[0];
      expect(card.firstElementChild).toBe(banner);
    }
  });
});

// -------------------------------------------------------- the stacked pattern --

describe('fix-290 a third section costs nothing', () => {
  // The pattern's whole claim. Sections are siblings under the card with the
  // separator carried by each one, so adding another is a JSX line — no layout
  // change, no counting, no index-aware styling to update.
  it('separates stacked sections with the section\'s own top border', () => {
    // ★ Asserted of the TEAM card, which is the row's stacked-section card
    //   after fix-506 §A. The pattern's claim — sections are siblings and each
    //   carries its own separator, so a third costs a JSX line — is unchanged,
    //   and §F added one (the consultant band) to prove it.
    renderHeader();
    const card = screen.getByTestId('project-overview-team');
    const builder = within(card).getByTestId('project-overview-team-builder');
    const internal = within(card).getByTestId('project-overview-team-internal');
    // The first section suppresses its own rule; the next one draws it.
    expect(builder.className).toContain('first:border-t-0');
    expect(internal.className).toContain('border-t');
  });

  it('stacks Team the same way it stacks Project', () => {
    // ★ fix-479 §A (P-132): this paired Internal with EXTERNAL, which has left
    //   the card. The claim is about the CARD — its sections are siblings drawn
    //   by one component — so it is re-made against the section that took
    //   External's place in the stack. Builder/Owner above, Chat below; both
    //   are asserted so the pair is not the only thing keeping this honest.
    renderHeader();
    const team = screen.getByTestId('project-overview-team');
    // ★★★ fix-507 §C: Chat moved into the grid's second cell, so it is no
    //     longer Internal's SIBLING. The claim this test is really making —
    //     every block in the card is the same species, drawn by one component —
    //     is asserted where it still holds (the className parity, which is the
    //     half that would actually catch a card growing its own box) and the
    //     sibling half is asserted of Builder/Owner and Internal, which are
    //     still stacked in column 1.
    const internal = within(team).getByTestId('project-overview-team-internal');
    const builder = within(team).getByTestId('project-overview-team-builder');
    const chat = within(team).getByTestId('project-overview-team-chat');
    expect(internal.parentElement).toBe(builder.parentElement);
    expect(internal.className).toBe(builder.className);
    expect(internal.className).toBe(chat.className);
  });

  it('leaves single-section cards with no sub-heading to repeat the banner', () => {
    // ★ fix-475 asserted this of CONSULTANTS, the row's one single-section
    //   card. fix-506 §A retires that card — its pills are a band inside Team —
    //   so the row's single-section card is the PLAN OF RECORD, and the rule is
    //   what it always was: a card with one section does not repeat its banner
    //   as a sub-heading.
    renderHeader();
    const por = screen.getByTestId('plan-of-record-card');
    expect(within(por).getAllByText('Design Plan of Record')).toHaveLength(1);
  });
});
