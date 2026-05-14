import type { EnrichedPermit } from './reportMetrics';

// Q9.5.d: CSV export for the Reports page header button. v1 column
// shape from index.html:6332 ported to v2's EnrichedPermit fields.
// The "ENT", "DA", "DM" columns pull from permits; ACQ excluded because
// permits don't carry an acq column (task #63 schema decision).

const HEADERS = [
  'Address',
  'Type',
  'Permit #',
  'Stage',
  'ENT',
  'DA',
  'DM',
  'Jurisdiction',
  'GO Date',
  'Target Submit',
  'Submitted',
  'Intake Accepted',
  'GO → Submit (d)',
  'DD Duration (d)',
  'DD End → Submit (d)',
  'Submit → Intake (d)',
  'City Review (d)',
  'Expected Issue',
  'Approval Date',
  'Actual Issue',
  'Variance (d)',
  'Correction Rounds',
  'Units',
] as const;

function quoteCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '""';
  const s = String(v);
  // Escape any embedded " by doubling it (CSV standard).
  return `"${s.replace(/"/g, '""')}"`;
}

function daysOrEmpty(n: number | null | undefined): string {
  return n == null ? '' : `${n}d`;
}

export function exportEnrichedPermitsToCSV(
  rows: EnrichedPermit[],
  filename?: string,
): { rowsExported: number; bytes: number; filename: string } {
  const lines: string[] = [];
  lines.push(HEADERS.map((h) => quoteCell(h)).join(','));

  for (const e of rows) {
    const p = e.permit;
    const cells = [
      e.address,
      p.type ?? '',
      p.num ?? '',
      // Stage derivation: use the override if present, else the column.
      p.stage_override ?? p.stage ?? '',
      p.ent_lead ?? '',
      p.da ?? p.architect ?? '',
      p.dm ?? '',
      e.juris,
      // fix-22 Mig 3: go_date + units moved to projects; EnrichedPermit
      // carries them via the project join.
      e.goDate ?? '',
      p.target_submit ?? '',
      e.firstSubmitted ?? '',
      e.firstIntakeAccepted ?? '',
      daysOrEmpty(e.goToSubmit),
      daysOrEmpty(e.ddDuration),
      daysOrEmpty(e.ddEndToSubmit),
      daysOrEmpty(e.submitToIntake),
      daysOrEmpty(e.cityReviewDays),
      p.expected_issue ?? '',
      p.approval_date ?? '',
      p.actual_issue ?? '',
      daysOrEmpty(e.variance),
      p.corr_rounds ?? 0,
      e.units ?? 0,
    ];
    lines.push(cells.map(quoteCell).join(','));
  }

  const csv = lines.join('\n');
  const bytes = new Blob([csv]).size;
  const stamp = new Date().toISOString().slice(0, 10);
  const finalFilename = filename ?? `blueprint_entitlements_${stamp}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = finalFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { rowsExported: rows.length, bytes, filename: finalFilename };
}
