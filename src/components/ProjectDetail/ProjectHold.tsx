import { useState } from 'react';
import {
  useProjectHolds,
  activeHold,
  useSetProjectHold,
  useLiftProjectHold,
  useUpdateProjectHold,
  useSetProjectCancel,
  useRestoreProject,
} from '../../hooks/useProjectHolds';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { HoldBadge } from '../shared/HoldBadge';
import BufferedDateInput from '../BufferedDateInput';
import { holdKind, type ProjectHoldKind } from '../../lib/database.types';

// fix-167: project On-Hold — Phase 1 UI. fix-262 turns the same panel into the
// project's STATUS control, because hold and cancelled are ONE mechanism with
// two kinds (project_holds.kind):
//
//   active -> hold      : paused, but still an ACTIVE project. Reversed by
//                         "Lift hold".
//   active -> cancelled : no longer active — "the step after hold, but before
//                         delete". Reversed by "Bring this back", which also
//                         restores every task the cancel swept.
//
// One control asks the question once ("on hold, or cancelled?") and then shows
// the fields for whichever kind is chosen; the reversing action is whatever fits
// the CURRENT state. This REPLACES the old hold-only entry point rather than
// sitting beside it, so there is exactly one place to park a project and exactly
// one place to bring it back.
//
// The two reason vocabularies are deliberately SEPARATE app_config lists —
// "waiting on closing" and "builder pulled out" answer different questions.
// Both are dropdown-only (no free text), per the fix-232 registry convention.

/** Today as ISO 'YYYY-MM-DD' (local). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** "On Hold — <reason>" / "Cancelled — <reason>" badge. Renders only when the
 *  project has an OPEN row of either kind. Lands on the project header so the
 *  state is the first thing seen. */
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

/** Project status control for Project Settings: put on hold, cancel, edit, and
 *  the matching reversing action. Independent of the modal's atomic project
 *  save — writes go straight through the hold/cancel RPCs. */
