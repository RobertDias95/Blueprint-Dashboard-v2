import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReviewerRollupChip from '../components/ProjectDetail/ReviewerRollupChip';
import type {
  PermitCycleReviewer,
  ReviewerStatus,
} from '../lib/database.types';

// fix-31: chip smoke test. Verifies the three render paths the
// Project Overview surface exercises:
//   - rows: render the count chip, click → popover with the list
//   - no rows but fallbackReviewer: render the legacy name
//   - no rows AND no fallback: render the dim placeholder dash

function makeReviewer(
  reviewer_name: string,
  current_status: ReviewerStatus,
  cycle_index = 1,
): PermitCycleReviewer {
  return {
    id: `r-${reviewer_name}-${cycle_index}`,
    tenant_id: 'tenant-0',
    permit_id: 42,
    cycle_index,
    reviewer_name,
    discipline: null,
    current_status,
    last_event_date: '2026-05-15',
    created_at: '2026-05-19T12:00:00Z',
    updated_at: '2026-05-19T12:00:00Z',
  };
}

describe('ReviewerRollupChip', () => {
  it('renders the count chip when reviewer rows exist', () => {
    const rows: PermitCycleReviewer[] = [
      makeReviewer('A', 'approved'),
      makeReviewer('B', 'approved'),
      makeReviewer('C', 'corrections_required'),
      makeReviewer('D', 'pending'),
    ];
    render(
      <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
    );
    const chip = screen.getByTestId('reviewer-chip-42');
    expect(chip.textContent).toContain('4'); // total
    expect(chip.textContent).toContain('2✓'); // approved
    expect(chip.textContent).toContain('1⚠'); // corrections
    // Popover not in DOM until click
    expect(screen.queryByTestId('reviewer-popover-42')).toBeNull();
  });

  it('opens a popover with the per-reviewer detail list on click', () => {
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Aaron Blunt', 'approved'),
      makeReviewer('Shimika Dowlen', 'corrections_required'),
    ];
    render(
      <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const popover = screen.getByTestId('reviewer-popover-42');
    expect(popover.textContent).toContain('Aaron Blunt');
    expect(popover.textContent).toContain('Shimika Dowlen');
    expect(popover.textContent).toContain('Approved');
    expect(popover.textContent).toContain('Corrections');
  });

  it('filters the popover to the latest cycle when multiple cycles present', () => {
    const rows: PermitCycleReviewer[] = [
      makeReviewer('OldReviewer', 'approved', 1),
      makeReviewer('NewReviewer', 'corrections_required', 2),
    ];
    render(
      <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const popover = screen.getByTestId('reviewer-popover-42');
    expect(popover.textContent).toContain('NewReviewer');
    expect(popover.textContent).not.toContain('OldReviewer');
    expect(popover.textContent).toContain('Cycle 2');
  });

  it('falls back to the legacy latest_reviewer string when no rows', () => {
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={[]}
        fallbackReviewer="Griffin Cronk"
      />,
    );
    expect(screen.getByTestId('reviewer-fallback-42').textContent).toBe(
      'Griffin Cronk',
    );
    expect(screen.queryByTestId('reviewer-chip-42')).toBeNull();
  });

  // fix-186: the chip follows the permit's CURRENT cycle (from `cycles`), not
  // the latest reviewer-ROW cycle, so it can't lag a cycle behind.
  describe('fix-186 current-cycle scoping', () => {
    it('shows the CURRENT cycle reviewers when cycles are supplied', () => {
      const rows: PermitCycleReviewer[] = [
        makeReviewer('Old', 'corrections_required', 1),
        makeReviewer('NewA', 'approved', 2),
        makeReviewer('NewB', 'in_review', 2),
      ];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
          cycles={[{ cycle_index: 1 }, { cycle_index: 2 }]}
        />,
      );
      const chip = screen.getByTestId('reviewer-chip-42');
      // Cycle 2 has 2 reviewers (1 approved, 1 in_review) — NOT the stale cycle 1.
      expect(chip.getAttribute('title')).toContain('Cycle 2');
      expect(chip.textContent).toContain('2');
      expect(chip.textContent).toContain('1✓');
      expect(chip.textContent).not.toContain('⚠'); // no corrections on cycle 2
    });

    it('current cycle has NO reviewer rows (earlier cycle does) → "not yet assigned"', () => {
      const rows: PermitCycleReviewer[] = [
        makeReviewer('Old1', 'corrections_required', 1),
        makeReviewer('Old2', 'approved', 1),
      ];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer="Legacy Name"
          cycles={[{ cycle_index: 1 }, { cycle_index: 2 }]}
        />,
      );
      const el = screen.getByTestId('reviewer-not-assigned-42');
      expect(el.textContent).toBe('Cycle 2 — not yet assigned');
      // The stale cycle-1 chip + the legacy fallback must NOT render.
      expect(screen.queryByTestId('reviewer-chip-42')).toBeNull();
      expect(screen.queryByTestId('reviewer-fallback-42')).toBeNull();
    });

    it('no reviewer rows at all + cycles → legacy fallback, NOT "not yet assigned"', () => {
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={[]}
          fallbackReviewer="Griffin Cronk"
          cycles={[{ cycle_index: 1 }, { cycle_index: 2 }]}
        />,
      );
      expect(screen.queryByTestId('reviewer-not-assigned-42')).toBeNull();
      expect(screen.getByTestId('reviewer-fallback-42').textContent).toBe(
        'Griffin Cronk',
      );
    });

    it('without cycles, keeps legacy latest-reviewer-row behavior', () => {
      const rows: PermitCycleReviewer[] = [
        makeReviewer('Old', 'approved', 1),
        makeReviewer('New', 'corrections_required', 2),
      ];
      render(
        <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
      );
      // Legacy path: latest reviewer-row cycle (2) drives the chip.
      const chip = screen.getByTestId('reviewer-chip-42');
      expect(chip.getAttribute('title')).toContain('Cycle 2');
    });
  });

  it('terminal-positive + no-issuance type suppresses the ⚠ corrections pill (fix-31b/fix-41)', () => {
    // Mirrors SDOTTRLA0002310: reviewer's individual event stream ends
    // at corrections_required, but it's a Conceptually Approved SDOT Tree
    // (no-issuance) so the override fires and the chip shows all ✓.
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Anne-Marie', 'corrections_required'),
      makeReviewer('Tom', 'approved'),
      makeReviewer('Jane', 'in_process'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Conceptually Approved"
        permitType="SDOT Tree"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-42');
    expect(chip.textContent).toContain('3');
    expect(chip.textContent).toContain('3✓');
    expect(chip.textContent).not.toContain('⚠');
  });

  it('terminal-positive + issuance-bearing keeps REAL approved count but MUTES ⚠ (fix-41/fix-42)', () => {
    // Same mix but an Issued Building Permit. fix-41 keeps the real
    // approved count (1✓, not the override's 3✓). fix-42: on a terminal
    // permit the lone corrections_required is necessarily resolved, so
    // the ⚠ is de-alarmed — it folds into the muted © group alongside
    // the in_process reviewer (1 corrections + 1 in_review = 2©).
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Anne-Marie', 'corrections_required'),
      makeReviewer('Tom', 'approved'),
      makeReviewer('Jane', 'in_process'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Issued"
        permitType="Building Permit"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-42');
    expect(chip.textContent).toContain('3'); // total unchanged
    expect(chip.textContent).toContain('1✓'); // real approved unchanged
    expect(chip.textContent).not.toContain('⚠'); // fix-42: de-alarmed
    expect(chip.textContent).toContain('2©'); // corrections folded into muted other
  });

  it('regression 7087867-DM: Issued Demolition mutes the resolved-corrections ⚠ (fix-42)', () => {
    // Verified case: 7087867-DM (Issued), 3 reviewers, 2 approved + Iris
    // Moore at corrections_required (an intake hold cleared on resubmit;
    // her Accela task just never closed). Chip → "3 · 2✓", no ⚠.
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Reviewer A', 'approved'),
      makeReviewer('Reviewer B', 'approved'),
      makeReviewer('Iris Moore', 'corrections_required'),
    ];
    render(
      <ReviewerRollupChip
        permitId={7087867}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Issued"
        permitType="Demolition"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-7087867');
    expect(chip.textContent).toContain('3'); // total unchanged
    expect(chip.textContent).toContain('2✓'); // approved unchanged
    expect(chip.textContent).not.toContain('⚠'); // resolved corrections de-alarmed
  });

  it('regression 7087866-CN: Issued Building Permit chip reads 14 / 8✓ (not 14✓)', () => {
    // fix-41 motivating bug. 14 reviewers: 8 approved / 4 assigned /
    // 1 in_process / 1 pending. The chip must show total 14, approved 8.
    const rows: PermitCycleReviewer[] = [
      ...Array.from({ length: 8 }, (_, i) => makeReviewer(`Appr${i}`, 'approved')),
      ...Array.from({ length: 4 }, (_, i) => makeReviewer(`Asgn${i}`, 'assigned')),
      makeReviewer('InProc', 'in_process'),
      makeReviewer('Pend', 'pending'),
    ];
    render(
      <ReviewerRollupChip
        permitId={7087866}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Issued"
        permitType="Building Permit"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-7087866');
    expect(chip.textContent).toContain('14'); // total
    expect(chip.textContent).toContain('8✓'); // real approved, NOT 14
    expect(chip.textContent).not.toContain('14✓');
  });

  it('non-terminal permitStatus leaves the ⚠ corrections pill visible', () => {
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Anne-Marie', 'corrections_required'),
      makeReviewer('Tom', 'approved'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Reviews In Process"
        permitType="Building Permit"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-42');
    expect(chip.textContent).toContain('1⚠');
  });

  it('renders the dim em-dash when there are no rows and no fallback', () => {
    const { container } = render(
      <ReviewerRollupChip permitId={42} rows={[]} fallbackReviewer={null} />,
    );
    expect(container.textContent).toContain('—');
    expect(screen.queryByTestId('reviewer-chip-42')).toBeNull();
    expect(screen.queryByTestId('reviewer-fallback-42')).toBeNull();
  });

  it('popover lists outstanding reviewers before approved ones (fix-43)', () => {
    // 2 approved + 1 corrections + 1 in_process. Outstanding (corrections,
    // in-review) must render above approved; within a group, alphabetical.
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Zoe Approved', 'approved'),
      makeReviewer('Amy Approved', 'approved'),
      makeReviewer('Carl Corrections', 'corrections_required'),
      makeReviewer('Ian InProcess', 'in_process'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Reviews In Process"
        permitType="Building Permit"
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const popover = screen.getByTestId('reviewer-popover-42');
    const order = Array.from(
      popover.querySelectorAll('[data-testid^="reviewer-row-"]'),
    ).map((el) => el.textContent ?? '');
    const idx = (name: string) => order.findIndex((t) => t.includes(name));
    // Every non-approved reviewer is above every approved one.
    expect(idx('Carl Corrections')).toBeLessThan(idx('Amy Approved'));
    expect(idx('Carl Corrections')).toBeLessThan(idx('Zoe Approved'));
    expect(idx('Ian InProcess')).toBeLessThan(idx('Amy Approved'));
    expect(idx('Ian InProcess')).toBeLessThan(idx('Zoe Approved'));
    // corrections rank above in-review.
    expect(idx('Carl Corrections')).toBeLessThan(idx('Ian InProcess'));
    // stable alphabetical within the approved group (Amy before Zoe).
    expect(idx('Amy Approved')).toBeLessThan(idx('Zoe Approved'));
  });

  it('popover header shows approved / corrections / outstanding breakdown (fix-43, fix-103)', () => {
    // fix-103: legend is now the 2-line breakdown from fix-95 — every
    // bucket renders explicitly, and outstanding = inReview + pending
    // (no longer the algebraic "total − approved" remainder).
    const rows: PermitCycleReviewer[] = [
      makeReviewer('A', 'approved'),
      makeReviewer('B', 'approved'),
      makeReviewer('C', 'corrections_required'),
      makeReviewer('D', 'in_process'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Reviews In Process"
        permitType="Building Permit"
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const legend = screen.getByTestId('reviewer-legend-42');
    expect(legend.textContent).toContain('4 reviewers');
    expect(legend.textContent).toContain('2 approved');
    expect(legend.textContent).toContain('1 corrections');
    expect(legend.textContent).toContain('1 outstanding'); // in_review + pending
  });

  it('popover legend shows "0 corrections" on terminal permits — the muted reviewers fold into outstanding (fix-42 / fix-103)', () => {
    // Issued Building Permit: the corrections reviewer is resolved
    // (fix-42 mutes the ⚠ on the chip). fix-103 now shows "0
    // corrections" explicitly in the legend and adds that reviewer to
    // outstanding so the three numbers still sum to the displayed
    // total.
    const rows: PermitCycleReviewer[] = [
      makeReviewer('A', 'approved'),
      makeReviewer('B', 'approved'),
      makeReviewer('C', 'corrections_required'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Issued"
        permitType="Building Permit"
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const legend = screen.getByTestId('reviewer-legend-42');
    expect(legend.textContent).toContain('3 reviewers');
    expect(legend.textContent).toContain('2 approved');
    expect(legend.textContent).toContain('0 corrections'); // muted → explicit zero
    expect(legend.textContent).toContain('1 outstanding'); // muted folds in
  });

  it('popover prefixes the discipline (slot) to the reviewer name when present (fix-44)', () => {
    // Slot data: each row carries its discipline + current assignee. The
    // popover row reads "Energy — Stephen Rudolph". Lights up once PR2 flows.
    const rows: PermitCycleReviewer[] = [
      { ...makeReviewer('Stephen Rudolph', 'approved'), discipline: 'Energy' },
    ];
    render(
      <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const row = screen
      .getByTestId('reviewer-popover-42')
      .querySelector('[data-testid^="reviewer-row-"]') as HTMLElement;
    expect(row.textContent).toContain('Energy — Stephen Rudolph');
  });

  it('popover renders the bare reviewer name when discipline is null (fix-44)', () => {
    // Current production data: discipline NULL everywhere → render as before,
    // no slot prefix / em-dash in the row.
    const rows: PermitCycleReviewer[] = [
      makeReviewer('Stephen Rudolph', 'approved'), // discipline: null
    ];
    render(
      <ReviewerRollupChip permitId={42} rows={rows} fallbackReviewer={null} />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-42'));
    const row = screen
      .getByTestId('reviewer-popover-42')
      .querySelector('[data-testid^="reviewer-row-"]') as HTMLElement;
    expect(row.textContent).toContain('Stephen Rudolph');
    expect(row.textContent).not.toContain('—'); // no slot prefix
    expect(row.textContent).not.toContain('Energy');
  });

  it('chip segments expose title tooltips (fix-43)', () => {
    // total 3 · 1 approved · 1 corrections · 1 in_process (non-terminal so
    // corrections shows; © = inReview 1 + pending 0 = 1 outstanding).
    const rows: PermitCycleReviewer[] = [
      makeReviewer('A', 'approved'),
      makeReviewer('B', 'corrections_required'),
      makeReviewer('C', 'in_process'),
    ];
    render(
      <ReviewerRollupChip
        permitId={42}
        rows={rows}
        fallbackReviewer={null}
        permitStatus="Reviews In Process"
        permitType="Building Permit"
      />,
    );
    const chip = screen.getByTestId('reviewer-chip-42');
    expect(chip.querySelector('[title="3 reviewers — cycle 1"]')).not.toBeNull();
    expect(chip.querySelector('[title="1 approved"]')).not.toBeNull();
    expect(
      chip.querySelector('[title="1 corrections required"]'),
    ).not.toBeNull();
    expect(
      chip.querySelector(
        '[title="1 outstanding (in review / assigned / pending)"]',
      ),
    ).not.toBeNull();
  });

  // ===========================================================
  // fix-64: viewport-aware popup positioning.
  //
  // Pre-fix the popover used a hardcoded maxHeight:320 + (rect.top +
  // window.scrollY) anchor on a position:fixed element. A chip on a low
  // row clipped the bottom of the list (Bobby: "6 reviewers shows only
  // ~5") and a scrolled page pushed the popup further out of place.
  // The fix routes through useViewportAwarePopover which caps maxHeight
  // to viewport-available space, flips above when below doesn't fit, and
  // uses raw rect.top (no scrollY) since fixed coords are viewport-
  // relative anyway. Exact pixel positioning is fragile to assert in
  // jsdom (the layout engine doesn't paint), so these tests pin
  // contracts that DO survive without painting:
  //   - container carries position:fixed + a numeric top/left
  //   - maxHeight + overflowY:auto are on the container (long list scrolls)
  //   - all reviewer rows are in the DOM (scrollable, NOT truncated)
  //   - placement flips when the trigger is near the bottom of the
  //     viewport: top + maxHeight stays inside the viewport.
  // ===========================================================

  function stubTriggerRect(rect: Partial<DOMRect>) {
    // RTL doesn't paint, so Element.getBoundingClientRect returns zeros
    // by default. Stub it on HTMLButtonElement.prototype so the chip's
    // ref reads the staged geometry when the hook measures.
    const full = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect;
    return vi
      .spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(full);
  }

  function setViewport(w: number, h: number) {
    // jsdom lets these be assigned directly.
    Object.defineProperty(window, 'innerWidth', {
      value: w,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: h,
      writable: true,
      configurable: true,
    });
  }

  it('popover container carries position:fixed + maxHeight + overflowY:auto', () => {
    setViewport(1280, 800);
    const restore = stubTriggerRect({
      top: 100,
      left: 200,
      right: 240,
      bottom: 116,
      width: 40,
      height: 16,
    });
    try {
      const rows = Array.from({ length: 8 }, (_, i) =>
        makeReviewer(`R${i + 1}`, 'corrections_required'),
      );
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const pop = screen.getByTestId('reviewer-popover-42') as HTMLDivElement;
      expect(pop.style.position).toBe('fixed');
      expect(pop.style.overflowY).toBe('auto');
      // Inline maxHeight must be a finite pixel value (number → px).
      expect(pop.style.maxHeight).toMatch(/^\d+px$/);
      // width too — pinned at 260 in the chip's hook call.
      expect(pop.style.width).toBe('260px');
    } finally {
      restore.mockRestore();
    }
  });

  it('renders every reviewer in the DOM even with a long list (scroll, not truncate)', () => {
    setViewport(1280, 800);
    const restore = stubTriggerRect({
      top: 100,
      left: 200,
      right: 240,
      bottom: 116,
      width: 40,
      height: 16,
    });
    try {
      // 12 reviewers — enough to exceed any reasonable maxHeight. The
      // contract is "all rows in the DOM, container scrolls internally."
      const rows: PermitCycleReviewer[] = Array.from({ length: 12 }, (_, i) =>
        makeReviewer(`Reviewer-${i + 1}`, 'corrections_required'),
      );
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const pop = screen.getByTestId('reviewer-popover-42');
      // Each reviewer row should be queryable.
      for (let i = 1; i <= 12; i++) {
        expect(pop.textContent).toContain(`Reviewer-${i}`);
      }
      // And the count rows / total still match the input.
      expect(pop.querySelectorAll('[data-testid^="reviewer-row-"]').length).toBe(
        12,
      );
    } finally {
      restore.mockRestore();
    }
  });

  it('flips upward when the trigger is near the bottom of the viewport (popup stays on-screen)', () => {
    // Tall popup (12 reviewers → maxHeight 320 cap kicks in), chip 50px
    // from the bottom of an 800px viewport. Pre-fix the popup would have
    // had top ≈ 750 + maxHeight 320 = bottom ≈ 1070 (270px off-screen).
    // Post-fix: top + maxHeight ≤ viewport.height - margin.
    setViewport(1280, 800);
    const restore = stubTriggerRect({
      top: 750,
      left: 200,
      right: 240,
      bottom: 766,
      width: 40,
      height: 16,
    });
    try {
      const rows = Array.from({ length: 12 }, (_, i) =>
        makeReviewer(`R${i + 1}`, 'corrections_required'),
      );
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const pop = screen.getByTestId('reviewer-popover-42') as HTMLDivElement;
      const top = parseFloat(pop.style.top);
      const maxH = parseFloat(pop.style.maxHeight);
      // Both must be finite numbers + the popup's bottom edge must lie
      // within the viewport's inner area (minus the hook's default 8px
      // margin). margin=8 → bottom_limit = 800 - 8 = 792.
      expect(Number.isFinite(top)).toBe(true);
      expect(Number.isFinite(maxH)).toBe(true);
      expect(top + maxH).toBeLessThanOrEqual(792);
      // And the top should ALSO be on screen.
      expect(top).toBeGreaterThanOrEqual(8);
    } finally {
      restore.mockRestore();
    }
  });

  it('does NOT add window.scrollY to the popup top (fixed coords are viewport-relative)', () => {
    // Pre-fix bug: setAnchor({ top: rect.top + window.scrollY, ... }) on
    // a position:fixed element pushed the popup down by scrollY pixels.
    setViewport(1280, 800);
    // Simulate a scrolled page. The chip's *visible* top is 100 (rect.top
    // already accounts for scroll); the popup's top must equal rect.top,
    // NOT rect.top + scrollY = 100 + 500 = 600.
    Object.defineProperty(window, 'scrollY', {
      value: 500,
      writable: true,
      configurable: true,
    });
    const restore = stubTriggerRect({
      top: 100,
      left: 200,
      right: 240,
      bottom: 116,
      width: 40,
      height: 16,
    });
    try {
      const rows = [makeReviewer('Solo', 'approved')];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const pop = screen.getByTestId('reviewer-popover-42') as HTMLDivElement;
      const top = parseFloat(pop.style.top);
      // top should be near 100 (rect.top), not near 600 (rect.top + scrollY).
      expect(top).toBeLessThan(200);
    } finally {
      restore.mockRestore();
      Object.defineProperty(window, 'scrollY', {
        value: 0,
        writable: true,
        configurable: true,
      });
    }
  });

  it('clamps horizontally when the trigger is near the viewport right edge', () => {
    // 1280×800 viewport; trigger at right=1270 means the preferred
    // (right-of-trigger) placement (1270 + 6 + 260 = 1536) overflows.
    // Hook should flip to the left of the trigger or pin to margin.
    setViewport(1280, 800);
    const restore = stubTriggerRect({
      top: 100,
      left: 1230,
      right: 1270,
      bottom: 116,
      width: 40,
      height: 16,
    });
    try {
      const rows = [makeReviewer('Edge', 'approved')];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const pop = screen.getByTestId('reviewer-popover-42') as HTMLDivElement;
      const left = parseFloat(pop.style.left);
      const width = parseFloat(pop.style.width);
      // Popup must fit inside the viewport (with the 8px margin).
      expect(left + width).toBeLessThanOrEqual(1272);
      expect(left).toBeGreaterThanOrEqual(8);
    } finally {
      restore.mockRestore();
    }
  });

  // ===========================================================
  // fix-103: popover legend mirrors fix-95's PermitMiniTable cell —
  // 2-line stacked breakdown (total / approved · corrections ·
  // outstanding), total excludes not_required reviewers, zeros
  // render explicitly.
  // ===========================================================
  describe('fix-103 popover breakdown', () => {
    it('total excludes not_required reviewers (3 approved + 2 corrections + 1 in_review + 2 not_required → 6 reviewers)', () => {
      const rows: PermitCycleReviewer[] = [
        makeReviewer('A1', 'approved'),
        makeReviewer('A2', 'approved'),
        makeReviewer('A3', 'approved'),
        makeReviewer('C1', 'corrections_required'),
        makeReviewer('C2', 'corrections_required'),
        makeReviewer('I1', 'in_review'),
        makeReviewer('N1', 'not_required'),
        makeReviewer('N2', 'not_required'),
      ];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
          permitStatus="Reviews In Process"
          permitType="Building Permit"
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const legend = screen.getByTestId('reviewer-legend-42');
      // Line 1: 8 rows total − 2 not_required = 6.
      expect(legend.textContent).toContain('6 reviewers');
      // Line 2: 3 approved · 2 corrections · 1 outstanding (in_review).
      expect(legend.textContent).toContain('3 approved');
      expect(legend.textContent).toContain('2 corrections');
      expect(legend.textContent).toContain('1 outstanding');
    });

    it('zeros render explicitly when a bucket is empty (4 approved, 0 corrections, 0 outstanding)', () => {
      // Bobby's "completion" signal: a permit with 4 approved + nothing
      // else should read "4 reviewers / 4 approved · 0 corrections · 0
      // outstanding". Auto-hiding zero buckets would make the legend
      // ambiguous (is the bucket stale? unconfigured?).
      const rows: PermitCycleReviewer[] = [
        makeReviewer('A1', 'approved'),
        makeReviewer('A2', 'approved'),
        makeReviewer('A3', 'approved'),
        makeReviewer('A4', 'approved'),
      ];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
          permitStatus="Reviews In Process"
          permitType="Building Permit"
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const legend = screen.getByTestId('reviewer-legend-42');
      expect(legend.textContent).toContain('4 reviewers');
      expect(legend.textContent).toContain('4 approved');
      expect(legend.textContent).toContain('0 corrections');
      expect(legend.textContent).toContain('0 outstanding');
    });

    it('empty state (no rows): chip renders the dim em-dash and the popover never opens', () => {
      // The chip's empty-state UX is unchanged by fix-103 — counts.total
      // === 0 short-circuits to the legacy fallback / dash. The popover
      // (and its breakdown) doesn't render at all.
      const { container } = render(
        <ReviewerRollupChip permitId={42} rows={[]} fallbackReviewer={null} />,
      );
      expect(container.textContent).toContain('—');
      expect(screen.queryByTestId('reviewer-chip-42')).toBeNull();
      expect(screen.queryByTestId('reviewer-popover-42')).toBeNull();
      expect(screen.queryByTestId('reviewer-legend-42')).toBeNull();
    });

    it('color tokens land on the right buckets (text-pm approved, text-co corrections, text-dim outstanding)', () => {
      // Tailwind utility classes — verifies the breakdown row carries
      // the fix-95 palette so the two surfaces (Project View cell +
      // Schedule Health popover) read the same colors at a glance.
      const rows: PermitCycleReviewer[] = [
        makeReviewer('A', 'approved'),
        makeReviewer('B', 'corrections_required'),
        makeReviewer('C', 'pending'),
      ];
      render(
        <ReviewerRollupChip
          permitId={42}
          rows={rows}
          fallbackReviewer={null}
          permitStatus="Reviews In Process"
          permitType="Building Permit"
        />,
      );
      fireEvent.click(screen.getByTestId('reviewer-chip-42'));
      const breakdown = screen.getByTestId('reviewer-breakdown-42');
      const spans = breakdown.querySelectorAll('span');
      const approved = Array.from(spans).find((s) =>
        s.textContent?.includes('approved'),
      );
      const corrections = Array.from(spans).find((s) =>
        s.textContent?.includes('corrections'),
      );
      const outstanding = Array.from(spans).find((s) =>
        s.textContent?.includes('outstanding'),
      );
      expect(approved?.className).toContain('text-pm');
      expect(corrections?.className).toContain('text-co');
      expect(outstanding?.className).toContain('text-dim');
    });
  });
});
