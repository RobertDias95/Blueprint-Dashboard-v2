import { useState } from 'react';

// fix-notes-3: shared "add a note" box extracted from NotesPanel (fix-notes-1).
// Enter commits (Shift+Enter = newline); the parent owns the write via onAdd
// and clears the box on success. testidPrefix lets each mount (NotesPanel, and
// each project/permit scope in the Weekly Updates report) expose stable ids.

export default function AddNoteBox({
  onAdd,
  isPending = false,
  placeholder = 'Add a note…',
  testidPrefix,
}: {
  onAdd: (body: string, done: () => void) => void;
  isPending?: boolean;
  placeholder?: string;
  testidPrefix: string;
}) {
  const [draft, setDraft] = useState('');

  function handleAdd() {
    const body = draft.trim();
    if (!body) return;
    onAdd(body, () => setDraft(''));
  }

  return (
    <div className="flex items-start gap-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder={placeholder}
        rows={2}
        className="flex-1 text-xs p-2 border rounded-md outline-none resize-y leading-relaxed"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
        }}
        data-testid={`${testidPrefix}-add`}
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={isPending || !draft.trim()}
        className="text-[11px] px-3 py-1.5 rounded-md font-bold border border-border bg-s2 text-text hover:bg-s3 transition disabled:opacity-50"
        data-testid={`${testidPrefix}-add-btn`}
      >
        + Add
      </button>
    </div>
  );
}
