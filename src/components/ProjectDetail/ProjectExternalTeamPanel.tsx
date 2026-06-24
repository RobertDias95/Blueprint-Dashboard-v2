import { useMemo, useState } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useExternalTeamShowRules } from '../../hooks/useExternalTeamShowRules';
import {
  asExternalTeamBlob,
  distinctExternalFirms,
  type ExternalTeamBlob,
} from '../../lib/externalTeam';
import type { WaitingOnDiscipline } from '../../lib/database.types';

// fix-139 / fix-193 / fix-195: Project Settings → External Team.
//
// fix-195: ONE store. Reads/writes projects.external_team — the JSON blob
// { <discipline>: <firmName> } that My Tasks → Waiting + the Project Overview
// "External" editor already use (resolveExternalFirm). The old normalized
// project_external_teams table + consultant_firms registry are retired here: the
// panel no longer touches them. Writes go through useUpdateProject (the same
// read-modify-write the Overview editor uses), OCC-safe + optimistic. Firms are
// free text (no registry) — a <datalist> of the distinct firm names already used
// across all projects' blobs makes existing firms one-click reusable.
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

const FIRM_DATALIST_ID = 'project-external-team-firm-options';

interface Props {
  projectId: string;
}

export default function ProjectExternalTeamPanel({ projectId }: Props) {
  const projectsQ = useProjects();
  const updateMutation = useUpdateProject();

  const project = useMemo(
    () => (projectsQ.data ?? []).find((p) => p.id === projectId) ?? null,
    [projectsQ.data, projectId],
  );
  const blob = useMemo<ExternalTeamBlob>(
    () => asExternalTeamBlob(project?.external_team) ?? {},
    [project?.external_team],
  );

  // fix-195: distinct firm names across ALL projects' blobs → the datalist.
  const firmSuggestions = useMemo(
    () => distinctExternalFirms(projectsQ.data ?? []),
    [projectsQ.data],
  );

  // fix-196: the show-rules (common four + assigned + added, addable, empty CTA)
  // come from the SHARED hook so this panel and the Overview editor can't drift.
  const { shownDisciplines, addableDisciplines, noneAssigned, addDiscipline } =
    useExternalTeamShowRules(blob);

  // Per-field text drafts so typing doesn't fire a write per keystroke; commit
  // on blur / Enter. Absent key → the input falls back to the saved blob value.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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

  function dropDraft(discipline: WaitingOnDiscipline) {
    setDrafts((prev) => {
      if (!(discipline in prev)) return prev;
      const rest = { ...prev };
      delete rest[discipline];
      return rest;
    });
  }

  function commit(discipline: WaitingOnDiscipline) {
    const draft = drafts[discipline];
    dropDraft(discipline);
    if (draft !== undefined) void writeFirm(discipline, draft);
  }

  function clear(discipline: WaitingOnDiscipline) {
    dropDraft(discipline);
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

      {/* fix-195: shared firm suggestions (distinct firms across all blobs). */}
      <datalist id={FIRM_DATALIST_ID} data-testid="project-external-team-firm-datalist">
        {firmSuggestions.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {shownDisciplines.map((discipline) => {
        const saved = blob[discipline] ?? '';
        const value = drafts[discipline] ?? saved;
        return (
          <div
            key={discipline}
            className="flex items-center gap-2"
            data-testid={`project-external-team-row-${discipline}`}
          >
            <span className="text-[11px] text-text w-24 shrink-0">
              {discipline}
            </span>
            <input
              type="text"
              list={FIRM_DATALIST_ID}
              value={value}
              disabled={occMissing || updateMutation.isPending}
              placeholder="Firm name"
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [discipline]: e.target.value }))
              }
              onBlur={() => commit(discipline)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="flex-1 px-2 py-1 text-[11px] border rounded bg-surface text-text outline-none focus:border-de disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid={`project-external-team-firm-input-${discipline}`}
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
