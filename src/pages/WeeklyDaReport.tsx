import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { useWeeklyDaReport } from '../hooks/useWeeklyDaReport';
import { useUpsertReportNote } from '../hooks/useUpsertReportNote';
import { usePermits } from '../hooks/usePermits';
import { useProjects } from '../hooks/useProjects';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import type {
  WeeklyDaReportFilters,
  WeeklyDaReportGroup,
  WeeklyDaReportRow,
} from '../lib/database.types';

// fix-67: Weekly DA Update report — the flagship report in the Reports hub
// (Phase 1). The entitlement lead sends each DA a one-pager: their permits
// in corrections (with the date corrections came out), a persistent NOTES
// column that carries forward week over week, and their upcoming intakes
// for the window. Filterable, printable (browser Print -> Save as PDF).

const FILTER_STORAGE_KEY = 'bp_weekly_da_report_filters';
const WINDOW_DEFAULT = 14;

interface PersistedState {
  weekStart: string;
  windowDays: number;
  filters: WeeklyDaReportFilters;
}

/** Monday of the week containing `d` (ISO Mon–Sun week), as YYYY-MM-DD. */
function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow; // back up to Monday
  copy.setDate(copy.getDate() + diff);
  return toISODate(copy);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        weekStart:
          typeof parsed.weekStart === 'string' ? parsed.weekStart : mondayOf(new Date()),
        windowDays:
          typeof parsed.windowDays === 'number' ? parsed.windowDays : WINDOW_DEFAULT,
        filters:
          parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {},
      };
    }
  } catch {
    // ignore — corrupt storage falls back to defaults
  }
  return null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function WeeklyDaReport() {
  const persisted = useMemo(() => loadPersisted(), []);
  const [weekStart, setWeekStart] = useState(
    () => persisted?.weekStart ?? mondayOf(new Date()),
  );
  const [windowDays, setWindowDays] = useState(
    () => persisted?.windowDays ?? WINDOW_DEFAULT,
  );
  const [filters, setFilters] = useState<WeeklyDaReportFilters>(
    () => persisted?.filters ?? {},
  );

  // Persist filter set so a returning user keeps their last view (mirrors
  // the Activity page's localStorage persistence).
  useEffect(() => {
    try {
      localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ weekStart, windowDays, filters }),
      );
    } catch {
      // ignore
    }
  }, [weekStart, windowDays, filters]);

  // Filter dropdown options come from the app-wide permits/projects caches
  // (already loaded elsewhere) — cheap + keeps the report self-contained.
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const options = useMemo(() => {
    const ent = new Set<string>();
    const type = new Set<string>();
    const status = new Set<string>();
    const da = new Set<string>();
    for (const p of permitsQ.data ?? []) {
      if (p.ent_lead) ent.add(p.ent_lead);
      if (p.type) type.add(p.type);
      if (p.status) status.add(p.status);
      if (p.da) da.add(p.da);
    }
    const juris = new Set<string>();
    for (const pr of projectsQ.data ?? []) if (pr.juris) juris.add(pr.juris);
    const sorted = (s: Set<string>) => Array.from(s).sort();
    return {
      ent: sorted(ent),
      type: sorted(type),
      status: sorted(status),
      juris: sorted(juris),
      da: sorted(da),
    };
  }, [permitsQ.data, projectsQ.data]);

  // Auto-refresh: the query key folds in week / window / filters.
  const reportQ = useWeeklyDaReport(weekStart, windowDays, filters);

  function setFilter(key: keyof WeeklyDaReportFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  function clearFilters() {
    setFilters({});
  }

  const das = reportQ.data?.das ?? [];

  return (
    <div className="space-y-4 report-print-root" data-testid="weekly-da-report">
      {/* Header + actions — hidden when printing */}
      <div
        className="flex items-center justify-between flex-wrap gap-3 print-hide"
        data-testid="wdr-header"
      >
        <div className="flex items-center gap-3">
          <Link
            to="/reports"
            className="text-xs font-bold text-de hover:underline"
            data-testid="wdr-back"
          >
            ← Reports
          </Link>
          <h1 className="text-xl font-extrabold text-text">Weekly DA Update</h1>
        </div>
        <button
          onClick={() => window.print()}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-de text-white border border-de hover:opacity-90 transition"
          data-testid="wdr-print"
        >
          🖨 Print / Save as PDF
        </button>
      </div>

      {/* Filter form — hidden when printing */}
      <form
        className="rounded-lg border bg-surface p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 print-hide"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="wdr-filter-form"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Week of">
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="w-full text-[12px] px-1.5 py-1 border rounded outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            data-testid="wdr-week-start"
          />
        </Field>
        <Field label="Window (days)">
          <input
            type="number"
            min={1}
            max={120}
            value={windowDays}
            onChange={(e) =>
              setWindowDays(Math.max(1, Number(e.target.value) || WINDOW_DEFAULT))
            }
            className="w-full text-[12px] px-1.5 py-1 border rounded outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            data-testid="wdr-window-days"
          />
        </Field>
        <FilterSelect
          label="Ent Lead"
          testid="wdr-filter-ent"
          value={filters.ent_lead ?? ''}
          options={options.ent}
          onChange={(v) => setFilter('ent_lead', v)}
        />
        <FilterSelect
          label="DA"
          testid="wdr-filter-da"
          value={filters.da ?? ''}
          options={options.da}
          onChange={(v) => setFilter('da', v)}
        />
        <FilterSelect
          label="Type"
          testid="wdr-filter-type"
          value={filters.type ?? ''}
          options={options.type}
          onChange={(v) => setFilter('type', v)}
        />
        <FilterSelect
          label="Status"
          testid="wdr-filter-status"
          value={filters.status ?? ''}
          options={options.status}
          onChange={(v) => setFilter('status', v)}
        />
        <FilterSelect
          label="Juris"
          testid="wdr-filter-juris"
          value={filters.juris ?? ''}
          options={options.juris}
          onChange={(v) => setFilter('juris', v)}
        />
        <div className="col-span-2 md:col-span-4 lg:col-span-7 flex items-center justify-between">
          <span className="text-[11px] text-muted" data-testid="wdr-generated">
            {reportQ.data?.generated_at
              ? `Generated ${new Date(reportQ.data.generated_at).toLocaleString()}`
              : ''}
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-[11px] font-bold px-2 py-1 rounded border border-de text-de bg-de/5 hover:bg-de/10 transition"
            data-testid="wdr-clear-filters"
          >
            Clear filters
          </button>
        </div>
      </form>

      {/* Print-only title block */}
      <div className="hidden print:block mb-2">
        <h1 className="text-lg font-extrabold">Weekly DA Update</h1>
        <div className="text-xs">
          Week of {fmtDate(weekStart)} · next {windowDays} days
        </div>
      </div>

      {/* Body */}
      {reportQ.error ? (
        <QueryError
          title="Weekly DA report failed to load"
          error={reportQ.error}
          onRetry={() => reportQ.refetch()}
        />
      ) : reportQ.isLoading ? (
        <SkeletonRows count={4} rowClassName="h-24" />
      ) : das.length === 0 ? (
        <div
          className="rounded-lg border bg-surface px-4 py-12 text-center text-sm text-muted"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="wdr-empty"
        >
          No corrections or upcoming intakes match these filters for this week.
        </div>
      ) : (
        <div className="space-y-6" data-testid="wdr-body">
          {das.map((group, i) => (
            <DaSection key={group.da} group={group} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function DaSection({
  group,
  first,
}: {
  group: WeeklyDaReportGroup;
  first: boolean;
}) {
  return (
    <section
      className={`report-da-section ${first ? '' : 'report-da-break'}`}
      data-testid={`wdr-da-${group.da}`}
    >
      <h2 className="text-base font-extrabold text-text border-b pb-1 mb-2"
        style={{ borderColor: 'var(--color-border)' }}>
        {group.name}
      </h2>

      <h3 className="text-[12px] font-bold text-text uppercase tracking-wide mb-1">
        Corrections ({group.corrections.length})
      </h3>
      {group.corrections.length === 0 ? (
        <div className="text-[11px] text-dim italic mb-3">None this week.</div>
      ) : (
        <table className="w-full border-collapse text-[11px] mb-4">
          <thead>
            <tr className="text-left" style={{ background: 'var(--color-s2)' }}>
              <Th>Address</Th>
              <Th>Permit Type / #</Th>
              <Th>Corr Issued</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {group.corrections.map((row) => (
              <tr
                key={row.permit_id}
                className="report-row border-b align-top"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`wdr-corr-row-${row.permit_id}`}
              >
                <Td>{row.address ?? '—'}</Td>
                <Td>
                  <PermitTypeNum row={row} />
                </Td>
                <Td className="font-mono whitespace-nowrap">
                  {fmtDate(row.corr_issued)}
                </Td>
                <td className="px-2 py-1 w-[40%]">
                  <NoteEditor permitId={row.permit_id} noteBody={row.note_body} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="text-[12px] font-bold text-text uppercase tracking-wide mb-1">
        Upcoming Intakes ({group.upcoming_intakes.length})
      </h3>
      {group.upcoming_intakes.length === 0 ? (
        <div className="text-[11px] text-dim italic">None in window.</div>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left" style={{ background: 'var(--color-s2)' }}>
              <Th>Address</Th>
              <Th>Permit Type / #</Th>
              <Th>Target Submit</Th>
              <Th>Juris</Th>
            </tr>
          </thead>
          <tbody>
            {group.upcoming_intakes.map((row) => (
              <tr
                key={row.permit_id}
                className="report-row border-b align-top"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid={`wdr-upc-row-${row.permit_id}`}
              >
                <Td>{row.address ?? '—'}</Td>
                <Td>
                  <PermitTypeNum row={row} />
                </Td>
                <Td className="font-mono whitespace-nowrap">
                  {fmtDate(row.target_submit)}
                </Td>
                <Td>{row.juris ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PermitTypeNum({ row }: { row: WeeklyDaReportRow }) {
  return (
    <span>
      <span className="text-text">{row.type ?? '—'}</span>
      {row.num && (
        <>
          {' '}
          {row.portal_url ? (
            <a
              href={row.portal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-de hover:underline"
            >
              {row.num}
            </a>
          ) : (
            <span className="font-mono text-muted">{row.num}</span>
          )}
        </>
      )}
    </span>
  );
}

// ===========================================================
// NoteEditor — autosizing, debounced, stale-prop-synced textarea.
// ===========================================================

function NoteEditor({
  permitId,
  noteBody,
}: {
  permitId: number;
  noteBody: string;
}) {
  const [draft, setDraft] = useState(noteBody);
  // React 19 in-render setState pattern (same as fix-63/64): keep the draft
  // synced when the upstream note_body changes (a refetch or a DA switch
  // remounting with a new permit). Track a {permitId, noteBody} snapshot;
  // reset the draft synchronously in-render when either moves.
  const [snap, setSnap] = useState<{ id: number; value: string }>({
    id: permitId,
    value: noteBody,
  });
  if (snap.id !== permitId || snap.value !== noteBody) {
    setSnap({ id: permitId, value: noteBody });
    setDraft(noteBody);
  }

  const mut = useUpsertReportNote();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Autosize to content (min 3 rows via the rows attr). Touches DOM style
  // only — no setState — so it's lint-clean inside a layout effect.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // Clear any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function flush(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    dirty.current = false;
    mut.mutate({ permitId, body: value });
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setDraft(v);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    // Debounce: save ~500ms after the user stops typing.
    timer.current = setTimeout(() => {
      if (dirty.current) flush(v);
    }, 500);
  }

  function onBlur() {
    if (dirty.current) flush(draft);
  }

  return (
    <textarea
      ref={taRef}
      value={draft}
      onChange={onChange}
      onBlur={onBlur}
      rows={3}
      placeholder="Add a note for this permit…"
      className="w-full text-[11px] leading-snug px-1.5 py-1 border rounded outline-none resize-none min-h-[3.5rem]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
      data-testid={`wdr-note-${permitId}`}
      aria-label={`Note for permit ${permitId}`}
    />
  );
}

// ===========================================================
// Small presentational helpers
// ===========================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-dim">{label}</span>
      {children}
    </label>
  );
}

function FilterSelect({
  label,
  testid,
  value,
  options,
  onChange,
}: {
  label: string;
  testid: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-[12px] px-1.5 py-1 border rounded outline-none"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        data-testid={testid}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-2 py-1 text-[9px] font-extrabold text-text uppercase tracking-wider border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-1 text-text ${className}`}>{children}</td>;
}
