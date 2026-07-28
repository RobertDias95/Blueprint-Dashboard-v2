import { useMemo, useState } from 'react';
import {
  formulaScopeKey,
  useTargetSubmitFormulas,
} from '../../hooks/useTargetSubmitFormulas';
import { useUpsertTargetSubmitFormula } from '../../hooks/useUpsertTargetSubmitFormula';
import { useDeleteTargetSubmitFormula } from '../../hooks/useDeleteTargetSubmitFormula';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTargetSubmitBenchmarks } from '../../hooks/useTargetSubmitBenchmark';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import { anchorFor } from '../../lib/targetSubmitLearner';
import {
  anchorShortLabel,
  MIN_BENCHMARK_SAMPLES,
  type TargetSubmitBenchmark,
} from '../../lib/targetSubmitPolicy';
import type { TargetSubmitFormula } from '../../lib/database.types';

// fix-154: Settings sub-section for per-type × per-jurisdiction target_submit
// offset overrides. Mirrors the task_templates editor's "Base — all
// jurisdictions" mental model: the (type, NULL) Base row applies everywhere a
// per-juris override is absent. Only the offset days are editable here — each
// type's anchor (go_date / dd_end / BP milestones) stays in code.
//
// Base view (jurisdiction = ''): one row per type, offset editable, no remove
// (Base rows are seeded for all types and cannot be deleted). Per-juris view:
// one row per type showing the override if present (editable + removable) or
// the effective Base value as a placeholder that creates an override on edit.

interface Props {
  readOnly?: boolean;
}

