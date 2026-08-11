import { useMemo, useState } from 'react';
import { useCorrectionItems } from '../../hooks/useCorrectionItems';
import {
  groupCorrections,
  summarizeCorrections,
  type CorrectionBuildingGroup,
} from '../../lib/correctionItems';
import type { CorrectionItem } from '../../lib/database.types';
import InlineErrorBoundary from '../InlineErrorBoundary';

// fix-276: READ-ONLY Corrections section on Project Overview.
//
// Shows what the city actually asked for, comment by comment, from the
// correction letters the file_indexer pulls off the on-prem Building Permits
// share. Nothing here writes — `authenticated` holds SELECT on
// public.correction_items and nothing else.
//
// Grouping is building → cycle → discipline. The building level renders only
// when at least one row names one: Seattle issues one letter per discipline for
// the whole project (building NULL — 1,881 of 2,194 production rows), while the
// east-side jurisdictions issue per structure ('SFR 1', 'DUPLEX 2'). Forcing a
// "Whole project" wrapper onto every Seattle project would be a level of
// nesting that carries no information.
//
// Most projects have nothing indexed — 93 of ~134 as of the first indexer run —
// so the empty state is the common path, not an error.

interface Props {
  projectId: string;
}

export default function CorrectionsPanel({ projectId }: Props) {
  return (
    <InlineErrorBoundary label="corrections" testId="corrections-panel-error">
      <CorrectionsPanelBody projectId={projectId} />
    </InlineErrorBoundary>
  );
}

