import { useState } from 'react';
import type { Project } from '../../lib/database.types';
import {
  REDESIGN_TRIGGER_LABELS,
  type RedesignTrigger,
} from '../../lib/database.types';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import ReuseRedesignDdEditor from './ReuseRedesignDdEditor';

// fix-193: revise a redesign after creation. Two independent save paths, each
// reusing existing machinery:
//   1. Redesign metadata + scope — trigger, reuses-original-permit, lots, units,
//      notes — patched onto the projects row via useUpdateProject (OCC-safe).
//   2. The DD phase (DA / DD start / DD end / lane status) — the embedded
//      ReuseRedesignDdEditor (fix-145), which writes the draw_schedule lane via
//      bp_update_redesign_dd_phase and has its own Save.
// Keeping the two saves separate mirrors how the data is stored (project row vs
// draw_schedule lane) and avoids inventing a new combined RPC.

const intOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

interface Props {
  redesign: Project;
  label: string;
  onClose: () => void;
}

export default function EditRedesignModal({ redesign, label, onClose }: Props) {
  const updateProject = useUpdateProject();

  const [trigger, setTrigger] = useState<string>(redesign.redesign_trigger ?? '');
  const [reuses, setReuses] = useState<string>(
    redesign.redesign_reuses_original_permit === true
      ? 'yes'
      : redesign.redesign_reuses_original_permit === false
        ? 'no'
        : '',
  );
  const [units, setUnits] = useState<string>(
    redesign.units != null ? String(redesign.units) : '',
  );
  const [numLots, setNumLots] = useState<string>(
    redesign.num_lots != null ? String(redesign.num_lots) : '',
  );
  const [notes, setNotes] = useState<string>(redesign.redesign_notes ?? '');

  async function saveMeta() {
    if (!redesign.updated_at) return;
    try {
      await updateProject.mutateAsync({
        projectId: redesign.id,
        expectedUpdatedAt: redesign.updated_at,
        fieldLabel: 'Redesign',
        patch: {
          redesign_trigger: (trigger || null) as RedesignTrigger | null,
          redesign_reuses_original_permit:
            reuses === 'yes' ? true : reuses === 'no' ? false : null,
          units: intOrNull(units),
          num_lots: intOrNull(numLots),
          redesign_notes: notes.trim() || null,
        },
      });
      onClose();
    } catch {
      // useUpdateProject.onError already toasted.
    }
  }

  const labelCls =
    'text-[9px] font-bold uppercase tracking-wide text-dim';
  const fieldCls =
    'px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none focus:border-de';
  const fieldStyle = { borderColor: 'var(--color-border)' } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      data-testid="edit-redesign-modal"
    >
      <div
        className="rounded-lg shadow-xl w-[480px] max-h-[90vh] overflow-y-auto flex flex-col"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between sticky top-0"
          style={{
            background: 'var(--color-co-bg)',
            borderBottomColor: 'var(--color-co-border)',
          }}
        >
          <span
            className="text-[12px] font-extrabold uppercase tracking-wider"
            style={{ color: 'var(--color-co)' }}
          >
            Edit {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-[10px] text-dim -mb-1">
            {redesign.address}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Trigger</span>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className={fieldCls}
                style={fieldStyle}
                data-testid="edit-redesign-trigger"
              >
                <option value="">— unset —</option>
                {(Object.keys(REDESIGN_TRIGGER_LABELS) as RedesignTrigger[]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {REDESIGN_TRIGGER_LABELS[t]}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Reuses original permit</span>
              <select
                value={reuses}
                onChange={(e) => setReuses(e.target.value)}
                className={fieldCls}
                style={fieldStyle}
                data-testid="edit-redesign-reuses"
              >
                <option value="">— unset —</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Units</span>
              <input
                type="number"
                min={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className={fieldCls}
                style={fieldStyle}
                data-testid="edit-redesign-units"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Number of lots</span>
              <input
                type="number"
                min={1}
                value={numLots}
                onChange={(e) => setNumLots(e.target.value)}
                className={fieldCls}
                style={fieldStyle}
                data-testid="edit-redesign-lots"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={labelCls}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${fieldCls} resize-y`}
              style={fieldStyle}
              data-testid="edit-redesign-notes"
            />
          </label>

          <button
            type="button"
            onClick={saveMeta}
            disabled={updateProject.isPending || !redesign.updated_at}
            className="self-start text-[10px] font-display font-bold px-2.5 py-1 rounded border border-border bg-bg/40 text-text hover:bg-bg transition disabled:opacity-40"
            data-testid="edit-redesign-save-meta"
          >
            {updateProject.isPending ? 'Saving…' : 'Save redesign details'}
          </button>

          {/* fix-145 / fix-193: DD phase (DA + dates + lane status) has its own
              Save inside the embedded editor — it writes the draw_schedule lane,
              not the project row. */}
          <div
            className="mt-1 pt-3 border-t"
            style={{ borderTopColor: 'var(--color-border)' }}
          >
            <span className={`${labelCls} block mb-1.5`}>Redesign DD phase</span>
            <ReuseRedesignDdEditor project={redesign} />
          </div>
        </div>
      </div>
    </div>
  );
}
