import { useState } from 'react';
import type { Note } from '../../lib/database.types';

// fix-notes-3: shared note row extracted from NotesPanel (fix-notes-1) so the
// Weekly Updates report and the NotesPanel render notes identically. Purely
// presentational: date + author, click-to-edit body (Enter/blur commits, Esc
// cancels), and a complete/restore toggle. Callbacks own the write (both
// surfaces route them through the fix-notes-1 useUpdateNote hook).

export default function NoteRow({
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

  const date = (
    note.completed ? note.completed_at ?? note.created_at : note.created_at
  ).slice(0, 10);

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
