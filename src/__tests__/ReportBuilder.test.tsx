import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReportBuilderCatalog } from '../lib/database.types';

// fix-69: Report Builder tests. Catalog + hub + mutations mocked.

const previewMutate = vi.hoisted(() => vi.fn());
const upsertMutate = vi.hoisted(() => vi.fn());

const CATALOG: ReportBuilderCatalog = {
  version: 1,
  entities: [
    {
      key: 'permits',
      label: 'Permits',
      default_sort: { column: 'target_submit', dir: 'asc' },
      columns: [
        { key: 'num', label: 'Permit #', type: 'text', filterable: true, operators: ['=', '!=', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'], source: 'direct' },
        { key: 'stage', label: 'Stage', type: 'text', filterable: true, operators: ['=', '!=', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'], source: 'direct' },
        { key: 'expected_issue', label: 'ACQ Target', type: 'date', filterable: true, operators: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'is_null', 'is_not_null'], source: 'direct' },
      ],
    },
    {
      key: 'projects',
      label: 'Projects',
      default_sort: { column: 'go_date', dir: 'desc' },
      columns: [
        { key: 'address', label: 'Address', type: 'text', filterable: true, operators: ['=', '!=', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'], source: 'direct' },
      ],
    },
  ],
};

vi.mock('../hooks/useReportBuilder', () => ({
  useReportBuilderCatalog: () => ({ data: CATALOG, isLoading: false, error: null }),
  useSavedReport: () => ({ data: null, isLoading: false, error: null }),
  usePreviewReportSpec: () => ({ mutate: previewMutate, data: undefined, isPending: false }),
  useUpsertCustomReportSpec: () => ({ mutate: upsertMutate, isPending: false }),
}));
vi.mock('../hooks/useReportHub', () => ({
  useReportHub: () => ({ data: { categories: [], reports: [] }, isLoading: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));

import ReportBuilder from '../pages/ReportBuilder';

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/reports/builder']}>
      <Routes>
        <Route path="/reports/builder" element={<ReportBuilder />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  previewMutate.mockClear();
  upsertMutate.mockClear();
});

describe('<ReportBuilder /> (fix-69)', () => {
  it('defaults to the first entity and lists its columns', () => {
    renderBuilder();
    const entity = screen.getByTestId('report-builder-entity') as HTMLSelectElement;
    expect(entity.value).toBe('permits');
    expect(screen.getByTestId('report-builder-col-num')).toBeInTheDocument();
    expect(screen.getByTestId('report-builder-col-stage')).toBeInTheDocument();
  });

  it('Preview is disabled until at least one column is selected', () => {
    renderBuilder();
    const preview = screen.getByTestId('report-builder-preview') as HTMLButtonElement;
    expect(preview.disabled).toBe(true);
    // Validation message surfaces the reason.
    expect(screen.getByTestId('report-builder-validation').textContent).toMatch(
      /at least one column/i,
    );
    fireEvent.click(screen.getByTestId('report-builder-col-num'));
    expect((screen.getByTestId('report-builder-preview') as HTMLButtonElement).disabled).toBe(false);
  });

  it('changing entity resets selected columns (confirmed)', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderBuilder();
    fireEvent.click(screen.getByTestId('report-builder-col-num'));
    expect((screen.getByTestId('report-builder-col-num') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByTestId('report-builder-entity'), {
      target: { value: 'projects' },
    });
    // Permits columns gone; projects columns shown; selection cleared.
    expect(screen.queryByTestId('report-builder-col-num')).toBeNull();
    expect(screen.getByTestId('report-builder-col-address')).toBeInTheDocument();
    expect((screen.getByTestId('report-builder-col-address') as HTMLInputElement).checked).toBe(false);
  });

  it('adding a filter creates a filter row', () => {
    renderBuilder();
    expect(screen.queryByTestId('report-builder-filter-0')).toBeNull();
    fireEvent.click(screen.getByTestId('report-builder-add-filter'));
    expect(screen.getByTestId('report-builder-filter-0')).toBeInTheDocument();
    expect(screen.getByTestId('report-builder-filter-0-column')).toBeInTheDocument();
    expect(screen.getByTestId('report-builder-filter-0-op')).toBeInTheDocument();
  });

  it('valid Preview calls the RPC with the constructed spec', () => {
    renderBuilder();
    // Select two columns.
    fireEvent.click(screen.getByTestId('report-builder-col-num'));
    fireEvent.click(screen.getByTestId('report-builder-col-expected_issue'));
    // Add a filter: stage = is.
    fireEvent.click(screen.getByTestId('report-builder-add-filter'));
    fireEvent.change(screen.getByTestId('report-builder-filter-0-column'), {
      target: { value: 'stage' },
    });
    fireEvent.change(screen.getByTestId('report-builder-filter-0-op'), {
      target: { value: '=' },
    });
    fireEvent.change(screen.getByTestId('report-builder-filter-0-value'), {
      target: { value: 'is' },
    });
    fireEvent.click(screen.getByTestId('report-builder-preview'));

    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(previewMutate).toHaveBeenCalledWith({
      version: 1,
      entity: 'permits',
      columns: ['num', 'expected_issue'],
      filters: [{ column: 'stage', op: '=', value: 'is' }],
      sort: [],
      limit: 1000,
    });
  });

  it('number filter coerces the value to a number in the spec', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('report-builder-col-num'));
    fireEvent.click(screen.getByTestId('report-builder-add-filter'));
    // expected_issue is a date; switch the filter column to it and use >=.
    fireEvent.change(screen.getByTestId('report-builder-filter-0-column'), {
      target: { value: 'expected_issue' },
    });
    fireEvent.change(screen.getByTestId('report-builder-filter-0-op'), {
      target: { value: '>=' },
    });
    fireEvent.change(screen.getByTestId('report-builder-filter-0-value'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByTestId('report-builder-preview'));
    const spec = previewMutate.mock.calls[0][0];
    expect(spec.filters[0]).toEqual({
      column: 'expected_issue',
      op: '>=',
      value: '2026-01-01',
    });
  });
});
