import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  useExternalTeamDirectory,
  useUpsertDirectoryFirm,
} from '../../hooks/useExternalTeamDirectory';
import {
  directoryFirmsByDiscipline,
  EXTERNAL_TEAM_COMMON_DISCIPLINES,
} from '../../lib/externalTeam';
import {
  WAITING_ON_OPTIONS,
  type ExternalTeamDirectoryFirm,
} from '../../lib/database.types';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// fix-227: Settings → Projects → External Team Directory.
//
// The central master list of consultant firms BY DISCIPLINE that populates the
// per-project external-team picker (projects.external_team stays the source of
// truth; this only supplies reusable options). Admin-editable; read-only for
// non-admins (add/rename/toggle hide). Mirrors the other settings-list panels.
//
// Grouped by discipline. The COMMON FOUR (Civil / Surveyor / Structural /
// Arborist) always show a group so an admin can seed them; other disciplines
// show once they have a firm or are surfaced via "+ Add discipline". Firms are
// added (insert), renamed (update name), or deactivated/reactivated (toggle
// active) — never hard-deleted, so a firm still referenced by a project's blob
// isn't silently lost from the picker's "not in directory" fallback.

interface Props {
  readOnly: boolean;
}

export default function ExternalTeamDirectoryEditor({ readOnly }: Props) {
  const dirQ = useExternalTeamDirectory();
  const byDiscipline = useMemo(
    () => directoryFirmsByDiscipline(dirQ.data),
    [dirQ.data],
  );
  const [added, setAdded] = useState<Set<string>>(new Set());

  if (dirQ.error) {
    return (
      <QueryError
        title="External Team directory failed to load"
        error={dirQ.error}
        onRetry={() => dirQ.refetch()}
      />
    );
  }
  if (dirQ.isLoading) {
    return <SkeletonRows count={3} rowClassName="h-10" />;
  }

  const shown = WAITING_ON_OPTIONS.filter(
    (d) =>
      EXTERNAL_TEAM_COMMON_DISCIPLINES.includes(d) ||
      byDiscipline.has(d) ||
      added.has(d),
  );
  const shownSet = new Set(shown);
  const addable = WAITING_ON_OPTIONS.filter((d) => !shownSet.has(d));

  return (
    <div className="space-y-4" data-testid="external-team-directory-editor">
      <p className="text-[11px] text-muted">
        Master list of consultant firms by discipline. These populate the firm
        dropdown on each project's External Team. Editing here never changes a
        project's assignment — it just curates the reusable options.
      </p>

      {shown.map((discipline) => (
        <DisciplineGroup
          key={discipline}
          discipline={discipline}
          firms={byDiscipline.get(discipline) ?? []}
          readOnly={readOnly}
        />
      ))}

      {!readOnly && addable.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Add another discipline:</span>
          <select
            value=""
            onChange={(e) => {
              const d = e.target.value;
              if (d) setAdded((prev) => new Set(prev).add(d));
            }}
            className="text-xs px-2 py-1 border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid="etd-add-discipline"
          >
            <option value="">+ Add discipline…</option>
            {addable.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function DisciplineGroup({
  discipline,
  firms,
  readOnly,
}: {
  discipline: string;
  firms: ExternalTeamDirectoryFirm[];
  readOnly: boolean;
}) {
  const upsert = useUpsertDirectoryFirm();
  const [addInput, setAddInput] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  function addFirm() {
    const name = addInput.trim();
    if (!name) return;
    // Guard against an obvious in-list dupe (the DB unique index is the real
    // gate; this just avoids a needless failing round-trip).
    if (firms.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      setAddInput('');
      return;
    }
    upsert.mutate({ discipline, name });
    setAddInput('');
  }

  function startRename(f: ExternalTeamDirectoryFirm) {
    if (readOnly) return;
    setRenamingId(f.id);
    setRenameDraft(f.name);
  }
  function commitRename(f: ExternalTeamDirectoryFirm) {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== f.name) {
      upsert.mutate({ id: f.id, discipline: f.discipline, name: trimmed });
    }
    setRenamingId(null);
    setRenameDraft('');
  }
  function onAddKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFirm();
    }
  }
  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, f: ExternalTeamDirectoryFirm) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(f);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setRenamingId(null);
      setRenameDraft('');
    }
  }

  return (
    <div
      className="border border-border rounded-lg p-3 bg-surface-2"
      data-testid={`etd-group-${discipline}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold mb-2">
        {discipline}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {firms.length === 0 && (
          <span className="text-xs text-dim italic">No firms yet.</span>
        )}
        {firms.map((f) => {
          const isRenaming = renamingId === f.id;
          return (
            <span
              key={f.id}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${
                f.active
                  ? 'bg-surface border-border'
                  : 'bg-bg border-border opacity-60'
              }`}
              data-testid={`etd-firm-${f.id}`}
              data-active={f.active ? 'true' : 'false'}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => onRenameKey(e, f)}
                  onBlur={() => commitRename(f)}
                  className="bg-bg border border-de rounded px-1 py-0 text-xs outline-none min-w-[80px]"
                  data-testid={`etd-firm-rename-${f.id}`}
                />
              ) : (
                <span
                  className={`${readOnly ? '' : 'cursor-text'} ${f.active ? '' : 'line-through'}`}
                  onClick={() => startRename(f)}
                  title={readOnly ? undefined : 'Click to rename'}
                  data-testid={`etd-firm-name-${f.id}`}
                >
                  {f.name}
                </span>
              )}
              {!f.active && (
                <span className="text-[9px] uppercase text-muted border border-border rounded px-1">
                  inactive
                </span>
              )}
              {!readOnly && (
                <button
                  onClick={() =>
                    upsert.mutate({
                      id: f.id,
                      discipline: f.discipline,
                      name: f.name,
                      active: !f.active,
                    })
                  }
                  className="text-dim hover:text-text text-[10px] leading-none pl-0.5"
                  title={f.active ? 'Deactivate' : 'Reactivate'}
                  data-testid={`etd-toggle-${f.id}`}
                >
                  {f.active ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={onAddKey}
            placeholder={`Add ${discipline} firm…`}
            className="flex-1 px-2.5 py-1 text-xs border border-border rounded bg-bg text-text outline-none focus:border-de"
            data-testid={`etd-add-${discipline}`}
          />
          <button
            onClick={addFirm}
            className="px-3 py-1 text-xs font-display font-semibold bg-de text-white rounded border border-de hover:bg-de/90"
            data-testid={`etd-add-btn-${discipline}`}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
