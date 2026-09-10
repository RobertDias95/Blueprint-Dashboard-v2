import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

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
  // ★ fix-514 §F: `ProjectDataEditors` reads the project-tag registry now,
  //   so this partial mock has to carry the reader as well as the hook —
  //   the partial-mock trap, which this repo keeps meeting.
  readAppConfigStringArray: () => [],
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
  // =========================================================================
  // ★★★ SUPERSEDED BY fix-506 §C — THE COUNT IS DERIVED, SO IT CANNOT BE MISSING
  // =========================================================================
  //
  // fix-88 added this badge because Bobby spotted 2724 Walnut Ave SW (and one
  // other) saved without a unit count — the pre-fix-88 wizard did not gate it —
  // and the badge made the gap visible so somebody could backfill it. NULL and
  // 0 both flagged, because 0 is not a real unit count for any project type
  // this app handles.
  //
  // ★★★ fix-506 §C REMOVES THE GAP RATHER THAN REPORTING IT. Bobby's v14 rule
  //     is *"Units — derived count of unit rows"*, so the overview sums the
  //     `qty` of the unit types the matrix underneath actually prints. A number
  //     computed from the rows on screen cannot be stale, cannot be missing,
  //     and cannot disagree with what is under it — which is the whole of what
  //     fix-88 was defending against.
  //
  // ★★ `projects.units` IS STILL WRITTEN and still edits in Project Settings;
  //    what stopped is the OVERVIEW reading it. Nothing was backfilled and no
  //    migration rides with this — it is a display change.

  it('★★★ SUPERSEDED: no badge, because the count is summed from the rows', () => {
    renderHeader({
      units: null,
      unit_types: [
        { label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 2 },
        { label: 'SFR', width_ft: 30, depth_ft: 50, qty: 1 },
      ],
    } as Partial<Project>);
    expect(screen.queryByTestId('units-missing-badge')).toBeNull();
    expect(screen.getByTestId('pd-site-units-count').textContent).toBe('3');
  });

  it('★★★ a project with NO unit rows reads 0 — a fact, not a warning', () => {
    // ★ fix-88 treated 0 as "nobody has said". Derived, it means exactly what
    //   it says: the matrix lists no units. The matrix beside it says the same
    //   thing in more detail, so a badge would be a third telling.
    renderHeader({ units: null, unit_types: null } as Partial<Project>);
    expect(screen.queryByTestId('units-missing-badge')).toBeNull();
    expect(screen.getByTestId('pd-site-units-count').textContent).toBe('0');
    expect(screen.getByTestId('pd-units-matrix-empty')).toBeInTheDocument();
  });

  it('★★ the STORED count is ignored, even when it disagrees', () => {
    // ★★★ THE CASE THAT MADE THIS WORTH DOING. `projects.units` and the unit
    //     rows have been free to disagree since the wizard started writing
    //     both, and the overview showed the stored one. Now it shows the sum,
    //     so the number and the table under it can never contradict each other.
    renderHeader({
      units: 99,
      unit_types: [{ label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 2 }],
    } as Partial<Project>);
    expect(screen.getByTestId('pd-site-units-count').textContent).toBe('2');
  });
});
