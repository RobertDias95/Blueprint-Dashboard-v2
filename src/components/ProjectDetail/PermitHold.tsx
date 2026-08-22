import { useState } from 'react';
import {
  usePermitHolds,
  useSetPermitHold,
  useLiftPermitHold,
  activePermitHold,
} from '../../hooks/usePermitHolds';
import { useProjectHolds, activeHoldOnly } from '../../hooks/useProjectHolds';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { HoldBadge } from '../shared/HoldBadge';

// ===========================================================================
// ★★★ fix-390 — PAUSE ONE PERMIT
// ===========================================================================
//
// ★★ ProjectHoldPanel's pattern, at permit scope and MINUS THE CANCEL HALF.
// There is no kind chooser here because there is only one kind: a dead permit
// is **Withdrawn** at the portal (fix-388), not cancelled here. Everything else
// — the reason vocabulary, the start date, the history list, the release
// control — is the sibling's shape so the two read alike.
//
// ★ Reasons come from the SAME `holdReasonOptions` app_config list the project
// panel uses. A second vocabulary for the same question would be fix-364's
// mistake, and "waiting on the city" means the same thing at either scope.

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** The permit's own open hold, as a badge. Renders nothing when unheld.
 *
 *  ★★ Deliberately shows only the PERMIT'S OWN hold, never its project's — the
 *  project badge is already on the project header, and repeating it here would
 *  make a project hold look like a permit one. */
export function PermitHoldBadge({ permitId }: { permitId: number }) {
  const holdsQ = usePermitHolds(permitId);
  const active = activePermitHold(holdsQ.data);
  if (!active) return null;
  return <HoldBadge hold={active} testid={`permit-hold-badge-${permitId}`} />;
}

export function PermitHoldPanel({
  permitId,
  projectId,
}: {
  permitId: number;
  /** Only to warn about redundancy — never to derive the permit's held state. */
  projectId: string;
}) {
  const holdsQ = usePermitHolds(permitId);
  const projectHoldsQ = useProjectHolds(projectId);
  const cfgQ = useAppConfig();
  const holdReasons = readAppConfigStringArray(cfgQ.map, 'holdReasonOptions');

  const setHold = useSetPermitHold();
  const liftHold = useLiftPermitHold();

  const holds = holdsQ.data ?? [];
  const active = activePermitHold(holds);
  const history = holds.filter((h) => h.hold_end !== null);
  const projectHeld = activeHoldOnly(projectHoldsQ.data);

  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());

  function submit() {
    if (!reason) return;
    setHold.mutate(
      { permitId, reason, note: note || null, holdStart: start || null },
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
    <div className="flex flex-col gap-2" data-testid={`permit-hold-panel-${permitId}`}>
      {/* ★★ REDUNDANT BUT LEGAL. A permit hold under a project already on hold
          changes nothing while the project hold stands — but it is allowed,
          because somebody tidying up as the project hold is released should not
          have to re-place holds they already placed. So this SAYS SO rather
          than disabling the control. */}
      {projectHeld && !active && (
        <div
          className="text-[10px] text-dim italic"
          data-testid={`permit-hold-redundant-${permitId}`}
        >
          This project is already on hold, so this permit is paused either way.
          A permit hold still applies once the project hold is lifted.
        </div>
      )}

      {active ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <HoldBadge hold={active} testid={`permit-hold-state-${permitId}`} />
            <span className="text-[10px] text-dim">
              since {active.hold_start}
            </span>
          </div>
          {active.note && (
            <div className="text-[11px] text-muted whitespace-pre-line">
              {active.note}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
              data-testid={`permit-hold-end-${permitId}`}
              aria-label="Release date"
            />
            <button
              type="button"
              onClick={() => liftHold.mutate({ permitId, holdEnd: end || null })}
              disabled={liftHold.isPending}
              className="text-[11px] font-bold text-de bg-transparent border-none p-0 disabled:opacity-40"
              data-testid={`permit-hold-lift-${permitId}`}
            >
              Release hold
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
            data-testid={`permit-hold-reason-${permitId}`}
            aria-label="Hold reason"
          >
            <option value="">Reason…</option>
            {holdReasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
            data-testid={`permit-hold-start-${permitId}`}
            aria-label="Hold start"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="flex-1 min-w-[120px] px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
            data-testid={`permit-hold-note-${permitId}`}
            aria-label="Hold note"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!reason || setHold.isPending}
            className="text-[11px] font-bold text-white bg-de rounded px-2 py-0.5 border-none disabled:opacity-40"
            data-testid={`permit-hold-set-${permitId}`}
          >
            Hold this permit
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-0.5" data-testid={`permit-hold-history-${permitId}`}>
          <span className="text-[9px] uppercase tracking-wide text-dim">
            Past holds
          </span>
          {history.map((h) => (
            <div key={h.id} className="text-[10px] text-dim">
              {h.hold_start} – {h.hold_end} · {h.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
