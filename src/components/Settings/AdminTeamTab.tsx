import SettingsBlock from './SettingsBlock';
import PeopleTable from './PeopleTable';
import TeamStructureEditor from './TeamStructureEditor';
import DaRoutingEditor from './DaRoutingEditor';
import PermitsMissingLeadPanel from './PermitsMissingLeadPanel';
// ★★★ fix-487 §B (P-120): the third person-level panel, beside Departments and
//   Agenda members. It lists PEOPLE (not role rows) so it can reach the seven
//   viewers and the director who appear in none of the role lists below.
import WorkDataNamesPanel from './WorkDataNamesPanel';
import MentionTagsEditor from './MentionTagsEditor';
import TeamActiveQuartersEditor from './TeamActiveQuartersEditor';
import QuarterLayoutEditor from './QuarterLayoutEditor';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { formerMemberNames } from '../../lib/roster';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
// ★★★ fix-436 (P-086): the first card on this tab. Adding a person and
// retiring one are the same job a month apart, and fix-407 already put
// retiring here — see AddPersonSection for why this is not a sixth Settings
// section.
import AddPersonSection from './AddPersonSection';
import ClientBuildsPanel from './ClientBuildsPanel';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';

// ===========================================================================
// ★★★ fix-613 §A — WHAT THIS TAB IS NOW, AND WHAT IT STOPPED BEING
// ===========================================================================
//
// It held nine roster lists, each knowing one role, plus three different removal
// behaviours and three different rename behaviours. ⚖️ Bobby, 2026-09-30:
// **People = one table.** So the roster is `PeopleTable` — one row per person,
// roles as chips — and this file keeps only the blocks that were never about the
// roster: Team Structure, DA Routing, the draw-schedule layout, Active Quarters,
// Chat Tags, and three read-outs.
//
// ---------------------------------------------------------------------------
// ★★★ THE THREE REMOVAL BEHAVIOURS BECAME ONE, AND THE RENAMES BECAME NONE
// ---------------------------------------------------------------------------
// Removal was: DA → soft-delete (`former = true`); DM / ENT / ACQ → **hard
// delete**; former DA → × hard-deletes. Two of those three destroyed a roster
// row while ~2,209 assignments across 11 columns still pointed at the name
// (census gap 37). Now there is one verb, Retire, and no hard delete on any
// People surface.
//
// Renaming was `useRenameDA` / `useRenameDM`, advertised as cascades. They
// missed projects, routing and the draw schedule — so they split one person in
// two. **Both hooks are deleted** (⚖️ 2026-10-01), which also leaves
// `bp_rename_da` / `bp_rename_dm` with no client caller: the RPCs stay on prod
// (no migration), unreachable from the app, until something cascades all 11
// columns. "Goes by" is read-only everywhere in this feature.

