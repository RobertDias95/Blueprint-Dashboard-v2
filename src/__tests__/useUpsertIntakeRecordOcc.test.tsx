import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { IntakeRecord } from '../lib/database.types';

// fix-258 (secondary): the OCC token round-trip.
//
// bp_upsert_intake_records_row returns a FRESH updated_at, but the hook only
// called invalidateQueries — so a second edit made before the refetch landed
// still carried the STALE token and the server reported a conflict. The user
// then saw "Intake was modified by someone else — your edit was reverted" for
// their own edit. Miles got three of those in six minutes.
//
// Twelve other hooks already write the token back with setQueryData; both
// intake hooks did not.

const rpc = vi.fn();
const toast = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [{ id: 9 }], error: null }) }),
      }),
    }),
  },
}));
vi.mock('../stores/toastStore', () => ({ pushToast: (...a: unknown[]) => toast(...a) }));

import { useUpsertIntakeRecord } from '../hooks/useUpsertIntakeRecord';

const TENANT = 'tenant-0';

const RECORD: IntakeRecord = {
  id: 46,
  project_id: null,
  permit_id: 900,
  address: '3921 43rd Ave S',
  permit_num: '7133442-CN',
  permit_type: 'Building Permit',
  intake_date: '2026-08-04',
  is_placeholder: false,
  portal_url: null,
  link: null,
  created_at: null,
  updated_at: 'TOKEN-1',
};

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData<IntakeRecord[]>(queryKeys.intakeRecords(TENANT), [RECORD]);
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpc.mockReset();
  toast.mockReset();
  useAuthStore.setState({ activeTenantId: TENANT });
});

describe('useUpsertIntakeRecord — OCC token cache write', () => {
  it('writes the fresh updated_at into the cache on success', async () => {
    rpc.mockResolvedValue({
      data: [{ out_id: 46, updated_at: 'TOKEN-2', conflict: false }],
      error: null,
    });
    const qc = makeClient();
    const { result } = renderHook(() => useUpsertIntakeRecord(), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({
      op: 'update',
      record: RECORD,
      patch: { intake_date: '2026-08-11' },
    });

    await waitFor(() => {
      const rows = qc.getQueryData<IntakeRecord[]>(
        queryKeys.intakeRecords(TENANT),
      );
      expect(rows?.[0].updated_at).toBe('TOKEN-2');
      expect(rows?.[0].intake_date).toBe('2026-08-11');
    });
  });

  it('two successive edits with no refetch between them BOTH succeed', async () => {
    // The toast-storm scenario. The second edit must send the token the first
    // one returned, not the stale original.
    rpc
      .mockResolvedValueOnce({
        data: [{ out_id: 46, updated_at: 'TOKEN-2', conflict: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ out_id: 46, updated_at: 'TOKEN-3', conflict: false }],
        error: null,
      });

    const qc = makeClient();
    const { result } = renderHook(() => useUpsertIntakeRecord(), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({
      op: 'update',
      record: RECORD,
      patch: { intake_date: '2026-08-11' },
    });
    await waitFor(() => {
      expect(
        qc.getQueryData<IntakeRecord[]>(queryKeys.intakeRecords(TENANT))?.[0]
          .updated_at,
      ).toBe('TOKEN-2');
    });

    // Second edit reads the record straight out of the cache, as the UI does.
    const fresh = qc.getQueryData<IntakeRecord[]>(
      queryKeys.intakeRecords(TENANT),
    )![0];
    result.current.mutate({
      op: 'update',
      record: fresh,
      patch: { intake_date: '2026-08-18' },
    });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    // The critical assertion: the second call carried the FRESH token.
    expect(rpc.mock.calls[1][1].p_expected_updated_at).toBe('TOKEN-2');
    expect(toast).not.toHaveBeenCalledWith(
      expect.stringContaining('modified by someone else'),
      'warn',
    );
  });

  it('a GENUINE conflict still surfaces the toast — OCC is not weakened', async () => {
    rpc.mockResolvedValue({
      data: [{ out_id: 46, updated_at: 'TOKEN-X', conflict: true }],
      error: null,
    });
    const qc = makeClient();
    const { result } = renderHook(() => useUpsertIntakeRecord(), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({
      op: 'update',
      record: RECORD,
      patch: { intake_date: '2026-08-11' },
    });

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [message, level] = toast.mock.calls[0];
    expect(String(message)).toMatch(/modified/i);
    expect(level).toBe('warn');
    // And the cache must NOT have taken the rejected edit.
    const rows = qc.getQueryData<IntakeRecord[]>(
      queryKeys.intakeRecords(TENANT),
    );
    expect(rows?.[0].intake_date).toBe('2026-08-04');
  });
});
