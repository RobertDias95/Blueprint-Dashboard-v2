import PillListEditor from './PillListEditor';
import TeamStructureEditor from './TeamStructureEditor';
import DaRoutingEditor from './DaRoutingEditor';
import PermitsMissingLeadPanel from './PermitsMissingLeadPanel';
import DepartmentEditor from './DepartmentEditor';
import MentionTagsEditor from './MentionTagsEditor';
import TeamActiveQuartersEditor from './TeamActiveQuartersEditor';
import QuarterLayoutEditor from './QuarterLayoutEditor';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { ACQ_ROLES, ENT_ROLES, formerMemberNames } from '../../lib/roster';
import { useUpsertTeamMember } from '../../hooks/useUpsertTeamMember';
import { useDeleteTeamMember } from '../../hooks/useDeleteTeamMember';
import { useRenameDA } from '../../hooks/useRenameDA';
import { useRenameDM } from '../../hooks/useRenameDM';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
// ★★★ fix-436 (P-086): the first card on this tab. Adding a person and
// retiring one are the same job a month apart, and fix-407 already put
// retiring here — see AddPersonSection for why this is not a sixth Settings
// section.
import AddPersonSection from './AddPersonSection';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
import { ROLE_TITLE, ROLE_TITLE_PLURAL } from '../../lib/roleLabels';
import type { TeamMember, TeamRole } from '../../lib/database.types';

// Q7.3.b: Settings → Team tab. Four role-filtered PillListEditors
// (Design Associates, Design Managers, Entitlement Leads, Acquisition
// Leads) + Team Structure (DM → DA assignments) + Former DAs alumni.
//
// Rename behavior depends on role:
//   - DA: useRenameDA — atomic cascade across team_members + dm_da_groups
//         + permits.da + permits.architect + permit_tasks.assigned_to +
//         da_time_blocks.da_name. Server-verified end-to-end.
//   - DM: useRenameDM — cascade across team_members + dm_da_groups.dm_name
//         + permits.dm.
//   - ENT/ACQ: useUpsertTeamMember with patch {name}. No cascade — v1
//         parity (old name lives on in historical permits.ent_lead).
//
// Removal behavior:
//   - DA: soft-delete (set former=true) — moves to the Former section.
//   - DM/ENT/ACQ: hard delete via useDeleteTeamMember.
//   - Former DA: ↩ restores (former=false); × hard-deletes.

// ★ fix-343: this map moved to lib/roleLabels (ROLE_TITLE_PLURAL) — the same
// place the user chip gets its singular titles from, so a role can never be
// called two things in one app. The values are unchanged; `viewer` joined them
// there when the role landed on prod. The local alias keeps every call site
// below reading as it did.
const ROLE_LABEL = ROLE_TITLE_PLURAL;

