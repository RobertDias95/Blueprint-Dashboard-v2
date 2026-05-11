import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type {
  PermitCycle,
  PermitTask,
  PermitWithCycles,
} from '../lib/database.types';

const T = 'test-tenant-uuid';

// Q4: Wire-shape + behavior tests for the four cycle/task mutation hooks.
// Mocks supabase.rpc with a hoisted builder so the assertions can verify
// each hook ships the expected RPC name + args (esp. OCC token + merged
// full-row payload) and surfaces the right toast on each failure mode.

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown; error: Error | null } = {
    data: [],
    error: null,
  };
  const rpcFn = vi.fn();
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve(resolveResult);
    },
  };
  return {
    builder,
    rpcFn,
    setResult: (r: { data: unknown; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useUpsertPermitCycle } from '../hooks/useUpsertPermitCycle';
import { useDeletePermitCycle } from '../hooks/useDeletePermitCycle';
import { useUpsertPermitTask } from '../hooks/useUpsertPermitTask';
import { useDeletePermitTask } from '../hooks/useDeletePermitTask';

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function makeCycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'cycle-1',
    permit_id: 7,
    cycle_index: 1,
    submitted: '2026-01-15',
    city_target: '2026-02-01',
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-08T10:00:00Z',
    ...over,
  };
}

