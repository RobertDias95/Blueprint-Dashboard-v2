import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getQuarterWeeks } from '../lib/drawScheduleHelpers';

// fix-DS-legibility: short-block content tiers (xs/sm/default) + quarter-
// overlap (tail/head) compact variants. Week keys are derived from
// getQuarterWeeks relative to the real "now", so the fixtures land in the
// visible quarter regardless of when CI runs.

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
}));

vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: refs.draw.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refs.projects.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
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
});

describe('Draw Schedule block tiers (fix-DS-legibility)', () => {
  it('xs (1 week): renders ONLY the address', () => {
    refs.draw.current = [row({ project_id: 'p1', da_assigned: 'A1', start_week: W[3], end_week: W[3] })];
    refs.projects.current = [project('p1', '500 Pike St')];
    renderGrid();
    const block = screen.getByTestId('block-p1');
    expect(block).toHaveAttribute('data-tier', 'xs');
    expect(screen.getByTestId('block-address-p1').textContent).toContain('500 Pike St');
    expect(screen.queryByTestId('block-juris-p1')).toBeNull();
    expect(screen.queryByTestId('block-status-p1')).toBeNull();
    expect(screen.queryByTestId('block-est-approval-p1')).toBeNull();
  });

  it('sm (2 weeks): renders address + status, no juris/est-approval', () => {
    refs.draw.current = [row({ project_id: 'p2', da_assigned: 'A2', start_week: W[3], end_week: W[4] })];
    refs.projects.current = [project('p2', '750 Oak Way')];
    renderGrid();
    const block = screen.getByTestId('block-p2');
    expect(block).toHaveAttribute('data-tier', 'sm');
    expect(screen.getByTestId('block-address-p2')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p2')).toBeInTheDocument();
    expect(screen.queryByTestId('block-juris-p2')).toBeNull();
    expect(screen.queryByTestId('block-est-approval-p2')).toBeNull();
  });

  it('default (3+ weeks): renders address + juris + status', () => {
    refs.draw.current = [row({ project_id: 'p3', da_assigned: 'A3', start_week: W[3], end_week: W[5] })];
    refs.projects.current = [project('p3', '123 Main St')];
    renderGrid();
    const block = screen.getByTestId('block-p3');
    expect(block).toHaveAttribute('data-tier', 'default');
    expect(screen.getByTestId('block-address-p3')).toBeInTheDocument();
    expect(screen.getByTestId('block-juris-p3')).toBeInTheDocument();
    expect(screen.getByTestId('block-status-p3')).toBeInTheDocument();
  });

  it('fully-contained block has no overflow affordance', () => {
    refs.draw.current = [row({ project_id: 'p3', da_assigned: 'A3', start_week: W[3], end_week: W[5] })];
    refs.projects.current = [project('p3', '123 Main St')];
    renderGrid();
    expect(screen.getByTestId('block-p3')).not.toHaveAttribute('data-overflow');
    expect(screen.queryByTestId('block-overflow-nav-p3')).toBeNull();
  });

  it('tail (starts before quarter): compact address-only + ← affordance; click navigates to the start quarter', () => {
    // Starts in the previous quarter, ends within the current one.
    refs.draw.current = [
      row({ project_id: 'pt', da_assigned: 'A4', start_week: PREV[PREV.length - 2], end_week: W[1] }),
    ];
    refs.projects.current = [project('pt', '900 Tail Ave')];
    renderGrid();
    const block = screen.getByTestId('block-pt');
    expect(block).toHaveAttribute('data-overflow', 'tail');
    expect(screen.getByTestId('block-address-pt')).toBeInTheDocument();
    // No detail rows on the compact overflow slice.
    expect(screen.queryByTestId('block-juris-pt')).toBeNull();
    expect(screen.queryByTestId('block-status-pt')).toBeNull();
    const nav = screen.getByTestId('block-overflow-nav-pt');
    expect(nav.textContent).toBe('←');
    // Clicking ← navigates to the block's start quarter (the previous one),
    // where it now reads as a HEAD slice (starts within, ends after).
    fireEvent.click(nav);
    expect(screen.getByTestId('block-pt')).toHaveAttribute('data-overflow', 'head');
  });

  it('head (ends after quarter): compact address-only + → affordance; click navigates to the next quarter', () => {
    // Starts within the current quarter, ends in the next.
    refs.draw.current = [
      row({ project_id: 'ph', da_assigned: 'A5', start_week: W[W.length - 2], end_week: NEXT[1] }),
    ];
    refs.projects.current = [project('ph', '42 Head Blvd')];
    renderGrid();
    const block = screen.getByTestId('block-ph');
    expect(block).toHaveAttribute('data-overflow', 'head');
    expect(screen.getByTestId('block-address-ph')).toBeInTheDocument();
    expect(screen.queryByTestId('block-status-ph')).toBeNull();
    const nav = screen.getByTestId('block-overflow-nav-ph');
    expect(nav.textContent).toBe('→');
    // Clicking → navigates to the next quarter, where the block now reads as
    // a TAIL slice (started in the prior quarter, ends within).
    fireEvent.click(nav);
    expect(screen.getByTestId('block-ph')).toHaveAttribute('data-overflow', 'tail');
  });

  it('tier DOM snapshots (guard against silent restyle regressions)', () => {
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
    // Snapshot the inner content (not positional styles) of each tier.
    expect(screen.getByTestId('block-p1').querySelector('[data-testid^="block-"]')?.textContent)
      .toMatchInlineSnapshot(`"500 Pike St"`);
    const sm = screen.getByTestId('block-p2');
    expect(sm.getAttribute('data-tier')).toBe('sm');
    expect(sm.textContent).toContain('750 Oak Way');
    expect(sm.textContent).toContain('Approved');
    const def = screen.getByTestId('block-p3');
    expect(def.getAttribute('data-tier')).toBe('default');
    expect(def.textContent).toContain('123 Main St');
    expect(def.textContent).toContain('Seattle');
    expect(def.textContent).toContain('Approved');
  });
});
