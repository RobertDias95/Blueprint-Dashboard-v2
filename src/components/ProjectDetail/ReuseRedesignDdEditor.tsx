import { useMemo, useState } from 'react';
import type { Project } from '../../lib/database.types';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useUpdateRedesignDdPhase } from '../../hooks/useUpdateRedesignDdPhase';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { useOriginalPermitForRedesign } from '../../hooks/useOriginalPermitForRedesign';
import { snapToMonday, addDays } from '../../lib/dateUtils';
import { DS_STATUS_LIST } from '../../lib/drawScheduleStatus';

// fix-145: inline DD-phase editor for a reuse-redesign project. fix-144 gives
// such a redesign a draw_schedule lane but no BP permit, so the Project
// Overview's DDPhaseEditor (which keys off the BP) never renders — this fills
// that gap. DA / DD Start / DD End / Status, OCC-safe via the lane's updated_at,
// Monday/Friday-snapped on save (matching the wizard + DDPhaseEditor). The
// parent (DDPhaseCell) only mounts this when the project is a reuse-redesign
// with no BP, so the gating lives there.

const inputStyle = {
  borderColor: 'var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
} as const;
const inputClass =
  'text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50';

export default function ReuseRedesignDdEditor({ project }: { project: Project }) {
  const drawQ = useDrawSchedule();
  const teamQ = useTeamMembers();
  const update = useUpdateRedesignDdPhase();
  // fix-220: this editor writes the draw_schedule lane (bp_update_redesign_dd_phase),
  // an admin-only mutation. Non-admins see the lane values read-only.
  const canEdit = useIsTenantAdmin();
  // fix-146: the shared original permit — its application status is shown
  // read-only above the editable lane status. null when the parent has no BP.
  const inherited = useOriginalPermitForRedesign(project).data;

  const row = useMemo(
    () => drawQ.data?.find((r) => r.project_id === project.id) ?? null,
    [drawQ.data, project.id],
  );

  const das = useMemo(
    () =>
      (teamQ.all ?? [])
        .filter((m) => m.role === 'da' && m.active !== false)
        .map((m) => m.name)
        .sort((a, b) => a.localeCompare(b)),
    [teamQ.all],
  );

  const [da, setDa] = useState(row?.da_assigned ?? '');
  const [start, setStart] = useState(row?.dd_start ?? '');
  const [end, setEnd] = useState(row?.dd_end ?? '');
  const [status, setStatus] = useState(row?.status ?? 'Scheduled');
  // Re-sync drafts whenever the server row's token changes — covers async load
  // and the post-save refetch. React's "adjust state during render" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders):
  // setting state during render re-renders immediately, no effect/flicker. A
  // no-op when the user just saved their own edit (values already match).
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  if (row && row.updated_at !== syncedAt) {
    setSyncedAt(row.updated_at);
    setDa(row.da_assigned ?? '');
    setStart(row.dd_start ?? '');
    setEnd(row.dd_end ?? '');
    setStatus(row.status ?? 'Scheduled');
  }

  const dirty =
    da !== (row?.da_assigned ?? '') ||
    start !== (row?.dd_start ?? '') ||
    end !== (row?.dd_end ?? '') ||
    status !== (row?.status ?? 'Scheduled');
  const canSave =
    canEdit && dirty && !!da && !!start && !!end && !update.isPending;

  function save() {
    if (!canEdit || !da || !start || !end) return;
    // Snap on save so the payload is always Monday/Friday even if the user
    // didn't blur the inputs. dd_start → next Monday; dd_end → Friday of its
    // end-week. The RPC re-snaps dd_start defensively (idempotent).
    const snappedStart = snapToMonday(start, 'forward') ?? start;
    const snappedEnd = addDays(snapToMonday(end, 'back'), 4) ?? end;
    update.mutate({
      projectId: project.id,
      da,
      dd_start: snappedStart,
      dd_end: snappedEnd,
      status,
      expectedUpdatedAt: row?.updated_at ?? null,
    });
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="redesign-dd-editor">
      {/* fix-146: inherited (read-only) original-permit application status —
          distinct from the editable lane status below. Shows "—" when the
          parent BP's status is null; hidden entirely when there's no parent
          BP (inherited === null). */}
      {inherited && (
        <div
          className="flex items-baseline gap-1.5 text-[11px]"
          data-testid="redesign-dd-editor-inherited"
        >
          <span className="text-[9px] text-dim uppercase tracking-wide flex-shrink-0">
            Permit Status (inherited)
          </span>
          <span
            className="font-display font-semibold text-text"
            data-testid="redesign-dd-editor-inherited-value"
          >
            {inherited.status ?? '—'}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-dim w-12 flex-shrink-0">DA</span>
        <select
          value={da}
          onChange={(e) => setDa(e.target.value)}
          disabled={!canEdit}
          className={inputClass}
          style={inputStyle}
          data-testid="redesign-dd-editor-da"
        >
          <option value="">— pick a DA —</option>
          {das.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          {/* Preserve a stored DA no longer on the active roster. */}
          {da && !das.includes(da) && <option value={da}>{da}</option>}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-dim w-12 flex-shrink-0">Start</span>
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => {
            const s = snapToMonday(start, 'forward');
            if (s) setStart(s);
          }}
          disabled={!canEdit}
          className={inputClass}
          style={inputStyle}
          data-testid="redesign-dd-editor-start"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-dim w-12 flex-shrink-0">End</span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={() => {
            const e2 = addDays(snapToMonday(end, 'back'), 4);
            if (e2) setEnd(e2);
          }}
          disabled={!canEdit}
          className={inputClass}
          style={inputStyle}
          data-testid="redesign-dd-editor-end"
        />
      </div>
      <div className="flex items-center gap-1.5">
        {/* fix-146: "Lane Status" (not just "Status") to disambiguate from the
            inherited permit-status line above. */}
        <span
          className="text-[9px] text-dim flex-shrink-0"
          data-testid="redesign-dd-editor-status-label"
        >
          Lane Status
        </span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={!canEdit}
          className={inputClass}
          style={inputStyle}
          data-testid="redesign-dd-editor-status"
        >
          {/* Preserve a stored status outside the canonical list. */}
          {status && !DS_STATUS_LIST.includes(status as never) && (
            <option value={status}>{status}</option>
          )}
          {DS_STATUS_LIST.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="self-start text-[10px] font-display font-bold px-2 py-0.5 rounded border border-border bg-bg/40 text-text hover:bg-bg transition disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="redesign-dd-editor-save"
        >
          Save
        </button>
      ) : (
        <span
          className="self-start text-[9px] text-dim italic"
          data-testid="redesign-dd-editor-view-only"
        >
          👁 View only — draw-schedule editing is admin-only.
        </span>
      )}
    </div>
  );
}
