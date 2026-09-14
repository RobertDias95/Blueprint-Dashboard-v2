import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-556 §B/§C/§D (P-263) — THE REDESIGN'S OVERVIEW, AND PROJECT VIEW
// ===========================================================================
//
// The fixture is **2443 5th Ave W**, read off prod 2026-09-14:
//   original  `f89fce48…` — 4 permits (ULS *Ready for Intake*, BP *Ready for
//             Issuance*, Demo *Issued*, PAR *Completed*), draw status Corrections
//   redesign  `95c72aeb…` — **0 permits**, draw status Scheduled, `reuse = true`
//   Pipeline search `2443` → 0 / 0 / 0 / 0 · redesign Overview → **PERMITS (0)**
//
// ★★★ THE ASSERTION THAT MATTERS MOST IS THE **ID**, not the address. §B renders
//     the original's rows through the SAME controls every permit uses, so an
//     edit must land on the row that exists. A test that checked the address
//     would pass just as happily against a copy — which is the thing P-220
//     named the fourth two-writers trap.

const T = 'test-tenant-uuid';
const ORIGINAL = 'f89fce48-4ef4-400d-a096-2e0612043201';
const REDESIGN = '95c72aeb-65db-4b46-b2af-12704a7b8128';
const NOW = '2026-09-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  /** permits keyed by project id — the mock resolves by ARGUMENT, because this
   *  ticket's whole point is that the page asks for two different projects. */
  permitsByProject: new Map<string, Record<string, unknown>[]>(),
  /** every permit id the page handed to an editor. */
  editedPermitIds: [] as number[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: refs.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
// ★★★ KEYED ON THE ARGUMENT. A mock that returns one list for every project id
//     would make §B pass without the union existing at all — the redesign would
//     "have" the original's permits because the fixture handed them to it.
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: (projectId: string | undefined) => ({
    data: projectId ? refs.permitsByProject.get(projectId) ?? [] : undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../components/ProjectDetail/ProjectDetailHeader', () => ({
  default: ({ permits }: { permits: { id: number }[] }) => (
    <div data-testid="stub-project-header" data-permit-ids={permits.map((p) => p.id).join(',')} />
  ),
}));
// ★ The table records what it was handed AND offers an edit control per row, so
//   the save target is assertable without mounting the whole modal.
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: ({
    permits,
    onEditPermit,
  }: {
    permits: { id: number; type: string }[];
    onEditPermit: (id: number) => void;
  }) => (
    <div data-testid="stub-permits-table" data-permit-ids={permits.map((p) => p.id).join(',')}>
      {permits.map((p) => (
        <button
          key={p.id}
          type="button"
          data-testid={`edit-permit-${p.type}`}
          onClick={() => onEditPermit(p.id)}
        >
          {p.type}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../components/ProjectDetail/NotesPanel', () => ({
  default: () => <div data-testid="stub-notes-panel" />,
}));
vi.mock('../components/ProjectDetail/ProjectDetailsModal', () => ({
  default: ({ initialFocusPermitId }: { initialFocusPermitId: number | null }) => {
    if (initialFocusPermitId != null) refs.editedPermitIds.push(initialFocusPermitId);
    return <div data-testid="stub-project-data-modal" />;
  },
}));
vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteRedesignDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/EditRedesignModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({ default: () => null }));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));

import ProjectDetail from '../pages/ProjectDetail';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    acq_lead: null, external_team: {}, builder_id: null, permit_order: [],
    entitlement_lead: null, design_manager: null, go_date: null, units: null,
    zone: null, lot_width: null, lot_depth: null, lot_size_sf: null,
    unit_types: null, parking_type: null, parking_stalls: null, alley: null,
    product_types: [], project_tags: null, builder_name: null,
    builder_company: null, builder_email: null, builder_phone: null,
    redesign_of_project_id: null, redesign_trigger: null,
    redesign_reuses_original_permit: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}
function permit(
  id: number,
  projectId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null,
    parent_permit_id: null, updated_at: NOW, permit_cycles: [], ...over,
  };
}

/** 2443 5th Ave W's four permits — all on the ORIGINAL, prod 2026-09-14. */
const ULS_ID = 10501;
const ORIGINAL_PERMITS = [
  permit(10499, ORIGINAL, { type: 'Building Permit', status: 'Ready for Issuance', approval_date: '2026-08-01' }),
  permit(10500, ORIGINAL, { type: 'Demolition', status: 'Issued', actual_issue: '2026-06-02' }),
  permit(ULS_ID, ORIGINAL, { type: 'ULS', status: 'Ready for Intake' }),
  permit(10502, ORIGINAL, { type: 'PAR/Pre-Sub', status: 'Completed', actual_issue: '2026-03-03' }),
];

