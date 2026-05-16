import PillListEditor from './PillListEditor';
import TeamStructureEditor from './TeamStructureEditor';
import TeamActiveQuartersEditor from './TeamActiveQuartersEditor';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useUpsertTeamMember } from '../../hooks/useUpsertTeamMember';
import { useDeleteTeamMember } from '../../hooks/useDeleteTeamMember';
import { useRenameDA } from '../../hooks/useRenameDA';
import { useRenameDM } from '../../hooks/useRenameDM';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { SkeletonRows } from '../Skeleton';
import QueryError from '../QueryError';
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

const ROLE_LABEL: Record<TeamRole, string> = {
  da: 'Design Associates',
  dm: 'Design Managers',
  ent: 'Entitlement Leads',
  ent_lead: 'Entitlement Leads',
  acq: 'Acquisition Leads',
  acq_lead: 'Acquisition Leads',
};

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

  function findByName(role: TeamRole, name: string): TeamMember | undefined {
    return teamQ.all.find((m) => m.role === role && m.name === name);
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

  function hardDelete(role: TeamRole, name: string) {
    const m = findByName(role, name);
    if (m) remove.mutate({ id: m.id, updated_at: m.updated_at });
  }

  function renameSimple(role: TeamRole, oldName: string, newName: string) {
    const m = findByName(role, oldName);
    if (m) upsert.mutate({ op: 'update', member: m, patch: { name: newName } });
  }

  const daItems = teamQ.activeDas.map((d) => ({ key: d.name, label: d.name }));
  const dmItems = teamQ.dms.map((m) => ({ key: m.name, label: m.name }));
  const entItems = teamQ.ents.map((m) => ({ key: m.name, label: m.name }));
  const acqItems = teamQ.acqs.map((m) => ({ key: m.name, label: m.name }));
  const formerItems = teamQ.formerDas.map((d) => ({
    key: d.name,
    label: d.name,
  }));

  return (
    <div className="space-y-4" data-testid="admin-team-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit the roster.
        </div>
      )}

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
