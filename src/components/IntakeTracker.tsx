import { useMemo, useState } from 'react';
import { useIntakeRecords } from '../hooks/useIntakeRecords';
import { usePermits } from '../hooks/usePermits';
import { usePermitTypes } from '../hooks/usePermitTypes';
import { useUpsertIntakeRecord } from '../hooks/useUpsertIntakeRecord';
import { useDeleteIntakeRecord } from '../hooks/useDeleteIntakeRecord';
import { useSwapIntakeDates } from '../hooks/useSwapIntakeDates';
import {
  getWeekMondayKey,
  groupByWeek,
  intakeStatus,
  intakeTargetGapDays,
  isIntakeTargetGapFlagged,
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
// Q6.3.c: editing surfaces added — add-row form, inline cell edits,
// × remove, placeholder toggle (click status badge), portal URL edit,
// swap mode (🔀 per-row button → click another row's 🔀 to atomically
// swap intake_date values via bp_swap_intake_dates). Closes the Q7.3
// admin-surface epic.

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
  const typesQ = usePermitTypes();

  const error = intakesQ.error ?? permitsQ.error ?? typesQ.error;
  if (error) {
    return (
      <QueryError
        title="Intakes failed to load"
        error={error}
        onRetry={() => {
          intakesQ.refetch();
          permitsQ.refetch();
          typesQ.refetch();
        }}
      />
    );
  }
  if (intakesQ.isLoading || permitsQ.isLoading || typesQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-9" />;
  }

  return (
    <Body
      records={intakesQ.data ?? []}
      permits={permitsQ.data ?? []}
      typeOptions={(typesQ.data ?? []).map((t) => t.name)}
    />
  );
}

function Body({
  records,
  permits,
  typeOptions,
}: {
  records: IntakeRecord[];
  permits: PermitWithCycles[];
  typeOptions: string[];
}) {
  const [search, setSearch] = useState('');
  const [swapSelectedId, setSwapSelectedId] = useState<number | null>(null);
  const today = useMemo(() => new Date(), []);
  const upsert = useUpsertIntakeRecord();
  const remove = useDeleteIntakeRecord();
  const swap = useSwapIntakeDates();

  function handleSwapClick(record: IntakeRecord) {
    if (swapSelectedId === null) {
      setSwapSelectedId(record.id);
      return;
    }
    if (swapSelectedId === record.id) {
      setSwapSelectedId(null);
      return;
    }
    const a = records.find((r) => r.id === swapSelectedId);
    if (!a) {
      setSwapSelectedId(record.id);
      return;
    }
    swap.mutate(
      {
        idA: a.id,
        idB: record.id,
        expectedA: a.updated_at,
        expectedB: record.updated_at,
      },
      { onSettled: () => setSwapSelectedId(null) },
    );
  }

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

      <AddIntakeForm
        typeOptions={typeOptions}
        onAdd={(patch) => upsert.mutate({ op: 'insert', patch })}
      />

      {swapSelectedId !== null && (
        <div
          className="bg-jv-bg/40 border border-jv-border rounded-md px-3 py-2 text-xs text-jv flex items-center justify-between"
          data-testid="intake-swap-pending"
        >
          <span>
            🔀 Swap mode — click another row's 🔀 to swap intake dates with{' '}
            <span className="font-bold">
              {records.find((r) => r.id === swapSelectedId)?.address ?? '…'}
            </span>
            .
          </span>
          <button
            onClick={() => setSwapSelectedId(null)}
            className="text-[10px] px-2 py-0.5 rounded border border-jv-border bg-surface text-jv"
            data-testid="intake-swap-cancel"
          >
            Cancel
          </button>
        </div>
      )}

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
                typeOptions={typeOptions}
                swapSelectedId={swapSelectedId}
                onPatch={(r, patch) =>
                  upsert.mutate({ op: 'update', record: r, patch })
                }
                onRemove={(r) =>
                  remove.mutate({ id: r.id, updated_at: r.updated_at })
                }
                onSwap={handleSwapClick}
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
                  typeOptions={typeOptions}
                  swapSelectedId={swapSelectedId}
                  onPatch={(r, patch) =>
                    upsert.mutate({ op: 'update', record: r, patch })
                  }
                  onRemove={(r) =>
                    remove.mutate({ id: r.id, updated_at: r.updated_at })
                  }
                  onSwap={handleSwapClick}
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

type IntakeRowPatch = Partial<
  Pick<
    IntakeRecord,
    | 'address'
    | 'permit_num'
    | 'permit_type'
    | 'intake_date'
    | 'is_placeholder'
    | 'portal_url'
  >
>;

interface EditorProps {
  typeOptions: string[];
  swapSelectedId: number | null;
  onPatch: (r: IntakeRecord, patch: IntakeRowPatch) => void;
  onRemove: (r: IntakeRecord) => void;
  onSwap: (r: IntakeRecord) => void;
}

function WeekSection({
  label,
  records,
  permitById,
  today,
  weekUrgent,
  typeOptions,
  swapSelectedId,
  onPatch,
  onRemove,
  onSwap,
}: {
  label: string;
  records: IntakeRecord[];
  permitById: Map<number, PermitWithCycles>;
  today: Date;
  weekUrgent: boolean;
} & EditorProps) {
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
        typeOptions={typeOptions}
        swapSelectedId={swapSelectedId}
        onPatch={onPatch}
        onRemove={onRemove}
        onSwap={onSwap}
        testId={`intake-week-table-${groupKey}`}
      />
    </div>
  );
}

