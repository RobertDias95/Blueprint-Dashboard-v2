import { useMemo } from 'react';
import { useSetAgendaMember } from '../../hooks/useAgendaMember';
import { foldRosterToPeople } from '../../lib/department';
import { ROLE_TITLE } from '../../lib/roleLabels';
import type { TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-462 §B2 (P-045) — WHO IS IN THE MEETING
// ===========================================================================
//
// Bobby, 2026-08-30: membership is a **per-person checkbox, not a department**.
// He was offered department gating and rejected it — adding one person to the
// meeting would mean moving their whole department, or making an exception and
// so having a gate that no longer means anything.
//
// ★★★ IT IS NOT A PERMISSION. It decides who sees ONE ribbon entry and nothing
// else. The Agenda route is not guarded, `profiles.role` is untouched, and
// [[P-026-role-gating-design]] stays parked.
//
// ★★ RENDERS PEOPLE, NEVER ROLE ROWS — fix-461's rule, and its actual function.
// `team_members` is one row per (person, role) and six people carry two rows, so
// a panel that rendered rows would show Dave twice with two checkboxes and the
// obvious next thing that happens is that they disagree. `foldRosterToPeople` is
// reused rather than re-derived: one definition of "a person" on this tab.

interface Props {
  /** The whole roster, from the tab's query — not fetched here, so the panel
   *  works in a provider-less suite (the fix-442 trap). */
  members: readonly TeamMember[];
  readOnly: boolean;
}

export default function AgendaMembersPanel({ members, readOnly }: Props) {
  const setMember = useSetAgendaMember();

  const people = useMemo(() => foldRosterToPeople(members), [members]);
  const active = useMemo(() => people.filter((p) => p.active), [people]);

  // ★ A person is a member when any of their rows says so. The database trigger
  //   keeps the rows in agreement, so this OR is belt-and-braces — and it means
  //   a half-written state reads as "in" rather than flickering somebody out of
  //   the meeting mid-write.
  const memberOf = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of members) {
      const name = (row.name ?? '').trim();
      if (name === '') continue;
      m.set(name, (m.get(name) ?? false) || row.agenda_member === true);
    }
    return m;
  }, [members]);

  const memberCount = active.filter((p) => memberOf.get(p.name)).length;

  return (
    <div className="flex flex-col gap-3" data-testid="agenda-members-panel">
      <p className="text-[11px] text-muted leading-relaxed">
        Who attends the weekly agenda meeting. This decides who sees the{' '}
        <strong>Agenda</strong> entry in the ribbon — it is{' '}
        <strong>not a permission</strong> and changes nothing else about what a
        person can see or do.
      </p>

      {/* ★★ §C4: ticking somebody OFF hides the screen from them and hides no
          item. Membership governs who sees the agenda, never what is on it —
          said here because it is the question anybody about to untick a name
          will have. */}
      <p className="text-[10px] text-muted leading-relaxed">
        Removing somebody hides the screen from them.{' '}
        <strong>It never hides or deletes an item</strong> — their agenda items
        stay on the agenda, and stay on their own board and My&nbsp;Tasks like
        any other task.
      </p>

      <div
        className="rounded border px-3 py-2 text-[11px]"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="agenda-member-count"
      >
        {memberCount === 0 ? (
          // ★ Nobody is flagged by the migration — Bobby ticks the six boxes
          //   himself, the fix-458 / fix-461 pattern. So this is the state the
          //   day it ships, and it says so rather than looking broken.
          <span className="text-muted">
            Nobody is on the agenda yet. Tick the people who attend.
          </span>
        ) : (
          <span>
            <strong>{memberCount}</strong>{' '}
            {memberCount === 1 ? 'person attends' : 'people attend'}:{' '}
            {active
              .filter((p) => memberOf.get(p.name))
              .map((p) => p.name)
              .join(', ')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {active.map((p) => {
          const isMember = memberOf.get(p.name) ?? false;
          return (
            <div
              key={p.name}
              className="rounded border px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-[11px]"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`agenda-member-row-${p.name}`}
            >
              <label className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={isMember}
                  disabled={readOnly || setMember.isPending}
                  onChange={(e) =>
                    // ★★★ BY NAME, never by row id — the unit of membership is
                    //    the PERSON, and the RPC moves every row they hold.
                    setMember.mutate({ name: p.name, member: e.target.checked })
                  }
                  data-testid={`agenda-member-${p.name}`}
                />
                <span className="font-display font-bold text-text min-w-[110px]">
                  {p.name}
                </span>
                {/* ★ Every role they hold, so it is plain that ONE checkbox
                    covers all of them — the visible half of "edit by person". */}
                <span className="text-dim truncate">
                  {p.roles.map((r) => ROLE_TITLE[r]).join(' · ')}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
