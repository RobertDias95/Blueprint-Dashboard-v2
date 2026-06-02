import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

vi.mock('../components/ProjectDetail/NotesDocsFooter', () => ({
  default: () => <div data-testid="stub-notes-docs-footer" />,
}));

vi.mock('../components/ProjectDetail/ProjectSettingsModal', () => ({
  default: () => null,
}));

vi.mock('../components/ProjectDetail/DeleteProjectDialog', () => ({
  default: () => null,
}));

vi.mock('../components/ProjectDetail/QuickEditPermitModal', () => ({
  default: () => null,
}));

// PermitDetailV2 stub. Tests assert that the four right-side widget
// labels appear as descendants of the right pillbox; the stub renders
// each label so the structural assertion works without dragging in
// ~8 deeper hook mocks.
vi.mock('../components/ProjectDetail/PermitDetailV2', () => ({
  default: () => (
    <div data-testid="stub-permit-detail-v2">
      <div data-testid="widget-schedule-estimator">Schedule Estimator</div>
      <div data-testid="widget-issue-dates">Issue Dates</div>
      <div data-testid="widget-cycle-history">Cycle History</div>
      <div data-testid="widget-correction-rounds">Correction Rounds</div>
    </div>
  ),
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
  // Reset to the default 2-permit fixture between tests.
  refs.setPermits([
    { ...refs.permits[0] },
    { ...refs.permits[1] },
  ]);
});

describe('<ProjectDetail /> fix-23e two-pillbox layout', () => {
  it('renders left and right pillboxes with overflow-y-auto each', () => {
    renderAt();
    const left = screen.getByTestId('pd-left-pillbox');
    const right = screen.getByTestId('pd-right-pillbox');
    // The left pillbox wraps a header + a scrollable list — the inner
    // list carries overflow-y-auto so the rounded outer border doesn't
    // get broken by content overlap.
    expect(left.className).toContain('rounded-lg');
    expect(left.className).toContain('border');
    // Find the scrollable list inside.
    const listScroller = screen.getByTestId('permits-sidebar-list');
    expect(listScroller.className).toContain('overflow-y-auto');
    // Right pillbox itself is the scrollable container.
    expect(right.className).toContain('overflow-y-auto');
    expect(right.className).toContain('rounded-lg');
    expect(right.className).toContain('border');
  });

  it('outer container has a bounded max-height based on viewport', () => {
    renderAt();
    const page = screen.getByTestId('project-detail-page');
    // h-[calc(100vh-100px)] keeps the page bounded; overflow-hidden
    // prevents any child from pushing the page taller than the viewport.
    expect(page.className).toContain('h-[calc(100vh-100px)]');
    expect(page.className).toContain('overflow-hidden');
  });

  it('renders all four right-side widgets inside the right pillbox when a permit is selected', () => {
    renderAt();
    // Click the first permit row to enter permit-detail state.
    const row = screen.getByTestId('permits-sidebar-row-1');
    fireEvent.click(row);

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

  it('renders the permits list inside the left pillbox', () => {
    renderAt();
    const left = screen.getByTestId('pd-left-pillbox');
    const row1 = screen.getByTestId('permits-sidebar-row-1');
    const row2 = screen.getByTestId('permits-sidebar-row-2');
    expect(left.contains(row1)).toBe(true);
    expect(left.contains(row2)).toBe(true);
  });

  it('fix-35 Bug 1: permit # links to portal_url and struct_address shows', () => {
    refs.setPermits([
      {
        ...refs.permits[0],
        id: 1,
        num: 'BP-100',
        portal_url: 'https://portal.example/bp100',
        struct_address: '123 Main St',
      },
      {
        ...refs.permits[1],
        id: 2,
        num: 'DM-200',
        portal_url: null,
        struct_address: null,
      },
    ]);
    renderAt();

    // Permit with portal_url → a real anchor (the dead/missing <a> bug).
    const link = screen.getByTestId('permits-sidebar-portal-1');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://portal.example/bp100');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('BP-100');
    // Structure address surfaces for distinguishing multiple BPs.
    expect(screen.getByTestId('permits-sidebar-addr-1').textContent).toContain(
      '123 Main St',
    );

    // Permit without portal_url → plain span, never a broken-looking link.
    expect(screen.queryByTestId('permits-sidebar-portal-2')).toBeNull();
    expect(screen.getByTestId('permits-sidebar-num-2').tagName).toBe('SPAN');
    expect(screen.queryByTestId('permits-sidebar-addr-2')).toBeNull();
  });

  it('does not expand height when many permits are present (20-permit fixture)', () => {
    // Swap in 20 permits.
    refs.setPermits(refs.permits20.map((p) => ({ ...p })));
    renderAt();
    const page = screen.getByTestId('project-detail-page');
    // Same bounded-height contract holds regardless of permit count —
    // the left pillbox scrolls internally, the page stays at one
    // viewport.
    expect(page.className).toContain('h-[calc(100vh-100px)]');
    expect(page.className).toContain('overflow-hidden');
    // All 20 rows render inside the left pillbox; the list scroller
    // handles the overflow.
    const left = screen.getByTestId('pd-left-pillbox');
    for (let i = 1; i <= 20; i++) {
      expect(left.contains(screen.getByTestId(`permits-sidebar-row-${i}`))).toBe(
        true,
      );
    }
  });
});

// ===========================================================
// fix-65: restore v1's issued-permit grouping.
//
// Pre-fix the sidebar already dropped issued permits to the bottom
// (via a `!!actual_issue` comparator in the sort) but rendered them
// indistinguishably from active rows — no divider, no highlight, and
// drag-reorder applied to all rows including issued ones. v1 shipped a
// "✓ ISSUED (n)" divider with a teal highlight + a static (non-drag)
// bottom block. These tests pin the restored UX.
// ===========================================================

describe('<ProjectDetail /> fix-65 issued-permit grouping', () => {
  it('renders active permits ABOVE a ✓ ISSUED divider with the correct count', () => {
    // 4 permits: two active (id 1, 2 — both have actual_issue null), two
    // issued (id 3, 4 — actual_issue set). The default fixture has
    // actual_issue null on both, so we extend it.
    refs.setPermits([
      { ...refs.permits[0], id: 1, type: 'Building Permit', actual_issue: null },
      { ...refs.permits[1], id: 2, type: 'Demolition', actual_issue: null },
      {
        ...refs.permits[0],
        id: 3,
        type: 'SDOT Tree',
        actual_issue: '2026-04-15',
      },
      {
        ...refs.permits[0],
        id: 4,
        type: 'ULS',
        actual_issue: '2026-05-10',
      },
    ]);
    renderAt();

    const divider = screen.getByTestId('permits-sidebar-issued-divider');
    expect(divider).toBeInTheDocument();
    expect(divider.textContent).toMatch(/Issued \(2\)/i);
    // Highlight tint — uses the --color-is-bg CSS var per fix-65.
    const bgStyle = divider.getAttribute('style') ?? '';
    expect(bgStyle).toContain('var(--color-is-bg)');
    expect(bgStyle).toContain('var(--color-is)');

    // Active rows live before the divider in DOM order.
    const list = screen.getByTestId('permits-sidebar-list');
    const all = list.querySelectorAll('[data-testid^="permits-sidebar-row-"]');
    // 4 rows total: 1, 2 above; 3, 4 below the divider (issued sorts by
    // actual_issue desc so id 4 first, then id 3).
    const ids = Array.from(all).map((el) =>
      el.getAttribute('data-testid')?.replace('permits-sidebar-row-', ''),
    );
    expect(ids.indexOf('1')).toBeLessThan(ids.indexOf('3'));
    expect(ids.indexOf('2')).toBeLessThan(ids.indexOf('3'));
    expect(ids.indexOf('2')).toBeLessThan(ids.indexOf('4'));
  });

  it('issued group sits beneath the divider with the highlight bg', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: null },
      { ...refs.permits[0], id: 5, actual_issue: '2026-05-10' },
    ]);
    renderAt();
    const issuedGroup = screen.getByTestId('permits-sidebar-issued-group');
    expect(issuedGroup).toBeInTheDocument();
    expect(issuedGroup.getAttribute('style')).toContain('var(--color-is-bg)');
    // The issued row lives inside the issued group.
    const issuedRow = screen.getByTestId('permits-sidebar-row-5');
    expect(issuedGroup.contains(issuedRow)).toBe(true);
    // The active row does NOT live inside the issued group.
    const activeRow = screen.getByTestId('permits-sidebar-row-1');
    expect(issuedGroup.contains(activeRow)).toBe(false);
  });

  it('issued rows are not draggable + omit the grab-handle glyph', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: null },
      { ...refs.permits[0], id: 5, actual_issue: '2026-05-10' },
    ]);
    renderAt();
    const activeRow = screen.getByTestId('permits-sidebar-row-1');
    const issuedRow = screen.getByTestId('permits-sidebar-row-5');
    // draggable boolean is a DOM attribute on the outer <div>.
    expect(activeRow.getAttribute('draggable')).toBe('true');
    expect(issuedRow.getAttribute('draggable')).toBe('false');
    // Grab-handle glyph (⠿) is present on active rows, absent on issued.
    expect(activeRow.textContent).toContain('⠿');
    expect(issuedRow.textContent).not.toContain('⠿');
  });

  it('"PERMITS (n)" header counts ALL permits (active + issued)', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: null },
      { ...refs.permits[0], id: 2, actual_issue: null },
      { ...refs.permits[0], id: 3, actual_issue: '2026-05-10' },
    ]);
    renderAt();
    const left = screen.getByTestId('pd-left-pillbox');
    // The header reads "Permits (3)".
    expect(left.textContent).toMatch(/Permits \(3\)/);
  });

  it('a project with NO issued permits renders no divider (sidebar looks like before)', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: null },
      { ...refs.permits[1], id: 2, actual_issue: null },
    ]);
    renderAt();
    expect(
      screen.queryByTestId('permits-sidebar-issued-divider'),
    ).toBeNull();
    expect(screen.queryByTestId('permits-sidebar-issued-group')).toBeNull();
  });

  it('a project with ALL permits issued renders the divider + every row inside the issued group', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: '2026-04-01' },
      { ...refs.permits[0], id: 2, actual_issue: '2026-05-15' },
    ]);
    renderAt();
    const divider = screen.getByTestId('permits-sidebar-issued-divider');
    expect(divider.textContent).toMatch(/Issued \(2\)/i);
    const group = screen.getByTestId('permits-sidebar-issued-group');
    expect(group.contains(screen.getByTestId('permits-sidebar-row-1'))).toBe(true);
    expect(group.contains(screen.getByTestId('permits-sidebar-row-2'))).toBe(true);
    // Most-recently-issued first: id 2 (May 15) before id 1 (April 1).
    const rows = group.querySelectorAll('[data-testid^="permits-sidebar-row-"]');
    const ids = Array.from(rows).map((el) =>
      el.getAttribute('data-testid')?.replace('permits-sidebar-row-', ''),
    );
    expect(ids).toEqual(['2', '1']);
  });

  it('issued permits sort by actual_issue desc (most recently issued first)', () => {
    refs.setPermits([
      { ...refs.permits[0], id: 1, actual_issue: null },
      { ...refs.permits[0], id: 10, actual_issue: '2026-01-15' },
      { ...refs.permits[0], id: 11, actual_issue: '2026-06-01' },
      { ...refs.permits[0], id: 12, actual_issue: '2026-03-22' },
    ]);
    renderAt();
    const group = screen.getByTestId('permits-sidebar-issued-group');
    const rows = group.querySelectorAll('[data-testid^="permits-sidebar-row-"]');
    const ids = Array.from(rows).map((el) =>
      el.getAttribute('data-testid')?.replace('permits-sidebar-row-', ''),
    );
    // 11 (Jun) > 12 (Mar) > 10 (Jan).
    expect(ids).toEqual(['11', '12', '10']);
  });
});
