// ===========================================================================
// ★★★ fix-666 §A (P-318 census 30) — THE CONSULTANT DIRECTORY SAVES THROUGH
//     ONE SERVER STEP
// ===========================================================================
//
// `useUpsertDirectoryFirm` wrote `external_team_directory` directly. It now
// calls `bp_upsert_external_firm`, which checks the admin, decides the tenant,
// compares the stale-edit token, refuses a duplicate in the discipline
// (ignoring case and spaces), and is audited by the audit_row trigger.
//
// Pinned here: the hook's wire shape (the token on an update, none on an
// insert, leave-vs-clear for the optional fields), the stale refusal as the
// normal "reload" warning, the duplicate refusal as a sentence that stays out
// of Triage, and the migration's refusals.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());
const pushRecoveredToast = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({ supabase: { rpc, from } }));
vi.mock('../stores/toastStore', () => ({
  pushToast,
  pushRecoveredToast,
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import { useUpsertDirectoryFirm, STALE_FIRM_MESSAGE } from '../hooks/useExternalTeamDirectory';
import { useAuthStore } from '../stores/authStore';
import { __resetOccQueue } from '../lib/occQueue';
import { expectedUniqueRefusal, shouldSkipBackendRpcLog } from '../lib/errorLogger';

const TOKEN = '2026-10-13T20:00:00+00:00';
const NEXT = '2026-10-13T20:05:00+00:00';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function firmRow(over: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    discipline: 'Civil',
    name: 'Facet',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    active: true,
    created_at: '2026-01-01',
    updated_at: NEXT,
    ...over,
  };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  pushToast.mockReset();
  pushRecoveredToast.mockReset();
  __resetOccQueue();
  useAuthStore.setState({ activeTenantId: 't1' } as never);
});

describe('fix-666 §A — the hook calls the server function', () => {
  it('★★★ an UPDATE posts the token, the trimmed name, and leave-vs-clear for the optional fields', async () => {
    rpc.mockResolvedValue({ data: firmRow(), error: null });
    const { result } = renderHook(() => useUpsertDirectoryFirm(), { wrapper });
    await result.current.mutateAsync({
      id: 'f1',
      discipline: 'Civil',
      name: '  Facet Land  ',
      contact_email: null, // cleared
      contact_phone: '555-0100',
      expectedUpdatedAt: TOKEN,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bp_upsert_external_firm', {
      p_id: 'f1',
      p_discipline: 'Civil',
      p_name: 'Facet Land',
      p_contact_name: null, // not given → leave it
      p_contact_email: '', // null → clear it
      p_contact_phone: '555-0100',
      p_notes: null,
      p_active: null,
      p_expected_updated_at: TOKEN,
    });
    // ★ And the table is never written directly any more.
    expect(from).not.toHaveBeenCalled();
  });

  it('★★ an INSERT posts no id and no token — there is no prior row to be stale against', async () => {
    rpc.mockResolvedValue({ data: firmRow({ id: 'f2', name: 'Prism' }), error: null });
    const { result } = renderHook(() => useUpsertDirectoryFirm(), { wrapper });
    await result.current.mutateAsync({ discipline: 'Civil', name: 'Prism' });
    const [, args] = rpc.mock.calls[0];
    expect(args.p_id).toBeNull();
    expect(args.p_expected_updated_at).toBeNull();
    expect(args.p_name).toBe('Prism');
    expect(from).not.toHaveBeenCalled();
  });

  it('★★★ a STALE token reads as the normal "changed — reload" warning, not an error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: STALE_FIRM_MESSAGE },
    });
    const { result } = renderHook(() => useUpsertDirectoryFirm(), { wrapper });
    await expect(
      result.current.mutateAsync({
        id: 'f1',
        discipline: 'Civil',
        name: 'Facet',
        active: false,
        expectedUpdatedAt: TOKEN,
      }),
    ).rejects.toBeTruthy();
    await waitFor(() =>
      expect(pushRecoveredToast).toHaveBeenCalledWith(STALE_FIRM_MESSAGE, 'warn'),
    );
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('★★★ a DUPLICATE is refused with a sentence, and it is an answer — kept out of Triage', async () => {
    const dup = {
      code: '23505',
      message: '"Facet" is already in the directory for Civil.',
      details: 'uq_external_team_directory_tenant_disc_name',
    };
    rpc.mockResolvedValue({ data: null, error: dup });
    const { result } = renderHook(() => useUpsertDirectoryFirm(), { wrapper });
    await expect(
      result.current.mutateAsync({ discipline: 'Civil', name: 'facet ' }),
    ).rejects.toBeTruthy();
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        'Could not save firm — "Facet" is already in the directory for Civil.',
        'error',
      ),
    );
    expect(expectedUniqueRefusal(dup)).not.toBeNull();
    expect(shouldSkipBackendRpcLog(dup, ['x'])).toBe(true);
  });

  it('★ the write census carries the function name', () => {
    const src = readFileSync(resolve(__dirname, '../hooks/useExternalTeamDirectory.ts'), 'utf8');
    expect(src).toContain("meta: { write: 'bp_upsert_external_firm' }");
    expect(src).not.toMatch(/\.from\('external_team_directory'\)\s*\.(update|insert)/);
  });
});

describe('fix-666 §A — the migration', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../migrations/fix_666_external_firm_upsert.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('★★★ SECURITY DEFINER, pinned search_path, anon cannot execute', () => {
    expect(sql).toMatch(/SECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bp_upsert_external_firm\([^)]*\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_upsert_external_firm\([^)]*\) TO authenticated, service_role;/);
  });

  it('★★★ the refusals, in order: signed out, admin, stale (before any write), duplicate', () => {
    const signedOut = sql.indexOf('if auth.uid() is null then');
    const admin = sql.indexOf('if not public.is_tenant_admin(v_tenant) then');
    const stale = sql.indexOf("using errcode = '40001'");
    const dup = sql.indexOf("using errcode = '23505'");
    const firstWrite = sql.indexOf('insert into public.external_team_directory');
    for (const i of [signedOut, admin, stale, dup, firstWrite]) expect(i).toBeGreaterThan(0);
    expect(signedOut).toBeLessThan(admin);
    expect(admin).toBeLessThan(stale);
    expect(stale).toBeLessThan(dup);
    expect(dup).toBeLessThan(firstWrite);
  });

  it('★★ a missing token on an update is refused too, not waved through', () => {
    expect(sql).toContain('(p_expected_updated_at is null\n          or v_cur.updated_at is distinct from p_expected_updated_at)');
  });

  it('★★ the duplicate rule ignores case and ALL spaces, and names the index for the client', () => {
    expect(sql).toContain("lower(regexp_replace(d.name, '\\s+', '', 'g'))");
    expect(sql).toContain("lower(btrim(d.discipline)) = lower(v_disc)");
    expect(sql).toContain("detail = 'uq_external_team_directory_tenant_disc_name'");
  });

  it('★★ the tenant is decided server-side and the house triggers give the token and the audit row', () => {
    expect(sql).toContain('v_tenant := v_tenants[1];');
    expect(sql).toContain('v_tenant := v_cur.tenant_id;');
    expect(sql).toContain('EXECUTE FUNCTION public.bp_set_updated_at()');
    expect(sql).toContain('EXECUTE FUNCTION public.bp_audit_row()');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()');
  });
});
