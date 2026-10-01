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

// ===========================================================================
// ★★★ fix-617 (census gap 38) — THE ROWS THAT HOLD THE DATA WERE THE ROWS
//     THIS EDITOR COULD NOT TOUCH
// ===========================================================================
//
// The census row read: *"a former DA's Active Quarters are read by the Draw
// Schedule but editable only for current DAs."* True — and measuring it on prod
// turns it from an inconsistency into the whole point.
//
// ★★★ MEASURED 2026-10-01, all 16 `role='da'` rows:
//
//     the 12 CURRENT DAs      → active_start/active_end are **NULL / NULL**,
//                               every single one. Open-ended. Nothing set.
//     the 4 INACTIVE DAs      → Alex  2025-Q4 → 2026-Q1
//                               Chad     —    → 2026-Q1
//                               George   —    → 2025-Q1
//                               Nidhi    —    → 2026-Q1
//
// So **every window that exists belongs to a row this editor was not given**,
// and every row it was given has no window at all. It was editable exactly
// where there was nothing to edit and read-only exactly where the data lives.
// `DrawScheduleGrid` and `QuarterLayoutEditor` both read those four windows via
// `isMemberActiveInQuarter` to decide which lanes a past quarter offers — so if
// one of them is wrong, a historical quarter is wrong and nobody can fix it.
//
// ★★ RULED: **EDITABLE**, by an admin, from a Former & inactive row here. The
//    brief offered read-only-with-an-explanation as the alternative "if editing
//    is unsafe"; it is not unsafe, and three things make that a fact rather
//    than an opinion:
//
//      1. The window changes NO work. It is not a membership flag — `active` /
//         `former` stay exactly as they are and every picker keeps ignoring
//         these people (`isCurrentMember` is untouched). It changes which lanes
//         a QUARTER offers, which is a display scope.
//      2. The write path is already the right one. `bp_update_team_member_quarters`
//         is SECURITY **INVOKER**, so `team_members`' RLS applies to the caller
//         — `team_members_tenant_admin_write` is `is_tenant_admin(tenant_id)`.
//         Offering the control to an admin grants no authority the server was
//         not already checking (fix-608's lesson), and a non-admin already gets
//         `readOnly`.
//      3. It is OCC-guarded and range-checked server-side (`active_end >=
//         active_start`), the same as the current-DA rows.
//
// ★ WHAT IT DELIBERATELY IS NOT: a way back onto the roster. Restoring a
//   person is `PeopleTable`'s Restore — one job, one control. This row only
//   corrects WHEN they were here.

interface Props {
  activeDas: TeamMember[];
  /** ★ fix-617 (gap 38): the inactive / former DAs, whose windows are the only
   *  ones prod actually has. Optional so the ~forty partial `useTeamMembers`
   *  mocks and the existing fixtures keep rendering (fix-401's trap). */
  formerDas?: TeamMember[];
  readOnly?: boolean;
}

const NULL_OPTION = '__null__';

export default function TeamActiveQuartersEditor({
  activeDas,
  formerDas = [],
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

  if (activeDas.length === 0 && formerDas.length === 0) {
    return (
      <div className="text-[11px] text-dim italic">
        No DAs to configure.
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
        {activeDas.map((da) => (
          <QuartersRow
            key={da.id}
            da={da}
            currentQuarter={currentQuarter}
            quarterOptions={quarterOptions}
            readOnly={readOnly}
            onChange={onChange}
          />
        ))}
      </div>

      {/* ═══ ★★★ fix-617 (gap 38) — FORMER & INACTIVE, AND STILL EDITABLE ═══
            See the header: these four rows hold every window prod actually has,
            and the Draw Schedule reads them for past quarters. */}
      {formerDas.length > 0 && (
        <div
          className="mt-3 pt-3 border-t border-border"
          data-testid="team-quarters-former"
        >
          <h3 className="text-[10px] uppercase tracking-wide font-bold text-dim mb-1">
            Former &amp; inactive
          </h3>
          <p className="text-[11px] text-muted mb-2">
            Off the active roster, so no picker offers them — but the Draw
            Schedule still reads these dates to decide which lanes a past
            quarter shows. Editing them corrects history; it does not bring
            anyone back. Use <strong>Restore</strong> on the People table for
            that.
          </p>
          <div className="grid grid-cols-1 gap-1">
            {formerDas.map((da) => (
              <QuartersRow
                key={da.id}
                da={da}
                currentQuarter={currentQuarter}
                quarterOptions={quarterOptions}
                readOnly={readOnly}
                onChange={onChange}
                former
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One person's window. ★ fix-617 split this out of the map so the Former &
 *  inactive list renders the SAME row rather than a near-copy of it — two
 *  hand-maintained quarter rows is how the two drift. */
function QuartersRow({
  da,
  currentQuarter,
  quarterOptions,
  readOnly,
  onChange,
  former = false,
}: {
  da: TeamMember;
  currentQuarter: string;
  quarterOptions: string[];
  readOnly: boolean;
  onChange: (member: TeamMember, edge: 'start' | 'end', value: string) => void;
  former?: boolean;
}) {
  const isActive = isMemberActiveInQuarter(
    da.active_start_quarter,
    da.active_end_quarter,
    currentQuarter,
  );
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-bg"
      data-testid={`team-quarters-row-${da.name}`}
    >
      <span
        className={`font-display font-bold text-xs flex-1 truncate ${
          isActive && !former ? 'text-text' : 'text-dim italic'
        }`}
      >
        {former ? (
          <span className="line-through decoration-dim/60">{da.name}</span>
        ) : (
          da.name
        )}
        {/* ★ A former person is not ALSO "inactive this quarter" — that badge
            answers a question about a current teammate's window, and repeating
            it on a struck-through name says the same thing twice. */}
        {!isActive && !former && (
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
}
