import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  ACQ_ROLES,
  ENT_ROLES,
  dedupeByPerson,
  isAssignableMember,
  isCurrentMember,
} from '../lib/roster';
import type { TeamMember, TeamRole } from '../lib/database.types';


// Q7.3.b: read team_members for the active tenant. Returns the full set
// + memoized role-bucketed views so AdminTeamTab can render its 4 pill
// lists (DAs, DMs, ENTs, ACQs) + Former DAs section without re-filtering.

export interface TeamMembersResult {
  all: TeamMember[];
  activeDas: TeamMember[];
  formerDas: TeamMember[];
  dms: TeamMember[];
  ents: TeamMember[];
  acqs: TeamMember[];
  /** fix-222: the Schematic Team roster — sources the New Project wizard's
   *  Schematic Designer picker + the Schematic Team admin section. */
  schematics: TeamMember[];
  /** fix-233: the distinct display names of CURRENT team members (active and not
   *  former), sorted A→Z — the single source for the task assignee people-pickers
   *  so departed staff never appear as selectable options. */
  activeMemberNames: string[];
  /** ★★★ fix-407: every roster member who is NOT current, any role, one row per
   *  person. Powers the Settings alumni section, which until now covered DAs
   *  only — so an inactive acquisitions lead was invisible in Settings while
   *  still named on live projects. NEVER a picker source. */
  inactive: TeamMember[];
}

/** fix-233: derive the distinct names of CURRENT team members, sorted A→Z,
 *  deduped (team_members has one row per role, so a person holding several roles
 *  would otherwise repeat). The ONE definition the task assignee dropdowns
 *  (primary + co-assignee) source their roster from.
 *
 *  ★ fix-321: the membership test moved to `isCurrentMember` in lib/roster and
 *  this calls it — same rule as before (`active !== false && former !== true`),
 *  now shared with every other picker instead of being this hook's private
 *  answer. Two pickers disagreeing about who is on the team is the drift #79
 *  exists to remove.
 *
 *  ★★ fix-343: and it now asks `isAssignableMember`, which adds the second
 *  condition the `viewer` role created — CURRENT, and not somebody who is never
 *  assigned work. Six viewer rows landed on prod 2026-08-18 (EJ, Greg, Taylor,
 *  Keenan, Lucas, Darin) with active=true, so this list — the single source for
 *  every task-assignee picker — had started offering the CEO as an assignee.
 *
 *  ★ PER PERSON, NOT PER ROW. The roster has one row per role, so a name is
 *  offered when ANY of its rows is assignable; a viewer row alongside a real
 *  one must not retire the person. Nobody holds both today, and this is written
 *  so the first person who does is handled rather than discovered. */
