import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

// fix-64 (2026-05-27): tiny viewport-aware positioning hook for popovers
// that anchor off a trigger element. Pre-fix, ReviewerRollupChip computed
// a static (top, left) at click time and let the popover render with a
// hardcoded maxHeight — which (a) ran off the bottom of the viewport on
// rows near the page bottom (Bobby's bug: 6-reviewer popup clipped the
// 6th), and (b) erroneously added window.scrollY to a position:fixed
// element's top so the popup drifted further out of place on a scrolled
// page. This hook owns the placement math so the same pattern can be
// reused by AddrGroup / future popovers without re-deriving the same
// edge cases.
//
// Design notes (deliberate keeps):
// - No new dependency. @floating-ui would solve more (auto-update on
//   ancestor scroll, virtual-element anchoring, arrow positioning), but
//   it's also ~12 KB gzipped and a meaningful API surface to maintain.
//   For the in-app needs we have today (fixed-position popover off a
//   simple DOM trigger) a 60-line hook is enough.
// - Caller supplies declared `width` + `maxHeight` rather than measuring
//   the rendered popover. Avoids the chicken-and-egg of "render to
//   measure, then re-render with corrected position" (which flickers
//   without a hidden first-pass). The hook just caps the requested
//   maxHeight against viewport-available space so internal overflow-y
//   scroll handles the rest.
// - position: fixed (viewport-relative) — pairs with the in-viewport
//   coordinates returned. DOES NOT add window.scrollY (the prior bug).
// - useLayoutEffect so the computed position lands before paint — no
//   visible jump from a default placement to the corrected one.
// - Re-runs on window resize while open: cheap, covers the "user
//   resizes the window with the popover open" edge case.

export interface ViewportAwarePopoverInput {
  /** Ref to the trigger element (e.g. the chip button). Position is
   *  computed off its getBoundingClientRect; null until the consumer
   *  mounts the trigger. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Whether the popover is currently open. When false the hook
   *  returns null and clears any prior measurement so re-opens recompute
   *  fresh (e.g. if the trigger has moved since last open). */
  open: boolean;
  /** Declared popover width in CSS pixels. Used for horizontal
   *  overflow calculations + emitted as `width` on the returned style. */
  width: number;
  /** Requested max-height in CSS pixels. The hook caps this against
   *  available viewport space (viewport height minus margins) and emits
   *  the capped value so the popover's internal overflow-y handles the
   *  remainder via scroll. */
  maxHeight: number;
  /** Distance to keep between the popover and the viewport edges.
   *  Default 8px. */
  margin?: number;
  /** Distance between the trigger and the popover, on the placement
   *  axis. Default 6px. */
  gap?: number;
  /** Preferred placement. 'right' anchors next to the trigger's right
   *  edge (current ReviewerRollupChip behavior); 'bottom' anchors
   *  directly below the trigger. Hook flips when the preferred side
   *  doesn't fit. Default 'right'. */
  preferred?: 'right' | 'bottom';
}

export interface ViewportAwarePopoverResult {
  /** Inline style ready to spread onto the popover container. Includes
   *  position:fixed, top, left, width, maxHeight, overflowY:auto. Null
   *  while the popover is closed OR while the hook is waiting for the
   *  trigger to mount. */
  style: CSSProperties | null;
  /** Which side of the trigger the popover landed on. Mostly useful
   *  for future enhancements (arrow direction, animation origin); not
   *  consumed by today's chip. */
  placement: 'right' | 'left' | 'bottom' | 'top' | 'pinned';
}