function IntakeTable({
  records,
  permitById,
  today,
  typeOptions,
  swapSelectedId,
  onPatch,
  onRemove,
  onSwap,
  testId,
}: {
  records: IntakeRecord[];
  permitById: Map<number, PermitWithCycles>;
  today: Date;
  testId: string;
} & EditorProps) {
  return (
    <div
      className="bg-surface border border-border rounded-md overflow-hidden"
      data-testid={testId}
    >
      <div className="grid grid-cols-[100px_96px_1fr_120px_100px_110px_84px] gap-0 bg-s2 border-b border-border px-3 py-1.5">
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Intake Date
        </div>
        {/* fix-199: target_submit beside the intake date — discrepancy spotting. */}
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide">
          Target
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
        <div className="text-[8px] font-bold text-dim uppercase tracking-wide text-right">
          Actions
        </div>
      </div>
      {records.map((r) => (
        <IntakeRow
          key={r.id}
          record={r}
          permit={r.permit_id ? permitById.get(r.permit_id) ?? null : null}
          today={today}
          typeOptions={typeOptions}
          swapSelected={swapSelectedId === r.id}
          swapAnotherActive={
            swapSelectedId !== null && swapSelectedId !== r.id
          }
          onPatch={onPatch}
          onRemove={onRemove}
          onSwap={onSwap}
        />
      ))}
    </div>
  );
}

