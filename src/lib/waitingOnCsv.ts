import { quoteCell } from './csvExport';
import type { WaitingOnTaskRow } from './database.types';

// fix-140: CSV export for the My Tasks Waiting On view. Two flavours —
// all rows (denormalized) and a single firm's rows (for sending one
// consultant their open items). Reuses csvExport.quoteCell for the
// comma/quote/newline escaping.

const HEADERS = [
  'Discipline',
  'Firm Name',
  'Firm Status',
  'Project Address',
  'Jurisdiction',
  'Permit Type',
  'Task',
  'Assigned To',
  'Priority',
  'Start Date',
  'Due Date',
  'Target Date',
  'Status',
  'Created',
  'Updated',
  'Notes',
] as const;

/** Firm Status column: blank when no firm assigned, else Active / Archived. */
function firmStatus(row: WaitingOnTaskRow): string {
  if (row.firm_id === null) return '';
  return row.firm_active === false ? 'Archived' : 'Active';
}

function rowToCells(row: WaitingOnTaskRow): (string | number | null)[] {
  return [
    row.waiting_on,
    row.firm_name ?? '',
    firmStatus(row),
    row.project_address ?? '',
    row.project_juris ?? '',
    row.permit_type ?? '',
    row.task_text,
    row.assigned_to ?? '',
    row.priority ? 'Yes' : 'No',
    row.start_date ?? '',
    row.due_date ?? '',
    row.target_date ?? '',
    row.completion_status ?? '',
    row.created_at ?? '',
    row.updated_at ?? '',
    row.notes ?? '',
  ];
}

/** Build the CSV text (header + one line per row). Exported for testing so
 *  assertions don't need a DOM download. */
export function buildWaitingOnCsv(rows: WaitingOnTaskRow[]): string {
  const lines: string[] = [];
  lines.push(HEADERS.map((h) => quoteCell(h)).join(','));
  for (const row of rows) {
    lines.push(rowToCells(row).map(quoteCell).join(','));
  }
  return lines.join('\n');
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Trigger a browser download of the given CSV text. */
function downloadCsv(csv: string, filename: string): { bytes: number } {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return { bytes: new Blob([csv]).size };
}

/** Export every waiting-on row, fully denormalized. */
export function exportAllToCsv(rows: WaitingOnTaskRow[]): {
  rowsExported: number;
  filename: string;
} {
  const csv = buildWaitingOnCsv(rows);
  const filename = `waiting-on-${today()}.csv`;
  downloadCsv(csv, filename);
  return { rowsExported: rows.length, filename };
}

/** Export only the rows matching a (discipline, firmId) firm group. firmId
 *  null exports the "no firm assigned" rows for that discipline. */
export function exportFirmToCsv(
  rows: WaitingOnTaskRow[],
  firmFilter: { discipline: string; firmId: string | null },
): { rowsExported: number; filename: string } {
  const matching = rows.filter(
    (r) =>
      r.waiting_on === firmFilter.discipline && r.firm_id === firmFilter.firmId,
  );
  const csv = buildWaitingOnCsv(matching);
  const firmSlug =
    firmFilter.firmId === null
      ? 'no-firm'
      : slug(matching[0]?.firm_name ?? firmFilter.firmId);
  const filename = `waiting-on-${slug(firmFilter.discipline)}-${firmSlug}-${today()}.csv`;
  downloadCsv(csv, filename);
  return { rowsExported: matching.length, filename };
}
