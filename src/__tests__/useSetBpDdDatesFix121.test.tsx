import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSetBpDdDates } from '../hooks/useSetBpDdDates';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import type { PermitWithCycles } from '../lib/database.types';

// fix-121: when bp_set_bp_dd_dates returns successfully, the hook's
// onSuccess synchronously patches the local cache with the new
// dd_start/dd_end + the BP's fresh updated_at (for OCC). PRE-fix-121 it
// did NOT touch target_submit — but the cascade IS firing server-side
// (verified: 0 drifted BPs in prod). The gap was UI-only: the user saw
// the new DD dates immediately while target_submit stayed at the pre-
// edit value until the invalidate-driven refetch returned (~100ms+).
// Bobby's 6516 37th Ave SW: moved DD to Q4 2025, target_submit
// "stayed in July 2026" until he refreshed manually.
//
// Post-fix the synchronous patch ALSO nulls out target_submit on every
// permit in the project so the UI renders "—" until the refetch lands
// — honest instead of stale.

const T = 'test-tenant-uuid';
const PROJECT_ID = 'b2f0bb66-541a-440b-a182-04fbac0931c0';

// Capture rpc invocations so we can drive the mutation deterministically.
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

beforeEach(() => {
  rpcMock.mockReset();
  useAuthStore.setState({ activeTenantId: T });
});

function makePermit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: 10146,
    project_id: PROJECT_ID,
    type: 'Building Permit',
    stage: 'pm',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: '2026-07-23',
    dd_start: '2026-06-01',
    dd_end: '2026-06-26',
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-06-02T22:30:00Z',
    permit_cycles: [],
    ...over,
  };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed both cache shapes with the pre-edit permits.
  const initialPermits: PermitWithCycles[] = [
    makePermit({ id: 10146, type: 'Building Permit', target_submit: '2026-07-23' }),
    makePermit({
      id: 10147,
      type: 'Demolition',
      target_submit: '2026-09-01',
      updated_at: '2026-06-02T22:30:01Z',
    }),
    makePermit({
      id: 10149,
      type: 'TRAO',
      target_submit: '2025-06-05',
      updated_at: '2026-06-02T22:30:02Z',
    }),
  ];
  queryClient.setQueryData(queryKeys.permits(T), initialPermits);
  queryClient.setQueryData(
    queryKeys.permitsByProject(T, PROJECT_ID),
    initialPermits,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetBpDdDates(), { wrapper });
  return { hook: result, queryClient };
}

describe('useSetBpDdDates fix-121', () => {
  it('nulls out target_submit on the BP + every sibling permit in the cache after the RPC succeeds', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          out_project_id: PROJECT_ID,
          out_bp_updated_at: '2026-06-02T22:37:35Z',
          out_draw_schedule_updated_at: '2026-06-02T22:37:35Z',
          out_conflict: false,
          out_permits_updated: 3,
          out_overlap_kind: null,
          out_overlap_conflicts: null,
          out_proposed_start_week: null,
          out_proposed_end_week: null,
        },
      ],
      error: null,
    });
    const { hook, queryClient } = setup();
    await hook.current.mutateAsync({
      projectId: PROJECT_ID,
      ddStart: '2025-10-06',
      ddEnd: '2025-10-17',
      expectedUpdatedAt: '2026-06-02T22:30:00Z',
    });
    await waitFor(() => {
      const cached = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT_ID),
      );
      expect(cached).toBeDefined();
      // Every permit on the project has target_submit nulled (UI shows
      // "—" until refetch returns the cascaded value).
      for (const p of cached!) {
        if (p.project_id === PROJECT_ID) {
          expect(p.target_submit).toBeNull();
        }
      }
    });
  });

  it('synchronously reflects the new dd_start / dd_end on every project permit', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          out_project_id: PROJECT_ID,
          out_bp_updated_at: '2026-06-02T22:37:35Z',
          out_draw_schedule_updated_at: '2026-06-02T22:37:35Z',
          out_conflict: false,
          out_permits_updated: 3,
          out_overlap_kind: null,
          out_overlap_conflicts: null,
          out_proposed_start_week: null,
          out_proposed_end_week: null,
        },
      ],
      error: null,
    });
    const { hook, queryClient } = setup();
    await hook.current.mutateAsync({
      projectId: PROJECT_ID,
      ddStart: '2025-10-06',
      ddEnd: '2025-10-17',
      expectedUpdatedAt: '2026-06-02T22:30:00Z',
    });
    await waitFor(() => {
      const cached = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT_ID),
      );
      expect(cached).toBeDefined();
      for (const p of cached!) {
        if (p.project_id === PROJECT_ID) {
          expect(p.dd_start).toBe('2025-10-06');
          expect(p.dd_end).toBe('2025-10-17');
        }
      }
    });
  });

  it('writes the fresh OCC token on the BP only (siblings refetch their own)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          out_project_id: PROJECT_ID,
          out_bp_updated_at: '2026-06-02T22:37:35Z',
          out_draw_schedule_updated_at: '2026-06-02T22:37:35Z',
          out_conflict: false,
          out_permits_updated: 3,
          out_overlap_kind: null,
          out_overlap_conflicts: null,
          out_proposed_start_week: null,
          out_proposed_end_week: null,
        },
      ],
      error: null,
    });
    const { hook, queryClient } = setup();
    await hook.current.mutateAsync({
      projectId: PROJECT_ID,
      ddStart: '2025-10-06',
      ddEnd: '2025-10-17',
      expectedUpdatedAt: '2026-06-02T22:30:00Z',
    });
    await waitFor(() => {
      const cached = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT_ID),
      );
      expect(cached).toBeDefined();
      const bp = cached!.find((p) => p.type === 'Building Permit');
      const demo = cached!.find((p) => p.type === 'Demolition');
      expect(bp?.updated_at).toBe('2026-06-02T22:37:35Z');
      // Siblings keep their pre-edit updated_at until invalidate triggers
      // a refetch — preserves the existing fix-73 contract.
      expect(demo?.updated_at).toBe('2026-06-02T22:30:01Z');
    });
  });

  it('does NOT touch the cache when the RPC returns an overlap response (caller handles via prompt)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          out_project_id: PROJECT_ID,
          out_bp_updated_at: '2026-06-02T22:30:00Z',
          out_draw_schedule_updated_at: '2026-06-02T22:30:00Z',
          out_conflict: false,
          out_permits_updated: 0,
          out_overlap_kind: 'np',
          out_overlap_conflicts: [],
          out_proposed_start_week: '2025-10-06',
          out_proposed_end_week: '2025-10-13',
        },
      ],
      error: null,
    });
    const { hook, queryClient } = setup();
    await hook.current.mutateAsync({
      projectId: PROJECT_ID,
      ddStart: '2025-10-06',
      ddEnd: '2025-10-17',
      expectedUpdatedAt: '2026-06-02T22:30:00Z',
    });
    const cached = queryClient.getQueryData<PermitWithCycles[]>(
      queryKeys.permitsByProject(T, PROJECT_ID),
    );
    // Cache unchanged when the RPC chose not to write.
    expect(cached!.find((p) => p.id === 10146)?.target_submit).toBe(
      '2026-07-23',
    );
    expect(cached!.find((p) => p.id === 10146)?.dd_end).toBe('2026-06-26');
  });
});