function IntakeRow({
  record,
  permit,
  today,
  typeOptions,
  swapSelected,
  swapAnotherActive,
  onPatch,
  onRemove,
  onSwap,
}: {
  record: IntakeRecord;
  permit: PermitWithCycles | null;
  today: Date;
  typeOptions: string[];
  swapSelected: boolean;
  swapAnotherActive: boolean;
  onPatch: (
    r: IntakeRecord,
    patch: Partial<
      Pick<
        IntakeRecord,
        | 'address'
        | 'permit_num'
        | 'permit_type'
        | 'intake_date'
        | 'is_placeholder'
        | 'portal_url'
      >
    >,
  ) => void;
  onRemove: (r: IntakeRecord) => void;
  onSwap: (r: IntakeRecord) => void;
}) {
  const status = intakeStatus(record, permit, today);
  const badge = STATUS_BADGE[status];
  const typeColor = TYPE_COLOR[record.permit_type ?? ''] ?? 'text-muted';
  const url = record.portal_url || record.link || '';
  // fix-199: target_submit vs intake gap (from the linked permit).
  const targetSubmit = permit?.target_submit ?? null;
  const gap = intakeTargetGapDays(record.intake_date, targetSubmit);
  const gapFlagged = isIntakeTargetGapFlagged(gap);
  return (
    <div
      className={`grid grid-cols-[100px_96px_1fr_120px_100px_110px_84px] gap-0 px-3 py-1.5 border-b border-border last:border-b-0 items-center ${
        status === 'reschedule' ? 'bg-co-bg/30' : ''
      } ${swapSelected ? 'ring-2 ring-jv ring-inset' : ''}`}
      data-testid={`intake-row-${record.id}`}
    >
      <InlineDate
        value={record.intake_date}
        onCommit={(v) =>
          v !== (record.intake_date ?? '') && onPatch(record, { intake_date: v || null })
        }
        testId={`intake-date-${record.id}`}
      />
      {/* fix-199: target submit + gap flag (read-only; from the linked permit). */}
      <div
        className="text-[9px] font-mono pr-1.5 truncate"
        style={{ color: gapFlagged ? 'var(--color-co)' : 'var(--color-muted)' }}
        title={
          targetSubmit && gap !== null
            ? `Target submit ${targetSubmit} — intake is ${Math.abs(gap)}d ${gap >= 0 ? 'after' : 'before'}`
            : 'No linked permit target submit'
        }
        data-testid={`intake-target-${record.id}`}
      >
        {targetSubmit ? (
          <>
            {gapFlagged && '⚠ '}
            {targetSubmit}
            {gap !== null && ` (${gap >= 0 ? '+' : ''}${gap}d)`}
          </>
        ) : (
          <span className="text-dim">—</span>
        )}
      </div>
      <InlineText
        value={record.address ?? ''}
        onCommit={(v) =>
          v !== (record.address ?? '') && onPatch(record, { address: v || null })
        }
        placeholder="Address…"
        className="text-[11px] font-display font-semibold text-text truncate"
        testId={`intake-addr-${record.id}`}
      />
      <PermitNumCell
        record={record}
        url={url}
        onCommit={(v) =>
          v !== (record.permit_num ?? '') && onPatch(record, { permit_num: v || null })
        }
        testId={`intake-num-${record.id}`}
      />
      <InlineSelect
        value={record.permit_type ?? ''}
        options={typeOptions}
        onCommit={(v) =>
          v !== (record.permit_type ?? '') && onPatch(record, { permit_type: v || null })
        }
        className={`text-[10px] font-bold ${typeColor}`}
        testId={`intake-type-${record.id}`}
      />
      <button
        onClick={() => onPatch(record, { is_placeholder: !record.is_placeholder })}
        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border text-left ${badge.cls}`}
        title="Click to toggle placeholder"
        data-testid={`intake-status-${record.id}`}
      >
        {badge.label}
      </button>
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => onSwap(record)}
          className={`text-[11px] px-1.5 py-0.5 rounded border ${
            swapSelected
              ? 'bg-jv text-white border-jv'
              : swapAnotherActive
                ? 'bg-jv-bg text-jv border-jv-border'
                : 'bg-surface text-muted border-border hover:text-text'
          }`}
          title={
            swapSelected
              ? 'Cancel swap selection'
              : swapAnotherActive
                ? 'Swap intake dates with the selected row'
                : 'Start swap'
          }
          data-testid={`intake-swap-${record.id}`}
        >
          🔀
        </button>
        <PortalUrlEditor
          record={record}
          onCommit={(v) =>
            v !== (record.portal_url ?? '') && onPatch(record, { portal_url: v || null })
          }
          testId={`intake-url-${record.id}`}
        />
        <button
          onClick={() => {
            if (!confirm(`Remove intake for "${record.address ?? '(no address)'}"?`)) return;
            onRemove(record);
          }}
          className="text-dim hover:text-co text-sm leading-none"
          title="Remove intake"
          data-testid={`intake-remove-${record.id}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// fix-213: the Permit # cell. When the row carries a portal URL, the permit
// number IS the hyperlink to the city portal (styled like the Activity page's
// permit-number link), with a small ✎ toggle so the number stays editable.
// When there's no portal URL (e.g. an OPEN/placeholder row), it's plain
// click-to-edit text — never a dead link.
function PermitNumCell({
  record,
  url,
  onCommit,
  testId,
}: {
  record: IntakeRecord;
  url: string;
  onCommit: (v: string) => void;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.permit_num ?? '');
  function start() {
    setDraft(record.permit_num ?? '');
    setEditing(true);
  }
  function commit() {
    onCommit(draft);
    setEditing(false);
  }
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(record.permit_num ?? '');
            setEditing(false);
          }
        }}
        placeholder="permit#"
        className="text-[10px] font-mono w-full min-w-0 bg-bg border border-de rounded px-1 py-0 outline-none"
        data-testid={testId}
      />
    );
  }
  if (url) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-text font-bold underline decoration-dotted decoration-muted underline-offset-2 hover:decoration-solid hover:text-de transition-colors truncate min-w-0"
          title="Open city portal (new tab)"
          aria-label={`Open ${record.permit_num || 'permit'} in city portal (new tab)`}
          data-testid={testId}
        >
          {record.permit_num || 'View ↗'}
        </a>
        <button
          onClick={start}
          className="text-dim hover:text-text text-[9px] leading-none shrink-0"
          title="Edit permit #"
          data-testid={`intake-num-edit-${record.id}`}
        >
          ✎
        </button>
      </div>
    );
  }
  return (
    <span
      onClick={start}
      className={`text-[10px] font-mono cursor-text hover:bg-bg/40 rounded px-0.5 ${
        record.permit_num ? '' : 'text-dim italic'
      }`}
      title="Click to edit"
      data-testid={testId}
    >
      {record.permit_num || 'permit#'}
    </span>
  );
}

