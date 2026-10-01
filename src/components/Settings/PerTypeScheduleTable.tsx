import { useMemo, useState } from 'react';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { usePermits } from '../../hooks/usePermits';
import {
  formulaScopeKey,
  useTargetSubmitFormulas,
} from '../../hooks/useTargetSubmitFormulas';
import { useUpsertTargetSubmitFormula } from '../../hooks/useUpsertTargetSubmitFormula';
import { useDeleteTargetSubmitFormula } from '../../hooks/useDeleteTargetSubmitFormula';
import { usePermitTypeDefaults } from '../../hooks/usePermitTypeDefaults';
import { useUpsertPermitTypeDefault } from '../../hooks/useUpsertPermitTypeDefault';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTargetSubmitBenchmarks } from '../../hooks/useTargetSubmitBenchmark';
import { useAuthStore } from '../../stores/authStore';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import BufferedNumberInput from '../shared/BufferedNumberInput';
import RowHistoryPanel from '../shared/RowHistoryPanel';
import { anchorFor } from '../../lib/targetSubmitLearner';
import {
  anchorShortLabel,
  anchorWords,
  MIN_BENCHMARK_SAMPLES,
} from '../../lib/targetSubmitPolicy';
import type { TargetSubmitFormula } from '../../lib/database.types';

// ===========================================================================
// fix-615 §A (P-166 step 3c) — THE PER-TYPE SCHEDULE IS ONE TABLE
// ===========================================================================
//
// Two editors used to sit stacked in this card: the target-submit formulas
// (listed from their OWN seeded Base rows, so a new catalogue type never
// appeared — census gap 5) and the intake → approval defaults (listed from the
// catalogue). One question — "how long does each permit type take?" — split in
// two, with two different ideas of which types exist.
//
// Now: ONE ROW PER `permit_types` ENTRY, so a type added in Settings → Permits
// appears here by itself. Columns, as the approved mock has them:
//   Type · Target submit (days, and what they count from) · Intake → approval ·
//   C1 resubmit · City overrides (expands to the per-city formula rows).
//
// ★★ ROW ORDER: permits on record, most first (Building Permit leads), then
//    name. The types people actually manage sit at the top.
//
// ★★ SAVES go through the RPC that already saved each value —
//    `bp_upsert_target_submit_formula` / `bp_delete_target_submit_formula`
//    (with its OCC token) and `bp_upsert_permit_type_default` — via their
//    existing hooks, so their conflict handling and fix-608's admin refusal
//    ("Only an admin can change target-submit formulas.") reach the person as
//    the sentence the server wrote. Every box is buffered: one save per edit.
//
// ★★ A TYPE WITH NO ROW shows "—" and "Set". Nothing is created until someone
//    types a number and leaves the box.

const OFFSET_MIN = -365;
const OFFSET_MAX = 730;
const DAYS_MIN = 1;
const DAYS_MAX = 730;

interface Props {
  readOnly?: boolean;
}

