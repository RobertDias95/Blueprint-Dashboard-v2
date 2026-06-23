import { useMemo, useState } from 'react';
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

// fix-139 / fix-193: Project Settings → External Team. Writes go straight to
// project_external_teams via bp_upsert_project_external_team_member (optimistic
// cache patch) — the same store the editor has always used, canonical
// WAITING_ON_OPTIONS vocabulary (fix-190d: "Surveyor", not "Survey"). No second
// source is introduced.
//
// fix-193 show-rules (was: one row per all 13 disciplines, blank or not):
//   - The COMMON FOUR (Civil / Surveyor / Structural / Arborist) ALWAYS render
//     as fill-in slots even when unassigned — they're near-always needed, so the
//     empty slot doubles as the reminder to fill it in.
//   - Every OTHER discipline renders ONLY when it has a firm assigned, OR when
//     the user surfaces it via the "+ Add discipline" control below.
//   - When the project has NO external firms assigned at all, a reminder/CTA
//     banner sits above the slots (there's almost always a surveyor / structural
//     / arborist to capture).
//
// Setting a firm to "— none —" (or clicking Clear) upserts firm_id=null, which
// the RPC turns into a DELETE of the pairing. Archived firms are excluded (the
// dropdown reads the active-only firms list) so they stop being assignable —
// but any existing assignment to a now-archived firm is left intact (fix-139
// trade-off, documented in the migration).

// fix-193: the near-always-needed disciplines, always shown as slots.
const COMMON_DISCIPLINES: readonly WaitingOnDiscipline[] = [
  'Civil',
  'Surveyor',
  'Structural',
  'Arborist',
];

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

  // Which disciplines currently have a firm assigned (from the same store the
  // dropdowns write to). Drives the "show others only when assigned" rule and
  // the empty-state banner.
  const assignedDisciplines = useMemo(() => {
    const s = new Set<WaitingOnDiscipline>();
    for (const d of WAITING_ON_OPTIONS) {
      if (byDiscipline.get(d)?.firm_id) s.add(d);
    }
    return s;
  }, [byDiscipline]);

  // fix-193: disciplines the user explicitly surfaced via "+ Add discipline".
  // Local-only (resets on close) — once a firm is assigned the row persists on
  // its own via assignedDisciplines, so there's nothing to store server-side.
  const [added, setAdded] = useState<Set<WaitingOnDiscipline>>(new Set());

  const shownDisciplines = useMemo(
    () =>
      WAITING_ON_OPTIONS.filter(
        (d) =>
          COMMON_DISCIPLINES.includes(d) ||
          assignedDisciplines.has(d) ||
          added.has(d),
      ),
    [assignedDisciplines, added],
  );

  const addableDisciplines = useMemo(
    () => WAITING_ON_OPTIONS.filter((d) => !shownDisciplines.includes(d)),
    [shownDisciplines],
  );

  const noneAssigned = assignedDisciplines.size === 0;

  return (
    <div
      className="flex flex-col gap-1.5 w-full col-span-2"
      data-testid="project-external-team-section"
    >
      <p className="text-[10px] text-dim mb-1">
        Consultant firms responsible for each discipline on this project.
      </p>

      {/* fix-193: empty-state reminder — almost every project needs at least a
          surveyor / structural / arborist, so nudge the user to set them up. */}
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

      {/* fix-193: surface an as-yet-unshown discipline (Geotech, Mechanical,
          Electrical, Plumbing, Energy, Stormwater, Landscape, Architect, Other).
          Picking one renders its slot so a firm can be assigned; once assigned
          the row persists on its own. */}
      {addableDisciplines.length > 0 && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="w-24 shrink-0" aria-hidden="true" />
          <select
            value=""
            onChange={(e) => {
              const d = e.target.value as WaitingOnDiscipline;
              if (!d) return;
              setAdded((prev) => {
                const next = new Set(prev);
                next.add(d);
                return next;
              });
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