export function ProjectHoldPanel({ projectId }: { projectId: string }) {
  const holdsQ = useProjectHolds(projectId);
  const cfgQ = useAppConfig();
  const holdReasons = readAppConfigStringArray(cfgQ.map, 'holdReasonOptions');
  const cancelReasons = readAppConfigStringArray(cfgQ.map, 'cancelReasonOptions');

  const setHold = useSetProjectHold();
  const liftHold = useLiftProjectHold();
  const updateHold = useUpdateProjectHold();
  const setCancel = useSetProjectCancel();
  const restore = useRestoreProject();

  const holds = holdsQ.data ?? [];
  const active = activeHold(holds);
  const activeKind: ProjectHoldKind | null = active ? holdKind(active) : null;
  const history = holds.filter((h) => h.hold_end !== null);

  // Compose form — shown only when the project is neither held nor cancelled.
  const [kind, setKind] = useState<ProjectHoldKind>('hold');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState(todayIso());
  // Reversing form (lift date / bring-back date).
  const [end, setEnd] = useState(todayIso());

  const reasons = kind === 'cancelled' ? cancelReasons : holdReasons;
  const pending = setHold.isPending || setCancel.isPending;

  function chooseKind(next: ProjectHoldKind) {
    setKind(next);
    // The two vocabularies don't overlap — never carry a reason across.
    setReason('');
  }

  function submit() {
    if (!reason) return;
    const onSuccess = () => {
      setReason('');
      setNote('');
      setStart(todayIso());
    };
    if (kind === 'cancelled') {
      setCancel.mutate(
        { projectId, reason, note: note || null, cancelDate: start || null },
        { onSuccess },
      );
    } else {
      setHold.mutate(
        { projectId, reason, note: note || null, holdStart: start || null },
        { onSuccess },
      );
    }
  }

  return (
    <div className="col-span-2 flex flex-col gap-3" data-testid="project-hold-panel">
      {!active ? (
        // ── Neither held nor cancelled: choose a state ──────────────────
        <div className="flex flex-col gap-2">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Project status
          </span>
          <div className="flex items-center gap-4" data-testid="park-kind-choice">
            <label className="flex items-center gap-1.5 text-[12px] text-text cursor-pointer">
              <input
                type="radio"
                name="park-kind"
                checked={kind === 'hold'}
                onChange={() => chooseKind('hold')}
                data-testid="park-kind-hold"
              />
              On hold <span className="text-dim">(still active)</span>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text cursor-pointer">
              <input
                type="radio"
                name="park-kind"
                checked={kind === 'cancelled'}
                onChange={() => chooseKind('cancelled')}
                data-testid="park-kind-cancelled"
              />
              Cancelled <span className="text-dim">(no longer active)</span>
            </label>
          </div>
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
                {kind === 'cancelled' ? 'Cancelled on' : 'Hold Start'} (backdatable)
              </span>
              {/* fix-262: BufferedDateInput, not a raw type=date — this value
                  goes straight to the server, and a raw input commits transient
                  garbage on every keystroke (feedback_buffered_date_input:
                  shipped 3x, corrupted prod data once). */}
              <BufferedDateInput
                value={start}
                onCommit={(v) => setStart(v ?? todayIso())}
                className={inputCls}
                testId="hold-start-input"
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
                placeholder={
                  kind === 'cancelled'
                    ? 'e.g. builder walked after appraisal'
                    : 'e.g. waiting on builder closing'
                }
                className={inputCls}
                data-testid="hold-note-input"
              />
            </label>
          </div>
          {kind === 'cancelled' && (
            <p className="text-[10px] text-dim leading-snug">
              Cancelling parks every open and in-progress task on this project.
              Finished tasks are left alone. Bringing the project back restores
              each parked task to exactly where it was.
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!reason || pending}
            className="self-start text-[11px] font-bold px-3 py-1.5 rounded border border-co-border bg-co-bg text-co disabled:opacity-50"
            data-testid={kind === 'cancelled' ? 'cancel-set-btn' : 'hold-set-btn'}
          >
            {kind === 'cancelled' ? 'Cancel this project' : 'Put on hold'}
          </button>
        </div>
      ) : activeKind === 'cancelled' ? (
        // ── Cancelled: bring it back ────────────────────────────────────
        <div className="flex flex-col gap-2" data-testid="cancelled-editor">
          <HoldBadge hold={active} testid="panel-state-badge" />
          <p className="text-[11px] text-muted">
            Cancelled {active.hold_start} — {active.reason}
            {active.note ? (
              <span className="italic text-dim"> — {active.note}</span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-dim">
              Bring back on
            </span>
            <BufferedDateInput
              value={end}
              onCommit={(v) => setEnd(v ?? todayIso())}
              className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
              testId="restore-date-input"
            />
            <button
              type="button"
              onClick={() => restore.mutate({ projectId, restoreDate: end || null })}
              disabled={restore.isPending}
              className="text-[11px] font-bold px-3 py-1.5 rounded border border-de-border bg-de-bg text-de disabled:opacity-50"
              data-testid="restore-btn"
            >
              Bring this back
            </button>
          </div>
          <p className="text-[10px] text-dim leading-snug">
            Restores every task this cancel parked to its previous state.
          </p>
        </div>
      ) : (
        // ── On hold: edit / lift / escalate to cancelled ────────────────
        <ActiveHoldEditor
          reason={active.reason}
          note={active.note}
          holdStart={active.hold_start}
          reasons={holdReasons}
          end={end}
          setEnd={setEnd}
          onLift={() => liftHold.mutate({ projectId, holdEnd: end || null })}
          lifting={liftHold.isPending}
          onSave={(patch) => updateHold.mutate({ holdId: active.id, ...patch })}
          saving={updateHold.isPending}
          onCancelProject={(cancelReason) =>
            setCancel.mutate({
              projectId,
              reason: cancelReason,
              note: null,
              cancelDate: null,
            })
          }
          cancelReasons={cancelReasons}
          cancelling={setCancel.isPending}
        />
      )}

      {/* ── History ─────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="hold-history">
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Status history
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
              <span className="uppercase text-[9px] tracking-wide text-dim">
                {holdKind(h) === 'cancelled' ? 'cancelled' : 'hold'}
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
  onCancelProject,
  cancelReasons,
  cancelling,
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
  /** fix-262: hold → cancelled is the natural next lifecycle step, so it is
   *  offered right here rather than forcing a lift first. The RPC closes the
   *  hold and opens the cancel atomically, so the two never coexist. */
  onCancelProject: (reason: string) => void;
  cancelReasons: string[];
  cancelling: boolean;
}) {
  const [r, setR] = useState(reason);
  const [n, setN] = useState(note ?? '');
  const [s, setS] = useState(holdStart);
  const [escalateReason, setEscalateReason] = useState('');
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
          <BufferedDateInput
            value={s}
            onCommit={(v) => setS(v ?? holdStart)}
            className={inputCls}
            testId="hold-edit-start-input"
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
          onClick={() => onSave({ reason: r, note: n || null, holdStart: s })}
          disabled={!dirty || saving}
          className="text-[11px] font-bold px-3 py-1.5 rounded border border-de-border bg-de-bg text-de disabled:opacity-50"
          data-testid="hold-save-btn"
        >
          Save changes
        </button>
        <span className="text-[9px] uppercase tracking-wide text-dim">End date</span>
        <BufferedDateInput
          value={end}
          onCommit={(v) => setEnd(v ?? end)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          testId="hold-end-input"
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

      {/* hold → cancelled, the next lifecycle step */}
      <div
        className="flex items-center gap-2 pt-2 border-t"
        style={{ borderTopColor: 'var(--color-border)' }}
      >
        <span className="text-[9px] uppercase tracking-wide text-dim">
          Or cancel outright
        </span>
        <select
          value={escalateReason}
          onChange={(e) => setEscalateReason(e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="hold-to-cancel-reason"
        >
          <option value="">— reason —</option>
          {cancelReasons.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => escalateReason && onCancelProject(escalateReason)}
          disabled={!escalateReason || cancelling}
          className="text-[11px] font-bold px-3 py-1.5 rounded border disabled:opacity-50"
          style={{
            background: 'var(--color-s2)',
            color: 'var(--color-dim)',
            borderColor: 'var(--color-border)',
          }}
          data-testid="hold-to-cancel-btn"
        >
          Cancel this project
        </button>
      </div>
    </div>
  );
}