export default function AdminTeamTab() {
  const teamQ = useTeamMembers();
  const isAdmin = useIsTenantAdmin();
  const upsert = useUpsertTeamMember();
  const remove = useDeleteTeamMember();
  const renameDA = useRenameDA();
  const renameDM = useRenameDM();

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
  function findAllByName(role: TeamRole, name: string): TeamMember[] {
    const family = ACQ_ROLES.has(role)
      ? ACQ_ROLES
      : ENT_ROLES.has(role)
        ? ENT_ROLES
        : null;
    if (family) {
      return teamQ.all.filter((m) => family.has(m.role) && m.name === name);
    }
    return teamQ.all.filter((m) => m.role === role && m.name === name);
  }

  function findByName(role: TeamRole, name: string): TeamMember | undefined {
    return findAllByName(role, name)[0];
  }

  function addMember(role: TeamRole, name: string) {
    if (teamQ.all.some((m) => m.role === role && m.name === name)) return;
    upsert.mutate({ op: 'insert', patch: { name, role } });
  }

  function softDeleteDa(name: string) {
    const m = findByName('da', name);
    if (m) upsert.mutate({ op: 'update', member: m, patch: { former: true } });
  }

  function restoreDa(name: string) {
    const m = findByName('da', name);
    if (m) upsert.mutate({ op: 'update', member: m, patch: { former: false } });
  }

  /** ★★ Removing a DUAL-ROLE person removes BOTH rows — the decision, stated.
   *
   *  The alternatives were worse. Deleting one row leaves the pill on screen
   *  (the other row still backs it), so the × looks broken. Asking "which
   *  role?" surfaces a storage detail nobody outside this file thinks about —
   *  the Settings list is a list of PEOPLE, and its × means "this person is not
   *  an Entitlement Lead any more".
   *
   *  ★ Each row is deleted with its OWN OCC token, so a concurrent edit to one
   *  of them conflicts on that row rather than being clobbered. */
  function hardDelete(role: TeamRole, name: string) {
    for (const m of findAllByName(role, name)) {
      remove.mutate({ id: m.id, updated_at: m.updated_at });
    }
  }

  /** ★★ ...and renaming one renames BOTH, for the same reason inverted: the
   *  name is the join key the rest of the app matches on, so leaving one row
   *  under the old spelling would split one person into two. */
  function renameSimple(role: TeamRole, oldName: string, newName: string) {
    for (const m of findAllByName(role, oldName)) {
      upsert.mutate({ op: 'update', member: m, patch: { name: newName } });
    }
  }

  const daItems = teamQ.activeDas.map((d) => ({ key: d.name, label: d.name }));
  const dmItems = teamQ.dms.map((m) => ({ key: m.name, label: m.name }));
  const entItems = teamQ.ents.map((m) => ({ key: m.name, label: m.name }));
  const acqItems = teamQ.acqs.map((m) => ({ key: m.name, label: m.name }));
  const schematicItems = teamQ.schematics.map((m) => ({
    key: m.name,
    label: m.name,
  }));
  const formerItems = teamQ.formerDas.map((d) => ({
    key: d.name,
    label: d.name,
  }));
  /** ★★★ fix-407: the names the roster explicitly says are retired, any role.
   *  Shared by the Team Structure chips and the alumni section below so the two
   *  cannot disagree about who has left. */
  const retiredNames = formerMemberNames(teamQ.all);
  /** ★★★ fix-407: inactive people who are NOT DAs — Caleb is the live case.
   *  He is `acq_lead` with `active=false`, so fix-401's `isCurrentMember`
   *  filter correctly keeps him out of the Acquisitions picker, and the alumni
   *  section below has always been DA-only. Net effect before this ticket: a
   *  man who is named on 20 live projects appeared on NO Settings surface at
   *  all. You cannot clean up what the screen will not show you.
   *
   *  ★★★ `?? []` IS THE PARTIALLY-MOCKED-MODULE GUARD, not defensive noise.
   *  Roughly forty test files mock `hooks/useTeamMembers` with a hand-written
   *  object, so a NEW field on the result is `undefined` at the call site and
   *  `.filter` throws inside a render — 18 AdminTeamTab tests failed exactly
   *  that way before this. Same trap fix-390 hit and fix-401 hit again; the
   *  difference here is that the field genuinely belongs on this hook, so it
   *  is guarded rather than relocated. */
  const otherInactive = (teamQ.inactive ?? []).filter((m) => m.role !== 'da');

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
      <AddPersonSection readOnly={!isAdmin} />

      {/* ★ fix-436 C4: the anchor AddPersonSection points at, so "retire them
          in the roster below" is a real link and not a description. */}
      <div id="team-roster" />

      <Section title={ROLE_LABEL.da}>
        <PillListEditor
          label={ROLE_LABEL.da}
          items={daItems}
          onAdd={(name) => addMember('da', name)}
          onRemove={(name) => softDeleteDa(name)}
          onRename={(oldName, newName) =>
            renameDA.mutate({ oldName, newName })
          }
          placeholder="Add Design Associate…"
          readOnly={!isAdmin}
          testIdPrefix="team-da"
        />
      </Section>

      <Section title="Active Quarters">
        <TeamActiveQuartersEditor
          activeDas={teamQ.activeDas}
          readOnly={!isAdmin}
        />
      </Section>

      <Section title={ROLE_LABEL.dm}>
        <PillListEditor
          label={ROLE_LABEL.dm}
          items={dmItems}
          onAdd={(name) => addMember('dm', name)}
          onRemove={(name) => hardDelete('dm', name)}
          onRename={(oldName, newName) =>
            renameDM.mutate({ oldName, newName })
          }
          placeholder="Add Design Manager…"
          readOnly={!isAdmin}
          testIdPrefix="team-dm"
        />
      </Section>

      <Section title="Team Structure">
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
      </Section>

      {/* ★★★ fix-457 (P-007): DA → entitlement-lead routing, directly under
          Team Structure because they are the two mapping tables that answer
          "who does this DA report into" — dm_da_groups for the design manager,
          da_team_routing for the entitlement lead. Reading them apart is how
          the second one went five months without an editor.

          ★ Same readOnly gating as everything else on this tab: the DATABASE
          refuses a non-admin through RLS, and readOnly only hides the
          affordances. */}
      <Section title="DA Routing (entitlement lead)">
        <DaRoutingEditor
          activeDas={teamQ.activeDas}
          ents={teamQ.ents}
          readOnly={!isAdmin}
        />
      </Section>

      {/* ★★★ fix-461 (P-045 prereq): the DEPARTMENT axis — Policy, Design &
          Entitlements, Acquisitions, Underwriting.

          ★★ It sits directly under Team Structure and above the two permit-side
          gap panels because it is a fact about the ROSTER, like the lists above
          it, rather than about permits. And it is the FOURTH roster-gap surface
          on this tab, in the same warning shape as the other three on purpose.

          ★ A DEPARTMENT IS NOT A PERMISSION. Nothing gates on it. */}
      <Section title="Departments">
        <DepartmentEditor members={teamQ.all} readOnly={!isAdmin} />
      </Section>

      {/* ★★★ fix-458 §A (P-106): the THIRD roster-gap surface on this tab, and
          deliberately in the same shape as the two above it — fix-457's
          "active DA with no routing row" and TeamStructureEditor's "⚠ Unassigned
          DAs". A gap in the roster is one idea; three visual languages for it
          would make the screen harder to read than the gaps it reports.

          ★★ It sits AFTER DA Routing because that is the causal order: a DA with
          no routing row is why a permit ends up with no lead, and a permit with
          no lead is why seventeen tasks reach nobody. */}
      <Section title="Permits with no entitlement lead">
        <PermitsMissingLeadPanel ents={teamQ.ents} readOnly={!isAdmin} />
      </Section>

      {/* ★★ fix-347 §2: the custom chat tags. Beside the other roster that
          decides who gets pinged, admin-gated the same way (the DATABASE
          refuses a non-admin; readOnly only hides the buttons). */}
      <Section title="Chat Tags">
        <MentionTagsEditor readOnly={!isAdmin} />
      </Section>

      <Section title="Draw Schedule Layout (per quarter)">
        <QuarterLayoutEditor
          das={[...teamQ.activeDas, ...teamQ.formerDas]}
          dms={teamQ.dms}
          ents={teamQ.ents}
          readOnly={!isAdmin}
        />
      </Section>

      <Section title={ROLE_LABEL.ent}>
        <PillListEditor
          label={ROLE_LABEL.ent}
          items={entItems}
          onAdd={(name) => addMember('ent', name)}
          onRemove={(name) => hardDelete('ent', name)}
          onRename={(oldName, newName) => renameSimple('ent', oldName, newName)}
          placeholder="Add Entitlement Lead…"
          readOnly={!isAdmin}
          testIdPrefix="team-ent"
        />
      </Section>

      <Section title={ROLE_LABEL.acq}>
        <PillListEditor
          label={ROLE_LABEL.acq}
          items={acqItems}
          onAdd={(name) => addMember('acq', name)}
          onRemove={(name) => hardDelete('acq', name)}
          onRename={(oldName, newName) => renameSimple('acq', oldName, newName)}
          placeholder="Add Acquisition Lead…"
          readOnly={!isAdmin}
          testIdPrefix="team-acq"
        />
      </Section>

      {/* fix-222: Schematic Team roster — feeds the wizard's Schematic Designer
          picker and routes 'Schematic Team' template tasks. */}
      <Section title={ROLE_LABEL.schematic}>
        <PillListEditor
          label={ROLE_LABEL.schematic}
          items={schematicItems}
          onAdd={(name) => addMember('schematic', name)}
          onRemove={(name) => hardDelete('schematic', name)}
          onRename={(oldName, newName) =>
            renameSimple('schematic', oldName, newName)
          }
          placeholder="Add Schematic Designer…"
          readOnly={!isAdmin}
          testIdPrefix="team-schematic"
        />
      </Section>

      {formerItems.length > 0 && (
        <Section title="Former DAs (alumni)">
          <p className="text-[11px] text-muted mb-2">
            Restored DAs return to the active list. Permanent removal cannot be
            undone — historical permits referencing the name keep the string.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {teamQ.formerDas.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface border border-border text-xs text-muted"
                data-testid={`team-former-pill-${d.name}`}
              >
                <span>{d.name}</span>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => restoreDa(d.name)}
                      className="text-pm hover:text-pm/70 text-sm pl-0.5"
                      title="Restore to active"
                      data-testid={`team-former-restore-${d.name}`}
                    >
                      ↩
                    </button>
                    <button
                      onClick={() => hardDelete('da', d.name)}
                      className="text-co hover:text-co/70 text-sm pl-0.5"
                      title="Permanently remove"
                      data-testid={`team-former-remove-${d.name}`}
                    >
                      ×
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ★★★ fix-407 — THE ALUMNI SECTION STOPS BEING DA-ONLY.
          Bobby: *"a wholistic clean … to ensure our ecosystem is update to
          date and aligned."* The section above has covered `role='da'` since
          Q7.3.b, which meant every inactive person in any other role was
          invisible here — while still being named on live rows.

          ★★ NO RESTORE OR REMOVE BUTTON, deliberately. Those two actions are
          the DA flow (`restoreDa` sets the DA flags; `hardDelete` drops the
          row), and offering a permanent-remove on somebody who is still the
          acquisitions lead of twenty live projects would be handing over a
          footgun in the name of tidiness. This section's job is to make them
          VISIBLE; who inherits their rows is fix-407's transition report, and
          Bobby's call. */}
      {otherInactive.length > 0 && (
        <Section title="Inactive (other roles)">
          <p className="text-[11px] text-muted mb-2">
            On the roster but not active, so they are offered by no picker. They
            may still be named on live records — see the fix-407 transition
            report before reassigning anyone.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {otherInactive.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border text-xs text-muted"
                data-testid={`team-inactive-pill-${m.name}`}
              >
                <span className="line-through decoration-dim/60">{m.name}</span>
                {/* ★★ fix-343's rule, and it caught me: NEVER interpolate a
                    stored role into the screen. Printing the member's role
                    field directly would put the raw enum — "acq_lead" — in
                    front of a person; ROLE_TITLE is the one map that turns it
                    into words.

                    ★ And note the shape of the catch: fix-343's scan reads the
                    SOURCE, so even quoting the offending expression in a
                    comment trips it. Left described rather than quoted. */}
                <span className="text-[9px] uppercase tracking-wide font-bold">
                  {ROLE_TITLE[m.role]}
                </span>
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <h2 className="text-sm font-display font-bold text-text mb-3">{title}</h2>
      {children}
    </div>
  );
}
