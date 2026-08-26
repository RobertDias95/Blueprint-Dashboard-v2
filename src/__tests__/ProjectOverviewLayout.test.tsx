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
function areaOrder(): string[] {
  const grid = screen.getByTestId('project-overview-grid');
  return Array.from(grid.children).map(
    (el) => (el as HTMLElement).style.gridArea?.split(' ')[0] ?? '',
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-285 the five-column overview row', () => {
  it('places the cards in the agreed order', () => {
    renderHeader();
    const order = areaOrder().filter(Boolean);
    expect(order).toEqual(['dd', 'proj', 'team', 'por', 'builder']);
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
    expect(areas).toContain('dd proj team por builder');
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

  it('has five columns', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(trackShares(grid)).toHaveLength(5);
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
    const cols = trackShares(screen.getByTestId('project-overview-grid'));
    const [dd, proj, team, por, builder] = cols;
    expect(por).toBeGreaterThan(proj);
    expect(por).toBeGreaterThan(team);
    expect(por).toBeGreaterThan(builder);
    expect(por).toBeGreaterThan(dd);
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
    expect(areaOrder()).toContain('dd');
    expect(areaOrder()).not.toContain('notes');
  });
});

describe('fix-285 the team cards stack', () => {
  it('renders Internal above External, vertically', () => {
    renderHeader();
    const internal = screen.getByTestId('project-overview-team-internal');
    const external = screen.getByTestId('project-overview-team-external');
    expect(internal).toBeInTheDocument();
    expect(external).toBeInTheDocument();
    // Following-sibling relationship: stacked, not side by side.
    expect(
      internal.compareDocumentPosition(external)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(internal.parentElement).toBe(external.parentElement);
    expect(internal.parentElement?.className).toContain('flex-col');
  });

  it('is one column of the outer grid', () => {
    renderHeader();
    const col = screen.getByTestId('project-overview-team-col');
    expect(col.style.gridArea).toContain('team');
    expect(col).toContainElement(screen.getByTestId('project-overview-team-internal'));
    expect(col).toContainElement(screen.getByTestId('project-overview-team-external'));
  });
});

describe('fix-285 the Plan of Record card has a home', () => {
  it('renders between Team and Builder/Owner', () => {
    renderHeader();
    const order = areaOrder();
    expect(order.indexOf('por')).toBe(order.indexOf('team') + 1);
    expect(order.indexOf('builder')).toBe(order.indexOf('por') + 1);
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
