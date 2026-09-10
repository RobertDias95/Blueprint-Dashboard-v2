import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-23e: structural tests for the two-pillbox layout. JSDOM doesn't
// do real CSS layout, so we can't directly assert "the inner content
// overflows" — but we CAN assert the structural contract: outer
// bounded-height container + two pillbox children with overflow-y-auto.
// Widget presence is verified by querying mocked stub descendants of
// the right pillbox.

const T = 'test-tenant-uuid';
const PROJECT_ID = 'p-23e';

// vi.hoisted refs — without these, the inline hook mocks return fresh
// arrays each render and ProjectDetail's useMemo deps thrash. The
// 23d test file hit this exact pattern.
const refs = vi.hoisted(() => {
  const NOW = '2026-05-14T12:00:00Z';
  const baseProject = {
    id: 'p-23e',
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
  };
  const permitTemplate = (id: number) => ({
    id,
    project_id: 'p-23e',
    type: id === 1 ? 'Building Permit' : 'Demolition',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: NOW,
    permit_cycles: [],
  });

  return {
    projects: [baseProject],
    projectsWithMany: [baseProject],
    permits: [permitTemplate(1), permitTemplate(2)],
    permits20: Array.from({ length: 20 }, (_, i) => permitTemplate(i + 1)),
    // Per-test toggle: tests that want the 20-permit fixture overwrite
    // permitsFor before rendering.
    permitsFor: [permitTemplate(1), permitTemplate(2)],
    setPermits(rows: unknown[]) {
      // Replace the contents in place so the same array ref survives.
      // (Hook mock closes over `refs.permitsFor`.)
      refs.permitsFor.length = 0;
      for (const r of rows) refs.permitsFor.push(r as never);
    },
  };
});

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: refs.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/usePermitsByProject', () => ({
  usePermitsByProject: () => ({
    data: refs.permitsFor,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

// ProjectDetailHeader pulls in useAppConfig + useUpdateProject; stub the
// whole component so the test doesn't have to know its internals.
vi.mock('../components/ProjectDetail/ProjectDetailHeader', () => ({
  default: () => <div data-testid="stub-project-header" />,
}));

// ScheduleHealthTable pulls in usePermits + permit calculations. Stub.
vi.mock('../components/ProjectDetail/ScheduleHealthTable', () => ({
  default: () => <div data-testid="stub-schedule-health-table" />,
}));

vi.mock('../components/ProjectDetail/NotesPanel', () => ({
  default: () => <div data-testid="stub-notes-panel" />,
}));

vi.mock('../components/ProjectDetail/ProjectSettingsModal', () => ({
  default: () => null,
}));

vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({
  default: () => null,
}));

// ★ fix-517 §E: `QuickEditPermitModal` is DELETED — a mock for it would be a
//   mock of nothing. Its replacement is a URL (`?data=permits&focus=<id>`), so
//   the modal that has to be inert here is Project Details.
vi.mock('../components/ProjectDetail/ProjectDetailsModal', () => ({
  default: () => <div data-testid="stub-project-details-modal" />,
}));

// PermitDetailV2 stub. Tests assert that the four right-side widget
// labels appear as descendants of the right pillbox; the stub renders
// each label so the structural assertion works without dragging in
// ~8 deeper hook mocks.
// ★★★ fix-517 §A: the stub now REPORTS THE PERMIT IT WAS GIVEN.
//
// The fix-217/218/219 deep-link tests below used to prove *which* permit was
// selected by reading the highlighted row in the permits rail. §A deletes the
// rail, so the only place a selection is visible is the pane it opens — which
// is the honest place to have been asserting it all along. One stub prop
// replaces five `permits-sidebar-row-<id>` background reads.
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({
  default: ({ permit }: { permit: { id: number } }) => (
    <div data-testid="stub-permit-detail-v2" data-permit-id={String(permit.id)}>
      <div data-testid="widget-schedule-estimator">Schedule Estimator</div>
      <div data-testid="widget-issue-dates">Issue Dates</div>
      <div data-testid="widget-cycle-history">Cycle History</div>
      <div data-testid="widget-correction-rounds">Correction Rounds</div>
    </div>
  ),
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


import ProjectDetail from '../pages/ProjectDetail';

function renderAt(path = `/project/${PROJECT_ID}`) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/project/:id" element={<ProjectDetail />} />
    </Routes>,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  // Reset to the default 2-permit fixture between tests (fresh array ref).
  refs.permitsFor = [{ ...refs.permits[0] }, { ...refs.permits[1] }];
  // jsdom doesn't implement scrollIntoView; the fix-217 deep-link scroll effect
  // calls it. Default to a no-op so any deep-link selection doesn't throw; tests
  // that assert the scroll reassign their own spy.
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
});

// ===========================================================================
// ★★ fix-466 §6 (P-119) — a malformed project id says so in English
// ===========================================================================
//
// Bobby's crash surfaced Postgres's own words to the user: *"Project detail
// failed to load — invalid input syntax for type uuid: \"null\""*. The link
// that produced `/project/null` is fixed at source, so this is the second line
// of defence for any OTHER way of arriving here with a value that cannot be a
// project id — a typo, a stale bookmark, a link written later.
//
// ★ DELIBERATELY NARROW. Not a general error-message pass across the app: a
//   shape check on ONE route's ONE parameter, made BEFORE the query runs so the
//   database is never asked the malformed question at all.
describe('<ProjectDetail /> fix-466 malformed id', () => {
  it('★★★ /project/null says so in English and never reaches the database', () => {
    renderAt('/project/null');
    const msg = screen.getByTestId('project-detail-bad-id');
    expect(msg.textContent).toContain('not valid');
    expect(msg.textContent).toContain('null');
    // ★ The developer's message is gone: no Postgres vocabulary reaches a user.
    expect(msg.textContent).not.toContain('uuid');
    expect(msg.textContent).not.toContain('invalid input syntax');
    // ★ And a way out, like the "Project not found" path beside it.
    expect(screen.getByText('Back to project list')).toBeInTheDocument();
  });

  it('★★ a WELL-FORMED id that simply does not exist still says "not found"', () => {
    // The two failures are different and must stay different: "you typed
    // something that cannot be an id" is not "that project is gone", and they
    // send the reader to different next actions.
    renderAt('/project/00000000-0000-4000-8000-000000000000');
    expect(screen.queryByTestId('project-detail-bad-id')).toBeNull();
    expect(screen.getByText(/Project not found/)).toBeInTheDocument();
  });

  it('★★★ the check gates the QUERY, not the page — every other test proves it', () => {
    // ★ This repo's own fixtures use ids like `p-23e`, which is not a uuid.
    //   If fix-466 had turned the shape check into a rendering gate, thirty
    //   tests in this file would fail — and it would have bought nothing, since
    //   a non-uuid still has to match a real project to render either way.
    //   Stated here so the reason survives, rather than being rediscovered by
    //   whoever next tries to "tidy" the guard.
    renderAt();
    expect(screen.queryByTestId('project-detail-bad-id')).toBeNull();
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
  });
});

// fix-217: My Tasks → "Open in Project View" deep-links to ?permit=<id>. The
// Project View reads it, auto-selects that permit (same path the sidebar uses),
// and scrolls its detail pane into view.
describe('<ProjectDetail /> fix-217 permit deep-link', () => {
  it('auto-selects + scrolls to the permit named in ?permit= on mount', () => {
    const scrollSpy = vi.fn();
    const orig = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      renderAt(`/project/${PROJECT_ID}?permit=2`);
      // A permit is selected → the detail pane renders, overview does not.
      expect(screen.getByTestId('permit-edit-pane')).toBeInTheDocument();
      expect(screen.queryByTestId('project-overview-pane')).toBeNull();
      // It's permit 2 specifically (selected row carries the s3 background).
      expect(
        screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
      ).toBe('2');
      // And the detail pane was scrolled into view.
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = orig;
    }
  });

  it('falls back to the project overview when there is no ?permit= (project-level task)', () => {
    renderAt(`/project/${PROJECT_ID}`);
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-edit-pane')).toBeNull();
  });

  it('falls back to the overview when ?permit= is not a permit on this project', () => {
    renderAt(`/project/${PROJECT_ID}?permit=999`);
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-edit-pane')).toBeNull();
  });
});

