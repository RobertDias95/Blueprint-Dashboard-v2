import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  buildApprovedAwaitingRows,
  type ApprovedAwaitingRow,
} from '../lib/approvedAwaitingIssuance';
import type { Project } from '../lib/database.types';

// fix-221: "Approved – Awaiting Issuance" report. Seattle finishes review and
// approves a BP/Demo, then the permit sits in Accela "Issuance Prep" — an
// approval_date but no actual_issue. These finished-review permits used to fall
// in a gap (not "in review", not "issued") and vanished from every report. This
// is the "click in and see why they haven't issued" view: every approved-not-
// issued permit, sorted by how long it's been waiting, each row deep-linking to
// the permit in Project View (?permit=, fix-219).

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Today as YYYY-MM-DD (local). Isolated so the pure row builder stays testable. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ApprovedAwaitingIssuanceReport() {
  const permitsQ = usePermits();
  const projectsQ = useProjects();

  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projectsQ.data ?? []) m.set(p.id, p);
    return m;
  }, [projectsQ.data]);

  const rows = useMemo(
    () =>
      buildApprovedAwaitingRows(
        permitsQ.data ?? [],
        projectsById,
        todayIso(),
      ),
    [permitsQ.data, projectsById],
  );

  const error = permitsQ.error ?? projectsQ.error;
  const isLoading = permitsQ.isLoading || projectsQ.isLoading;

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-6" data-testid="approved-awaiting-report">
      <div className="mb-3">
        <Link
          to="/reports"
          className="text-[12px] text-de hover:underline"
          data-testid="aai-back-link"
        >
          ← Reports
        </Link>
      </div>

      <h1 className="text-lg font-extrabold text-text mb-1">
        Approved – Awaiting Issuance
      </h1>
      <p className="text-[12px] text-dim mb-4">
        Permits the city has approved (approval date set) but not yet issued —
        sitting in Issuance Prep. Sorted by how long they've been waiting.
      </p>

      {error ? (
        <QueryError
          title="Report failed to load"
          error={error}
          onRetry={() => {
            permitsQ.refetch();
            projectsQ.refetch();
          }}
        />
      ) : isLoading ? (
        <SkeletonRows count={8} rowClassName="h-7" />
      ) : rows.length === 0 ? (
        <div
          className="text-[12px] text-dim italic border rounded-md px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="aai-empty"
        >
          No permits are awaiting issuance. 🎉
        </div>
      ) : (
        <>
          <div className="text-[12px] text-muted mb-2" data-testid="aai-count">
            {rows.length} permit{rows.length === 1 ? '' : 's'} awaiting issuance
          </div>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left" style={{ background: 'var(--color-s2)' }}>
                <Th>Address</Th>
                <Th>Permit Type / #</Th>
                <Th>Juris</Th>
                <Th>DA</Th>
                <Th>Approved</Th>
                <Th>Days Waiting</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.permitId} row={row} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Row({ row }: { row: ApprovedAwaitingRow }) {
  return (
    <tr
      className="report-row border-b align-top"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={`aai-row-${row.permitId}`}
    >
      <Td>
        {/* fix-219 deep-link: open the permit in Project View. */}
        <Link
          to={`/project/${row.projectId}?permit=${row.permitId}`}
          className="text-de hover:underline"
          data-testid={`aai-link-${row.permitId}`}
        >
          {row.address ?? '—'}
        </Link>
      </Td>
      <Td>
        <span className="text-text">{row.type ?? '—'}</span>
        {row.num ? <span className="text-dim"> · {row.num}</span> : null}
      </Td>
      <Td>{row.juris ?? '—'}</Td>
      <Td>{row.da ?? '—'}</Td>
      <Td className="font-mono whitespace-nowrap">{fmtDate(row.approvalDate)}</Td>
      <Td className="font-mono whitespace-nowrap" testId={`aai-days-${row.permitId}`}>
        {row.daysSinceApproval == null ? '—' : `${row.daysSinceApproval}d`}
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1 font-bold text-text border-b" style={{ borderColor: 'var(--color-border)' }}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <td className={`px-2 py-1 ${className ?? ''}`} data-testid={testId}>
      {children}
    </td>
  );
}
