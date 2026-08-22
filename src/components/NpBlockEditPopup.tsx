import { useState } from 'react';
import type { DaTimeBlock } from '../lib/database.types';
import ProjectLinkPicker, {
  type ProjectLinkOption,
} from './shared/ProjectLinkPicker';

// Q6.2.f: popover for adding or editing an NP block on the Draw
// Schedule grid. Two modes:
//   - 'add' — empty-cell click; produces an insert payload with
//     a freshly-generated client id + chosen type/label
//   - 'edit' — existing-block click; produces an update payload for
//     the type/label, or fires onRemove
//
// Positioning is owned by the parent (DrawScheduleGrid sets `style`).
// This component only renders the popover body — it doesn't manage
// click-outside dismissal.

const TYPES = ['Vacation', 'Training', 'Redesign', 'Corrections', 'Other'] as const;

// ★★ fix-384: both callbacks gained `projectId`. It is the LAST argument and
// nullable, because the link is optional and never gates a save — a Vacation
// block passes null and behaves exactly as it did before this ticket.
interface AddProps {
  mode: 'add';
  daName: string;
  weekKey: string;
  onAdd: (type: string, label: string, projectId: string | null) => void;
  onClose: () => void;
}

interface EditProps {
  mode: 'edit';
  block: DaTimeBlock;
  onUpdate: (type: string, label: string, projectId: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}

// ★★ fix-384: the linkable projects, handed in by the grid. Defaults to none,
// so this stays a pure presentational popover with no data dependency — which
// is what keeps it renderable in a test without a QueryClientProvider.
type ProjectOptionsProp = { projectOptions?: ProjectLinkOption[] };

export type Props = (AddProps | EditProps) & ProjectOptionsProp;

export default function NpBlockEditPopup(props: Props) {
  const initialType = props.mode === 'edit' ? props.block.type : 'Vacation';
  const initialLabel =
    props.mode === 'edit' && props.block.label && props.block.label !== props.block.type
      ? props.block.label
      : '';

  const [selectedType, setSelectedType] = useState(initialType);
  const [label, setLabel] = useState(initialLabel);
  // ★★ fix-384: the optional project link, seeded from the block being edited.
  const [projectId, setProjectId] = useState<string | null>(
    props.mode === 'edit' ? (props.block.project_id ?? null) : null,
  );

  function commit() {
    const finalLabel = label.trim();
    if (props.mode === 'add') {
      props.onAdd(selectedType, finalLabel, projectId);
    } else {
      props.onUpdate(selectedType, finalLabel, projectId);
    }
    props.onClose();
  }

  // Header text — different per mode.
  const headerText =
    props.mode === 'add'
      ? `${props.daName} · wk ${formatWeekShort(props.weekKey)}`
      : (() => {
          const { block } = props;
          const span = `${formatWeekShort(block.start_week)} – ${formatWeekShort(block.end_week)}`;
          return `${block.da_name} · ${span} · ${block.type}`;
        })();

  return (
    <div
      className="bg-surface border border-border rounded-lg shadow-xl p-2.5 flex flex-col gap-1.5 min-w-[230px]"
      data-testid="np-edit-popup"
    >
      <div className="text-[9px] uppercase tracking-wide text-dim font-display font-bold pb-1.5 border-b border-border">
        {headerText}
      </div>

      {TYPES.map((t) => {
        const isCur = selectedType === t;
        return (
          <button
            key={t}
            onClick={() => setSelectedType(t)}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold text-left border ${
              isCur
                ? 'bg-de-bg text-de border-de-border'
                : 'bg-surface-2 text-text border-border hover:bg-bg/40'
            }`}
            data-testid={`np-popup-type-${t}`}
          >
            {isCur ? '✓ ' : '  '}
            {t}
          </button>
        );
      })}

      {/* ★★★ fix-384 — the project link.
          ★★ It sits BELOW the type list and is never gated on which type is
          selected. The useful cases (Other, Corrections, Redesign) are not a
          closed set, and three of the four blocks that already name a project
          in their label are typed "Vacation" — gating on type would have made
          exactly those un-linkable without retyping them first.
          ★ It is also never REQUIRED: most blocks are somebody's time off and
          have no project at all. */}
      <div className="border-t border-border pt-1.5 mt-1">
        <ProjectLinkPicker
          options={props.projectOptions ?? []}
          value={projectId}
          onChange={setProjectId}
        />
      </div>

      <div className="border-t border-border pt-1.5 mt-1 flex gap-1">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              props.onClose();
            }
          }}
          placeholder="Custom label…"
          className="flex-1 px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de"
          data-testid="np-popup-label"
        />
        <button
          onClick={commit}
          className="px-2.5 py-0.5 text-[11px] font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
          data-testid="np-popup-save"
        >
          {props.mode === 'add' ? 'Add' : 'Save'}
        </button>
      </div>

      {props.mode === 'edit' && (
        <button
          onClick={() => {
            props.onRemove();
            props.onClose();
          }}
          className="mt-1 px-2.5 py-1 text-[11px] font-semibold text-co bg-co-bg/40 border border-co-border rounded hover:bg-co-bg/60"
          data-testid="np-popup-remove"
        >
          🗑 Remove
        </button>
      )}
    </div>
  );
}

function formatWeekShort(weekKey: string): string {
  const d = new Date(`${weekKey}T12:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
