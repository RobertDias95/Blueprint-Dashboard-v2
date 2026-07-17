import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useAllNotes, useAddNote, useUpdateNote } from '../hooks/useNotes';
import NoteRow from '../components/notes/NoteRow';
import AddNoteBox from '../components/notes/AddNoteBox';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import type { Note, Permit, Project } from '../lib/database.types';

// fix-notes-3: Weekly Updates report — every project's running notes in one
// place for Bobby's Monday pass. Grouped by project: the holistic project
// note(s) first, then each permit's active notes (permit_order), newest first.
// Every note is editable inline and each scope has an add box — all routed
// through the SAME fix-notes-1 hooks (useAddNote/useUpdateNote), so an edit
// here writes straight back to public.notes and shows on the permit/project
// views + dashboard card via the shared notes-prefix invalidation.

interface PermitScope {
  permit: Permit;
  notes: Note[];
}
interface ProjectGroup {
  project: Project;
  holistic: Note[];
  permits: PermitScope[];
  /** any ACTIVE (completed=false) note anywhere in this project group */
  hasActiveNotes: boolean;
}

function permitLabel(p: Permit): string {
  const base =
    p.type === 'Building Permit' && p.nickname
      ? `Building Permit — ${p.nickname}`
      : p.type ?? 'Permit';
  const parts = [base];
  if (p.num) parts.push(p.num);
  if (p.struct_address) parts.push(p.struct_address);
  return parts.join(' · ');
}

function hasActive(notes: Note[]): boolean {
  return notes.some((n) => !n.completed);
}

