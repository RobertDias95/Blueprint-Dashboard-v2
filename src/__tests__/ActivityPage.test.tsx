import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ScraperActivityRow } from '../lib/database.types';

// fix-28: integration tests for the activity page. Mocks
// useScraperActivity so we drive the row set directly + isolate the
// store between tests.

function mkRow(over: Partial<ScraperActivityRow> = {}): ScraperActivityRow {
  return {
    id: 1,
    created_at: '2026-05-18T18:00:00Z',
    action: 'scrape_change_applied',
    row_id: '100',
    changes: { applied: { status: 'Issued' }, db: { status: 'Reviews In Process' } },
    permit_num: '7101215-DM',
    permit_type: 'Demolition',
    address: '3670 Interlake Ave N',
    juris: 'Seattle',
    cycle_index: null,
    ent_lead: 'Bobby',
    ...over,
  };
}

const ROWS: ScraperActivityRow[] = [
  mkRow({ id: 1, address: '3670 Interlake Ave N', ent_lead: 'Bobby' }),
  mkRow({
    id: 2,
    address: '3670 Interlake Ave N',
    permit_num: '7119456-DM',
    ent_lead: 'Bobby',
    created_at: '2026-05-18T17:00:00Z',
  }),
  mkRow({
    id: 3,
    address: '200 Oak Ave',
    permit_num: 'BP-200',
    permit_type: 'Building Permit',
    ent_lead: 'Briana',
    created_at: '2026-05-18T16:00:00Z',
  }),
  mkRow({
    id: 4,
    address: '500 Pike St',
    permit_num: 'ULS-500',
    permit_type: 'ULS',
    ent_lead: 'Miles',
    action: 'scrape_cycle_change_applied',
    row_id: '500:cycle:1',
    cycle_index: 1,
    changes: { applied: { submitted: '2026-05-18' } },
    created_at: '2026-05-18T15:00:00Z',
  }),
];

vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({
    data: ROWS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  SCRAPER_ACTIVITY_DAYS_DEFAULT: 14,
  SCRAPER_ACTIVITY_ROW_CAP: 300,
}));

import ActivityPage from '../pages/ActivityPage';
import { useNotificationStore } from '../stores/notificationStore';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/activity']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ActivityPage />, { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.getState()._reset();
});

afterEach(() => {
  localStorage.clear();
});

