import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  CustomReportResult,
  ReportBuilderCatalog,
  SavedReportDetail,
} from '../lib/database.types';

// fix-69: Custom Report viewer tests. Hooks mocked; we drive the run payload
// + saved-report detail directly.

const CATALOG: ReportBuilderCatalog = {
  version: 1,
  entities: [
    {
      key: 'permits',
      label: 'Permits',
      default_sort: { column: 'target_submit', dir: 'asc' },
      columns: [
        { key: 'num', label: 'Permit #', type: 'text', filterable: true, operators: ['='], source: 'direct' },
        { key: 'expected_issue', label: 'ACQ Target', type: 'date', filterable: true, operators: ['='], source: 'direct' },
      ],
    },
  ],
};

const DETAIL: SavedReportDetail = {
  id: 'r1',
  category_id: null,
  name: 'My ACQ Report',
  description: 'permits + acq target',
  kind: 'custom',
  builtin_key: null,
  position: 0,
  spec: {
    version: 1,
    entity: 'permits',
    columns: ['num', 'expected_issue'],
    filters: [],
    sort: [],
    limit: 1000,
  },
};

const RESULT: CustomReportResult = {
  rows: [
    { num: 'BP-1', expected_issue: '2026-06-01' },
    { num: 'BP-2', expected_issue: '2026-05-01' },
  ],
  row_count: 2,
  executed_at: '2026-05-28T12:00:00Z',
  spec_version: 1,
};

vi.mock('../hooks/useReportBuilder', () => ({
  useSavedReport: () => ({ data: DETAIL, isLoading: false, error: null, refetch: vi.fn() }),
  useReportBuilderCatalog: () => ({ data: CATALOG, isLoading: false, error: null }),
  useCustomReport: () => ({ data: RESULT, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

import CustomReport from '../pages/CustomReport';

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={['/reports/custom/r1']}>
      <Routes>
        <Route path="/reports/custom/:id" element={<CustomReport />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('<CustomReport /> (fix-69)', () => {
  it('renders the report name, meta, and a row table', () => {
    renderViewer();
    expect(screen.getByTestId('custom-report-page')).toBeInTheDocument();
    expect(screen.getByText('My ACQ Report')).toBeInTheDocument();
    expect(screen.getByTestId('custom-report-meta').textContent).toMatch(/2 rows/);
    const table = screen.getByTestId('report-result-table');
    expect(table.textContent).toContain('BP-1');
    expect(table.textContent).toContain('BP-2');
    // Column header labels resolved from the catalog.
    expect(screen.getByTestId('report-col-num').textContent).toContain('Permit #');
    expect(screen.getByTestId('report-col-expected_issue').textContent).toContain('ACQ Target');
  });

  it('sorts rows when a column header is clicked', () => {
    renderViewer();
    // Initial order is the payload order: BP-1 (row 0), BP-2 (row 1).
    const firstBefore = screen.getByTestId('report-result-row-0');
    expect(within(firstBefore).getByText('BP-1')).toBeInTheDocument();
    // Sort by ACQ Target asc → 2026-05-01 (BP-2) first.
    fireEvent.click(screen.getByTestId('report-col-expected_issue'));
    const firstAfter = screen.getByTestId('report-result-row-0');
    expect(within(firstAfter).getByText('BP-2')).toBeInTheDocument();
  });

  it('Download CSV triggers a download with the slugified filename', () => {
    // jsdom lacks URL.createObjectURL — stub it. Capture the created anchor.
    const createObjSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const realCreate = document.createElement.bind(document);
    let captured: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        captured = el as HTMLAnchorElement;
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {});
      }
      return el;
    });

    renderViewer();
    fireEvent.click(screen.getByTestId('custom-report-download-csv'));

    expect(createObjSpy).toHaveBeenCalledTimes(1);
    expect(createObjSpy.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(captured).not.toBeNull();
    expect(captured!.download).toMatch(/^my-acq-report-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