export function activeMemberNamesOf(
  members: readonly TeamMember[] | null | undefined,
): string[] {
  return [
    ...new Set(
      (members ?? [])
        .filter(isAssignableMember)
        .map((m) => m.name)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function useTeamMembers() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<TeamMember[]>({
    queryKey: queryKeys.teamMembers(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(
          // ★ fix-343: first_name + last_name landed on prod 2026-08-18 and are
          // read for DISPLAY only — the avatar's initials (BD, not BO). `name`
          // stays the join key and is never written.
          // ★★★ fix-461: `department` MUST be in this list. The select is EXPLICIT,
          // so a column added to the table is invisible to every consumer until
          // it is named here — the trap fix-386 hit on useProjects and fix-410
          // recorded as "a new column is a four-place job, and three of them
          // fail SILENTLY". Without this line the Departments panel would show
          // every person as unclassified for ever, with no error anywhere.
          'id, name, first_name, last_name, role, active, former, email, notes, updated_at, active_start_quarter, active_end_quarter, department, agenda_member',
        )
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamMember[];
    },
  });

  const result = useMemo<TeamMembersResult>(() => {
    const all = q.data ?? [];
    function ofRole(role: TeamRole) {
      return all.filter((m) => m.role === role);
    }
    const allDas = ofRole('da');
    // ★ fix-321: both lists split on the SHARED rule. activeDas used to test
    // `!former` alone, so a DA flagged active=false but not former counted as
    // active here and as departed in the assignee dropdowns — the same person,
    // two answers. One predicate now decides for every picker in the app.
    return {
      all,
      activeDas: allDas.filter(isCurrentMember),
      formerDas: allDas.filter((m) => !isCurrentMember(m)),
      // ★★★ fix-407 — THE LAST TWO BUCKETS THAT DID NOT ASK.
      //
      // fix-321 established one membership rule, fix-401 applied it to `acqs`
      // and fix-403 to `ents`. `dms` and `schematics` were still bare
      // `ofRole()` calls, so every picker sourcing them — the Team Structure
      // move-to dropdown, this tab's DM and Schematic pill lists, the Draw
      // Schedule Layout editor's DM dropdown and group-header datalist — would
      // offer a retired Design Manager for a NEW assignment.
      //
      // ★★ MEASURED ON PROD 2026-08-25: ZERO DMs and ZERO schematic designers
      // are currently inactive, so this changes nothing anybody can see today.
      // It is fixed anyway because the alternative is that it is discovered the
      // first time a manager leaves — which is precisely how Alex and Nidhi
      // came to be sitting under Jade as though they were current.
      dms: ofRole('dm').filter(isCurrentMember),
      // ★★★ fix-403 — THE ENT LIST, WIDENED **AND DEDUPED**.
      //
      // fix-401 found this had Acquisitions' exact single-role bug and left it
      // reported rather than fixed, because the two cases differ in the one way
      // that matters: 'acq' and 'acq_lead' are DISJOINT people, while 'ent' and
      // 'ent_lead' are the SAME three (Bobby, Briana and Miles hold both).
      // Widening alone would render each of them TWICE.
      //
      // ★★ So it is widen + dedupeByPerson, filtered to CURRENT members like
      // every other list (fix-321's one membership rule).
      ents: dedupeByPerson(
        all.filter((m) => ENT_ROLES.has(m.role) && isCurrentMember(m)),
      ),
      // ★★★ fix-401 — THE ACQUISITIONS LIST SHOWED TWO OF EIGHT PEOPLE.
      //
      // Bobby: *"I noticed that acquisitions is only showing like Kiley and
      // Jesse. It's not showing Dom, Jason, Scott, any of them."*
      //
      // ★★ THE DATA WAS NEVER WRONG. `ofRole('acq')` is a SINGLE-role filter,
      // and acquisitions is stored under TWO role strings: measured on prod
      // 2026-08-25, `acq` holds 2 people (Jessie, Keelie — the two he could
      // see) and `acq_lead` holds 6 (Caleb, Dom, Jake, Jason, Jeremy, Scott).
      // Every picker that offers acquisitions already reads BOTH —
      // ProjectSettingsModal (`t.role === 'acq' || t.role === 'acq_lead'`) and
      // the wizard's `ACQ_ROLES` set. Settings was the only surface asking a
      // narrower question than the app it configures.
      //
      // ★ ...and it is filtered to CURRENT members, like `activeDas` above and
      // like every picker: `isCurrentMember` is the one membership rule
      // (fix-321). That keeps Caleb, who is inactive, out of an editable
      // roster — he was never visible before either.
      acqs: all.filter((m) => ACQ_ROLES.has(m.role) && isCurrentMember(m)),
      schematics: ofRole('schematic').filter(isCurrentMember),
      activeMemberNames: activeMemberNamesOf(all),
      // ★★★ fix-407: everybody the roster says is NOT here, whatever their
      //   role. `formerDas` covers role='da' only, which is why Caleb —
      //   inactive, `acq_lead`, and holding 20 live projects — appeared on no
      //   Settings surface at all: filtered out of `acqs` by fix-401 and never
      //   eligible for the alumni list. Deduped per PERSON, because the roster
      //   has one row per role.
      inactive: dedupeByPerson(all.filter((m) => !isCurrentMember(m))),
    };
  }, [q.data]);

  return { ...q, ...result };
}
