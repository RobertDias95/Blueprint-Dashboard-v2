import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// fix-285: the rearranged project overview.
//
//     [ DD Phase ] [ Project ] [ Team      ] [ Plan of ] [ Builder ]
//     [ Notes .............. ] [ (stacked) ] [ Record  ] [ / Owner ]
//
// Three things changed and each is asserted against the REAL header rather than
// a stub, because the whole point of the ticket is where these cards sit:
//   * Notes moved up out of the footer into the area under DD Phase and Project;
//   * Internal and External team stack vertically instead of side by side;
//   * the Design Plan of Record card appears between Team and Builder/Owner.

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
// The card has its own suite; here it only needs to be locatable in the grid.
vi.mock('../components/ProjectDetail/PlanOfRecordCard', () => ({
  default: () => <div data-testid="plan-of-record-card" />,
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

const PROJECT = {
  id: 'p1',
  tenant_id: T,
  address: '10044 37th Ave SW',
  juris: 'Seattle',
  units: 3,
  updated_at: '2026-05-15T12:00:00Z',
  external_team: {},
} as unknown as Project;

function renderHeader() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={PROJECT} permits={[]} bp={null} />,
    { wrapper },
  );
}

/** The grid areas, in the order they are declared. */
/** ★ fix-423: the row also holds a zero-height forced line break now, which
 *  carries no grid area. The RULE this backs — Plan of Record sits between Team
 *  and Builder/Owner — is unchanged; the query reads the CELLS rather than
 *  every child, the same correction fix-418 made to `topLevelSections()`. */
function areaOrder(): string[] {
  const grid = screen.getByTestId('project-overview-grid');
  return (Array.from(grid.children) as HTMLElement[])
    .filter((el) => el.hasAttribute('data-overview-cell'))
    .map((el) => el.style.gridArea?.split(' ')[0] ?? '');
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-285 the overview row (fix-506: THREE columns)', () => {
  it('places the cards in the agreed order', () => {
    renderHeader();
    const order = areaOrder().filter(Boolean);
    // ★★★ AMENDED TWICE, AND THE CLAIM — the cards render in the agreed order
    //     — is what this test is for and is unchanged.
    //
    //       fix-475 (P-116)  the fifth column becomes CONSULTANTS; Builder/Owner
    //                        moves into the Team card's top section.
    //       fix-506 §A       Milestones and Consultants stop being cards at all
    //                        (their content moves into Project and Team), and
    //                        the Plan of Record leads the row — Bobby reads the
    //                        overview left to right as a book (P-139).
    expect(order).toEqual(['por', 'proj', 'team']);
  });

  // fix-290 gave Project both rows because the half-height slot squeezed its
  // Site section out of view, and Notes took the space under DD Phase.
  //
  // ★ fix-309 #54/#55 collapsed that to ONE row. Notes left the grid for the
  // bottom of Schedule health, so there is no second row for Project to span
  // and nothing left to squeeze it -- the whole row is now as tall as the Plan
  // of Record. fix-290's point survives in the assertion below: Project is
  // never half-height.
  it('declares one row, and Notes is no longer in it', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    const areas = grid.style.gridTemplateAreas.replace(/\s+/g, ' ');
    expect(areas).toContain('por proj team');
    expect(areas).not.toContain('notes');
    const rows = areas.split('"').filter((r) => r.trim());
    expect(rows).toHaveLength(1);
  });

  it('gives Project a full-height cell so its second section has somewhere to go', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.alignItems).toBe('stretch');
    const proj = Array.from(grid.children).find(
      (el) => (el as HTMLElement).style.gridArea?.startsWith('proj'),
    ) as HTMLElement;
    expect(proj.style.height).toBe('100%');
  });

  it('has three columns, each with an explicit floor', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(trackShares(grid)).toHaveLength(3);
    // ★ fix-417: and every track now carries an EXPLICIT px floor. A bare `fr`
    //   means `minmax(auto, …)`, which is how the PROJECT card came to resize
    //   its four neighbours.
    expect(grid.style.gridTemplateColumns).toContain('minmax(');
  });

  // fix-295: the Plan of Record column is the widest of the five. Its preview
  // is the only content on this row whose usefulness is bound by resolution --
  // everything else is text that reflows -- so the room went to it, taken from
  // Team and Builder/Owner and NOT from Project (fix-290 already narrowed that
  // to the point where it hid its own Site section).
  it('gives the Plan of Record column the most width', () => {
    renderHeader();
    const [por, proj, team] = trackShares(
      screen.getByTestId('project-overview-grid'),
    );
    // ★ Bobby's standing ruling — the Plan of Record is the widest box — and
    //   fix-506 §A gave it Permit intake's width on top, 29% → 35%.
    expect(por).toBeGreaterThan(proj);
    expect(por).toBeGreaterThan(team);
    // ...and Project keeps the width fix-290 gave it, so its Site section
    // cannot be squeezed back out of view.
    expect(proj).toBeGreaterThanOrEqual(1);
  });
});

