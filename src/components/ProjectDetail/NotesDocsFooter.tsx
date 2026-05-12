import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { pushToast } from '../../stores/toastStore';
import type { Project } from '../../lib/database.types';

// Q9.5.e: project Notes (left 1fr) + Documents stub (right 2fr) per
// v1 §4.2.1 (C). Notes is editable; writes go through a direct
// projects-table update via the anon key (RLS gates by tenant).
//
// Documents column ships as a stub — project_documents table exists
// (saw it during Q5.5 schema work) but no v2 hook surfaces it yet.
// Backlog tracker covers the add/list/remove flow.

interface Props {
  project: Project;
}

export default function NotesDocsFooter({ project }: Props) {
  return (
    <div
      className="flex-shrink-0 border-t bg-surface grid"
      style={{
        gridTemplateColumns: '1fr 2fr',
        borderTopColor: 'var(--color-border)',
      }}
      data-testid="notes-docs-footer"
    >
      <NotesCell project={project} />
      <DocumentsCell />
    </div>
  );
}

function NotesCell({ project }: { project: Project }) {
  const [value, setValue] = useState(project.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function commit() {
    const trimmed = value;
    if (trimmed === (project.notes ?? '')) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ notes: trimmed || null })
        .eq('id', project.id);
      if (error) throw error;
      pushToast('Saved project notes', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast(`Could not save notes — ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="p-3 border-r flex flex-col gap-1.5"
      style={{ borderRightColor: 'var(--color-border)' }}
    >
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider text-center">
        Notes {saving && <span className="ml-1 text-dim normal-case">saving…</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="Add project notes..."
        className="w-full text-xs p-2 border rounded-md outline-none resize-y leading-relaxed"
        style={{
          minHeight: 100,
          maxHeight: 240,
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
        }}
        data-testid="pd-notes-textarea"
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-de)';
        }}
      />
    </div>
  );
}

function DocumentsCell() {
  return (
    <div className="p-3 flex flex-col gap-1.5">
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider text-center">
        Documents &amp; Links
      </div>
      <div className="text-[11px] text-dim italic text-center py-6">
        Project documents wiring — backlog #67 (project_documents hook +
        add form). Paste any link — Google Drive, Dropbox, drone footage,
        permit portals — once the editor lands.
      </div>
    </div>
  );
}