export default function WeeklyUpdatesReport() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const notesQ = useAllNotes();
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);

  const groups = useMemo<ProjectGroup[]>(() => {
    const projects = (projectsQ.data ?? []).filter((p) => !p.archived);
    const permits = permitsQ.data ?? [];
    const notes = notesQ.data ?? []; // already created_at DESC (newest first)

    const permitsByProject = new Map<string, Permit[]>();
    for (const pm of permits) {
      const list = permitsByProject.get(pm.project_id) ?? [];
      list.push(pm);
      permitsByProject.set(pm.project_id, list);
    }
    const notesByProjectHolistic = new Map<string, Note[]>();
    const notesByPermit = new Map<number, Note[]>();
    for (const n of notes) {
      if (n.permit_id == null) {
        const list = notesByProjectHolistic.get(n.project_id) ?? [];
        list.push(n);
        notesByProjectHolistic.set(n.project_id, list);
      } else {
        const list = notesByPermit.get(n.permit_id) ?? [];
        list.push(n);
        notesByPermit.set(n.permit_id, list);
      }
    }

    const out: ProjectGroup[] = projects
      .map((project) => {
        const order = Array.isArray(project.permit_order)
          ? project.permit_order
          : [];
        const permitList = [...(permitsByProject.get(project.id) ?? [])].sort(
          (a, b) => {
            const ia = order.indexOf(a.id);
            const ib = order.indexOf(b.id);
            const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
            const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
            return ra !== rb ? ra - rb : a.id - b.id;
          },
        );
        const holistic = notesByProjectHolistic.get(project.id) ?? [];
        const permitScopes: PermitScope[] = permitList.map((permit) => ({
          permit,
          notes: notesByPermit.get(permit.id) ?? [],
        }));
        const hasActiveNotes =
          hasActive(holistic) || permitScopes.some((s) => hasActive(s.notes));
        return { project, holistic, permits: permitScopes, hasActiveNotes };
      })
      .sort((a, b) => {
        // Projects with active notes first (Bobby's Monday attention), then the
        // rest — both alphabetical by address.
        if (a.hasActiveNotes !== b.hasActiveNotes) {
          return a.hasActiveNotes ? -1 : 1;
        }
        return a.project.address.localeCompare(b.project.address);
      });

    return onlyWithNotes ? out.filter((g) => g.hasActiveNotes) : out;
  }, [projectsQ.data, permitsQ.data, notesQ.data, onlyWithNotes]);

  const error = projectsQ.error ?? permitsQ.error ?? notesQ.error;
  if (error) {
    return (
      <QueryError
        title="Weekly Updates failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
          notesQ.refetch();
        }}
      />
    );
  }
  const isLoading =
    projectsQ.isLoading || permitsQ.isLoading || notesQ.isLoading;

  const withNotesCount = groups.filter((g) => g.hasActiveNotes).length;

  return (
    <div className="space-y-4" data-testid="weekly-updates-report">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display font-extrabold text-text">
            Weekly Updates
          </h1>
          <p className="text-[11px] text-muted">
            Every project&apos;s running notes — holistic project notes plus each
            permit&apos;s active notes, newest first. Edit, add, or complete a
            note here and it writes straight back to the project &amp; permit
            views.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyWithNotes}
            onChange={(e) => setOnlyWithNotes(e.target.checked)}
            data-testid="weekly-updates-only-with-notes"
          />
          Only projects with active notes
          {!isLoading && (
            <span className="text-dim">({withNotesCount})</span>
          )}
        </label>
      </div>

      {isLoading ? (
        <SkeletonRows count={5} rowClassName="h-20" />
      ) : groups.length === 0 ? (
        <div
          className="text-xs text-dim italic px-3 py-8 bg-s2 border border-border rounded text-center"
          data-testid="weekly-updates-empty"
        >
          {onlyWithNotes
            ? 'No projects have active notes right now.'
            : 'No active projects.'}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <ProjectGroupCard key={g.project.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectGroupCard({ group }: { group: ProjectGroup }) {
  const { project, holistic, permits } = group;
  return (
    <section
      className="bg-surface border border-border rounded-xl overflow-hidden"
      data-testid={`weekly-updates-project-${project.id}`}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <Link
          to={`/project/${project.id}`}
          className="text-sm font-display font-bold text-text hover:text-de transition truncate"
        >
          {project.address}
        </Link>
        {project.juris && (
          <span className="text-[10px] text-muted font-mono flex-shrink-0">
            {project.juris}
          </span>
        )}
      </header>

      <div className="p-3 space-y-3">
        {/* Holistic project scope */}
        <NotesScope
          projectId={project.id}
          permitId={null}
          label="Project (holistic)"
          notes={holistic}
          testid={`wu-scope-project-${project.id}`}
        />
        {/* Per-permit scopes, in permit_order */}
        {permits.map(({ permit, notes }) => (
          <NotesScope
            key={permit.id}
            projectId={project.id}
            permitId={permit.id}
            label={permitLabel(permit)}
            notes={notes}
            testid={`wu-scope-permit-${permit.id}`}
          />
        ))}
      </div>
    </section>
  );
}

function NotesScope({
  projectId,
  permitId,
  label,
  notes,
  testid,
}: {
  projectId: string;
  permitId: number | null;
  label: string;
  notes: Note[];
  testid: string;
}) {
  const addNote = useAddNote();
  const updateNote = useUpdateNote();
  const [showHistory, setShowHistory] = useState(false);

  const active = useMemo(() => notes.filter((n) => !n.completed), [notes]);
  const completed = useMemo(
    () =>
      [...notes.filter((n) => n.completed)].sort((a, b) =>
        (b.completed_at ?? b.created_at).localeCompare(
          a.completed_at ?? a.created_at,
        ),
      ),
    [notes],
  );

  return (
    <div
      className="border border-border rounded-lg p-2.5 space-y-2"
      style={{ background: 'var(--color-bg)' }}
      data-testid={testid}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-dim">
        {label}
      </div>

      <AddNoteBox
        testidPrefix={testid}
        isPending={addNote.isPending}
        onAdd={(body, done) =>
          addNote.mutate({ projectId, permitId, body }, { onSuccess: done })
        }
      />

      {active.length === 0 ? (
        <div
          className="text-[11px] text-dim italic"
          data-testid={`${testid}-empty`}
        >
          No active notes.
        </div>
      ) : (
        <ul className="flex flex-col gap-1" data-testid={`${testid}-active`}>
          {active.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              onCommitBody={(body) =>
                updateNote.mutate({ id: n.id, projectId, body })
              }
              onSetCompleted={(done) =>
                updateNote.mutate({ id: n.id, projectId, completed: done })
              }
            />
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] font-bold text-dim hover:text-text transition"
            data-testid={`${testid}-history-toggle`}
          >
            {showHistory ? '▾' : '▸'} Completed / history ({completed.length})
          </button>
          {showHistory && (
            <ul
              className="flex flex-col gap-1 mt-1 opacity-70"
              data-testid={`${testid}-history`}
            >
              {completed.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  onCommitBody={(body) =>
                    updateNote.mutate({ id: n.id, projectId, body })
                  }
                  onSetCompleted={(done) =>
                    updateNote.mutate({ id: n.id, projectId, completed: done })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
