import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { isOCCConflict } from '../lib/occ';

// fix-182b: caller contract for the quarter-layout mutation hooks. The SQL
// behavior is verified by rolled-back MCP probes (fix-182a / fix-182b); these
// pin the hook -> RPC wire (arg names) + the OCC conflict mapping so a refactor
// can't silently drop them.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let result: { data: unknown; error: Error | null } = { data: null, error: null };
  const rpcFn = vi.fn();
  return {
    rpcFn,
    builder: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcFn(name, args);
        return Promise.resolve(result);
      },
    },
    setResult: (r: { data: unknown; error: Error | null }) => {
      result = r;
    },
  };
});
vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

const pushToast = vi.hoisted(() => vi.fn());
vi.mock('../stores/toastStore', () => ({
  pushToast,
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import { useUpsertQuarterLayoutRow } from '../hooks/useUpsertQuarterLayoutRow';
import { useDeleteQuarterLayoutRow } from '../hooks/useDeleteQuarterLayoutRow';
import { useReorderQuarterLayout } from '../hooks/useReorderQuarterLayout';
import {
  useCloneQuarterLayout,
  useSeedQuarterLayoutFromCurrent,
} from '../hooks/useBuildQuarterLayout';
import {
  useAppendQuarterLayoutColumn,
  useInsertQuarterLayoutColumn,
} from '../hooks/useAddQuarterLayoutColumn';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const NOW = '2026-06-18T00:00:00Z';

beforeEach(() => {
  mocks.rpcFn.mockClear();
  pushToast.mockClear();
  mocks.setResult({ data: null, error: null });
  useAuthStore.setState({ activeTenantId: T } as never);
});

describe('useUpsertQuarterLayoutRow', () => {
  it('inserts with p_id null + the full payload', async () => {
    mocks.setResult({ data: [{ out_id: 'id-1', updated_at: NOW, conflict: false }], error: null });
    const { result } = renderHook(() => useUpsertQuarterLayoutRow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        op: 'insert',
        data: {
          quarter: '2026-Q2',
          position: 3,
          col_kind: 'da',
          da_name: 'Marc',
          group_label: 'Brittani',
          label_override: null,
          top_label: null,
        },
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_upsert_quarter_layout_row', {
      p_id: null,
      p_expected_updated_at: null,
      p_data: expect.objectContaining({ quarter: '2026-Q2', col_kind: 'da', da_name: 'Marc' }),
    });
  });

  it('updates by merging the patch over the current row + threads OCC', async () => {
    mocks.setResult({ data: [{ out_id: 'id-9', updated_at: NOW, conflict: false }], error: null });
    const { result } = renderHook(() => useUpsertQuarterLayoutRow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        row: {
          id: 'id-9', quarter: '2026-Q2', position: 0, col_kind: 'da',
          da_name: 'Marc', group_label: null, label_override: null, top_label: null, updated_at: NOW,
        },
        patch: { group_label: 'Ana' },
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_upsert_quarter_layout_row', {
      p_id: 'id-9',
      p_expected_updated_at: NOW,
      p_data: expect.objectContaining({ da_name: 'Marc', group_label: 'Ana' }),
    });
  });

  it('maps conflict:true to an OCCConflictError + warns', async () => {
    mocks.setResult({ data: [{ out_id: 'id-9', updated_at: NOW, conflict: true }], error: null });
    const { result } = renderHook(() => useUpsertQuarterLayoutRow(), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          op: 'update',
          row: {
            id: 'id-9', quarter: '2026-Q2', position: 0, col_kind: 'open',
            da_name: null, group_label: null, label_override: 'OPEN', top_label: null, updated_at: NOW,
          },
          patch: { label_override: 'X' },
        });
      } catch (e) {
        caught = e;
      }
    });
    expect(isOCCConflict(caught)).toBe(true);
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('modified by someone else'), 'warn');
  });
});

describe('useDeleteQuarterLayoutRow', () => {
  it('deletes by id + expected updated_at', async () => {
    mocks.setResult({ data: [{ deleted: true, conflict: false, current_updated_at: null }], error: null });
    const { result } = renderHook(() => useDeleteQuarterLayoutRow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'id-1', updated_at: NOW, quarter: '2026-Q2' });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_delete_quarter_layout_row', {
      p_id: 'id-1',
      p_expected_updated_at: NOW,
    });
  });

  it('maps conflict:true to an OCCConflictError', async () => {
    mocks.setResult({ data: [{ deleted: false, conflict: true, current_updated_at: NOW }], error: null });
    const { result } = renderHook(() => useDeleteQuarterLayoutRow(), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'id-1', updated_at: 'stale', quarter: '2026-Q2' });
      } catch (e) {
        caught = e;
      }
    });
    expect(isOCCConflict(caught)).toBe(true);
  });
});

