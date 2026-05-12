import type {
  TrendsFilters,
  TrendsGroupBy,
  TrendsRange,
} from '../../lib/trendsHelpers';

// Q9.5.d: filter bar for Reports → Trends tab. Matches v1 markup at
// index.html:1205-1297. ACQ filter intentionally NOT rendered — permits
// don't carry an acq_lead column in v2 (task #63 tracks the schema
// addition). All other filters fire renderTrends-equivalent re-renders
// in the parent via the onChange callback.

interface Props {
  filters: TrendsFilters;
  onChange: <K extends keyof TrendsFilters>(
    key: K,
    value: TrendsFilters[K],
  ) => void;
  onReset: () => void;
  typeOptions: string[];
  jurisOptions: string[];
  entOptions: string[];
  daOptions: string[];
  tagOptions: string[];
}

const RANGE_OPTIONS: { value: TrendsRange; label: string }[] = [
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
  { value: '36', label: 'Last 36 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range…' },
];

const GROUP_OPTIONS: { value: TrendsGroupBy; label: string }[] = [
  { value: 'jurisdiction', label: 'Jurisdiction' },
  { value: 'type', label: 'Permit Type' },
  { value: 'ent', label: 'ENT Lead' },
  { value: 'da', label: 'Design Associate' },
  { value: 'dm', label: 'Design Manager' },
  { value: 'tag', label: 'Tag' },
  { value: 'total', label: 'Total Only' },
];

export default function TrendsFilterBar({
  filters,
  onChange,
  onReset,
  typeOptions,
  jurisOptions,
  entOptions,
  daOptions,
  tagOptions,
}: Props) {
  return (
    <div
      className="flex flex-wrap gap-2.5 items-end rounded-lg p-3 mb-4 border"
      style={{
        background: 'var(--color-s2)',
        borderColor: 'var(--color-border)',
      }}
      data-testid="trends-filter-bar"
    >
      <div className="w-full text-[10px] font-extrabold text-text uppercase tracking-wider">
        Filter Trends
      </div>

      <FilterSelect
        label="Time Range"
        value={filters.range}
        onChange={(v) => onChange('range', v as TrendsRange)}
        options={RANGE_OPTIONS}
        testId="tr-range"
      />

      {filters.range === 'custom' && (
        <>
          <FilterField label="From">
            <input
              type="month"
              value={filters.dateFrom}
              onChange={(e) => onChange('dateFrom', e.target.value)}
              className="px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none"
              style={{ borderColor: 'var(--color-de-border)' }}
              data-testid="tr-date-from"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="month"
              value={filters.dateTo}
              onChange={(e) => onChange('dateTo', e.target.value)}
              className="px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none"
              style={{ borderColor: 'var(--color-de-border)' }}
              data-testid="tr-date-to"
            />
          </FilterField>
        </>
      )}

      <FilterSelect
        label="Permit Type"
        value={filters.type}
        onChange={(v) => onChange('type', v)}
        options={[{ value: '', label: 'All Types' }, ...typeOptions.map((o) => ({ value: o, label: o }))]}
        testId="tr-type"
      />
      <FilterSelect
        label="Jurisdiction"
        value={filters.juris}
        onChange={(v) => onChange('juris', v)}
        options={[{ value: '', label: 'All Jurisdictions' }, ...jurisOptions.map((o) => ({ value: o, label: o }))]}
        testId="tr-juris"
      />
      <FilterSelect
        label="ENT Lead"
        value={filters.ent}
        onChange={(v) => onChange('ent', v)}
        options={[{ value: '', label: 'All' }, ...entOptions.map((o) => ({ value: o, label: o }))]}
        testId="tr-ent"
      />
      <FilterSelect
        label="Design Associate"
        value={filters.da}
        onChange={(v) => onChange('da', v)}
        options={[{ value: '', label: 'All' }, ...daOptions.map((o) => ({ value: o, label: o }))]}
        testId="tr-da"
      />
      <FilterSelect
        label="Tag"
        value={filters.tag}
        onChange={(v) => onChange('tag', v)}
        options={[{ value: '', label: 'All Tags' }, ...tagOptions.map((o) => ({ value: o, label: o }))]}
        testId="tr-tag"
      />
      <FilterSelect
        label="Group By"
        value={filters.group}
        onChange={(v) => onChange('group', v as TrendsGroupBy)}
        options={GROUP_OPTIONS}
        testId="tr-group"
      />

      <button
        onClick={onReset}
        className="px-3 py-1.5 rounded-md border text-[11px] cursor-pointer self-end"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
        data-testid="tr-reset"
      >
        Reset
      </button>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] text-dim uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function FilterSelect<V extends string>({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V | string; label: string }[];
  testId: string;
}) {
  return (
    <FilterField label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}
