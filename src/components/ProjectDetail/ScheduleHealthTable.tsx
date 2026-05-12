import { effectiveStage } from '../../lib/permitStage';
import type { PermitWithCycles, Stage } from '../../lib/database.types';

// Q9.5.e: Schedule Health summary table per v1 §4.2.1 (B). v1 has 8
// columns (Permit Type / Tasks / Stage / Permit Status / Data Source /
// Est. Approval / ACQ Target Date / Schedule Health). v2 ships 5
// columns this phase — the 3 deferred (Tasks count / Data Source /
// ACQ Target Date / Schedule Health) need data wiring that hasn't
// landed yet: Tasks count needs an aggregate query, Data Source +
// Schedule Health are computed from the v1 learner state, ACQ Target
// Date is blocked on task #63 (no permits.acq_lead column).
//
// Q9.5.f polish (or follow-up Q9.5.e-fix) can fill the 3 remaining
// columns. The 5-col version below covers the visible "what's the
// state of each permit at a glance" need today.

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

const STAGE_TINT: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

interface Props {
  permits: PermitWithCycles[];
}

export default function ScheduleHealthTable({ permits }: Props) {
  if (permits.length === 0) {
    return (
      <div className="text-xs text-dim italic px-3 py-3.5">
        No permits on this project. Add one in the Settings modal.
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 border-b border-border bg-surface"
      data-testid="schedule-health-table"
    >
      <div className="text-center pt-2.5 pb-1">
        <div className="text-xs font-extrabold text-text uppercase tracking-wider">
          Schedule Health
        </div>
      </div>
      <table className="w-full border-collapse mt-2">
        <colgroup>
          <col style={{ width: 160 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 130 }} />
        </colgroup>
        <thead>
          <tr
            className="border-b-2"
            style={{
              background: 'var(--color-s2)',
              borderBottomColor: 'var(--color-border)',
            }}
          >
            <Th align="left">Permit Type</Th>
            <Th>Stage</Th>
            <Th>Target Submit</Th>
            <Th>Est. Approval</Th>
            <Th>Variance</Th>
          </tr>
        </thead>
        <tbody>
          {permits.map((p) => (
            <Row key={p.id} permit={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ permit }: { permit: PermitWithCycles }) {
  const stage = effectiveStage(permit, permit.permit_cycles ?? []);
  const variance = computeVariance(permit);

  return (
    <tr
      className="border-b last:border-b-0"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid={`schedule-health-row-${permit.id}`}
    >
      <td className="px-3 py-1.5 text-xs text-text">
        {permit.type ?? '—'}
        {permit.num && (
          <span className="ml-2 text-[10px] text-muted font-mono">
            {permit.num}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center border-l" style={{ borderLeftColor: 'var(--color-border)' }}>
        <span
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: STAGE_TINT[stage] }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center border-l text-[10px] font-mono text-text" style={{ borderLeftColor: 'var(--color-border)' }}>
        {permit.target_submit ?? '—'}
      </td>
      <td className="px-2 py-1.5 text-center border-l text-[10px] font-mono text-text" style={{ borderLeftColor: 'var(--color-border)' }}>
        {permit.expected_issue ?? '—'}
      </td>
      <td
        className="px-2 py-1.5 text-center border-l text-[10px] font-mono"
        style={{
          borderLeftColor: 'var(--color-border)',
          color:
            variance === null
              ? 'var(--color-dim)'
              : variance > 0
                ? '#dc2626'
                : 'var(--color-pm)',
        }}
      >
        {variance !== null ? `${variance > 0 ? '+' : ''}${variance}d` : '—'}
      </td>
    </tr>
  );
}

function Th({
  children,
  align = 'center',
}: {
  children: React.ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <th
      className={`px-3 py-1.5 text-[10px] font-extrabold text-text uppercase tracking-wider border-l first:border-l-0 ${
        align === 'left' ? 'text-left' : 'text-center'
      }`}
      style={{ borderLeftColor: 'var(--color-border)' }}
    >
      {children}
    </th>
  );
}

function computeVariance(p: PermitWithCycles): number | null {
  // expected_issue - (approval_date ?? actual_issue), in days.
  // Positive = late, negative = ahead.
  const expected = p.expected_issue;
  const actual = p.approval_date ?? p.actual_issue;
  if (!expected || !actual) return null;
  const exp = new Date(expected + 'T12:00:00').getTime();
  const act = new Date(actual + 'T12:00:00').getTime();
  if (Number.isNaN(exp) || Number.isNaN(act)) return null;
  return Math.round((act - exp) / (24 * 60 * 60 * 1000));
}
