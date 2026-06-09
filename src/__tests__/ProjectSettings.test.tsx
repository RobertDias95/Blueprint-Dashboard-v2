import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { WAITING_ON_OPTIONS } from '../lib/database.types';

const T = 'test-tenant-uuid';
const PROJ = 'proj-1';

// fix-139: Project Settings → External Team panel. Renders one row per
// WAITING_ON_OPTIONS discipline; each row's dropdown is filtered to that
// discipline's active firms. Mocks supabase.rpc: list returns a small firms
// catalog, get returns one existing assignment (Civil → Prism), and upsert is
// spied so we can assert the assign / clear wire-shape.

const FIRMS = [
  { id: 'firm-civil-1', tenant_id: T, name: 'Prism', discipline: 'Civil', active: true, notes: null, created_at: '', updated_at: '' },
  { id: 'firm-civil-2', tenant_id: T, name: 'Atwell', discipline: 'Civil', active: true, notes: null, created_at: '', updated_at: '' },
  { id: 'firm-str-1', tenant_id: T, name: 'SSS', discipline: 'Structural', active: true, notes: null, created_at: '', updated_at: '' },
];
const ASSIGNMENTS = [
  { project_id: PROJ, discipline: 'Civil', firm_id: 'firm-civil-1', firm_name: 'Prism', tenant_id: T, updated_at: '' },
];

const rpcSpy = vi.hoisted(() => vi.fn());
const FIRMS_REF = vi.hoisted(() => ({ rows: [] as unknown[] }));
const ASSIGN_REF = vi.hoisted(() => ({ rows: [] as unknown[] }));
const builder = vi.hoisted(() => ({
  rpc: (name: string, args: Record<string, unknown>) => {
    rpcSpy(name, args);
    if (name === 'bp_list_consultant_firms')
      return Promise.resolve({ data: FIRMS_REF.rows, error: null });
    if (name === 'bp_get_project_external_team')
      return Promise.resolve({ data: ASSIGN_REF.rows, error: null });
    return Promise.resolve({ data: [], error: null });
  },
}));

vi.mock('../lib/supabase', () => ({ supabase: builder }));

import ProjectExternalTeamPanel from '../components/ProjectDetail/ProjectExternalTeamPanel';

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ProjectExternalTeamPanel projectId={PROJ} />, { wrapper });
}

beforeEach(() => {
  rpcSpy.mockClear();
  FIRMS_REF.rows = FIRMS;
  ASSIGN_REF.rows = ASSIGNMENTS;
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Settings → External Team', () => {
  it('renders one row per WAITING_ON_OPTIONS discipline (13 rows)', () => {
    renderPanel();
    expect(
      screen.getByTestId('project-external-team-section'),
    ).toBeInTheDocument();
    for (const d of WAITING_ON_OPTIONS) {
      expect(
        screen.getByTestId(`project-external-team-row-${d}`),
      ).toBeInTheDocument();
    }
    expect(WAITING_ON_OPTIONS.length).toBe(13);
  });

  it('the Civil dropdown only lists Civil firms (not Structural)', async () => {
    renderPanel();
    const civil = screen.getByTestId(
      'project-external-team-firm-select-Civil',
    );
    await waitFor(() =>
      expect(within(civil).getByText('Prism')).toBeInTheDocument(),
    );
    expect(within(civil).getByText('Atwell')).toBeInTheDocument();
    expect(within(civil).queryByText('SSS')).toBeNull();
    // Structural dropdown has SSS but not the Civil firms.
    const structural = screen.getByTestId(
      'project-external-team-firm-select-Structural',
    );
    expect(within(structural).getByText('SSS')).toBeInTheDocument();
    expect(within(structural).queryByText('Prism')).toBeNull();
  });

  it('selecting a firm fires the upsert RPC with firm_id set', async () => {
    renderPanel();
    const civil = screen.getByTestId(
      'project-external-team-firm-select-Civil',
    );
    await waitFor(() =>
      expect(within(civil).getByText('Atwell')).toBeInTheDocument(),
    );
    fireEvent.change(civil, { target: { value: 'firm-civil-2' } });
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'bp_upsert_project_external_team_member',
        { p_project_id: PROJ, p_discipline: 'Civil', p_firm_id: 'firm-civil-2' },
      ),
    );
  });

  it('Clear fires the upsert RPC with firm_id null (DELETE path)', async () => {
    renderPanel();
    // Civil has an existing assignment (Prism) → clear button renders.
    const clearBtn = await screen.findByTestId(
      'project-external-team-clear-Civil',
    );
    fireEvent.click(clearBtn);
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'bp_upsert_project_external_team_member',
        { p_project_id: PROJ, p_discipline: 'Civil', p_firm_id: null },
      ),
    );
  });

  it('disables the dropdown + shows helper text for a discipline with no firms', async () => {
    renderPanel();
    // 'Energy' has no firms in the catalog.
    const select = screen.getByTestId(
      'project-external-team-firm-select-Energy',
    ) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeDisabled());
    expect(
      screen.getByTestId('project-external-team-empty-Energy').textContent,
    ).toMatch(/Add a Energy firm in Settings/i);
  });
});
