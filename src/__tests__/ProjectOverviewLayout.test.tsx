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
    const order = areaOrder().filter((a) => a && a !== 'notes');
    expect(order).toEqual(['dd', 'proj', 'team', 'por', 'builder']);
  });

  it('declares two rows, with notes spanning DD Phase and Project', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    const areas = grid.style.gridTemplateAreas.replace(/\s+/g, ' ');
    expect(areas).toContain('dd proj team por builder');
    expect(areas).toContain('notes notes team por builder');
  });

  it('has five columns', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.gridTemplateColumns.trim().split(/\s+/)).toHaveLength(5);
  });
});

describe('fix-285 Notes moved up', () => {
  it('renders inside the header grid, not as a full-width footer', () => {
    renderHeader();
    const col = screen.getByTestId('project-overview-notes-col');
    expect(col).toBeInTheDocument();
    expect(col.style.gridArea).toContain('notes');
    // And it really is the Notes panel, not an empty placeholder.
    expect(screen.getByTestId('notes-panel')).toBeInTheDocument();
  });

  it('sits in the same grid as DD Phase and Project', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid).toContainElement(screen.getByTestId('project-overview-notes-col'));
    expect(areaOrder()).toContain('dd');
    expect(areaOrder()).toContain('notes');
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