describe('<ActivityPage /> (fix-28)', () => {
  it('renders one group per project address', () => {
    renderPage();
    expect(screen.getByTestId('activity-group-3670 Interlake Ave N')).toBeInTheDocument();
    expect(screen.getByTestId('activity-group-200 Oak Ave')).toBeInTheDocument();
    expect(screen.getByTestId('activity-group-500 Pike St')).toBeInTheDocument();
  });

  it('renders all 4 rows when no filter is applied', () => {
    renderPage();
    expect(screen.getByTestId('activity-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-3')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-4')).toBeInTheDocument();
  });

  it('search filters visible rows by address', async () => {
    renderPage();
    const search = screen.getByTestId('activity-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: '3670' } });
    // 150ms debounce.
    await waitFor(() => {
      expect(screen.queryByTestId('activity-row-3')).toBeNull();
    });
    expect(screen.getByTestId('activity-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-row-4')).toBeNull();
  });

  it('search across summary text catches "Issued"', async () => {
    renderPage();
    const search = screen.getByTestId('activity-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'issued' } });
    // Wait for the cycle row to drop out — the debounce fires before
    // this resolves, guaranteeing the filter has applied.
    await waitFor(() => {
      expect(screen.queryByTestId('activity-row-4')).toBeNull();
    });
    // Rows 1 + 2 (scrape_change_applied with applied.status='Issued') match.
    expect(screen.getByTestId('activity-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-2')).toBeInTheDocument();
  });

  it('category chip filters to Cycles only', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('activity-category-cycle'));
    expect(screen.getByTestId('activity-row-4')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-row-1')).toBeNull();
    expect(screen.queryByTestId('activity-row-2')).toBeNull();
    expect(screen.queryByTestId('activity-row-3')).toBeNull();
  });

  it('ent multi-select narrows to a single lead', () => {
    renderPage();
    // Open dropdown, untoggle Briana + Miles → only Bobby remains.
    fireEvent.click(screen.getByTestId('activity-ent-toggle'));
    fireEvent.click(screen.getByTestId('activity-ent-opt-Briana'));
    fireEvent.click(screen.getByTestId('activity-ent-opt-Miles'));
    expect(screen.getByTestId('activity-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-row-3')).toBeNull();
    expect(screen.queryByTestId('activity-row-4')).toBeNull();
  });

  it('per-row checkbox toggles read state', () => {
    renderPage();
    const check = screen.getByTestId('activity-row-check-1') as HTMLInputElement;
    expect(check.checked).toBe(false);
    fireEvent.click(check);
    expect(useNotificationStore.getState().readIds.has(1)).toBe(true);
    // Re-clicking unmarks.
    fireEvent.click(check);
    expect(useNotificationStore.getState().readIds.has(1)).toBe(false);
  });

  it('"Mark all read" marks every visible row, ignores filtered-out rows', () => {
    renderPage();
    // Narrow to category=cycle (only row 4 visible).
    fireEvent.click(screen.getByTestId('activity-category-cycle'));
    fireEvent.click(screen.getByTestId('activity-mark-all-read'));
    const ids = useNotificationStore.getState().readIds;
    expect(ids.has(4)).toBe(true);
    expect(ids.has(1)).toBe(false);
    expect(ids.has(2)).toBe(false);
    expect(ids.has(3)).toBe(false);
  });

  it('header shows total unread + total event count', () => {
    renderPage();
    const page = screen.getByTestId('activity-page');
    expect(page.textContent).toMatch(/4 unread/);
    expect(page.textContent).toMatch(/4 events in the last 14 days/);
  });

  it('empty state surfaces when filters hide every row', async () => {
    renderPage();
    const search = screen.getByTestId('activity-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'nothing-matches' } });
    await waitFor(() => {
      expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('activity-clear-filters')).toBeInTheDocument();
  });

  it('clear-filters button restores the full row list', async () => {
    renderPage();
    const search = screen.getByTestId('activity-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'nothing-matches' } });
    await waitFor(() => {
      expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('activity-clear-filters'));
    // Wait through the 150ms debounce — the input clears immediately
    // but debouncedSearch is still 'nothing-matches' for the next tick.
    await waitFor(() => {
      expect(screen.getByTestId('activity-row-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('activity-row-4')).toBeInTheDocument();
  });

  it('group header shows juris tag for the project', () => {
    renderPage();
    const group = screen.getByTestId('activity-group-3670 Interlake Ave N');
    expect(group.textContent).toContain('Seattle');
  });

  it('collapsing a group hides its rows', () => {
    renderPage();
    fireEvent.click(
      screen.getByTestId('activity-group-toggle-3670 Interlake Ave N'),
    );
    expect(screen.queryByTestId('activity-row-1')).toBeNull();
    expect(screen.queryByTestId('activity-row-2')).toBeNull();
    // Other groups still visible.
    expect(screen.getByTestId('activity-row-3')).toBeInTheDocument();
  });

  it('ent filter selection persists to localStorage', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('activity-ent-toggle'));
    fireEvent.click(screen.getByTestId('activity-ent-opt-Briana'));
    // useEffect persists after the state update; let act flush.
    act(() => {
      // no-op flush
    });
    const raw = localStorage.getItem('bp_activity_ent_filter');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // Default selection was Bobby/Briana/Miles, untoggling Briana → [Bobby, Miles].
    expect(parsed).not.toContain('Briana');
    expect(parsed).toContain('Bobby');
    expect(parsed).toContain('Miles');
  });
});
