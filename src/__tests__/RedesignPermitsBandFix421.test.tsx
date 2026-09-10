import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// fix-421 — the permits panel gives redesigns their own category
// ===========================================================================
//
// Bobby, 2026-08-26, verbatim:
//
//   *"Redesign clearly should show the permits, just like the other permits in
//    the permit tab, but just in the category of redesign. And I think issued
//    should be at the bottom, redesign should be above that, and then all the
//    other active and ongoing permits should be above that."*
//
// Two requirements in one sentence — an ORDER and a RENDERING — and this suite
// is split the same way.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0, VERIFIED ON PROD 2026-08-27, AND ONE CORRECTION TO THE BRIEF
// ---------------------------------------------------------------------------
//
// The panel is `PermitsSidebar` (src/pages/ProjectDetail.tsx). Its order before
// this ticket was ACTIVE → ✓ ISSUED → ↳ REDESIGNS, exactly as the brief
// believed. Every other permit rendered with `SidebarRow`; a redesign's permits
// rendered as bare `<OriginLink>` one-liners built by `redesignPermitLabel()` —
// `PPR · Corrections`, no dot, no number, no portal link, no quick edit.
//
// ★★★ "ISSUED" IS DECIDED BY `effectiveStage(...) === 'is'`, AND IT STAYS THAT
// WAY. The brief offered `actual_issue IS NOT NULL` "unless STEP 0 (c) finds an
// established helper". It found one, and it is NOT equivalent: measured on prod,
// `effectiveStage === 'is'` selects 361 permits and `actual_issue IS NOT NULL`
// selects 358. Adopting the brief's rule would silently move **3 permits** out
// of the issued band and into the active one — permits whose portal status is
// terminal ('Approved' / 'Conceptually Approved' / 'Issued' / 'Completed' /
// 'Closed') but which carry no stamped issue date, which is precisely the cohort
// fix-65 migrated the panel OFF `!!actual_issue` to catch. This ticket is about
// band order and redesign rendering; re-deciding "issued" for 361 permits is not
// in it. One rule, unchanged, stated here.
//
// ★ The fixture below is the real 5053 25th Ave SW shape, read off prod. One
//   correction to the brief: permit 10372 (`7101525-CN-005`) has status
//   "Reviews In Process", not "Corrections Submitted". 10321 is
//   "Corrections Required" as described.

const T = 'test-tenant-uuid';
const PARENT = 'p-5053';
const R1 = 'r-5053-1';
const NOW = '2026-05-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  allPermits: [] as Record<string, unknown>[],
  parentPermits: [] as Record<string, unknown>[],
  quickEdited: [] as unknown[],
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
vi.mock('../components/ProjectDetail/ProjectDetailsModal', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({ default: () => null }));
vi.mock('../components/ProjectDetail/DeleteRedesignDialog', () => ({
  default: () => <div data-testid="stub-delete-redesign" />,
}));
vi.mock('../components/ProjectDetail/EditRedesignModal', () => ({
  default: () => <div data-testid="stub-edit-redesign" />,
}));
// ★ The quick-edit modal records WHICH permit it was handed. That is the whole
//   assertion for the double-click gesture: opening at all is not enough — it
//   has to open on the redesign's permit, which is the lookup that fails if the
//   page resolves quick-edit against this project's permits only.
// ★ fix-517 §E: `QuickEditPermitModal` is deleted — nothing to mock.

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
    nickname: null, struct_address: null, portal_url: null,
    parent_permit_id: null, updated_at: NOW, permit_cycles: [], ...over,
  };
}

/** ★ 5053 25th Ave SW, read off prod 2026-08-27. Two issued BPs, a Demolition
 *  at "Ready for Issuance" (which is APPROVED, not issued — it stays active),
 *  and two ULS permits in review. */
