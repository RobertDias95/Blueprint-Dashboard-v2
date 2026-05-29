import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getQuarterWeeks } from '../lib/drawScheduleHelpers';

// fix-DS-legibility: short-block content tiers + quarter-overlap (tail/head)
// compact variants. Week keys are derived from getQuarterWeeks relative to the
// real "now", so the fixtures land in the visible quarter regardless of when
// CI runs.
//
// fix-DS-fluid-sizing: the 2-week `sm` tier (address + status only) was
// dropped. Now only span-1 blocks are address-only (`xs`); every block >= 2
// weeks is `default` and renders full content (address + juris + status +
// Est. Approval), fluid-sized via blockFontPx. These tests assert the new
// shape: span-2 now shows juris.

const T = 'test-tenant-uuid';

const W = getQuarterWeeks(0); // current quarter weeks
const PREV = getQuarterWeeks(-1);
const NEXT = getQuarterWeeks(1);

type DrawRow = {
  project_id: string;
  da_assigned: string | null;
  start_week: string | null;
  end_week: string | null;
  status: string | null;
  manual_status: boolean | null;
  manually_placed: boolean | null;
  dd_start: string | null;
  dd_end: string | null;
  notes: string | null;
  color_override: string | null;
  status_override: string | null;
  updated_at: string;
};

function row(over: Partial<DrawRow>): DrawRow {
  return {
    project_id: 'x',
    da_assigned: 'A1',
    start_week: W[3],
    end_week: W[3],
    status: 'Approved',
    manual_status: null,
    manually_placed: true,
    dd_start: null,
    dd_end: null,
    notes: null,
    color_override: null,
    status_override: null,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const refs = vi.hoisted(() => ({
  draw: { current: [] as unknown[] },
  projects: { current: [] as unknown[] },
  permits: { current: [] as unknown[] },
}));

// fix-DS-fluid-sizing: the block's Est. Approval line is gated on a computed
// projection (computeProjectedApproval needs a Building Permit). Stub the
// projection so a single est-approval test can exercise the 2-line
// label/date layout without standing up the full permit-cycle pipeline.
// fix-DS-pill-and-date: the pipeline returns an ISO date; the block formats it
// to MM-DD-YY at render time, so the stub returns ISO and tests assert the
// formatted output.
vi.mock('../lib/projectedApproval', () => ({
  computeProjectedApproval: () => ({ projection: '2026-08-15' }),
}));

vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: refs.draw.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refs.permits.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    data: [], isLoading: false, error: null, refetch: vi.fn(),
    groups: [{ dm: 'DM1', das: ['A1', 'A2', 'A3', 'A4', 'A5'] }],
  }),
}));
vi.mock('../hooks/useDaTimeBlocks', () => ({
  useDaTimeBlocks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
const noopMut = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() };
vi.mock('../hooks/useUpdateDrawSchedule', () => ({ useUpdateDrawSchedule: () => noopMut }));
vi.mock('../hooks/useResolveDaOverlap', () => ({ useResolveDaOverlap: () => noopMut }));
vi.mock('../hooks/useMoveDrawScheduleDa', () => ({ useMoveDrawScheduleDa: () => noopMut }));
vi.mock('../hooks/useShiftDaBlocksUp', () => ({ useShiftDaBlocksUp: () => noopMut }));
vi.mock('../hooks/useUpsertDaTimeBlock', () => ({ useUpsertDaTimeBlock: () => noopMut }));
vi.mock('../hooks/useDeleteDaTimeBlock', () => ({ useDeleteDaTimeBlock: () => noopMut }));
vi.mock('../hooks/useResizeDaTimeBlock', () => ({ useResizeDaTimeBlock: () => noopMut }));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    data: [], isLoading: false, error: null, refetch: vi.fn(),
  }),
}));

import DrawScheduleGrid from '../components/DrawScheduleGrid';

function project(id: string, address: string, juris = 'Seattle') {
  return { id, address, juris, archived: false, notes: null };
}

function renderGrid() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DrawScheduleGrid />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  refs.draw.current = [];
  refs.projects.current = [];
  refs.permits.current = [];
});

