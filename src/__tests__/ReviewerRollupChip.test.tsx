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

  it('renders the dim em-dash when there are no rows and no fallback', () => {
    const { container } = render(
      <ReviewerRollupChip permitId={42} rows={[]} fallbackReviewer={null} />,
    );
    expect(container.textContent).toContain('—');
    expect(screen.queryByTestId('reviewer-chip-42')).toBeNull();
    expect(screen.queryByTestId('reviewer-fallback-42')).toBeNull();
  });
});
