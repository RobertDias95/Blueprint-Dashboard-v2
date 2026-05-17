import { useEffect, useMemo, useRef, useState } from 'react';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { usePermitTypeDefaults } from '../../hooks/usePermitTypeDefaults';
import { useUpsertPermitTypeDefault } from '../../hooks/useUpsertPermitTypeDefault';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';

// fix-25-feat-Z: inline editor for per-type schedule estimator
// defaults. One row per catalog permit type; two numeric columns
// (intake → approval, cycle 1 resub offset). Tenant-scoped via
// the RPC; RLS plus the upsert function handle the auth checks.

const MIN_DAYS = 1;
const MAX_DAYS = 730;

interface RowState {
  type: string;
  intake: string;
  c1Offset: string;
}

export default function PermitTypeDefaultsEditor() {
  const typesQ = usePermitTypes();
  const defaultsQ = usePermitTypeDefaults();
  const upsert = useUpsertPermitTypeDefault();
  const isAdmin = useIsTenantAdmin();

  // Build one row per catalog type. Read current values from the
  // tenant overrides map; missing entries surface as empty inputs
  // (the user is creating a row when they edit).
  const rows = useMemo<RowState[]>(() => {
    const catalog = (typesQ.data ?? []).map((t) => t.name);
    return catalog.map((type) => {
      const intake = defaultsQ.byType.get(type);
      const c1 = defaultsQ.c1OffsetByType.get(type);
      return {
        type,
        intake: intake != null ? String(intake) : '',
        c1Offset: c1 != null ? String(c1) : '',
      };
    });
  }, [typesQ.data, defaultsQ.byType, defaultsQ.c1OffsetByType]);

  function clampInt(raw: string): number | null {
    const t = raw.trim();
    if (t === '') return null;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
  }

  function commitIntake(type: string, nextRaw: string) {
    const next = clampInt(nextRaw);
    if (next === null) return; // empty / non-numeric — ignore
    const current = defaultsQ.byType.get(type);
    const c1Current = defaultsQ.c1OffsetByType.get(type) ?? null;
    if (next === current) return;
    upsert.mutate({
      type,
      intake_to_approval_days: next,
      c1_resub_offset_days: c1Current,
    });
  }

  function commitC1(type: string, nextRaw: string) {
    const t = nextRaw.trim();
    const next: number | null = t === '' ? null : clampInt(t);
    const c1Current = defaultsQ.c1OffsetByType.get(type) ?? null;
    if (next === c1Current) return;
    const intakeCurrent = defaultsQ.byType.get(type);
    // intake_to_approval_days is required by the RPC. If the user
    // hasn't set it yet (shouldn't happen post-seed but defensive),
    // skip — they must fill the intake column first.
    if (intakeCurrent == null) return;
    upsert.mutate({
      type,
      intake_to_approval_days: intakeCurrent,
      c1_resub_offset_days: next,
    });
  }

  if (typesQ.isLoading || defaultsQ.isLoading) {
    return (
      <div className="text-[11px] text-dim italic">Loading defaults…</div>
    );
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4"
      data-testid="permit-type-defaults-editor"
    >
      <h2 className="text-sm font-display font-bold text-text mb-1">
        Schedule Estimator Defaults — Per Permit Type
      </h2>
      <p className="text-[11px] text-muted mb-3">
        Fallback day-counts used when the learner has no approved samples
        for a permit type / jurisdiction combo. Edits apply tenant-wide.
        Range {MIN_DAYS}–{MAX_DAYS} days.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
            <th className="text-left py-1.5 font-display font-bold">
              Permit Type
            </th>
            <th className="text-right py-1.5 font-display font-bold pr-2">
              Intake → Approval (d)
            </th>
            <th className="text-right py-1.5 font-display font-bold pr-2">
              Cycle 1 Resub Offset (d)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-dim italic">
                No permit types in catalog yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <PermitTypeRow
              key={r.type}
              row={r}
              readOnly={!isAdmin}
              onCommitIntake={(v) => commitIntake(r.type, v)}
              onCommitC1={(v) => commitC1(r.type, v)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PermitTypeRow({
  row,
  readOnly,
  onCommitIntake,
  onCommitC1,
}: {
  row: RowState;
  readOnly: boolean;
  onCommitIntake: (next: string) => void;
  onCommitC1: (next: string) => void;
}) {
  const [intake, setIntake] = useState(row.intake);
  const [c1, setC1] = useState(row.c1Offset);
  const intakeRef = useRef<HTMLInputElement>(null);
  const c1Ref = useRef<HTMLInputElement>(null);

  // Sync local draft from props when cache refetches, but only when
  // the input isn't currently being edited (would clobber typing).
  useEffect(() => {
    if (document.activeElement !== intakeRef.current) setIntake(row.intake);
  }, [row.intake]);
  useEffect(() => {
    if (document.activeElement !== c1Ref.current) setC1(row.c1Offset);
  }, [row.c1Offset]);

  return (
    <tr
      className="border-b border-border/40"
      data-testid={`ptd-row-${row.type}`}
    >
      <td className="py-1.5 text-text">{row.type}</td>
      <td className="py-1.5 text-right">
        <input
          ref={intakeRef}
          type="number"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={intake}
          disabled={readOnly}
          onChange={(e) => setIntake(e.target.value)}
          onBlur={() => onCommitIntake(intake)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-20 px-1 py-0.5 text-xs border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60"
          data-testid={`ptd-intake-${row.type}`}
        />
      </td>
      <td className="py-1.5 text-right">
        <input
          ref={c1Ref}
          type="number"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={c1}
          placeholder="auto: total / 3"
          disabled={readOnly}
          onChange={(e) => setC1(e.target.value)}
          onBlur={() => onCommitC1(c1)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-28 px-1 py-0.5 text-xs border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60 placeholder:text-dim placeholder:italic placeholder:text-[10px]"
          data-testid={`ptd-c1-${row.type}`}
        />
      </td>
    </tr>
  );
}
