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

  it('terminal-positive + issuance-bearing type shows REAL counts incl. ⚠ (fix-41)', () => {
    // Same mix but an Issued Building Permit — fix-41 drops the override
    // so the genuine per-reviewer status shows: 1✓, 1⚠, 1© (in_review).
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
    expect(chip.textContent).toContain('3');
    expect(chip.textContent).toContain('1✓');
    expect(chip.textContent).toContain('1⚠');
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
});
