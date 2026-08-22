import { useMemo, useState } from 'react';

// ★★ fix-384 — "which project is this block about?"
//
// ★ WHY NOT ReuseSourcePicker. It is the closest existing typeahead and it was
// the obvious reuse, but it answers a DIFFERENT question — "which proven plan
// should this new project be templated off" — and it is built for that:
// `buildReuseSources` drops archived projects (reuseSourceHelpers.ts:44),
// which is exactly wrong here. The block that started this ticket names a
// CANCELLED project, and the day somebody archives a project, a picker that
// hides archived rows makes its linked blocks impossible to re-point. Two
// questions, two candidate sets. (fix-364's rule cuts this way too: one
// concept, one term — "reuse source" is not "the project this block is about".)
//
// ★ It searches address + juris + the permits' struct_address, so fix-380's
// rule holds here too: a project Bobby knows by its structure address is
// findable by that address.
//
// ★★ IT FETCHES NOTHING. The options are built by the Draw Schedule grid and
// handed in, for two reasons. NpBlockEditPopup was a pure presentational
// popover, and giving it a data dependency broke every existing test that
// rendered it without a QueryClientProvider — the tests were right and the
// design was wrong. And the grid already owns `projectSearchHay`, so passing
// its haystack in means the picker and the schedule's own search box agree on
// how a project is findable BY CONSTRUCTION, rather than by two definitions
// that drift.

const MAX_RESULTS = 8;

export interface ProjectLinkOption {
  id: string;
  address: string;
  juris: string | null;
  hay: string;
}

export default function ProjectLinkPicker({
  options,
  value,
  onChange,
}: {
  /** Every project that can be linked, built by the caller. */
  options: ProjectLinkOption[];
  /** The currently linked project id, or null. */
  value: string | null;
  /** Called with a project id to link, or null to CLEAR the link. */
  onChange: (projectId: string | null) => void;
}) {
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => (value ? (options.find((o) => o.id === value) ?? null) : null),
    [options, value],
  );

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return options
      .filter((o) => tokens.every((t) => o.hay.includes(t)))
      .slice(0, MAX_RESULTS);
  }, [options, query]);

  // Linked: show what it is linked to, and the way to undo that. ★ The picker
  // has to be able to CLEAR a link, not only set one — a block mis-linked once
  // would otherwise be stuck.
  if (selected || value) {
    return (
      <div
        className="flex items-center gap-1 min-w-0"
        data-testid="project-link-picker"
      >
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border truncate flex-1 min-w-0"
          style={{
            background: 'var(--color-s2)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
          title={selected?.address ?? value ?? ''}
          data-testid="project-link-current"
        >
          🔗 {selected?.address ?? 'Linked project'}
        </span>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            onChange(null);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-dim, var(--color-text))',
          }}
          title="Unlink this project"
          data-testid="project-link-clear"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0" data-testid="project-link-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // ★ Escape must not close the popup from in here — the person is
        // clearing a search, not abandoning the edit.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query !== '') {
            e.preventDefault();
            e.stopPropagation();
            setQuery('');
          }
        }}
        placeholder="Link a project (optional)…"
        className="w-full px-1.5 py-0.5 text-[11px] border rounded outline-none"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-testid="project-link-search"
      />
      {query.trim() !== '' && (
        <div
          className="mt-1 rounded border divide-y max-h-40 overflow-y-auto"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="project-link-results"
        >
          {results.length === 0 ? (
            <div
              className="px-1.5 py-1 text-[10px] text-dim"
              data-testid="project-link-empty"
            >
              No matching projects.
            </div>
          ) : (
            results.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setQuery('');
                  onChange(o.id);
                }}
                className="w-full text-left px-1.5 py-1 text-[11px] hover:bg-bg/40"
                data-testid={`project-link-option-${o.id}`}
              >
                <div className="truncate text-text">{o.address}</div>
                {o.juris && (
                  <div className="truncate text-[9px] text-dim">{o.juris}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