const PARENT_PERMITS = [
  permit(10203, PARENT, {
    num: '7101525-CN', type: 'Building Permit', status: 'Issued',
    actual_issue: '2026-07-07', approval_date: '2026-04-23',
  }),
  permit(10206, PARENT, {
    num: '7102488-CN', type: 'Building Permit', status: 'Issued',
    actual_issue: '2026-07-07', approval_date: '2026-04-02',
  }),
  permit(10204, PARENT, {
    num: '7101526-DM', type: 'Demolition', status: 'Ready for Issuance',
    approval_date: '2026-01-13',
  }),
  permit(10205, PARENT, { num: '3043241-LU', type: 'ULS', status: 'Additional Info Requested' }),
  permit(10207, PARENT, { num: '3043266-LU', type: 'ULS', status: 'Additional Info Requested' }),
];

/** ★ Its redesign's two permits — both PPR, both in review. */
const REDESIGN_PERMITS = [
  permit(10321, R1, {
    num: '7102488-CN-004', type: 'PPR', status: 'Corrections Required',
    permit_cycles: [
      { id: 1, permit_id: 10321, cycle_index: 0, submitted: '2026-06-01', corr_issued: '2026-07-02' },
    ],
  }),
  permit(10372, R1, { num: '7101525-CN-005', type: 'PPR', status: 'Reviews In Process' }),
];

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

/** The 5053 shape: parent + one redesign carrying two PPRs. */
function setupFiveOhFiveThree(redesignOver: Record<string, unknown> = {}) {
  refs.projects = [
    project({ id: PARENT, address: '5053 25th Ave SW' }),
    project({
      id: R1,
      address: '5053 25th Ave SW [Redesign 1]',
      redesign_of_project_id: PARENT,
      redesign_reuses_original_permit: false,
      redesign_trigger: 'acquisitions',
      ...redesignOver,
    }),
  ];
  refs.parentPermits = PARENT_PERMITS;
  refs.allPermits = [...PARENT_PERMITS, ...REDESIGN_PERMITS];
}

beforeEach(() => {
  refs.quickEdited.length = 0;
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  setupFiveOhFiveThree();
});

// ---------------------------------------------------------------------------
// §A · THE ORDER — active/ongoing → redesigns → issued
//
// ★★★ SUPERSEDED BY fix-517 §A, AND IT IS THE SAME RULING WITH A BIGGER SCOPE.
//
// fix-421 asked for three bands in one rail because *"a redesign is live work
// and an issued permit is not"*. fix-517 §A deletes the rail: Bobby, *"Permits
// on the left-hand side of the screen is gone… all of that information is kind
// of redundant"* — two of the three bands were the same permits the Schedule
// Health table four inches to the right had been rendering since fix-151.
//
// ★★★ SO THE ORDER MOVED RATHER THAN DIED. §C ships it as the PERMITS table's
//     DEFAULT SORT — D&E → Corrections → Permitting → Approved → **Issued
//     last** — and fix-421's own ruling ("issued at the bottom") is the part of
//     it Bobby restated. It is asserted against the real table in
//     `PermitsTableFix517.test.tsx`; this suite stubs the table, and always
//     has.
//
// ★★ THE REDESIGNS BAND ITSELF SURVIVES, moved onto the overview pane — it is
//    the only surface that can rename or delete a redesign. What it lost is
//    its permit CARDS, because those permits are rows in the table now and a
//    pane listing them twice is the redundancy this ticket exists to remove.
// ---------------------------------------------------------------------------

