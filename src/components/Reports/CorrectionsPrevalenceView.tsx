import { useMemo, useState } from 'react';
import {
  LOW_CONFIDENCE_N,
  bandPrevalence,
  computePrevalence,
  segmentByKey,
  segmentPrevalence,
  SEGMENTS,
  type PrevalenceLevel,
  type PrevalenceRow,
  type SegmentProject,
} from '../../lib/correctionsPrevalence';
import type { CorrectionReportRow } from '../../lib/correctionsReport';

// fix-279: PREVALENCE — "we get this correction 65% of the time."
//
// The headline the business asked for, and a different question from the repeat
// rate next door. Nothing in this component renders a repeat figure; the two
// never share a column, because they move in opposite directions for the same
// category and conflating them points template work at the wrong target.
//
// Every percentage here is rendered with its n, and any n below
// LOW_CONFIDENCE_N is visually de-emphasised. With 93 projects a filtered slice
// is routinely under 10, and 25% on n=4 must not look like 69% on n=54.

interface Props {
  /** Rows that set the DENOMINATOR — the filtered slice before any theme
   *  narrowing. See computePrevalence for why that distinction exists. */
  scopeRows: CorrectionReportRow[];
  /** Rows to count. Same array as scopeRows unless a theme filter is active. */
  displayRows: CorrectionReportRow[];
  projectsById: ReadonlyMap<string, SegmentProject>;
  /** True when a theme filter is narrowing the rows but not the denominator. */
  scopeNote: string | null;
}

