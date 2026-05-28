import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useReportBuilderCatalog,
  usePreviewReportSpec,
  useUpsertCustomReportSpec,
  useSavedReport,
} from '../hooks/useReportBuilder';
import { useReportHub } from '../hooks/useReportHub';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../components/Skeleton';
import ReportResultTable, {
  type ResultColumnMeta,
} from '../components/Reports/ReportResultTable';
import { pushToast } from '../stores/toastStore';
import type {
  ReportBuilderColumn,
  ReportBuilderEntity,
  ReportColumnType,
  ReportOperator,
  ReportSpec,
  ReportSpecFilter,
  ReportSpecSort,
} from '../lib/database.types';

// fix-69: freeform report builder. Single entity per report + flat parent
// convenience columns. List rows only (no aggregation in MVP). Preview via
// bp_preview_report_spec; Save via bp_upsert_custom_report_spec. Admin-gated.

interface DraftFilter {
  column: string;
  op: ReportOperator;
  value: string; // raw UI value; coerced per type at build time
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

export default function ReportBuilder() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = useIsTenantAdmin();

  const catalogQ = useReportBuilderCatalog();
  const hubQ = useReportHub();
  const existingQ = useSavedReport(id);
  const preview = usePreviewReportSpec();
  const upsert = useUpsertCustomReportSpec();

  const entities = useMemo(
    () => catalogQ.data?.entities ?? [],
    [catalogQ.data],
  );

  // Form state
  const [entityKey, setEntityKey] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [sort, setSort] = useState<ReportSpecSort[]>([]);
  const [limit, setLimit] = useState<number>(DEFAULT_LIMIT);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(
    searchParams.get('category'),
  );
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from an existing report (edit mode) — in-render guarded setState
  // (React's recommended "adjust state when a prop/query changes" pattern;
  // avoids the setState-in-effect cascade lint). Runs once when the query
  // lands; the `hydrated` flag prevents clobbering subsequent user edits.
  if (isEdit && existingQ.data && !hydrated) {
    const d = existingQ.data;
    setEntityKey(d.spec.entity);
    setColumns(d.spec.columns ?? []);
    setFilters(
      (d.spec.filters ?? []).map((f) => ({
        column: f.column,
        op: f.op,
        value: Array.isArray(f.value)
          ? f.value.join(', ')
          : f.value == null
            ? ''
            : String(f.value),
      })),
    );
    setSort(d.spec.sort ?? []);
    setLimit(d.spec.limit ?? DEFAULT_LIMIT);
    setName(d.name);
    setDescription(d.description);
    setCategoryId(d.category_id);
    setHydrated(true);
  }

  // Default entity on first load (create mode) — same in-render pattern.
  if (!isEdit && !entityKey && entities.length > 0) {
    setEntityKey(entities[0].key);
  }

  const entity: ReportBuilderEntity | undefined = useMemo(
    () => entities.find((e) => e.key === entityKey),
    [entities, entityKey],
  );
  const colByKey = useMemo(() => {
    const m = new Map<string, ReportBuilderColumn>();
    for (const c of entity?.columns ?? []) m.set(c.key, c);
    return m;
  }, [entity]);

  function changeEntity(next: string) {
    if (next === entityKey) return;
    const dirty = columns.length > 0 || filters.length > 0 || sort.length > 0;
    if (dirty && !window.confirm('Changing entity clears columns, filters, and sort. Continue?')) {
      return;
    }
    setEntityKey(next);
    setColumns([]);
    setFilters([]);
    setSort([]);
  }

