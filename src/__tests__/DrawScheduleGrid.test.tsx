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
        // Q6.2.e: spans both before and after p-other's range (Ahmadi
        // 05-04 → 05-11) so clipping produces TWO visible segments:
        // 04-27 (head) and 05-18 → 05-25 (tail).
        id: 'np-ahmadi',
        da_name: 'Ahmadi',
        type: 'Other',
        label: 'Style Guide',
        start_week: '2026-04-27',
        end_week: '2026-05-25',
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

// Q9.5.f-fix-20: mocks for the new DA-propagation mutation hooks. The
// mutate fn invokes onSuccess synchronously with a configurable result so
// tests can drive the GapFillPrompt flow without a real RPC.
const moveDaMutate = vi.fn();
const moveDaResult = {
  current: {
    projectId: 'p-now',
    updatedAt: '2026-05-14T12:30:00Z',
    oldDa: 'Trevor',
    permitsUpdated: 2,
    tasksUpdated: 5,
    gapExists: true,
    gapDownstreamCount: 2,
    gapAfterWeek: '2026-05-04',
  },
};
vi.mock('../hooks/useMoveDrawScheduleDa', () => ({
  useMoveDrawScheduleDa: () => ({
    mutate: (input: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
      moveDaMutate(input);
      opts?.onSuccess?.(moveDaResult.current);
    },
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

const shiftUpMutate = vi.fn();
vi.mock('../hooks/useShiftDaBlocksUp', () => ({
  useShiftDaBlocksUp: () => ({
    mutate: shiftUpMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

// fix-25-feat-a: mock useResizeDaTimeBlock. Its mutate fn invokes
// onSuccess synchronously with a configurable result so tests can drive
// the conflict-prompt path without a real RPC.
const resizeNpMutate = vi.fn();
const resizeNpResult: {
  current: {
    blockId: string;
    updatedAt: string | null;
    overlapKind: 'project' | 'np' | null;
    overlapConflicts: unknown[] | null;
    proposedStartWeek: string | null;
    proposedEndWeek: string | null;
  };
} = {
  current: {
    blockId: 'np-trevor',
    updatedAt: '2026-05-16T18:00:00Z',
    overlapKind: null,
    overlapConflicts: null,
    proposedStartWeek: null,
    proposedEndWeek: null,
  },
};
vi.mock('../hooks/useResizeDaTimeBlock', () => ({
  useResizeDaTimeBlock: () => ({
    mutate: (input: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
      resizeNpMutate(input);
      opts?.onSuccess?.(resizeNpResult.current);
    },
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
  moveDaMutate.mockClear();
  shiftUpMutate.mockClear();
  resizeNpMutate.mockClear();
  resizeNpResult.current = {
    blockId: 'np-trevor',
    updatedAt: '2026-05-16T18:00:00Z',
    overlapKind: null,
    overlapConflicts: null,
    proposedStartWeek: null,
    proposedEndWeek: null,
  };
  moveDaResult.current = {
    projectId: 'p-now',
    updatedAt: '2026-05-14T12:30:00Z',
    oldDa: 'Trevor',
    permitsUpdated: 2,
    tasksUpdated: 5,
    gapExists: true,
    gapDownstreamCount: 2,
    gapAfterWeek: '2026-05-04',
  };
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
    const trevorNp = screen.getByTestId('np-block-np-trevor-seg-0');
    expect(trevorNp).toBeInTheDocument();
    expect(trevorNp.textContent).toBe('Vacation');

    const ahmadiNp = screen.getByTestId('np-block-np-ahmadi-seg-0');
    expect(ahmadiNp).toBeInTheDocument();
    // label preferred over type when distinct.
    expect(ahmadiNp.textContent).toBe('Style Guide');
  });

  it('Q6.2.e: NP block clipping renders one rectangle per visible segment when a project covers part of the NP range', () => {
    // np-ahmadi spans Ahmadi 2026-04-27 → 2026-05-25 (5 weeks). p-other on
    // Ahmadi covers 2026-05-04 → 2026-05-11. Expected segments:
    //   seg-0: 2026-04-27 (head, before project)
    //   seg-1: 2026-05-18 → 2026-05-25 (tail, after project)
    // No seg-2.
    renderGrid();
    const seg0 = screen.getByTestId('np-block-np-ahmadi-seg-0');
    const seg1 = screen.getByTestId('np-block-np-ahmadi-seg-1');
    expect(seg0).toBeInTheDocument();
    expect(seg1).toBeInTheDocument();
    // Both segments carry the same label.
    expect(seg0.textContent).toBe('Style Guide');
    expect(seg1.textContent).toBe('Style Guide');
    // Same hover tooltip on each segment (the underlying NP block is the
    // same record — clipping is purely visual).
    expect(seg0.getAttribute('title')).toBe(seg1.getAttribute('title'));
    expect(seg0.getAttribute('title')).toMatch(/2026-04-27 → 2026-05-25/);
    // No third segment.
    expect(screen.queryByTestId('np-block-np-ahmadi-seg-2')).not.toBeInTheDocument();
  });

  it('Q6.2.c-fix: NP blocks have pointer-events:auto by default (so hover tooltip fires) and flip to none during a drag', () => {
    // Initial Q6.2.c shipped pointer-events:none ALWAYS, which silently broke
    // native title tooltips on NP blocks. The fix mirrors the source/sibling
    // pattern: auto by default, none only while a drag is active so drops
    // pass through to the cell underneath.
    renderGrid();
    const np = screen.getByTestId('np-block-np-trevor-seg-0');
    expect(np.style.pointerEvents).toBe('auto');

    // Fire dragstart on a project block; NP blocks should flip to none.
    const sourceBlock = screen.getByTestId('block-p-now');
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
    expect(screen.getByTestId('np-block-np-trevor-seg-0').style.pointerEvents).toBe('none');

    // dragend restores hover-friendly state.
    const dragEnd = new Event('dragend', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnd, 'dataTransfer', { value: dataTransfer });
    act(() => {
      sourceBlock.dispatchEvent(dragEnd);
    });
    expect(screen.getByTestId('np-block-np-trevor-seg-0').style.pointerEvents).toBe('auto');
  });

  it('Q6.2.c: NP blocks outside the current quarter are NOT rendered', () => {
    renderGrid();
    // No segments at all for the out-of-quarter NP.
    expect(screen.queryByTestId('np-block-np-marc-far-seg-0')).not.toBeInTheDocument();
  });

  it('Q6.2.d: drop overlapping an NP block (no project conflict) shows the soft warning, does NOT silently save', () => {
    renderGrid();
    // Trevor has an NP block at 2026-04-27 → 2026-05-04. Drop p-now (3 weeks)
    // onto Trevor at 2026-04-27 → range = 2026-04-27 → 2026-05-11 → overlaps NP.
    // Trevor has no project blocks currently on that range (p-now is on
    // Trevor at 05-04 originally; dropping at 04-27 is a no-project-overlap
    // case since the anchor excludes itself from project overlap).
    const block = screen.getByTestId('block-p-now');
    const target = screen.getByTestId('drop-cell-Trevor-2026-04-27');
    act(() => {
      simulateDragDrop(block, target);
    });
    expect(screen.getByTestId('np-warning-prompt')).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
    // Cancel closes the prompt without saving.
    fireEvent.click(screen.getByTestId('np-warning-prompt-cancel'));
    expect(screen.queryByTestId('np-warning-prompt')).not.toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('Q6.2.d: Save Anyway fires updateMutation with the captured target context + closes prompt', () => {
    renderGrid();
    const block = screen.getByTestId('block-p-now');
    const target = screen.getByTestId('drop-cell-Trevor-2026-04-27');
    act(() => {
      simulateDragDrop(block, target);
    });

    act(() => {
      fireEvent.click(screen.getByTestId('np-warning-prompt-confirm'));
    });
    // Same-DA drop with NP conflict — Trevor → Trevor — stays on
    // updateMutate (commitMove routes by DA-change detection).
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(moveDaMutate).not.toHaveBeenCalled();
    const arg = updateMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.projectId).toBe('p-now');
    expect(arg.daAssigned).toBe('Trevor');
    expect(arg.startWeek).toBe('2026-04-27');
    expect(arg.endWeek).toBe('2026-05-11'); // duration 3 weeks preserved

    // Q9.5.f-fix-20: NP confirm closes prompt synchronously now (was
    // gated on mutation onSuccess pre-fix). UX-wise this matches the
    // optimistic-write flow — the prompt vanishes the instant the
    // user accepts.
    expect(screen.queryByTestId('np-warning-prompt')).not.toBeInTheDocument();
  });

  it('Q6.2.d: project overlap takes precedence over NP overlap — project modal shows, NP prompt never appears', () => {
    renderGrid();
    // Drop p-now onto Ahmadi at 2026-05-04: collides with p-other (project
    // overlap) AND with the Ahmadi NP block "Style Guide" 2026-05-11 →
    // 2026-05-18 (NP overlap; new range = 05-04 → 05-18 spans it).
    // Expected: ONLY the project-overlap (Push Down) modal opens.
    const block = screen.getByTestId('block-p-now');
    const target = screen.getByTestId('drop-cell-Ahmadi-2026-05-04');
    act(() => {
      simulateDragDrop(block, target);
    });

    expect(screen.getByTestId('overlap-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('np-warning-prompt')).not.toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
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
    // Q9.5.f-fix-20: cross-DA drops route through bp_move_draw_schedule_da
    // (was updateMutation pre-fix-20). The same-DA path stays on the
    // original RPC; this drop targets Fisk while p-now is on Trevor → new path.
    expect(moveDaMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).not.toHaveBeenCalled();
    const arg = moveDaMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.newDa).toBe('Fisk');
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
  it('drops on an empty cell on a different DA → fires the DA-move mutation (Q9.5.f-fix-20)', () => {
    renderGrid();
    // Drag p-now (Trevor, 2026-05-04→2026-05-18) to Fisk on week 2026-06-08
    // (Fisk has no blocks → no overlap). Cross-DA drops now route through
    // bp_move_draw_schedule_da so permits + tasks propagate.
    const block = screen.getByTestId('block-p-now');
    const dropTarget = screen.getByTestId('drop-cell-Fisk-2026-06-08');
    simulateDragDrop(block, dropTarget);

    expect(moveDaMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).not.toHaveBeenCalled();
    const arg = moveDaMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.projectId).toBe('p-now');
    expect(arg.newDa).toBe('Fisk');
    // newDm derives from the dm_da_groups lookup: Fisk lives under Brittani.
    expect(arg.newDm).toBe('Brittani');
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

describe('<DrawScheduleGrid /> Q9.5.f-fix-20', () => {
  it('hovering a block lights up every week in its start..end range in the left column', () => {
    renderGrid();
    // p-now spans 2026-05-04 → 2026-05-18 (3 Mondays). Hover should mark
    // each of those 3 week-label cells as data-hovered.
    fireEvent.mouseEnter(screen.getByTestId('block-p-now'));
    expect(
      screen.getByTestId('week-label-2026-05-04').getAttribute('data-hovered'),
    ).toBe('true');
    expect(
      screen.getByTestId('week-label-2026-05-11').getAttribute('data-hovered'),
    ).toBe('true');
    expect(
      screen.getByTestId('week-label-2026-05-18').getAttribute('data-hovered'),
    ).toBe('true');
    // Adjacent uncovered week stays unmarked.
    expect(
      screen.getByTestId('week-label-2026-05-25').getAttribute('data-hovered'),
    ).toBeNull();
  });

  it('hovering an empty drop cell lights up just that single week', () => {
    renderGrid();
    fireEvent.mouseEnter(
      screen.getByTestId('drop-cell-Francesca-2026-06-08'),
    );
    expect(
      screen.getByTestId('week-label-2026-06-08').getAttribute('data-hovered'),
    ).toBe('true');
    // 1 week before — should NOT be highlighted (empty-cell hover = single).
    expect(
      screen.getByTestId('week-label-2026-06-01').getAttribute('data-hovered'),
    ).toBeNull();
  });

  it('renders a bottom-edge resize handle on every project block', () => {
    renderGrid();
    expect(screen.getByTestId('resize-handle-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-p-other')).toBeInTheDocument();
  });

  it('dropping on a DIFFERENT DA routes through bp_move_draw_schedule_da, opens GapFillPrompt on gap_exists', () => {
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now'); // currently on Trevor
    const targetCell = screen.getByTestId('drop-cell-Francesca-2026-06-08');
    act(() => {
      simulateDragDrop(sourceBlock, targetCell);
    });
    // The DA-move RPC fired (not the same-DA update path).
    expect(moveDaMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).not.toHaveBeenCalled();
    // GapFillPrompt opens because moveDaResult.gapExists=true.
    expect(screen.getByTestId('gap-fill-prompt')).toBeInTheDocument();
  });

  it('dropping on the SAME DA stays on the original bp_update_draw_schedule_with_dd_sync path', () => {
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now'); // on Trevor
    const targetCell = screen.getByTestId('drop-cell-Trevor-2026-06-15'); // also Trevor
    act(() => {
      simulateDragDrop(sourceBlock, targetCell);
    });
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(moveDaMutate).not.toHaveBeenCalled();
    // No gap on same-DA reposition, so no prompt.
    expect(screen.queryByTestId('gap-fill-prompt')).toBeNull();
  });

  it('GapFillPrompt Shift Up button fires useShiftDaBlocksUp with the right gap anchor', () => {
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now');
    const targetCell = screen.getByTestId('drop-cell-Francesca-2026-06-08');
    act(() => {
      simulateDragDrop(sourceBlock, targetCell);
    });
    act(() => {
      fireEvent.click(screen.getByTestId('gap-fill-prompt-shift'));
    });
    expect(shiftUpMutate).toHaveBeenCalledTimes(1);
    const callArg = shiftUpMutate.mock.calls[0][0];
    expect(callArg).toMatchObject({
      daName: 'Trevor', // the OLD DA — the one that just lost a block
      gapStartWeek: '2026-05-04',
      gapEndWeek: '2026-05-18',
    });
  });

  it('GapFillPrompt Leave Gap dismisses without firing the shift RPC', () => {
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now');
    const targetCell = screen.getByTestId('drop-cell-Francesca-2026-06-08');
    act(() => {
      simulateDragDrop(sourceBlock, targetCell);
    });
    act(() => {
      fireEvent.click(screen.getByTestId('gap-fill-prompt-leave'));
    });
    expect(shiftUpMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gap-fill-prompt')).toBeNull();
  });

  it('does NOT open GapFillPrompt when the move returned gap_exists=false', () => {
    // Override the default fixture: move succeeds but leaves no downstream.
    moveDaResult.current = {
      ...moveDaResult.current,
      gapExists: false,
      gapDownstreamCount: 0,
    };
    renderGrid();
    const sourceBlock = screen.getByTestId('block-p-now');
    const targetCell = screen.getByTestId('drop-cell-Francesca-2026-06-08');
    act(() => {
      simulateDragDrop(sourceBlock, targetCell);
    });
    expect(moveDaMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('gap-fill-prompt')).toBeNull();
  });

  // ============================================================
  // fix-23b: search snaps to matching quarter + filters NP overlays
  // ============================================================
  //
  // Test assumptions match the existing fixtures (no global Date mock):
  // run-date sits in Q2 2026 (per the autoMemory currentDate) and the
  // project blocks live there too. quarter-next steps forward one quarter
  // at a time; the active quarter label is rendered on the quarter-today
  // button. p-now ("500 Pike St") on Trevor at start_week=2026-05-04 is
  // the snap target.

  it('snaps quarterOffset to earliest match when search produces a result outside the current quarter', () => {
    renderGrid();
    const todayBtn = screen.getByTestId('quarter-today');
    const baseLabel = todayBtn.textContent ?? '';

    // Navigate forward two quarters; the displayed label changes.
    fireEvent.click(screen.getByTestId('quarter-next'));
    fireEvent.click(screen.getByTestId('quarter-next'));
    expect(screen.getByTestId('quarter-today').textContent).not.toBe(baseLabel);
    // Blocks no longer in the visible quarter.
    expect(screen.queryByTestId('block-p-now')).not.toBeInTheDocument();

    // Type a query matching p-now's address.
    fireEvent.change(screen.getByTestId('schedule-search'), {
      target: { value: 'pike' },
    });

    // Effect runs synchronously inside the change handler's commit.
    // Quarter label snaps back to the original quarter (Q2 2026 in fixture
    // time) and the matched block reappears.
    expect(screen.getByTestId('quarter-today').textContent).toBe(baseLabel);
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    // Non-matching block stays hidden by the search filter.
    expect(screen.queryByTestId('block-p-other')).not.toBeInTheDocument();
  });

  it('does not snap back when search is cleared', () => {
    renderGrid();
    // Search drives a snap to the match-quarter.
    fireEvent.click(screen.getByTestId('quarter-next'));
    fireEvent.click(screen.getByTestId('quarter-next'));
    fireEvent.change(screen.getByTestId('schedule-search'), {
      target: { value: 'pike' },
    });
    const snappedLabel = screen.getByTestId('quarter-today').textContent;

    // Clear search. The user keeps whichever quarter they're on.
    fireEvent.change(screen.getByTestId('schedule-search'), {
      target: { value: '' },
    });
    expect(screen.getByTestId('quarter-today').textContent).toBe(snappedLabel);
    // All blocks reappear since the filter is inactive.
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('block-p-other')).toBeInTheDocument();
  });

  it('hides NP blocks whose label and type do not match the active search', () => {
    renderGrid();
    // Baseline: both NP blocks render.
    expect(screen.getByTestId('np-block-np-trevor-seg-0')).toBeInTheDocument();
    expect(screen.getByTestId('np-block-np-ahmadi-seg-0')).toBeInTheDocument();

    // A query that matches neither NP labels/types nor any project.
    fireEvent.change(screen.getByTestId('schedule-search'), {
      target: { value: 'zzzzzz' },
    });

    expect(screen.queryByTestId('np-block-np-trevor-seg-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('np-block-np-ahmadi-seg-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('block-p-now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('block-p-other')).not.toBeInTheDocument();
  });

  it('keeps NP blocks whose label matches the search', () => {
    renderGrid();
    fireEvent.change(screen.getByTestId('schedule-search'), {
      target: { value: 'vacation' },
    });
    // np-trevor's label and type are both "Vacation" — it stays.
    expect(screen.getByTestId('np-block-np-trevor-seg-0')).toBeInTheDocument();
    // np-ahmadi label is "Style Guide", type is "Other" — neither matches.
    expect(screen.queryByTestId('np-block-np-ahmadi-seg-0')).not.toBeInTheDocument();
    // No project address contains "vacation" either.
    expect(screen.queryByTestId('block-p-now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('block-p-other')).not.toBeInTheDocument();
  });

  // ----- fix-25-feat-a: NP block drag-to-resize -----

  it('renders top + bottom resize handles on each NP block segment', () => {
    renderGrid();
    // Trevor's vacation has one visible segment in current quarter.
    expect(screen.getByTestId('np-resize-top-np-trevor')).toBeInTheDocument();
    expect(screen.getByTestId('np-resize-bottom-np-trevor')).toBeInTheDocument();
    // Ahmadi's spans the p-other block; only the FIRST segment carries the
    // top handle (anchored to start_week), only the LAST carries the bottom
    // (anchored to end_week). Both segments exist; both handles exist once.
    expect(screen.getByTestId('np-resize-top-np-ahmadi')).toBeInTheDocument();
    expect(screen.getByTestId('np-resize-bottom-np-ahmadi')).toBeInTheDocument();
  });

  /** Simulate a window-level mouse event after the useEffect has attached
   *  its listener. Wraps in act() so the resulting state updates flush
   *  before the assertion runs. */
  function dispatchOnWindow(type: 'mousemove' | 'mouseup', init?: MouseEventInit) {
    act(() => {
      window.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
    });
  }

  it('dragging the bottom edge later commits via the resize RPC', () => {
    renderGrid();
    const handle = screen.getByTestId('np-resize-bottom-np-trevor');
    // mouseDown fires through its own act() so the useEffect attaching
    // the window listeners commits before the next dispatch.
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    // ROW_H = 28; drag down 56px = +2 weeks.
    dispatchOnWindow('mousemove', { clientY: 156 });
    dispatchOnWindow('mouseup');
    expect(resizeNpMutate).toHaveBeenCalledTimes(1);
    expect(resizeNpMutate.mock.calls[0][0]).toMatchObject({
      blockId: 'np-trevor',
      // start_week unchanged
      newStartWeek: '2026-04-27',
      // end_week pushed 2 weeks past original 2026-05-04
      newEndWeek: '2026-05-18',
      force: false,
    });
  });

  it('dragging the top edge earlier commits with a new start_week', () => {
    renderGrid();
    const handle = screen.getByTestId('np-resize-top-np-trevor');
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    // Drag up 28px = -1 week (start_week moves earlier).
    dispatchOnWindow('mousemove', { clientY: 72 });
    dispatchOnWindow('mouseup');
    expect(resizeNpMutate).toHaveBeenCalledTimes(1);
    expect(resizeNpMutate.mock.calls[0][0]).toMatchObject({
      blockId: 'np-trevor',
      newStartWeek: '2026-04-20', // 1 week earlier than original 2026-04-27
      newEndWeek: '2026-05-04', // unchanged
    });
  });

  it('Escape during a resize cancels without firing the RPC', () => {
    renderGrid();
    const handle = screen.getByTestId('np-resize-bottom-np-trevor');
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    dispatchOnWindow('mousemove', { clientY: 156 });
    // Escape clears the resizing state. The mouseup listener then no-ops.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    dispatchOnWindow('mouseup');
    expect(resizeNpMutate).not.toHaveBeenCalled();
  });

  it('resize hitting a project conflict opens NpResizeConflictPrompt with project copy', () => {
    resizeNpResult.current = {
      blockId: 'np-trevor',
      updatedAt: null,
      overlapKind: 'project',
      overlapConflicts: [
        {
          project_id: 'p-conflict',
          address: '500 Pike St',
          start_week: '2026-05-18',
          end_week: '2026-06-01',
        },
      ],
      proposedStartWeek: '2026-04-27',
      proposedEndWeek: '2026-05-25',
    };
    renderGrid();
    const handle = screen.getByTestId('np-resize-bottom-np-trevor');
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    dispatchOnWindow('mousemove', { clientY: 156 });
    dispatchOnWindow('mouseup');
    const prompt = screen.getByTestId('np-resize-conflict-prompt');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveTextContent(/project block/i);
    expect(prompt).toHaveTextContent('500 Pike St');
  });

  it('resize hitting an NP conflict opens NpResizeConflictPrompt with np copy', () => {
    resizeNpResult.current = {
      blockId: 'np-trevor',
      updatedAt: null,
      overlapKind: 'np',
      overlapConflicts: [
        {
          id: 'np_other',
          type: 'Training',
          label: 'Course',
          start_week: '2026-05-25',
          end_week: '2026-06-01',
        },
      ],
      proposedStartWeek: '2026-04-27',
      proposedEndWeek: '2026-05-25',
    };
    renderGrid();
    const handle = screen.getByTestId('np-resize-bottom-np-trevor');
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    dispatchOnWindow('mousemove', { clientY: 156 });
    dispatchOnWindow('mouseup');
    const prompt = screen.getByTestId('np-resize-conflict-prompt');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveTextContent(/time block/i);
    expect(prompt).toHaveTextContent('Training');
  });

  it('Save anyway in NpResizeConflictPrompt re-fires the RPC with force=true', () => {
    resizeNpResult.current = {
      blockId: 'np-trevor',
      updatedAt: null,
      overlapKind: 'np',
      overlapConflicts: [
        {
          id: 'np_other',
          type: 'Training',
          label: null,
          start_week: '2026-05-25',
          end_week: '2026-06-01',
        },
      ],
      proposedStartWeek: '2026-04-27',
      proposedEndWeek: '2026-05-25',
    };
    renderGrid();
    const handle = screen.getByTestId('np-resize-bottom-np-trevor');
    act(() => {
      fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
    });
    dispatchOnWindow('mousemove', { clientY: 156 });
    dispatchOnWindow('mouseup');
    expect(resizeNpMutate).toHaveBeenCalledTimes(1);

    // Reset the mocked response so the retry path lands as a clean write
    // (no infinite prompt loop).
    resizeNpResult.current = {
      blockId: 'np-trevor',
      updatedAt: '2026-05-16T20:00:00Z',
      overlapKind: null,
      overlapConflicts: null,
      proposedStartWeek: null,
      proposedEndWeek: null,
    };
    act(() => {
      fireEvent.click(screen.getByTestId('np-resize-conflict-confirm'));
    });
    expect(resizeNpMutate).toHaveBeenCalledTimes(2);
    expect(resizeNpMutate.mock.calls[1][0]).toMatchObject({
      force: true,
    });
    expect(screen.queryByTestId('np-resize-conflict-prompt')).toBeNull();
  });
});
