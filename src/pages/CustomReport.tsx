import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useCustomReport,
  useReportBuilderCatalog,
  useSavedReport,
} from '../hooks/useReportBuilder';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ReportResultTable, {
  type ResultColumnMeta,
} from '../components/Reports/ReportResultTable';
import { downloadCsv, reportCsvFilename, rowsToCsv } from '../lib/reportCsv';
import type { ReportColumnType } from '../lib/database.types';

// fix-69: Custom Report viewer. Runs a saved custom report and renders its
// rows in a sortable table with a CSV download. Reached from the Reporting
// hub's Run on a custom card (/reports/custom/:id).

export default function CustomReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAdmin = useIsTenantAdmin();

  const detailQ = useSavedReport(id);
  const catalogQ = useReportBuilderCatalog();
  const runQ = useCustomReport(id);

  const detail = detailQ.data ?? null;

  // Resolve column meta (label + type) from the catalog for the saved spec's
  // columns, preserving spec order. Falls back to deriving keys from the
  // first result row when the spec is somehow unavailable.
  const columns: ResultColumnMeta[] = useMemo(() => {
    const cat = catalogQ.data;
    const specCols = detail?.spec?.columns;
    const entityKey = detail?.spec?.entity;
    const keys =
      specCols && specCols.length > 0
        ? specCols
        : runQ.data?.rows?.[0]
          ? Object.keys(runQ.data.rows[0])
          : [];
    const entity = cat?.entities.find((e) => e.key === entityKey);
    return keys.map((k) => {
      const col = entity?.columns.find((c) => c.key === k);
      return {
        key: k,
        label: col?.label ?? k,
        type: (col?.type ?? 'text') as ReportColumnType,
      };
    });
  }, [catalogQ.data, detail, runQ.data]);

  const error = runQ.error ?? detailQ.error ?? catalogQ.error;
  if (error) {
    return (
      <QueryError
        title="Report failed to run"
        error={error}
        onRetry={() => {
          runQ.refetch();
          detailQ.refetch();
        }}
      />
    );
  }
  if (runQ.isLoading || detailQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-10" />;
  }

  const rows = runQ.data?.rows ?? [];

  function handleDownload() {
    const csv = rowsToCsv(
      columns.map((c) => ({ key: c.key, label: c.label })),
      rows,
    );
    downloadCsv(reportCsvFilename(detail?.name ?? 'report'), csv);
  }

  return (
    <div className="space-y-4" data-testid="custom-report-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Link
              to="/settings/reporting"
              className="text-xs font-bold text-de hover:underline"
              data-testid="custom-report-back"
            >
              ← Reporting
            </Link>
            <h1 className="text-xl font-extrabold text-text truncate">
              {detail?.name ?? 'Report'}
            </h1>
          </div>
          {detail?.description && (
            <p className="text-[11px] text-muted mt-0.5">{detail.description}</p>
          )}
          <p className="text-[10px] text-dim mt-0.5" data-testid="custom-report-meta">
            {runQ.data?.row_count ?? rows.length} row
            {(runQ.data?.row_count ?? rows.length) === 1 ? '' : 's'}
            {runQ.data?.executed_at
              ? ` · ${new Date(runQ.data.executed_at).toLocaleString()}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin && detail?.kind === 'custom' && (
            <button
              type="button"
              onClick={() => navigate(`/reports/builder/${id}`)}
              className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded border border-border text-text hover:bg-s2 transition"
              data-testid="custom-report-edit"
            >
              ✎ Edit
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={rows.length === 0}
            className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded border border-de bg-de text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="custom-report-download-csv"
          >
            ↓ Download CSV
          </button>
        </div>
      </div>

      <ReportResultTable columns={columns} rows={rows} />
    </div>
  );
}