describe('Draw Schedule block layout (fix-DS-uniform-layout)', () => {
  it('1 week: renders the SAME full 5-line stack — address + juris + status + Est. Approval (xs tier dropped)', () => {
    // fix-DS-uniform-layout: a 1-week block used to be the `xs` tier (address
    // only). Every non-tail block now renders the full stack regardless of
    // span. A permit drives the projection so the Est. Approval lines show.
    refs.draw.current = [row({ project_id: 'p1', da_assigned: 'A1', start_week: W[3], end_week: W[3] })];
    refs.projects.current = [project('p1', '500 Pike St')];
    refs.permits.current = [
      { id: 1, project_id: 'p1', type: 'Building Permit', permit_cycles: [], extras: {} },
    ];
    renderGrid();
    const block = screen.getByTestId('block-p1');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.getByTestId('block-address-p1').textContent).toContain('500 Pike St');
    expect(screen.getByTestId('block-juris-p1')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p1')).toBeInTheDocument();
    const est = screen.getByTestId('block-est-approval-p1');
    expect(est.textContent).toContain('Est. Approval');
    expect(est.textContent).toContain('08-15-26');
  });

  it('2 weeks: same full stack — address + juris + status', () => {
    refs.draw.current = [row({ project_id: 'p2', da_assigned: 'A2', start_week: W[3], end_week: W[4] })];
    refs.projects.current = [project('p2', '750 Oak Way')];
    renderGrid();
    const block = screen.getByTestId('block-p2');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.getByTestId('block-address-p2')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-p2')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p2')).toBeInTheDocument();
  });

  it('status pill is small (fix-DS-pill-and-date: font scales from a base of 6, not 8)', () => {
    refs.draw.current = [row({ project_id: 'ps', da_assigned: 'A2', start_week: W[3], end_week: W[4] })];
    refs.projects.current = [project('ps', '12 Small Pill Way')];
    renderGrid();
    const pill = screen.getByTestId('block-status-ps');
    // jsdom textScale=1 → 6px. Assert <=7 so we prove the smaller cap without
    // locking the exact value (textScale can multiply on a real viewport).
    expect(parseFloat(pill.style.fontSize)).toBeLessThanOrEqual(7);
  });

  it('3 weeks: same full stack — address + juris + status', () => {
    refs.draw.current = [row({ project_id: 'p3', da_assigned: 'A3', start_week: W[3], end_week: W[5] })];
    refs.projects.current = [project('p3', '123 Main St')];
    renderGrid();
    const block = screen.getByTestId('block-p3');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.getByTestId('block-address-p3')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-p3')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p3')).toBeInTheDocument();
  });

  it('8 weeks: same full stack (wide blocks identical content, just larger font)', () => {
    refs.draw.current = [row({ project_id: 'p8', da_assigned: 'A4', start_week: W[2], end_week: W[9] })];
    refs.projects.current = [project('p8', '88 Wide Blvd')];
    renderGrid();
    const block = screen.getByTestId('block-p8');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.getByTestId('block-address-p8')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-p8')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p8')).toBeInTheDocument();
  });

  it('Est. Approval renders as a two-line label/date when a projection exists', () => {
    // computeProjectedApproval is stubbed to a fixed date; the block needs a
    // Building Permit for the projection map to reach the stub.
    refs.draw.current = [
      row({ project_id: 'pe', da_assigned: 'A5', start_week: W[3], end_week: W[6] }),
    ];
    refs.projects.current = [project('pe', '5107 South Hudson')];
    refs.permits.current = [
      { id: 1, project_id: 'pe', type: 'Building Permit', permit_cycles: [], extras: {} },
    ];
    renderGrid();
    const est = screen.getByTestId('block-est-approval-pe');
    expect(est).toBeInTheDocument();
    // Two lines: the muted "Est. Approval" label + the bolder date.
    expect(est.textContent).toContain('Est. Approval');
    expect(est.textContent).toContain('08-15-26');
  });

  it('address is a single line truncated with CSS ellipsis; full address in the title', () => {
    // fix-DS-uniform-layout: addresses are one line, clipped via
    // white-space:nowrap + text-overflow:ellipsis (the browser paints the "…";
    // jsdom does not, so assert the CSS, not a literal character). The full
    // address lives in the title tooltip.
    const fullAddr = '12345 Northeast Greenwood Park Boulevard Suite 1000, Seattle, WA';
    refs.draw.current = [row({ project_id: 'pa', da_assigned: 'A1', start_week: W[3], end_week: W[6] })];
    refs.projects.current = [project('pa', fullAddr)];
    renderGrid();
    const addr = screen.getByTestId('block-address-pa');
    // shortLabel = everything before the first comma; no JS-inserted "…".
    expect(addr.textContent).toBe('12345 Northeast Greenwood Park Boulevard Suite 1000');
    expect(addr.textContent).not.toContain('…');
    expect(addr.style.whiteSpace).toBe('nowrap');
    expect(addr.style.textOverflow).toBe('ellipsis');
    expect(addr.style.overflow).toBe('hidden');
    expect(addr).toHaveAttribute('title', fullAddr);
  });

  it('fully-contained block has no overflow affordance', () => {
    refs.draw.current = [row({ project_id: 'p3', da_assigned: 'A3', start_week: W[3], end_week: W[5] })];
    refs.projects.current = [project('p3', '123 Main St')];
    renderGrid();
    expect(screen.getByTestId('block-p3')).not.toHaveAttribute('data-overflow');
    expect(screen.queryByTestId('block-overflow-nav-p3')).toBeNull();
  });

  it('tail (starts before quarter): renders the SAME full stack PLUS a ← corner nav button', () => {
    // fix-DS-tail-and-fit: a tail slice is no longer compact — it shows the
    // full stack like any block, with the "starts earlier" cue demoted to a
    // small corner ← button. Starts in the previous quarter, ends in this one;
    // a permit drives the projection so the Est. Approval lines show.
    refs.draw.current = [
      row({ project_id: 'pt', da_assigned: 'A4', start_week: PREV[PREV.length - 2], end_week: W[1] }),
    ];
    refs.projects.current = [project('pt', '900 Tail Ave')];
    refs.permits.current = [
      { id: 1, project_id: 'pt', type: 'Building Permit', permit_cycles: [], extras: {} },
    ];
    renderGrid();
    const block = screen.getByTestId('block-pt');
    // data-overflow stays so styling/tests can still detect a tail slice...
    expect(block).toHaveAttribute('data-overflow', 'tail');
    // ...but the content is the same 'default' full stack, not a compact variant.
    expect(block).toHaveAttribute('data-tier', 'default');
    // Address + juris + Est. Approval render on the tail slice...
    expect(screen.getByTestId('block-address-pt')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-pt')).toBeInTheDocument();
    // ...but fix-DS-overflow-no-pill drops the status pill on overflow slices
    // (the fill color already encodes status; freed room shows the address).
    expect(screen.queryByTestId('block-status-pt')).toBeNull();
    const est = screen.getByTestId('block-est-approval-pt');
    expect(est.textContent).toContain('Est. Approval');
    expect(est.textContent).toContain('08-15-26');
    // The "starts earlier" cue: a small ← corner button.
    const nav = screen.getByTestId('block-overflow-nav-pt');
    expect(nav.textContent).toBe('←');
  });

  it('tail ← corner button still navigates to the start quarter on click', () => {
    refs.draw.current = [
      row({ project_id: 'pt', da_assigned: 'A4', start_week: PREV[PREV.length - 2], end_week: W[1] }),
    ];
    refs.projects.current = [project('pt', '900 Tail Ave')];
    renderGrid();
    const nav = screen.getByTestId('block-overflow-nav-pt');
    // Clicking ← jumps to the block's start quarter (the previous one), where
    // the block STARTS in view (a head slice) → no tail overflow, no arrow.
    fireEvent.click(nav);
    expect(screen.queryByTestId('block-overflow-nav-pt')).toBeNull();
    expect(screen.getByTestId('block-pt')).not.toHaveAttribute('data-overflow');
  });

  it('centers the content stack vertically (justify-content: center)', () => {
    refs.draw.current = [row({ project_id: 'pc', da_assigned: 'A1', start_week: W[3], end_week: W[7] })];
    refs.projects.current = [project('pc', '321 Center Rd')];
    renderGrid();
    const block = screen.getByTestId('block-pc');
    expect(block.style.flexDirection).toBe('column');
    expect(block.style.justifyContent).toBe('center');
  });

  it('head (starts in this quarter, ends after): renders FULL with no arrow', () => {
    // Starts within the current quarter, ends in the next. The start/home
    // quarter renders the full uniform stack; the continuation is left to the
    // next quarter's tail slice.
    refs.draw.current = [
      row({ project_id: 'ph', da_assigned: 'A5', start_week: W[W.length - 4], end_week: NEXT[1] }),
    ];
    refs.projects.current = [project('ph', '42 Head Blvd')];
    renderGrid();
    const block = screen.getByTestId('block-ph');
    // Not compact, and no tail ← arrow. data-overflow is tail-only, so a head
    // slice never carries that attribute even though it IS an overflow block.
    expect(block).not.toHaveAttribute('data-overflow');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.queryByTestId('block-overflow-nav-ph')).toBeNull();
    expect(screen.getByTestId('block-address-ph')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-ph')).toBeInTheDocument();
    // fix-DS-overflow-no-pill: a head slice is an overflow block → no pill.
    expect(screen.queryByTestId('block-status-ph')).toBeNull();
  });

  it('uniform DOM snapshots: every span renders the same fields (guard against silent restyle regressions)', () => {
    // manual_status:true so deriveBlockStatus honors the stored "Approved"
    // (no permits in this test → otherwise it derives "Scheduled" from DD math).
    refs.draw.current = [
      row({ project_id: 'p1', da_assigned: 'A1', start_week: W[3], end_week: W[3], manual_status: true }),
      row({ project_id: 'p2', da_assigned: 'A2', start_week: W[3], end_week: W[4], manual_status: true }),
      row({ project_id: 'p3', da_assigned: 'A3', start_week: W[3], end_week: W[5], manual_status: true }),
    ];
    refs.projects.current = [
      project('p1', '500 Pike St'),
      project('p2', '750 Oak Way'),
      project('p3', '123 Main St'),
    ];
    renderGrid();
    // fix-DS-uniform-layout: span 1, 2 and 3 all render the identical field
    // set — address + juris + status (Est. Approval is projection-gated and
    // omitted here since there are no permits). No span is address-only.
    for (const [id, addr] of [
      ['p1', '500 Pike St'],
      ['p2', '750 Oak Way'],
      ['p3', '123 Main St'],
    ] as const) {
      const block = screen.getByTestId(`block-${id}`);
      expect(block.getAttribute('data-tier')).toBe('default');
      expect(block.textContent).toContain(addr);
      expect(block.textContent).toContain('Seattle');
      expect(block.textContent).toContain('Approved');
      expect(screen.getByTestId(`block-juris-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`block-status-${id}`)).toBeInTheDocument();
    }
  });
});
