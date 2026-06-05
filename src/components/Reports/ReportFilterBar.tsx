import type { ReportFilters, TimeRange } from '../../lib/reportMetrics';
import FilterDropdown from '../FilterDropdown';

// Q7.2.a: global filter bar for the Reports view. 7 controls per Q2c
// (Acq Lead dropped). State lives on the parent Reports page; this
// component is presentational. Multi-select sets follow the convention
// "empty set = no filter" (cleaner than v1's 'all' sentinel).

interface Props {
  filters: ReportFilters;
  onChange: <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => void;
  onClear: () => void;
  /** Auto-populated from the data. The parent computes distinct values
   * once per dataset and feeds them in. */
  typeOptions: string[];
  jurisOptions: string[];
  entOptions: string[];
  productTypeOptions: string[];
  tagOptions: string[];
  /** fix-113-a: distinct permit.status values in the unfiltered cohort. */
  permitStatusOptions: string[];
  resultCount: number;
}

const RANGE_LABELS: Record<TimeRange, string> = {
  all: 'All time',
  '3mo': 'Last 3 months',
  '6mo': 'Last 6 months',
  '1yr': 'Last year',
  '2yr': 'Last 2 years',
  custom: 'Custom…',
};

export default function ReportFilterBar({
  filters,
  onChange,
  onClear,
  typeOptions,
  jurisOptions,
  entOptions,
  productTypeOptions,
  tagOptions,
  permitStatusOptions,
  resultCount,
}: Props) {
  return (
    <div
      className="bg-s2 border border-border rounded-lg p-3 flex flex-wrap items-end gap-3"
      data-testid="report-filterbar"
    >
      <SetMultiSelect
        label="Type"
        selected={filters.types}
        options={typeOptions}
        onChange={(s) => onChange('types', s)}
        testId="filter-type"
      />
      <SetMultiSelect
        label="Juris"
        selected={filters.jurisdictions}
        options={jurisOptions}
        onChange={(s) => onChange('jurisdictions', s)}
        testId="filter-juris"
      />
      <SetMultiSelect
        label="ENT"
        selected={filters.ents}
        options={entOptions}
        onChange={(s) => onChange('ents', s)}
        testId="filter-ent"
      />

      <FieldLabel label="Time range">
        <select
          value={filters.range}
          onChange={(e) => onChange('range', e.target.value as TimeRange)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="filter-range"
        >
          {(Object.entries(RANGE_LABELS) as [TimeRange, string][]).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </FieldLabel>

      {filters.range === 'custom' && (
        <>
          <FieldLabel label="From">
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => onChange('dateFrom', e.target.value || null)}
              className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
              data-testid="filter-date-from"
            />
          </FieldLabel>
          <FieldLabel label="To">
            <input
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => onChange('dateTo', e.target.value || null)}
              className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
              data-testid="filter-date-to"
            />
          </FieldLabel>
        </>
      )}

      {/* fix-113-a: relabelled "Status" → "Project Status" to make the
          scope explicit. Same backing logic (buildFullyIssuedProjectIds);
          options unchanged. Bobby's audit found the project-rollup
          semantic was the hidden gotcha — naming fixes it. */}
      <FieldLabel label="Project Status">
        <select
          value={filters.status}
          onChange={(e) =>
            onChange('status', e.target.value as ReportFilters['status'])
          }
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="filter-status"
        >
          <option value="all">All projects</option>
          <option value="active">Active only</option>
          <option value="issued">Fully issued</option>
        </select>
      </FieldLabel>

      {/* fix-113-a: NEW per-permit Status filter, decoupled from the
          project-rollup above. Auto-populated from the cohort so users see
          exactly the status strings the data carries (24 distinct values
          in prod). Empty / 'all' = no filter; otherwise exact-match on
          permit.status. */}
      <FieldLabel label="Permit Status">
        <select
          value={filters.permitStatus}
          onChange={(e) => onChange('permitStatus', e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="filter-permit-status"
        >
          <option value="all">All permits</option>
          {permitStatusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FieldLabel>

      {/* fix-115-c: period-comparison dropdown — same three options as the
          Trends page (fix-114). When `range='all'` is active there is no
          temporal anchor to compare against; ReportsOverviewTab gates the
          MetricCards' comparison props on that case so picking a mode here
          without a date range is a no-op rather than a crash. */}
      <FieldLabel label="Compare to">
        <select
          value={filters.compareTo}
          onChange={(e) =>
            onChange('compareTo', e.target.value as ReportFilters['compareTo'])
          }
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="filter-compare"
        >
          <option value="off">Off</option>
          <option value="previous_period">Previous period</option>
          <option value="previous_year">Previous year</option>
        </select>
      </FieldLabel>

      <SetMultiSelect
        label="Product"
        selected={filters.productTypes}
        options={productTypeOptions}
        onChange={(s) => onChange('productTypes', s)}
        testId="filter-product"
      />
      <SetMultiSelect
        label="Tags"
        selected={filters.tags}
        options={tagOptions}
        onChange={(s) => onChange('tags', s)}
        testId="filter-tags"
      />

      <FieldLabel label="Search">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          placeholder="Address, juris, type…"
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text placeholder:text-dim focus:outline-none focus:border-de min-w-[180px]"
          data-testid="filter-search"
        />
      </FieldLabel>

      <button
        type="button"
        onClick={onClear}
        className="text-[11px] px-3 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
        data-testid="filter-clear"
      >
        Clear
      </button>
      <span
        className="text-[11px] text-dim font-mono ml-auto"
        data-testid="filter-result-count"
      >
        {resultCount} permit{resultCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] text-dim uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Q9.5.f Item 6: replaces the inline chip-blanket with a proper
 *  dropdown (chevron + popover + "All" toggle + checkbox list). Reuses
 *  the shared FilterDropdown primitive that the Dashboard StageFilters
 *  also consumes — same v1 .ms-btn / .ms-dropdown pattern across both
 *  pages. Call-site API (label / selected / options / onChange / testId)
 *  preserved so the parent ReportFilterBar JSX is unchanged. */
function SetMultiSelect({
  label,
  selected,
  options,
  onChange,
  testId,
}: {
  label: string;
  selected: Set<string>;
  options: string[];
  onChange: (next: Set<string>) => void;
  testId: string;
}) {
  return (
    <FieldLabel label={label}>
      <FilterDropdown
        label={label}
        options={options}
        selected={selected}
        onChange={onChange}
        testId={testId}
      />
    </FieldLabel>
  );
}
