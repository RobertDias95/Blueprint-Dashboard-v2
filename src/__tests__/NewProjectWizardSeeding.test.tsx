import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-Phase-B: DOM wiring of the wizard's reactive seeding. Confirms the
// patch -> applySeeding path actually fills the Step 3 inputs and that the
// seeded values reach the create RPC payload. The seeding LOGIC (per-type
// rules, manual-not-overwritten, type change) is covered exhaustively in
// permitSeedingDefaults.test.ts + applySeeding.test.ts.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown; error: Error | null } = { data: [], error: null };
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
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
      { name: 'PAR/Pre-Sub', is_builtin: true, notes: null },
    ],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { id: '1', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({
    data: [
      {
        permit_type: 'Building Permit',
        projects_with_this_permit: 8,
        total_projects_in_juris: 8,
        usage_fraction: 1.0,
        usage_pct_display: 100,
      },
    ],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [], subtasks: [], byScope: new Map(),
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import NewProjectWizard from '../components/NewProjectWizard';

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<NewProjectWizard open onClose={vi.fn()} />, { wrapper });
}

/** fix-130: find a Step 3 permit row whose type-select value matches the
 *  given type. Replaces the pre-fix-130 getByText('Building Permit')
 *  lookup that broke when type became a <select> (every row's options
 *  now contain the same text). */
function findRowByType(type: string): HTMLElement {
  const selects = document.querySelectorAll<HTMLSelectElement>(
    'select[data-testid^="wizard-perm-type-"]',
  );
  for (const sel of Array.from(selects)) {
    if (sel.value === type) {
      const row = sel.closest('[data-testid^="wizard-perm-row-"]');
      if (row) return row as HTMLElement;
    }
  }
  throw new Error(`No permit row found with type="${type}"`);
}

/** Step 1: address + juris + GO date, then advance to Step 2. */
function fillStep1AndAdvance(go: string) {
  fireEvent.change(screen.getByTestId('wizard-address'), { target: { value: '1 Test St' } });
  fireEvent.change(screen.getByTestId('wizard-juris'), { target: { value: 'Seattle' } });
  fireEvent.change(screen.getByTestId('wizard-go-date'), { target: { value: go } });
  // fix-88: Units count is now required at the Step-1 gate.
  fireEvent.change(screen.getByTestId('wizard-units'), { target: { value: '2' } });
  fireEvent.click(screen.getByTestId('wizard-next'));
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  navigate.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
});

