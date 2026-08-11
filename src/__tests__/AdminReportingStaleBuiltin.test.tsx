import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReportHubPayload } from '../lib/database.types';

// fix-282: the Reporting hub's Run, across all three kinds of saved report.
//
// The reported production failure came from this button. A builtin_key that
// this bundle does not recognise fell into the custom branch and navigated to
// /reports/custom/:id, which runs bp_run_saved_report against the builtin's
// empty spec. Two occurrences, both "spec.entity is required".

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const HUB: ReportHubPayload = {
  categories: [{ id: 'cat', parent_id: null, name: 'Reports', position: 0 }],
  reports: [
    {
      id: 'rep-known',
      category_id: 'cat',
      name: 'Corrections',
      description: 'Every indexed correction comment.',
      kind: 'builtin',
      builtin_key: 'corrections',
      position: 0,
    },
    {
      // The production row as an older bundle sees it: builtin_key set, the
      // registry has never heard of it.
      id: 'c3baa3d3-b400-4833-852d-ada190b186da',
      category_id: 'cat',
      name: 'Corrections',
      description: 'Shipped after this bundle was built.',
      kind: 'builtin',
      builtin_key: 'corrections_next',
      position: 1,
    },
    {
      id: 'rep-custom',
      category_id: 'cat',
      name: 'My Custom Report',
      description: 'A freeform report.',
      kind: 'custom',
      builtin_key: null,
      position: 2,
    },
  ],
};

vi.mock('../hooks/useReportHub', () => ({
  useReportHub: () => ({ data: HUB, isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertReportCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReportCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertSavedReport: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSavedReport: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminReportingTab from '../components/Settings/AdminReportingTab';

const onAfterRun = vi.fn();

const KNOWN = 'rep-known';
const UNKNOWN = 'c3baa3d3-b400-4833-852d-ada190b186da'; // the production row id
const CUSTOM = 'rep-custom';

function renderTab() {
  render(
    <MemoryRouter>
      <AdminReportingTab onAfterRun={onAfterRun} />
    </MemoryRouter>,
  );
  // The reports live in a category; the default view is uncategorized.
  fireEvent.click(screen.getByTestId('reporting-cat-cat'));
}

function run(id: string) {
  fireEvent.click(screen.getByTestId(`reporting-report-${id}-run`));
}

beforeEach(() => {
  navigateSpy.mockClear();
  onAfterRun.mockClear();
});

describe('fix-282 Run routes by what the report IS', () => {
  it('a KNOWN builtin goes to its own route', () => {
    renderTab();
    run(KNOWN);
    expect(navigateSpy).toHaveBeenCalledWith('/reports/corrections');
  });

  it('a CUSTOM report goes to the custom viewer', () => {
    renderTab();
    run(CUSTOM);
    expect(navigateSpy).toHaveBeenCalledWith(
      '/reports/custom/rep-custom',
    );
  });

  it('an UNKNOWN builtin does NOT navigate anywhere', () => {
    renderTab();
    run(UNKNOWN);
    expect(navigateSpy).not.toHaveBeenCalled();
    // Specifically: not to the custom route, which is what used to happen and
    // is what fired the doomed RPC.
    expect(navigateSpy).not.toHaveBeenCalledWith(
      '/reports/custom/c3baa3d3-b400-4833-852d-ada190b186da',
    );
  });

  it('an unknown builtin explains itself, and names the key', () => {
    renderTab();
    run(UNKNOWN);
    const alert = screen.getByTestId('reporting-stale-builtin');
    expect(alert).toHaveTextContent('corrections_next');
    expect(alert.textContent?.toLowerCase()).toContain('refresh');
    expect(screen.getByTestId('reporting-stale-builtin-reload')).toBeInTheDocument();
  });

  it('does not dismiss the Settings modal on a report it cannot open', () => {
    renderTab();
    run(UNKNOWN);
    // Closing the modal would hide the only explanation the user gets.
    expect(onAfterRun).not.toHaveBeenCalled();
  });

  it('the warning clears once a report that DOES work is run', () => {
    renderTab();
    run(UNKNOWN);
    expect(screen.getByTestId('reporting-stale-builtin')).toBeInTheDocument();
    run(CUSTOM);
    expect(screen.queryByTestId('reporting-stale-builtin')).toBeNull();
  });

  it('the warning can be dismissed', () => {
    renderTab();
    run(UNKNOWN);
    fireEvent.click(screen.getByTestId('reporting-stale-builtin-dismiss'));
    expect(screen.queryByTestId('reporting-stale-builtin')).toBeNull();
  });
});
