import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithQuery } from '../test/renderWithQuery';
import ReviewerRollupChip from '../components/ProjectDetail/ReviewerRollupChip';
import type { ReviewerEstimate } from '../lib/reviewerDueEstimate';
import type { PermitCycleReviewer, ReviewerStatus } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-667 (P-349) — the reviewer popup shows everything
// ===========================================================================
//
// Bobby, 10-13 (screenshot "REVIEWERS — CYCLE 5"): "the discipline, reviewer
// and status are not all fully visible." A row was ONE line — the name
// truncated, beside a right column holding status + date + fix-640's due line,
// so "row — Casandra Courtillet" read "row — Cas…".
//
// Now a row is two lines: dot · discipline — name (wraps) · STATUS on line 1;
// the date and the due line on line 2, under the name. Nothing truncates.
//
// The longest real values on prod (measured 2026-10-13): discipline "Send
// Documents to DoE/Attorney General" (38), names "Saranya Gujuluva Rajan" /
// "Anne-Marie Freudenthal" (22), status label "Not Required".

const LONG_DISCIPLINE = 'Send Documents to DoE/Attorney General';
const LONG_NAME = 'Saranya Gujuluva Rajan';

let estimates: ReviewerEstimate[] = [];
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (_fn: string, args: { p_ids: string[] }) =>
      Promise.resolve({
        data: estimates.filter((e) => args.p_ids.includes(e.reviewer_id)),
        error: null,
      }),
  },
}));

function reviewer(
  id: string,
  status: ReviewerStatus,
  name: string,
  discipline: string,
  last: string | null,
): PermitCycleReviewer {
  return {
    id, tenant_id: 't', permit_id: 9, cycle_index: 5, reviewer_name: name,
    discipline, current_status: status, last_event_date: last,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', target_date: null,
  };
}

const EST: Omit<ReviewerEstimate, 'reviewer_id' | 'estimated_due'> = {
  round_start: '2026-09-20', basis_level: 1, window_tier: 'all', juris: 'Seattle',
  discipline: 'row', permit_type: 'Building Permit', round_label: 'round 2+',
  typical_days: 21, sample_n: 34,
};

describe('fix-667: every piece of a reviewer row is readable', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
    estimates = [
      { ...EST, reviewer_id: 'long', estimated_due: '2026-10-03' },
      { ...EST, reviewer_id: 'shot', estimated_due: '2026-10-03' },
    ];
  });
  afterEach(() => vi.useRealTimers());

  function open() {
    renderWithQuery(
      <ReviewerRollupChip
        permitId={9}
        rows={[
          reviewer('long', 'in_review', LONG_NAME, LONG_DISCIPLINE, '2026-09-20'),
          // The screenshot's row.
          reviewer('shot', 'in_review', 'Casandra Courtillet', 'row', '2026-09-22'),
          reviewer('done', 'not_required', 'Anne-Marie Freudenthal', 'Transportation Street Improvement', '2026-10-02'),
        ]}
        fallbackReviewer={null}
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-9'));
  }

  it('★★★ the discipline + name line does NOT truncate (it wraps)', () => {
    open();
    const row = screen.getByTestId('reviewer-row-long');
    const name = within(row).getByTitle(`${LONG_DISCIPLINE} — ${LONG_NAME}`);
    expect(name.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    expect(name.className).toContain('break-words');
    expect(name.textContent).toBe(`${LONG_DISCIPLINE} — ${LONG_NAME}`);
  });

  it('★★★ all four pieces render: discipline, name, status, and the past-due estimate', async () => {
    open();
    const due = await screen.findByTestId('reviewer-due-long');
    const row = screen.getByTestId('reviewer-row-long');
    expect(row.textContent).toContain(LONG_DISCIPLINE);
    expect(row.textContent).toContain(LONG_NAME);
    expect(within(row).getByTestId('reviewer-status-long').textContent).toBe('In Review');
    expect(within(row).getByTestId('reviewer-date-long').textContent).toBe('2026-09-20');
    expect(due.textContent).toBe('~Due 10/03/2026 (est.) · past due');
    // Colour + italics kept from fix-640.
    expect(due.className).toContain('italic');
    expect(due.style.color).toContain('--color-wa');
  });

  it('★★ line 1 is name + status; line 2 (under the name) is the date and the due line', async () => {
    open();
    await screen.findByTestId('reviewer-due-shot');
    const line1 = screen.getByTestId('reviewer-line1-shot');
    const line2 = screen.getByTestId('reviewer-line2-shot');
    expect(line1.textContent).toContain('row — Casandra Courtillet');
    expect(within(line1).getByTestId('reviewer-status-shot')).toBeTruthy();
    expect(within(line2).getByTestId('reviewer-date-shot')).toBeTruthy();
    expect(within(line2).getByTestId('reviewer-due-shot')).toBeTruthy();
    // ★ The status never shrinks away and the second line wraps rather than clip.
    expect(screen.getByTestId('reviewer-status-shot').className).toContain('flex-shrink-0');
    expect(line2.className).toContain('flex-wrap');
  });

  it('★★ a closed reviewer has no line-2 due, and its status reads in full', () => {
    open();
    expect(screen.queryByTestId('reviewer-due-done')).toBeNull();
    expect(screen.getByTestId('reviewer-status-done').textContent).toBe('Not Required');
  });

  it('★★ the popover is still placed by the viewport hook, now 300px wide', () => {
    open();
    const pop = screen.getByTestId('reviewer-popover-9');
    expect(pop.style.position).toBe('fixed');
    expect(pop.style.width).toBe('300px');
    const src = readFileSync(
      resolve(__dirname, '../components/ProjectDetail/ReviewerRollupChip.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useViewportAwarePopover\(\{[\s\S]*?width: 300,/);
  });
});
