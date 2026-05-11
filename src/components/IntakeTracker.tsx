import { useMemo, useState } from 'react';
import { useIntakeRecords } from '../hooks/useIntakeRecords';
import { usePermits } from '../hooks/usePermits';
import {
  getWeekMondayKey,
  groupByWeek,
  intakeStatus,
  isPermitSubmitted,
  isUrgent,
  partitionIntakes,
  searchIntakes,
  weekCountTone,
  type IntakeStatus,
  type WeekCountTone,
} from '../lib/intakeHelpers';
import { SkeletonRows } from './Skeleton';
import QueryError from './QueryError';
import type {
  IntakeRecord,
  PermitWithCycles,
} from '../lib/database.types';

// Q6.3.b: read-only Seattle Intakes tracker (Settings → Seattle Intakes).
// Mirrors v1's renderIntakeTracker (index.html lines 9080-9241): past/
// future split, week-of-Monday grouping, urgency highlighting, 8-week
// count strip. Adds a v2 address search at top. Editing surfaces (add
// form, swap, placeholder toggle, remove, edit URL) are Q7.3.

const STATUS_BADGE: Record<IntakeStatus, { label: string; cls: string }> = {
  submitted: {
    label: '✓ Submitted',
    cls: 'bg-pm-bg text-pm border-pm-border',
  },
  reschedule: {
    label: '⚠ Reschedule',
    cls: 'bg-co-bg text-co border-co-border font-bold',
  },
  placeholder: {
    label: 'Placeholder',
    cls: 'bg-jv-bg text-jv border-jv-border',
  },
  real: {
    label: 'Real Project',
    cls: 'bg-pm-bg/40 text-pm border-pm-border',
  },
};

const TYPE_COLOR: Record<string, string> = {
  'Building Permit': 'text-de',
  Demolition: 'text-co',
};

const WEEK_COUNT_TONE: Record<WeekCountTone, string> = {
  empty: 'text-dim',
  light: 'text-co',
  normal: 'text-text',
  heavy: 'text-pm',
};