function CorrectionsPanelBody({ projectId }: Props) {
  const itemsQ = useCorrectionItems(projectId);
  const rows = useMemo<CorrectionItem[]>(() => itemsQ.data ?? [], [itemsQ.data]);
  const summary = useMemo(() => summarizeCorrections(rows), [rows]);
  const groups = useMemo(() => groupCorrections(rows), [rows]);

  return (
    <div
      className="border-t p-3 flex flex-col gap-2"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid="corrections-panel"
    >
      <div className="text-[9px] font-extrabold text-text uppercase tracking-wider">
        Corrections
      </div>

      {itemsQ.isLoading ? (
        <div className="text-[11px] text-dim italic py-2">Loading…</div>
      ) : itemsQ.error ? (
        // Not a QueryError page: a corrections failure must not take the whole
        // project overview with it. The rest of the pane stays usable.
        <div
          className="text-[11px] text-dim italic py-2"
          data-testid="corrections-panel-load-error"
        >
          Corrections could not be loaded.{' '}
          <button
            type="button"
            onClick={() => void itemsQ.refetch()}
            className="underline text-de not-italic font-bold"
            data-testid="corrections-panel-retry"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="text-[11px] text-dim italic py-1"
          data-testid="corrections-panel-empty"
        >
          No indexed corrections for this project.
        </div>
      ) : (
        <>
          <SummaryLine summary={summary} />
          <div className="flex flex-col gap-2" data-testid="corrections-groups">
            {groups.map((g) => (
              <BuildingGroup
                // The no-building group's key is '' — give React something
                // non-empty rather than relying on empty-string key behaviour.
                key={g.key || '__whole_project'}
                group={g}
                showBuildingLevel={summary.showBuildingLevel}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryLine({
  summary,
}: {
  summary: ReturnType<typeof summarizeCorrections>;
}) {
  const cycleText =
    summary.cycles.length === 0
      ? '—'
      : summary.cycles.map((c) => String(c)).join(', ');
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-muted"
      data-testid="corrections-summary"
    >
      <span data-testid="corrections-summary-total">
        <strong className="text-text text-[13px]">{summary.total}</strong>{' '}
        {summary.total === 1 ? 'item' : 'items'}
      </span>
      <span data-testid="corrections-summary-cycles">
        <strong className="text-text text-[13px]">
          {summary.cycles.length}
        </strong>{' '}
        {summary.cycles.length === 1 ? 'cycle' : 'cycles'}
        <span className="text-dim"> ({cycleText})</span>
        {summary.hasUnknownCycle && (
          <span className="text-dim" data-testid="corrections-summary-unknown-cycle">
            {' '}
            + unknown
          </span>
        )}
      </span>
      <span
        data-testid="corrections-summary-repeats"
        title="A topic is building + discipline + category. A repeat is one the city raised in more than one cycle."
      >
        <strong className="text-text text-[13px]">{summary.repeatTopics}</strong>{' '}
        {summary.repeatTopics === 1 ? 'repeat topic' : 'repeat topics'}
      </span>
    </div>
  );
}

function BuildingGroup({
  group,
  showBuildingLevel,
}: {
  group: CorrectionBuildingGroup;
  showBuildingLevel: boolean;
}) {
  return (
    <div data-testid={`corrections-building-${group.key || 'none'}`}>
      {showBuildingLevel && (
        <div
          className="px-2 py-1 rounded-t-md text-[10px] font-extrabold uppercase tracking-wider flex items-baseline gap-2"
          style={{
            background: 'var(--color-s2)',
            color: 'var(--color-text)',
          }}
          data-testid={`corrections-building-label-${group.key || 'none'}`}
        >
          <span>{group.label}</span>
          <span className="text-dim font-normal normal-case tracking-normal">
            {group.count} {group.count === 1 ? 'item' : 'items'}
          </span>
        </div>
      )}
      <div
        className="border rounded-md"
        style={{
          borderColor: 'var(--color-border)',
          borderTopLeftRadius: showBuildingLevel ? 0 : undefined,
          borderTopRightRadius: showBuildingLevel ? 0 : undefined,
        }}
      >
        {group.cycles.map((c) => (
          <div key={c.key} data-testid={`corrections-cycle-${group.key || 'none'}-${c.key || 'unknown'}`}>
            <div
              className="px-2 py-1 border-b flex items-baseline gap-2"
              style={{ borderBottomColor: 'var(--color-border)' }}
            >
              <span
                className="text-[11px] font-extrabold"
                style={{ color: 'var(--color-co)' }}
              >
                {c.label}
              </span>
              <span className="text-[10px] text-dim">
                {c.count} {c.count === 1 ? 'item' : 'items'}
              </span>
            </div>
            {c.disciplines.map((d) => (
              <div key={d.key}>
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-extrabold text-muted uppercase tracking-wider">
                  {d.label}
                  <span className="text-dim font-normal normal-case tracking-normal">
                    {' '}
                    ({d.items.length})
                  </span>
                </div>
                {d.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: CorrectionItem }) {
  const [open, setOpen] = useState(false);
  const hasBody = (item.body ?? '').trim() !== '';
  const meta = [item.reviewer, item.letter_date].filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );

  return (
    <div
      className="border-t"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid={`corrections-item-${item.id}`}
    >
      {/* A <button> only when there is something to expand — an inert button
          would still take focus and announce as interactive. */}
      {hasBody ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-s2 transition"
          data-testid={`corrections-item-toggle-${item.id}`}
        >
          <span className="text-dim text-[10px] leading-5 w-2 flex-shrink-0" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <ItemHead item={item} meta={meta} />
        </button>
      ) : (
        <div className="px-2 py-1.5 flex items-start gap-2">
          <span className="w-2 flex-shrink-0" aria-hidden="true" />
          <ItemHead item={item} meta={meta} />
        </div>
      )}
      {hasBody && open && (
        <div
          className="px-2 pb-2 pl-6 text-[11px] text-muted leading-relaxed whitespace-pre-wrap"
          data-testid={`corrections-item-body-${item.id}`}
        >
          {item.body}
          {item.codes && (
            <div className="mt-1 text-[10px] text-dim font-mono">
              {item.codes}
            </div>
          )}
          <div className="mt-1 text-[10px] text-dim italic">
            {item.source_file}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemHead({ item, meta }: { item: CorrectionItem; meta: string[] }) {
  return (
    <>
      <span className="flex-1 min-w-0 text-[11px] text-text leading-5">
        {(item.subject ?? '').trim() || (
          <span className="text-dim italic">(no subject)</span>
        )}
      </span>
      {item.category && (
        <span
          className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap"
          style={{
            background: 'var(--color-de-bg)',
            color: 'var(--color-de)',
            borderColor: 'var(--color-de-border)',
          }}
          data-testid={`corrections-item-category-${item.id}`}
        >
          {item.category}
        </span>
      )}
      {meta.length > 0 && (
        <span
          className="flex-shrink-0 text-[9px] text-dim whitespace-nowrap leading-5"
          data-testid={`corrections-item-meta-${item.id}`}
        >
          {meta.join(' · ')}
        </span>
      )}
    </>
  );
}
