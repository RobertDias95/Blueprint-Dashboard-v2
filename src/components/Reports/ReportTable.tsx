import { useMemo, useState } from 'react';
import {
  aggregateByProject,
  matchesLedgerSearch,
  type EnrichedPermit,
  type ProjectRow,
} from '../../lib/reportMetrics';
import { effectiveStage } from '../../lib/permitStage';

// Q9.5.f-fix-4: v1 Permit Ledger parity. ReportTable shifts from per-permit
// rows to per-project rows; each row aggregates day metrics + key dates
// across the project's permits and expands to show individual permits on
// click (v1 :1158-1196).
//
// Column set widened from 12 → 19 to match the v1 ledger. Horizontal
// scroll handles narrow viewports. Sort is keyed on the aggregate values
// (so e.g. sorting by 'go' uses earliestGoDate).

type SortKey =
  | 'address'
  | 'juris'
  | 'stage'
  | 'ent'
  | 'da'
  | 'dm'
  | 'go'
  | 'approval'
  | 'actual'
  | 'variance';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const STAGE_LABELS: Record<string, string> = {
  de: 'D&E',
  pm: 'PM',
  co: 'CO',
  ap: 'Approved',
  is: 'Issued',
};

// Q9.5.f-fix-5: stage pill colors keyed to v2's CSS vars. `ap` reuses
// the `jv` (joint venture / approved) palette; everything else lines up
// 1:1 with the existing stage palette tokens.
const STAGE_PILL: Record<
  string,
  { bg: string; fg: string; border: string }
> = {
  de: { bg: 'var(--color-de-bg)', fg: 'var(--color-de)', border: 'var(--color-de-border)' },
  pm: { bg: 'var(--color-pm-bg)', fg: 'var(--color-pm)', border: 'var(--color-pm-border)' },
  co: { bg: 'var(--color-co-bg)', fg: 'var(--color-co)', border: 'var(--color-co-border)' },
  ap: { bg: 'var(--color-jv-bg)', fg: 'var(--color-jv)', border: 'var(--color-jv-border)' },
  is: { bg: 'var(--color-is-bg)', fg: 'var(--color-is)', border: 'var(--color-is-border)' },
};

