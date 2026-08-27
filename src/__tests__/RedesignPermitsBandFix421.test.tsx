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
vi.mock('../components/ProjectDetail/ProjectSettingsModal', () => ({ default: () => null }));
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
vi.mock('../components/ProjectDetail/QuickEditPermitModal', () => ({
  default: ({ permit }: { permit: { id: number } }) => {
    refs.quickEdited.push(permit.id);
    return <div data-testid="stub-quick-edit">{String(permit.id)}</div>;
  },
}));
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({ default: () => null }));

import ProjectDetail from '../pages/ProjectDetail';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    acq_lead: null, external_team: {}, builder_id: null, permit_order: [],
    entitlement_lead: null, design_manager: null, go_date: null, units: null,
    zone: null, lot_width: null, lot_depth: null, unit_types: null,
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

/** Where each band's marker sits in the panel's DOM order. */
function bandOrder(): string[] {
  const list = screen.getByTestId('permits-sidebar-list');
  const markers = list.querySelectorAll(
    '[data-testid="permits-sidebar-row-10205"],' +
      '[data-testid="permits-sidebar-redesigns-divider"],' +
      '[data-testid="permits-sidebar-issued-divider"]',
  );
  return Array.from(markers).map((el) => {
    const id = el.getAttribute('data-testid') ?? '';
    if (id.startsWith('permits-sidebar-row-')) return 'active';
    if (id.includes('redesigns')) return 'redesigns';
    return 'issued';
  });
}

beforeEach(() => {
  refs.quickEdited.length = 0;
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  setupFiveOhFiveThree();
});

// ---------------------------------------------------------------------------
// §A · THE ORDER — active/ongoing → redesigns → issued
// ---------------------------------------------------------------------------

describe('fix-421 §A: three bands, in the order Bobby reads them', () => {
  it('★★★ active → redesigns → issued, on the 5053 shape', () => {
    // *"issued should be at the bottom, redesign should be above that, and then
    //  all the other active and ongoing permits should be above that."*
    renderPage();
    expect(bandOrder()).toEqual(['active', 'redesigns', 'issued']);
  });

  it('★★ "Ready for Issuance" is APPROVED, not issued — the Demolition stays active', () => {
    // ★★★ THE ONE RULE, STATED. `effectiveStage(...) === 'is'` is what this
    //     panel has decided "issued" with since fix-65, and this ticket does not
    //     introduce a second definition. 10204 has an approval_date and a
    //     terminal-APPROVED portal status but no actual_issue, so it is active —
    //     which is also why the brief's proposed `actual_issue IS NOT NULL`
    //     would NOT have changed this row, but would have moved 3 others in prod.
    renderPage();
    const issued = screen.getByTestId('permits-sidebar-issued-group');
    expect(within(issued).queryByTestId('permits-sidebar-row-10204')).toBeNull();
    expect(within(issued).getByTestId('permits-sidebar-row-10203')).toBeTruthy();
    expect(within(issued).getByTestId('permits-sidebar-row-10206')).toBeTruthy();
    expect(screen.getByTestId('permits-sidebar-row-10204')).toBeTruthy();
  });

  it('★ a redesign permit never lands in the parent\'s active or issued band', () => {
    renderPage();
    const issued = screen.getByTestId('permits-sidebar-issued-group');
    expect(within(issued).queryByTestId('permits-sidebar-row-10321')).toBeNull();
    // It lives inside its own group, under the redesigns divider.
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    expect(within(group).getByTestId('permits-sidebar-row-10321')).toBeTruthy();
  });

  it('★ the header count still counts THIS project\'s permits only', () => {
    // Deliberate: a redesign\'s permits are their own category with their own
    // count in its divider. Folding them into "Permits (n)" would make the
    // parent look like it owns work it does not.
    renderPage();
    expect(screen.getByTestId('permits-sidebar-count').textContent).toBe('Permits (5)');
    expect(
      screen.getByTestId('permits-sidebar-redesigns-divider').textContent,
    ).toContain('Redesigns (1)');
  });
});

// ---------------------------------------------------------------------------
// §B · THE RENDERING — "just like the other permits in the permit tab"
// ---------------------------------------------------------------------------