export function useViewportAwarePopover({
  triggerRef,
  open,
  width,
  maxHeight,
  margin = 8,
  gap = 6,
  preferred = 'right',
}: ViewportAwarePopoverInput): ViewportAwarePopoverResult {
  const [result, setResult] = useState<ViewportAwarePopoverResult>({
    style: null,
    placement: 'pinned',
  });

  useLayoutEffect(() => {
    if (!open) {
      // Reset between opens so a re-open recomputes against the trigger's
      // current rect (otherwise a scroll-then-reopen would briefly paint
      // at the stale position). Same justification as the setResult below.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ style: null, placement: 'pinned' });
      return;
    }

    function compute() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Vertical bound: how tall the popover is actually allowed to be
      // given the viewport. The popover's own internal overflow-y:auto
      // handles content that exceeds this cap.
      const availableVertical = Math.max(0, vh - 2 * margin);
      const effectiveMaxHeight = Math.min(maxHeight, availableVertical);

      // --- Horizontal placement -----------------------------------------
      // Preferred 'right': anchor to the trigger's right edge. If the
      // popover would spill past the viewport's right edge, flip to the
      // left of the trigger. If both sides spill (extreme narrow viewport),
      // clamp inside the viewport.
      let left: number;
      let placement: ViewportAwarePopoverResult['placement'];
      if (preferred === 'right') {
        const rightOption = r.right + gap;
        if (rightOption + width + margin <= vw) {
          left = rightOption;
          placement = 'right';
        } else {
          const leftOption = r.left - gap - width;
          if (leftOption >= margin) {
            left = leftOption;
            placement = 'left';
          } else {
            // Both sides overflow — pin to the larger gap.
            left = Math.max(margin, vw - width - margin);
            placement = 'pinned';
          }
        }
      } else {
        // 'bottom': horizontally align left edges by default; clamp.
        left = r.left;
        if (left + width + margin > vw) {
          left = Math.max(margin, vw - width - margin);
        }
        if (left < margin) left = margin;
        placement = 'bottom';
      }

      // --- Vertical placement ------------------------------------------
      // For 'right' preferred, the popover sits to the side of the trigger,
      // so vertical anchoring just aligns its top with the trigger top —
      // unless that would push the bottom past the viewport, in which case
      // we slide it up (preferring to keep its top on screen, then pin to
      // margin if even that overflows). Same logic applied to 'bottom'
      // preferred, but starting at trigger.bottom + gap and flipping above
      // the trigger when there isn't room.
      let top: number;
      if (preferred === 'bottom') {
        const belowOption = r.bottom + gap;
        if (belowOption + effectiveMaxHeight + margin <= vh) {
          top = belowOption;
          placement = 'bottom';
        } else {
          const aboveOption = r.top - gap - effectiveMaxHeight;
          if (aboveOption >= margin) {
            top = aboveOption;
            placement = 'top';
          } else {
            // Cap to viewport.
            top = Math.max(margin, vh - margin - effectiveMaxHeight);
          }
        }
      } else {
        // 'right' / 'left' / 'pinned' — vertical alignment with trigger top,
        // sliding up if necessary.
        top = r.top;
        if (top + effectiveMaxHeight + margin > vh) {
          top = vh - margin - effectiveMaxHeight;
        }
        if (top < margin) top = margin;
      }

      // Note on the set-state-in-effect lint rule: this setState (and the
      // one in the !open branch above) ARE the measure-then-position
      // pattern used by every popover library (@floating-ui, Radix,
      // Headless UI). Without DOM access during render, layout-effect
      // measurement is the only way to derive a viewport-aware position.
      // The rule fires on the !open branch (which it sees as direct);
      // this nested-function path doesn't trigger the lint, but lives
      // here for the same reason.
      setResult({
        style: {
          position: 'fixed',
          top,
          left,
          width,
          maxHeight: effectiveMaxHeight,
          overflowY: 'auto',
        },
        placement,
      });
    }

    compute();
    // Window resize is the realistic in-open viewport change. Scroll-
    // while-open is rare on this surface (outside-click dismisses the
    // popover), but listening costs near-nothing and prevents the popup
    // from drifting if a parent scroll container moves the trigger.
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, triggerRef, width, maxHeight, margin, gap, preferred]);

  return result;
}
