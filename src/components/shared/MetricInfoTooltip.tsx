import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

// fix-129-a: shared "what does this metric mean?" tooltip used across
// Reports MetricCards, Trends KPI tiles, and chart titles. Hand-rolled
// (no popover library) — hovers on the label + the inline "?" icon both
// show a floating panel with the metric's plain-language description,
// formula, and cohort gate. Same panel surfaces on keyboard focus so
// the disclosure works without a pointer.
//
// Grace period (~120ms) on dismiss so the cursor can traverse the small
// gap between the trigger and the panel without flicker. Escape dismisses
// immediately. Tooltip positions above the trigger by default; if there
// isn't enough room above (top edge < tooltip height + margin) it flips
// below.

export interface MetricInfoTooltipProps {
  /** Visible metric label (e.g., "Avg City Review"). Also the panel title. */
  label: string;
  /** Plain-language sentence about what the metric measures. */
  description: string;
  /** Optional human-readable formula. Rendered italic. */
  formula?: string;
  /** Optional cohort/gate note ("Only counts permits with X set"). */
  cohort?: string;
  /** Stable slug used in testids (metric-tooltip-trigger-{slug},
   *  metric-tooltip-content-{slug}). Defaults to a slugified label. */
  slug?: string;
  /** Optional class name on the outer wrapper (e.g., to apply the
   *  consumer's label typography). The label text inside renders with
   *  inherited styling. */
  className?: string;
  /** Override the rendered label content (e.g., already-styled markup).
   *  Falls back to the `label` text when omitted. */
  children?: ReactNode;
}

const HOVER_GRACE_MS = 120;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function MetricInfoTooltip({
  label,
  description,
  formula,
  cohort,
  slug,
  className,
  children,
}: MetricInfoTooltipProps) {
  const finalSlug = slug ?? slugify(label);
  const reactId = useId();
  const tooltipId = `metric-tooltip-${reactId}`;

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_GRACE_MS);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // Decide placement (above vs below) the moment the panel opens. Pure
  // measurement; no setState in a render path (the panel is mounted via
  // the `open` flag so this runs once per open).
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    // 8px margin + the panel itself needs to fit above the trigger.
    if (triggerRect.top < panelHeight + 16) {
      setPlacement('below');
    } else {
      setPlacement('above');
    }
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  // The trigger is a focusable span (tabIndex={0}) wrapping the label
  // text + the "?" icon. Wrapping the whole label lets either the label
  // text OR the icon fire the hover/focus — both are part of the same
  // trigger element.
  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex items-center gap-1 cursor-help ${className ?? ''}`}
      tabIndex={0}
      role="button"
      aria-describedby={open ? tooltipId : undefined}
      data-testid={`metric-tooltip-trigger-${finalSlug}`}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      <span>{children ?? label}</span>
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center text-[9px] font-bold rounded-full border w-3.5 h-3.5 leading-none select-none"
        style={{
          borderColor: 'var(--color-dim)',
          color: 'var(--color-dim)',
          background: 'transparent',
        }}
      >
        ?
      </span>
      {open && (
        <div
          ref={panelRef}
          id={tooltipId}
          role="tooltip"
          // Position above by default. The placement effect flips this
          // to "below" when the trigger is near the top of the viewport.
          // bottom/top + margin keep an 8px gap from the trigger.
          className={`absolute z-50 left-0 ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{
            minWidth: 220,
            maxWidth: 320,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-popup, 0 8px 24px rgba(0,0,80,.15))',
            padding: '8px 10px',
            // Don't inherit the cursor-help — clicking inside should not
            // re-trigger any default action.
            cursor: 'default',
          }}
          data-testid={`metric-tooltip-content-${finalSlug}`}
          // Hovering the panel keeps it open (grace period would
          // otherwise dismiss it the moment the cursor leaves the
          // trigger to reach the panel).
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div
            className="text-[11px] font-display font-bold text-text mb-1"
            data-testid={`metric-tooltip-content-${finalSlug}-title`}
          >
            {label}
          </div>
          <div
            className="text-[11px] text-muted leading-snug"
            data-testid={`metric-tooltip-content-${finalSlug}-description`}
          >
            {description}
          </div>
          {formula && (
            <div
              className="text-[10px] italic text-muted leading-snug mt-1"
              data-testid={`metric-tooltip-content-${finalSlug}-formula`}
            >
              Formula: {formula}
            </div>
          )}
          {cohort && (
            <div
              className="text-[10px] text-dim leading-snug mt-1"
              data-testid={`metric-tooltip-content-${finalSlug}-cohort`}
            >
              Cohort: {cohort}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
