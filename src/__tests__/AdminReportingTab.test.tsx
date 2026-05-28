import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReportHubPayload } from '../lib/database.types';

// fix-68: Settings -> Reporting hub component tests. The data hooks are
// mocked so we drive the category tree + reports directly and capture the
// mutation/navigation calls.
//
// Pinned contracts:
//   - seeded "Weekly Updates" category + "Weekly DA Update" builtin render
//   - clicking the builtin's Run navigates to /reports/weekly-da
//   - "+ New Report" is present but disabled with the Phase 3 tooltip
//   - Delete is disabled on a builtin report

const navigateSpy = vi.hoisted(() => vi.fn());
const upsertCatSpy = vi.hoisted(() => vi.fn());
const deleteCatSpy = vi.hoisted(() => vi.fn());
const upsertReportSpy = vi.hoisted(() => vi.fn());
const deleteReportSpy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const HUB: ReportHubPayload = {
  categories: [
    { id: 'cat-weekly', parent_id: null, name: 'Weekly Updates', position: 0 },
  ],
  reports: [
    {
      id: 'rep-wda',
      category_id: 'cat-weekly',
      name: 'Weekly DA Update',
      description: 'Per-DA one-pager.',
      kind: 'builtin',
      builtin_key: 'weekly_da_update',
      position: 0,
    },
    {
      // fix-69: a custom report lives alongside the builtin in the same
      // category so the existing "All Reports empty" test still holds.
      id: 'rep-custom',
      category_id: 'cat-weekly',
      name: 'My Custom Report',
      description: 'A freeform report.',
      kind: 'custom',
      builtin_key: null,
      position: 1,
    },
  ],
};

vi.mock('../hooks/useReportHub', () => ({
  useReportHub: () => ({
    data: HUB,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertReportCategory: () => ({ mutate: upsertCatSpy, isPending: false }),
  useDeleteReportCategory: () => ({ mutate: deleteCatSpy, isPending: false }),
  useUpsertSavedReport: () => ({ mutate: upsertReportSpy, isPending: false }),
  useDeleteSavedReport: () => ({ mutate: deleteReportSpy, isPending: false }),
}));

import AdminReportingTab from '../components/Settings/AdminReportingTab';

function renderTab(onAfterRun?: () => void) {
  return render(
    <MemoryRouter>
      <AdminReportingTab onAfterRun={onAfterRun} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateSpy.mockClear();
  upsertCatSpy.mockClear();
  deleteCatSpy.mockClear();
  upsertReportSpy.mockClear();
  deleteReportSpy.mockClear();
});

describe('<AdminReportingTab /> (fix-68)', () => {
  it('renders the seeded Weekly Updates category', () => {
    renderTab();
    const cat = screen.getByTestId('reporting-cat-cat-weekly');
    expect(cat).toBeInTheDocument();
    expect(cat.textContent).toContain('Weekly Updates');
    // "All Reports" virtual root is present too.
    expect(screen.getByTestId('reporting-cat-all')).toBeInTheDocument();
  });

  it('shows the Weekly DA Update report when its category is selected', () => {
    renderTab();
    // Default selection is "All Reports" (uncategorized) — the builtin lives
    // in a category, so it isn't visible until the category is selected.
    expect(screen.queryByTestId('reporting-report-rep-wda')).toBeNull();
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    const card = screen.getByTestId('reporting-report-rep-wda');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('Weekly DA Update');
    expect(card.textContent).toContain('Builtin');
  });

  it('Run on the builtin navigates to /reports/weekly-da (and fires onAfterRun)', () => {
    const onAfterRun = vi.fn();
    renderTab(onAfterRun);
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    fireEvent.click(screen.getByTestId('reporting-report-rep-wda-run'));
    expect(navigateSpy).toHaveBeenCalledWith('/reports/weekly-da');
    expect(onAfterRun).toHaveBeenCalledTimes(1);
  });

  it('"+ New Report" is enabled and navigates to the builder (fix-69)', () => {
    renderTab();
    const btn = screen.getByTestId('reporting-new-report') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    // No category selected (All Reports) → plain builder route.
    expect(navigateSpy).toHaveBeenCalledWith('/reports/builder');
  });

  it('"+ New Report" carries the selected category into the builder', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    fireEvent.click(screen.getByTestId('reporting-new-report'));
    expect(navigateSpy).toHaveBeenCalledWith('/reports/builder?category=cat-weekly');
  });

  it('custom report Run navigates to the custom viewer (fix-69)', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    fireEvent.click(screen.getByTestId('reporting-report-rep-custom-run'));
    expect(navigateSpy).toHaveBeenCalledWith('/reports/custom/rep-custom');
  });

  it('custom report Delete is enabled (not a builtin)', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    const del = screen.getByTestId('reporting-report-rep-custom-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
  });

  it('Delete is disabled on a builtin report', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('reporting-cat-cat-weekly'));
    const del = screen.getByTestId('reporting-report-rep-wda-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toMatch(/cannot be deleted/i);
    // Clicking a disabled button does nothing, but assert the guard anyway:
    fireEvent.click(del);
    expect(deleteReportSpy).not.toHaveBeenCalled();
  });

  it('"+ Category" prompts for a name and calls the upsert mutation', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Monthly');
    try {
      renderTab();
      fireEvent.click(screen.getByTestId('reporting-add-category'));
      expect(upsertCatSpy).toHaveBeenCalledTimes(1);
      const arg = upsertCatSpy.mock.calls[0][0];
      expect(arg.name).toBe('Monthly');
      expect(arg.parentId).toBeNull();
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('All Reports root shows the empty state when nothing is uncategorized', () => {
    renderTab();
    // Default selection is All Reports; the only report is categorized.
    expect(screen.getByTestId('reporting-empty')).toBeInTheDocument();
  });
});