// fix-218: the deep-link must select the permit AFTER the async permit list
// loads. The fix-217 tests used synchronous mocked data, hiding the bug: in prod
// `permits` is empty at mount, so ?permit=<id> resolved to null and never
// selected once the data arrived. These tests simulate the async load.
describe('<ProjectDetail /> fix-218 deep-link after async permit load', () => {
  it('selects the deep-linked permit once permits finish loading (empty first, data later)', () => {
    const scrollSpy = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scrollSpy;
    // Permits not loaded yet on mount (usePermitsByProject resolves async).
    refs.permitsFor = [];
    const result = renderAt(`/project/${PROJECT_ID}?permit=2`);
    // Nothing resolvable yet → project overview, NOT the permit (the repro).
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-edit-pane')).toBeNull();
    // Permits arrive on a later render (fresh array ref, as a real load would).
    refs.permitsFor = [{ ...refs.permits[0] }, { ...refs.permits[1] }];
    result.rerender(
      <Routes>
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>,
    );
    // Now the deep-link applies: permit 2 selected + pane scrolled into view.
    expect(screen.getByTestId('permit-edit-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('project-overview-pane')).toBeNull();
    expect(
      screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
    ).toBe('2');
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('a manual "← Back to overview" after a deep-link is not re-forced (applied once)', () => {
    // Permits loaded synchronously → permit 2 selected on mount.
    renderAt(`/project/${PROJECT_ID}?permit=2`);
    expect(screen.getByTestId('permit-edit-pane')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('permit-edit-back-overview'));
    // The param is unchanged, but it was already applied → stays on overview.
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('permit-edit-pane')).toBeNull();
  });

  it('switching ?permit= to another valid id re-selects that permit', () => {
    function Nav() {
      const nav = useNavigate();
      return (
        <button
          data-testid="nav-to-permit-1"
          onClick={() => nav(`/project/${PROJECT_ID}?permit=1`)}
        />
      );
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/project/${PROJECT_ID}?permit=2`]}>
          <Nav />
          <Routes>
            <Route path="/project/:id" element={<ProjectDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Initially permit 2 is selected.
    expect(
      screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
    ).toBe('2');
    // Navigate to ?permit=1 → the new param value re-selects permit 1.
    fireEvent.click(screen.getByTestId('nav-to-permit-1'));
    expect(
      screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
    ).toBe('1');
  });
});

// fix-219: the deep-link resolution must be TYPE-ROBUST. permit.id is typed
// `number` but the URL param is always a string; the pre-fix code matched with a
// strict === against a coerced Number, which silently missed if a runtime id
// shape ever differed. These pin the String-coerced match + a realistic 5-permit
// async flow (the prod repro: project 1953 10th Ave W, permit 223 of 5).
describe('<ProjectDetail /> fix-219 type-robust permit deep-link', () => {
  it('selects the permit when its id is a STRING and ?permit= matches by value', () => {
    // Runtime id arrives as a string '223'; the URL param is '223'. A strict
    // number === would miss; the String-coerced match selects it.
    refs.setPermits([
      { ...refs.permits[0], id: '223', type: 'Building Permit' },
      { ...refs.permits[1], id: '224', type: 'Demolition' },
    ]);
    renderAt(`/project/${PROJECT_ID}?permit=223`);
    expect(screen.getByTestId('permit-edit-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('project-overview-pane')).toBeNull();
    expect(
      screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
    ).toBe('223');
  });

  it('selects ?permit=223 on a 5-permit project after the permits load async', () => {
    const scrollSpy = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scrollSpy;
    const five = () =>
      [221, 222, 223, 224, 225].map((id) => ({ ...refs.permits[0], id }));
    // Empty on mount (async load) → overview, not the deep-linked permit.
    refs.permitsFor = [];
    const result = renderAt(`/project/${PROJECT_ID}?permit=223`);
    expect(screen.getByTestId('project-overview-pane')).toBeInTheDocument();
    // All 5 arrive on a later render (fresh array ref).
    refs.permitsFor = five();
    result.rerender(
      <Routes>
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>,
    );
    // Permit 223 (of 5) is selected + scrolled into view.
    expect(screen.getByTestId('permit-edit-pane')).toBeInTheDocument();
    expect(
      screen.getByTestId('stub-permit-detail-v2').getAttribute('data-permit-id'),
    ).toBe('223');
    expect(scrollSpy).toHaveBeenCalled();
  });
});

// ===========================================================================
// ★★★ fix-517 §A — THE RAIL IS DELETED, AND FOUR SUITES MOVE WITH IT
// ===========================================================================
//
// Bobby, 2026-09-10: *"Permits on the left-hand side of the screen is gone."*
// The left rail (`pd-left-pillbox` / `PermitsSidebar`) and its `SidebarRow` are
// removed from `pages/ProjectDetail.tsx`, so four describes that lived here
// have nothing left to render:
//
//   · fix-23e  two-pillbox layout        — there is ONE pillbox now
//   · fix-65   issued-permit grouping    — the table sorts issued LAST (§C)
//   · fix-508 §E the rail's phase groups — the table's DEFAULT ORDER is phase
//   · fix-194  sub-permit nesting        — the table has always excluded them
//
// ★★★ NONE OF THOSE BEHAVIOURS IS GONE; EVERY ONE OF THEM MOVED, and each is
//     asserted against the real table in `PermitsTableFix517.test.tsx` — which
//     is where they belong, because `ScheduleHealthTable` is STUBBED in this
//     file and always has been. Testing the rail's phase order here was only
//     ever possible because the rail was the one permits list this suite could
//     see; there is no reason to mock the table back in to re-prove a rule the
//     table itself is tested on.
//
// ★★ WHAT STAYS HERE IS WHAT IS ABOUT THE PAGE: the bounded height contract,
//    the single pillbox, and the deep-link suites above — which now read the
//    SELECTED PERMIT off the detail pane rather than off a highlighted rail
//    row, which is the only place a selection was ever visible to a user.
describe('<ProjectDetail /> fix-23e → fix-517 §A: ONE pillbox', () => {
  it('★★★ the left rail is GONE — asserted as absence, not as a zero width', () => {
    renderAt();
    expect(screen.queryByTestId('pd-left-pillbox')).toBeNull();
    expect(screen.queryByTestId('pd-left-rail')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-list')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-count')).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-row-1')).toBeNull();
    // ★ …and the right pillbox is still the scrollable one, unchanged.
    const right = screen.getByTestId('pd-right-pillbox');
    expect(right.className).toContain('overflow-y-auto');
    expect(right.className).toContain('rounded-lg');
    expect(right.className).toContain('border');
    // ★★ It is now the ONLY child of the body row, which is what makes the
    //    202px the rail held reach the overview cards.
    expect(right.parentElement?.childElementCount).toBe(1);
  });

  it('outer container has a bounded max-height based on viewport', () => {
    renderAt();
    const page = screen.getByTestId('project-detail-page');
    // ★ fix-313: h-full (was h-[calc(100vh-100px)]) keeps the page bounded
    // inside the Bridge shell's <main>; overflow-hidden
    // prevents any child from pushing the page taller than the viewport.
    expect(page.className).toContain('h-full');
    expect(page.className).toContain('overflow-hidden');
  });

  it('renders all four right-side widgets inside the right pillbox when a permit is selected', () => {
    // ★ fix-517 §D: a rail row's click used to be how you got here. It is a
    //   TABLE ROW's click now, and the table is stubbed in this file — so the
    //   deep link is what selects a permit for this structural assertion. The
    //   click itself is asserted in `PermitsTableFix517.test.tsx`.
    renderAt(`/project/${PROJECT_ID}?permit=1`);
    const right = screen.getByTestId('pd-right-pillbox');
    expect(right.contains(screen.getByTestId('widget-schedule-estimator'))).toBe(
      true,
    );
    expect(right.contains(screen.getByTestId('widget-issue-dates'))).toBe(true);
    expect(right.contains(screen.getByTestId('widget-cycle-history'))).toBe(true);
    expect(right.contains(screen.getByTestId('widget-correction-rounds'))).toBe(
      true,
    );
  });

  it('does not expand height when many permits are present (20-permit fixture)', () => {
    // Swap in 20 permits. ★ The bounded-height contract is the point and it is
    //   unchanged: the ONE pillbox scrolls internally and the page stays at a
    //   single viewport however many permits there are. What changed is that
    //   the scroller is the pillbox rather than the rail's inner list.
    refs.setPermits(refs.permits20.map((p) => ({ ...p })));
    renderAt();
    const page = screen.getByTestId('project-detail-page');
    expect(page.className).toContain('h-full');
    expect(page.className).toContain('overflow-hidden');
    expect(screen.getByTestId('pd-right-pillbox').className).toContain(
      'overflow-y-auto',
    );
  });
});

// ===========================================================================
// ★★★ fix-517 §F (P-223) — THE BUTTON, AND BOTH DIRECTIONS OF THE INVARIANT
// ===========================================================================
//
// fix-514 renamed Project Settings → Project Details and asserted that
// *"Project Settings"* was ABSENT. A button reading **"Project Data"**
// satisfies that assertion perfectly, and that is exactly what shipped: STEP 0
// content-checked `origin/main` and found `⚙ Project Data` on this page.
//
// ★★★ ABSENCE OF THE RETIRED NAME IS NOT PRESENCE OF THE NEW ONE. One
//     assertion, both directions — the old names must be gone AND the new one
//     must be there — because either half alone passes on a page that is
//     wrong.
describe('<ProjectDetail /> fix-517 §F: the Project Details button', () => {
  it('★★★ says "Project Details", and no user-visible string says either old name', () => {
    const { container } = renderAt();
    const btn = screen.getByTestId('project-data-btn');
    // Direction 1 — the NEW name is present, on the control itself.
    expect(btn.textContent).toContain('Project Details');
    // Direction 2 — NEITHER old name appears anywhere on the page.
    const text = container.textContent ?? '';
    expect(text).not.toContain('Project Data');
    expect(text).not.toContain('Project Settings');
    // ★ `Project Details` contains neither, so direction 2 cannot pass by
    //   accident on an empty render: prove the page rendered at all.
    expect(text).toContain('Project Details');
  });
});

// fix-277: the fix-276 Corrections section is GONE from the project overview —
// it moved to the Corrections report in the Reporting hub. This test is the
// inverse of the three it replaces: it fails if the panel is ever re-mounted
// here without that being a deliberate decision.
//
// Note there is NO vi.mock for CorrectionsPanel in this file any more. That is
// load-bearing: if ProjectDetail imported it again, the unmocked component would
// mount, reach for the live Supabase client, and this assertion would fail on
// the rendered panel rather than passing silently.
describe('<ProjectDetail /> fix-277 Corrections section removed from the overview', () => {
  it('the project overview renders header and schedule health — and no corrections', () => {
    renderAt();
    const overview = screen.getByTestId('project-overview-pane');
    expect(within(overview).getByTestId('stub-project-header')).toBeInTheDocument();
    expect(within(overview).getByTestId('stub-schedule-health-table')).toBeInTheDocument();
    expect(screen.queryByTestId('corrections-panel')).toBeNull();
    expect(screen.queryByTestId('stub-corrections-panel')).toBeNull();
  });

  // fix-285 moved Notes INTO the header's grid to fill the empty area under DD
  // Phase and Project. ★ fix-309 #54 moves it back out: #55 makes that row one
  // equal-height band, so the hole is gone, and Notes reads better as one long
  // vertical bar under Schedule health. It is a direct child of this pane again.
  it('notes IS a direct child of the overview pane, at the bottom', () => {
    renderAt();
    const overview = screen.getByTestId('project-overview-pane');
    expect(within(overview).getByTestId('stub-notes-panel')).toBeInTheDocument();
  });

  it('schedule health sits directly after the header, then Notes below it', () => {
    renderAt();
    const overview = screen.getByTestId('project-overview-pane');
    const order = Array.from(overview.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    const header = order.indexOf('stub-project-header');
    const health = order.indexOf('stub-schedule-health-table');
    const notes = order.indexOf('stub-notes-panel');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(health).toBe(header + 1);
    // ★ #54: BOTTOM. Not between the header and Schedule health, and not
    // anywhere above it — after it, as the last thing on the overview.
    expect(notes).toBe(health + 1);
    expect(notes).toBe(order.length - 1);
  });
});
