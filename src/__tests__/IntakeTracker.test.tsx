import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q6.3.b: smoke tests for IntakeTracker. Fixed today date (2026-05-11) so
// past/future/urgency boundaries are deterministic. Mocks useIntakeRecords
// + usePermits to render synchronously.

const T = 'test-tenant-uuid';
const FIXED_TODAY = new Date(2026, 4, 11); // 2026-05-11 Monday

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const fixtures = vi.hoisted(() => ({
  intakes: [
    {
      // Past (last week, within 10 business days).
      id: 1,
      project_id: null,
      permit_id: 100,
      address: '100 Past Way',
      permit_num: 'BP-100',
      permit_type: 'Building Permit',
      intake_date: '2026-05-08',
      is_placeholder: false,
      portal_url: null,
      link: null,
      created_at: null,
      updated_at: '2026-05-08T12:00:00Z',
    },
    {
      // Future this week — within urgency window, NOT submitted → Reschedule.
      id: 2,
      project_id: null,
      permit_id: 200,
      address: '200 Urgent Ln',
      permit_num: 'BP-200',
      permit_type: 'Building Permit',
      intake_date: '2026-05-13',
      is_placeholder: false,
      portal_url: 'https://city.example/200',
      link: null,
      created_at: null,
      updated_at: '2026-05-11T12:00:00Z',
    },
    {
      // Future this week — linked permit has cycle 1 submitted → Submitted.
      id: 3,
      project_id: null,
      permit_id: 300,
      address: '300 Done St',
      permit_num: 'BP-300',
      permit_type: 'Demolition',
      intake_date: '2026-05-14',
      is_placeholder: false,
      portal_url: null,
      link: null,
      created_at: null,
      updated_at: '2026-05-11T12:00:00Z',
    },
    {
      // Future next month — placeholder, no permit linked.
      id: 4,
      project_id: null,
      permit_id: null,
      address: '400 Holder Pl',
      permit_num: 'BP-400',
      permit_type: 'Building Permit',
      intake_date: '2026-06-15',
      is_placeholder: true,
      portal_url: null,
      link: null,
      created_at: null,
      updated_at: '2026-05-11T12:00:00Z',
    },
    {
      // Far past — outside 10 business days, excluded from both partitions.
      id: 5,
      project_id: null,
      permit_id: null,
      address: '500 Way Back Rd',
      permit_num: 'BP-500',
      permit_type: 'Building Permit',
      intake_date: '2026-03-01',
      is_placeholder: false,
      portal_url: null,
      link: null,
      created_at: null,
      updated_at: '2026-03-01T12:00:00Z',
    },
  ],
  permits: [
    {
      // Linked to intake 3 — has a submitted cycle → Submitted badge.
      id: 300,
      project_id: 'p3',
      type: 'Demolition',
      stage: 'pm',
      stage_override: null,
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: null,
      product_type: null,
      project_tags: null,
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-09T00:00:00Z',
      permit_cycles: [
        {
          id: 'cycle-300-1',
          permit_id: 300,
          cycle_index: 1,
          submitted: '2026-05-09',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-09T00:00:00Z',
        },
      ],
    },
    {
      // Linked to intake 2 — no cycles submitted → permits NOT submitted.
      id: 200,
      project_id: 'p2',
      type: 'Building Permit',
      stage: 'de',
      stage_override: null,
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: null,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: null,
      product_type: null,
      project_tags: null,
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-09T00:00:00Z',
      permit_cycles: [],
    },
  ],
}));

vi.mock('../hooks/useIntakeRecords', () => ({
  useIntakeRecords: () => ({
    data: fixtures.intakes,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import IntakeTracker from '../components/IntakeTracker';

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntakeTracker />
    </QueryClientProvider>,
  );
}

describe('<IntakeTracker />', () => {
  it('renders future rows split into weeks; past intake is hidden inside <details>', () => {
    renderIt();
    // Future rows (intakes 2, 3, 4) visible.
    expect(screen.getByTestId('intake-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('intake-row-3')).toBeInTheDocument();
    expect(screen.getByTestId('intake-row-4')).toBeInTheDocument();
    // Past intake (id 1) is inside the <details> but still in the DOM.
    expect(screen.getByTestId('intake-row-1')).toBeInTheDocument();
    // Far-past intake (id 5) is excluded entirely.
    expect(screen.queryByTestId('intake-row-5')).not.toBeInTheDocument();
    // Past <details> is rendered.
    expect(screen.getByTestId('intake-past-details')).toBeInTheDocument();
  });

  it('status badges reflect the 4-state decision tree', () => {
    renderIt();
    // Intake 2: urgent window + no submission → Reschedule.
    expect(screen.getByTestId('intake-status-2').textContent).toMatch(/Reschedule/);
    // Intake 3: linked permit has cycle 1 submitted → Submitted.
    expect(screen.getByTestId('intake-status-3').textContent).toMatch(/Submitted/);
    // Intake 4: placeholder, no permit, outside urgency → Placeholder.
    expect(screen.getByTestId('intake-status-4').textContent).toMatch(/Placeholder/);
    // Intake 1: past — Real Project (linked permit_id 100 has no fixture, treated as not submitted, not urgent, not placeholder).
    expect(screen.getByTestId('intake-status-1').textContent).toMatch(/Real Project/);
  });

  it('renders the 8-week count strip with at least the current-quarter weeks', () => {
    renderIt();
    const strip = screen.getByTestId('intake-week-count-strip');
    expect(strip).toBeInTheDocument();
    // Two future rows fall in 2026-05-11 (intakes 2 + 3); one in 2026-06-15.
    expect(screen.getByTestId('week-count-2026-05-11')).toBeInTheDocument();
    expect(screen.getByTestId('week-count-2026-06-15')).toBeInTheDocument();
    // Count for May 11 week = 2 (rows 2 + 3).
    const may11 = screen.getByTestId('week-count-2026-05-11');
    expect(within(may11).getByText('2')).toBeInTheDocument();
  });

  it('week with an urgent row gets the "Action needed" header signal', () => {
    renderIt();
    // 2026-05-11 week has intake 2 (urgent + not submitted) → Action needed.
    // 2026-06-15 week has only the placeholder (not urgent) → no signal.
    expect(screen.getByTestId('week-action-needed-2026-05-11')).toBeInTheDocument();
    expect(screen.queryByTestId('week-action-needed-2026-06-15')).not.toBeInTheDocument();
  });

  it('renders portal_url as a clickable permit# link when set', () => {
    renderIt();
    const link = screen.getByTestId('intake-portal-link-2');
    expect(link.getAttribute('href')).toBe('https://city.example/200');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toMatch(/BP-200/);
    // Intake 3 has no portal_url → not a link.
    expect(screen.queryByTestId('intake-portal-link-3')).not.toBeInTheDocument();
  });

  it('address search narrows visible rows + week strip + past', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('intake-search'), {
      target: { value: 'urgent' },
    });
    // Only intake 2 matches "urgent".
    expect(screen.getByTestId('intake-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('intake-row-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('intake-row-4')).not.toBeInTheDocument();
    // Past <details> shouldn't appear when its content is filtered out.
    expect(screen.queryByTestId('intake-past-details')).not.toBeInTheDocument();
  });

  it('shows the empty state when search excludes everything', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('intake-search'), {
      target: { value: 'no-match-anywhere' },
    });
    expect(screen.getByTestId('intake-empty')).toBeInTheDocument();
    expect(screen.getByText(/No intakes match the current search/i)).toBeInTheDocument();
  });
});
