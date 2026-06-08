import { downloadCsv } from '../../lib/reportCsv';

// fix-135-a: shared Export CSV button for analytics surfaces beyond
// Reports Overview. The Overview tab keeps its own bespoke button +
// pushToast call (Q9.5.d) so this button doesn't bind to that one
// surface's wiring; instead it's a generic primitive callers wrap
// around their already-prepared CSV string.
//
// Why a render-time onExport callback rather than passing rows + cols:
// the data may live behind a useMemo that the page already invalidates
// on filter change. By calling onExport at click time we avoid
// stringifying CSV content on every render — only when the user
// actually clicks export.
//
// Empty-state UX: when onExport() returns "" the click does nothing
// AND the button is rendered disabled with a tooltip. Visually the
// button still occupies the page header so the user doesn't have to
// re-scan after a filter change just to find it.

export interface ExportCsvButtonProps {
  filename: string;
  /** Called at click time; return the full CSV string. Returning ""
   *  (or null/undefined) disables the button and skips the download. */
  onExport: () => string | null | undefined;
  /** When provided, drives the disabled affordance directly. Useful
   *  when the parent already knows the row count and doesn't want to
   *  build the CSV string just to check emptiness. */
  disabled?: boolean;
  label?: string;
  testId?: string;
}

export default function ExportCsvButton({
  filename,
  onExport,
  disabled,
  label = '↓ Export CSV',
  testId,
}: ExportCsvButtonProps) {
  const isDisabled = !!disabled;
  return (
    <button
      type="button"
      onClick={() => {
        if (isDisabled) return;
        const csv = onExport();
        if (!csv) return;
        downloadCsv(filename, csv);
      }}
      disabled={isDisabled}
      title={isDisabled ? 'Nothing to export.' : undefined}
      className="px-3 py-1.5 rounded-md text-xs font-bold bg-de text-white border border-de hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
      data-testid={testId}
      data-disabled={isDisabled ? 'true' : 'false'}
    >
      {label}
    </button>
  );
}
