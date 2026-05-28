// fix-69: flat CSV export for custom report results. Generic over the
// spec's column keys (the Weekly DA report keeps its own bespoke export).

export interface CsvColumn {
  key: string;
  label: string;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Quote when the cell contains a comma, quote, or newline; double inner quotes.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string (CRLF line endings, Excel-friendly) from column defs +
 *  row objects keyed by column key. */
export function rowsToCsv(
  columns: CsvColumn[],
  rows: Array<Record<string, unknown>>,
): string {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = rows.map((r) =>
    columns.map((c) => csvCell(r[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Trigger a browser download of `csv` as `filename`. Uses an anchor +
 *  object URL so it works without a server round-trip. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `<name>-YYYY-MM-DD.csv`, name slugified to a safe filename. */
export function reportCsvFilename(name: string, now: Date = new Date()): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${slug}-${y}-${m}-${d}.csv`;
}
