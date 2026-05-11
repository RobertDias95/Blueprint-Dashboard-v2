import TaskTemplateEditor from './TaskTemplateEditor';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';

// Q7.3.c: Settings → Permits & Templates tab. Thin wrapper around
// TaskTemplateEditor — the heavy editor handles its own selectors, list
// rendering, and CRUD. Future additions (e.g., bulk-clone-juris, import
// from CSV) would land here without bloating the editor.

export default function AdminPermitsTab() {
  const isAdmin = useIsTenantAdmin();

  return (
    <div className="space-y-3" data-testid="admin-permits-tab">
      {!isAdmin && (
        <div className="bg-surface-2 border border-border rounded-lg px-4 py-2 text-xs text-muted">
          Read-only — you need tenant admin to edit task templates.
        </div>
      )}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h2 className="text-sm font-display font-bold text-text mb-1">
          Task Templates
        </h2>
        <p className="text-[11px] text-muted mb-4">
          Default tasks applied when a new permit is created. Pick a permit
          type + jurisdiction + stage to edit that scope. The "Base" jurisdiction
          applies to ALL juris where no specific override exists.
        </p>
        <TaskTemplateEditor readOnly={!isAdmin} />
      </div>
    </div>
  );
}