// fix-213: the Actions-column portal-URL control. The portal link itself now
// lives on the Permit #, so this is just the edit affordance — a compact
// labeled button (✎ URL / + URL) that toggles to a text input, instead of
// dumping the raw URL string into the row.
function PortalUrlEditor({
  record,
  onCommit,
  testId,
}: {
  record: IntakeRecord;
  onCommit: (v: string) => void;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.portal_url ?? '');
  function start() {
    setDraft(record.portal_url ?? '');
    setEditing(true);
  }
  function commit() {
    onCommit(draft);
    setEditing(false);
  }
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(record.portal_url ?? '');
            setEditing(false);
          }
        }}
        placeholder="https://…"
        className="text-[9px] font-mono w-24 min-w-0 bg-bg border border-de rounded px-1 py-0 outline-none"
        data-testid={testId}
      />
    );
  }
  return (
    <button
      onClick={start}
      className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-surface text-muted hover:text-text whitespace-nowrap"
      title={record.portal_url ? 'Edit portal URL' : 'Add portal URL'}
      data-testid={testId}
    >
      {record.portal_url ? '✎ URL' : '+ URL'}
    </button>
  );
}

// ============================================================
// Small inline-edit primitives. Click to switch to input; Enter or
// blur commits; Esc cancels. Tight on screen real estate because
// the row layout is dense.
// ============================================================

function InlineText({
  value,
  onCommit,
  placeholder,
  className,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function start() {
    setDraft(value);
    setEditing(true);
  }
  function commit() {
    onCommit(draft);
    setEditing(false);
  }
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className={`${className ?? ''} bg-bg border border-de rounded px-1 py-0 outline-none`}
        data-testid={testId}
      />
    );
  }
  return (
    <span
      onClick={start}
      className={`${className ?? ''} cursor-text hover:bg-bg/40 rounded px-0.5 ${!value ? 'text-dim italic' : ''}`}
      title="Click to edit"
      data-testid={testId}
    >
      {value || placeholder || '—'}
    </span>
  );
}

