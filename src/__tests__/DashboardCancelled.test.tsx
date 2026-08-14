import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// fix-264: cancelled projects drop off the Dashboard.
//
// fix-262 composed 'cancelled' into projectIsActive, but that predicate is a
// ProjectRow one — only the Project List's Active toggle reached it. The
// Dashboard is a separate useProjects() consumer, so a cancelled project kept
// rendering cards in the pipeline columns AND kept inflating the "N proj · M"
// count badges. These pin both halves, plus the rule that a HOLD is untouched:
// Bobby — "Projects on hold would still be active."

const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const holdsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: projectsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: permitsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useNumberEntrySweep', () => ({
  useNumberEntrySweep: () => undefined,
}));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
// Holistic scope — the self-scope filter must not confound these assertions.
vi.mock('../hooks/useSelfScope', () => ({
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: null, scope: 'all' },
    ready: true,
  }),
}));
// Partial mock — the REAL cancelledProjectIds / activeHoldProjectIds run over
// this list, so the test exercises the shipped kind-splitting logic.
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: holdsRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import Dashboard from '../pages/Dashboard';

/** An OPEN project_holds row of either kind. */
function openHold(projectId: string, kind: 'hold' | 'cancelled') {
  return {
    id: `h-${projectId}`,
    project_id: projectId,
    kind,
    reason: 'because',
    note: null,
    hold_start: '2026-06-01',
    hold_end: null,
  };
}

