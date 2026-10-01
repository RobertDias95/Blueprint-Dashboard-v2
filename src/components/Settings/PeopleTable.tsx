import { useMemo, useState } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useUpsertTeamMember } from '../../hooks/useUpsertTeamMember';
import { useAgendaMemberNames } from '../../hooks/useAgendaMember';
import PersonDetailsDialog from './PersonDetailsDialog';
import { ROLE_TITLE } from '../../lib/roleLabels';
import { departmentLabel } from '../../lib/roleLabels';
import {
  PEOPLE_ROLE_FILTERS,
  activePeople,
  filterByRole,
  foldPeopleTable,
  retirePersonWrites,
  restorePersonWrites,
  retiredPeople,
  roleCounts,
  type PeopleTableRow,
} from '../../lib/peopleTable';
import type { TeamRole } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-613 §A (P-166 step 3b) — ONE TABLE, NOT NINE LISTS
// ===========================================================================
//
// ⚖️ Bobby, 2026-09-30: **People = one table** — one row per person, roles as
//    chips, email / department / agenda as columns, filter by role,
//    **Remove → Retire for every role.**
//
// Replaces nine Settings blocks: Design Associates · Design Managers ·
// Entitlement leads · Acquisition leads · Schematic · Construction admin ·
// Names and emails · Departments · Agenda members.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THE NINE LISTS COULD NOT SHOW
// ---------------------------------------------------------------------------
// `team_members` is one row per (person, role), so Jade — da · dm · schematic —
// was three pills on three different cards, and no screen in the app ever said
// she was one person. Worse, each list only knew its own role: a DA who retired
// while still a DM showed as gone on one card and present on another, with no
// way to see that both were true of the same human.
//
// ★★ So the row is the PERSON and the roles are chips on it, with a retired role
//    marked rather than hidden. That is the whole design, and the reason the
//    counts on the filter chips are per-ROLE while the rows are per-PERSON: 37
//    active people hold 46 role rows.
//
// ---------------------------------------------------------------------------
// ⚖️ "GOES BY" IS NEVER EDITED HERE — Bobby, 2026-10-01
// ---------------------------------------------------------------------------
// *"think of it as a nickname — my email is robert, but i go by bobby."*
//
// `team_members.name` is that nickname, and it is the TEXT JOIN KEY on ~2,209
// assignments across 11 columns in 7 tables, with no FK and no cascade. The old
// rename path (`useRenameDA` / `useRenameDM`) covered only some of those — it
// missed projects, routing and the draw schedule — so a rename from this screen
// silently split one person into two. It is gone, and the column is read-only
// everywhere in this feature. Full name, email, department, agenda and roles are
// what you edit.

