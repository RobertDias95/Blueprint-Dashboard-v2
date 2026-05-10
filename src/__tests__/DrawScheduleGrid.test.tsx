import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// Q6.1: behavior tests for DrawScheduleGrid. Mocks the four hooks the
// component composes so the test can drive layout + filter behavior
// without touching Supabase.

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  draw: [
    {
      project_id: 'p-now',
      da_assigned: 'Trevor',
      start_week: '2026-05-04',
      end_week: '2026-05-18',
      status: 'Submitted',
      manual_status: null,
      manually_placed: true,
      dd_start: '2026-05-04',
      dd_end: '2026-05-22',
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
    {
      project_id: 'p-other',
      da_assigned: 'Ahmadi',
      start_week: '2026-05-04',
      end_week: '2026-05-11',
      status: 'Approved',
      manual_status: null,
      manually_placed: true,
      dd_start: '2026-05-04',
      dd_end: '2026-05-15',
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
    {
      project_id: 'p-noda',
      da_assigned: null,
      start_week: null,
      end_week: null,
      status: null,
      manual_status: null,
      manually_placed: false,
      dd_start: null,
      dd_end: null,
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
  ],
  projects: [
    { id: 'p-now', address: '500 Pike St', juris: 'Seattle', archived: false, notes: null },
    { id: 'p-other', address: '750 Oak Way', juris: 'Bellevue', archived: false, notes: null },
    { id: 'p-noda', address: '999 Unscheduled Ln', juris: 'Seattle', archived: false, notes: null },
  ],
  groups: [
    { dm: 'Lindsay', das: ['Francesca', 'Ainsley', 'Trevor'] },
    { dm: 'Brittani', das: ['Marc', 'Ahmadi', 'Fisk'] },
  ],
}));

vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({
    data: fixtures.draw,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    groups: fixtures.groups,
  }),
}));