  function toggleColumn(key: string) {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function addFilter() {
    const firstFilterable = entity?.columns.find((c) => c.filterable);
    if (!firstFilterable) return;
    setFilters((prev) => [
      ...prev,
      { column: firstFilterable.key, op: firstFilterable.operators[0], value: '' },
    ]);
  }
  function updateFilter(i: number, patch: Partial<DraftFilter>) {
    setFilters((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    );
  }
  function removeFilter(i: number) {
    setFilters((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addSort() {
    if (sort.length >= 3) return;
    const first = entity?.columns[0];
    if (!first) return;
    setSort((prev) => [...prev, { column: first.key, dir: 'asc' }]);
  }
  function updateSort(i: number, patch: Partial<ReportSpecSort>) {
    setSort((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSort(i: number) {
    setSort((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Coerce a draft filter's raw value into the typed spec value.
  function coerceValue(f: DraftFilter): ReportSpecFilter['value'] {
    const col = colByKey.get(f.column);
    const type = col?.type ?? 'text';
    if (f.op === 'is_null' || f.op === 'is_not_null') return undefined;
    if (f.op === 'in' || f.op === 'not_in') {
      const parts = f.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return type === 'number' ? parts.map((p) => Number(p)) : parts;
    }
    if (type === 'number') return Number(f.value);
    if (type === 'boolean') return f.value === 'true';
    return f.value;
  }

  function buildSpec(): ReportSpec {
    return {
      version: 1,
      entity: entityKey,
      columns,
      filters: filters.map((f) => {
        const v = coerceValue(f);
        const out: ReportSpecFilter = { column: f.column, op: f.op };
        if (v !== undefined) out.value = v;
        return out;
      }),
      sort,
      limit,
    };
  }

  // Client-side validation — mirrors the server rules so Preview/Save are
  // blocked before a round-trip on obviously-invalid specs.
  function clientValidate(): string | null {
    if (!entityKey) return 'Pick an entity.';
    if (columns.length < 1) return 'Select at least one column.';
    for (const f of filters) {
      const col = colByKey.get(f.column);
      if (!col) return `Unknown filter column: ${f.column}`;
      if (!col.operators.includes(f.op)) {
        return `Operator ${f.op} not allowed for ${col.label}.`;
      }
      if (f.op === 'is_null' || f.op === 'is_not_null') continue;
      if (f.op === 'in' || f.op === 'not_in') {
        const parts = f.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) return `Filter on ${col.label} needs at least one value.`;
        if (col.type === 'number' && parts.some((p) => Number.isNaN(Number(p)))) {
          return `Filter on ${col.label} expects numbers.`;
        }
        continue;
      }
      if (f.value.trim() === '') return `Filter on ${col.label} needs a value.`;
      if (col.type === 'number' && Number.isNaN(Number(f.value))) {
        return `Filter on ${col.label} expects a number.`;
      }
    }
    if (sort.length > 3) return 'At most 3 sort columns.';
    return null;
  }

  const validationError = clientValidate();

  const previewColumns: ResultColumnMeta[] = useMemo(
    () =>
      columns.map((k) => {
        const c = colByKey.get(k);
        return {
          key: k,
          label: c?.label ?? k,
          type: (c?.type ?? 'text') as ReportColumnType,
        };
      }),
    [columns, colByKey],
  );

  function handlePreview() {
    const err = clientValidate();
    if (err) {
      pushToast(err, 'warn');
      return;
    }
    preview.mutate(buildSpec());
  }

  function handleSave() {
    const err = clientValidate();
    if (err) {
      pushToast(err, 'warn');
      return;
    }
    if (!name.trim()) {
      pushToast('Give the report a name.', 'warn');
      return;
    }
    upsert.mutate(
      {
        id: id ?? null,
        categoryId,
        name: name.trim(),
        description,
        spec: buildSpec(),
      },
      {
        onSuccess: (newId) => {
          pushToast('Report saved.', 'success');
          navigate(`/reports/custom/${newId}`);
        },
      },
    );
  }

  if (catalogQ.isLoading || (isEdit && existingQ.isLoading)) {
    return <SkeletonRows count={5} rowClassName="h-10" />;
  }

  if (!isAdmin) {
    return (
      <div
        className="rounded-lg border border-border bg-surface p-6 text-sm text-muted"
        data-testid="report-builder-not-admin"
      >
        Building reports is admin-only. Ask a tenant admin to create or edit
        custom reports.
      </div>
    );
  }

  const filterableColumns = (entity?.columns ?? []).filter((c) => c.filterable);
  const categories = hubQ.data?.categories ?? [];

  return (
    <div className="space-y-4" data-testid="report-builder">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-extrabold text-text">
          {isEdit ? 'Edit Report' : 'New Report'}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/settings/reporting')}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-border text-text hover:bg-s2"
            data-testid="report-builder-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePreview}
            disabled={!!validationError || preview.isPending}
            className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="report-builder-preview"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!!validationError || upsert.isPending}
            className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded border border-de bg-de text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="report-builder-save"
          >
            Save
          </button>
        </div>
      </div>

      {/* 1. Entity */}
      <Section title="Entity">
        <select
          value={entityKey}
          onChange={(e) => changeEntity(e.target.value)}
          className="text-[12px] px-2 py-1 border border-border rounded bg-bg text-text outline-none"
          data-testid="report-builder-entity"
        >
          {entities.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </select>
      </Section>

      {/* 2. Columns */}
      <Section title={`Columns (${columns.length})`}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5" data-testid="report-builder-columns">
          {(entity?.columns ?? []).map((c) => (
            <label
              key={c.key}
              className="flex items-center gap-1.5 text-[11px] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={columns.includes(c.key)}
                onChange={() => toggleColumn(c.key)}
                data-testid={`report-builder-col-${c.key}`}
              />
              <span className="text-text">{c.label}</span>
              <span className="text-[8px] uppercase text-dim border border-border rounded px-1">
                {c.type}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {/* 3. Filters */}
      <Section title="Filters">
        <div className="space-y-1.5" data-testid="report-builder-filters">
          {filters.map((f, i) => {
            const col = colByKey.get(f.column);
            const ops = col?.operators ?? [];
            const noValue = f.op === 'is_null' || f.op === 'is_not_null';
            return (
              <div key={i} className="flex items-center gap-1.5 flex-wrap" data-testid={`report-builder-filter-${i}`}>
                <select
                  value={f.column}
                  onChange={(e) => {
                    const nc = colByKey.get(e.target.value);
                    updateFilter(i, {
                      column: e.target.value,
                      op: nc?.operators[0] ?? '=',
                      value: '',
                    });
                  }}
                  className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
                  data-testid={`report-builder-filter-${i}-column`}
                >
                  {filterableColumns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={f.op}
                  onChange={(e) => updateFilter(i, { op: e.target.value as ReportOperator, value: '' })}
                  className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
                  data-testid={`report-builder-filter-${i}-op`}
                >
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {!noValue && (
                  <FilterValueInput
                    type={col?.type ?? 'text'}
                    op={f.op}
                    value={f.value}
                    onChange={(v) => updateFilter(i, { value: v })}
                    testid={`report-builder-filter-${i}-value`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeFilter(i)}
                  className="text-[11px] text-co border border-co-border bg-co-bg rounded px-1.5 py-1"
                  data-testid={`report-builder-filter-${i}-remove`}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addFilter}
            className="text-[11px] font-semibold px-2 py-1 rounded border border-de text-de bg-de/5 hover:bg-de/10"
            data-testid="report-builder-add-filter"
          >
            + Add filter
          </button>
        </div>
      </Section>

      {/* 4. Sort */}
      <Section title="Sort">
        <div className="space-y-1.5" data-testid="report-builder-sorts">
          {sort.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5" data-testid={`report-builder-sort-${i}`}>
              <select
                value={s.column}
                onChange={(e) => updateSort(i, { column: e.target.value })}
                className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
                data-testid={`report-builder-sort-${i}-column`}
              >
                {(entity?.columns ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={s.dir}
                onChange={(e) => updateSort(i, { dir: e.target.value as 'asc' | 'desc' })}
                className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
                data-testid={`report-builder-sort-${i}-dir`}
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
              <button
                type="button"
                onClick={() => removeSort(i)}
                className="text-[11px] text-co border border-co-border bg-co-bg rounded px-1.5 py-1"
                data-testid={`report-builder-sort-${i}-remove`}
              >
                ✕
              </button>
            </div>
          ))}
          {sort.length < 3 && (
            <button
              type="button"
              onClick={addSort}
              className="text-[11px] font-semibold px-2 py-1 rounded border border-de text-de bg-de/5 hover:bg-de/10"
              data-testid="report-builder-add-sort"
            >
              + Add sort
            </button>
          )}
        </div>
      </Section>

      {/* 5. Limit */}
      <Section title="Limit">
        <input
          type="number"
          min={1}
          max={MAX_LIMIT}
          value={limit}
          onChange={(e) =>
            setLimit(Math.min(MAX_LIMIT, Math.max(1, Number(e.target.value) || DEFAULT_LIMIT)))
          }
          className="text-[12px] px-2 py-1 border border-border rounded bg-bg text-text w-28 outline-none"
          data-testid="report-builder-limit"
        />
      </Section>

      {/* Save metadata */}
      <Section title="Save as">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="Report name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-[12px] px-2 py-1 border border-border rounded bg-bg text-text outline-none"
            data-testid="report-builder-name"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-[12px] px-2 py-1 border border-border rounded bg-bg text-text outline-none"
            data-testid="report-builder-description"
          />
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className="text-[12px] px-2 py-1 border border-border rounded bg-bg text-text outline-none"
            data-testid="report-builder-category"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {validationError && (
        <div className="text-[11px] text-co" data-testid="report-builder-validation">
          {validationError}
        </div>
      )}

      {/* Preview */}
      {preview.data && (
        <Section title={`Preview (${preview.data.row_count} rows)`}>
          <ReportResultTable columns={previewColumns} rows={preview.data.rows} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-dim mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function FilterValueInput({
  type,
  op,
  value,
  onChange,
  testid,
}: {
  type: ReportColumnType;
  op: ReportOperator;
  value: string;
  onChange: (v: string) => void;
  testid: string;
}) {
  if (op === 'in' || op === 'not_in') {
    return (
      <input
        type="text"
        placeholder="comma,separated,values"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
        data-testid={testid}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
        data-testid={testid}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-[11px] px-1.5 py-1 border border-border rounded bg-bg text-text"
      data-testid={testid}
    />
  );
}
