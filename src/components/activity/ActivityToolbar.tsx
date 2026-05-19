import type { ActivityCategory } from '../../lib/scraperActivity';
import EntFilterDropdown from './EntFilterDropdown';

// fix-28: toolbar above the activity list. Search + category chips +
// ent multi-select + clear-filters affordance. The whole row sticks
// to the top of the viewport as the user scrolls (sticky positioning
// handled by ActivityPage).

const CATEGORY_FILTERS: Array<ActivityCategory | 'all'> = [
  'all',
  'change',
  'cycle',
  'skipped',
];

const CATEGORY_LABELS: Record<ActivityCategory | 'all', string> = {
  all: 'All',
  change: 'Changes',
  cycle: 'Cycles',
  skipped: 'Skipped',
  other: 'Other',
};

interface Props {
  search: string;
  onSearchChange: (next: string) => void;
  category: ActivityCategory | 'all';
  onCategoryChange: (next: ActivityCategory | 'all') => void;
  entOptions: string[];
  selectedEnts: Set<string>;
  onSelectedEntsChange: (next: Set<string>) => void;
  onClearFilters: () => void;
  totalCount: number;
  visibleCount: number;
}

export default function ActivityToolbar({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  entOptions,
  selectedEnts,
  onSelectedEntsChange,
  onClearFilters,
  totalCount,
  visibleCount,
}: Props) {
  const hasFilters =
    search.trim() !== '' ||
    category !== 'all' ||
    selectedEnts.size < entOptions.length;

  return (
    <div
      className="flex items-center gap-2 flex-wrap"
      data-testid="activity-toolbar"
    >
      {/* Search — mirrors the Reports search input styling */}
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search address, permit, juris, summary… (space = AND)"
        className="bg-bg border border-border rounded px-2 py-1 text-[11px] text-text placeholder:text-dim focus:outline-none focus:border-de min-w-[260px] flex-1"
        data-testid="activity-search"
      />

      {/* Category chips */}
      <div className="flex items-center gap-1" data-testid="activity-categories">
        {CATEGORY_FILTERS.map((f) => {
          const active = category === f;
          return (
            <button
              key={f}
              onClick={() => onCategoryChange(f)}
              className={`text-[10px] px-2 py-1 rounded-full border transition whitespace-nowrap ${
                active
                  ? 'bg-de text-white border-de'
                  : 'bg-transparent text-muted border-border hover:text-text'
              }`}
              data-testid={`activity-category-${f}`}
            >
              {CATEGORY_LABELS[f]}
            </button>
          );
        })}
      </div>

      {/* Ent dropdown */}
      <EntFilterDropdown
        options={entOptions}
        selected={selectedEnts}
        onChange={onSelectedEntsChange}
      />

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="text-[10px] px-2 py-1 rounded border border-border bg-surface text-muted hover:bg-bg transition font-display"
          data-testid="activity-clear"
        >
          Clear
        </button>
      )}

      <div className="text-[10px] text-dim ml-auto" data-testid="activity-counts">
        {visibleCount} of {totalCount}
      </div>
    </div>
  );
}
