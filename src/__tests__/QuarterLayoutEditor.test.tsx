import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { TeamMember, DrawScheduleQuarterLayoutRow } from '../lib/database.types';
import { quarterOffsetToString } from '../lib/teamQuarterHelpers';

// fix-190c: the editor now BUFFERS edits in a local draft and persists the whole
// quarter atomically on Save (bp_replace_quarter_layout). These tests assert
// edits do NOT hit the DB until Save, Save sends the full draft, Discard
// restores, the dirty indicator tracks, and the quarter-switch / conflict guards
// behave. (The per-row write hooks are gone from this component.)

const NOW = '2026-06-18T00:00:00Z';

const mocks = vi.hoisted(() => ({
  clone: vi.fn(),
  seed: vi.fn(),
  // replace.mutate(input, opts). Default: succeed (call onSuccess).
  replace: vi.fn(
    (
      _input: { quarter: string; rows: Record<string, unknown>[]; expectedFingerprint: string | null },
      opts?: { onSuccess?: () => void; onError?: (e: unknown) => void },
    ) => {
      opts?.onSuccess?.();
    },
  ),
  replacePending: false,
  refetch: vi.fn(),
}));

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  isLoading: false,
  error: null as unknown,
  dataUpdatedAt: 1,
}));

vi.mock('../hooks/useQuarterLayout', () => ({
  useQuarterLayout: () => ({
    rows: state.rows,
    data: state.rows,
    isLoading: state.isLoading,
    error: state.error,
    dataUpdatedAt: state.dataUpdatedAt,
    refetch: mocks.refetch.mockResolvedValue({ data: state.rows }),
  }),
}));
vi.mock('../hooks/useBuildQuarterLayout', () => ({
  useCloneQuarterLayout: () => ({ mutate: mocks.clone, isPending: false }),
  useSeedQuarterLayoutFromCurrent: () => ({ mutate: mocks.seed, isPending: false }),
}));
// Preserve the real isReplaceConflict + layoutFingerprint; mock only the hook.
vi.mock('../hooks/useReplaceQuarterLayout', async (orig) => ({
  ...(await orig<typeof import('../hooks/useReplaceQuarterLayout')>()),
  useReplaceQuarterLayout: () => ({
    mutate: mocks.replace,
    isPending: mocks.replacePending,
  }),
}));

import QuarterLayoutEditor from '../components/Settings/QuarterLayoutEditor';