function InlineDate({
  value,
  onCommit,
  testId,
}: {
  value: string | null;
  onCommit: (v: string) => void;
  testId?: string;
}) {
  // For dates we just render the native date input — no click-to-edit
  // mode swap since dates are short and the input is small.
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onCommit(e.target.value)}
      className="text-[10px] font-mono text-text bg-transparent border border-transparent hover:border-border focus:border-de rounded px-0.5 py-0 outline-none w-full"
      data-testid={testId}
    />
  );
}

function InlineSelect({
  value,
  options,
  onCommit,
  className,
  testId,
}: {
  value: string;
  options: string[];
  onCommit: (v: string) => void;
  className?: string;
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className={`${className ?? ''} bg-transparent border border-transparent hover:border-border focus:border-de rounded px-0.5 outline-none cursor-pointer`}
      data-testid={testId}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}

function AddIntakeForm({
  typeOptions,
  onAdd,
}: {
  typeOptions: string[];
  onAdd: (patch: {
    address: string;
    permit_num: string | null;
    permit_type: string | null;
    intake_date: string | null;
    portal_url: string | null;
    is_placeholder: boolean;
  }) => void;
}) {
  const [address, setAddress] = useState('');
  const [permitNum, setPermitNum] = useState('');
  const [permitType, setPermitType] = useState('Building Permit');
  const [intakeDate, setIntakeDate] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const canAdd = address.trim().length > 0;

  function submit(asPlaceholder: boolean) {
    if (!canAdd) return;
    onAdd({
      address: address.trim(),
      permit_num: permitNum.trim() || null,
      permit_type: permitType || null,
      intake_date: intakeDate || null,
      portal_url: portalUrl.trim() || null,
      is_placeholder: asPlaceholder,
    });
    setAddress('');
    setPermitNum('');
    setIntakeDate('');
    setPortalUrl('');
  }

  return (
    <div
      className="bg-surface border border-border rounded-md p-2 flex flex-wrap gap-1.5 items-center"
      data-testid="intake-add-form"
    >
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Address (required)"
        className="flex-1 min-w-[140px] px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
        data-testid="intake-add-address"
      />
      <input
        type="text"
        value={permitNum}
        onChange={(e) => setPermitNum(e.target.value)}
        placeholder="Permit #"
        className="w-28 px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de font-mono"
        data-testid="intake-add-num"
      />
      <select
        value={permitType}
        onChange={(e) => setPermitType(e.target.value)}
        className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none"
        data-testid="intake-add-type"
      >
        {typeOptions.length === 0 ? (
          <option value="">— no permit types —</option>
        ) : (
          typeOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))
        )}
      </select>
      <input
        type="date"
        value={intakeDate}
        onChange={(e) => setIntakeDate(e.target.value)}
        className="px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none"
        data-testid="intake-add-date"
      />
      <input
        type="text"
        value={portalUrl}
        onChange={(e) => setPortalUrl(e.target.value)}
        placeholder="Portal URL"
        className="w-32 px-2 py-1 text-xs border border-border rounded bg-bg text-text outline-none font-mono"
        data-testid="intake-add-url"
      />
      <button
        onClick={() => submit(false)}
        disabled={!canAdd}
        className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90 disabled:opacity-50"
        data-testid="intake-add-real"
      >
        Add
      </button>
      <button
        onClick={() => submit(true)}
        disabled={!canAdd}
        className="px-3 py-1 text-xs font-display font-semibold bg-jv-bg text-jv border border-jv-border rounded hover:bg-jv-bg/60 disabled:opacity-50"
        data-testid="intake-add-placeholder"
      >
        + Placeholder
      </button>
    </div>
  );
}
