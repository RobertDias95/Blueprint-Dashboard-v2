import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteProject } from '../../hooks/useDeleteProject';
import type { Project } from '../../lib/database.types';

// Q9.5.f-fix-16 E: confirmation dialog for destructive project delete.
// Requires the user to type the project address verbatim — same
// guardrail v1 uses for delete actions (index.html:1132 confirm shape).
// On success, navigates to /dashboard.

interface Props {
  project: Project;
  permitCount: number;
  onClose: () => void;
}

export default function DeleteProjectDialog({ project, permitCount, onClose }: Props) {
  const [confirmText, setConfirmText] = useState('');
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const matches = confirmText.trim().toLowerCase() === project.address.trim().toLowerCase();

  async function handleDelete() {
    if (!matches || !project.updated_at) return;
    try {
      await deleteProject.mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
      });
      onClose();
      navigate('/dashboard');
    } catch {
      // useDeleteProject onError already toasted.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      data-testid="delete-project-dialog"
    >
      <div
        className="rounded-lg shadow-xl w-[460px] overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between"
          style={{
            background: 'var(--color-de-bg)',
            borderBottomColor: 'var(--color-de-border)',
          }}
        >
          <span
            className="text-[12px] font-extrabold uppercase tracking-wider"
            style={{ color: 'var(--color-de)' }}
          >
            Delete Project
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="px-4 py-3 flex flex-col gap-3 text-[12px] text-text">
          <p>
            Deleting <span className="font-bold">{project.address}</span>
            {' '}removes all {permitCount} permit{permitCount === 1 ? '' : 's'}, their cycles,
            tasks, draw-schedule entries, and project documents.
            Intake records survive but lose their project link.
          </p>
          <p style={{ color: 'var(--color-de)' }} className="font-bold">
            This cannot be undone.
          </p>
          <label className="flex flex-col gap-1">
            <span
              className="text-[9px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--color-dim)' }}
            >
              Type the project address to confirm
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={project.address}
              className="w-full px-2 py-1 text-[12px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="dpd-confirm-input"
              autoFocus
            />
          </label>
        </div>

        <footer
          className="px-4 py-2 border-t flex items-center justify-end gap-2"
          style={{
            background: 'var(--color-s2)',
            borderTopColor: 'var(--color-border)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!matches || deleteProject.isPending}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-40"
            style={{
              borderColor: 'var(--color-de)',
              background: 'var(--color-de)',
              color: 'white',
            }}
            data-testid="dpd-delete-btn"
          >
            {deleteProject.isPending ? 'Deleting…' : 'Delete Project'}
          </button>
        </footer>
      </div>
    </div>
  );
}
