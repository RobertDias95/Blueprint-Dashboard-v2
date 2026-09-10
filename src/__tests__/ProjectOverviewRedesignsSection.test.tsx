import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-151: the Redesigns section at the bottom of the permits sidebar lists each
// redesign of the project + its permits (reuses-permit redesigns show a
// sub-label instead). Rows link to the redesign's project overview.

const T = 'test-tenant-uuid';
const PARENT = 'p-parent';
const NOW = '2026-05-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  allPermits: [] as Record<string, unknown>[],
  parentPermits: [] as Record<string, unknown>[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refs.allPermits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({ data: refs.parentPermits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../components/ProjectDetail/ProjectDetailHeader', () => ({
  default: () => <div data-testid="stub-project-header" />,
}));
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: () => <div data-testid="stub-schedule-health-table" />,
}));
vi.mock('../components/ProjectDetail/NotesPanel', () => ({
  default: () => <div data-testid="stub-notes-panel" />,
}));
vi.mock('../components/ProjectDetail/ProjectSettingsModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({ default: () => null }));
// fix-193: stub the redesign edit/delete dialogs so opening one doesn't pull in
// the draw-schedule/team hooks; behavior is covered in RedesignDeleteEdit.test.
vi.mock('../components/ProjectDetail/DeleteRedesignDialog', () => ({
  default: () => <div data-testid="stub-delete-redesign" />,
}));
vi.mock('../components/ProjectDetail/EditRedesignModal', () => ({
  default: () => <div data-testid="stub-edit-redesign" />,
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

vi.mock('../components/ProjectDetail/QuickEditPermitModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({ default: () => null }));

import ProjectDetail from '../pages/ProjectDetail';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    acq_lead: null, external_team: {}, builder_id: null, permit_order: [],
    entitlement_lead: null, design_manager: null, go_date: null, units: null,
    zone: null, lot_width: null, lot_depth: null, lot_size_sf: null, unit_types: null,
    parking_type: null, parking_stalls: null, alley: null, product_types: [],
    project_tags: null, builder_name: null, builder_company: null,
    builder_email: null, builder_phone: null,
    redesign_of_project_id: null, redesign_trigger: null,
    redesign_reuses_original_permit: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}
function permit(id: number, projectId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: null, dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null, updated_at: NOW,
    permit_cycles: [], ...over,
  };
}

/** ★ fix-421: a redesign permit CARD is a div, not a link — it cannot be
 *  asserted with `getAttribute('href')` any more. This reports where the
 *  router actually went so the click can be asserted on its effect. */
function LocationProbe() {
  return <span data-testid="probe-path">{useLocation().pathname}</span>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${PARENT}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>
    </>,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  refs.projects = [project({ id: PARENT, address: '4120 49th Ave S' })];
  refs.parentPermits = [permit(1, PARENT)];
  refs.allPermits = [permit(1, PARENT)];
});

describe('<ProjectDetail /> Redesigns section (fix-151)', () => {
  it('does not render the section when the project has no redesigns', () => {
    renderPage();
    expect(screen.queryByTestId('project-overview-redesigns-section')).toBeNull();
  });

  it('renders a redesign (new permits) with its trigger + permit rows', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_trigger: 'acquisitions' }),
    ];
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1', { type: 'Building Permit' })];
    renderPage();
    expect(screen.getByTestId('project-overview-redesigns-section')).toBeTruthy();
    const row = screen.getByTestId('project-overview-redesign-row-r1');
    expect(row.textContent).toContain('Redesign 1');
    expect(row.textContent).toContain('Acquisitions');
    // ★★★ fix-517 §A: the redesign's PERMITS are rows in the PERMITS table now,
    //     not cards in this band — the band was showing the same permits the
    //     table beside it had rendered since fix-151, which is the redundancy
    //     the rail was deleted for. What the band says instead is HOW MANY and
    //     WHERE, which is a destination rather than a duplicate.
    expect(screen.queryByTestId('project-overview-redesign-permit-10248')).toBeNull();
    const note = screen.getByTestId('project-overview-redesign-permits-note-r1');
    expect(note.textContent).toContain('1 permit,');
    expect(note.textContent).toContain('in the table above');
  });

  // ★★★ SUPERSEDED BY fix-421, and the reason it existed is now the card's job.
  //
  // fix-193 wrote `redesignPermitLabel()` so a number-less PPR would not read as
  // blank — it produced "PPR · Pre-Submittal · no number yet". fix-421 renders
  // these with `SidebarRow`, the same component every other permit in the panel
  // uses, and that component already prints the type, the stage breadcrumb and
  // an italic "No permit # yet" where the number goes. The label function is
  // deleted rather than kept: a second labeller beside a card that labels itself
  // is exactly the drift fix-290 spent a ticket removing from the overview.
  //
  // The ASSERTION is unchanged in intent — a number-less PPR must not look
  // empty — and now checks the card that says so.
  it('fix-193 → fix-421: a reuses-permit redesign keeps the note AND its number-less PPR still reads as a permit', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_reuses_original_permit: true }),
    ];
    refs.allPermits = [
      permit(1, PARENT),
      // The redesign's own placeholder permit: type PPR, no number yet.
      permit(10321, 'r1', { type: 'PPR', num: null }),
    ];
    renderPage();
    const section = screen.getByTestId('project-overview-redesigns-section');
    expect(section.textContent).toContain("Reuses parent's permits");
    // ★★★ SUPERSEDED AGAIN, BY fix-517 §A — and the intent is unchanged for the
    //     third time running. fix-193 wrote a label so a number-less PPR would
    //     not read as blank; fix-421 replaced the label with the shared card,
    //     which prints "No permit # yet" itself; fix-517 replaces the card with
    //     a TABLE ROW, whose Permit Number column prints exactly the same
    //     words. **26 of 685 prod permits have no number**, so §B makes that
    //     cell's empty state an explicit requirement rather than a side effect.
    //     It is asserted against the real table in `PermitsTableFix517`.
    //
    // ★ What THIS suite still owns is the note, which is the half of the band
    //   that never moved: a reuses-parent redesign says so in words.
    expect(screen.queryByTestId('project-overview-redesign-permit-10321')).toBeNull();
    expect(
      screen.getByTestId(`project-overview-redesign-note-r1`).textContent,
    ).toContain("Reuses parent's permits");
  });

  it('a reuses-permit redesign with no permits at all shows just the note', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT, redesign_reuses_original_permit: true }),
    ];
    refs.allPermits = [permit(1, PARENT)]; // redesign has none
    renderPage();
    const section = screen.getByTestId('project-overview-redesigns-section');
    expect(section.textContent).toContain("Reuses parent's permits");
    expect(screen.queryByTestId(/project-overview-redesign-permit-/)).toBeNull();
  });

  it('renders multiple redesigns in created_at order (Redesign 1, Redesign 2)', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r2', redesign_of_project_id: PARENT, created_at: '2026-05-20T00:00:00Z' }),
      project({ id: 'r1', redesign_of_project_id: PARENT, created_at: '2026-05-10T00:00:00Z' }),
    ];
    refs.allPermits = [permit(1, PARENT)];
    renderPage();
    expect(screen.getByTestId('project-overview-redesign-row-r1').textContent).toContain('Redesign 1');
    expect(screen.getByTestId('project-overview-redesign-row-r2').textContent).toContain('Redesign 2');
  });

  it('redesign row links to the redesign project overview', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.allPermits = [permit(1, PARENT)];
    renderPage();
    expect(
      screen.getByTestId('project-overview-redesign-row-r1').getAttribute('href'),
    ).toBe('/project/r1');
  });

  it('fix-193: each redesign row has edit + delete actions; delete opens the dialog', () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.allPermits = [permit(1, PARENT)];
    renderPage();
    expect(screen.getByTestId('project-overview-redesign-edit-r1')).toBeTruthy();
    const del = screen.getByTestId('project-overview-redesign-delete-r1');
    expect(screen.queryByTestId('stub-delete-redesign')).toBeNull();
    fireEvent.click(del);
    expect(screen.getByTestId('stub-delete-redesign')).toBeTruthy();
  });

  // ★★★ SUPERSEDED BY fix-421 — SAME DESTINATION, DIFFERENT ELEMENT.
  //
  // fix-151 made the whole row an <a>. fix-421 makes it the shared permit card,
  // which CONTAINS an <a> of its own (the permit number's portal link), and an
  // anchor inside an anchor is invalid markup that browsers un-nest. So the card
  // is a div whose click navigates — the destination is unchanged, which is what
  // this ticket was told to leave alone; only the mechanism moved.
  //
  // ★★★ fix-517 §A/§E: THE CARD IS GONE AND SO IS THE DEFER. fix-421 delayed a
  //     redesign card's click by 250ms so a double-click could reach Quick
  //     Edit first; §E deletes Quick Edit and §A deletes the cards. What is
  //     left is the HEADING link, which is fix-151's original destination and
  //     now navigates immediately.
  it('fix-151 → fix-517: the redesign heading still goes to the redesign project', async () => {
    refs.projects = [
      project({ id: PARENT }),
      project({ id: 'r1', redesign_of_project_id: PARENT }),
    ];
    refs.allPermits = [permit(1, PARENT), permit(10248, 'r1')];
    renderPage();
    expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${PARENT}`);
    fireEvent.click(screen.getByTestId('project-overview-redesign-row-r1'));
    await waitFor(() =>
      expect(screen.getByTestId('probe-path').textContent).toBe('/project/r1'),
    );
  });
});