describe('NewProjectWizard auto-seeding (fix-Phase-B)', () => {
  it('GO date pre-fills GO-anchored seeds on a PAR row in Step 3', () => {
    renderWizard();
    fillStep1AndAdvance('2026-06-01');
    // Step 2: select PAR/Pre-Sub (lands in the "Other" bucket given the stats mock).
    fireEvent.click(screen.getByTestId('wizard-q-other-checkbox-PAR/Pre-Sub'));
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument();
    // PAR target_submit = GO + 3, expected_issue = GO + 30 — rendered in the inputs.
    expect(screen.getByDisplayValue('2026-06-04')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument();
  });

  it('setting the BP ACQ pre-fills a Demolition row (BP-anchored)', () => {
    renderWizard();
    fillStep1AndAdvance('2026-06-01');
    fireEvent.click(screen.getByTestId('wizard-q-other-checkbox-Demolition'));
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3

    // fix-130: type is now a <select> on every row, so getByText('Building
    // Permit') matches every row's option. Find the BP row by walking up
    // from the type-select whose VALUE is "Building Permit" instead.
    const bpRow = findRowByType('Building Permit');
    const bpAcqInput = bpRow.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(bpAcqInput, { target: { value: '2026-12-01' } });

    // Both the BP ACQ and the Demolition's seeded expected_issue now show it.
    expect(screen.getAllByDisplayValue('2026-12-01').length).toBeGreaterThanOrEqual(2);
  });

  // fix-130: Bobby's demonstration case — first BP has ACQ filled,
  // user clicks + Add permit, picks Building Permit on the new row →
  // the new row's ACQ inherits the existing BP's value rather than
  // staying blank.
  it('fix-130: adding a second BP inherits the first BPs ACQ Target Date', () => {
    renderWizard();
    fillStep1AndAdvance('2026-06-01');
    // Skip Step 2; advance to Step 3 with the auto-injected BP.
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Set the existing BP's ACQ to 2026-11-30 (Bobby's example date).
    const bpRow = findRowByType('Building Permit');
    const bpAcqInput = bpRow.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(bpAcqInput, { target: { value: '2026-11-30' } });
    expect(bpAcqInput.value).toBe('2026-11-30');

    // Click + Add permit, then pick "Building Permit" on the new row.
    fireEvent.click(screen.getByTestId('wizard-step-3-add-permit'));
    const newTypeSelects = document.querySelectorAll<HTMLSelectElement>(
      'select[data-testid^="wizard-perm-type-"]',
    );
    // The just-added row's type select has value=''. Find it + pick BP.
    const newRowSelect = Array.from(newTypeSelects).find((s) => s.value === '');
    expect(newRowSelect).toBeTruthy();
    fireEvent.change(newRowSelect!, { target: { value: 'Building Permit' } });

    // After the type pick, applySeeding's sibling-inheritance runs:
    // the new BP row inherits expected_issue=2026-11-30 from the first BP.
    // Two BP rows total → both ACQ inputs read 2026-11-30.
    const allAcqInputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="date"][data-testid^="wizard-perm-target-"]',
    );
    const bpAcqValues = Array.from(allAcqInputs).map((i) => i.value);
    const matchingCount = bpAcqValues.filter((v) => v === '2026-11-30').length;
    expect(matchingCount).toBeGreaterThanOrEqual(2);
  });

  it('a manually-edited field is not overwritten when GO date changes', () => {
    renderWizard();
    fillStep1AndAdvance('2026-06-01');
    fireEvent.click(screen.getByTestId('wizard-q-other-checkbox-PAR/Pre-Sub'));
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3

    // PAR row: override expected_issue manually (was seeded to 2026-07-01).
    // fix-130: row lookup via selected type-select value (multiple "PAR/Pre-Sub"
    // texts exist now — one per row's dropdown options).
    const parRow = findRowByType('PAR/Pre-Sub');
    const parAcqInput = parRow.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(parAcqInput, { target: { value: '2026-09-09' } });
    expect(screen.getByDisplayValue('2026-09-09')).toBeInTheDocument();

    // Go back to Step 1 and change the GO date.
    fireEvent.click(screen.getByTestId('wizard-step-tab-1'));
    fireEvent.change(screen.getByTestId('wizard-go-date'), { target: { value: '2027-01-01' } });
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 2
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3

    // The manual value survives; it was NOT re-seeded to 2027-01-31.
    expect(screen.getByDisplayValue('2026-09-09')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('2027-01-31')).toBeNull();
  });

  it('save payload carries the seeded values verbatim', async () => {
    mocks.setResult({
      data: [{ project_id: 'proj-1', permit_ids: [1, 2], conflict: false }],
      error: null,
    });
    renderWizard();
    fillStep1AndAdvance('2026-06-01');
    fireEvent.click(screen.getByTestId('wizard-q-other-checkbox-PAR/Pre-Sub'));
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 3
    fireEvent.click(screen.getByTestId('wizard-next')); // -> Step 4
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => expect(mocks.rpcFn).toHaveBeenCalledTimes(1));
    const [, args] = mocks.rpcFn.mock.calls[0];
    const permits = args.p_permits as Array<{
      type: string;
      expected_issue?: string;
      target_submit?: string;
    }>;
    const par = permits.find((p) => p.type === 'PAR/Pre-Sub')!;
    expect(par.expected_issue).toBe('2026-07-01'); // GO + 30
    expect(par.target_submit).toBe('2026-06-04'); // GO + 3
  });
});
