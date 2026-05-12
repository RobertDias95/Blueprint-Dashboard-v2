import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { pushToast } from '../../stores/toastStore';
import {
  useProjectDocuments,
  useUpsertProjectDocument,
  useDeleteProjectDocument,
} from '../../hooks/useProjectDocuments';
import type { Project, ProjectDocument } from '../../lib/database.types';

// Q9.5.e: project Notes (left 1fr) + Documents (right 2fr) per v1 §4.2.1 (C).
// Notes is editable; writes go through a direct projects-table update.
// Q9.5.e-fix-3: Documents column is now a real list + add form, wired to
// the project_documents table via the new OCC RPCs.

interface Props {
  project: Project;
}

export default function NotesDocsFooter({ project }: Props) {
  return (
    <div
      className="h-full border-t bg-surface grid overflow-hidden"
      style={{
        gridTemplateColumns: '1fr 2fr',
        borderTopColor: 'var(--color-border)',
      }}
      data-testid="notes-docs-footer"
    >
      <NotesCell project={project} />
      <DocumentsCell projectId={project.id} />
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
      className="p-3 border-r flex flex-col gap-1.5 min-h-0 overflow-hidden"
      style={{ borderRightColor: 'var(--color-border)' }}
    >
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider text-center flex-shrink-0">
        Notes {saving && <span className="ml-1 text-dim normal-case">saving…</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="Add project notes..."
        className="w-full flex-1 min-h-0 text-xs p-2 border rounded-md outline-none resize-none leading-relaxed"
        style={{
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

function DocumentsCell({ projectId }: { projectId: string }) {
  const docsQ = useProjectDocuments(projectId);
  const upsert = useUpsertProjectDocument();
  const remove = useDeleteProjectDocument();
  const [labelDraft, setLabelDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState('');

  async function handleAdd() {
    const name = labelDraft.trim();
    if (!name) {
      pushToast('Label is required', 'warn');
      return;
    }
    await upsert.mutateAsync({
      projectId,
      patch: { name, url: urlDraft.trim() || null },
    });
    setLabelDraft('');
    setUrlDraft('');
  }

  async function handleDelete(doc: ProjectDocument) {
    if (!window.confirm(`Delete document "${doc.name}"?`)) return;
    await remove.mutateAsync({ projectId, doc });
  }

  const docs = docsQ.data ?? [];

  return (
    <div
      className="p-3 flex flex-col gap-1.5 min-h-0 overflow-hidden"
      data-testid="pd-documents-cell"
    >
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider text-center flex-shrink-0">
        Documents &amp; Links
      </div>
      {docsQ.isLoading ? (
        <div className="text-[11px] text-dim italic text-center py-3 flex-1">
          Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-[11px] text-dim italic text-center py-3 flex-1">
          No documents yet. Add a link below.
        </div>
      ) : (
        <ul className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 px-2 py-1 rounded border"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
              }}
              data-testid={`pd-doc-${doc.id}`}
            >
              <span className="text-[11px] font-bold text-text flex-shrink-0">
                {doc.name}
              </span>
              {doc.url ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-de underline truncate flex-1 min-w-0"
                  title={doc.url}
                >
                  {doc.url}
                </a>
              ) : (
                <span className="text-[10px] text-dim italic flex-1">
                  (no URL)
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleDelete(doc)}
                disabled={remove.isPending}
                className="text-[10px] text-co hover:text-co/70 px-1 disabled:opacity-50"
                title="Delete document"
                data-testid={`pd-doc-${doc.id}-delete`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="flex items-center gap-1.5 mt-1 pt-2 border-t flex-shrink-0"
        style={{ borderTopColor: 'var(--color-border)' }}
      >
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          placeholder="Label"
          className="text-[11px] px-2 py-1 border rounded outline-none flex-shrink-0"
          style={{
            width: 100,
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
          }}
          data-testid="pd-doc-add-label"
        />
        <input
          type="url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="https://… (Drive, Dropbox, portal, etc.)"
          className="text-[11px] px-2 py-1 border rounded outline-none flex-1"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
          }}
          data-testid="pd-doc-add-url"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={upsert.isPending || !labelDraft.trim()}
          className="text-[11px] px-3 py-1 rounded-md font-bold border border-border bg-s2 text-text hover:bg-s3 transition disabled:opacity-50"
          data-testid="pd-doc-add-btn"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
