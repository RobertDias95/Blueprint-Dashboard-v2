// ===========================================================================
// fix-673 §4 (P-353) — the blocker reaches the server and Settings shows it
// ===========================================================================
//
// AutoReloadEdgesFix673 proves the component DECIDES to record. This file
// proves the rest of the path: the RPC's argument shape (and that a plain
// heartbeat never carries the new key), the hook's mapping, the Settings
// column, and the migration. Plus the fix-671 rider: the CSV file name.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: null, error: null })));
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

const listClientBuilds = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useClientBuilds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useClientBuilds')>();
  return { ...actual, useClientBuilds: () => listClientBuilds() };
});

import { useAuthStore } from '../stores/authStore';
import { recordClientBuild, __resetClientBuildHeartbeat } from '../lib/clientBuild';
import { mapClientBuildRow } from '../hooks/useClientBuilds';
import ClientBuildsPanel from '../components/Settings/ClientBuildsPanel';
import { AUTO_RELOAD_BLOCKER_LABEL, autoReloadBlockerLabel } from '../lib/autoReload';
import { exportEnrichedPermitsToCSV } from '../lib/csvExport';

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

beforeEach(() => {
  rpc.mockClear();
  __resetClientBuildHeartbeat();
  useAuthStore.setState({
    user: { id: 'u-1' },
    activeTenantId: 't-1',
    memberships: [{ tenant_id: 't-1', role: 'admin' }],
  } as never);
});
afterEach(() => cleanup());

const argsOf = (i: number) => (rpc.mock.calls[i] as unknown[])[1] as Record<string, unknown>;

describe('fix-673 §4 — what the heartbeat RPC is sent', () => {
  it('★★★ a blocked event carries its reason', async () => {
    await recordClientBuild('auto_reload_blocked', Date.now(), 'active-is-input');
    expect(rpc).toHaveBeenCalledWith(
      'bp_record_client_build',
      expect.objectContaining({
        p_notice_event: 'auto_reload_blocked',
        p_blocked_reason: 'active-is-input',
      }),
    );
  });

  it('★★★ a plain heartbeat and every other event do NOT carry the new key', async () => {
    // PostgREST matches by argument NAMES: before the migration is applied an
    // unknown key would match no function and every heartbeat would fail.
    await recordClientBuild();
    await recordClientBuild('shown');
    await recordClientBuild('auto_reloaded');
    for (let i = 0; i < rpc.mock.calls.length; i++) {
      expect('p_blocked_reason' in argsOf(i)).toBe(false);
    }
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe('fix-673 §4 — Settings → client builds says why', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const row = (over: Record<string, unknown> = {}) =>
    mapClientBuildRow({
      out_user_id: 'u-bobby',
      out_email: 'b@example.com',
      out_name: 'Bobby',
      out_build: 'ee7ec6a',
      out_built_at: new Date().toISOString(),
      out_display_mode: 'standalone',
      out_first_seen_at: new Date().toISOString(),
      out_last_seen_at: new Date().toISOString(),
      out_notice_shown_count: 1,
      out_notice_first_shown_at: new Date().toISOString(),
      out_notice_dismissed_at: null,
      out_notice_reloaded_at: null,
      out_notice_auto_reloaded_at: null,
      ...over,
    });

  it('★★★ the latest blocker is printed in words, next to the person', () => {
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: {
        kind: 'ready',
        rows: [
          row({
            out_auto_reload_blocked_reason: 'active-is-input',
            out_auto_reload_blocked_at: '2026-10-14T12:00:00Z',
          }),
        ],
      },
    });
    render(<ClientBuildsPanel />, { wrapper });
    const cell = screen.getByTestId('client-build-blocked-u-bobby');
    expect(cell.textContent).toContain('text in a focused field');
    expect(cell.textContent).toContain('·');
  });

  it('★★ an older server without the columns maps to null and prints a dash', () => {
    const r = row();
    expect(r.auto_reload_blocked_reason).toBeNull();
    expect(r.auto_reload_blocked_at).toBeNull();
    listClientBuilds.mockReturnValue({ isLoading: false, data: { kind: 'ready', rows: [r] } });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-build-blocked-u-bobby').textContent).toBe('—');
  });

  it('★ every recordable blocker has words; an unknown one prints as stored', () => {
    expect(Object.keys(AUTO_RELOAD_BLOCKER_LABEL).sort()).toEqual(
      ['active-is-input', 'already-tried', 'dirty', 'mutating', 'not-away-long-enough'],
    );
    expect(autoReloadBlockerLabel('something-new')).toBe('something-new');
  });
});

describe('fix-673 — the migration', () => {
  const sql = read('migrations/fix_673_auto_reload_blocked_reason.sql');
  const code = sql.replace(/^\s*--.*$/gm, '');

  it('★★★ adds two NULLABLE columns with no default — no existing row changes', () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS auto_reload_blocked_reason text,/);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS auto_reload_blocked_at timestamptz;/);
    expect(code).not.toMatch(/auto_reload_blocked_\w+ \w+ (NOT NULL|DEFAULT)/i);
    expect(code).not.toMatch(/^\s*UPDATE\b/im);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('★★★ drops before re-creating, so there is never an overload, and anon never gets it', () => {
    expect(code).toContain(
      'DROP FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text);',
    );
    expect(code).toContain('DROP FUNCTION public.bp_list_client_builds();');
    expect(code).toContain("p_blocked_reason text DEFAULT NULL::text");
    expect(code.match(/FROM PUBLIC, anon;/g)).toHaveLength(2);
    expect(code).not.toMatch(/TO[^;]*\banon\b/);
  });

  it('★★ the recorded reasons are exactly the blockers the client can send', () => {
    for (const reason of Object.keys(AUTO_RELOAD_BLOCKER_LABEL)) {
      expect(code).toContain(`'${reason}'`);
    }
    expect(code).not.toMatch(/'no-new-build'/);
  });
});

describe('fix-673 rider — the CSV export file name', () => {
  it('★★ the default name says permitting, not entitlements', () => {
    const orig = { c: URL.createObjectURL, r: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    try {
      const { filename } = exportEnrichedPermitsToCSV([]);
      expect(filename).toMatch(/^blueprint_permitting_\d{4}-\d{2}-\d{2}\.csv$/);
    } finally {
      URL.createObjectURL = orig.c;
      URL.revokeObjectURL = orig.r;
    }
  });
});
