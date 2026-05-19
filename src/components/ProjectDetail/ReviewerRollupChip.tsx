import { useEffect, useRef, useState } from 'react';
import type { PermitCycleReviewer } from '../../lib/database.types';
import {
  bucketStatus,
  latestCycleIndex,
  rollupCounts,
  rowsForCycle,
  statusLabel,
} from '../../lib/reviewerRollup';

// fix-31: Schedule Health column cell for the reviewer rollup. Replaces
// the pre-fix-31 "tasks" placeholder column that just rendered "no
// tasks" for every permit. Two visual states:
//
//   1. No reviewer rows captured for this permit → fall back to the
//      legacy permits.extras.latest_reviewer single-name display, or
//      a dim "—" when neither is set.
//   2. At least one reviewer row → render a compact chip
//      "N · 3✓ 2⚠ 4©" (total · approved · corrections · pending+in-review).
//      Click → side popover with the full per-reviewer list.
//
// The popover is positioned relative to the chip via fixed positioning
// + getBoundingClientRect math (the table sits inside a scroll
// container, so anchoring with absolute position would clip). Outside-
// click + Esc dismiss.

const STATUS_ACCENT: Record<
  ReturnType<typeof bucketStatus>,
  { dot: string; fg: string }
> = {
  approved: { dot: 'var(--color-pm)', fg: 'var(--color-pm)' },
  corrections: { dot: 'var(--color-co)', fg: 'var(--color-co)' },
  in_review: { dot: 'var(--color-de)', fg: 'var(--color-de)' },
  pending: { dot: 'var(--color-dim)', fg: 'var(--color-dim)' },
  not_required: { dot: 'var(--color-muted)', fg: 'var(--color-muted)' },
};

interface Props {
  permitId: number;
  rows: PermitCycleReviewer[];
  /** Legacy fallback when no reviewer rows exist yet — the
   *  permits.extras.latest_reviewer key captured by the scraper for
   *  permit types whose adapter doesn't yet do per-reviewer extraction
   *  (PA/IPR/SPU/Land Use/MBP/Redmond). */
  fallbackReviewer: string | null;
}

export default function ReviewerRollupChip({
  permitId,
  rows,
  fallbackReviewer,
}: Props) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );

  const latestIdx = latestCycleIndex(rows);
  const visibleRows = latestIdx === null ? [] : rowsForCycle(rows, latestIdx);
  const counts = rollupCounts(visibleRows);

  // Outside-click + Esc dismiss
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      const chip = chipRef.current;
      const popover = document.querySelector(
        `[data-testid="reviewer-popover-${permitId}"]`,
      );
      if (chip && chip.contains(t)) return;
      if (popover && popover.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, permitId]);

  function toggle() {
    if (!open && chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect();
      // Anchor the popover to the right edge of the chip, vertically
      // centered. Math is intentionally simple — viewport clipping
      // is handled by max-height + overflow inside the popover.
      setAnchor({ top: rect.top + window.scrollY, left: rect.right + 6 });
    }
    setOpen((v) => !v);
  }

  if (counts.total === 0) {
    if (!fallbackReviewer) {
      return (
        <span className="text-[10px] text-dim italic">—</span>
      );
    }
    return (
      <span
        className="text-[10px] text-text truncate inline-block max-w-[110px]"
        title={fallbackReviewer}
        data-testid={`reviewer-fallback-${permitId}`}
      >
        {fallbackReviewer}
      </span>
    );
  }

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border bg-surface hover:bg-s2 transition cursor-pointer"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid={`reviewer-chip-${permitId}`}
        aria-expanded={open}
        title={`Cycle ${latestIdx} reviewers — click to expand`}
      >
        <span className="text-text">{counts.total}</span>
        {counts.approved > 0 && (
          <span style={{ color: 'var(--color-pm)' }}>
            {counts.approved}✓
          </span>
        )}
        {counts.correctionsRequired > 0 && (
          <span style={{ color: 'var(--color-co)' }}>
            {counts.correctionsRequired}⚠
          </span>
        )}
        {(counts.inReview + counts.pending) > 0 && (
          <span style={{ color: 'var(--color-dim)' }}>
            {counts.inReview + counts.pending}©
          </span>
        )}
      </button>
      {open && anchor && (
        <ReviewerPopover
          permitId={permitId}
          cycleIndex={latestIdx ?? 0}
          rows={visibleRows}
          top={anchor.top}
          left={anchor.left}
        />
      )}
    </>
  );
}

function ReviewerPopover({
  permitId,
  cycleIndex,
  rows,
  top,
  left,
}: {
  permitId: number;
  cycleIndex: number;
  rows: PermitCycleReviewer[];
  top: number;
  left: number;
}) {
  const sorted = [...rows].sort((a, b) =>
    a.reviewer_name.localeCompare(b.reviewer_name),
  );
  return (
    <div
      className="fixed z-[10000] rounded border shadow-lg"
      style={{
        top,
        left,
        maxHeight: 320,
        width: 260,
        overflowY: 'auto',
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
      data-testid={`reviewer-popover-${permitId}`}
    >
      <div
        className="px-2 py-1.5 border-b text-[9px] font-extrabold uppercase tracking-wider text-text flex items-center justify-between"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span>Reviewers — Cycle {cycleIndex}</span>
        <span className="text-dim font-mono">{sorted.length}</span>
      </div>
      <ul className="flex flex-col">
        {sorted.map((r) => {
          const bucket = bucketStatus(r.current_status);
          const accent = STATUS_ACCENT[bucket];
          return (
            <li
              key={r.id}
              className="px-2 py-1 border-b flex items-center gap-2"
              style={{ borderBottomColor: 'var(--color-border)' }}
              data-testid={`reviewer-row-${r.id}`}
            >
              <span
                className="inline-block flex-shrink-0 rounded-full"
                style={{
                  width: 7,
                  height: 7,
                  background: accent.dot,
                }}
              />
              <div className="flex-1 min-w-0">
                <div
                  className="text-[11px] font-bold text-text truncate"
                  title={r.reviewer_name}
                >
                  {r.reviewer_name}
                </div>
                {r.discipline && (
                  <div className="text-[9px] text-dim truncate">
                    {r.discipline}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                <span
                  className="text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: accent.fg }}
                >
                  {statusLabel(r.current_status)}
                </span>
                {r.last_event_date && (
                  <span
                    className="text-[8px] font-mono"
                    style={{ color: 'var(--color-dim)' }}
                  >
                    {r.last_event_date}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