function makeTask(over: Partial<PermitTask> = {}): PermitTask {
  return {
    id: 'task-1',
    permit_id: 7,
    bucket: 'de',
    legacy_id: null,
    text: 'Original text',
    cat: 'general',
    is_jurisdiction_specific: false,
    start_date: null,
    due_date: '2026-09-01',
    target_date: null,
    completion_status: 'Open',
    done: false,
    assigned_to: 'Bobby',
    stage: 'de',
    is_auto_generated: false,
    city_acceptance_check: false,
    cycle_idx: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-08T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  useToastStore.getState().clear();
  // Q5.5.D: hooks read activeTenantId from authStore. Seed it.
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ============================================================
// useUpsertPermitCycle
// ============================================================

describe('useUpsertPermitCycle UPDATE', () => {
  it('merges patch into the cycle current state and ships full 5-field payload + OCC token', async () => {
    const cycle = makeCycle({
      submitted: '2026-01-15',
      city_target: '2026-02-01',
      corr_issued: '2026-03-01',
    });
    mocks.setResult({
      data: [
        {
          out_id: 'cycle-1',
          updated_at: '2026-05-08T10:01:00Z',
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: 7,
        projectId: 'proj-1',
        cycle,
        patch: { submitted: '2026-04-01' },
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_upsert_permit_cycle_row');
    expect(args.p_id).toBe('cycle-1');
    expect(args.p_expected_updated_at).toBe('2026-05-08T10:00:00Z');
    expect(args.p_data).toMatchObject({
      submitted: '2026-04-01', // patched
      city_target: '2026-02-01', // preserved from current cycle
      corr_issued: '2026-03-01', // preserved
      resubmitted: '', // null → '' for NULLIF
      intake_accepted: '', // null → '' for NULLIF
    });
  });

  it('throws OCCConflictError + warn toast when RPC returns conflict=true', async () => {
    mocks.setResult({
      data: [
        {
          out_id: 'cycle-1',
          updated_at: '2026-05-08T10:05:00Z',
          conflict: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: 7,
          projectId: 'proj-1',
          cycle: makeCycle(),
          patch: { submitted: '2026-04-01' },
        }),
      ).rejects.toThrow(/Cycle was modified/i);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});

describe('useUpsertPermitCycle INSERT', () => {
  it('fires with p_id=NULL + permit_id + cycle_index + 5 dates', async () => {
    mocks.setResult({
      data: [
        {
          out_id: 'cycle-new',
          updated_at: '2026-05-08T11:00:00Z',
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        op: 'insert',
        permitId: 7,
        projectId: 'proj-1',
        cycleIndex: 3,
        patch: { submitted: '2026-05-01' },
      });
    });

    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_upsert_permit_cycle_row');
    expect(args.p_id).toBeNull();
    expect(args.p_expected_updated_at).toBeNull();
    expect(args.p_data.permit_id).toBe(7);
    expect(args.p_data.cycle_index).toBe(3);
    expect(args.p_data.submitted).toBe('2026-05-01');
    expect(args.p_data.city_target).toBe('');
  });

  it('cycle date auto-derivation rule: setting intake_accepted ships it to the RPC (server creates cycle N+1)', async () => {
    // Server-side auto-derive (project_cycle_date_rule.md) is implemented in
    // bp_upsert_permit_cycle_row. The client just needs to ship the new
    // intake_accepted in the full-row payload — the RPC does the rest. This
    // test pins the wire shape so a future refactor of useUpsertPermitCycle
    // can't silently drop intake_accepted from the payload.
    const cycle = makeCycle({
      submitted: '2026-05-01',
      city_target: null,
      corr_issued: null,
      resubmitted: null,
      intake_accepted: null,
    });
    mocks.setResult({
      data: [
        {
          out_id: 'cycle-1',
          updated_at: '2026-05-11T12:00:00Z',
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: 7,
        projectId: 'proj-1',
        cycle,
        patch: { intake_accepted: '2026-05-10' },
      });
    });

    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_data.intake_accepted).toBe('2026-05-10');
    // The full-row payload must still ship the unchanged fields so the
    // server doesn't NULL them — and so the validation (intake_accepted >=
    // submitted) has both dates to compare.
    expect(args.p_data.submitted).toBe('2026-05-01');
  });
});

// ============================================================
// useDeletePermitCycle
// ============================================================

describe('useDeletePermitCycle', () => {
  it('fires DELETE with the OCC token from the cycle', async () => {
    mocks.setResult({
      data: [{ deleted: true, conflict: false, current_updated_at: null }],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useDeletePermitCycle(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        cycle: makeCycle(),
        permitId: 7,
        projectId: 'proj-1',
      });
    });

    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_delete_permit_cycle_row');
    expect(args.p_id).toBe('cycle-1');
    expect(args.p_expected_updated_at).toBe('2026-05-08T10:00:00Z');
  });

  it('rolls back optimistic delete + warn toast on conflict', async () => {
    mocks.setResult({
      data: [
        {
          deleted: false,
          conflict: true,
          current_updated_at: '2026-05-08T10:05:00Z',
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    const cycle = makeCycle();
    const permit: PermitWithCycles = {
      id: 7,
      project_id: 'proj-1',
      type: 'BP',
      stage: null,
      stage_override: null,
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: null,
      product_type: null,
      project_tags: null,
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-08T10:00:00Z',
      permit_cycles: [cycle],
    };
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, 'proj-1'), [permit]);

    const { result } = renderHook(() => useDeletePermitCycle(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          cycle,
          permitId: 7,
          projectId: 'proj-1',
        }),
      ).rejects.toThrow(/Cycle was modified/i);
    });

    // Cache should still have the cycle (rollback restored it).
    const restored = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    expect(restored?.[0].permit_cycles).toHaveLength(1);
    expect(restored?.[0].permit_cycles[0].id).toBe('cycle-1');

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});

// ============================================================
// useUpsertPermitTask
// ============================================================

describe('useUpsertPermitTask UPDATE', () => {
  it('merges patch with current task + ships full 16-field payload + OCC token', async () => {
    mocks.setResult({
      data: [
        {
          out_id: 'task-1',
          updated_at: '2026-05-08T11:00:00Z',
          conflict: false,
        },
      ],
      error: null,
    });

    const task = makeTask();
    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: 7,
        task,
        patch: { completion_status: 'Resolved' },
      });
    });

    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_upsert_permit_task_row');
    expect(args.p_id).toBe('task-1');
    expect(args.p_expected_updated_at).toBe('2026-05-08T10:00:00Z');
    // Patched field
    expect(args.p_data.completion_status).toBe('Resolved');
    // Preserved from current task
    expect(args.p_data.bucket).toBe('de');
    expect(args.p_data.text).toBe('Original text');
    expect(args.p_data.assigned_to).toBe('Bobby');
    expect(args.p_data.due_date).toBe('2026-09-01');
    // Defaults preserved
    expect(args.p_data.done).toBe(false);
    expect(args.p_data.sort_order).toBe(0);
  });

  it('throws OCCConflictError + warn toast when RPC returns conflict=true', async () => {
    mocks.setResult({
      data: [
        {
          out_id: 'task-1',
          updated_at: '2026-05-08T11:00:00Z',
          conflict: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitTask(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: 7,
          task: makeTask(),
          patch: { text: 'whatever' },
        }),
      ).rejects.toThrow(/Task was modified/i);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});

describe('useUpsertPermitTask INSERT', () => {
  it('fires with p_id=NULL + sensible defaults for missing fields', async () => {
    mocks.setResult({
      data: [
        {
          out_id: 'task-new',
          updated_at: '2026-05-08T11:00:00Z',
          conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpsertPermitTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        op: 'insert',
        permitId: 7,
        patch: { bucket: 'pm', text: 'New corrections task' },
      });
    });

    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_upsert_permit_task_row');
    expect(args.p_id).toBeNull();
    expect(args.p_expected_updated_at).toBeNull();
    expect(args.p_data.permit_id).toBe(7);
    expect(args.p_data.bucket).toBe('pm');
    expect(args.p_data.text).toBe('New corrections task');
    // Defaults
    expect(args.p_data.completion_status).toBe('Open');
    expect(args.p_data.stage).toBe('de');
    expect(args.p_data.done).toBe(false);
    expect(args.p_data.sort_order).toBe(0);
  });
});

// ============================================================
// useDeletePermitTask
// ============================================================

describe('useDeletePermitTask', () => {
  it('fires DELETE with the OCC token from the task', async () => {
    mocks.setResult({
      data: [{ deleted: true, conflict: false, current_updated_at: null }],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useDeletePermitTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ task: makeTask(), permitId: 7 });
    });

    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_delete_permit_task_row');
    expect(args.p_id).toBe('task-1');
    expect(args.p_expected_updated_at).toBe('2026-05-08T10:00:00Z');
  });

  it('rolls back the optimistic removal + warn toast on conflict', async () => {
    mocks.setResult({
      data: [
        {
          deleted: false,
          conflict: true,
          current_updated_at: '2026-05-08T10:05:00Z',
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    const task = makeTask();
    queryClient.setQueryData(queryKeys.permitTasksFor(T, 7), [task]);

    const { result } = renderHook(() => useDeletePermitTask(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ task, permitId: 7 }),
      ).rejects.toThrow(/Task was modified/i);
    });

    const restored = queryClient.getQueryData<PermitTask[]>(
      queryKeys.permitTasksFor(T, 7),
    );
    expect(restored).toHaveLength(1);
    expect(restored?.[0].id).toBe('task-1');
  });
});
