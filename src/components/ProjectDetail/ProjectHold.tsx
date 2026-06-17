import { useState } from 'react';
import {
  useProjectHolds,
  activeHold,
  useSetProjectHold,
  useLiftProjectHold,
  useUpdateProjectHold,
} from '../../hooks/useProjectHolds';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { HoldBadge } from '../shared/HoldBadge';

// fix-167: project On-Hold — Phase 1 UI (data + display only; NO calculation
// effects). A project carries at most one ACTIVE hold (hold_end === null) plus
// any number of closed past holds (history). The badge answers "why hasn't this
// issued?"; the panel (in Project Settings) opens / edits / lifts a hold.

/** Today as ISO 'YYYY-MM-DD' (local). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** "On Hold — <reason>" badge. Renders only when an active hold exists. Lands on
 *  the project header so the hold is the first thing seen. fix-178: delegates to
 *  the shared presentational HoldBadge (one visual source); this wrapper keeps
 *  the per-project fetch for the ProjectDetail header. */
export function ProjectHoldBadge({ projectId }: { projectId: string }) {
  const holdsQ = useProjectHolds(projectId);
  const active = activeHold(holdsQ.data);
  if (!active) return null;
  return (
    <div className="mt-1">
      <HoldBadge hold={active} testid="project-hold-badge" />
    </div>
  );
}

const inputCls =
  'bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de w-full';

/** Hold control + history for Project Settings. Independent of the modal's
 *  atomic project save — writes go straight through the hold RPCs. */
export function ProjectHoldPanel({ projectId }: { projectId: string }) {
  const holdsQ = useProjectHolds(projectId);
  const cfgQ = useAppConfig();
  const reasons = readAppConfigStringArray(cfgQ.map, 'holdReasonOptions');

  const setHold = useSetProjectHold();
  const liftHold = useLiftProjectHold();
  const updateHold = useUpdateProjectHold();

  const holds = holdsQ.data ?? [];
  const active = activeHold(holds);
  const history = holds.filter((h) => h.hold_end !== null);

  // Open-hold form (when not on hold).
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState(todayIso());
  // Lift form (when on hold).
  const [end, setEnd] = useState(todayIso());

  function submitHold() {
    if (!reason) return;
    setHold.mutate(
      { projectId, reason, note: note || null, holdStart: start || null },
      {
        onSuccess: () => {
          setReason('');
          setNote('');
          setStart(todayIso());
        },
      },
    );
  }

  return (
    <div className="col-span-2 flex flex-col gap-3" data-testid="project-hold-panel">
      {!active ? (
        // ── Not on hold: check to open one ──────────────────────────────
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
            <input
              type="checkbox"
              checked={false}
              onChange={() => setReason(reasons[0] ?? '')}
              data-testid="hold-toggle"
            />
            Put this project on hold
          </label>
          {/* The fields reveal once the user intends to hold (reason armed). */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide text-dim">
                Reason
              </span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputCls}
                data-testid="hold-reason-select"
              >
                <option value="">— pick a reason —</option>
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide text-dim">
                Hold Start (backdatable)
              </span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputCls}
                data-testid="hold-start-input"
              />
            </label>
            <label className="flex flex-col gap-0.5 col-span-2">
              <span className="text-[9px] uppercase tracking-wide text-dim">
                Note (optional)
              </span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. waiting on builder closing"
                className={inputCls}
                data-testid="hold-note-input"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={submitHold}
            disabled={!reason || setHold.isPending}
            className="self-start text-[11px] font-bold px-3 py-1.5 rounded border border-co-border bg-co-bg text-co disabled:opacity-50"
            data-testid="hold-set-btn"
          >
            Put on hold
          </button>
        </div>
      ) : (
        // ── On hold: edit / lift ────────────────────────────────────────
        <ActiveHoldEditor
          reason={active.reason}
          note={active.note}
          holdStart={active.hold_start}
          reasons={reasons}
          end={end}
          setEnd={setEnd}
          onLift={() =>
            liftHold.mutate({ projectId, holdEnd: end || null })
          }
          lifting={liftHold.isPending}
          onSave={(patch) => updateHold.mutate({ holdId: active.id, ...patch })}
          saving={updateHold.isPending}
        />
      )}

      {/* ── History ─────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="hold-history">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Hold history
          </span>
          {history.map((h) => (
            <div
              key={h.id}
              className="text-[11px] text-muted flex items-center gap-2"
              data-testid={`hold-history-row-${h.id}`}
            >
              <span className="font-mono text-text">
                {h.hold_start} → {h.hold_end}
              </span>
              <span>{h.reason}</span>
              {h.note && <span className="italic text-dim">— {h.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveHoldEditor({
  reason,
  note,
  holdStart,
  reasons,
  end,
  setEnd,
  onLift,
  lifting,
  onSave,
  saving,
}: {
  reason: string;
  note: string | null;
  holdStart: string;
  reasons: string[];
  end: string;
  setEnd: (v: string) => void;
  onLift: () => void;
  lifting: boolean;
  onSave: (patch: {
    reason?: string;
    note?: string | null;
    holdStart?: string;
  }) => void;
  saving: boolean;
}) {
  const [r, setR] = useState(reason);
  const [n, setN] = useState(note ?? '');
  const [s, setS] = useState(holdStart);
  const dirty = r !== reason || n !== (note ?? '') || s !== holdStart;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
        <input
          type="checkbox"
          checked={true}
          onChange={onLift}
          data-testid="hold-toggle"
        />
        On hold — uncheck to lift
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wide text-dim">Reason</span>
          <select
            value={r}
            onChange={(e) => setR(e.target.value)}
            className={inputCls}
            data-testid="hold-edit-reason-select"
          >
            {/* keep the stored reason selectable even if removed from the list */}
            {!reasons.includes(r) && <option value={r}>{r}</option>}
            {reasons.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Hold Start
          </span>
          <input
            type="date"
            value={s}
            onChange={(e) => setS(e.target.value)}
            className={inputCls}
            data-testid="hold-edit-start-input"
          />
        </label>
        <label className="flex flex-col gap-0.5 col-span-2">
          <span className="text-[9px] uppercase tracking-wide text-dim">Note</span>
          <input
            type="text"
            value={n}
            onChange={(e) => setN(e.target.value)}
            className={inputCls}
            data-testid="hold-edit-note-input"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            onSave({ reason: r, note: n || null, holdStart: s })
          }
          disabled={!dirty || saving}
          className="text-[11px] font-bold px-3 py-1.5 rounded border border-de-border bg-de-bg text-de disabled:opacity-50"
          data-testid="hold-save-btn"
        >
          Save changes
        </button>
        <span className="text-[9px] uppercase tracking-wide text-dim">
          End date
        </span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="hold-end-input"
        />
        <button
          type="button"
          onClick={onLift}
          disabled={lifting}
          className="text-[11px] font-bold px-3 py-1.5 rounded border border-co-border bg-co-bg text-co disabled:opacity-50"
          data-testid="hold-lift-btn"
        >
          Lift hold
        </button>
      </div>
    </div>
  );
}
