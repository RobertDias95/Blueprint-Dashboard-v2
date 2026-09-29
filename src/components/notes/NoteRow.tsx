import type { Note } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-570 (P-275) — THE ROW IS READ-ONLY NOW
// ===========================================================================
//
// fix-notes-3 extracted this from `NotesPanel` so the Weekly Updates report and
// the panel rendered notes identically. The panel went in fix-559; fix-570 takes
// the report's write surface, which was this row's `onCommitBody` /
// `onSetCompleted` callbacks and the click-to-edit textarea behind them.
//
// ★★★ IT IS KEPT, NOT DELETED, BECAUSE THE READ PATH IS KEPT. The brief is
//     explicit: *"Delete the write path. Leave the report, its route, its nav
//     entry and its read path alone."* The report still calls `useAllNotes`, so
//     if a row ever exists it must render — and this is what renders it.
//
// ⚠️ TODAY IT NEVER RENDERS. `public.notes` holds 0 rows and has since fix-559
//    emptied it. That is not a reason to delete the renderer: a reader with no
//    rows is a reader, and the weekly DA concept is being revised later
//    (Bobby: *"we will revise the weekly da concept in the future"*).
//
// ★ WHAT WENT, PRECISELY: the `editing`/`draft` state, the `commit()` that
//   called `onCommitBody`, the textarea, the complete/restore BUTTON, and the
//   "Click to edit" affordance. The completion MARKER stays — whether a note is
//   done is information, and this row still shows information.

export default function NoteRow({ note }: { note: Note }) {
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
      {/* ★ A MARKER, NOT A BUTTON. It used to toggle `completed`; it now only
          says whether the note was done. Same box, same place, no click. */}
      <span
        className="flex-shrink-0 mt-0.5 w-4 h-4 rounded border text-[10px] leading-none inline-flex items-center justify-center"
        style={{
          borderColor: note.completed ? 'var(--color-is)' : 'var(--color-border)',
          background: note.completed ? 'var(--color-is-bg)' : 'transparent',
          color: 'var(--color-is)',
        }}
        title={note.completed ? 'Done' : 'Active'}
        aria-label={note.completed ? 'Done' : 'Active'}
        data-testid={`note-complete-${note.id}`}
      >
        {note.completed ? '✓' : ''}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-dim font-mono">
          {note.completed ? `done ${date}` : date}
          {note.author_name && (
            <span data-testid={`note-author-${note.id}`}> · {note.author_name}</span>
          )}
        </div>
        <div
          className={`text-xs leading-relaxed whitespace-pre-wrap break-words ${
            note.completed ? 'text-dim line-through' : 'text-text'
          }`}
          data-testid={`note-body-${note.id}`}
        >
          {note.body}
        </div>
      </div>
    </li>
  );
}
