import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReviewerRollupChip from '../components/ProjectDetail/ReviewerRollupChip';
import InlineErrorBoundary from '../components/InlineErrorBoundary';
import {
  compareReviewerNames,
  UNASSIGNED_REVIEWER_LABEL,
} from '../lib/reviewerRollup';
import type {
  PermitCycleReviewer,
  ReviewerStatus,
} from '../lib/database.types';

vi.mock('../lib/errorLogger', () => ({ logError: vi.fn() }));

// fix-260: nameless reviewer slots are CORRECT DATA, not a scraper defect. 93
// slots across 38 permits on prod carry reviewer_name = null, and many are
// process steps with no assignee at all — "Appeal Period", "Wrap-up", "MUP
// Processing", "Design Review Meeting and Report". They must render, never
// crash, and never be filtered out of the popover.
//
// The crash itself (a bare .localeCompare inside Array.sort) was fixed in
// fix-251; these tests pin the exact prod shape that was reported, and add the
// ordering guarantee fix-260 introduces for cycles carrying MORE THAN ONE
// nameless slot (16 such cycles on prod).

function reviewer(
  reviewer_name: string | null,
  discipline: string | null,
  current_status: ReviewerStatus,
  cycle_index = 1,
): PermitCycleReviewer {
  return {
    id: `r-${reviewer_name ?? 'null'}-${discipline ?? ''}-${cycle_index}`,
    tenant_id: 'tenant-0',
    permit_id: 10380,
    cycle_index,
    reviewer_name,
    discipline,
    current_status,
    last_event_date: '2026-07-20',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

/** PPR 7112368-CN-008 (permit 10380), cycle 1, exactly as it sits on prod:
 *  five slots, four named, the Housing slot nameless. */
const CN008: PermitCycleReviewer[] = [
  reviewer('Cary Novotney', 'Energy', 'assigned'),
  reviewer(null, 'Housing', 'corrections_required'),
  reviewer('David Sachs', 'Mandatory Housing Affordability', 'corrections_required'),
  reviewer('Samuel Han', 'Ordinance/Structural', 'corrections_required'),
  reviewer('David Sachs', 'Zoning', 'corrections_required'),
];

function openPopover(rows: PermitCycleReviewer[]) {
  render(
    <ReviewerRollupChip permitId={10380} rows={rows} fallbackReviewer={null} />,
  );
  fireEvent.click(screen.getByTestId('reviewer-chip-10380'));
  return screen.getByTestId('reviewer-popover-10380');
}

describe('fix-260: ReviewerRollupChip with null reviewer_name', () => {
  it('renders and opens the 7112368-CN-008 shape without throwing', () => {
    render(
      <ReviewerRollupChip permitId={10380} rows={CN008} fallbackReviewer={null} />,
    );
    // The reported repro: chip renders, then clicking it used to throw
    // "Cannot read properties of null (reading 'localeCompare')".
    expect(() =>
      fireEvent.click(screen.getByTestId('reviewer-chip-10380')),
    ).not.toThrow();
    expect(screen.getByTestId('reviewer-popover-10380')).toBeTruthy();
  });

  it('keeps the nameless slot visible, with its discipline', () => {
    const popover = openPopover(CN008);
    // Not filtered out — the slot exists, the city just hasn't named anyone.
    expect(popover.textContent).toContain('Housing');
    expect(popover.textContent).toContain(UNASSIGNED_REVIEWER_LABEL);
    // All five slots present.
    for (const name of ['Cary Novotney', 'David Sachs', 'Samuel Han']) {
      expect(popover.textContent).toContain(name);
    }
  });

  it('renders when EVERY reviewer_name is null', () => {
    const allNull = [
      reviewer(null, 'Appeal Period', 'pending'),
      reviewer(null, 'Wrap-up', 'pending'),
      reviewer(null, 'MUP Processing', 'pending'),
    ];
    expect(() => openPopover(allNull)).not.toThrow();
    const popover = screen.getByTestId('reviewer-popover-10380');
    expect(popover.textContent).toContain('Appeal Period');
    expect(popover.textContent).toContain('Wrap-up');
    expect(popover.textContent).toContain('MUP Processing');
  });

  it('sorts nameless slots last within their status group', () => {
    const rows = [
      reviewer(null, 'Housing', 'corrections_required'),
      reviewer('Zoe Adams', 'Zoning', 'corrections_required'),
      reviewer('Aaron Blunt', 'Energy', 'corrections_required'),
    ];
    const text = openPopover(rows).textContent ?? '';
    expect(text.indexOf('Aaron Blunt')).toBeLessThan(text.indexOf('Zoe Adams'));
    expect(text.indexOf('Zoe Adams')).toBeLessThan(
      text.indexOf(UNASSIGNED_REVIEWER_LABEL),
    );
  });
});

describe('fix-260: comparator', () => {
  it('orders two nameless slots by discipline instead of arbitrarily', () => {
    // 16 cycles on prod carry more than one nameless slot. Before fix-260 this
    // returned 0 and left them in fetch order.
    const rows = [
      { reviewer_name: null, discipline: 'Wrap-up' },
      { reviewer_name: null, discipline: 'Appeal Period' },
      { reviewer_name: null, discipline: 'MUP Processing' },
    ];
    expect([...rows].sort(compareReviewerNames).map((r) => r.discipline)).toEqual(
      ['Appeal Period', 'MUP Processing', 'Wrap-up'],
    );
  });

  it('treats a null discipline on a nameless slot as empty, not a crash', () => {
    const rows = [
      { reviewer_name: null, discipline: null },
      { reviewer_name: null, discipline: 'Appeal Period' },
    ];
    expect(() => [...rows].sort(compareReviewerNames)).not.toThrow();
    expect([...rows].sort(compareReviewerNames)[0].discipline).toBeNull();
  });

  it('leaves all-named ordering byte-identical', () => {
    // Regression lock: the named path must be untouched by fix-260.
    const rows = [
      { reviewer_name: 'Samuel Han', discipline: 'Ordinance/Structural' },
      { reviewer_name: 'Cary Novotney', discipline: 'Energy' },
      { reviewer_name: 'David Sachs', discipline: 'Zoning' },
    ];
    expect([...rows].sort(compareReviewerNames).map((r) => r.reviewer_name)).toEqual(
      ['Cary Novotney', 'David Sachs', 'Samuel Han'],
    );
  });

  it('still puts any named slot ahead of any nameless one', () => {
    expect(
      compareReviewerNames(
        { reviewer_name: null, discipline: 'AAA' },
        { reviewer_name: 'Zzz', discipline: 'ZZZ' },
      ),
    ).toBe(1);
  });
});

describe('fix-260: InlineErrorBoundary', () => {
  function Boom(): never {
    throw new Error('boom');
  }

  it('catches a throwing child and renders the inline fallback', () => {
    // React logs the caught error; silence it so the run stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <InlineErrorBoundary label="reviewers" testId="chip-fallback">
        <Boom />
      </InlineErrorBoundary>,
    );
    expect(screen.getByTestId('chip-fallback').textContent).toContain(
      'reviewers unavailable',
    );
    spy.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <InlineErrorBoundary label="reviewers">
        <span data-testid="ok">fine</span>
      </InlineErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
    expect(screen.queryByTestId('inline-error-boundary-fallback')).toBeNull();
  });
});