export default function PerTypeScheduleTable({ readOnly = false }: Props) {
  const typesQ = usePermitTypes();
  const permitsQ = usePermits();
  const formulasQ = useTargetSubmitFormulas();
  const defaultsQ = usePermitTypeDefaults();
  const jurisQ = useJurisdictions();
  const upsertFormula = useUpsertTargetSubmitFormula();
  const removeFormula = useDeleteTargetSubmitFormula();
  const upsertDefault = useUpsertPermitTypeDefault();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const [open, setOpen] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of permitsQ.data ?? []) {
      if (p.type) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    }
    return (typesQ.data ?? [])
      .map((t) => ({ type: t.name, permits: counts.get(t.name) ?? 0 }))
      .sort((a, b) => b.permits - a.permits || a.type.localeCompare(b.type));
  }, [typesQ.data, permitsQ.data]);

  const overridesByType = useMemo(() => {
    const m = new Map<string, TargetSubmitFormula[]>();
    for (const f of formulasQ.formulas) {
      if (f.jurisdiction === null) continue;
      const list = m.get(f.type) ?? [];
      list.push(f);
      m.set(f.type, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.jurisdiction ?? '').localeCompare(b.jurisdiction ?? ''));
    }
    return m;
  }, [formulasQ.formulas]);

  const error = typesQ.error ?? formulasQ.error ?? defaultsQ.error;
  if (error) {
    return (
      <QueryError
        title="The per-type schedule failed to load"
        error={error}
        onRetry={() => {
          void typesQ.refetch();
          formulasQ.refetch();
          void defaultsQ.refetch();
        }}
      />
    );
  }
  if (typesQ.isLoading || formulasQ.isLoading || defaultsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-9" />;
  }

  function commitBase(type: string, next: number | null) {
    if (next === null) return; // emptying a Base offset is not a delete
    if (next < OFFSET_MIN || next > OFFSET_MAX) return;
    const base = formulasQ.byScope.get(formulaScopeKey(type, null));
    upsertFormula.mutate({
      type,
      jurisdiction: null,
      offset_days: next,
      expected_updated_at: base?.updated_at ?? null,
    });
  }

  function commitIntake(type: string, next: number | null) {
    if (next === null) return;
    const clamped = Math.max(DAYS_MIN, Math.min(DAYS_MAX, next));
    if (clamped === defaultsQ.byType.get(type)) return;
    upsertDefault.mutate({
      type,
      intake_to_approval_days: clamped,
      c1_resub_offset_days: defaultsQ.c1OffsetByType.get(type) ?? null,
    });
  }

  function commitC1(type: string, next: number | null) {
    const intake = defaultsQ.byType.get(type);
    if (intake == null) return; // the RPC needs intake → approval first
    const clamped = next === null ? null : Math.max(DAYS_MIN, Math.min(DAYS_MAX, next));
    if (clamped === (defaultsQ.c1OffsetByType.get(type) ?? null)) return;
    upsertDefault.mutate({
      type,
      intake_to_approval_days: intake,
      c1_resub_offset_days: clamped,
    });
  }

  return (
    <div className="space-y-2" data-testid="per-type-schedule-table">
      <p className="text-[11px] text-muted">
        One row per permit type, most-used first. <b>Target submit</b> is days
        from the type's anchor (shown under the number); it is the standard and
        always wins. <b>Intake → approval</b> is the estimator's no-history
        number. <b>C1 resubmit</b> left blank means a third of intake →
        approval. A city override changes Target submit for one city.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
            <th className="text-left py-1.5 font-display font-bold">Type</th>
            <th className="text-left py-1.5 font-display font-bold">Target submit</th>
            <th className="text-right py-1.5 font-display font-bold pr-2">Intake → approval</th>
            <th className="text-right py-1.5 font-display font-bold pr-2">C1 resubmit</th>
            <th className="text-left py-1.5 font-display font-bold pl-3">City overrides</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-dim italic">
                No permit types in the catalogue yet.
              </td>
            </tr>
          )}
          {rows.map(({ type, permits }) => {
            const anchor = anchorFor(type);
            const hasOffset = anchor !== 'mirror_bp' && anchor !== 'none';
            const base = formulasQ.byScope.get(formulaScopeKey(type, null));
            const intake = defaultsQ.byType.get(type) ?? null;
            const c1 = defaultsQ.c1OffsetByType.get(type) ?? null;
            const overrides = overridesByType.get(type) ?? [];
            const isOpen = open === type;
            return (
              <TypeRows
                key={type}
                type={type}
                permits={permits}
                anchorText={anchorWords(anchor)}
                hasOffset={hasOffset}
                baseOffset={base?.offset_days ?? null}
                intake={intake}
                c1={c1}
                overrides={overrides}
                readOnly={readOnly}
                isOpen={isOpen}
                onToggle={() => setOpen(isOpen ? null : type)}
                historyOpen={historyFor === type}
                onToggleHistory={() => setHistoryFor(historyFor === type ? null : type)}
                tenantId={tenantId}
                jurisNames={(jurisQ.data ?? []).map((j) => j.name)}
                anchorShort={anchorShortLabel(anchor)}
                onCommitBase={(n) => commitBase(type, n)}
                onCommitIntake={(n) => commitIntake(type, n)}
                onCommitC1={(n) => commitC1(type, n)}
                onCommitOverride={(juris, n, row) => {
                  if (n === null || n < OFFSET_MIN || n > OFFSET_MAX) return;
                  upsertFormula.mutate({
                    type,
                    jurisdiction: juris,
                    offset_days: n,
                    expected_updated_at: row?.updated_at ?? null,
                  });
                }}
                onRemoveOverride={(juris) => removeFormula.mutate({ type, jurisdiction: juris })}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "—" + Set for a value that does not exist yet; the box once it does (or
 *  once Set is pressed). Nothing is written until a number is typed. */
function SettableNumber({
  value,
  readOnly,
  placeholder,
  min,
  max,
  testId,
  onCommit,
  allowEmpty = false,
}: {
  value: number | null;
  readOnly: boolean;
  placeholder?: string;
  min: number;
  max: number;
  testId: string;
  onCommit: (n: number | null) => void;
  /** A blank value is meaningful (C1 resubmit), so show the box, not "Set". */
  allowEmpty?: boolean;
}) {
  const [setting, setSetting] = useState(false);
  if (value === null && !allowEmpty && !setting) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-dim" data-testid={`${testId}-empty`}>—</span>
        {!readOnly && (
          <button
            type="button"
            className="text-[10px] underline text-de"
            onClick={() => setSetting(true)}
            data-testid={`${testId}-set`}
          >
            Set
          </button>
        )}
      </span>
    );
  }
  return (
    <BufferedNumberInput
      value={value}
      min={min}
      max={max}
      disabled={readOnly}
      placeholder={placeholder}
      autoFocus={setting}
      onCommit={(n) => {
        setSetting(false);
        onCommit(n);
      }}
      onIdle={() => setSetting(false)}
      testId={testId}
    />
  );
}

function TypeRows(props: {
  type: string;
  permits: number;
  anchorText: string;
  anchorShort: string;
  hasOffset: boolean;
  baseOffset: number | null;
  intake: number | null;
  c1: number | null;
  overrides: TargetSubmitFormula[];
  readOnly: boolean;
  isOpen: boolean;
  onToggle: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  tenantId: string;
  jurisNames: string[];
  onCommitBase: (n: number | null) => void;
  onCommitIntake: (n: number | null) => void;
  onCommitC1: (n: number | null) => void;
  onCommitOverride: (juris: string, n: number | null, row?: TargetSubmitFormula) => void;
  onRemoveOverride: (juris: string) => void;
}) {
  const { type, readOnly } = props;
  return (
    <>
      <tr className="border-b border-border/40 align-top" data-testid={`pts-row-${type}`}>
        <td className="py-1.5 text-text">
          <span className="font-semibold">{type}</span>
          <span className="ml-1 text-[10px] text-dim">{props.permits} permits</span>
          {props.intake !== null && (
            // ★ fix-590's history stays beside the row it is the history of.
            <button
              type="button"
              onClick={props.onToggleHistory}
              className="ml-2 text-[10px]"
              style={{ color: 'var(--color-de)' }}
              aria-expanded={props.historyOpen}
              data-testid={`pts-history-toggle-${type}`}
            >
              {props.historyOpen ? 'Hide history' : 'History'}
            </button>
          )}
        </td>
        <td className="py-1.5">
          {props.hasOffset ? (
            <SettableNumber
              value={props.baseOffset}
              readOnly={readOnly}
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              testId={`pts-target-${type}`}
              onCommit={props.onCommitBase}
            />
          ) : (
            <span className="text-dim">—</span>
          )}
          <div className="text-[10px] text-dim italic" data-testid={`pts-anchor-${type}`}>
            {props.anchorText}
          </div>
        </td>
        <td className="py-1.5 text-right">
          <SettableNumber
            value={props.intake}
            readOnly={readOnly}
            min={DAYS_MIN}
            max={DAYS_MAX}
            testId={`pts-intake-${type}`}
            onCommit={props.onCommitIntake}
          />
        </td>
        <td className="py-1.5 text-right">
          {props.intake === null ? (
            <span className="text-dim" title="Set intake → approval first">—</span>
          ) : (
            <SettableNumber
              value={props.c1}
              allowEmpty
              readOnly={readOnly}
              placeholder="auto ÷ 3"
              min={DAYS_MIN}
              max={DAYS_MAX}
              testId={`pts-c1-${type}`}
              onCommit={props.onCommitC1}
            />
          )}
        </td>
        <td className="py-1.5 pl-3">
          {props.hasOffset ? (
            <button
              type="button"
              className="text-[10.5px] underline text-de"
              onClick={props.onToggle}
              aria-expanded={props.isOpen}
              data-testid={`pts-overrides-${type}`}
            >
              {props.overrides.length === 0
                ? 'none'
                : `${props.overrides.length} ${props.overrides.length === 1 ? 'city' : 'cities'}`}
            </button>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
      </tr>
      {props.historyOpen && (
        <tr data-testid={`pts-history-row-${type}`}>
          <td colSpan={5} className="pb-2">
            <RowHistoryPanel
              table="permit_type_defaults"
              rowKey={{ tenant_id: props.tenantId, type }}
              label={type}
              onClose={props.onToggleHistory}
            />
          </td>
        </tr>
      )}
      {props.isOpen && props.hasOffset && (
        <tr data-testid={`pts-overrides-panel-${type}`}>
          <td colSpan={5} className="pb-3 pl-4">
            <CityOverrides {...props} />
          </td>
        </tr>
      )}
    </>
  );
}

function CityOverrides(props: {
  type: string;
  anchorShort: string;
  baseOffset: number | null;
  overrides: TargetSubmitFormula[];
  readOnly: boolean;
  jurisNames: string[];
  onCommitOverride: (juris: string, n: number | null, row?: TargetSubmitFormula) => void;
  onRemoveOverride: (juris: string) => void;
}) {
  const { type, readOnly } = props;
  const [adding, setAdding] = useState('');
  const used = new Set(props.overrides.map((o) => o.jurisdiction));
  const free = props.jurisNames.filter((j) => !used.has(j));
  return (
    <div
      className="rounded border p-2 flex flex-col gap-1.5"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
    >
      {props.overrides.length === 0 && (
        <div className="text-[10.5px] text-dim italic">
          Every city uses the Target submit above{props.baseOffset !== null ? ` (${props.baseOffset} days)` : ''}.
        </div>
      )}
      {props.overrides.map((o) => (
        <div key={o.jurisdiction} className="flex items-center gap-2 text-[11px]" data-testid={`pts-override-${type}-${o.jurisdiction}`}>
          <span className="w-28 text-text">{o.jurisdiction}</span>
          <BufferedNumberInput
            value={o.offset_days}
            min={OFFSET_MIN}
            max={OFFSET_MAX}
            disabled={readOnly}
            onCommit={(n) => props.onCommitOverride(o.jurisdiction as string, n, o)}
            testId={`pts-override-input-${type}-${o.jurisdiction}`}
          />
          <CityHistory type={type} juris={o.jurisdiction as string} anchorShort={props.anchorShort} />
          {!readOnly && (
            <button
              type="button"
              className="text-dim hover:text-co text-sm leading-none"
              title="Remove this city's override (it goes back to the Target submit above)"
              onClick={() => props.onRemoveOverride(o.jurisdiction as string)}
              data-testid={`pts-override-remove-${type}-${o.jurisdiction}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && free.length > 0 && (
        <div className="flex items-center gap-2 text-[11px]">
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            className="w-28 bg-bg border border-border rounded px-1 py-0.5 text-[11px] text-text"
            data-testid={`pts-override-add-juris-${type}`}
          >
            <option value="">Add a city…</option>
            {free.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
          {adding && (
            <BufferedNumberInput
              value={null}
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              placeholder="days"
              autoFocus
              onCommit={(n) => {
                if (n === null) return;
                props.onCommitOverride(adding, n);
                setAdding('');
              }}
              testId={`pts-override-add-input-${type}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** fix-249's evidence, kept: what this city's history says, display only. */
function CityHistory({ type, juris, anchorShort }: { type: string; juris: string; anchorShort: string }) {
  const b = useTargetSubmitBenchmarks([type], juris).byType.get(type);
  if (!b || b.medianDays == null || b.n == null) {
    const total = b?.totalSamples ?? 0;
    return (
      <span className="text-[10px] text-dim italic">
        {total > 0 ? `history: not enough (n=${total}, need ${MIN_BENCHMARK_SAMPLES})` : 'history: none yet'}
      </span>
    );
  }
  return (
    <span className="text-[10px] text-dim">
      history: {anchorShort}+{b.medianDays}d · n={b.n}
    </span>
  );
}