export default function PeopleTable({ readOnly }: { readOnly: boolean }) {
  const teamQ = useTeamMembers();
  const upsert = useUpsertTeamMember();
  // ★ The agenda flag lives on the roster rows, but the panel that writes it
  //   reads this list — sharing it keeps the ✓ column and that panel agreeing.
  const agendaNames = useAgendaMemberNames();
  const [role, setRole] = useState<TeamRole | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // ★★★ `?? []` IS THE PARTIALLY-MOCKED-MODULE GUARD, not defensive noise.
  //     Roughly forty test files mock `hooks/useTeamMembers` with a hand-written
  //     object, so a field this component reads is `undefined` at the call site
  //     and `.map` throws inside a render. fix-390 hit it, fix-401 hit it again,
  //     fix-407 recorded it, and 18 AdminTeamTab tests once failed exactly that
  //     way.
  // ★★ THE GUARD GOES *INSIDE* THE MEMO, not beside it. `teamQ.all ?? []` builds
  //    a NEW array every render when the field is undefined, so a dependency on
  //    it changes every time and the memo never holds — lint says so
  //    (react-hooks/exhaustive-deps), and only lint would have.
  const rows = useMemo(() => foldPeopleTable(teamQ.all ?? []), [teamQ.all]);
  const active = useMemo(() => activePeople(rows), [rows]);
  const retired = useMemo(() => retiredPeople(rows), [rows]);
  const counts = useMemo(() => roleCounts(rows), [rows]);
  const shown = useMemo(() => filterByRole(active, role), [active, role]);
  const agendaSet = useMemo(() => new Set(agendaNames ?? []), [agendaNames]);

  const editingPerson = useMemo(
    () => rows.find((p) => p.name === editing) ?? null,
    [rows, editing],
  );

  function retirePerson(person: PeopleTableRow) {
    // ★★ EVERY ROW, AND THE RIGHT FLAG FOR EACH. `retirePersonWrites` picks
    //    `former` for a DA and `active` for everything else — see the note in
    //    lib/peopleTable for why that asymmetry is load-bearing rather than
    //    legacy. Each row carries its own OCC token, so a concurrent edit to one
    //    conflicts on that row instead of being clobbered.
    for (const { member, patch } of retirePersonWrites(person)) {
      upsert.mutate({ op: 'update', member, patch });
    }
  }

  function restorePerson(person: PeopleTableRow) {
    for (const { member, patch } of restorePersonWrites(person)) {
      upsert.mutate({ op: 'update', member, patch });
    }
  }

  return (
    <div data-testid="people-table">
      {/* ── filter chips ── */}
      <div className="flex flex-wrap items-center gap-1 mb-3" role="group" aria-label="Filter by role">
        <FilterChip
          label="Everyone"
          count={active.length}
          on={role === null}
          onClick={() => setRole(null)}
          testId="people-filter-all"
        />
        {PEOPLE_ROLE_FILTERS.map((r) => (
          <FilterChip
            key={r}
            label={ROLE_TITLE[r] ?? r}
            count={counts.get(r) ?? 0}
            on={role === r}
            onClick={() => setRole(role === r ? null : r)}
            testId={`people-filter-${r}`}
          />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="people-table-grid">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-dim border-b border-border">
              <th className="text-left py-1.5 font-display font-bold">Goes by</th>
              <th className="text-left py-1.5 font-display font-bold">Full name</th>
              <th className="text-left py-1.5 font-display font-bold">Roles</th>
              <th className="text-left py-1.5 font-display font-bold">Email</th>
              <th className="text-left py-1.5 font-display font-bold">Department</th>
              <th className="text-center py-1.5 font-display font-bold">Agenda</th>
              <th className="text-right py-1.5 font-display font-bold" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-dim italic">
                  Nobody holds that role.
                </td>
              </tr>
            )}
            {shown.map((p) => (
              <tr
                key={p.name}
                className="border-b border-border/40"
                data-testid={`people-row-${p.name}`}
              >
                {/* ★ BOLD, and the hint says what the column is for. "Goes by" is
                    the credited name and the join key; somebody about to type in
                    it should learn why they cannot before they try. */}
                <td className="py-1.5 pr-3">
                  <span
                    className="font-display font-bold text-text"
                    title="How work is credited. This is the name the app matches on, and it is not edited here."
                    data-testid={`people-goesby-${p.name}`}
                  >
                    {p.name}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-muted" data-testid={`people-fullname-${p.name}`}>
                  {[p.first_name, p.last_name].filter(Boolean).join(' ') || (
                    <span className="text-dim italic">—</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex flex-wrap gap-1">
                    {p.roles.map((r) => (
                      // ★★ NEUTRAL, because there is no per-TeamRole palette in this
                      //    repo to reuse. The brief says "existing role colours";
                      //    measured on origin/main there are none — `chipStyle`
                      //    takes a boolean (selected / not) and `ROLE_TONE` in
                      //    AdminAccountTab is for the two BRIDGE roles. So these
                      //    use the treatment every role badge in Settings already
                      //    uses (the inactive pills, the person dialog's subtitle)
                      //    rather than inventing ten colours nobody approved.
                      <span
                        key={r}
                        className="text-[9px] uppercase tracking-wide font-bold rounded px-1.5 py-0.5 bg-s2 border border-border text-muted"
                        data-testid={`people-role-${p.name}-${r}`}
                        // ★ A role this person has RETIRED while others are live.
                        //   Shown struck through rather than dropped, because
                        //   "Jade was a DA" is a fact about her the nine lists
                        //   could not express.
                        data-retired={p.retiredRoles.includes(r) ? 'true' : 'false'}
                      >
                        <span
                          className={
                            p.retiredRoles.includes(r)
                              ? 'line-through decoration-dim/60'
                              : undefined
                          }
                        >
                          {ROLE_TITLE[r] ?? r}
                        </span>
                      </span>
                    ))}
                  </span>
                </td>
                {/* ★★★ A MISSING EMAIL IS RED AND SAYS "missing", not blank.
                    `resolveRosterIdentity` matches a login by this address, so a
                    person without one signs in and the Bridge cannot tell who
                    they are. A blank cell reads as a loading bug; the word reads
                    as the work it is. */}
                <td className="py-1.5 pr-3" data-testid={`people-email-${p.name}`}>
                  {p.email ? (
                    <span className="font-mono text-[11px] text-muted">{p.email}</span>
                  ) : (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: 'var(--color-co)' }}
                      data-testid={`people-email-missing-${p.name}`}
                    >
                      missing
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-muted" data-testid={`people-dept-${p.name}`}>
                  {departmentLabel(p.department)}
                </td>
                <td className="py-1.5 text-center" data-testid={`people-agenda-${p.name}`}>
                  {agendaSet.has(p.name) || p.agenda ? (
                    <span className="text-pm" title="On the weekly agenda">
                      ✓
                    </span>
                  ) : (
                    <span className="text-dim">·</span>
                  )}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setEditing(p.name)}
                    className="text-[11px] text-de hover:underline px-1"
                    data-testid={`people-edit-${p.name}`}
                  >
                    Edit
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => retirePerson(p)}
                      className="text-[11px] text-muted hover:text-co px-1"
                      title="Retire every role this person holds. Nothing is deleted."
                      data-testid={`people-retire-${p.name}`}
                    >
                      Retire
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-dim mt-2" data-testid="people-table-note">
        {active.length} active {active.length === 1 ? 'person' : 'people'}
        {' · '}
        <strong>Retire</strong> stands every one of a person&rsquo;s roles down.
        Nothing on this screen deletes a roster row — the name stays readable on
        the work it is already credited with.
      </p>

      {/* ── ★★★ Former & inactive: ONE list, for EVERY role ── */}
      {retired.length > 0 && (
        <div
          className="mt-4 pt-3 border-t border-border"
          data-testid="people-retired"
        >
          <h3 className="text-[10px] uppercase tracking-wide font-bold text-dim mb-1.5">
            Former &amp; inactive
          </h3>
          <p className="text-[11px] text-muted mb-2">
            Off the active roster, so no picker offers them. They may still be
            named on live records — restoring brings back every role they held.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {retired.map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border text-xs text-muted"
                data-testid={`people-retired-pill-${p.name}`}
              >
                <span className="line-through decoration-dim/60">{p.name}</span>
                {p.roles.map((r) => (
                  <span
                    key={r}
                    className="text-[9px] uppercase tracking-wide font-bold text-dim"
                  >
                    {ROLE_TITLE[r] ?? r}
                  </span>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => restorePerson(p)}
                    className="text-pm hover:text-pm/70 text-sm pl-0.5"
                    title="Restore every role"
                    data-testid={`people-restore-${p.name}`}
                  >
                    ↩
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <PersonDetailsDialog
        person={editingPerson}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  on,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`text-[10px] rounded-full px-2 py-0.5 border transition ${
        on
          ? 'border-de text-de font-bold bg-s2'
          : 'border-border text-muted hover:text-text'
      }`}
      data-testid={testId}
    >
      {label} <span className="text-dim">{count}</span>
    </button>
  );
}
