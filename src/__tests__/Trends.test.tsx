import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// fix-25-feat-V: Trends page KPI tile + table column for submission →
// intake variance. Mocks the data hooks so the assertions can pin
// specific values without a live DB.

function mkCycle(
  over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  return {
    id: `c-${over.cycle_index}-${Math.random()}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function mkPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'is',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
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
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    ...over,
  };
}

// Approval dates land inside the default 12-month window ending today
// (system clock). Tests use 2026-05-* / 2026-06-* which the system
// reminder confirms is "today" relative to the harness fixture.
const PERMITS: PermitWithCycles[] = [
  // Seattle BP — submitted 2026-05-01, intake 2026-05-06 → +5d variance.
  mkPermit({
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    approval_date: '2026-05-30',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-06',
      }),
    ],
  }),
  // Seattle BP — submitted 2026-05-01, intake 2026-05-11 → +10d variance.
  mkPermit({
    id: 2,
    project_id: 'p2',
    type: 'Building Permit',
    approval_date: '2026-06-15',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-11',
      }),
    ],
  }),
  // Seattle Demo — c0.intake_accepted NULL → excluded from variance.
  mkPermit({
    id: 3,
    project_id: 'p3',
    type: 'Demolition',
    approval_date: '2026-05-20',
    permit_cycles: [
      mkCycle({
        cycle_index: 0,
        submitted: '2026-05-01',
        intake_accepted: null,
      }),
    ],
  }),
];

const PROJECTS: Project[] = [
  mkProject({ id: 'p1', juris: 'Seattle' }),
  mkProject({ id: 'p2', juris: 'Seattle' }),
  mkProject({ id: 'p3', juris: 'Seattle' }),
];

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: PERMITS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: PROJECTS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import Trends from '../pages/Trends';

function renderTrends() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/trends?from=2025-01-01&to=2027-12-31']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Trends />, { wrapper });
}

beforeEach(() => {
  // Date-range default uses `new Date()` — tests above hardcode a wide
  // explicit range via search params so the system clock doesn't affect
  // which rows fall in window.
});

describe('Trends — fix-25-feat-V submit→intake surface', () => {
  it('renders the new Avg submit → intake delay KPI tile with weighted avg + n', () => {
    renderTrends();
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    // Two BPs: +5 and +10 days → avg 7.5 → rounded 8. n=2.
    expect(tile.textContent).toMatch(/8d/);
    expect(tile.textContent).toMatch(/2 samples/);
  });

  it('KPI tile carries the interpretation tooltip on its container', () => {
    renderTrends();
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    const title = tile.getAttribute('title') ?? '';
    expect(title).toMatch(/team submission/i);
    expect(title).toMatch(/city intake/i);
  });

  it('renders the new Submit→Intake column header alongside the existing 7', () => {
    renderTrends();
    const table = screen.getByTestId('trends-breakdown-table');
    expect(table.textContent).toMatch(/Submit→Intake/);
  });

  it('per-cohort cell shows the variance number for BPs (7d weighted) and — for Demos (no samples)', () => {
    renderTrends();
    const bpRow = screen.getByTestId('trends-row-Seattle-Building Permit');
    // Variance helper's per-cohort avg = round((5 + 10) / 2) = 8 (mean)
    // Wait: the helper averages WITHIN a cohort. Both BPs are Seattle
    // BP → one cohort with deltas [5, 10] → avg 7.5 → rounds to 8.
    expect(bpRow.textContent).toMatch(/8d/);
    const demoRow = screen.getByTestId('trends-row-Seattle-Demolition');
    // Demo had no intake → variance helper produced no row for this
    // cohort → column renders "—".
    const demoCells = demoRow.querySelectorAll('td');
    // Column order: juris | type | n | clock | cycles | city/cyc |
    // team/cyc | submit→intake | target hit → index 7 is the variance.
    expect(demoCells[7].textContent).toBe('—');
  });

  it('sorting by Submit→Intake column works (click header toggles direction)', () => {
    renderTrends();
    // Add a second BP cohort with low variance by mutating? Easier:
    // assert clicking the header changes active state via testid
    // attribute on the th. The sort logic itself is covered by
    // perfTrends helper tests; here we verify the wiring fires.
    const header = Array.from(
      screen.getByTestId('trends-breakdown-table').querySelectorAll('th'),
    ).find((th) => th.textContent?.includes('Submit→Intake'));
    expect(header).toBeTruthy();
    fireEvent.click(header!);
    // After click, the header text gets a sort arrow appended.
    expect(header!.textContent).toMatch(/▼/);
    fireEvent.click(header!);
    expect(header!.textContent).toMatch(/▲/);
  });

  it('KPI tile shows "—" when no permits have both submitted + intake_accepted in window', () => {
    // Narrow the URL date range to a window with no qualifying permits.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/trends?from=2099-01-01&to=2099-12-31']}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
    render(<Trends />, { wrapper });
    const tile = screen.getByTestId('trends-kpi-submit-intake');
    expect(tile.textContent).toMatch(/—/);
  });
});