function cycle(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    permit_id: 0,
    cycle_index: 1,
    submitted: '2026-05-01',
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** A permit that lands in the "Under Review" sub-bucket — bucketing is
 *  cycle-driven (a submitted, uncorrected cycle = under review). */
function permit(over: Record<string, unknown>) {
  return {
    id: 0,
    project_id: 'p1',
    type: 'Building Permit',
    num: null,
    status: 'Reviews In Process',
    stage: null,
    stage_override: null,
    da: null,
    dual_da: null,
    dm: null,
    ent_lead: null,
    permit_owner: null,
    nickname: null,
    struct_address: null,
    parent_permit_id: null,
    target_submit: null,
    approval_date: null,
    actual_issue: null,
    corr_issued: null,
    permit_cycles: [cycle()],
    extras: null,
    ...over,
  };
}

function renderDash() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

/** Addresses of every card currently rendered anywhere in the matrix. */
function renderedAddresses(): string[] {
  return screen
    .getAllByTestId(/^addr-group-/)
    .map((el) => el.getAttribute('data-addr') ?? '')
    .filter(Boolean);
}

/** The "N proj ·" badge text for the Under Review sub-bucket. */
function underReviewProjBadge(): string {
  return (
    screen.getByTestId('dash-subbucket-projcount-Under Review').textContent ?? ''
  );
}

beforeEach(() => {
  projectsRef.current = [
    { id: 'cancelled-proj', address: '13021 23rd Ave NE', juris: 'Seattle' },
    { id: 'held-proj', address: '6340 4th Ave NE', juris: 'Seattle' },
    { id: 'plain-proj', address: '900 Normal St', juris: 'Bellevue' },
  ];
  permitsRef.current = [
    permit({ id: 1, project_id: 'cancelled-proj' }),
    permit({ id: 2, project_id: 'held-proj' }),
    permit({ id: 3, project_id: 'plain-proj' }),
  ];
  holdsRef.current = [];
});

// ★ fix-313 #63/#65: the landing page is renamed. Asserted on the same render
// the rest of this file already drives, so the rename is checked against the
// real page rather than a fixture of it.
describe('Dashboard — fix-313 the landing page is Pipeline', () => {
  it('★ reads Pipeline, and the Approval strip reads Approve', () => {
    renderDash();
    expect(screen.getByTestId('pipeline-title').textContent).toBe('Pipeline');
    expect(screen.getByText('Approve')).toBeInTheDocument();
    // The old words are gone from the page.
    expect(screen.queryByText('Approval')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  // ★ #61: exactly ONE entry point to the wizard, and it is the ribbon's.
  it('★ no longer carries its own "+ Add New Project" button', () => {
    renderDash();
    expect(screen.queryByTestId('dashboard-new-project')).toBeNull();
    expect(screen.queryByText(/Add New Project/i)).toBeNull();
  });

  // ★ The names the brief says must NOT change. Bobby: "My Board, Pipeline,
  // Project Overview — so the only one that gets renamed is the landing page."
  it('★ does not rename anything else — Design & Engineering and Issued stand', () => {
    renderDash();
    expect(screen.getByText('Design & Engineering')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
  });
});

describe('Dashboard — cancelled projects (fix-264)', () => {
  it('baseline: with no holds, all three projects render and are counted', () => {
    renderDash();
    expect(renderedAddresses()).toEqual(
      expect.arrayContaining(['13021 23rd Ave NE', '6340 4th Ave NE', '900 Normal St']),
    );
    expect(underReviewProjBadge()).toMatch(/3 proj/);
  });

  it('a CANCELLED project is absent from every column', () => {
    holdsRef.current = [openHold('cancelled-proj', 'cancelled')];
    renderDash();
    expect(renderedAddresses()).not.toContain('13021 23rd Ave NE');
    expect(screen.queryByText('13021 23rd Ave NE')).toBeNull();
  });

  it('the count badges exclude it — the half people actually notice', () => {
    holdsRef.current = [openHold('cancelled-proj', 'cancelled')];
    renderDash();
    // 3 projects · 3 permits → 2 · 2. Badge text AND the permit total.
    expect(underReviewProjBadge()).toMatch(/2 proj/);
    const sub = screen.getByTestId('dash-subbucket-projcount-Under Review');
    expect(sub).toHaveAttribute('title', '2 projects · 2 permits');
  });

  it('a HELD project is still present and still counted', () => {
    holdsRef.current = [
      openHold('cancelled-proj', 'cancelled'),
      openHold('held-proj', 'hold'),
    ];
    renderDash();
    expect(renderedAddresses()).toContain('6340 4th Ave NE');
    expect(underReviewProjBadge()).toMatch(/2 proj/);
  });

  it('holds alone change nothing — the pipeline is byte-identical to the baseline', () => {
    holdsRef.current = [
      openHold('cancelled-proj', 'hold'),
      openHold('held-proj', 'hold'),
      openHold('plain-proj', 'hold'),
    ];
    renderDash();
    expect(renderedAddresses()).toEqual(
      expect.arrayContaining(['13021 23rd Ave NE', '6340 4th Ave NE', '900 Normal St']),
    );
    expect(underReviewProjBadge()).toMatch(/3 proj/);
  });

  it('a LIFTED cancel (hold_end set) puts the project back', () => {
    holdsRef.current = [
      { ...openHold('cancelled-proj', 'cancelled'), hold_end: '2026-07-01' },
    ];
    renderDash();
    expect(renderedAddresses()).toContain('13021 23rd Ave NE');
    expect(underReviewProjBadge()).toMatch(/3 proj/);
  });

  it('hides a cancelled project from the ISSUED strip too, badge included', () => {
    // Each project gets a live permit AND an issued one — hideIssuedAtAddress
    // suppresses issued cards only at an address where EVERY permit is issued,
    // so the live sibling is what keeps the issued card on the strip at all.
    permitsRef.current = [
      permit({ id: 1, project_id: 'cancelled-proj' }),
      permit({ id: 11, project_id: 'cancelled-proj', status: 'Issued', actual_issue: '2026-06-01', permit_cycles: [] }),
      permit({ id: 2, project_id: 'held-proj' }),
      permit({ id: 22, project_id: 'held-proj', status: 'Issued', actual_issue: '2026-06-02', permit_cycles: [] }),
    ];
    holdsRef.current = [
      openHold('cancelled-proj', 'cancelled'),
      openHold('held-proj', 'hold'),
    ];
    renderDash();
    const strip = screen.getByTestId('dash-strip-projcount-is');
    expect(strip).toHaveAttribute('title', '1 projects · 1 permits');
    expect(renderedAddresses()).not.toContain('13021 23rd Ave NE');
    expect(renderedAddresses()).toContain('6340 4th Ave NE');
  });

  it('offers no "show cancelled" escape hatch — the Project List Active toggle is the one place', () => {
    holdsRef.current = [openHold('cancelled-proj', 'cancelled')];
    renderDash();
    expect(screen.queryByText(/show cancelled/i)).toBeNull();
    // The hold filter is the only project-state control on this page.
    const controls = screen.getByTestId('dashboard-hold-filter');
    expect(within(controls).queryByText(/cancel/i)).toBeNull();
  });
});
