import { useMemo } from 'react';
import type { TeamMember } from '../../lib/database.types';
import { useUpdateTeamMemberQuarters } from '../../hooks/useUpdateTeamMemberQuarters';
import {
  buildQuarterOptions,
  isMemberActiveInQuarter,
  quarterOffsetToString,
} from '../../lib/teamQuarterHelpers';

// fix-25-feat-b: per-DA active-quarter range editor. Two dropdowns
// per row (start / end) with "—" as the NULL option. Saves on change
// via useUpdateTeamMemberQuarters (OCC). DAs whose range excludes the
// current quarter render with an italic-dim "inactive" badge so admins
// can spot offboarded teammates at a glance.

interface Props {
  activeDas: TeamMember[];
  readOnly?: boolean;
}

const NULL_OPTION = '__null__';

export default function TeamActiveQuartersEditor({
  activeDas,
  readOnly = false,
}: Props) {
  const update = useUpdateTeamMemberQuarters();
  const quarterOptions = useMemo(() => buildQuarterOptions(), []);
  const currentQuarter = useMemo(() => quarterOffsetToString(0), []);

  function onChange(member: TeamMember, edge: 'start' | 'end', value: string) {
    const next = value === NULL_OPTION ? null : value;
    const currentStart = member.active_start_quarter;
    const currentEnd = member.active_end_quarter;
    const newStart = edge === 'start' ? next : currentStart;
    const newEnd = edge === 'end' ? next : currentEnd;
    // Reject end < start client-side (also enforced server-side).
    if (newStart !== null && newEnd !== null && newEnd < newStart) {
      return;
    }
    if (newStart === currentStart && newEnd === currentEnd) return;
    update.mutate({
      memberId: member.id,
      activeStart: newStart,
      activeEnd: newEnd,
      expectedUpdatedAt: member.updated_at,
    });
  }

  if (activeDas.length === 0) {
    return (
      <div className="text-[11px] text-dim italic">
        No active DAs to configure.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="team-active-quarters-editor">
      <p className="text-xs text-muted">
        Set when each DA was (or will be) on the team. "—" means
        open-ended on that side. The Draw Schedule shows only DAs whose
        range covers the viewed quarter (lanes with existing project
        blocks stay visible regardless).
      </p>
      <div className="grid grid-cols-1 gap-1">
        {activeDas.map((da) => {
          const isActive = isMemberActiveInQuarter(
            da.active_start_quarter,
            da.active_end_quarter,
            currentQuarter,
          );
          return (
            <div
              key={da.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-bg"
              data-testid={`team-quarters-row-${da.name}`}
            >
              <span
                className={`font-display font-bold text-xs flex-1 truncate ${
                  isActive ? 'text-text' : 'text-dim italic'
                }`}
              >
                {da.name}
                {!isActive && (
                  <span
                    className="ml-2 text-[9px] uppercase tracking-wide text-dim"
                    data-testid={`team-quarters-badge-inactive-${da.name}`}
                  >
                    inactive this quarter
                  </span>
                )}
              </span>
              <label className="flex items-center gap-1">
                <span className="text-[9px] uppercase text-dim">Start</span>
                <select
                  value={da.active_start_quarter ?? NULL_OPTION}
                  onChange={(e) => onChange(da, 'start', e.target.value)}
                  disabled={readOnly}
                  className="text-[11px] border border-border rounded bg-surface text-text px-1 py-0.5 outline-none focus:border-de disabled:opacity-50"
                  data-testid={`team-quarters-start-${da.name}`}
                >
                  <option value={NULL_OPTION}>—</option>
                  {quarterOptions.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-[9px] uppercase text-dim">End</span>
                <select
                  value={da.active_end_quarter ?? NULL_OPTION}
                  onChange={(e) => onChange(da, 'end', e.target.value)}
                  disabled={readOnly}
                  className="text-[11px] border border-border rounded bg-surface text-text px-1 py-0.5 outline-none focus:border-de disabled:opacity-50"
                  data-testid={`team-quarters-end-${da.name}`}
                >
                  <option value={NULL_OPTION}>—</option>
                  {quarterOptions.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
