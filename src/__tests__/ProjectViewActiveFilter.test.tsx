import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-245: end-to-end Active-filter behavior on the real ProjectList page.
// Fixtures: p-active has a permit in corrections; p-done has two fully-issued
// permits. Default (Active on) hides p-done; toggling off shows it.

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    { id: 'p-active', address: '1 Active Way', juris: 'Seattle', archived: false, notes: null, project_tags: null, go_date: '2026-03-01' },
    { id: 'p-done', address: '2 Done Way', juris: 'Seattle', archived: false, notes: null, project_tags: null, go_date: '2026-01-01' },
  ],
  permits: [
    // p-active: one BP still in review (no actual_issue, non-terminal status).
    {
      id: 1, project_id: 'p-active', type: 'Building Permit', stage: null, stage_override: null,
      status: 'Reviews In Process', num: 'BP-1', da: 'Cam', dm: null, ent_lead: 'Bobby', dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: null,
      approval_date: null, intake_date: null, parent_permit_id: null, notes: null, cycle_model: null,
      view_cycle: null, kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
      nickname: null, struct_address: null, portal_url: null, updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [],
    },
    // p-done: two permits, both issued.
    {
      id: 2, project_id: 'p-done', type: 'Building Permit', stage: null, stage_override: null,
      status: 'Issued', num: 'BP-2', da: 'Cam', dm: null, ent_lead: 'Bobby', dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: '2026-05-01',
      approval_date: null, intake_date: null, parent_permit_id: null, notes: null, cycle_model: null,
      view_cycle: null, kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
      nickname: null, struct_address: null, portal_url: null, updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [],
    },
    {
      id: 3, project_id: 'p-done', type: 'Demolition', stage: null, stage_override: null,
      status: 'Completed', num: 'DEMO-2', da: null, dm: null, ent_lead: null, dual_da: null,
      target_submit: null, dd_start: null, dd_end: null, expected_issue: null, actual_issue: '2026-05-02',
      approval_date: null, intake_date: null, parent_permit_id: null, notes: null, cycle_model: null,
      view_cycle: null, kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
      nickname: null, struct_address: null, portal_url: null, updated_at: '2026-05-15T12:00:00Z',
      permit_cycles: [],
    },
  ],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));

import ProjectList from '../pages/ProjectList';

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function visibleProjectIds(): string[] {
  return Array.from(
    document.querySelectorAll('tr[data-testid^="project-view-row-"]'),
  ).map((el) => (el as HTMLElement).dataset.testid!.replace('project-view-row-', ''));
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
});

describe('fix-245 Active filter on ProjectList', () => {
  it('the Active toggle renders and is pressed (ON) by default', () => {
    renderIt();
    const btn = screen.getByTestId('project-view-active-toggle');
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('default view hides the fully-issued project, shows the active one', () => {
    renderIt();
    const ids = visibleProjectIds();
    expect(ids).toContain('p-active');
    expect(ids).not.toContain('p-done');
    // "N total · N match" reflects the Active filter.
    expect(screen.getByTestId('project-view-count').textContent).toMatch(
      /2 total · 1 match/,
    );
  });

  it('toggling Active OFF reveals the done project (shows everything)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('project-view-active-toggle'));
    const btn = screen.getByTestId('project-view-active-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    const ids = visibleProjectIds();
    expect(ids).toContain('p-active');
    expect(ids).toContain('p-done');
    expect(screen.getByTestId('project-view-count').textContent).toMatch(
      /2 total · 2 match/,
    );
  });

  it('toggling Active back ON hides the done project again', () => {
    renderIt();
    const btn = screen.getByTestId('project-view-active-toggle');
    fireEvent.click(btn); // off
    fireEvent.click(btn); // on
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(visibleProjectIds()).not.toContain('p-done');
  });

  it('Active intersects with search (search a hidden done project finds nothing while Active on)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-search'), {
      target: { value: 'Done Way' },
    });
    // p-done matches the search but is hidden by Active → no rows.
    expect(visibleProjectIds()).not.toContain('p-done');
    expect(screen.getByTestId('project-view-count').textContent).toMatch(
      /2 total · 0 match/,
    );
    // Turn Active off → the searched done project appears.
    fireEvent.click(screen.getByTestId('project-view-active-toggle'));
    expect(visibleProjectIds()).toEqual(['p-done']);
  });
});