export default function TargetSubmitFormulasEditor({ readOnly = false }: Props) {
  const formulasQ = useTargetSubmitFormulas();
  const jurisQ = useJurisdictions();
  const upsert = useUpsertTargetSubmitFormula();
  const remove = useDeleteTargetSubmitFormula();

  const jurisOptions = jurisQ.data ?? [];
  const [typeFilter, setTypeFilter] = useState<string>(''); // '' = all types
  const [juris, setJuris] = useState<string>(''); // '' = Base

  // The 14 types come from the seeded Base rows — only types with an in-code
  // anchor have a meaningful offset, and every one of those has a Base row.
  const baseTypes = useMemo(() => {
    return formulasQ.formulas
      .filter((f) => f.jurisdiction === null)
      .map((f) => f.type)
      .sort((a, b) => a.localeCompare(b));
  }, [formulasQ.formulas]);

  const shownTypes = useMemo(
    () => (typeFilter ? baseTypes.filter((t) => t === typeFilter) : baseTypes),
    [baseTypes, typeFilter],
  );

  // fix-249: the evidence column. Benchmarks are per (type, jurisdiction), so
  // the Base view has no single cohort to report — history is only meaningful
  // once a jurisdiction is chosen.
  const benchmarks = useTargetSubmitBenchmarks(shownTypes, juris || null);

  const error = formulasQ.error ?? jurisQ.error;
  if (error) {
    return (
      <QueryError
        title="Target submit formulas failed to load"
        error={error}
        onRetry={() => {
          formulasQ.refetch();
          jurisQ.refetch();
        }}
      />
    );
  }
  if (formulasQ.isLoading || jurisQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-9" />;
  }

  const jurisLabel = juris || 'Base';

  return (
    <div className="space-y-3" data-testid="target-submit-formulas-section">
      <div>
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Target Submit Formulas
        </h2>
        <p className="text-[11px] text-muted">
          Days added to each permit type's anchor when deriving Target Submit.
          {/* fix-249: this used to read "used as the fallback when the learner
              has no samples" — which was the bug. The learner sat ABOVE this
              table and returned on the first recency window containing any
              data, so these offsets never applied at all. */}{' '}
          <span className="font-semibold">
            This offset always wins — it is the standard.
          </span>{' '}
          The <span className="font-semibold">Base</span> offset applies to
          every jurisdiction; add a per-jurisdiction override to change one.
          Anchors are fixed per type; only the offset varies here. The{' '}
          <span className="font-semibold">Actual (median)</span> column is what
          the team's history says — shown for comparison only, it never changes
          a date.
        </p>
      </div>

      {/* Scope selectors */}
      <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <Selector
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: '', label: 'All types' },
            ...baseTypes.map((t) => ({ value: t, label: t })),
          ]}
          testId="tsf-type"
        />
        <Selector
          label="Jurisdiction"
          value={juris}
          onChange={setJuris}
          options={[
            { value: '', label: 'Base — all jurisdictions' },
            ...jurisOptions.map((j) => ({ value: j.name, label: j.name })),
          ]}
          testId="tsf-juris"
        />
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
            <th className="text-left py-1.5 font-display font-bold">
              Permit Type
            </th>
            <th className="text-left py-1.5 font-display font-bold">
              Jurisdiction
            </th>
            <th className="text-right py-1.5 font-display font-bold pr-2">
              Offset (days)
            </th>
            <th className="text-left py-1.5 font-display font-bold pl-3">
              Actual (median)
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {shownTypes.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-dim italic">
                No target submit formulas yet.
              </td>
            </tr>
          )}
          {shownTypes.map((type) => {
            const baseRow = formulasQ.byScope.get(formulaScopeKey(type, null));
            const overrideRow = juris
              ? formulasQ.byScope.get(formulaScopeKey(type, juris))
              : undefined;
            const effectiveBase = baseRow?.offset_days ?? null;
            return (
              <FormulaRow
                key={`${type}-${juris}-${
                  (juris ? overrideRow : baseRow)?.updated_at ?? 'none'
                }`}
                type={type}
                juris={juris || null}
                jurisLabel={jurisLabel}
                row={juris ? overrideRow : baseRow}
                effectiveBase={effectiveBase}
                benchmark={benchmarks.byType.get(type)}
                benchmarkScoped={!!juris}
                readOnly={readOnly}
                onCommit={(offset_days) =>
                  upsert.mutate({
                    type,
                    jurisdiction: juris || null,
                    offset_days,
                    expected_updated_at:
                      (juris ? overrideRow : baseRow)?.updated_at ?? null,
                  })
                }
                onRemove={
                  juris && overrideRow
                    ? () => remove.mutate({ type, jurisdiction: juris })
                    : undefined
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** fix-249: the "set the standard next to the evidence" cell. Shows the
 *  historical median for this cohort, its sample size and range, and how far
 *  the configured offset sits from it. Amber when history runs longer than the
 *  standard. Never editable — this is the learner's new, display-only job. */
function BenchmarkCell({
  type,
  benchmark,
  scoped,
  effective,
}: {
  type: string;
  benchmark: TargetSubmitBenchmark | undefined;
  scoped: boolean;
  effective: number | null;
}) {
  const anchor = anchorFor(type);

  if (anchor === 'mirror_bp') {
    return (
      <span className="text-[10px] text-dim italic">
        mirrors BP target
      </span>
    );
  }
  if (!scoped) {
    return (
      <span className="text-[10px] text-dim italic">
        pick a jurisdiction
      </span>
    );
  }
  if (!benchmark || benchmark.medianDays == null || benchmark.n == null) {
    const total = benchmark?.totalSamples ?? 0;
    return (
      <span className="text-[10px] text-dim italic">
        {total > 0
          ? `not enough history (n=${total}, need ${MIN_BENCHMARK_SAMPLES})`
          : 'not enough history'}
      </span>
    );
  }

  const delta = effective == null ? null : benchmark.medianDays - effective;
  const over = delta != null && delta > 0;

  return (
    <span className="text-[10px] flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-text font-semibold">
        {anchorShortLabel(anchor)}+{benchmark.medianDays}d
      </span>
      {delta != null && (
        <span
          className="font-semibold"
          style={{ color: over ? 'var(--color-co)' : 'var(--color-dim)' }}
          title={
            over
              ? 'History runs longer than the configured standard.'
              : 'History meets or beats the configured standard.'
          }
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
      <span className="text-dim">
        n={benchmark.n} · {benchmark.minDays}–{benchmark.maxDays}d
      </span>
    </span>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded px-2 py-1 text-xs font-display text-text focus:outline-none focus:border-de"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormulaRow({
  type,
  juris,
  jurisLabel,
  row,
  effectiveBase,
  benchmark,
  benchmarkScoped,
  readOnly,
  onCommit,
  onRemove,
}: {
  type: string;
  juris: string | null;
  jurisLabel: string;
  row: TargetSubmitFormula | undefined;
  effectiveBase: number | null;
  /** fix-249: display-only history for this (type, juris) cohort. */
  benchmark: TargetSubmitBenchmark | undefined;
  /** Benchmarks need a jurisdiction; the Base view has no single cohort. */
  benchmarkScoped: boolean;
  readOnly: boolean;
  onCommit: (offset_days: number) => void;
  onRemove?: () => void;
}) {
  const scope = juris ?? 'base';
  // Local draft seeded from the row's current value. The parent remounts this
  // component (via key) whenever the server value changes, so no effect-sync.
  const [draft, setDraft] = useState<string>(
    row ? String(row.offset_days) : '',
  );

  function commit() {
    const t = draft.trim();
    if (t === '') return; // empty → nothing to save (override not created)
    const n = parseInt(t, 10);
    if (Number.isNaN(n)) return;
    if (n < -365 || n > 730) return;
    if (row && n === row.offset_days) return; // unchanged
    onCommit(n);
  }

  // Placeholder for an un-set per-juris override shows the inherited Base value.
  const placeholder =
    !row && effectiveBase !== null ? `Base: ${effectiveBase}` : 'days';

  return (
    <tr
      className="border-b border-border/40"
      data-testid={`tsf-row-${type}-${scope}`}
    >
      <td className="py-1.5 text-text">{type}</td>
      <td className="py-1.5 text-muted">
        {jurisLabel}
        {juris && !row && (
          <span className="ml-1 text-[9px] uppercase tracking-wide text-dim italic">
            inherits Base
          </span>
        )}
      </td>
      <td className="py-1.5 text-right">
        <input
          type="number"
          min={-365}
          max={730}
          value={draft}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-24 px-1 py-0.5 text-xs border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60 placeholder:text-dim placeholder:italic placeholder:text-[10px]"
          data-testid={`tsf-offset-${type}-${scope}`}
        />
      </td>
      {/* fix-249: the evidence, next to the standard. Read-only by design —
          the learner must never write a date again. */}
      <td className="py-1.5 pl-3" data-testid={`tsf-actual-${type}-${scope}`}>
        <BenchmarkCell
          type={type}
          benchmark={benchmark}
          scoped={benchmarkScoped}
          effective={row?.offset_days ?? effectiveBase}
        />
      </td>
      <td className="py-1.5 text-right pr-1">
        {!readOnly && onRemove && (
          <button
            onClick={onRemove}
            className="text-dim hover:text-co text-sm leading-none"
            title="Remove override (revert to Base)"
            data-testid={`tsf-remove-${type}-${juris}`}
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
