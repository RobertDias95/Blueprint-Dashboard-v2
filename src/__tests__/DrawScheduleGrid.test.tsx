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

// Q6.2.c: NP blocks (vacation/training overlay). One on Trevor, one on
// Ahmadi, one on Marc — covers a couple DAs across both groups.
vi.mock('../hooks/useDaTimeBlocks', () => ({
  useDaTimeBlocks: () => ({
    data: [
      {
        id: 'np-trevor',
        da_name: 'Trevor',
        type: 'Vacation',
        label: 'Vacation',
        start_week: '2026-04-27',
        end_week: '2026-05-04',
        created_at: null,
      },
      {
        id: 'np-ahmadi',
        da_name: 'Ahmadi',
        type: 'Other',
        label: 'Style Guide',
        start_week: '2026-05-11',
        end_week: '2026-05-18',
        created_at: null,
      },
      {
        // Out of current quarter — should NOT render.
        id: 'np-marc-far',
        da_name: 'Marc',
        type: 'Training',
        label: 'Training',
        start_week: '2025-09-15',
        end_week: '2025-09-22',
        created_at: null,
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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

// Q6.2.b: mock useResolveDaOverlap. The mock's mutate respects the second
// argument (mutate options) so the onSuccess callback that closes the prompt
// can be exercised by the component test.
const resolveMutate = vi.fn();
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({
    mutate: resolveMutate,
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
  resolveMutate.mockClear();
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

  it('Q6.2.c: NP blocks render in their DA columns with the correct label', () => {
    renderGrid();
    const trevorNp = screen.getByTestId('np-block-np-trevor');
    expect(trevorNp).toBeInTheDocument();
    expect(trevorNp.textContent).toBe('Vacation');
    // pointer-events:none is the contract — NP blocks must never intercept
    // drag-drop. If this regresses, drops onto cells visually under an NP
    // block silently fail (same Bug A class regression).
    expect(trevorNp.style.pointerEvents).toBe('none');

    const ahmadiNp = screen.getByTestId('np-block-np-ahmadi');
    expect(ahmadiNp).toBeInTheDocument();
    // label preferred over type when distinct.
    expect(ahmadiNp.textContent).toBe('Style Guide');
  });

  it('Q6.2.c: NP blocks outside the current quarter are NOT rendered', () => {
    renderGrid();
    expect(screen.queryByTestId('np-block-np-marc-far')).not.toBeInTheDocument();
  });

  it('Q6.2.c: drag-drop still works through cells visually covered by NP blocks (pointer-events:none contract)', () => {
    renderGrid();
    // The Trevor NP block (np-trevor) covers 2026-04-27 → 2026-05-04. Drop the
    // p-now block onto that range on a DIFFERENT DA (Fisk has no NP block) to
    // verify the basic drop path is unaffected. We don't test drop ON the NP
    // range itself yet — that's Q6.2.d (soft warning).
    const block = screen.getByTestId('block-p-now');
    const dropTarget = screen.getByTestId('drop-cell-Fisk-2026-04-27');
    simulateDragDrop(block, dropTarget);
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const arg = updateMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.daAssigned).toBe('Fisk');
    expect(arg.startWeek).toBe('2026-04-27');
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
    // Q6.2.b: Push Down is now ENABLED (was disabled in Q6.2.a).
    const pushBtn = screen.getByTestId('overlap-prompt-push-down');
    expect(pushBtn).not.toBeDisabled();
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

  it('Q6.2.b: clicking Push Down fires useResolveDaOverlap with the captured target context, prompt closes on success', () => {
    renderGrid();
    const block = screen.getByTestId('block-p-now');
    const overlapTarget = screen.getByTestId('drop-cell-Ahmadi-2026-05-04');
    act(() => {
      simulateDragDrop(block, overlapTarget);
    });

    expect(screen.getByTestId('overlap-prompt')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('overlap-prompt-push-down'));
    });

    expect(resolveMutate).toHaveBeenCalledTimes(1);
    const [arg, opts] = resolveMutate.mock.calls[0] as [
      Record<string, unknown>,
      { onSuccess?: () => void } | undefined,
    ];
    // Args mirror the captured drop intent.
    expect(arg.anchorProjectId).toBe('p-now');
    expect(arg.daAssigned).toBe('Ahmadi');
    expect(arg.startWeek).toBe('2026-05-04');
    // Duration was 3 weeks → end = start + 2 weeks = 2026-05-18.
    expect(arg.endWeek).toBe('2026-05-18');
    expect(arg.expectedUpdatedAt).toBe('2026-05-09T12:00:00Z');

    // Update mutation must NOT have been called — overlap path takes precedence.
    expect(updateMutate).not.toHaveBeenCalled();

    // Component passes onSuccess that closes the prompt; invoke it to verify.
    expect(opts?.onSuccess).toBeTypeOf('function');
    act(() => {
      opts!.onSuccess!();
    });
    expect(screen.queryByTestId('overlap-prompt')).not.toBeInTheDocument();
  });

  it('Bug A (siblings only): drag source keeps pointer-events:auto, only siblings flip to none', () => {
    // Real-browser invariant: setting pointer-events:none on the dragged
    // source cancels the drag. Q6.2.a-fix tried to flip ALL blocks; that
    // broke drag in browsers but jsdom didn't catch it. This test asserts
    // the corrected behavior — source stays interactive, siblings step
    // aside so drops pass through to the cells underneath.
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now');
    const otherBlock = screen.getByTestId('block-p-other');
    expect(sourceBlock.style.pointerEvents).toBe('auto');
    expect(otherBlock.style.pointerEvents).toBe('auto');

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

    // CRITICAL: source must remain auto — flipping it to none cancels the
    // drag operation in real browsers.
    expect(screen.getByTestId('block-p-now').style.pointerEvents).toBe('auto');
    // Siblings step aside so drops can land on the cells underneath them.
    expect(screen.getByTestId('block-p-other').style.pointerEvents).toBe('none');

    // dragend restores all blocks to interactive.
    const dragEnd = new Event('dragend', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnd, 'dataTransfer', { value: dataTransfer });
    act(() => {
      sourceBlock.dispatchEvent(dragEnd);
    });
    expect(screen.getByTestId('block-p-now').style.pointerEvents).toBe('auto');
    expect(screen.getByTestId('block-p-other').style.pointerEvents).toBe('auto');
  });
});