describe('fix-421 §A → fix-517 §A: the rail is gone, the band is not', () => {
  it('★★★ no rail, and the redesigns band is on the overview pane', () => {
    renderPage();
    // The rail and every band marker that lived in it.
    expect(screen.queryByTestId('permits-sidebar-list')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-count')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-issued-divider')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-issued-group')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-row-10205')).toBeNull();
    // ★ The band is still here, still counted, still inside the overview pane.
    const band = screen.getByTestId('project-overview-redesigns-section');
    expect(
      screen.getByTestId('permits-sidebar-redesigns-divider').textContent,
    ).toContain('Redesigns (1)');
    expect(screen.getByTestId('project-overview-pane').contains(band)).toBe(true);
  });

  it('★★★ it sits BELOW the permits table, which is where its permits are', () => {
    // ★ fix-421 put redesigns between the active band and the issued one. With
    //   one table there is no "between": the band follows the table, and the
    //   permits it used to card are rows inside it tagged `↳ Redesign N`.
    renderPage();
    const table = screen.getByTestId('stub-schedule-health-table');
    const band = screen.getByTestId('project-overview-redesigns-section');
    expect(
      table.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §B · THE RENDERING — "just like the other permits in the permit tab"
//
// ★★★ SUPERSEDED, AND FIX-517 IS THE STRONGER VERSION OF THE SAME ASK. fix-421
//     replaced fix-151's bare `PPR · Corrections` links with the shared
//     `SidebarRow`, so a redesign's permits would read as permits rather than
//     as footnotes. fix-517 §A puts them in the SAME TABLE as every other
//     permit, in the same nine columns, with a `↳ Redesign N` line saying whose
//     they are. Bobby's *"just like the other permits in the permit tab, but
//     just in the category of redesign"* is satisfied more completely by one
//     list than it ever was by an identical card in a separate band.
//
// ★★★ AND §E DELETED THE GESTURE THIS SECTION WAS MOSTLY ABOUT. Two of these
//     five tests existed to protect double-click Quick Edit on a redesign card
//     — including `REDESIGN_CLICK_DEFER_MS`, a 250ms pause invented so the
//     double-click could land before the navigation unmounted the card.
//     `QuickEditPermitModal` is deleted (it and fix-514's Permits tab were two
//     editors for one field set), so the gesture is gone and the delay with it.
//     Editing is a hover ✎ on the table row now, asserted in
//     `PermitsTableFix517.test.tsx`.
// ---------------------------------------------------------------------------

describe('fix-421 §B → fix-517 §A/§E: the cards moved into the table', () => {
  it('★★★ the band renders NO permit cards, and says where they went', () => {
    renderPage();
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    // Not one shared card survives in the band.
    expect(within(group).queryByTestId('permits-sidebar-row-10321')).toBeNull();
    expect(within(group).queryByTestId('permits-sidebar-row-10372')).toBeNull();
    expect(screen.queryByTestId('project-overview-redesign-permit-10321')).toBeNull();
    // ★ …and it is not silent about it: the note counts them and points at the
    //   table above, which is a destination rather than an absence.
    const note = screen.getByTestId(
      `project-overview-redesign-permits-note-${R1}`,
    );
    expect(note.textContent).toContain('2 permits');
    expect(note.textContent).toContain('in the table above');
  });

  it('★★★ the double-click gesture is GONE, and so is the 250ms defer it needed', async () => {
    // ★★ Asserted on the SOURCE as well as the DOM, because the defer was a
    //    constant rather than a rendered thing and a deleted gesture that left
    //    its latency behind would be invisible in either alone.
    const src = (await import('../pages/ProjectDetail.tsx?raw')).default as string;
    // ★ Scoped to the CODE: the constant's name survives in the note recording
    //   why it went, which is the point of recording it. `setTimeout` is the
    //   mechanism and it is what must be absent from the redesign group.
    expect(src).not.toContain('const REDESIGN_CLICK_DEFER_MS');
    expect(src).not.toContain('deferNavigate');
    expect(src).not.toContain('onDoubleClick');
    // ★ Again scoped to the CODE: the page's §E note names the deleted modal
    //   in prose, and a "must not appear" grep that matches its own gravestone
    //   is fix-516's trap. What must be absent is the IMPORT.
    expect(src).not.toContain("from '../components/ProjectDetail/QuickEditPermitModal'");
    expect(src).not.toContain('<QuickEditPermitModal');
  });

  it('★★ the heading still links straight to the redesign, with no delay', async () => {
    // Scope 5, unchanged destination — and now unchanged TIMING too: fix-421
    // deferred this click by 250ms so a double-click could pre-empt it, and
    // there is no double-click left to pre-empt it.
    renderPage();
    fireEvent.click(screen.getByTestId(`project-overview-redesign-row-${R1}`));
    await waitFor(() =>
      expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${R1}`),
    );
  });

  it('★ the redesign label is still the GROUP HEADING', () => {
    // Scope 2: *"the redesign's own label ('Redesign 1 · Acquisitions') as the
    // group heading rather than as the row."* Untouched — the heading is the
    // half of this band that was never redundant.
    renderPage();
    const heading = screen.getByTestId(`project-overview-redesign-row-${R1}`);
    expect(heading.textContent).toContain('Redesign 1');
    expect(heading.textContent).toContain('Acquisitions');
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    expect(group.contains(heading)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §C · THE EMPTY STATE — the majority case
// ---------------------------------------------------------------------------

describe('fix-421 §C: a redesign with no permits says so', () => {
  it('★★★ 12 of 17 active redesigns carry no permits — none of them is a bare heading', () => {
    // ★ Measured on prod 2026-08-27: 17 active redesigns, 12 with zero permits.
    //   A heading with nothing under it reads as a component that failed to
    //   load, which is a worse bug than the one this ticket fixes.
    setupFiveOhFiveThree({ redesign_reuses_original_permit: true });
    refs.allPermits = [...PARENT_PERMITS]; // the redesign has none
    renderPage();
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    const empty = within(group).getByTestId(`project-overview-redesign-empty-${R1}`);
    expect(empty.textContent).toMatch(/No permits/i);
    expect(within(group).queryByTestId('permits-sidebar-row-10321')).toBeNull();
  });

  it('★★ the empty line is keyed off the PERMIT COUNT, not off the reuse flag', () => {
    // ★★★ In prod today those two select exactly the same 12 rows — every
    //     reuse=true redesign has zero permits, and every redesign WITH permits
    //     answered the question. That is a coincidence, not a rule: a redesign
    //     whose reuse question is unanswered and whose permits have not been
    //     created yet is a real state (it is the state every new redesign is in
    //     for a while), and keying off the flag renders it as a bare heading.
    //     Zero such rows today; the line has to be right the first time one
    //     exists — which is exactly what this asserts.
    setupFiveOhFiveThree({ redesign_reuses_original_permit: null });
    refs.allPermits = [...PARENT_PERMITS];
    renderPage();
    expect(
      screen.getByTestId(`project-overview-redesign-empty-${R1}`).textContent,
    ).toMatch(/No permits yet/i);
  });

  it('★ a reuses-parent redesign says where its permits are', () => {
    setupFiveOhFiveThree({ redesign_reuses_original_permit: true });
    refs.allPermits = [...PARENT_PERMITS];
    renderPage();
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    expect(group.textContent).toContain("Reuses parent's permits");
    expect(
      screen.getByTestId(`project-overview-redesign-empty-${R1}`).textContent,
    ).toMatch(/reused/i);
  });
});

// ---------------------------------------------------------------------------
// §D · THREE STATES OF redesign_reuses_original_permit
// ---------------------------------------------------------------------------

describe('fix-421 §D: null is unanswered, never No', () => {
  it('★★★ null renders as UNANSWERED and is distinguishable from false', () => {
    // ★ Prod, 2026-08-27: 12 true · 3 false · 2 null. fix-151 tested `=== true`
    //   and rendered false and null identically — as nothing — which reads as a
    //   settled No on a question nobody has been asked. Null is the state Bobby
    //   was editing when he found this ticket.
    setupFiveOhFiveThree({ redesign_reuses_original_permit: null });
    renderPage();
    const note = screen.getByTestId(`project-overview-redesign-note-${R1}`);
    expect(note.textContent).toMatch(/not answered/i);
    expect(note.textContent).not.toMatch(/Reuses parent's permits/);
  });

  it('★★ false renders NO note — the permits underneath already say it', () => {
    setupFiveOhFiveThree({ redesign_reuses_original_permit: false });
    renderPage();
    expect(screen.queryByTestId(`project-overview-redesign-note-${R1}`)).toBeNull();
    // …and the two states are therefore not the same rendering.
    expect(
      screen.getByTestId(`permits-sidebar-redesign-group-${R1}`).textContent,
    ).not.toMatch(/not answered/i);
  });

  it('★ true keeps fix-193\'s note verbatim', () => {
    setupFiveOhFiveThree({ redesign_reuses_original_permit: true });
    renderPage();
    expect(
      screen.getByTestId(`project-overview-redesign-note-${R1}`).textContent,
    ).toBe("Reuses parent's permits");
  });
});

// ---------------------------------------------------------------------------
// §E · N redesigns
// ---------------------------------------------------------------------------

describe('fix-421 §E: N redesigns are N groups', () => {
  it('★★★ two redesigns render two groups, in created_at order', () => {
    // ★ SYNTHETIC BY NECESSITY: every one of the 17 live parents has exactly one
    //   redesign, so there is no "Redesign 2" in prod to look at. The order is
    //   `useProjectRedesignsWithPermits`'s own sort — created_at ascending, id as
    //   the tie-break — and the numbering is the index within it, so the label
    //   and the position cannot disagree.
    refs.projects = [
      project({ id: PARENT, address: '5053 25th Ave SW' }),
      project({
        id: 'r-late', redesign_of_project_id: PARENT,
        created_at: '2026-05-20T00:00:00Z', redesign_reuses_original_permit: false,
      }),
      project({
        id: 'r-early', redesign_of_project_id: PARENT,
        created_at: '2026-05-10T00:00:00Z', redesign_reuses_original_permit: false,
      }),
    ];
    refs.parentPermits = PARENT_PERMITS;
    refs.allPermits = [
      ...PARENT_PERMITS,
      permit(20001, 'r-early', { num: 'E-1', type: 'PPR' }),
      permit(20002, 'r-late', { num: 'L-1', type: 'PPR' }),
    ];
    renderPage();
    const early = screen.getByTestId('permits-sidebar-redesign-group-r-early');
    const late = screen.getByTestId('permits-sidebar-redesign-group-r-late');
    expect(
      screen.getByTestId('project-overview-redesign-row-r-early').textContent,
    ).toContain('Redesign 1');
    expect(
      screen.getByTestId('project-overview-redesign-row-r-late').textContent,
    ).toContain('Redesign 2');
    // Two groups, in that DOM order…
    expect(
      early.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ★ fix-517 §A: …and each says how many permits are ITS OWN. The cards are
    //   rows in the table now, so the count is what distinguishes the groups —
    //   which is the same assertion one level up, and it still fails if a
    //   redesign's permits are resolved against the wrong redesign.
    expect(
      within(early).getByTestId(
        'project-overview-redesign-permits-note-r-early',
      ).textContent,
    ).toContain('1 permit,');
    expect(
      within(late).getByTestId('project-overview-redesign-permits-note-r-late')
        .textContent,
    ).toContain('1 permit,');
    expect(within(early).queryByTestId('permits-sidebar-row-20002')).toBeNull();
  });

  it('★ a project with no redesigns grows no band at all', () => {
    refs.projects = [project({ id: PARENT, address: '5053 25th Ave SW' })];
    refs.parentPermits = PARENT_PERMITS;
    refs.allPermits = [...PARENT_PERMITS];
    renderPage();
    // ★ fix-517 §A: nothing renders at all — no band, and no rail for it to be
    //   absent from either.
    expect(screen.queryByTestId('project-overview-redesigns-section')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-redesigns-divider')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-list')).toBeNull();
  });
});