describe('useReorderQuarterLayout', () => {
  it('sends the quarter + full ordered id list', async () => {
    mocks.setResult({ data: null, error: null });
    const { result } = renderHook(() => useReorderQuarterLayout(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ quarter: '2026-Q2', ids: ['b', 'a', 'c'] });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_reorder_quarter_layout', {
      p_quarter: '2026-Q2',
      p_ids: ['b', 'a', 'c'],
    });
  });
});

describe('useCloneQuarterLayout / useSeedQuarterLayoutFromCurrent', () => {
  it('clone wires from/to/force and toasts the copied count', async () => {
    mocks.setResult({ data: 12, error: null });
    const { result } = renderHook(() => useCloneQuarterLayout(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ from: '2026-Q1', to: '2026-Q2' });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_clone_quarter_layout', {
      p_from: '2026-Q1',
      p_to: '2026-Q2',
      p_force: false,
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Copied 12'), 'success');
  });

  it('clone warns when the source had no layout (count 0)', async () => {
    mocks.setResult({ data: 0, error: null });
    const { result } = renderHook(() => useCloneQuarterLayout(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ from: '2026-Q1', to: '2026-Q2' });
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('no saved layout'), 'warn');
  });

  it('seed wires the quarter + force and toasts the column count', async () => {
    mocks.setResult({ data: 12, error: null });
    const { result } = renderHook(() => useSeedQuarterLayoutFromCurrent(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ quarter: '2026-Q2' });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_seed_quarter_layout_from_current', {
      p_quarter: '2026-Q2',
      p_force: false,
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('12 columns'), 'success');
  });
});

// fix-182d: collision-proof inserts. The position is decided server-side, so
// the hooks must send the column fields only (NO client position) under the
// RPC names that compute/shift the position.
describe('useAppendQuarterLayoutColumn / useInsertQuarterLayoutColumn (fix-182d)', () => {
  it('append wires bp_append_quarter_layout_column with the column only (no position)', async () => {
    mocks.setResult({ data: [{ out_id: 'id-1', updated_at: NOW, out_position: 7 }], error: null });
    const { result } = renderHook(() => useAppendQuarterLayoutColumn(), { wrapper });
    let pos = -1;
    await act(async () => {
      pos = await result.current.mutateAsync({
        quarter: '2025-Q3',
        col: { col_kind: 'da', da_name: 'Erick', group_label: 'Jade', label_override: null },
      });
    });
    expect(pos).toBe(7); // server-assigned position is returned
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_append_quarter_layout_column', {
      p_quarter: '2025-Q3',
      p_col: expect.objectContaining({ col_kind: 'da', da_name: 'Erick' }),
    });
    const sentCol = mocks.rpcFn.mock.calls[0][1].p_col;
    expect(sentCol).not.toHaveProperty('position');
  });

  // fix-190a: a solo-DM column appends like any other — col_kind passes through.
  it('append carries a col_kind=dm column (DM as lane owner + header)', async () => {
    mocks.setResult({ data: [{ out_id: 'id-dm', updated_at: NOW, out_position: 3 }], error: null });
    const { result } = renderHook(() => useAppendQuarterLayoutColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        quarter: '2025-Q3',
        col: { col_kind: 'dm', da_name: 'Jade', group_label: 'Jade', label_override: null },
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_append_quarter_layout_column', {
      p_quarter: '2025-Q3',
      p_col: expect.objectContaining({ col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' }),
    });
  });

  // fix-190b: top_label rides along on append (server stores it verbatim).
  it('append carries top_label through to the RPC', async () => {
    mocks.setResult({ data: [{ out_id: 'id-t', updated_at: NOW, out_position: 4 }], error: null });
    const { result } = renderHook(() => useAppendQuarterLayoutColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        quarter: '2025-Q3',
        col: { col_kind: 'da', da_name: 'Francesca', group_label: 'Lindsay', label_override: null, top_label: 'Miles' },
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_append_quarter_layout_column', {
      p_quarter: '2025-Q3',
      p_col: expect.objectContaining({ col_kind: 'da', da_name: 'Francesca', top_label: 'Miles' }),
    });
  });

  it('insert wires bp_insert_quarter_layout_column with the target position', async () => {
    mocks.setResult({ data: [{ out_id: 'id-2', updated_at: NOW, out_position: 1 }], error: null });
    const { result } = renderHook(() => useInsertQuarterLayoutColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        quarter: '2025-Q3',
        atPosition: 1,
        col: { col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN' },
      });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_insert_quarter_layout_column', {
      p_quarter: '2025-Q3',
      p_at_position: 1,
      p_col: expect.objectContaining({ col_kind: 'open' }),
    });
  });
});
