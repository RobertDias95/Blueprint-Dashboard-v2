import { describe, expect, it } from 'vitest';
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

  it('popover header shows approved / outstanding breakdown (fix-43)', () => {
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
    expect(legend.textContent).toContain('2 approved');
    expect(legend.textContent).toContain('2 outstanding'); // 4 total − 2 approved
    expect(legend.textContent).toContain('1 corrections'); // non-terminal → shown
  });

  it('popover legend drops corrections on terminal permits (fix-42/fix-43)', () => {
    // Issued Building Permit: the corrections reviewer is resolved (fix-42
    // mutes it on the chip), so the legend should not list corrections —
    // it folds into outstanding. approved/outstanding still mirror counts.
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
    expect(legend.textContent).toContain('2 approved');
    expect(legend.textContent).toContain('1 outstanding'); // 3 − 2
    expect(legend.textContent).not.toContain('corrections');
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
});
