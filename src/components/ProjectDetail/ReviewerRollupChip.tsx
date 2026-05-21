import { useEffect, useRef, useState } from 'react';
import type { PermitCycleReviewer } from '../../lib/database.types';
import {
  bucketStatus,
  latestCycleIndex,
  rollupCounts,
  rowsForCycle,
  statusLabel,
} from '../../lib/reviewerRollup';
import type { ReviewerCounts } from '../../lib/reviewerRollup';
import { isTerminalPositiveStatus } from '../../lib/permitTerminalStatus';

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

// fix-43: popover sort order — outstanding (not-yet-approved) reviewers
// surface first so Bobby instantly sees who's holding a permit up;
// approved sink to the bottom. Lower rank = higher in the list. The rule
// is uniform (not terminal-special-cased): corrections → in-review/
// assigned → pending → not-required → approved. Within a rank we fall
// back to a stable alphabetical sort by reviewer_name.
const SORT_RANK: Record<ReturnType<typeof bucketStatus>, number> = {
  corrections: 0,
  in_review: 1,
  pending: 2,
  not_required: 3,
  approved: 4,
};

interface Props {
  permitId: number;
  rows: PermitCycleReviewer[];
  /** Legacy fallback when no reviewer rows exist yet — the
   *  permits.extras.latest_reviewer key captured by the scraper for
   *  permit types whose adapter doesn't yet do per-reviewer extraction
   *  (PA/IPR/SPU/Land Use/MBP/Redmond). */
  fallbackReviewer: string | null;
  /** fix-31b: permits.status drives the rollup override. When the
   *  city's portal-side Record Status is a terminal-positive value
   *  (Conceptually Approved / Approved / Issued / Completed / Ready
   *  for Issuance / Closed) every reviewer rolls up as approved
   *  regardless of their last individual event — the permit's own
   *  status is the authoritative ceiling. See reviewerRollup.ts for
   *  the full list. fix-41 type-scopes this (see permitType below). */
  permitStatus?: string | null;
  /** fix-41: permits.type. The fix-31b override is now gated on this —
   *  it fires only for no-issuance types (SDOT Tree / PAR/Pre-Sub /
   *  ECA Waiver / ULS). Threaded through to rollupCounts, which owns the
   *  gate. Issuance-bearing types show real per-reviewer counts. */
  permitType?: string | null;
}

export default function ReviewerRollupChip({
  permitId,
  rows,
  fallbackReviewer,
  permitStatus,
  permitType,
}: Props) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );

  const latestIdx = latestCycleIndex(rows);
  const visibleRows = latestIdx === null ? [] : rowsForCycle(rows, latestIdx);
  const counts = rollupCounts(visibleRows, permitStatus, permitType);

  // fix-42 (2026-05-21): on a terminal-positive permit, a reviewer still
  // sitting at corrections_required is necessarily RESOLVED — the permit
  // advanced past their hold (e.g. 7087867-DM Iris Moore: an intake hold
  // cleared on resubmit whose Accela task never auto-closed). So the ⚠
  // "action needed" pill is a false alarm. De-alarm it: suppress the ⚠
  // and fold those reviewers into the muted "other" (©) group so the
  // chip stays fully accounted (total = approved + ©). We do NOT collapse
  // them to approved (fix-41's rollupCounts keeps real counts; the popup
  // still shows their raw "Corrections" status as honest detail).
  // No type gate needed: no-issuance types already fold corrections into
  // approved via fix-41's override, so there is no ⚠ left to mute here.
  const muteCorrections = isTerminalPositiveStatus(permitStatus);
  const mutedOther =
    counts.inReview +
    counts.pending +
    (muteCorrections ? counts.correctionsRequired : 0);

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
        {/* fix-43: per-segment title tooltips make the glyphs
            self-explanatory on hover without changing the data. */}
        <span
          className="text-text"
          title={`${counts.total} reviewers — cycle ${latestIdx}`}
        >
          {counts.total}
        </span>
        {counts.approved > 0 && (
          <span
            style={{ color: 'var(--color-pm)' }}
            title={`${counts.approved} approved`}
          >
            {counts.approved}✓
          </span>
        )}
        {!muteCorrections && counts.correctionsRequired > 0 && (
          <span
            style={{ color: 'var(--color-co)' }}
            title={`${counts.correctionsRequired} corrections required`}
          >
            {counts.correctionsRequired}⚠
          </span>
        )}
        {mutedOther > 0 && (
          <span
            style={{ color: 'var(--color-dim)' }}
            title={`${mutedOther} outstanding (in review / assigned / pending)`}
          >
            {mutedOther}©
          </span>
        )}
      </button>
      {open && anchor && (
        <ReviewerPopover
          permitId={permitId}
          cycleIndex={latestIdx ?? 0}
          rows={visibleRows}
          counts={counts}
          correctionsVisible={!muteCorrections && counts.correctionsRequired > 0}
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
  counts,
  correctionsVisible,
  top,
  left,
}: {
  permitId: number;
  cycleIndex: number;
  rows: PermitCycleReviewer[];
  counts: ReviewerCounts;
  correctionsVisible: boolean;
  top: number;
  left: number;
}) {
  // fix-43: outstanding-first ordering (see SORT_RANK). Approved reviewers
  // sink to the bottom; within a rank we keep a stable alphabetical order.
  const sorted = [...rows].sort((a, b) => {
    const ra = SORT_RANK[bucketStatus(a.current_status)];
    const rb = SORT_RANK[bucketStatus(b.current_status)];
    if (ra !== rb) return ra - rb;
    return a.reviewer_name.localeCompare(b.reviewer_name);
  });
  // fix-43: header breakdown doubles as the always-visible legend for the
  // chip glyphs. Mirrors the chip's (override-aware) counts exactly.
  const outstanding = counts.total - counts.approved;
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
        className="border-b"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <div className="px-2 pt-1.5 text-[9px] font-extrabold uppercase tracking-wider text-text flex items-center justify-between">
          <span>Reviewers — Cycle {cycleIndex}</span>
          <span className="text-dim font-mono">{counts.total}</span>
        </div>
        <div
          className="px-2 pb-1.5 pt-0.5 text-[9px] font-semibold flex items-center gap-1.5 flex-wrap"
          data-testid={`reviewer-legend-${permitId}`}
        >
          <span style={{ color: 'var(--color-pm)' }}>
            {counts.approved} approved
          </span>
          <span className="text-dim">·</span>
          <span style={{ color: 'var(--color-de)' }}>
            {outstanding} outstanding
          </span>
          {correctionsVisible && (
            <>
              <span className="text-dim">·</span>
              <span style={{ color: 'var(--color-co)' }}>
                {counts.correctionsRequired} corrections
              </span>
            </>
          )}
        </div>
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
