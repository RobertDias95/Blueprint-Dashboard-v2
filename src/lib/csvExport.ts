import type { EnrichedPermit } from './reportMetrics';
import { effectiveStage } from './permitStage';

// Q9.5.d: CSV export for the Reports page header button. v1 column
// shape from index.html:6332 ported to v2's EnrichedPermit fields.
// The "ENT", "DA", "DM" columns pull from permits; ACQ excluded because
// permits don't carry an acq column (task #63 schema decision).

// fix-296b: exported so the rename guard can assert the header row without
// driving a real download.
export const CSV_HEADERS = [
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
  // fix-296b: were 'DD Duration (d)' / 'DD End → Submit (d)'. Same dates the
  // rest of the app now calls DD Start / DD End (fix-310).
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

// fix-140: exported so waitingOnCsv.ts reuses the exact same comma/quote/
// newline escaping (every cell wrapped in quotes, embedded quotes doubled).
export function quoteCell(v: string | number | null | undefined): string {
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
  lines.push(CSV_HEADERS.map((h) => quoteCell(h)).join(','));

  for (const e of rows) {
    const p = e.permit;
    const cells = [
      e.address,
      p.type ?? '',
      p.num ?? '',
      // ★★★ fix-498 (P-025): the DERIVED stage, not the stored column.
      //     This read was `p.stage_override ?? p.stage ?? ''` — the column
      //     `permits.stage`, which nothing kept current. On prod 2026-09-04,
      //     342 of 406 ISSUED permits still read 'de', so this export called
      //     every one of them "Design". `permits.stage` is dropped by this
      //     same fix; the derived stage is the only stage there is now.
      //
      // ★★ THE OVERRIDE STOPS BEING ABSOLUTE HERE, ON PURPOSE. It used to
      //    win outright in this one column; effectiveStage consults it via
      //    computeStage only after actual_issue / approval_date / a terminal
      //    portal status. That is how the Dashboard, the Library and the
      //    Project View have always read it — the export was the outlier, and
      //    an outlier is the whole shape of P-025.
      effectiveStage(p, p.permit_cycles ?? [], e.reviewers),
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
      daysOrEmpty(e.permitTimelineDays), // fix-141: renamed from cityReviewDays
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