const DAS: TeamMember[] = [
  { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
  { id: 'da-2', name: 'Ahmadi', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
];
const DMS: TeamMember[] = [
  { id: 'dm-1', name: 'Brittani', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
];

function row(over: Partial<DrawScheduleQuarterLayoutRow>): DrawScheduleQuarterLayoutRow {
  return {
    id: 'r0', quarter: 'Q', position: 0, col_kind: 'da', da_name: 'Marc',
    group_label: 'Brittani', label_override: null, top_label: null, updated_at: NOW,
    ...over,
  };
}

function rowsFixture(): DrawScheduleQuarterLayoutRow[] {
  return [
    row({ id: 'r0', position: 0, da_name: 'Marc', group_label: 'Brittani' }),
    row({ id: 'r1', position: 1, da_name: 'Fisk', group_label: 'Brittani' }),
    row({ id: 'r2', position: 2, col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN' }),
  ];
}

function renderIt(readOnly = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The editor uses useBlocker → it must render inside a data router.
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <QuarterLayoutEditor das={DAS} dms={DMS} readOnly={readOnly} />,
      },
    ],
    { initialEntries: ['/'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.replace.mockImplementation((_i, opts) => {
    opts?.onSuccess?.();
  });
  mocks.refetch.mockResolvedValue({ data: state.rows });
  mocks.replacePending = false;
  state.rows = [];
  state.isLoading = false;
  state.error = null;
  state.dataUpdatedAt = 1;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<QuarterLayoutEditor /> empty state (bootstrap)', () => {
  it('offers duplicate-previous + start-from-current when the quarter has no layout', () => {
    renderIt();
    expect(screen.getByTestId('ql-empty-state')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ql-duplicate-prev'));
    expect(mocks.clone).toHaveBeenCalledWith({
      from: quarterOffsetToString(-1),
      to: quarterOffsetToString(0),
    });
    fireEvent.click(screen.getByTestId('ql-seed-current'));
    expect(mocks.seed).toHaveBeenCalledWith({ quarter: quarterOffsetToString(0) });
  });
});

describe('<QuarterLayoutEditor /> draft model (fix-190c)', () => {
  beforeEach(() => {
    state.rows = rowsFixture();
  });

  it('renders one row per column + is NOT dirty on load', () => {
    renderIt();
    expect(screen.getByTestId('ql-row-r0')).toBeInTheDocument();
    expect(screen.getByTestId('ql-row-r2')).toBeInTheDocument();
    expect(screen.queryByTestId('ql-unsaved-indicator')).not.toBeInTheDocument();
    expect((screen.getByTestId('ql-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('editing a field does NOT hit the DB and flips dirty (no replace until Save)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('ql-unsaved-indicator')).toBeInTheDocument();
    expect((screen.getByTestId('ql-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('adding a column mutates the draft only (no DB write)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-add-da-select'), { target: { value: 'Trevor' } });
    expect(mocks.replace).not.toHaveBeenCalled();
    // A 4th row appears (the appended draft row), dirty on.
    expect(screen.getAllByTestId(/^ql-row-/).length).toBe(4);
    expect(screen.getByTestId('ql-unsaved-indicator')).toBeInTheDocument();
  });

  it('deleting a column mutates the draft only (no DB write)', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('ql-remove-r2'));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ql-row-r2')).not.toBeInTheDocument();
    expect(screen.getByTestId('ql-unsaved-indicator')).toBeInTheDocument();
  });

  it('Save sends the full draft (positions implied by order) + the OCC fingerprint, ONCE', () => {
    renderIt();
    // Edit r0's DA and r1's top tier, then save.
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    fireEvent.change(screen.getByTestId('ql-top-r1'), { target: { value: 'Miles' } });
    fireEvent.click(screen.getByTestId('ql-save'));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const input = mocks.replace.mock.calls[0][0];
    expect(input.quarter).toBe(quarterOffsetToString(0));
    expect(input.expectedFingerprint).toBe(NOW); // max(updated_at) of loaded rows
    expect(input.rows).toEqual([
      { col_kind: 'da', da_name: 'Ahmadi', group_label: 'Brittani', label_override: null, top_label: null },
      { col_kind: 'da', da_name: 'Fisk', group_label: 'Brittani', label_override: null, top_label: 'Miles' },
      { col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN', top_label: null },
    ]);
  });

  it('Discard restores the loaded state and clears dirty', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('ql-remove-r2'));
    expect(screen.queryByTestId('ql-row-r2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ql-discard'));
    expect(screen.getByTestId('ql-row-r2')).toBeInTheDocument(); // back
    expect(screen.queryByTestId('ql-unsaved-indicator')).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('adds a DM (solo) column to the draft with da_name + group_label = the DM', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-add-dm-select'), { target: { value: 'Brittani' } });
    fireEvent.click(screen.getByTestId('ql-save'));
    const lastRow = mocks.replace.mock.calls[0][0].rows.at(-1);
    expect(lastRow).toMatchObject({ col_kind: 'dm', da_name: 'Brittani', group_label: 'Brittani' });
  });

  it('converting a DA column to OPEN clears the lane owner in the draft', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-type-r0'), { target: { value: 'open' } });
    fireEvent.click(screen.getByTestId('ql-save'));
    expect(mocks.replace.mock.calls[0][0].rows[0]).toMatchObject({ col_kind: 'open', da_name: null });
  });
});

describe('<QuarterLayoutEditor /> unsaved-changes guards (fix-190c)', () => {
  beforeEach(() => {
    state.rows = rowsFixture();
  });

  it('switching quarter while dirty prompts; CANCEL keeps the current quarter', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderIt();
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    const sel = screen.getByTestId('ql-quarter-select') as HTMLSelectElement;
    const target = quarterOffsetToString(-1);
    fireEvent.change(sel, { target: { value: target } });
    expect(window.confirm).toHaveBeenCalled();
    // Cancelled → still on the original quarter (controlled select snaps back).
    expect(sel.value).toBe(quarterOffsetToString(0));
  });

  it('switching quarter while dirty and CONFIRM switches', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderIt();
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    const sel = screen.getByTestId('ql-quarter-select') as HTMLSelectElement;
    const target = quarterOffsetToString(-1);
    fireEvent.change(sel, { target: { value: target } });
    expect(sel.value).toBe(target);
  });

  it('switching quarter when NOT dirty does not prompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderIt();
    const sel = screen.getByTestId('ql-quarter-select') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: quarterOffsetToString(-1) } });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('conflict on Save → warns + reloads (adopts server), no clobber', async () => {
    // replace.mutate fires onError with a 40001 conflict.
    mocks.replace.mockImplementation((_i, opts) => {
      opts?.onError?.({ code: '40001', message: 'conflict' });
    });
    renderIt();
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    fireEvent.click(screen.getByTestId('ql-save'));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    // The conflict path refetches to reload the latest server version.
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });
});

describe('<QuarterLayoutEditor /> read-only', () => {
  beforeEach(() => {
    state.rows = rowsFixture();
  });

  it('hides Save / Discard / add controls and disables inputs', () => {
    renderIt(true);
    expect(screen.queryByTestId('ql-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-discard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-add-da-select')).not.toBeInTheDocument();
    expect((screen.getByTestId('ql-da-r0') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByTestId('ql-remove-r0')).not.toBeInTheDocument();
  });
});
