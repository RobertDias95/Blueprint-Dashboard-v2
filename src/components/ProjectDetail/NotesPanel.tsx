import { useMemo, useState } from 'react';
import { useProjectNotes, useAddNote, useUpdateNote } from '../../hooks/useNotes';
import NoteRow from '../notes/NoteRow';
import AddNoteBox from '../notes/AddNoteBox';
import { OverviewCard, OverviewSection } from './OverviewCard';

// fix-notes-1: unified Notes log — ONE reusable panel for both scopes:
//   * Project Overview  -> <NotesPanel projectId={...} />            (holistic)
//   * Permit detail     -> <NotesPanel projectId={...} permitId={...} />
// Active notes (completed=false) list newest-first with date + author; adding,
// in-place editing, and a "mark done" control that moves a note into the
// collapsed Completed / history section. Data comes from the project-wide
// notes query (bp_list_project_notes); the panel filters to its scope so both
// mounted panels + the future dashboard card share one cache entry.

interface Props {
  projectId: string;
  /** A permit id scopes the panel to that permit's log; omit/null = the
   *  holistic project log (notes.permit_id IS NULL). */
  permitId?: number | null;
  /** fix-290: how the panel frames itself.
   *
   *  'card'   — a full OverviewCard with the shared banner, for the Project
   *             Overview grid, where it sits beside DD Phase and Project and
   *             has to look like them.
   *  'inline' — the original border-top block with a small heading, for the
   *             permit detail, where it is a section of a larger panel and a
   *             banner would claim a prominence it does not have there.
   *
   *  ★ Defaults to 'inline' so the permit-detail mount is unchanged by this
   *  ticket. The overview opts in. */
  variant?: 'card' | 'inline';
}

export default function NotesPanel({
  projectId,
  permitId = null,
  variant = 'inline',
}: Props) {
  const notesQ = useProjectNotes(projectId);
  const addNote = useAddNote();
  const updateNote = useUpdateNote();
  const [showHistory, setShowHistory] = useState(false);

  const scoped = useMemo(
    () =>
      (notesQ.data ?? []).filter((n) =>
        permitId == null
          ? n.permit_id == null
          : String(n.permit_id) === String(permitId),
      ),
    [notesQ.data, permitId],
  );
  // bp_list_project_notes orders created_at DESC already; keep the split
  // stable against that order. Completed history sorts by completion, newest
  // first, so "what just got done" leads.
  const active = useMemo(() => scoped.filter((n) => !n.completed), [scoped]);
  const completed = useMemo(
    () =>
      [...scoped.filter((n) => n.completed)].sort((a, b) =>
        (b.completed_at ?? b.created_at).localeCompare(
          a.completed_at ?? a.created_at,
        ),
      ),
    [scoped],
  );

  const body = (
    <>
      <AddNoteBox
        testidPrefix="notes-panel"
        isPending={addNote.isPending}
        onAdd={(body, done) =>
          addNote.mutate({ projectId, permitId, body }, { onSuccess: done })
        }
      />

      {/* Active list */}
      {notesQ.isLoading ? (
        <div className="text-[11px] text-dim italic py-2">Loading…</div>
      ) : active.length === 0 ? (
        <div className="text-[11px] text-dim italic py-1" data-testid="notes-panel-empty">
          No active notes.
        </div>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="notes-panel-active">
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

      {/* Completed / history (collapsed by default) */}
      {completed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] font-bold text-dim hover:text-text transition"
            data-testid="notes-panel-history-toggle"
          >
            {showHistory ? '▾' : '▸'} Completed / history ({completed.length})
          </button>
          {showHistory && (
            <ul
              className="flex flex-col gap-1 mt-1 opacity-70"
              data-testid="notes-panel-history"
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
    </>
  );

  // fix-290: same body, two frames. The panel decides nothing about its own
  // contents from `variant` — only what wraps them — so the two mounts can
  // never drift in behaviour, only in chrome.
  if (variant === 'card') {
    return (
      <OverviewCard title="Notes" testId="notes-panel">
        <OverviewSection>
          <div className="flex flex-col gap-2">{body}</div>
        </OverviewSection>
      </OverviewCard>
    );
  }
  return (
    <div
      className="border-t p-3 flex flex-col gap-2"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid="notes-panel"
    >
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider">
        Notes
      </div>
      {body}
    </div>
  );
}