function renderPage(projectId: string, search = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${projectId}${search}`]}>
        <Routes>
          <Route path="/project/:id" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tablePermitIds(): number[] {
  const el = screen.getByTestId('stub-permits-table');
  const raw = el.getAttribute('data-permit-ids') ?? '';
  return raw ? raw.split(',').map(Number) : [];
}

beforeEach(() => {
  // ★ jsdom has no `scrollIntoView`; the deep-link effect calls it on resolve.
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
  useAuthStore.setState({ activeTenantId: T });
  refs.editedPermitIds.length = 0;
  refs.permitsByProject = new Map([
    [ORIGINAL, ORIGINAL_PERMITS],
    [REDESIGN, []],
  ]);
  refs.projects = [
    project({ id: ORIGINAL, address: '2443 5th Ave W' }),
    project({
      id: REDESIGN,
      address: '2443 5th Ave W [Redesign 1]',
      redesign_of_project_id: ORIGINAL,
      redesign_reuses_original_permit: true,
    }),
  ];
});

describe('fix-556 §B — the redesign renders the original’s permits, through the same controls', () => {
  it('★★★ the permits table lists the original’s four — it listed ZERO before', () => {
    renderPage(REDESIGN);
    expect(tablePermitIds()).toEqual([10499, 10500, ULS_ID, 10502]);
  });

  it('★★★ editing the ULS targets the ORIGINAL’s permit ID — not an address, not a copy', () => {
    // ★★★ THE ASSERTION THE TICKET TURNS ON. These are the original's rows, so
    //     the id the editor opens on must be the original's ULS id. If §B ever
    //     becomes a copy, this is the test that fails.
    renderPage(REDESIGN);
    fireEvent.click(screen.getByTestId('edit-permit-ULS'));
    expect(refs.editedPermitIds).toContain(ULS_ID);
  });

  it('★★★ `?permit=<the original’s ULS>` resolves — fix-421’s quick-edit trap, closed', () => {
    // ★★ A resolver that looks only at THIS project's own rows returns null for
    //    every mirrored permit, and the deep link silently lands on the overview.
    renderPage(REDESIGN, `?permit=${ULS_ID}`);
    expect(screen.queryByTestId('project-overview-pane')).toBeNull();
  });

  it('★★★ the provenance line names where the permits came from', () => {
    renderPage(REDESIGN);
    expect(screen.getByTestId('permits-from-original').textContent).toBe(
      "Permits from 2443 5th Ave W — this project reuses the original's permits.",
    );
  });

  it('★★ the BP anchor resolves through the union — the header gets the permits', () => {
    renderPage(REDESIGN);
    expect(
      screen.getByTestId('stub-project-header').getAttribute('data-permit-ids'),
    ).toBe(`10499,10500,${ULS_ID},10502`);
  });

  it('★★★ reuse = FALSE shows its OWN permits and prints NO provenance line', () => {
    // ★ 5053 25th Ave SW's shape: 2 of its own, 5 on the original, nothing mirrored.
    refs.permitsByProject = new Map([
      [ORIGINAL, ORIGINAL_PERMITS],
      [REDESIGN, [permit(20001, REDESIGN, { type: 'PPR' }), permit(20002, REDESIGN, { type: 'PPR' })]],
    ]);
    refs.projects = [
      project({ id: ORIGINAL, address: '5053 25th Ave SW' }),
      project({
        id: REDESIGN,
        address: '5053 25th Ave SW [Redesign 1]',
        redesign_of_project_id: ORIGINAL,
        redesign_reuses_original_permit: false,
      }),
    ];
    renderPage(REDESIGN);
    expect(tablePermitIds()).toEqual([20001, 20002]);
    expect(screen.queryByTestId('permits-from-original')).toBeNull();
  });

  it('★★★ reuse = NULL mirrors nothing either — and it is not a "No"', () => {
    refs.permitsByProject = new Map([
      [ORIGINAL, ORIGINAL_PERMITS],
      [REDESIGN, [permit(30001, REDESIGN, { type: 'PPR' })]],
    ]);
    refs.projects = [
      project({ id: ORIGINAL, address: '4120 49th Ave S' }),
      project({
        id: REDESIGN,
        address: '4120 49th Ave S [Redesign 1]',
        redesign_of_project_id: ORIGINAL,
        redesign_reuses_original_permit: null,
      }),
    ];
    renderPage(REDESIGN);
    expect(tablePermitIds()).toEqual([30001]);
    expect(screen.queryByTestId('permits-from-original')).toBeNull();
  });

  it('★★ the ORIGINAL’s own Overview still renders its own permits — nothing was frozen', () => {
    // ★ fix-524 §D's snapshot is untouched: the rows are still the original's
    //   and they still render there. The mirror ADDS a reader, it moves nothing.
    renderPage(ORIGINAL);
    expect(tablePermitIds()).toEqual([10499, 10500, ULS_ID, 10502]);
    expect(screen.queryByTestId('permits-from-original')).toBeNull();
  });
});

describe('fix-556 §C — the current project is titled the plain address', () => {
  it('★★★ the Overview title drops `[Redesign 1]`', () => {
    renderPage(REDESIGN);
    const page = screen.getByTestId('project-detail-page');
    expect(page.textContent).toContain('2443 5th Ave W');
    expect(page.textContent).not.toContain('[Redesign 1]');
    expect(page.textContent).not.toContain('Redesign 1]');
  });

  it('★★★ and the stored address is UNCHANGED — the indexer’s key is not ours to edit', () => {
    // ★ 17 rows carry it literally, and it is what fix-524 taught to read
    //   through to the original's drawings. Asserted on the fixture, which is
    //   the prod string.
    renderPage(REDESIGN);
    expect(
      (refs.projects.find((p) => p.id === REDESIGN) as { address: string }).address,
    ).toBe('2443 5th Ave W [Redesign 1]');
  });
});