// ★ fix-309 #54 reverses fix-285's move. Notes went into the header grid to
// fill the empty area under DD Phase and Project; #55 makes that row a single
// equal-height band, so the hole Notes was filling no longer exists and Notes
// returns to the bottom of Schedule health as one long vertical bar.
describe('fix-309 #54 Notes left the header grid', () => {
  it('renders no Notes column inside the header', () => {
    renderHeader();
    expect(screen.queryByTestId('project-overview-notes-col')).toBeNull();
    expect(screen.queryByTestId('notes-panel')).toBeNull();
    // ★ fix-506 §A: `dd` is gone too — the Milestones card is retired and its
    //   dates are the Project card's Dates box. The claim here is about NOTES,
    //   so it is asserted of the card that is actually in the row.
    expect(areaOrder()).toContain('por');
    expect(areaOrder()).not.toContain('notes');
    expect(areaOrder()).not.toContain('dd');
  });
});

describe('fix-285 the team cards stack', () => {
  // ★ fix-479 §A (P-132): fix-285's subject was "Internal and External STACK
  //   vertically now, rather than sitting side by side in a 2-col grid" —
  //   External is gone (Bobby, 2026-09-02) and the STACK is what fix-285 won.
  //
  // ★★★ fix-507 §C SUPERSEDES THE SIBLING HALF, AND STATES WHY RATHER THAN
  //     DELETING IT. fix-285's complaint was that Internal and External *each
  //     got half of a narrow column*, so their selects were squeezed. Chat is
  //     not that pair: it is a PREVIEW beside a roster, in a card that had to
  //     stop being the tallest in the row (P-176/P-177), and the mock has drawn
  //     it in the top-right block since v14. So the assertion moves from
  //     "same parent, stacked" to the two claims that are still load-bearing —
  //     Internal comes FIRST in reading order, and Builder/Owner and Internal
  //     are still stacked with each other, which is the squeeze fix-285 was
  //     actually about.
  it('renders Internal before Chat, and stacks it with Builder/Owner', () => {
    renderHeader();
    const builder = screen.getByTestId('project-overview-team-builder');
    const internal = screen.getByTestId('project-overview-team-internal');
    const chat = screen.getByTestId('project-overview-team-chat');
    expect(internal).toBeInTheDocument();
    expect(chat).toBeInTheDocument();
    // Reading order: Internal first, Chat after.
    expect(
      internal.compareDocumentPosition(chat)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ★ The stack fix-285 won, still stacked: Builder/Owner over Internal, in
    //   one flex column.
    expect(internal.parentElement).toBe(builder.parentElement);
    expect(internal.parentElement?.getAttribute('data-testid')).toBe(
      'pd-team-grid-col1',
    );
    // ★ …and Chat is in the OTHER cell, which is the change, asserted rather
    //   than left to be inferred from the absence of the old assertion.
    expect(chat.parentElement?.getAttribute('data-testid')).toBe(
      'pd-team-grid-chat',
    );
  });

  it('is one column of the outer grid', () => {
    renderHeader();
    const col = screen.getByTestId('project-overview-team-col');
    expect(col.style.gridArea).toContain('team');
    expect(col).toContainElement(screen.getByTestId('project-overview-team-internal'));
    expect(col).toContainElement(screen.getByTestId('project-overview-team-chat'));
  });
});

describe('fix-285 the Plan of Record card has a home', () => {
  it('★★★ leads the row now, and still has one', () => {
    // ★★★ fix-285 put it between Team and Builder/Owner; fix-506 §A puts it
    //     FIRST. The claim fix-285 was making — this card has a declared slot
    //     in the row rather than floating — is what survives, and it is what
    //     this asserts.
    renderHeader();
    const order = areaOrder();
    expect(order.indexOf('por')).toBe(0);
    expect(order.indexOf('proj')).toBe(1);
    expect(screen.getByTestId('plan-of-record-card')).toBeInTheDocument();
  });
});

/** ★★ fix-417: the template is `minmax(<px>, <fr>) …` now, so splitting on
 *  whitespace no longer yields five tokens — it yields ten, and `parseFloat`
 *  on "minmax(140px," is NaN. These three assertions were pinning the right
 *  properties through a parser that assumed a bare `fr`; the parser is what
 *  changed, not what they check.
 *
 *  ★ Why the template gained `minmax`: a bare `Nfr` track is `minmax(AUTO,
 *  Nfr)`, so its floor is its own min-content and any card can silently resize
 *  its neighbours — which is exactly what happened when fix-412 widened the
 *  Units row. See lib/overviewCardLayout. */
function trackShares(el: HTMLElement): number[] {
  const t = el.style.gridTemplateColumns;
  const tracks = t.match(/minmax\([^)]*\)/g) ?? t.trim().split(/\s+/);
  return tracks.map((track) => {
    const fr = /([\d.]+)fr/.exec(track);
    return fr ? parseFloat(fr[1]) : parseFloat(track);
  });
}
