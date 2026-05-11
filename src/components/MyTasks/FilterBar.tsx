import type { TaskFilters } from '../../lib/myTasksHelpers';

// Q7.1.c: filter bar for My Tasks. 4 controls matching v1's mt-stage,
// mt-status, mt-search inputs (index.html 4918-4922) + a single
// "Assigned to" dropdown per the Q7b decision (replaces v1's ENT/DA/DM
// multi-select; auto-populated from the data set's distinct values).
//
// State lives on the MyTasks page; this component is presentational.

interface Props {
  filters: TaskFilters;
  onChange: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  onClear: () => void;
  assigneeOptions: string[];
  resultCount: number;
}

export default function FilterBar({
  filters,
  onChange,
  onClear,
  assigneeOptions,
  resultCount,
}: Props) {
  return (
    <div
      className="bg-s2 border border-border rounded-lg p-3 flex flex-wrap items-end gap-3"
      data-testid="mytasks-filterbar"
    >
      <FieldLabel label="Stage">
        <select
          value={filters.stage}
          onChange={(e) =>
            onChange('stage', e.target.value as TaskFilters['stage'])
          }
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="mytasks-filter-stage"
        >
          <option value="all">All</option>
          <option value="de">D&amp;E</option>
          <option value="co">Corrections</option>
        </select>
      </FieldLabel>

      <FieldLabel label="Status">
        <select
          value={filters.status}
          onChange={(e) =>
            onChange('status', e.target.value as TaskFilters['status'])
          }
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de"
          data-testid="mytasks-filter-status"
        >
          <option value="active">Active</option>
          <option value="not-started">Not Started</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
          <option value="all">All</option>
        </select>
      </FieldLabel>

      <FieldLabel label="Assigned to">
        <select
          value={filters.assignee}
          onChange={(e) => onChange('assignee', e.target.value)}
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-de min-w-[120px]"
          data-testid="mytasks-filter-assignee"
        >
          <option value="">Any</option>
          {assigneeOptions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </FieldLabel>

      <FieldLabel label="Search">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          placeholder="Address, task, juris, type…"
          className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text placeholder:text-dim focus:outline-none focus:border-de min-w-[220px]"
          data-testid="mytasks-filter-search"
        />
      </FieldLabel>

      <button
        type="button"
        onClick={onClear}
        className="text-[11px] px-3 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
        data-testid="mytasks-filter-clear"
      >
        Clear
      </button>
      <span
        className="text-[11px] text-dim font-mono ml-auto"
        data-testid="mytasks-result-count"
      >
        {resultCount} task{resultCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] text-dim uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
