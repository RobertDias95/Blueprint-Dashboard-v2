import { useDeleteProject } from '../../hooks/useDeleteProject';
import type { Project } from '../../lib/database.types';

// fix-193: confirm + delete a redesign from the parent's Redesigns section.
// A redesign is a separate projects row (redesign_of_project_id set) that OWNS
// its own permit(s) — including the PPR placeholder for a reuses-permit
// redesign — plus their cycles/tasks/reviewers and the redesign's draw_schedule
// lane. Deleting the redesign project cascades through ALL of those via the
// server FKs (ON DELETE CASCADE on permits.project_id / draw_schedule.project_id
// → permit_cycles / permit_tasks / permit_cycle_reviewers). It does NOT touch
// the parent project or the parent's (reused) permits: those live on a different
// projects row, and projects.redesign_of_project_id is NO ACTION, so deleting
// the child never reaches the parent. (Confirmed via a rolled-back prod probe.)
//
// Reuses the existing bp_delete_project_row RPC (via useDeleteProject) — the
// same cascade a normal project delete uses. Unlike DeleteProjectDialog this
// does NOT navigate away: the redesign is deleted in place and the parent's
// Redesigns list refreshes from the projects-cache drop in useDeleteProject.

interface Props {
  redesign: Project;
  /** "Redesign N" label for the heading, matching the sidebar numbering. */
  label: string;
  onClose: () => void;
}

export default function DeleteRedesignDialog({ redesign, label, onClose }: Props) {
  const deleteProject = useDeleteProject();

  async function handleDelete() {
    if (!redesign.updated_at) return;
    try {
      await deleteProject.mutateAsync({
        projectId: redesign.id,
        expectedUpdatedAt: redesign.updated_at,
      });
      onClose();
    } catch {
      // useDeleteProject.onError already toasted.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      data-testid="delete-redesign-dialog"
    >
      <div
        className="rounded-lg shadow-xl w-[440px] overflow-hidden flex flex-col"
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
            Delete {label}
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
            Deleting <span className="font-bold">{redesign.address}</span> removes
            this redesign and its own permit(s), cycles, tasks, reviewers, and
            draw-schedule lane.
          </p>
          <p className="text-dim">
            The original project and its permits are <span className="font-bold">not</span>{' '}
            affected.
          </p>
          <p style={{ color: 'var(--color-de)' }} className="font-bold">
            This cannot be undone.
          </p>
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
            disabled={deleteProject.isPending || !redesign.updated_at}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-40"
            style={{
              borderColor: 'var(--color-de)',
              background: 'var(--color-de)',
              color: 'white',
            }}
            data-testid="delete-redesign-confirm-btn"
          >
            {deleteProject.isPending ? 'Deleting…' : 'Delete Redesign'}
          </button>
        </footer>
      </div>
    </div>
  );
}
