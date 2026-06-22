import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PermitCycleReviewer } from '../../lib/database.types';
import {
  bucketStatus,
  currentCycleIndex,
  latestCycleIndex,
  rollupCounts,
  rowsForCycle,
  statusLabel,
} from '../../lib/reviewerRollup';
import type { ReviewerCounts } from '../../lib/reviewerRollup';
import { isTerminalPositiveStatus } from '../../lib/permitTerminalStatus';
import { useViewportAwarePopover } from '../../hooks/useViewportAwarePopover';

// fix-64 (2026-05-27): popup is now viewport-aware. The hook flips
// above when there's no room below, clamps horizontally to the viewport,
// and caps the popup's max-height to available space so a long reviewer
// list scrolls internally instead of clipping off the bottom (the bug
// Bobby reported: 6 reviewers on a row near the page bottom rendered
// only ~5). Lives in src/hooks/useViewportAwarePopover.ts so other
// popovers (e.g. AddrGroup) can adopt the same pattern.

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
  /** fix-186: the permit's cycles. When supplied, the chip displays the
   *  CURRENT (latest) cycle's reviewers — currentCycleIndex(cycles) — instead of
   *  the latest reviewer-ROW cycle, so it can't lag a cycle behind once the
   *  permit has advanced. If the current cycle has no reviewer rows yet (but an
   *  earlier cycle does), the chip shows a neutral "Cycle N — not yet assigned"
   *  rather than silently rendering the stale earlier cycle. Omit to keep the
   *  legacy latest-reviewer-row behavior. */
  cycles?: ReadonlyArray<{ cycle_index: number }>;
}

