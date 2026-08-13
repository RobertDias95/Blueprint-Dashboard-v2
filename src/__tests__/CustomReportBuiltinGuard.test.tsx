import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { SavedReportDetail } from '../lib/database.types';

// fix-282: the /reports/custom/:id route, which is where the doomed RPC was
// actually fired from.
//
// ★ These tests use the REAL hooks against a mocked supabase client, on purpose.
// The whole fix is a react-query `enabled` gate, and a test that mocks the hook
// mocks away the thing being tested. Here, bp_run_saved_report is only ever
// called if the gate genuinely opens.
//
// The route is reachable by bookmark, browser Back and hand-typed URL, so
// fixing the hub's Run button is not on its own sufficient.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  detail: null as unknown,
  calls: [] as string[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string) => {
      state.calls.push(fn);
      if (fn === 'bp_get_saved_report') {
        return Promise.resolve({ data: state.detail, error: null });
      }
      if (fn === 'bp_get_report_builder_catalog') {
        return Promise.resolve({
          data: { version: 1, entities: [] },
          error: null,
        });
      }
      if (fn === 'bp_run_saved_report') {
        // What production actually returns for a builtin row: its spec is {},
        // so the RPC raises before it can select anything.
        return Promise.resolve({
          data: null,
          error: { message: 'spec.entity is required' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

import CustomReport from '../pages/CustomReport';
import { settle } from '../test/settle';

const BASE: SavedReportDetail = {
  id: 'c3baa3d3-b400-4833-852d-ada190b186da',
  category_id: null,
  name: 'Corrections',
  description: '',
  kind: 'builtin',
  builtin_key: 'corrections',
  position: 0,
  // ★ Empty, and CORRECT. Every builtin row in production looks like this.
  spec: { version: 1, entity: '', columns: [], filters: [], sort: [], limit: 0 },
};

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <MemoryRouter initialEntries={[`/reports/custom/${BASE.id}`]}>
      <Routes>
        <Route path="/reports/custom/:id" element={<CustomReport />} />
        <Route
          path="/reports/corrections"
          element={<div data-testid="corrections-page">Corrections report</div>}
        />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

const ranTheReport = () => state.calls.includes('bp_run_saved_report');

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.calls = [];
});

describe('fix-282 an UNKNOWN builtin never fires the RPC', () => {
  beforeEach(() => {
    state.detail = { ...BASE, builtin_key: 'corrections_next' };
  });

  it('★ bp_run_saved_report is NEVER called', async () => {
    renderRoute();
    await screen.findByTestId('custom-report-unknown-builtin');
    expect(ranTheReport()).toBe(false);
    // fix-300b: drain everything react-query has queued, then confirm it did
    // not take the chance to run the report. No duration is guessed.
    await settle();
    expect(ranTheReport()).toBe(false);
    // The detail lookup DID happen — that is how we knew to stop.
    expect(state.calls).toContain('bp_get_saved_report');
  });

  it('explains itself and names the key', async () => {
    renderRoute();
    const panel = await screen.findByTestId('custom-report-unknown-builtin');
    expect(panel).toHaveTextContent('corrections_next');
    expect(panel.textContent?.toLowerCase()).toContain('refresh');
  });

  it('shows no "Report failed to run" error, because nothing was run', async () => {
    renderRoute();
    await screen.findByTestId('custom-report-unknown-builtin');
    expect(screen.queryByText(/failed to run/i)).toBeNull();
    expect(screen.queryByText(/spec\.entity is required/i)).toBeNull();
  });
});

describe('fix-282 a KNOWN builtin is redirected, not run', () => {
  beforeEach(() => {
    state.detail = { ...BASE, builtin_key: 'corrections' };
  });

  it('lands on the builtin route', async () => {
    renderRoute();
    await screen.findByTestId('corrections-page');
  });

  it('★ still never calls bp_run_saved_report', async () => {
    renderRoute();
    await screen.findByTestId('corrections-page');
    await settle();
    expect(ranTheReport()).toBe(false);
  });
});

describe('fix-282 a genuine CUSTOM report is unaffected', () => {
  beforeEach(() => {
    state.detail = {
      ...BASE,
      kind: 'custom',
      builtin_key: null,
      name: 'My Custom Report',
      spec: {
        version: 1,
        entity: 'permits',
        columns: ['num'],
        filters: [],
        sort: [],
        limit: 1000,
      },
    };
  });

  it('DOES call bp_run_saved_report — the gate must not over-close', async () => {
    renderRoute();
    await waitFor(() => expect(ranTheReport()).toBe(true));
  });

  it('renders the viewer, not the stale-bundle message', async () => {
    renderRoute();
    await waitFor(() => expect(ranTheReport()).toBe(true));
    expect(screen.queryByTestId('custom-report-unknown-builtin')).toBeNull();
  });
});
