import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-88: amber "⚠ missing" badge in the Proposal cell when project.units
// is null or 0. Bobby spotted 2724 Walnut Ave SW had the Proposal section
// without a Units value, looking subtly different from other projects;
// 2 prod projects total have NULL units (the wizard pre-fix-88 didn't
// gate this — see Step1ProjectInfo fix-88 changes).

const T = 'test-tenant-uuid';

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

const NOW = '2026-05-15T12:00:00Z';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-test',
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
    units: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
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
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function renderHeader(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {/* ★ fix-362: the Team card reads `?msg=` / `?chat=` from the URL now
          — a chat notification lands on the message, and §2's rule is that
          the deep-link state lives in the URL and nowhere else. So this
          header needs a router, where before it needed none. */}
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader
      project={projectFixture(over)}
      permits={[]}
      bp={null}
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

describe('ProjectDetailHeader — fix-88 missing-units badge', () => {
  it('renders the badge when project.units is null', () => {
    renderHeader({ units: null });
    expect(screen.getByTestId('units-missing-badge')).toBeInTheDocument();
    expect(screen.getByTestId('units-missing-badge').textContent).toMatch(
      /missing/i,
    );
  });

  it('renders the badge when project.units is 0 (0 is not a valid count)', () => {
    renderHeader({ units: 0 });
    expect(screen.getByTestId('units-missing-badge')).toBeInTheDocument();
  });

  it('does NOT render the badge when project.units is a positive integer', () => {
    renderHeader({ units: 4 });
    expect(screen.queryByTestId('units-missing-badge')).not.toBeInTheDocument();
  });

  it('badge has a helpful tooltip pointing to Project Settings', () => {
    renderHeader({ units: null });
    const badge = screen.getByTestId('units-missing-badge');
    const title = badge.getAttribute('title') ?? '';
    expect(title).toMatch(/unit count/i);
    expect(title).toMatch(/settings/i);
  });
});