// Mock useUpdateDrawSchedule so we can assert the drag-drop wiring fires it
// with the right payload (no Supabase round-trip in jsdom).
const updateMutate = vi.fn();
vi.mock('../hooks/useUpdateDrawSchedule', () => ({
  useUpdateDrawSchedule: () => ({
    mutate: updateMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

import DrawScheduleGrid from '../components/DrawScheduleGrid';

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  updateMutate.mockClear();
});

/** Synthesize an HTML5 drag-and-drop sequence in jsdom (which doesn't natively
 * implement DataTransfer round-trips). We share a single payload string across
 * the dragstart → drop pair to mirror what the browser does. */
function simulateDragDrop(
  source: HTMLElement,
  target: HTMLElement,
): void {
  const store = new Map<string, string>();
  const dataTransfer = {
    setData: (k: string, v: string) => {
      store.set(k, v);
    },
    getData: (k: string) => store.get(k) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
  };

  const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  source.dispatchEvent(dragStart);

  const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(dragOver);

  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(drop);
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

describe('<DrawScheduleGrid />', () => {
  it('renders DM + DA header rows and a column per DA', () => {
    renderGrid();
    expect(screen.getByText('Lindsay')).toBeInTheDocument();
    expect(screen.getByText('Brittani')).toBeInTheDocument();
    // 6 total DAs across the two groups.
    for (const da of ['Francesca', 'Ainsley', 'Trevor', 'Marc', 'Ahmadi', 'Fisk']) {
      expect(screen.getByText(da)).toBeInTheDocument();
      expect(screen.getByTestId(`da-col-${da}`)).toBeInTheDocument();
    }
  });

  it('places scheduled project blocks inside their DA columns', () => {
    renderGrid();
    // p-now is on Trevor; p-other is on Ahmadi. Both should render as blocks.
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('block-p-other')).toBeInTheDocument();
  });

  it('puts unassigned projects in the Unscheduled lane', () => {
    renderGrid();
    expect(screen.getByTestId('unscheduled-p-noda')).toBeInTheDocument();
    expect(screen.getByText('999 Unscheduled Ln')).toBeInTheDocument();
  });

  it('search filter narrows the visible blocks', () => {
    renderGrid();
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('block-p-other')).toBeInTheDocument();

    const search = screen.getByTestId('schedule-search');
    fireEvent.change(search, { target: { value: 'pike' } });

    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.queryByTestId('block-p-other')).not.toBeInTheDocument();
  });

  it('quarter navigator advances + rewinds, and "today" snaps back', () => {
    renderGrid();
    const nav = screen.getByTestId('quarter-today');
    const initial = nav.textContent ?? '';

    fireEvent.click(screen.getByTestId('quarter-next'));
    const next = nav.textContent ?? '';
    expect(next).not.toBe(initial);

    fireEvent.click(screen.getByTestId('quarter-prev'));
    expect(nav.textContent).toBe(initial);

    fireEvent.click(screen.getByTestId('quarter-prev'));
    expect(nav.textContent).not.toBe(initial);

    // "Today" snaps offset back to 0 → label matches initial again.
    fireEvent.click(screen.getByTestId('quarter-today'));
    expect(nav.textContent).toBe(initial);
  });
});

describe('<DrawScheduleGrid /> Q6.2 drag-edit', () => {
  it('drops on an empty cell on a different DA → fires updateMutation', () => {
    renderGrid();
    // Drag p-now (Trevor, 2026-05-04→2026-05-18) to Fisk on week 2026-06-08
    // (Fisk has no blocks → no overlap).
    const block = screen.getByTestId('block-p-now');
    const dropTarget = screen.getByTestId('drop-cell-Fisk-2026-06-08');
    simulateDragDrop(block, dropTarget);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const arg = updateMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.projectId).toBe('p-now');
    expect(arg.daAssigned).toBe('Fisk');
    expect(arg.startWeek).toBe('2026-06-08');
    // Duration was 3 weeks (05-04, 05-11, 05-18) → end = 06-08 + 2 weeks = 06-22.
    expect(arg.endWeek).toBe('2026-06-22');
    expect(arg.expectedUpdatedAt).toBe('2026-05-09T12:00:00Z');
  });

  it('drops on a cell that overlaps another block → shows the prompt and does NOT save', () => {
    renderGrid();
    const block = screen.getByTestId('block-p-now');
    const overlapTarget = screen.getByTestId('drop-cell-Ahmadi-2026-05-04');
    // Wrap in act() because the drop fires setPendingOverlap (state update)
    // and React 19 wants the update flushed before assertions read the DOM.
    act(() => {
      simulateDragDrop(block, overlapTarget);
    });

    expect(updateMutate).not.toHaveBeenCalled();
    const prompt = screen.getByTestId('overlap-prompt');
    expect(prompt).toBeInTheDocument();
    // Scope to the prompt — the address also appears in the grid block, so
    // a global getByText would be ambiguous.
    expect(within(prompt).getByText(/750 Oak Way/)).toBeInTheDocument();
    const pushBtn = screen.getByTestId('overlap-prompt-push-down');
    expect(pushBtn).toBeDisabled();
  });

  it('clicking Cancel on the overlap prompt closes it without saving', () => {
    renderGrid();
    const block = screen.getByTestId('block-p-now');
    const overlapTarget = screen.getByTestId('drop-cell-Ahmadi-2026-05-04');
    act(() => {
      simulateDragDrop(block, overlapTarget);
    });

    expect(screen.getByTestId('overlap-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('overlap-prompt-cancel'));
    expect(screen.queryByTestId('overlap-prompt')).not.toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('Bug A: blocks become pointer-events:none during a drag (so drops pass through to cells underneath)', () => {
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now');
    const otherBlock = screen.getByTestId('block-p-other');
    // Pre-drag: both blocks are interactive.
    expect(sourceBlock.style.pointerEvents).toBe('auto');
    expect(otherBlock.style.pointerEvents).toBe('auto');

    // Fire dragstart only — onDragStart should flip isDragging.
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    const dataTransfer = {
      setData: vi.fn(),
      getData: () => '',
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    act(() => {
      sourceBlock.dispatchEvent(dragStart);
    });

    // Both blocks (source AND siblings) are now transparent to pointer events,
    // so drops always land on the cell underneath.
    expect(screen.getByTestId('block-p-now').style.pointerEvents).toBe('none');
    expect(screen.getByTestId('block-p-other').style.pointerEvents).toBe('none');

    // dragend restores interactivity.
    const dragEnd = new Event('dragend', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnd, 'dataTransfer', { value: dataTransfer });
    act(() => {
      sourceBlock.dispatchEvent(dragEnd);
    });
    expect(screen.getByTestId('block-p-now').style.pointerEvents).toBe('auto');
    expect(screen.getByTestId('block-p-other').style.pointerEvents).toBe('auto');
  });
});
