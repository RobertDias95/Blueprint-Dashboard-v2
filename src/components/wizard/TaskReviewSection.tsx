import { useMemo } from 'react';
import type { TaskTemplate } from '../../lib/database.types';

// fix-22 Step 4 sub-component — one permit's task list. Renders the
// task_templates that match (permit_type = perm.type AND (jurisdiction
// = juris OR jurisdiction IS NULL)). Each task is a checkbox; default-
// checked. Submission collects checked template `id`s into the permit's
// `taskTemplateIds` array.

interface Props {
  permitRowId: string;
  permitType: string;
  templates: TaskTemplate[];
  /** Currently-checked template UUIDs. */
  checkedIds: string[];
  onToggle: (templateId: string, next: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export default function TaskReviewSection({
  permitRowId,
  permitType,
  templates,
  checkedIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: Props) {
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds]);

  return (
    <div
      className="border border-border rounded-md bg-bg/40 p-3"
      data-testid={`wizard-task-section-${permitRowId}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-display font-bold text-text">
          {permitType}
          <span className="text-dim font-normal ml-2">
            ({checkedSet.size}/{templates.length} selected)
          </span>
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-[11px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition"
            data-testid={`wizard-task-select-all-${permitRowId}`}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="text-[11px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition"
            data-testid={`wizard-task-clear-all-${permitRowId}`}
          >
            Clear all
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="text-[11px] text-dim italic">
          No task templates for {permitType} in this jurisdiction yet.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {templates.map((t) => {
            const checked = checkedSet.has(t.id);
            return (
              <label
                key={t.id}
                className="flex items-center gap-2 px-2 py-1 rounded-md text-xs hover:bg-bg/60"
                data-testid={`wizard-task-row-${permitRowId}-${t.id}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(t.id, e.target.checked)}
                  data-testid={`wizard-task-checkbox-${permitRowId}-${t.id}`}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1 font-mono text-text">{t.text}</span>
                {t.cat && (
                  <span className="text-[9px] uppercase tracking-wide text-muted border border-border rounded px-1.5 py-0.5">
                    {t.cat}
                  </span>
                )}
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  {t.bucket}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
