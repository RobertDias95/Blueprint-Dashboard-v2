import type { Permit, Project } from './database.types';
import { isApprovedNotIssued } from './effectiveIssued';
import { daysBetween } from './teamPerformance';

// fix-221: pure builder for the "Approved – Awaiting Issuance" report. Given the
// permit + project sets and today's ISO date, produces one row per approved-not-
// issued permit (the shared isApprovedNotIssued predicate), joined to its
// project for address/juris, with days-since-approval computed as-of-today.
// Sorted by days-since-approval DESC (oldest approvals first — the ones closest
// to / furthest past the finish line), address as a stable tiebreak.

export interface ApprovedAwaitingRow {
  permitId: number;
  projectId: string;
  address: string | null;
  juris: string | null;
  type: string | null;
  num: string | null;
  da: string | null;
  approvalDate: string | null;
  /** approval_date → today, in days. Null only if approval_date is malformed. */
  daysSinceApproval: number | null;
}

export function buildApprovedAwaitingRows(
  permits: Permit[],
  projectsById: Map<string, Project>,
  todayIso: string,
): ApprovedAwaitingRow[] {
  const rows: ApprovedAwaitingRow[] = [];
  for (const p of permits) {
    if (!isApprovedNotIssued(p)) continue;
    const project = projectsById.get(p.project_id);
    rows.push({
      permitId: p.id,
      projectId: p.project_id,
      address: project?.address ?? null,
      juris: project?.juris ?? null,
      type: p.type,
      num: p.num,
      da: p.da,
      approvalDate: p.approval_date ?? null,
      daysSinceApproval: daysBetween(p.approval_date ?? null, todayIso),
    });
  }
  rows.sort((a, b) => {
    // days-since-approval DESC; a null day count sorts last.
    const da = a.daysSinceApproval;
    const db = b.daysSinceApproval;
    if (da !== db) {
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    }
    return (a.address ?? '').localeCompare(b.address ?? '');
  });
  return rows;
}
