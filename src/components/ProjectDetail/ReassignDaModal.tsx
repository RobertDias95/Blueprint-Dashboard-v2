import { useMemo, useState } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  useProjectDaHandoffs,
  useReassignProjectDa,
  useUndoProjectDaReassign,
} from '../../hooks/useProjectDaHandoffs';
import { snapToMonday } from '../../lib/dateUtils';

// fix-225: DA project handoff, Phase 1 — lightweight "reassign DA" (ownership
// only). Admin-only. Moves who owns the work to a new DA WITHOUT moving the
// draw-schedule board block (it stays frozen under the original DA) and WITHOUT
// creating a redesign. For the "new DA needs a redraw / new block / new permit"
// case, the modal routes the user to Redesign instead.

interface Props {
  projectId: string;
  projectAddress: string;
  /** The project's current owning DA (the BP's da / board block DA). */
  currentDa: string | null;
  onClose: () => void;
  /** Opens the Redesign wizard (parent wiring) for the new-block case. */
  onUseRedesign: () => void;
}

function currentWeekMonday(): string {
  return (snapToMonday(new Date(), 'back') as string) ?? '';
}

export default function ReassignDaModal({
  projectId,
  projectAddress,
  currentDa,
  onClose,
  onUseRedesign,
}: Props) {
  const team = useTeamMembers();
  const reassign = useReassignProjectDa();
  const undo = useUndoProjectDaReassign();
  const historyQ = useProjectDaHandoffs(projectId);

  const daNames = useMemo(
    () =>
      [...new Set(team.activeDas.map((m) => m.name).filter(Boolean))]
        .filter((n) => n !== currentDa)
        .sort((a, b) => a.localeCompare(b)),
    [team.activeDas, currentDa],
  );

  const [toDa, setToDa] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(currentWeekMonday());
  const [note, setNote] = useState('');

  function submit() {
    if (!toDa) return;
    reassign.mutate(
      { projectId, toDa, effectiveDate: effectiveDate || null, note: note.trim() || null },
      { onSuccess: onClose },
    );
  }

  const label = 'text-[9px] font-bold uppercase tracking-wide text-dim';
  const field =
    'px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none focus:border-de';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      data-testid="reassign-da-modal"
    >
      <div
        className="rounded-lg shadow-xl w-[460px] max-h-[90vh] overflow-y-auto flex flex-col"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between sticky top-0"
          style={{ background: 'var(--color-s2)', borderBottomColor: 'var(--color-border)' }}
        >
          <span className="text-[12px] font-extrabold uppercase tracking-wider text-text">
            Reassign DA
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
            data-testid="reassign-da-close"
          >
            ✕
          </button>
        </header>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-[10px] text-dim -mb-1">{projectAddress}</p>

          {/* Ownership-only framing */}
          <div
            className="text-[11px] rounded px-2.5 py-2"
            style={{ background: 'var(--color-de-bg)', color: 'var(--color-de)' }}
            data-testid="reassign-da-explainer"
          >
            Moves <strong>ownership only</strong>: the project's DA (permits + open
            tasks) becomes the new DA. The draw-schedule <strong>board block stays
            put</strong> under {currentDa ?? 'the original DA'} — no new block, no
            push-down. The project is then marked <em>shared</em>.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>New DA</span>
              <select
                value={toDa}
                onChange={(e) => setToDa(e.target.value)}
                className={field}
                style={{ borderColor: 'var(--color-border)' }}
                data-testid="reassign-da-select"
              >
                <option value="">— pick a DA —</option>
                {daNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={label}>Effective week</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className={`${field} font-mono`}
                style={{ borderColor: 'var(--color-border)' }}
                data-testid="reassign-da-effective"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={label}>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Trevor left; Nicky finishing"
              className={field}
              style={{ borderColor: 'var(--color-border)' }}
              data-testid="reassign-da-note"
            />
          </label>

          <button
            type="button"
            onClick={submit}
            disabled={!toDa || reassign.isPending}
            className="self-start text-[11px] font-display font-bold px-3 py-1.5 rounded bg-de text-white hover:opacity-90 disabled:opacity-40 transition"
            data-testid="reassign-da-confirm"
          >
            {reassign.isPending ? 'Reassigning…' : 'Reassign ownership'}
          </button>

          {/* Redesign pointer for the new-block case */}
          <div
            className="text-[10px] text-dim border-t pt-2"
            style={{ borderTopColor: 'var(--color-border)' }}
          >
            Need the new DA to redraw or take a new permit?{' '}
            <button
              type="button"
              onClick={() => {
                onClose();
                onUseRedesign();
              }}
              className="text-de font-bold underline"
              data-testid="reassign-da-use-redesign"
            >
              Use Redesign
            </button>{' '}
            — that spins up a new block + DD window.
          </div>

          {/* Handoff history + undo */}
          {historyQ.data && historyQ.data.length > 0 && (
            <div
              className="border-t pt-2 flex flex-col gap-1"
              style={{ borderTopColor: 'var(--color-border)' }}
              data-testid="reassign-da-history"
            >
              <span className={label}>Handoff history</span>
              {historyQ.data.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between text-[10px] text-muted"
                  data-testid={`reassign-da-history-${h.id}`}
                >
                  <span>
                    {(h.from_da ?? '—')} → <strong>{h.to_da}</strong>
                    {h.effective_date ? ` · ${h.effective_date}` : ''}
                    {h.note ? ` · ${h.note}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => undo.mutate({ handoffId: h.id })}
                    disabled={undo.isPending}
                    className="text-co hover:underline disabled:opacity-40 ml-2"
                    title="Undo this reassignment"
                    data-testid={`reassign-da-undo-${h.id}`}
                  >
                    ↩ undo
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
