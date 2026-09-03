import { useMemo, useState } from 'react';
import PersonDetailsDialog from './PersonDetailsDialog';
import { foldPersonDetails, peopleMissingDetails } from '../../lib/personDetails';
import { ROLE_TITLE } from '../../lib/roleLabels';
import type { RosterPerson } from '../../lib/personDetails';
import type { TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-487 §B (P-120) — THE ROSTER DETAILS PANEL
// ===========================================================================
//
// Bobby: *"have the ability to edit our team database so i can enter their last
// names too."*
//
// ---------------------------------------------------------------------------
// ★★★ WHY THIS IS ITS OWN PANEL RATHER THAN A ✎ ON THE ROLE PILLS
// ---------------------------------------------------------------------------
// The obvious cheap answer was to hang an edit button off each `PillListEditor`
// pill. It would have reached the wrong set of people. The five pill lists on
// this tab are DA · DM · ENT · ACQ · Schematic (six with fix-487's Construction
// Admins) — and prod holds seven `viewer` rows and a `director` row for people
// who appear in NONE of them: EJ, Greg, Taylor, Keenan, Lucas, Darin, Eric.
// P-120 asks to be able to enter people's details; a panel that could not reach
// a quarter of the roster would be a half-answer that looked finished.
//
// ★★ SO IT LISTS PEOPLE, NOT ROLE ROWS — `foldPersonDetails`, the same fold
//    fix-461's Departments panel makes for the same reason. Seven people carry
//    two roster rows; a row-per-line panel would show Ana twice with two
//    surname boxes.
//
// ★ IT SITS WITH ITS TWO SIBLINGS. Departments (fix-461) and Agenda members
//   (fix-462) are the other two panels on this tab that answer "what is true of
//   this PERSON" rather than "who is in this role", and all three share the
//   fold. Putting the third somewhere else would split the idea across the
//   screen.
//
// ---------------------------------------------------------------------------
// ★★ THE GAP GOES FIRST, in the same shape as the four roster-gap surfaces
//    already on this tab. A missing surname is cosmetic; a missing EMAIL means
//    `resolveRosterIdentity` cannot match that person to their login at all.
//    Steve and David ship with no address on purpose — nobody knows them, and
//    the brief is explicit that they must never be invented — so they are the
//    first two rows Bobby sees, which is the point of building this now.

interface Props {
  /** The WHOLE roster, passed in from the tab's query — not fetched here, the
   *  same shape as its two sibling panels.
   *
   *  ★ HALF of the fix-442 rule, and only half: nothing here LOADS, but the
   *    dialog this panel owns holds a mutation, so a suite still has to give it
   *    a QueryClient. Written down because "takes its data as a prop" reads
   *    like "needs no provider" and here it does not follow. */
  members: readonly TeamMember[];
  readOnly: boolean;
}

export default function PersonDetailsEditor({ members, readOnly }: Props) {
  const [editing, setEditing] = useState<RosterPerson | null>(null);

  const people = useMemo(() => foldPersonDetails(members), [members]);
  const active = useMemo(() => people.filter((p) => p.active), [people]);
  const gap = useMemo(() => peopleMissingDetails(people), [people]);

  return (
    <div data-testid="person-details-editor">
      {gap.length > 0 && (
        <div
          className="mb-3 rounded border px-3 py-2"
          style={{
            borderColor: 'var(--color-co)',
            background: 'var(--color-co-bg)',
          }}
          data-testid="person-details-gap"
        >
          <div className="text-[11px] font-semibold" style={{ color: 'var(--color-co)' }}>
            {gap.length} {gap.length === 1 ? 'person is' : 'people are'} missing
            a name or an email
          </div>
          <div className="text-[10.5px] text-muted mt-0.5">
            An email is how a login is matched to a roster row — without one,
            signing in shows them no work of their own.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1" data-testid="person-details-list">
        {active.map((p) => {
          const full = [p.first_name, p.last_name].filter(Boolean).join(' ');
          return (
            <div
              key={p.name}
              className="flex items-center gap-2 rounded border border-border bg-bg px-2.5 py-1.5"
              data-testid={`person-details-row-${p.name}`}
            >
              <span className="text-[12px] font-semibold text-text w-[72px] shrink-0 truncate">
                {p.name}
              </span>
              <span className="text-[11px] text-muted flex-1 min-w-0 truncate">
                {/* ★ A MISSING VALUE IS A WORD, NOT A BLANK — fix-461's rule for
                    `NO_DEPARTMENT_LABEL`. A column of empty cells reads as a
                    loading bug rather than as the work it is. */}
                {full || <span style={{ color: 'var(--color-co)' }}>No full name</span>}
                {' · '}
                {p.email || <span style={{ color: 'var(--color-co)' }}>No email</span>}
              </span>
              <span className="text-[10px] text-dim shrink-0 hidden sm:inline">
                {p.roles.map((r) => ROLE_TITLE[r] ?? r).join(' · ')}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="text-[11px] px-2 py-0.5 rounded border border-border text-muted hover:text-text shrink-0"
                  data-testid={`person-details-edit-${p.name}`}
                >
                  Edit
                </button>
              )}
            </div>
          );
        })}
      </div>

      <PersonDetailsDialog person={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
