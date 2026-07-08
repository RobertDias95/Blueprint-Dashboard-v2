import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// fix-221: the "Approved – Awaiting Issuance" builtin report page.

const permitsData = vi.hoisted(() => ({ current: [] as unknown[] }));
const projectsData = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: permitsData.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: projectsData.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import ApprovedAwaitingIssuanceReport from '../pages/ApprovedAwaitingIssuanceReport';

function permit(over: Record<string, unknown>) {
  return {
    id: 0,
    project_id: 'p1',
    type: 'Building Permit',
    num: null,
    da: null,
    status: null,
    approval_date: null,
    actual_issue: null,
    parent_permit_id: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ApprovedAwaitingIssuanceReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
  projectsData.current = [
    { id: 'p1', address: '500 Pike St', juris: 'Seattle' },
    { id: 'p2', address: '750 Oak Way', juris: 'Bellevue' },
  ];
  permitsData.current = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<ApprovedAwaitingIssuanceReport /> (fix-221)', () => {
  it('lists approved-not-issued permits with days-since-approval, longest-waiting first, deep-linking each', () => {
    permitsData.current = [
      permit({ id: 1, project_id: 'p1', type: 'Demolition', num: 'D-1', da: 'Trevor', approval_date: '2026-06-30', status: 'Ready for Issuance' }), // 7d
      permit({ id: 2, project_id: 'p2', approval_date: '2026-05-08', status: 'Awaiting Information' }), // 60d
      // excluded: actually issued
      permit({ id: 3, project_id: 'p1', approval_date: '2026-05-01', actual_issue: '2026-05-20' }),
      // excluded: sub-permit
      permit({ id: 4, project_id: 'p2', approval_date: '2026-06-01', parent_permit_id: 1 }),
    ];
    renderPage();

    expect(screen.getByTestId('aai-count').textContent).toMatch(/2 permits awaiting issuance/);
    // Longest-waiting first: permit 2 (60d) then permit 1 (7d).
    const rows = screen.getAllByTestId(/^aai-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['aai-row-2', 'aai-row-1']);
    // days-since-approval as of the pinned today.
    expect(screen.getByTestId('aai-days-2').textContent).toBe('60d');
    expect(screen.getByTestId('aai-days-1').textContent).toBe('7d');
    // Deep-links (fix-219) to the permit in Project View.
    expect(screen.getByTestId('aai-link-1')).toHaveAttribute('href', '/project/p1?permit=1');
    expect(screen.getByTestId('aai-link-2')).toHaveAttribute('href', '/project/p2?permit=2');
    // Excluded permits absent.
    expect(screen.queryByTestId('aai-row-3')).toBeNull();
    expect(screen.queryByTestId('aai-row-4')).toBeNull();
  });

  it('shows the empty state when nothing is awaiting issuance', () => {
    permitsData.current = [
      permit({ id: 1, project_id: 'p1', actual_issue: '2026-05-01' }),
      permit({ id: 2, project_id: 'p2', status: 'Reviews In Process' }),
    ];
    renderPage();
    expect(screen.getByTestId('aai-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('aai-count')).toBeNull();
  });
});