export default function AdminTeamTab() {
  const teamQ = useTeamMembers();
  const isAdmin = useIsTenantAdmin();
  // ★ `useUpsertTeamMember` moved into PeopleTable with the roster; the three
  //   write hooks this tab used for renaming and deleting are gone entirely.

  if (teamQ.error) {
    return (
      <QueryError
        title="Team failed to load"
        error={teamQ.error}
        onRetry={() => teamQ.refetch()}
      />
    );
  }
  if (teamQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-16" />;
  }

  /**
   * ★★★ EVERY ROW BEHIND ONE PILL.
   *
   * ★★ fix-401: acquisitions is stored under TWO role strings (`acq` and
   * `acq_lead`), and the list renders both. Without a family-aware lookup,
   * removing Dom — who is `acq_lead` — would look up role `acq`, find nothing,
   * and SILENTLY DO NOTHING: a button that appears to work and does not.
   *
   * ★★★ fix-403 makes it return ALL matching rows, not the first, because the
   * ENT family OVERLAPS: Bobby, Briana and Miles each hold `ent` AND
   * `ent_lead`. Their pill now renders once (dedupeByPerson), so its × has to
   * remove the PERSON — every row backing it. Deleting one of two would leave
   * the pill on screen, which reads as "the button did nothing" and is exactly
   * the failure fix-401 fixed one layer up.
   */
  // ★★★ fix-613 §A — NINE LISTS’ WORTH OF MACHINERY IS GONE WITH THEM.
  //
  //     `findAllByName` / `findByName` / `addMember` / `softDeleteDa` /
  //     `restoreDa` / `hardDelete` / `renameSimple`, and the seven `*Items`
  //     arrays, existed to drive one pill list each. The Everyone table reads
  //     the roster once and `lib/peopleTable` owns the retire/restore rules,
  //     so there is one definition of each instead of nine call sites.
  //
  // ★★ AND `hardDelete` IS GONE RATHER THAN RELOCATED — census gap 37.
  //    `bp_delete_team_member_row` is no longer reachable from any People
  //    surface: a deleted row takes a name off the roster while ~2,209
  //    assignments across 11 columns still point at that string, which is
  //    exactly how a name nobody can map gets made.
  const retiredNames = formerMemberNames(teamQ.all);
  // ★★ fix-613 §A:  went with the alumni list. fix-407 added it
  //    because Caleb (acq_lead, active=false) appeared on NO Settings surface
  //    at all — the alumni card was DA-only. PeopleTable’s Former & inactive
  //    list now covers every role AND offers Restore for every role, which is
  //    the half fix-407 could not finish.

  return (
    <div className="space-y-4" data-testid="admin-team-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit the roster.
        </div>
      )}

      {/* ★★★ fix-436: FIRST, above the roster, because it is the thing you do
          before any of the rest of this screen applies to somebody. Renders
          nothing at all for a non-admin — a control that cannot work should be
          absent rather than disabled. */}
      <SettingsBlock id="add-person">
        <AddPersonSection readOnly={!isAdmin} />
      </SettingsBlock>

      {/* ★ fix-436 C4: the anchor AddPersonSection points at, so "retire them
          in the roster below" is a real link and not a description. */}
      <div id="team-roster" />

      {/* ★★★ fix-613 §A — NINE PILL LISTS BECAME ONE TABLE.
          ⚖️ Bobby, 2026-09-30: **People = one table.**

          Design Associates · Design Managers · Entitlement leads · Acquisition
          leads · Schematic · Construction admin · Names and emails · Departments ·
          Agenda members — nine cards, each knowing one role, none of which could
          say that Jade is one person holding three of them. See PeopleTable. */}
      <SettingsBlock id="everyone">
        <PeopleTable readOnly={!isAdmin} />
      </SettingsBlock>


      <SettingsBlock id="active-quarters">
        <TeamActiveQuartersEditor
          activeDas={teamQ.activeDas}
          readOnly={!isAdmin}
        />
      </SettingsBlock>


      <SettingsBlock id="team-structure">
        <TeamStructureEditor
          dms={teamQ.dms}
          activeDas={teamQ.activeDas}
          // ★★★ fix-407: computed from the WHOLE roster, not from `formerDas`.
          //   A mapping row can name anyone, and the chips must be able to flag
          //   a retired person of any role — while leaving a name the roster
          //   does not know at all unflagged, which is what
          //   `formerMemberNames` guarantees.
          retiredNames={retiredNames}
          readOnly={!isAdmin}
        />
      </SettingsBlock>

      {/* ★★★ fix-457 (P-007): DA → entitlement-lead routing, directly under
          Team Structure because they are the two mapping tables that answer
          "who does this DA report into" — dm_da_groups for the design manager,
          da_team_routing for the entitlement lead. Reading them apart is how
          the second one went five months without an editor.

          ★ Same readOnly gating as everything else on this tab: the DATABASE
          refuses a non-admin through RLS, and readOnly only hides the
          affordances. */}
      <SettingsBlock id="da-routing">
        <DaRoutingEditor
          activeDas={teamQ.activeDas}
          ents={teamQ.ents}
          readOnly={!isAdmin}
        />
      </SettingsBlock>

      {/* ★★★ fix-461 (P-045 prereq): the DEPARTMENT axis — Policy, Design &
          Entitlements, Acquisitions, Underwriting, and (fix-464) Executive and
          IT & Investor Relations.

          ★ SIX SINCE 2026-08-31. Bobby classified 32 of 35 people with this
          panel and found three it could not fit — a CEO, a President and an IT
          lead, who sit above the original four rather than inside one. A screen
          that still said "four" while its own dropdown offered six would be the
          next person's wrong answer.

          ★★ It sits directly under Team Structure and above the two permit-side
          gap panels because it is a fact about the ROSTER, like the lists above
          it, rather than about permits. And it is the FOURTH roster-gap surface
          on this tab, in the same warning shape as the other three on purpose.

          ★ A DEPARTMENT IS NOT A PERMISSION. Nothing gates on it. */}

      {/* ★★★ fix-462 §B2 (P-045): who is in the weekly meeting.
          ★ BESIDE Departments, because both answer "what is true of this
          PERSON" and both render people rather than role rows — they share
          fix-461's `foldRosterToPeople` so the tab has ONE definition of a
          person. Membership is a per-person checkbox by ruling, NOT a
          department: gating by department would mean adding one person to the
          meeting moves their whole department. */}

      {/* ★★★ fix-487 §B (P-120) — NAMES AND EMAILS.
          Bobby: *"have the ability to edit our team database so i can enter
          their last names too."*

          ★★ THE THIRD PERSON-LEVEL PANEL, directly under the other two. All
          three answer "what is true of this PERSON" rather than "who is in this
          role", and all three fold the roster to people first — because seven
          people carry two rows and a row-per-line panel shows them twice.

          ★★★ AND IT REACHES PEOPLE THE ROLE LISTS BELOW CANNOT. Seven viewers
          and a director hold no DA/DM/ENT/ACQ/Schematic/CA row, so an edit
          button hung off those pills would have missed a quarter of the roster
          while looking complete. */}

      {/* ★★★ fix-527 §A (P-243) — THE FOURTH ROSTER-GAP SURFACE, AND IN THE
          SAME SHAPE AS THE THREE ABOVE IT. fix-457's "active DA with no routing
          row", TeamStructureEditor's "⚠ Unassigned DAs" and fix-458's
          lead-less permits are all *"a gap in the roster"*; three visual
          languages for one idea would already be two too many, so this is the
          same count-then-list.

          ★★ IT SITS DIRECTLY UNDER "Names and emails" BECAUSE THAT IS WHERE THE
          FIX IS. Every unmapped name here is a roster row with no email, and
          the editor one section up is the control that sets one — a screen that
          reports a gap without naming the control that closes it is a
          complaint. */}
      <SettingsBlock id="who-the-work-data-means">
        <WorkDataNamesPanel readOnly={!isAdmin} />
      </SettingsBlock>

      {/* ★★★ fix-589 §A (P-289) — WHICH BUILD EACH PERSON IS ACTUALLY RUNNING.
          Bobby: *"Is there a way to see if others are on a super outdated
          version?"* Until this panel the answer was no — P-287 took a day and
          was settled by counting toolbar buttons in a screenshot, because
          fix-587's stamp rides on `error_reports` and a stale person's symptom
          is WRONG NUMBERS, not an error.

          ★★ THE FIFTH PANEL IN THE SAME SHAPE as the four above it: count, then
          list, then name the control that closes the gap. It is a roster fact
          about a PERSON, which is what this half of the tab is for, and it is a
          panel rather than a sixth Settings section for the same reason
          `AddPersonSection` is.

          ⚠️ `migrations/fix_589_client_build_seen.sql` is with Bobby. Until it
          runs the panel says "nothing recorded yet" rather than rendering an
          empty table that would read as "everybody is current". */}
      <SettingsBlock id="who-is-running-what">
        <ClientBuildsPanel />
      </SettingsBlock>

      {/* ★★★ fix-458 §A (P-106): the THIRD roster-gap surface on this tab, and
          deliberately in the same shape as the two above it — fix-457's
          "active DA with no routing row" and TeamStructureEditor's "⚠ Unassigned
          DAs". A gap in the roster is one idea; three visual languages for it
          would make the screen harder to read than the gaps it reports.

          ★★ It sits AFTER DA Routing because that is the causal order: a DA with
          no routing row is why a permit ends up with no lead, and a permit with
          no lead is why seventeen tasks reach nobody. */}
      <SettingsBlock id="permits-with-no-lead">
        <PermitsMissingLeadPanel ents={teamQ.ents} readOnly={!isAdmin} />
      </SettingsBlock>

      {/* ★★ fix-347 §2: the custom chat tags. Beside the other roster that
          decides who gets pinged, admin-gated the same way (the DATABASE
          refuses a non-admin; readOnly only hides the buttons). */}
      <SettingsBlock id="chat-tags">
        <MentionTagsEditor readOnly={!isAdmin} />
      </SettingsBlock>

      <SettingsBlock id="draw-schedule-layout">
        <QuarterLayoutEditor
          das={[...teamQ.activeDas, ...teamQ.formerDas]}
          dms={teamQ.dms}
          ents={teamQ.ents}
          readOnly={!isAdmin}
        />
      </SettingsBlock>



      {/* fix-222: Schematic Team roster — feeds the wizard's Schematic Designer
          picker and routes 'Schematic Team' template tasks. */}

      {/* ★★★ fix-487 (P-144) — CONSTRUCTION ADMINS, the sixth role list.
          Bobby: *"We want to add one more internal position, construction
          admin. There's two people on that team, Steve and David Rice."*

          ★ Same shape as the five above it, and `hardDelete`/`renameSimple` are
            role-parameterised, so nothing new is needed for either. There is no
            lead/second grade for this role, so `findAllByName`'s family
            branches do not apply and its plain `else` is correct. */}

      {/* ★★★ fix-613 §A: FORMER & INACTIVE MOVED INTO THE TABLE, because it
          is the same question asked of the same people. fix-611 merged the two
          halves (Former DAs + Inactive other roles) into one card; this makes
          it one list that covers EVERY role and offers Restore for every role
          — today only DAs could be restored, which is why Caleb (acq_lead,
          active=false) sat on no Settings surface at all. See PeopleTable. */}
    </div>
  );
}