export default function CorrectionsPrevalenceView({
  scopeRows,
  displayRows,
  projectsById,
  scopeNote,
}: Props) {
  const [level, setLevel] = useState<PrevalenceLevel>('category');
  const [banded, setBanded] = useState(true);
  const [breakdownKey, setBreakdownKey] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = useMemo(
    () => computePrevalence(scopeRows, displayRows, level),
    [scopeRows, displayRows, level],
  );
  const bands = useMemo(() => bandPrevalence(result.rows), [result.rows]);
  const seg = breakdownKey ? segmentByKey(breakdownKey) : null;

  const lowConfidenceScope = result.denominator < LOW_CONFIDENCE_N;

  return (
    <div className="space-y-3" data-testid="corrections-prevalence">
      {/* THE DENOMINATOR, STATED. A reader must never have to guess whether
          65% is of all projects, of projects with corrections, or of letters. */}
      <div
        className="text-[11px] text-muted bg-s2 border border-border rounded-md px-3 py-2"
        data-testid="prevalence-denominator"
      >
        Percentages are{' '}
        <strong className="text-text">
          of the {result.denominator} project
          {result.denominator === 1 ? '' : 's'} in this filter that have any
          correction on file
        </strong>{' '}
        — not of all projects, and not of letters.
        {lowConfidenceScope && (
          <span className="text-co font-semibold" data-testid="prevalence-scope-low">
            {' '}Fewer than {LOW_CONFIDENCE_N} projects in scope — read every
            percentage below as indicative only.
          </span>
        )}
        {scopeNote && (
          <span className="block mt-1 text-dim" data-testid="prevalence-scope-note">
            {scopeNote}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-dim">Level</span>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as PrevalenceLevel);
              setExpanded(null);
            }}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
            data-testid="prevalence-level"
          >
            <option value="category">Category (specific)</option>
            <option value="theme">Theme (fewer, larger buckets)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-dim">
            Break down by
          </span>
          <select
            value={breakdownKey}
            onChange={(e) => setBreakdownKey(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
            data-testid="prevalence-breakdown"
          >
            <option value="">Nothing — overall only</option>
            {SEGMENTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted pb-1">
          <input
            type="checkbox"
            checked={banded}
            onChange={(e) => setBanded(e.target.checked)}
            data-testid="prevalence-banded"
          />
          Group into bands
        </label>
      </div>

      {result.rows.length === 0 ? (
        <div
          className="py-6 text-center text-dim italic text-xs"
          data-testid="prevalence-empty"
        >
          Nothing to measure in this slice.
        </div>
      ) : banded ? (
        bands.map((g) => (
          <div key={g.band.key} data-testid={`prevalence-band-${g.band.key}`}>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted mt-2 mb-1">
              {g.band.label}
              <span className="text-dim font-normal normal-case tracking-normal">
                {' '}({g.rows.length})
              </span>
            </div>
            <PrevalenceTable
              rows={g.rows}
              denominator={result.denominator}
              level={level}
              seg={seg}
              scopeRows={scopeRows}
              projectsById={projectsById}
              expanded={expanded}
              onToggle={setExpanded}
            />
          </div>
        ))
      ) : (
        <PrevalenceTable
          rows={result.rows}
          denominator={result.denominator}
          level={level}
          seg={seg}
          scopeRows={scopeRows}
          projectsById={projectsById}
          expanded={expanded}
          onToggle={setExpanded}
        />
      )}
    </div>
  );
}

function PrevalenceTable({
  rows, denominator, level, seg, scopeRows, projectsById, expanded, onToggle,
}: {
  rows: PrevalenceRow[];
  denominator: number;
  level: PrevalenceLevel;
  seg: ReturnType<typeof segmentByKey>;
  scopeRows: CorrectionReportRow[];
  projectsById: ReadonlyMap<string, SegmentProject>;
  expanded: string | null;
  onToggle: (label: string | null) => void;
}) {
  const lowScope = denominator < LOW_CONFIDENCE_N;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[620px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
            <th className="text-left py-1.5 font-display font-bold">
              {level === 'theme' ? 'Theme' : 'Category'}
            </th>
            {level === 'category' && (
              <th className="text-left py-1.5 font-display font-bold">Theme</th>
            )}
            {/* Labelled without ambiguity — this column is prevalence, and the
                repeat rate is not on this page. */}
            <th className="text-right py-1.5 font-display font-bold">
              % of projects
            </th>
            <th className="text-right py-1.5 font-display font-bold">
              Projects affected
            </th>
            <th className="text-right py-1.5 font-display font-bold">Items</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = expanded === r.label;
            return (
              <>
                <tr
                  key={r.label}
                  className={`border-b border-border/40 ${seg ? 'cursor-pointer hover:bg-s2' : ''}`}
                  onClick={seg ? () => onToggle(isOpen ? null : r.label) : undefined}
                  data-testid={`prevalence-row-${r.label}`}
                >
                  <td className="py-1.5 text-text">
                    {seg && (
                      <span className="text-dim mr-1" aria-hidden="true">
                        {isOpen ? '▾' : '▸'}
                      </span>
                    )}
                    {r.label}
                  </td>
                  {level === 'category' && (
                    <td className="py-1.5 text-dim">{r.theme ?? '—'}</td>
                  )}
                  <td
                    className={`py-1.5 text-right font-semibold ${lowScope ? 'text-dim italic' : 'text-text'}`}
                    data-testid={`prevalence-pct-${r.label}`}
                    data-low-confidence={lowScope ? 'true' : 'false'}
                  >
                    {r.pct}%
                  </td>
                  {/* The n, always, next to the percentage. */}
                  <td className="py-1.5 text-right text-muted">
                    {r.projects} of {denominator}
                  </td>
                  <td className="py-1.5 text-right text-muted">{r.items}</td>
                </tr>
                {isOpen && seg && (
                  <tr key={`${r.label}-breakdown`}>
                    <td colSpan={level === 'category' ? 5 : 4} className="p-0">
                      <SegmentBreakdown
                        scopeRows={scopeRows}
                        projectsById={projectsById}
                        segKey={seg.key}
                        level={level}
                        label={r.label}
                      />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SegmentBreakdown({
  scopeRows, projectsById, segKey, level, label,
}: {
  scopeRows: CorrectionReportRow[];
  projectsById: ReadonlyMap<string, SegmentProject>;
  segKey: string;
  level: PrevalenceLevel;
  label: string;
}) {
  const seg = segmentByKey(segKey);
  const rows = useMemo(
    () => (seg ? segmentPrevalence(scopeRows, projectsById, seg, level, label) : []),
    [scopeRows, projectsById, seg, level, label],
  );
  if (!seg) return null;
  return (
    <div
      className="bg-s2 px-3 py-2"
      data-testid={`prevalence-breakdown-${label}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-dim mb-1">
        {label} by {seg.label}
        {seg.multi && (
          <span className="normal-case tracking-normal">
            {' '}— a project can sit in more than one, so these do not sum to the
            project count
          </span>
        )}
      </div>
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.value}
              data-testid={`prevalence-segment-${label}-${r.value}`}
              data-low-confidence={r.lowConfidence ? 'true' : 'false'}
            >
              <td className="py-0.5 text-text w-40">{r.value}</td>
              <td
                className={`py-0.5 text-right w-16 font-semibold ${
                  // ★ de-emphasised below n=10: a percentage on 4 projects must
                  // not read with the same weight as one on 54.
                  r.lowConfidence ? 'text-dim italic font-normal' : 'text-text'
                }`}
              >
                {r.pct}%
              </td>
              <td className="py-0.5 text-right text-muted w-28">
                {r.affected} of {r.projectsInSegment}
              </td>
              <td className="py-0.5 pl-2 text-dim">
                {r.lowConfidence && (
                  <span title={`Only ${r.projectsInSegment} projects — too few to read as a rate`}>
                    n&lt;{LOW_CONFIDENCE_N}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