export default function ReviewerRollupChip({
  permitId,
  rows,
  fallbackReviewer,
  permitStatus,
  permitType,
  cycles,
}: Props) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  // fix-64: replaced the local {top, left} state + manual rect math with
  // the shared useViewportAwarePopover hook. Hardcoded width/maxHeight
  // match the prior popover style (260 / 320) so visuals are unchanged
  // when there IS room; the hook only kicks in to flip / cap when the
  // chip is near a viewport edge. (Side note: the prior math added
  // window.scrollY to a position:fixed top — also wrong, also gone.)
  const popover = useViewportAwarePopover({
    triggerRef: chipRef,
    open,
    width: 260,
    maxHeight: 320,
  });

  // fix-186: when cycles are supplied, follow the permit's CURRENT cycle (so the
  // chip can't lag behind once the permit advanced to a cycle that has no
  // reviewer rows yet). Without cycles, keep the legacy latest-reviewer-row
  // behavior.
  const latestIdx = cycles
    ? currentCycleIndex(cycles, rows)
    : latestCycleIndex(rows);
  const visibleRows = latestIdx === null ? [] : rowsForCycle(rows, latestIdx);
  const counts = rollupCounts(visibleRows, permitStatus, permitType);
  // fix-186: the current cycle exists but has no reviewer rows yet, while an
  // EARLIER cycle does — the round hasn't been assigned. Show a neutral state
  // instead of the stale earlier cycle's reviewers.
  const awaitingCurrentCycle =
    !!cycles && counts.total === 0 && latestIdx !== null && rows.length > 0;

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
    // fix-64: positioning is computed by useViewportAwarePopover from the
    // chipRef + open flag; this handler is now just an open/close toggle.
    setOpen((v) => !v);
  }

  if (counts.total === 0) {
    // fix-186: current cycle has no reviewers yet but an earlier cycle did —
    // the round just hasn't been assigned. Surface that explicitly rather than
    // showing the stale earlier cycle or a bare dash.
    if (awaitingCurrentCycle) {
      return (
        <span
          className="text-[10px] text-dim italic"
          data-testid={`reviewer-not-assigned-${permitId}`}
          title={`Cycle ${latestIdx} reviewers not yet assigned`}
        >
          Cycle {latestIdx} — not yet assigned
        </span>
      );
    }
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
      {open && popover.style && (
        <ReviewerPopover
          permitId={permitId}
          cycleIndex={latestIdx ?? 0}
          rows={visibleRows}
          counts={counts}
          muteCorrections={muteCorrections}
          containerStyle={popover.style}
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
  muteCorrections,
  containerStyle,
}: {
  permitId: number;
  cycleIndex: number;
  rows: PermitCycleReviewer[];
  counts: ReviewerCounts;
  /** fix-42: on a terminal-positive permit (e.g. Issued, Approved),
   *  corrections_required reviewers are real-but-resolved holds the
   *  city portal didn't auto-close. The chip de-alarms them by folding
   *  the count into outstanding. The popover legend mirrors that so the
   *  breakdown still adds up to the displayed total. */
  muteCorrections: boolean;
  /** fix-64: position + size come from useViewportAwarePopover so the
   *  popup stays on-screen near any viewport edge. Includes position,
   *  top, left, width, maxHeight (capped to viewport), and overflowY:
   *  auto so long reviewer lists scroll internally rather than clip. */
  containerStyle: CSSProperties;
}) {
  // fix-43: outstanding-first ordering (see SORT_RANK). Approved reviewers
  // sink to the bottom; within a rank we keep a stable alphabetical order.
  const sorted = [...rows].sort((a, b) => {
    const ra = SORT_RANK[bucketStatus(a.current_status)];
    const rb = SORT_RANK[bucketStatus(b.current_status)];
    if (ra !== rb) return ra - rb;
    return a.reviewer_name.localeCompare(b.reviewer_name);
  });
  // fix-103: stacked 2-line breakdown mirrors fix-95's PermitMiniTable cell
  // (src/pages/ProjectList.tsx) so Project View and Schedule Health speak
  // the same numbers.
  //   displayedTotal = rows.length − notRequired (the "who still needs to
  //                    act" count Bobby actually cares about — N/A
  //                    reviewers don't count).
  //   correctionsShown = 0 when muteCorrections (fix-42 de-alarm path); in
  //                    that case the muted reviewers count toward
  //                    outstanding instead, so the three numbers still sum
  //                    to displayedTotal.
  //   outstanding = inReview + pending [+ corrections when muted].
  // Zeros render explicitly — "0 corrections" communicates completion,
  // and auto-hiding a bucket would make the cell read ambiguously.
  const displayedTotal = counts.total - counts.notRequired;
  const correctionsShown = muteCorrections ? 0 : counts.correctionsRequired;
  const outstanding =
    counts.inReview +
    counts.pending +
    (muteCorrections ? counts.correctionsRequired : 0);
  return (
    <div
      className="z-[10000] rounded border shadow-lg"
      style={{
        // Position / size / overflow come from the hook (viewport-aware).
        // Visual styling (background, border tint) stays inline so the
        // popover keeps the same surface look in light + dark themes.
        ...containerStyle,
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
          <span className="text-dim font-mono">{displayedTotal}</span>
        </div>
        {/* fix-103: stacked breakdown — line 1 carries the total in
            prose ("N reviewers"), line 2 carries the always-explicit
            approved · corrections · outstanding split. Mirrors the
            fix-95 Project View cell verbatim so the two surfaces are
            readable as the same number. */}
        <div
          className="px-2 pb-1.5 pt-0.5 text-[9px] font-semibold font-mono"
          data-testid={`reviewer-legend-${permitId}`}
        >
          <div className="text-text">{displayedTotal} reviewers</div>
          <div
            className="flex items-center gap-1.5 flex-wrap"
            data-testid={`reviewer-breakdown-${permitId}`}
          >
            <span className="text-pm">{counts.approved} approved</span>
            <span className="text-dim">·</span>
            <span className="text-co">{correctionsShown} corrections</span>
            <span className="text-dim">·</span>
            <span className="text-dim">{outstanding} outstanding</span>
          </div>
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
                {/* fix-44: a reviewer row is now a discipline SLOT carrying
                    its current assignee. Surface the discipline as an inline
                    prefix — "Energy — Stephen Rudolph" — with the slot label
                    dimmed and the assignee emphasized. Current data has
                    discipline NULL everywhere, so this renders exactly as
                    before (bare name) until PR2's slot data flows. */}
                <div
                  className="text-[11px] font-bold text-text truncate"
                  title={
                    r.discipline
                      ? `${r.discipline} — ${r.reviewer_name}`
                      : r.reviewer_name
                  }
                >
                  {r.discipline && (
                    <span className="text-dim font-semibold">
                      {r.discipline} —{' '}
                    </span>
                  )}
                  {r.reviewer_name}
                </div>
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
