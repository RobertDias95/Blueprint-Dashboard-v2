import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-167: the hold write hooks must pass the caller's active tenant as
// p_tenant_id — that's the client side of the fix-163 server gate (a
// cross-tenant p_tenant_id raises 42501 server-side; verified by rolled-back
// prod probe). Here we assert the RPC name + the tenant-scoped params.

const rpcMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: [{ id: 'h1', tenant_id: 't1', project_id: 'p1', reason: 'MHA' }],
    error: null,
  }),
);
vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import {
  useSetProjectHold,
  useLiftProjectHold,
  useUpdateProjectHold,
  activeHold,
} from '../hooks/useProjectHolds';
import type { ProjectHold } from '../lib/database.types';

const T = '00000000-0000-0000-0000-000000000001';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcMock.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-167 hold hooks pass the active tenant scope', () => {
  it('useSetProjectHold calls bp_set_project_hold with p_tenant_id from authStore', async () => {
    const { result } = renderHook(() => useSetProjectHold(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p1',
        reason: 'MHA',
        note: 'x',
        holdStart: '2026-06-10',
      });
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock.mock.calls[0][0]).toBe('bp_set_project_hold');
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_tenant_id: T,
      p_project_id: 'p1',
      p_reason: 'MHA',
      p_note: 'x',
      p_hold_start: '2026-06-10',
    });
  });

  it('useLiftProjectHold calls bp_lift_project_hold scoped to the tenant', async () => {
    const { result } = renderHook(() => useLiftProjectHold(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'p1', holdEnd: '2026-06-16' });
    });
    expect(rpcMock.mock.calls[0][0]).toBe('bp_lift_project_hold');
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_tenant_id: T,
      p_project_id: 'p1',
      p_hold_end: '2026-06-16',
    });
  });

  it('useUpdateProjectHold calls bp_update_project_hold scoped to the tenant', async () => {
    const { result } = renderHook(() => useUpdateProjectHold(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        holdId: 'h1',
        reason: 'Financing / capital decision',
        holdStart: '2026-06-01',
        holdEnd: null,
      });
    });
    expect(rpcMock.mock.calls[0][0]).toBe('bp_update_project_hold');
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_tenant_id: T,
      p_hold_id: 'h1',
      p_reason: 'Financing / capital decision',
      p_hold_start: '2026-06-01',
      p_hold_end: null,
    });
  });
});

describe('fix-167 activeHold helper', () => {
  it('returns the hold_end === null row, or null', () => {
    const rows: ProjectHold[] = [
      {
        id: 'closed',
        tenant_id: T,
        project_id: 'p1',
        reason: 'MHA',
        note: null,
        hold_start: '2026-05-01',
        hold_end: '2026-05-10',
        created_by: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'active',
        tenant_id: T,
        project_id: 'p1',
        reason: 'Financing / capital decision',
        note: null,
        hold_start: '2026-06-01',
        hold_end: null,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
    ];
    expect(activeHold(rows)?.id).toBe('active');
    expect(activeHold([rows[0]])).toBeNull();
    expect(activeHold(undefined)).toBeNull();
  });
});