describe('fix-421 §B: a redesign\'s permits are permits', () => {
  it('★★★ they render with the SAME card component, not a bespoke line', () => {
    // ★★ PARENTAGE, NOT PRESENCE (fix-422 §E). Before this ticket the redesign
    //    permit was PRESENT too — as `PPR · Corrections` inside an <a>. What is
    //    new is that it is a `permits-sidebar-row-*`, the exact testid every
    //    other permit card in this panel carries, so the two cannot drift.
    renderPage();
    for (const id of [10321, 10372]) {
      const wrapper = screen.getByTestId(`project-overview-redesign-permit-${id}`);
      expect(
        within(wrapper).getByTestId(`permits-sidebar-row-${id}`),
        `permit ${id} renders the shared card`,
      ).toBeTruthy();
    }
  });

  it('★★★ the card carries the status chip, the number and the portal link', () => {
    // Bobby: "just like the other permits" — number, type, status chip, the lot
    // of it. 10321 is in Corrections, which is what its stage breadcrumb must
    // say; fix-151\'s line said the same words but nothing else.
    renderPage();
    const card = screen.getByTestId('permits-sidebar-row-10321');
    expect(screen.getByTestId('permits-sidebar-stage-10321').textContent).toContain(
      'Corrections',
    );
    expect(within(card).getByTestId('permits-sidebar-type-10321').textContent).toContain(
      'PPR',
    );
    expect(screen.getByTestId('permits-sidebar-num-10321').textContent).toBe(
      '7102488-CN-004',
    );
  });

  it('★★★ DOUBLE-CLICK STILL OPENS QUICK EDIT — on a redesign card', () => {
    // ★★★ THE GESTURE BOBBY USES DAILY, and the current workaround for the
    //     role-cascade defect (P-075). It is asserted on the PERMIT ID, not on
    //     "a modal opened": the page resolves quick-edit by id, and a redesign
    //     permit belongs to a different project — resolve it against this
    //     project's permits and the modal silently never opens at all.
    renderPage();
    fireEvent.doubleClick(screen.getByTestId('permits-sidebar-row-10321'));
    expect(refs.quickEdited).toContain(10321);
    expect(screen.getByTestId('stub-quick-edit').textContent).toBe('10321');
  });

  it('★★ …and the double-click does NOT also navigate away', () => {
    // ★★★ THE TWO GESTURES FIGHT, WHICH IS WHY THE CLICK IS DEFERRED. A single
    //     click navigates (fix-151\'s behaviour, which this ticket must keep), so
    //     fire-and-forget on the first click of a double would unmount the card
    //     before `dblclick` could ever land. The second click cancels the
    //     pending navigation.
    renderPage();
    const card = screen.getByTestId('permits-sidebar-row-10321');
    fireEvent.click(card);
    fireEvent.doubleClick(card);
    expect(refs.quickEdited).toContain(10321);
    // Still on the parent, after longer than the defer interval.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${PARENT}`);
        resolve();
      }, 400);
    });
  });

  it('★★ a single click still goes to the redesign\'s project overview', async () => {
    // Scope 5: unchanged destination. Only the element and the timing moved.
    renderPage();
    fireEvent.click(screen.getByTestId('permits-sidebar-row-10372'));
    await waitFor(() =>
      expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${R1}`),
    );
  });

  it('★ the redesign label is the GROUP HEADING, above its cards', () => {
    // Scope 2: "the redesign\'s own label (\"Redesign 1 · Acquisitions\") as the
    // group heading rather than as the row."
    renderPage();
    const heading = screen.getByTestId(`project-overview-redesign-row-${R1}`);
    expect(heading.textContent).toContain('Redesign 1');
    expect(heading.textContent).toContain('Acquisitions');
    const group = screen.getByTestId(`permits-sidebar-redesign-group-${R1}`);
    const card = screen.getByTestId('permits-sidebar-row-10321');
    expect(
      heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(group.contains(heading)).toBe(true);
    expect(group.contains(card)).toBe(true);
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
    // …and each holds ITS OWN permit and not the other's.
    expect(within(early).getByTestId('permits-sidebar-row-20001')).toBeTruthy();
    expect(within(early).queryByTestId('permits-sidebar-row-20002')).toBeNull();
    expect(within(late).getByTestId('permits-sidebar-row-20002')).toBeTruthy();
    // Still one band, between active and issued.
    expect(bandOrder()).toEqual(['active', 'redesigns', 'issued']);
  });

  it('★ a project with no redesigns grows no band at all', () => {
    refs.projects = [project({ id: PARENT, address: '5053 25th Ave SW' })];
    refs.parentPermits = PARENT_PERMITS;
    refs.allPermits = [...PARENT_PERMITS];
    renderPage();
    expect(screen.queryByTestId('project-overview-redesigns-section')).toBeNull();
    expect(bandOrder()).toEqual(['active', 'issued']);
  });
});
