import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  num_lots: null,
  is_corner_lot: null,
  alley: null,
  parking_type: null,
  parking_stalls: null,
} as unknown as Project;

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

describe('fix-290 the Site block is back on the Project card', () => {
  it('renders as a section of the Project card, under Proposal', () => {
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    const proposal = within(card).getByTestId('pd-project-proposal');
    const site = within(card).getByTestId('pd-project-site');
    // Stacked, not side by side: Site FOLLOWS Proposal in the document.
    expect(
      proposal.compareDocumentPosition(site) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(proposal.parentElement).toBe(site.parentElement);
  });

  it('labels both sections', () => {
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    expect(within(card).getByText('Proposal')).toBeInTheDocument();
    expect(within(card).getByText('Site')).toBeInTheDocument();
  });

  // The list from §1 of the brief, field by field. This is the regression.
  it.each([
    ['zone', 'Zone'],
    ['lots', 'Lots'],
    ['corner', 'Corner'],
    ['alley', 'Alley'],
    // ★★★ fix-402 removed 'parking' and 'stalls' from this list, by ruling.
    // Bobby, 2026-08-25: *"Remove [parking] from the holistic site and merge
    // that under the units for proposal."* The values were archived to
    // _parking_site_archive_2026_08_25 and the columns cleared; parking is a
    // per-UNIT field now and lives in the Unit Dimensions editor.
  ])('renders the %s field', (testid, label) => {
    renderHeader();
    const site = screen.getByTestId('pd-project-site');
    expect(within(site).getByTestId(`pd-site-${testid}`)).toBeInTheDocument();
    expect(within(site).getByText(label)).toBeInTheDocument();
  });

  it('renders lot width AND depth, which are one row but two columns', () => {
    renderHeader();
    const site = screen.getByTestId('pd-project-site');
    expect(within(site).getByTestId('pd-site-lot-w')).toBeInTheDocument();
    expect(within(site).getByTestId('pd-site-lot-d')).toBeInTheDocument();
  });

  it('shows the stored values, populated from projects', () => {
    renderHeader();
    const site = screen.getByTestId('pd-project-site');
    expect(within(site).getByTestId('pd-site-zone')).toHaveValue('NR');
    expect(within(site).getByTestId('pd-site-lot-w')).toHaveValue(61);
    expect(within(site).getByTestId('pd-site-lot-d')).toHaveValue(192);
    expect(within(site).getByTestId('pd-site-lots')).toHaveValue('1');
    expect(within(site).getByTestId('pd-site-corner')).toHaveValue('No');
    expect(within(site).getByTestId('pd-site-alley')).toHaveValue('No');
    // ★ fix-402: the two site parking rows are gone — asserted absent rather
    // than merely dropped, so a re-introduction is caught here.
    expect(within(site).queryByTestId('pd-site-parking')).toBeNull();
    expect(within(site).queryByTestId('pd-site-stalls')).toBeNull();
  });

  // ★ A null column must read as EMPTY, never as the string "null" — the classic
  // way a restored block embarrasses itself on a project nobody has filled in.
  it('renders every field blank, and never "null", when the columns are NULL', () => {
    renderHeader(EMPTY_PROJECT);
    const site = screen.getByTestId('pd-project-site');
    expect(site.textContent).not.toMatch(/null|undefined|NaN/i);
    for (const id of [
      'pd-site-zone', 'pd-site-lot-w', 'pd-site-lot-d', 'pd-site-lots',
      'pd-site-corner', 'pd-site-alley',
    ]) {
      expect(within(site).getByTestId(id)).toHaveValue(
        id.includes('lot-') || id.endsWith('stalls') ? null : '',
      );
    }
  });
});

// ------------------------------------------------------ the universal banner --

/** The five cards of the overview row, plus Notes, which the mockup also draws
 *  as a card. Keyed by the banner text each must show. */
const CARDS: Array<[string, string]> = [
  // fix-296: DD Phase -> Milestones. Internal shorthand that did not survive
  // a new person reading it.
  ['pd-milestones-card', 'Milestones'],
  ['pd-project-card', 'Project'],
  ['project-overview-team', 'Team'],
  ['plan-of-record-card', 'Design Plan of Record'],
  ['pd-builder-cell', 'Builder / Owner'],
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
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    const proposal = within(card).getByTestId('pd-project-proposal');
    const site = within(card).getByTestId('pd-project-site');
    // The first section suppresses its own rule; the next one draws it.
    expect(proposal.className).toContain('first:border-t-0');
    expect(site.className).toContain('border-t');
  });

  it('stacks Team the same way it stacks Project', () => {
    renderHeader();
    const team = screen.getByTestId('project-overview-team');
    const internal = within(team).getByTestId('project-overview-team-internal');
    const external = within(team).getByTestId('project-overview-team-external');
    expect(internal.parentElement).toBe(external.parentElement);
    expect(internal.className).toBe(external.className);
  });

  it('leaves single-section cards with no sub-heading to repeat the banner', () => {
    renderHeader();
    const builder = screen.getByTestId('pd-builder-cell');
    // "Builder / Owner" appears once — in the banner — not again beneath it.
    expect(within(builder).getAllByText('Builder / Owner')).toHaveLength(1);
  });
});
