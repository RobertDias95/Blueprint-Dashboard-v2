import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// fix-438 §C — Error Triage keeps BRIDGE errors
// ===========================================================================
//
// Bobby's ruling, 2026-08-29. Measured the same day: the panel was 173 open
// scraper warnings beside 6 open Bridge errors — 96% of it was not what it is
// for. And it MISREPRESENTED the biggest group: 89 occurrences over 89
// DISTINCT permits, once each, with the sample taken from the newest row so it
// named one permit. Bobby would have gone and investigated a permit that was
// never the problem.

const T = 'tenant-uuid';
const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('../lib/errorLogger', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import ErrorsPage from '../pages/Errors';
import { useErrorGroups, useNewErrorCount } from '../hooks/useErrorReports';
import { renderHook } from '@testing-library/react';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** The real prod shapes, 2026-08-29. */
const SPREAD = {
  fingerprint: 'f-spread',
  source: 'scraper',
  level: 'warning',
  sample_message: 'moduleName_parse_failed',
  sample_context: { permit_num: '3042952-LU' },
  status: 'new',
  first_seen: new Date(Date.now() - 600_000).toISOString(),
  last_seen: new Date(Date.now() - 60_000).toISOString(),
  count: 89,
  user_count: 0,
  permit_count: 89,
  resolved_count: 0,
  last_resolved_at: null,
  recurred: false,
  backlog_ref: null,
};

const CONCENTRATED = {
  ...SPREAD,
  fingerprint: 'f-few',
  sample_message: 'stuck in corrections, no upload',
  count: 25,
  permit_count: 3,
};

const BRIDGE = {
  ...SPREAD,
  fingerprint: 'f-bridge',
  source: 'backend_rpc',
  level: 'error',
  sample_message: 'Time block changed since you loaded it',
  count: 6,
  user_count: 2,
  // ★ A Bridge error names no permit, so the panel says nothing about permits.
  permit_count: 0,
};

beforeEach(() => {
  rpcMock.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-438 §C1/C3 — scraper rows are excluded, by both readers', () => {
  it('★★★ the LIST asks for Bridge errors only', async () => {
    rpcMock.mockResolvedValue({ data: [BRIDGE], error: null });
    renderHook(() => useErrorGroups(['new']), { wrapper });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const call = rpcMock.mock.calls.find((c) => c[0] === 'bp_list_error_groups');
    expect(call?.[1]).toMatchObject({ p_include_scraper: false });
  });

  it('★★★ …and so does the BADGE, with the same flag and the same default', async () => {
    // C3: a badge counting a different set from the page it opens is the
    // disagreement fix-432 spent a ticket removing.
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderHook(() => useNewErrorCount(), { wrapper });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const call = rpcMock.mock.calls.find((c) => c[0] === 'bp_new_error_count');
    expect(call?.[1]).toMatchObject({ p_include_scraper: false });
  });

  it('★★ the page no longer calls itself "the app + scraper"', async () => {
    rpcMock.mockResolvedValue({ data: [BRIDGE], error: null });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-bridge')).toBeInTheDocument(),
    );
    const page = screen.getByTestId('errors-page').textContent ?? '';
    expect(page).toContain('Errors the Bridge itself hit');
    expect(page).toContain('Permit conditions are not errors');
  });
});

describe('fix-438 §C2 — the group says how many PERMITS', () => {
  it('★★★ 89 occurrences over 89 permits reads "89 permits, once each"', async () => {
    rpcMock.mockResolvedValue({ data: [SPREAD], error: null });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-spread')).toBeInTheDocument(),
    );
    const counts = screen.getByTestId('error-group-counts-f-spread').textContent ?? '';
    expect(counts).toContain('89×');
    expect(screen.getByTestId('error-group-permits-f-spread').textContent).toContain(
      '89 permits, once each',
    );
  });

  it('★★★ 25 occurrences over 3 permits reads "3 permits" — the opposite meaning', async () => {
    rpcMock.mockResolvedValue({ data: [CONCENTRATED], error: null });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-few')).toBeInTheDocument(),
    );
    const permits = screen.getByTestId('error-group-permits-f-few').textContent ?? '';
    expect(permits).toContain('3 permits');
    expect(permits).not.toContain('once each');
  });

  it('★★ a Bridge error names no permits, so it says nothing about them', async () => {
    rpcMock.mockResolvedValue({ data: [BRIDGE], error: null });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-bridge')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('error-group-permits-f-bridge')).toBeNull();
  });

  it('★★ the expanded row says the sample is the FIRST occurrence, with the newest beside it', async () => {
    rpcMock.mockResolvedValue({ data: [SPREAD], error: null });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-spread')).toBeInTheDocument(),
    );
    screen.getByTestId('error-group-toggle-f-spread').click();
    await waitFor(() =>
      expect(screen.getByTestId('error-group-detail-f-spread')).toBeInTheDocument(),
    );
    const detail = screen.getByTestId('error-group-detail-f-spread').textContent ?? '';
    // ★ The newest row is simply whichever permit the scraper reached last —
    //   the least representative row there is. Saying which is which is the
    //   difference between a sample and a guess.
    expect(detail).toContain('sample is the first');
    expect(detail).toContain('newest');
  });

  it('★ one permit does not get pluralised', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...CONCENTRATED, fingerprint: 'f-one', count: 4, permit_count: 1 }],
      error: null,
    });
    render(<ErrorsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-one')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('error-group-permits-f-one').textContent).toContain(
      '1 permit',
    );
    expect(screen.getByTestId('error-group-permits-f-one').textContent).not.toContain(
      'permits',
    );
  });
});
