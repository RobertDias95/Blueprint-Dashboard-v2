import { useMemo } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useExternalTeamShowRules } from '../../hooks/useExternalTeamShowRules';
import { useExternalTeamDirectory } from '../../hooks/useExternalTeamDirectory';
import {
  asExternalTeamBlob,
  directoryFirmNamesForDiscipline,
  type ExternalTeamBlob,
} from '../../lib/externalTeam';
import ExternalFirmSelect from './ExternalFirmSelect';
import type { WaitingOnDiscipline } from '../../lib/database.types';

// fix-139 / fix-193 / fix-195 / fix-227: Project Settings → External Team.
//
// fix-195: ONE store. Reads/writes projects.external_team — the JSON blob
// { <discipline>: <firmName> } that My Tasks → Waiting + the Project Overview
// "External" editor already use (resolveExternalFirm). Writes go through
// useUpdateProject (the same read-modify-write the Overview editor uses),
// OCC-safe + optimistic.
//
// fix-227: the firm field is now a DROPDOWN sourced from the central External
// Team directory (external_team_directory) for that discipline, via the shared
// ExternalFirmSelect. Picking a firm still writes the blob (unchanged); an
// inline "+ Add new firm…" inserts into the directory so it's reusable. Existing
// free-text blob firms not in the directory still render + stay selected.
//
// fix-193 show-rules (UNCHANGED):
//   - The COMMON FOUR (Civil / Surveyor / Structural / Arborist) ALWAYS render
//     as fill-in slots even when unassigned — the empty slot doubles as the
//     reminder to fill it in.
//   - Every OTHER discipline renders ONLY when it has a firm assigned, OR when
//     the user surfaces it via the "+ Add discipline" control.
//   - When the project has NO external firm assigned at all, a reminder/CTA
//     banner sits above the slots.
//
// Canonical WAITING_ON_OPTIONS vocabulary (fix-190d: "Surveyor", not "Survey") —
// the blob keys ARE these terms, so a task waiting on "Surveyor" resolves to
// external_team["Surveyor"].

interface Props {
  projectId: string;
}

export default function ProjectExternalTeamPanel({ projectId }: Props) {
  const projectsQ = useProjects();
  const updateMutation = useUpdateProject();
  const directoryQ = useExternalTeamDirectory();

  const project = useMemo(
    () => (projectsQ.data ?? []).find((p) => p.id === projectId) ?? null,
    [projectsQ.data, projectId],
  );
  const blob = useMemo<ExternalTeamBlob>(
    () => asExternalTeamBlob(project?.external_team) ?? {},
    [project?.external_team],
  );

  const directory = directoryQ.data ?? [];

  // fix-196: the show-rules (common four + assigned + added, addable, empty CTA)
  // come from the SHARED hook so this panel and the Overview editor can't drift.
  const { shownDisciplines, addableDisciplines, noneAssigned, addDiscipline } =
    useExternalTeamShowRules(blob);

  const occMissing = !project?.updated_at;

  async function writeFirm(discipline: WaitingOnDiscipline, firm: string) {
    if (!project?.updated_at) return;
    const next: ExternalTeamBlob = { ...blob };
    const t = firm.trim();
    const prev = (blob[discipline] ?? '').trim();
    if (t === prev) return; // no-op — nothing changed
    if (t) next[discipline] = t;
    else delete next[discipline];
    await updateMutation.mutateAsync({
      projectId,
      expectedUpdatedAt: project.updated_at,
      patch: { external_team: next },
      fieldLabel: `${discipline} consultant`,
    });
  }

  function clear(discipline: WaitingOnDiscipline) {
    void writeFirm(discipline, '');
  }

  return (
    <div
      className="flex flex-col gap-1.5 w-full col-span-2"
      data-testid="project-external-team-section"
    >
      <p className="text-[10px] text-dim mb-1">
        Consultant firms responsible for each discipline on this project.
      </p>

      {/* fix-193: empty-state reminder. */}
      {noneAssigned && (
        <div
          className="text-[10px] rounded border px-2 py-1.5 mb-1"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-co)',
          }}
          data-testid="project-external-team-empty-cta"
        >
          No external team set up yet. Most projects need at least a{' '}
          <span className="font-bold">Surveyor</span>,{' '}
          <span className="font-bold">Structural</span>, and{' '}
          <span className="font-bold">Arborist</span> — assign their firms in the
          slots below.
        </div>
      )}

      {shownDisciplines.map((discipline) => {
        const saved = blob[discipline] ?? '';
        return (
          <div
            key={discipline}
            className="flex items-center gap-2"
            data-testid={`project-external-team-row-${discipline}`}
          >
            <span className="text-[11px] text-text w-24 shrink-0">
              {discipline}
            </span>
            <ExternalFirmSelect
              discipline={discipline}
              value={saved}
              firms={directoryFirmNamesForDiscipline(directory, discipline)}
              disabled={occMissing || updateMutation.isPending}
              variant="panel"
              testIdBase={`project-external-team-firm-${discipline}`}
              onCommit={(firm) => void writeFirm(discipline, firm)}
            />
            {saved ? (
              <button
                type="button"
                onClick={() => clear(discipline)}
                className="text-dim hover:text-co text-[12px] leading-none px-1"
                title={`Clear ${discipline} firm`}
                data-testid={`project-external-team-clear-${discipline}`}
              >
                ✕
              </button>
            ) : (
              <span className="w-[18px] shrink-0" aria-hidden="true" />
            )}
          </div>
        );
      })}

      {/* fix-193: surface an as-yet-unshown discipline. */}
      {addableDisciplines.length > 0 && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="w-24 shrink-0" aria-hidden="true" />
          <select
            value=""
            onChange={(e) => {
              const d = e.target.value as WaitingOnDiscipline;
              if (d) addDiscipline(d);
            }}
            className="flex-1 px-2 py-1 text-[11px] border rounded bg-surface text-dim outline-none focus:border-de"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="project-external-team-add-discipline"
          >
            <option value="">+ Add discipline…</option>
            {addableDisciplines.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="w-[18px] shrink-0" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