function StagePill({ stage }: { stage: string }) {
  const p = STAGE_PILL[stage];
  const label = STAGE_LABELS[stage] ?? stage ?? '—';
  if (!p) return <span className="text-muted">{label || '—'}</span>;
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 10,
        fontWeight: 700,
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.border}`,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// Pink-tinted ENT pill — v1 marks ent_lead with a distinct color so it
// pops against the regular DA/DM names in the same row.
function EntPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 10,
        fontWeight: 700,
        background: 'rgba(244, 114, 182, 0.15)',
        color: '#be185d',
        border: '1px solid rgba(244, 114, 182, 0.4)',
        whiteSpace: 'nowrap',
      }}
    >
      {value}
    </span>
  );
}

// Q9.5.f-fix-5 D: per-metric accent color for the day cells. Variance is
// sign-aware (red late / green early); the rest are tone-cued by metric
// type so the eye can scan a row left-to-right and spot anomalies.
type MetricTone = 'pm' | 'de' | 'co';
const TONE_COLOR: Record<MetricTone, string> = {
  pm: 'var(--color-pm)',
  de: 'var(--color-de)',
  co: 'var(--color-co)',
};
function DayMetric({ value, tone }: { value: number | null; tone: MetricTone }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <span style={{ color: TONE_COLOR[tone], fontWeight: 600 }}>{value}d</span>
  );
}

interface ColDef {
  key: SortKey | null; // null when not sortable
  label: string;
  numeric?: boolean;
  testIdKey?: string;
}

// Order mirrors v1's ledger header at :1158-1196. Day-metric columns sort
// is omitted to keep the sort enum small — Bobby's tests only exercise
// address/juris/go, and the other agg columns sort logically by their
// underlying date field (e.g. variance ties back to approval date).
const COLS: ColDef[] = [
  { key: 'address', label: 'Address' },
  { key: null, label: 'Permits' },
  { key: 'stage', label: 'Stage' },
  { key: 'ent', label: 'ENT' },
  { key: 'da', label: 'DA' },
  { key: 'dm', label: 'DM' },
  { key: 'juris', label: 'Juris' },
  { key: null, label: 'GO→DD', numeric: true, testIdKey: 'go-dd' },
  { key: null, label: 'DD Dur.', numeric: true, testIdKey: 'dd-dur' },
  { key: null, label: 'DD→Sub', numeric: true, testIdKey: 'dd-sub' },
  { key: null, label: 'GO→Sub', numeric: true, testIdKey: 'go-sub' },
  { key: null, label: 'Sub→Int', numeric: true, testIdKey: 'sub-int' },
  { key: null, label: 'Review', numeric: true, testIdKey: 'review' },
  // fix-113-c: column is fed by latestAcqTarget which is just
  // max(expected_issue) across the project's permits (per fix-12 comment
  // "acq target proxy until task #63"). Header read as a real ACQ field;
  // rename to what's actually in the cell until task #63 ships ACQ targets.
  { key: null, label: 'Expected Issue (latest)' },
  { key: 'go', label: 'GO' },
  { key: 'approval', label: 'Approval' },
  { key: 'actual', label: 'Actual Issue' },
  { key: 'variance', label: 'Var.', numeric: true },
  { key: null, label: 'Rounds', numeric: true, testIdKey: 'rounds' },
  { key: null, label: 'Units', numeric: true, testIdKey: 'units' },
];

function sortValue(row: ProjectRow, key: SortKey): string | number | null {
  switch (key) {
    case 'address':
      return row.address;
    case 'juris':
      return row.juris;
    case 'stage':
      return row.dominantStage;
    case 'ent':
      return row.ent ?? '';
    case 'da':
      return row.da ?? '';
    case 'dm':
      return row.dm ?? '';
    case 'go':
      return row.earliestGoDate ?? '';
    case 'approval':
      return row.earliestApproval ?? '';
    case 'actual':
      return row.earliestActualIssue ?? '';
    case 'variance':
      return row.variance;
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: 'asc' | 'desc',
): number {
  const aNull = a === null || a === '';
  const bNull = b === null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b));
  return dir === 'asc' ? cmp : -cmp;
}

function fmtDays(n: number | null): string {
  if (n === null) return '—';
  return `${n}d`;
}

export default function ReportTable({
  permits,
}: {
  permits: EnrichedPermit[];
}) {
  const [sort, setSort] = useState<SortState>({ key: 'go', dir: 'desc' });
  // Q9.5.f-fix-4: expand-on-click state. project_ids whose row is expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Q9.5.f-fix-5: ledger-local filters layered ON TOP of the page-level
  // filter set passed in via `permits`. Page filters narrow to a working
  // set; these narrow further without disturbing the headline metric cards
  // / charts. Empty string / "all" = no further narrowing.
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const rows = useMemo(() => aggregateByProject(permits), [permits]);

  // Distinct assignee options for the local dropdown — union of ent/da/dm
  // across the unfiltered (passed-in) permit set so the dropdown stays
  // stable as the user narrows.
  const assigneeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.ent) s.add(r.ent);
      if (r.da) s.add(r.da);
      if (r.dm) s.add(r.dm);
    }
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (stageFilter !== 'all' && r.dominantStage !== stageFilter) return false;
      if (
        assigneeFilter !== 'all' &&
        r.ent !== assigneeFilter &&
        r.da !== assigneeFilter &&
        r.dm !== assigneeFilter
      ) {
        return false;
      }
      if (search.trim() && !matchesLedgerSearch(r, search)) return false;
      return true;
    });
  }, [rows, stageFilter, assigneeFilter, search]);

  const sorted = useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a, b) =>
      compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir),
    );
    return copy;
  }, [filtered, sort]);

  function onHeaderClick(key: SortKey | null) {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }
  function toggleExpand(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-testid="report-table"
    >
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
          Permit Ledger ({filtered.length} project{filtered.length === 1 ? '' : 's'} ·{' '}
          {permits.length} permit{permits.length === 1 ? '' : 's'})
        </div>
        <div className="text-[10px] text-dim">
          Click address to expand permits · click columns to sort
        </div>
      </div>
      {/* Q9.5.f-fix-5: ledger-local filter chrome. Stage + assignee selects
          + a smart multi-token search. State lives in this component so
          the page-level filter bar above isn't disturbed. */}
      <div
        className="px-4 py-2 border-b border-border flex items-center gap-2 flex-wrap"
        data-testid="report-table-controls"
      >
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="ledger-filter-stage"
        >
          <option value="all">All stages</option>
          <option value="de">D&amp;E</option>
          <option value="pm">PM</option>
          <option value="co">Corrections</option>
          <option value="ap">Approved</option>
          <option value="is">Issued</option>
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="ledger-filter-assignee"
        >
          <option value="all">All assignees</option>
          {assigneeOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address, DA, ENT, juris… (space or comma = AND)"
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text placeholder:text-dim focus:outline-none focus:border-de min-w-[260px] flex-1"
          data-testid="ledger-search"
        />
        {(stageFilter !== 'all' || assigneeFilter !== 'all' || search.trim()) && (
          <button
            type="button"
            onClick={() => {
              setStageFilter('all');
              setAssigneeFilter('all');
              setSearch('');
            }}
            className="text-[10px] px-2 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
            data-testid="ledger-filter-clear"
          >
            Clear
          </button>
        )}
      </div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="min-w-full text-[11px]">
          <thead className="bg-surface-2 sticky top-0">
            <tr>
              {COLS.map((col) => {
                const active = col.key !== null && sort.key === col.key;
                const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
                const tid = col.testIdKey ?? col.key ?? col.label.toLowerCase();
                return (
                  <th
                    key={tid}
                    onClick={() => onHeaderClick(col.key)}
                    className={`px-2 py-2 text-left font-display font-bold text-[10px] uppercase tracking-wide select-none whitespace-nowrap ${
                      col.key !== null ? 'cursor-pointer' : ''
                    } ${active ? 'text-text' : 'text-muted hover:text-text'} ${col.numeric ? 'text-right' : ''}`}
                    data-testid={`report-table-header-${tid}`}
                  >
                    {col.label}
                    {arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={COLS.length}
                  className="px-4 py-8 text-center text-dim italic"
                >
                  No permits match the current filter.
                </td>
              </tr>
            ) : (
              sorted.flatMap((row) => {
                const isOpen = expanded.has(row.projectId);
                const children: React.ReactNode[] = [
                  <ProjectRowTr
                    key={row.projectId}
                    row={row}
                    open={isOpen}
                    onToggle={() => toggleExpand(row.projectId)}
                  />,
                ];
                if (isOpen) {
                  for (const permit of row.permits) {
                    children.push(
                      <PermitDetailTr
                        key={`${row.projectId}-${permit.permit.id}`}
                        permit={permit}
                      />,
                    );
                  }
                }
                return children;
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectRowTr({
  row,
  open,
  onToggle,
}: {
  row: ProjectRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      className="border-t border-border/40 hover:bg-surface-2"
      data-testid={`report-table-row-${row.projectId}`}
    >
      <td
        onClick={onToggle}
        className="px-2 py-1.5 whitespace-nowrap text-text cursor-pointer font-bold"
      >
        <span
          className="inline-block mr-1 text-dim"
          style={{
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          ▶
        </span>
        {row.address || '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.permitCount} permit{row.permitCount === 1 ? '' : 's'}
        {row.activeCount > 0 && (
          <span className="ml-1 text-de">· {row.activeCount} active</span>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <StagePill stage={row.dominantStage} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <EntPill value={row.ent} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.da ?? '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.dm ?? '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.juris || '—'}</td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgGoToDDStart} tone="pm" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgDDDuration} tone="de" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgDDEndToSubmit} tone="co" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgGoToSubmit} tone="co" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgSubmitToIntake} tone="pm" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-right">
        <DayMetric value={row.avgCityReview} tone="pm" />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.latestAcqTarget ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestGoDate ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestApproval ?? '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted">
        {row.earliestActualIssue ?? '—'}
      </td>
      <td
        className={`px-2 py-1.5 whitespace-nowrap text-right ${
          row.variance === null
            ? 'text-muted'
            : row.variance > 0
              ? 'text-[#dc2626]'
              : 'text-pm'
        }`}
      >
        {row.variance !== null
          ? `${row.variance > 0 ? '+' : ''}${row.variance}d`
          : '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {row.maxCorrRounds || '—'}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted text-right">
        {row.units ?? '—'}
      </td>
    </tr>
  );
}

function PermitDetailTr({ permit: e }: { permit: EnrichedPermit }) {
  const stage = effectiveStage(e.permit, e.permit.permit_cycles ?? []);
  const stageLabel = STAGE_LABELS[stage] ?? stage ?? '—';
  return (
    <tr
      className="border-t border-border/20"
      style={{ background: 'var(--color-bg)' }}
      data-testid={`report-table-detail-${e.permit.id}`}
    >
      {/* Q9.5.f-fix-15: v1 expanded-row layout — permit TYPE in Address
          column, permit NUMBER (with portal_url ↗ when set) in Permits
          column. fix-14 had these reversed. The ↳ prefix stays in
          Address as the sub-row indicator. */}
      <td className="px-2 py-1 pl-8 whitespace-nowrap text-muted text-[10px]">
        ↳ {e.permit.type ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.num ? (
          e.permit.portal_url ? (
            <a
              href={e.permit.portal_url}
              target="_blank"
              rel="noreferrer"
              onClick={(ev) => ev.stopPropagation()}
              className="font-mono font-bold no-underline"
              style={{ color: 'var(--color-de)' }}
              data-testid={`report-table-permit-link-${e.permit.id}`}
            >
              {e.permit.num} ↗
            </a>
          ) : (
            <span className="font-mono">{e.permit.num}</span>
          )
        ) : (
          <span className="italic">no permit #</span>
        )}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {stageLabel}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.ent_lead ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.da ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.dm ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.juris || '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.goToDDStart)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.ddDuration)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.ddEndToSubmit)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.goToSubmit)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.submitToIntake)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {fmtDays(e.cityReviewDays)}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.expected_issue ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {/* fix-22 Mig 3: go_date is project-level; EnrichedPermit carries
            it as `goDate` (joined from projects). */}
        {e.goDate ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.approval_date ?? '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px]">
        {e.permit.actual_issue ?? '—'}
      </td>
      <td
        className={`px-2 py-1 whitespace-nowrap text-[10px] text-right ${
          e.variance === null
            ? 'text-dim'
            : e.variance > 0
              ? 'text-[#dc2626]'
              : 'text-pm'
        }`}
      >
        {e.variance !== null
          ? `${e.variance > 0 ? '+' : ''}${e.variance}d`
          : '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {/* Q9.5.f-fix-14 B: rounds = cycles with corr_issued (matches the
            project-row math from fix-12). Previous .length included cy0
            placeholder + empty cy1, inflating every count. */}
        {(e.permit.permit_cycles ?? []).filter((c) => c.corr_issued).length ||
          '—'}
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-dim text-[10px] text-right">
        {/* Q9.5.f-fix-14 C: units is project-level, blank on permit rows. */}
        —
      </td>
    </tr>
  );
}
