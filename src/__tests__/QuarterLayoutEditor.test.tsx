import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TeamMember, DrawScheduleQuarterLayoutRow } from '../lib/database.types';
import { quarterOffsetToString } from '../lib/teamQuarterHelpers';

// fix-182b: QuarterLayoutEditor interactions. Hooks are mocked so the editor
// renders synchronously; mutate fns captured for assertion. (The hook -> RPC
// wire + OCC mapping are covered in quarterLayoutHooks.test.ts; the SQL by
// rolled-back prod probes.)

const NOW = '2026-06-18T00:00:00Z';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  clone: vi.fn(),
  seed: vi.fn(),
  append: vi.fn(),
}));

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  isLoading: false,
  error: null as unknown,
}));

vi.mock('../hooks/useQuarterLayout', () => ({
  useQuarterLayout: () => ({
    rows: state.rows,
    data: state.rows,
    isLoading: state.isLoading,
    error: state.error,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertQuarterLayoutRow', () => ({
  useUpsertQuarterLayoutRow: () => ({ mutate: mocks.upsert, isPending: false }),
}));
vi.mock('../hooks/useDeleteQuarterLayoutRow', () => ({
  useDeleteQuarterLayoutRow: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock('../hooks/useReorderQuarterLayout', async (orig) => ({
  ...(await orig<typeof import('../hooks/useReorderQuarterLayout')>()),
  useReorderQuarterLayout: () => ({ mutate: mocks.reorder, isPending: false }),
}));
vi.mock('../hooks/useBuildQuarterLayout', () => ({
  useCloneQuarterLayout: () => ({ mutate: mocks.clone, isPending: false }),
  useSeedQuarterLayoutFromCurrent: () => ({ mutate: mocks.seed, isPending: false }),
}));
vi.mock('../hooks/useAddQuarterLayoutColumn', () => ({
  useAppendQuarterLayoutColumn: () => ({ mutate: mocks.append, isPending: false }),
  useInsertQuarterLayoutColumn: () => ({ mutate: vi.fn(), isPending: false }),
}));

import QuarterLayoutEditor from '../components/Settings/QuarterLayoutEditor';

const DAS: TeamMember[] = [
  { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
  { id: 'da-2', name: 'Ahmadi', role: 'da', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
];
const DMS: TeamMember[] = [
  { id: 'dm-1', name: 'Brittani', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
];

function rowsFixture(): DrawScheduleQuarterLayoutRow[] {
  return [
    { id: 'r0', quarter: 'Q', position: 0, col_kind: 'da', da_name: 'Marc', group_label: 'Brittani', label_override: null, top_label: null, updated_at: NOW },
    { id: 'r1', quarter: 'Q', position: 1, col_kind: 'da', da_name: 'Fisk', group_label: 'Brittani', label_override: null, top_label: null, updated_at: NOW },
    { id: 'r2', quarter: 'Q', position: 2, col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN', top_label: null, updated_at: NOW },
  ];
}

function renderIt(readOnly = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <QuarterLayoutEditor das={DAS} dms={DMS} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.isLoading = false;
  state.error = null;
});

describe('<QuarterLayoutEditor /> empty state', () => {
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

  it('hides the build actions for non-admins', () => {
    renderIt(true);
    expect(screen.getByTestId('ql-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('ql-duplicate-prev')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-seed-current')).not.toBeInTheDocument();
  });
});

describe('<QuarterLayoutEditor /> populated', () => {
  beforeEach(() => {
    state.rows = rowsFixture();
  });

  it('renders one row per column + the manager-group preview spans', () => {
    renderIt();
    expect(screen.getByTestId('ql-row-r0')).toBeInTheDocument();
    expect(screen.getByTestId('ql-row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('ql-row-r2')).toBeInTheDocument();
    // Brittani spans 2 columns, then a standalone OPEN.
    const preview = screen.getByTestId('ql-group-preview');
    expect(preview.textContent).toContain('Brittani');
    expect(preview.textContent).toContain('standalone');
  });

  it('adds a DA column via the server-append RPC (NO client position — fix-182d)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-add-da-select'), {
      target: { value: 'Trevor' },
    });
    expect(mocks.append).toHaveBeenCalledWith({
      quarter: quarterOffsetToString(0),
      col: expect.objectContaining({ col_kind: 'da', da_name: 'Trevor' }),
    });
    // The collision-prone client position must NOT be sent.
    expect(mocks.append.mock.calls[0][0].col).not.toHaveProperty('position');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('inserts an OPEN lane via the server-append RPC', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('ql-add-open'));
    expect(mocks.append).toHaveBeenCalledWith({
      quarter: quarterOffsetToString(0),
      col: expect.objectContaining({ col_kind: 'open', da_name: null }),
    });
  });

  it('edits a DA column via upsert update {da_name}', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-da-r0'), { target: { value: 'Ahmadi' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r0' }),
      patch: { da_name: 'Ahmadi' },
    });
  });

  it('renames a group header via upsert update {group_label} (free text)', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('ql-group-r0'), { target: { value: 'Ana' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r0' }),
      patch: { group_label: 'Ana' },
    });
  });

  it('clears a group header to standalone (null) on blank', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('ql-group-r1'), { target: { value: '  ' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r1' }),
      patch: { group_label: null },
    });
  });

  // fix-190b: per-column top-tier (regional/ent) field.
  it('sets a top-tier label via upsert update {top_label}', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('ql-top-r0'), {
      target: { value: 'Miles, WA | Briana, AZ' },
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r0' }),
      patch: { top_label: 'Miles, WA | Briana, AZ' },
    });
  });

  it('clears a top-tier label to null on blank', () => {
    state.rows = [
      { id: 'rt', quarter: 'Q', position: 0, col_kind: 'da', da_name: 'Marc', group_label: 'Brittani', label_override: null, top_label: 'Miles', updated_at: NOW },
    ];
    renderIt();
    fireEvent.blur(screen.getByTestId('ql-top-rt'), { target: { value: '   ' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'rt' }),
      patch: { top_label: null },
    });
  });

  it('edits an OPEN lane label via upsert update {label_override}', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('ql-label-r2'), { target: { value: 'Spare' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r2' }),
      patch: { label_override: 'Spare' },
    });
  });

  it('removes a column via delete with OCC + quarter', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('ql-remove-r0'));
    expect(mocks.remove).toHaveBeenCalledWith({
      id: 'r0',
      updated_at: NOW,
      quarter: quarterOffsetToString(0),
    });
  });

  it('read-only hides drag handles, add controls, and remove buttons', () => {
    renderIt(true);
    expect(screen.queryByTestId('ql-drag-r0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-remove-r0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-add-da-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ql-add-open')).not.toBeInTheDocument();
  });

  // fix-190a: solo-DM columns.
  it('adds a DM (solo) column via append with col_kind=dm + da_name + group_label = the DM', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-add-dm-select'), {
      target: { value: 'Brittani' },
    });
    expect(mocks.append).toHaveBeenCalledWith({
      quarter: quarterOffsetToString(0),
      col: expect.objectContaining({
        col_kind: 'dm',
        da_name: 'Brittani',
        group_label: 'Brittani',
      }),
    });
    expect(mocks.append.mock.calls[0][0].col).not.toHaveProperty('position');
  });

  it('renders a DM dropdown for a col_kind=dm row and the type control reads "dm"', () => {
    state.rows = [
      { id: 'rdm', quarter: 'Q', position: 0, col_kind: 'dm', da_name: 'Brittani', group_label: 'Brittani', label_override: null, top_label: null, updated_at: NOW },
    ];
    renderIt();
    expect((screen.getByTestId('ql-type-rdm') as HTMLSelectElement).value).toBe('dm');
    expect(screen.getByTestId('ql-dm-rdm')).toBeInTheDocument();
    // No DA dropdown on a DM row.
    expect(screen.queryByTestId('ql-da-rdm')).not.toBeInTheDocument();
  });

  it('picking a DM sets col_kind + da_name + group_label together', () => {
    state.rows = [
      { id: 'rdm', quarter: 'Q', position: 0, col_kind: 'dm', da_name: 'Brittani', group_label: 'Brittani', label_override: null, top_label: null, updated_at: NOW },
    ];
    const dms2: TeamMember[] = [
      ...DMS,
      { id: 'dm-2', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: NOW, active_start_quarter: null, active_end_quarter: null },
    ];
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <QuarterLayoutEditor das={DAS} dms={dms2} readOnly={false} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByTestId('ql-dm-rdm'), { target: { value: 'Jade' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'rdm' }),
      patch: { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' },
    });
  });

  it('converting a DA column to DM defaults the lane owner + header to a DM', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-type-r0'), { target: { value: 'dm' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r0' }),
      patch: { col_kind: 'dm', da_name: 'Brittani', group_label: 'Brittani' },
    });
  });

  it('converting a DA column to OPEN clears the lane owner', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('ql-type-r0'), { target: { value: 'open' } });
    expect(mocks.upsert).toHaveBeenCalledWith({
      op: 'update',
      row: expect.objectContaining({ id: 'r0' }),
      patch: { col_kind: 'open', da_name: null },
    });
  });

  // fix-183: the editor flags a column whose DA is inactive in the selected
  // quarter (per Active Quarters), agreeing with the dimmed grid column.
  it('flags a column whose DA is inactive in the selected quarter', () => {
    state.rows = [
      { id: 'rx', quarter: 'Q', position: 0, col_kind: 'da', da_name: 'Trevor', group_label: null, label_override: null, top_label: null, updated_at: NOW },
    ];
    const endedTrevor: TeamMember[] = [
      { ...DAS[0], active_end_quarter: quarterOffsetToString(-1) }, // ended last quarter
    ];
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <QuarterLayoutEditor das={endedTrevor} dms={DMS} readOnly={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('ql-inactive-rx')).toBeInTheDocument();
  });
});
