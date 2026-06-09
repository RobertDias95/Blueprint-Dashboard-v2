import { useMemo } from 'react';
import {
  useConsultantFirms,
  useProjectExternalTeam,
  useUpsertProjectExternalTeamMember,
} from '../../hooks/useConsultantFirms';
import {
  WAITING_ON_OPTIONS,
  type ConsultantFirm,
  type WaitingOnDiscipline,
} from '../../lib/database.types';

// fix-139: Project Settings → External Team. One row per WAITING_ON_OPTIONS
// discipline (13 rows). Each row assigns an active consultant firm (filtered
// to that discipline) to the project. Writes go straight to
// project_external_teams via bp_upsert_project_external_team_member (optimistic
// cache patch) — independent of the modal's atomic project save.
//
// Setting a firm to "— none —" (or clicking Clear) upserts firm_id=null, which
// the RPC turns into a DELETE of the pairing. Archived firms are excluded (the
// dropdown reads the active-only firms list) so they stop being assignable —
// but any existing assignment to a now-archived firm is left intact (fix-139
// trade-off, documented in the migration).

interface Props {
  projectId: string;
}

export default function ProjectExternalTeamPanel({ projectId }: Props) {
  const firmsQ = useConsultantFirms(); // active only
  const { byDiscipline } = useProjectExternalTeam(projectId);
  const upsert = useUpsertProjectExternalTeamMember();

  // Group active firms by discipline so each row's dropdown only offers its
  // own discipline's firms.
  const firmsByDiscipline = useMemo(() => {
    const map = new Map<WaitingOnDiscipline, ConsultantFirm[]>();
    for (const d of WAITING_ON_OPTIONS) map.set(d, []);
    for (const firm of firmsQ.data ?? []) {
      const list = map.get(firm.discipline);
      if (list) list.push(firm);
    }
    return map;
  }, [firmsQ.data]);

  return (
    <div className="flex flex-col gap-1.5 w-full col-span-2" data-testid="project-external-team-section">
      <p className="text-[10px] text-dim mb-1">
        Consultant firms responsible for each discipline on this project.
      </p>
      {WAITING_ON_OPTIONS.map((discipline) => {
        const options = firmsByDiscipline.get(discipline) ?? [];
        const assigned = byDiscipline.get(discipline) ?? null;
        const hasFirms = options.length > 0;
        const selectedId = assigned?.firm_id ?? '';
        return (
          <div
            key={discipline}
            className="flex items-center gap-2"
            data-testid={`project-external-team-row-${discipline}`}
          >
            <span className="text-[11px] text-text w-24 shrink-0">
              {discipline}
            </span>
            <select
              value={selectedId}
              disabled={!hasFirms}
              onChange={(e) => {
                const firmId = e.target.value || null;
                const firmName =
                  options.find((f) => f.id === firmId)?.name ?? null;
                upsert.mutate({ projectId, discipline, firmId, firmName });
              }}
              className="flex-1 px-2 py-1 text-[11px] border rounded bg-surface text-text outline-none focus:border-de disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`project-external-team-firm-select-${discipline}`}
            >
              <option value="">— none —</option>
              {options.map((firm) => (
                <option key={firm.id} value={firm.id}>
                  {firm.name}
                </option>
              ))}
            </select>
            {selectedId ? (
              <button
                type="button"
                onClick={() =>
                  upsert.mutate({ projectId, discipline, firmId: null })
                }
                className="text-dim hover:text-co text-[12px] leading-none px-1"
                title={`Clear ${discipline} firm`}
                data-testid={`project-external-team-clear-${discipline}`}
              >
                ✕
              </button>
            ) : (
              <span className="w-[18px] shrink-0" aria-hidden="true" />
            )}
            {!hasFirms && (
              <span
                className="text-[9px] text-dim italic shrink-0"
                data-testid={`project-external-team-empty-${discipline}`}
              >
                Add a {discipline} firm in Settings → Consultant Firms.
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