export default function IntakeTracker() {
  const intakesQ = useIntakeRecords();
  const permitsQ = usePermits();

  const error = intakesQ.error ?? permitsQ.error;
  if (error) {
    return (
      <QueryError
        title="Intakes failed to load"
        error={error}
        onRetry={() => {
          intakesQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }
  if (intakesQ.isLoading || permitsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-9" />;
  }

  return (
    <Body
      records={intakesQ.data ?? []}
      permits={permitsQ.data ?? []}
    />
  );
}

function Body({
  records,
  permits,
}: {
  records: IntakeRecord[];
  permits: PermitWithCycles[];
}) {
  const [search, setSearch] = useState('');
  const today = useMemo(() => new Date(), []);

  const permitById = useMemo(() => {
    const m = new Map<number, PermitWithCycles>();
    for (const p of permits) m.set(p.id, p);
    return m;
  }, [permits]);

  // Apply search FIRST so the count strip, week groupings, and past
  // collapse all reflect the same filtered set (search is consistent).
  const filtered = useMemo(
    () => searchIntakes(records, search),
    [records, search],
  );

  const { past, future } = useMemo(
    () => partitionIntakes(filtered, today),
    [filtered, today],
  );

  const futureWeeks = useMemo(() => groupByWeek(future), [future]);

  // 8-week count strip — scheduled weeks only (exclude 'unscheduled').
  const weekCountStrip = useMemo(
    () => futureWeeks.filter((w) => w.key !== 'unscheduled').slice(0, 8),
    [futureWeeks],
  );

  return (
    <div className="space-y-4" data-testid="intake-tracker">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search intakes by address (space/comma separated)…"
        className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        data-testid="intake-search"
      />

      {weekCountStrip.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          data-testid="intake-week-count-strip"
        >
          {weekCountStrip.map((w) => {
            const n = w.records.length;
            const tone = weekCountTone(n);
            return (
              <div
                key={w.key}
                className="bg-s2 border border-border rounded-md px-3 py-1.5 min-w-[88px] text-center"
                data-testid={`week-count-${w.key}`}
              >
                <div
                  className={`text-lg font-display font-black ${WEEK_COUNT_TONE[tone]}`}
                >
                  {n}
                </div>
                <div className="text-[8px] uppercase tracking-wide text-dim mt-0.5">
                  {w.label.replace('Week of ', '')}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {futureWeeks.length === 0 && past.length === 0 ? (
        <div
          className="bg-surface border border-border rounded-xl px-6 py-12 text-center"
          data-testid="intake-empty"
        >
          <div className="text-sm font-display font-bold text-text mb-1">
            No intake records
          </div>
          <div className="text-xs text-muted">
            {search.trim()
              ? 'No intakes match the current search.'
              : 'Seattle intake records will appear here as they\'re added.'}
          </div>
        </div>
      ) : (
        <>
          {futureWeeks.map((w) => {
            const weekUrgent = w.records.some((r) =>
              isUrgent(
                r.intake_date,
                isPermitSubmitted(r.permit_id ? permitById.get(r.permit_id) : null),
                today,
              ),
            );
            return (
              <WeekSection
                key={w.key}
                label={w.label}
                records={w.records}
                permitById={permitById}
                today={today}
                weekUrgent={weekUrgent}
              />
            );
          })}

          {past.length > 0 && (
            <details
              className="bg-surface border border-border rounded-xl px-4 py-2"
              data-testid="intake-past-details"
            >
              <summary className="text-[11px] font-display font-bold uppercase tracking-wide text-muted cursor-pointer py-1">
                Recent Submissions (last 10 business days — {past.length})
              </summary>
              <div className="mt-2 opacity-80">
                <IntakeTable
                  records={past}
                  permitById={permitById}
                  today={today}
                  testId="intake-past-table"
                />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function WeekSection({
  label,
  records,
  permitById,
  today,
  weekUrgent,
}: {
  label: string;
  records: IntakeRecord[];
  permitById: Map<number, PermitWithCycles>;
  today: Date;
  weekUrgent: boolean;
}) {
  const groupKey = records[0]?.intake_date
    ? getWeekMondayKey(records[0].intake_date)
    : 'unscheduled';
  return (
    <div className="space-y-1.5" data-testid={`week-section-${groupKey}`}>
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-display font-extrabold uppercase tracking-wide ${
            weekUrgent ? 'text-co' : 'text-text'
          }`}
        >
          {label}
        </span>
        <span className="text-[9px] text-muted">
          {records.length} intake{records.length === 1 ? '' : 's'}
        </span>
        {weekUrgent && (
          <span
            className="text-[9px] text-co font-bold"
            data-testid={`week-action-needed-${groupKey}`}
          >
            ⚠ Action needed
          </span>
        )}
      </div>
      <IntakeTable
        records={records}
        permitById={permitById}
        today={today}
        testId={`intake-week-table-${groupKey}`}
      />
    </div>
  );
}

function IntakeTable({
  records,
  permitById,
  today,
  testId,
}: {
  records: IntakeRecord[];
  permitById: Map<number, PermitWithCycles>;
  today: Date;
  testId: string;
}) {
  return (
    <div
      className="bg-surface border border-border rounded-md overflow-hidden"
      data-testid={testId}
    >
      <div className="grid grid-cols-[110px_1fr_140px_120px_120px] gap-0 bg-s2 border-b border-border px-3 py-1.5">
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Intake Date
        </div>
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Address
        </div>
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Permit #
        </div>
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Type
        </div>
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Status
        </div>
      </div>
      {records.map((r) => (
        <IntakeRow
          key={r.id}
          record={r}
          permit={r.permit_id ? permitById.get(r.permit_id) ?? null : null}
          today={today}
        />
      ))}
    </div>
  );
}

function IntakeRow({
  record,
  permit,
  today,
}: {
  record: IntakeRecord;
  permit: PermitWithCycles | null;
  today: Date;
}) {
  const status = intakeStatus(record, permit, today);
  const badge = STATUS_BADGE[status];
  const typeColor = TYPE_COLOR[record.permit_type ?? ''] ?? 'text-muted';
  // Q6.3.b: portal_url makes the permit# a clickable link. Editor lands in Q7.3.
  const url = record.portal_url || record.link || '';
  return (
    <div
      className={`grid grid-cols-[110px_1fr_140px_120px_120px] gap-0 px-3 py-1.5 border-b border-border last:border-b-0 items-center ${
        status === 'reschedule' ? 'bg-co-bg/30' : ''
      }`}
      data-testid={`intake-row-${record.id}`}
    >
      <div className="text-[10px] font-mono text-text">
        {record.intake_date ?? <span className="text-dim">—</span>}
      </div>
      <div className="text-[11px] font-display font-semibold text-text truncate">
        {record.address ?? <span className="text-dim">—</span>}
      </div>
      <div className="text-[10px] font-mono">
        {record.permit_num ? (
          url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-de hover:underline font-bold"
              title="Open city portal"
              data-testid={`intake-portal-link-${record.id}`}
            >
              {record.permit_num} ↗
            </a>
          ) : (
            <span className="text-dim">{record.permit_num}</span>
          )
        ) : (
          <span className="text-dim">—</span>
        )}
      </div>
      <div className={`text-[10px] font-bold ${typeColor}`}>
        {record.permit_type ?? <span className="text-dim">—</span>}
      </div>
      <div>
        <span
          className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${badge.cls}`}
          data-testid={`intake-status-${record.id}`}
        >
          {badge.label}
        </span>
      </div>
    </div>
  );
}
