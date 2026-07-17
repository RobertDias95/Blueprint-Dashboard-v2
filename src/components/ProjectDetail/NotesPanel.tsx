import { useMemo, useState } from 'react';
import { useProjectNotes, useAddNote, useUpdateNote } from '../../hooks/useNotes';
import type { Note } from '../../lib/database.types';

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
}

export default function NotesPanel({ projectId, permitId = null }: Props) {
  const notesQ = useProjectNotes(projectId);
  const addNote = useAddNote();
  const updateNote = useUpdateNote();
  const [draft, setDraft] = useState('');
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

  function handleAdd() {
    const body = draft.trim();
    if (!body) return;
    addNote.mutate(
      { projectId, permitId, body },
      { onSuccess: () => setDraft('') },
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

      {/* Add box */}
      <div className="flex items-start gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits, Shift+Enter makes a newline (textarea default).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Add a note…"
          rows={2}
          className="flex-1 text-xs p-2 border rounded-md outline-none resize-y leading-relaxed"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)',
          }}
          data-testid="notes-panel-add"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={addNote.isPending || !draft.trim()}
          className="text-[11px] px-3 py-1.5 rounded-md font-bold border border-border bg-s2 text-text hover:bg-s3 transition disabled:opacity-50"
          data-testid="notes-panel-add-btn"
        >
          + Add
        </button>
      </div>

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
    </div>
  );
}

function NoteRow({
  note,
  onCommitBody,
  onSetCompleted,
}: {
  note: Note;
  onCommitBody: (body: string) => void;
  onSetCompleted: (done: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== note.body) onCommitBody(next);
    else setDraft(note.body);
  }

  const date = (note.completed ? note.completed_at ?? note.created_at : note.created_at).slice(0, 10);

  return (
    <li
      className="flex items-start gap-2 px-2 py-1.5 rounded border"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg)',
      }}
      data-testid={`note-row-${note.id}`}
    >
      {/* Complete / restore control */}
      <button
        type="button"
        onClick={() => onSetCompleted(!note.completed)}
        className="flex-shrink-0 mt-0.5 w-4 h-4 rounded border text-[10px] leading-none inline-flex items-center justify-center transition"
        style={{
          borderColor: note.completed ? 'var(--color-is)' : 'var(--color-border)',
          background: note.completed ? 'var(--color-is-bg)' : 'transparent',
          color: 'var(--color-is)',
        }}
        title={note.completed ? 'Restore to active' : 'Mark done'}
        data-testid={`note-complete-${note.id}`}
      >
        {note.completed ? '✓' : ''}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-dim font-mono">
          {note.completed ? `done ${date}` : date}
          {note.author_name && (
            <span data-testid={`note-author-${note.id}`}> · {note.author_name}</span>
          )}
        </div>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                setDraft(note.body);
                setEditing(false);
              }
            }}
            autoFocus
            rows={2}
            className="w-full text-xs p-1 mt-0.5 border rounded outline-none resize-y leading-relaxed"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-de)',
            }}
            data-testid={`note-edit-${note.id}`}
          />
        ) : (
          <div
            onClick={() => {
              setDraft(note.body);
              setEditing(true);
            }}
            className={`text-xs leading-relaxed whitespace-pre-wrap break-words cursor-text ${
              note.completed ? 'text-dim line-through' : 'text-text'
            }`}
            title="Click to edit"
            data-testid={`note-body-${note.id}`}
          >
            {note.body}
          </div>
        )}
      </div>
    </li>
  );
}
