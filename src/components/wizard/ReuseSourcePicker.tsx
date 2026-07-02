import { useMemo, useState } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { usePermits } from '../../hooks/usePermits';
import {
  filterReuseSources,
  reuseContextLine,
  reuseSourcesFromCaches,
  type ReuseSource,
} from './reuseSourceHelpers';

export type { ReuseSource } from './reuseSourceHelpers';

// fix-216: REUSE source picker. A typeahead over existing projects so a new
// project can be templated off a proven plan. Search matches address / DA /
// juris / zone / product types; each result shows Library-style context
// (address · juris · zone · lot · product types) so the user picks the right
// plan. Selecting one copies its product_types + unit_types into the wizard
// form (copy-once — the parent owns the values afterward) and records the
// reuse link. Reads entirely from the already-loaded projects + permits caches.
// The pure list-building + filtering helpers live in ./reuseSourceHelpers.

const MAX_RESULTS = 8;

export default function ReuseSourcePicker({
  excludeProjectId,
  onSelect,
}: {
  /** Hide this project from the results (e.g. the project being edited). */
  excludeProjectId?: string;
  onSelect: (source: ReuseSource) => void;
}) {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const [query, setQuery] = useState('');

  const sources = useMemo(
    () =>
      reuseSourcesFromCaches(
        projectsQ.data ?? [],
        permitsQ.data ?? [],
      ).filter((s) => s.id !== excludeProjectId),
    [projectsQ.data, permitsQ.data, excludeProjectId],
  );

  const results = useMemo(
    () => filterReuseSources(sources, query).slice(0, MAX_RESULTS),
    [sources, query],
  );

  return (
    <div className="space-y-1.5" data-testid="reuse-source-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a plan by address, DA, juris…"
        className="w-full text-[12px] px-2 py-1.5 border rounded outline-none"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
        }}
        data-testid="reuse-source-search"
      />
      {query.trim() !== '' && (
        <div
          className="rounded-md border divide-y max-h-56 overflow-y-auto"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="reuse-source-results"
        >
          {results.length === 0 ? (
            <div
              className="px-2 py-2 text-[11px] text-dim"
              data-testid="reuse-source-empty"
            >
              No matching plans.
            </div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className="w-full text-left px-2 py-1.5 hover:bg-s2/60 transition block"
                data-testid={`reuse-source-option-${s.id}`}
              >
                <span className="text-[12px] font-semibold text-text block truncate">
                  {s.address}
                </span>
                <span className="text-[10px] text-dim block truncate">
                  {reuseContextLine(s) || '—'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
