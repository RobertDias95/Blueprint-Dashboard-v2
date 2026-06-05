import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';

// fix-126-d: Project Overview redesign surfaces.
//   - Top "Redesign of [original]" badge is rendered by the page,
//     not the header — covered separately in the ProjectDetail page
//     test.
//   - ProjectDetailHeader's Proposal cell renders an expandable
//     "Redesigns (N)" subsection when the project has descendant
//     redesigns (any allProjects entry with redesign_of_project_id
//     pointing at the current project's id).

const T = 'test-tenant-uuid';
const OLD_TOKEN = '2026-05-15T12:00:00Z';

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

type Project = Parameters<typeof ProjectDetailHeader>[0]['project'];

function projectFixture(over: Partial<Record<string, unknown>> = {}): Project {
  return {
    id: 'p-parent',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    num_lots: null,
    is_corner_lot: null,
    closing_date: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    redesign_of_project_id: null,
    redesign_trigger: null,
    redesign_reuses_original_permit: null,
    redesign_notes: null,
    created_at: OLD_TOKEN,
    updated_at: OLD_TOKEN,
    ...over,
  } as unknown as Project;
}

function setup(opts: {
  project?: Partial<Record<string, unknown>>;
  allProjects?: Partial<Record<string, unknown>>[];
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(opts.project);
  const allProjects = (opts.allProjects ?? []).map((p) =>
    projectFixture({ id: 'p-default', address: '—', ...p }),
  );
  queryClient.setQueryData(queryKeys.projects(T), [project, ...allProjects]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader
      project={project}
      permits={[]}
      bp={null}
      allProjects={[project, ...allProjects]}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('ProjectDetailHeader — fix-126 Redesigns (N) subsection', () => {
  it('does NOT render the section when this project has no redesigns', () => {
    setup();
    expect(screen.queryByTestId('pd-redesigns-section')).toBeNull();
    expect(screen.queryByTestId('pd-redesigns-toggle')).toBeNull();
  });

  it('renders the collapsed toggle with the count when ≥1 child redesign exists', () => {
    setup({
      allProjects: [
        {
          id: 'p-r1',
          address: '500 Pike St [Redesign 1]',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: true,
          created_at: '2026-05-16T12:00:00Z',
        },
        {
          id: 'p-r2',
          address: '500 Pike St [Redesign 2]',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'market',
          redesign_reuses_original_permit: false,
          created_at: '2026-05-20T12:00:00Z',
        },
      ],
    });
    const toggle = screen.getByTestId('pd-redesigns-toggle');
    expect(toggle.textContent).toMatch(/Redesigns \(2\)/);
    // Collapsed by default: list isn't in the DOM.
    expect(screen.queryByTestId('pd-redesigns-list')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the toggle expands the list with one row per redesign in created_at order', () => {
    setup({
      allProjects: [
        // Out-of-order on purpose — sort should bring #1 above #2.
        {
          id: 'p-r2',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'market',
          redesign_reuses_original_permit: false,
          created_at: '2026-05-20T12:00:00Z',
        },
        {
          id: 'p-r1',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: true,
          created_at: '2026-05-16T12:00:00Z',
        },
      ],
    });
    fireEvent.click(screen.getByTestId('pd-redesigns-toggle'));
    const list = screen.getByTestId('pd-redesigns-list');
    expect(list).toBeInTheDocument();
    expect(
      screen.getByTestId('pd-redesigns-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
    // Two rows; the earlier-created one is "Redesign #1".
    const r1 = screen.getByTestId('pd-redesign-row-p-r1');
    const r2 = screen.getByTestId('pd-redesign-row-p-r2');
    expect(r1.textContent).toContain('Redesign #1');
    expect(r1.textContent).toContain('builder');
    expect(r1.textContent).toContain('reuse');
    expect(r2.textContent).toContain('Redesign #2');
    expect(r2.textContent).toContain('market');
    expect(r2.textContent).toContain('new permits');
    // Order in the DOM: r1 before r2 (created_at ascending).
    const positions = Array.from(list.children).map((c) =>
      (c as HTMLElement).getAttribute('data-testid'),
    );
    expect(positions).toEqual([
      'pd-redesign-row-p-r1',
      'pd-redesign-row-p-r2',
    ]);
  });

  it('each redesign row carries a link to its project overview', () => {
    setup({
      allProjects: [
        {
          id: 'p-r1',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'builder',
          redesign_reuses_original_permit: true,
          created_at: '2026-05-16T12:00:00Z',
        },
      ],
    });
    fireEvent.click(screen.getByTestId('pd-redesigns-toggle'));
    const row = screen.getByTestId('pd-redesign-row-p-r1');
    const link = row.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/project/p-r1');
  });

  it('null reuse flag does not append " · reuse" / " · new permits" to the row', () => {
    setup({
      allProjects: [
        {
          id: 'p-r1',
          redesign_of_project_id: 'p-parent',
          redesign_trigger: 'other',
          redesign_reuses_original_permit: null,
          created_at: '2026-05-16T12:00:00Z',
        },
      ],
    });
    fireEvent.click(screen.getByTestId('pd-redesigns-toggle'));
    const row = screen.getByTestId('pd-redesign-row-p-r1');
    expect(row.textContent).not.toContain('reuse');
    expect(row.textContent).not.toContain('new permits');
  });

  it('a project that IS a redesign (has redesign_of_project_id) but no children does not render the section', () => {
    // The "Redesign of X" top badge lives on the page, not the header.
    // This pins that the Proposal-cell subsection only fires on
    // PARENTS, not on children.
    setup({
      project: { redesign_of_project_id: 'some-other-uuid' },
    });
    expect(screen.queryByTestId('pd-redesigns-section')).toBeNull();
  });
});
