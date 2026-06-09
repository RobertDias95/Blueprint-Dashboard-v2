import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { isOCCConflict } from '../lib/occ';
import { WAITING_ON_OPTIONS } from '../lib/database.types';

const T = 'test-tenant-uuid';

// fix-139: client-contract tests for the consultant-firm + project-external-
// team hooks. The DB-level invariants (UNIQUE (tenant,name,discipline),
// CONCURRENT_UPDATE on stale OCC, archive flips active + drops out of the
// default list, get returns only assigned disciplines) were verified LIVE
// against prod via a transactional Supabase MCP probe at migration time —
// vitest runs offline, so here we pin the RPC wire-shape + the hook's OCC
// translation, Map derivation, and clear (firm_id=null) path.

const mocks = vi.hoisted(() => {
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const rpcFn = vi.fn();
  return {
    builder: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcFn(name, args);
        return Promise.resolve(result);
      },
    },
    rpcFn,
    setResult: (r: { data: unknown; error: unknown }) => {
      result = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import {
  useConsultantFirms,
  useUpsertConsultantFirm,
  useArchiveConsultantFirm,
  useProjectExternalTeam,
  useUpsertProjectExternalTeamMember,
} from '../hooks/useConsultantFirms';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  mocks.setResult({ data: [], error: null });
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

const FIRM = {
  id: 'firm-1',
  tenant_id: T,
  name: 'Prism',
  discipline: 'Civil' as const,
  active: true,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

// ============================================================
// useConsultantFirms
// ============================================================
describe('useConsultantFirms', () => {
  it('calls bp_list_consultant_firms with the include-inactive flag', async () => {
    mocks.setResult({ data: [FIRM], error: null });
    const { result } = renderHook(
      () => useConsultantFirms({ includeInactive: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_list_consultant_firms', {
      p_include_inactive: true,
    });
    expect(result.current.data).toEqual([FIRM]);
  });

  it('defaults include-inactive to false', async () => {
    const { result } = renderHook(() => useConsultantFirms(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_list_consultant_firms', {
      p_include_inactive: false,
    });
  });
});

// ============================================================
// useUpsertConsultantFirm
// ============================================================
describe('useUpsertConsultantFirm', () => {
  it('insert ships p_id=null + the full firm payload', async () => {
    mocks.setResult({ data: [FIRM], error: null });
    const { result } = renderHook(() => useUpsertConsultantFirm(), {
      wrapper: wrapper(),
    });
    const row = await result.current.mutateAsync({
      op: 'insert',
      patch: { name: 'Prism', discipline: 'Civil', notes: 'civil eng' },
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_upsert_consultant_firm', {
      p_id: null,
      p_name: 'Prism',
      p_discipline: 'Civil',
      p_active: true,
      p_notes: 'civil eng',
      p_expected_updated_at: null,
    });
    expect(row.id).toBe('firm-1');
    expect(row.active).toBe(true);
  });

  it('update ships the id + OCC token from the firm', async () => {
    mocks.setResult({ data: [{ ...FIRM, name: 'Prism Eng' }], error: null });
    const { result } = renderHook(() => useUpsertConsultantFirm(), {
      wrapper: wrapper(),
    });
    await result.current.mutateAsync({
      op: 'update',
      firm: FIRM,
      patch: { name: 'Prism Eng' },
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_upsert_consultant_firm', {
      p_id: 'firm-1',
      p_name: 'Prism Eng',
      p_discipline: 'Civil',
      p_active: true,
      p_notes: null,
      p_expected_updated_at: '2026-05-01T00:00:00Z',
    });
  });

  it('translates a CONCURRENT_UPDATE RPC error into an OCC conflict + warn toast', async () => {
    mocks.setResult({
      data: null,
      error: { message: 'CONCURRENT_UPDATE' },
    });
    const { result } = renderHook(() => useUpsertConsultantFirm(), {
      wrapper: wrapper(),
    });
    let caught: unknown;
    try {
      await result.current.mutateAsync({
        op: 'update',
        firm: FIRM,
        patch: { name: 'X' },
      });
    } catch (e) {
      caught = e;
    }
    expect(isOCCConflict(caught)).toBe(true);
    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((t) => t.kind === 'warn'),
      ).toBe(true),
    );
  });
});

// ============================================================
// useArchiveConsultantFirm
// ============================================================
describe('useArchiveConsultantFirm', () => {
  it('ships id + OCC token and returns the deactivated row', async () => {
    mocks.setResult({ data: [{ ...FIRM, active: false }], error: null });
    const { result } = renderHook(() => useArchiveConsultantFirm(), {
      wrapper: wrapper(),
    });
    const row = await result.current.mutateAsync(FIRM);
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_archive_consultant_firm', {
      p_id: 'firm-1',
      p_expected_updated_at: '2026-05-01T00:00:00Z',
    });
    expect(row.active).toBe(false);
  });
});

// ============================================================
// useProjectExternalTeam
// ============================================================
describe('useProjectExternalTeam', () => {
  it('builds a Map over all 13 disciplines with assigned ones filled', async () => {
    mocks.setResult({
      data: [
        {
          project_id: 'proj-1',
          discipline: 'Civil',
          firm_id: 'firm-1',
          firm_name: 'Prism',
          tenant_id: T,
          updated_at: '2026-05-01T00:00:00Z',
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useProjectExternalTeam('proj-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_get_project_external_team', {
      p_project_id: 'proj-1',
    });
    const map = result.current.byDiscipline;
    expect(map.size).toBe(WAITING_ON_OPTIONS.length);
    expect(map.get('Civil')?.firm_id).toBe('firm-1');
    expect(map.get('Structural')).toBeNull();
  });
});

// ============================================================
// useUpsertProjectExternalTeamMember
// ============================================================
describe('useUpsertProjectExternalTeamMember', () => {
  it('assign ships the firm id', async () => {
    mocks.setResult({
      data: [
        {
          project_id: 'proj-1',
          discipline: 'Civil',
          firm_id: 'firm-1',
          firm_name: 'Prism',
          tenant_id: T,
          updated_at: '2026-05-02T00:00:00Z',
        },
      ],
      error: null,
    });
    const { result } = renderHook(
      () => useUpsertProjectExternalTeamMember(),
      { wrapper: wrapper() },
    );
    const row = await result.current.mutateAsync({
      projectId: 'proj-1',
      discipline: 'Civil',
      firmId: 'firm-1',
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith(
      'bp_upsert_project_external_team_member',
      { p_project_id: 'proj-1', p_discipline: 'Civil', p_firm_id: 'firm-1' },
    );
    expect(row?.firm_id).toBe('firm-1');
  });

  it('clear ships p_firm_id=null (DELETE path) and returns null', async () => {
    mocks.setResult({ data: [], error: null });
    const { result } = renderHook(
      () => useUpsertProjectExternalTeamMember(),
      { wrapper: wrapper() },
    );
    const row = await result.current.mutateAsync({
      projectId: 'proj-1',
      discipline: 'Civil',
      firmId: null,
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith(
      'bp_upsert_project_external_team_member',
      { p_project_id: 'proj-1', p_discipline: 'Civil', p_firm_id: null },
    );
    expect(row).toBeNull();
  });
});
