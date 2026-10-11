import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQuery } from '../test/renderWithQuery';
import ReviewerRollupChip from '../components/ProjectDetail/ReviewerRollupChip';
import { reviewerDue } from '../lib/reviewerRollup';
import type { PermitCycleReviewer, ReviewerStatus } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-638 (P-333, P-334) — reviewer due dates · a border on every message
// ===========================================================================
//
// §A — Bobby, 2026-10-11, on "REVIEWERS — CYCLE 4": *"werent we going to be the
//      target review date of the reviewer below the in review?"*
//
// ★★★ THE TRAP THIS TICKET NEARLY FELL INTO. The popover's rows come from
//     `permit_cycle_reviewers_current` (fix-454) and that VIEW has no
//     `target_date` — the table does (measured 2026-10-11). A render that read
//     `r.target_date` off the view's rows would have shown nothing, forever,
//     and passed every test that built its fixture with the field filled in.
//     So the dates are asked of the TABLE by id, and the mock below answers the
//     TABLE — a fixture that put `target_date` on the row would prove nothing.

const tableCalls: { table: string; ids: string[] }[] = [];
let tableRows: { id: string; target_date: string | null }[] = [];

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          tableCalls.push({ table, ids });
          return Promise.resolve({
            data: tableRows.filter((r) => ids.includes(r.id)),
            error: null,
          });
        },
      }),
    }),
  },
}));

function reviewer(id: string, status: ReviewerStatus, last: string | null = null): PermitCycleReviewer {
  return {
    id,
    tenant_id: 't',
    permit_id: 7,
    cycle_index: 4,
    reviewer_name: `Reviewer ${id}`,
    discipline: null,
    current_status: status,
    last_event_date: last,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

describe('fix-638 §A — reviewerDue (pure)', () => {
  const TODAY = '2026-10-11';
  it('★★ an open reviewer with a date: "Due MM/DD/YYYY"', () => {
    for (const s of ['in_review', 'in_process', 'assigned', 'pending'] as const) {
      expect(reviewerDue(s, '2026-10-14', TODAY)).toEqual({ text: 'Due 10/14/2026', pastDue: false });
    }
  });
  it('★★★ past and still open: flagged', () => {
    expect(reviewerDue('in_review', '2026-10-09', TODAY))
      .toEqual({ text: 'Due 10/09/2026 · past due', pastDue: true });
    // due TODAY is not past due
    expect(reviewerDue('pending', '2026-10-11', TODAY)?.pastDue).toBe(false);
  });
  it('★★ no date → nothing (never invented)', () => {
    expect(reviewerDue('in_review', null, TODAY)).toBeNull();
    expect(reviewerDue('in_review', '', TODAY)).toBeNull();
  });
  it('★★ finished reviewers get no due line', () => {
    for (const s of ['approved', 'corrections_required', 'not_required'] as const) {
      expect(reviewerDue(s, '2026-10-01', TODAY)).toBeNull();
    }
  });
});

describe('fix-638 §A — the popover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0)); // local 2026-10-11
    tableCalls.length = 0;
    tableRows = [
      { id: 'open-future', target_date: '2026-10-14' },
      { id: 'open-past', target_date: '2026-10-09' },
      { id: 'open-none', target_date: null },
      { id: 'done', target_date: '2026-10-01' },
    ];
  });
  afterEach(() => vi.useRealTimers());

  function open() {
    renderWithQuery(
      <ReviewerRollupChip
        permitId={7}
        rows={[
          reviewer('open-future', 'in_review'),
          reviewer('open-past', 'pending'),
          reviewer('open-none', 'assigned'),
          reviewer('done', 'approved', '2026-10-05'),
        ]}
        fallbackReviewer={null}
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-7'));
  }

  it('★★★ shows "Due …" under an open reviewer, read from the TABLE', async () => {
    open();
    const due = await screen.findByTestId('reviewer-due-open-future');
    expect(due.textContent).toBe('Due 10/14/2026');
    expect(due.getAttribute('data-past-due')).toBe('false');
    // ★ asked of the table, for the OPEN rows only — never the approved one
    expect(tableCalls.every((c) => c.table === 'permit_cycle_reviewers')).toBe(true);
    expect(tableCalls.flatMap((c) => c.ids).sort()).toEqual(['open-future', 'open-none', 'open-past']);
  });

  it('★★★ past due and open → "· past due" in the warning colour', async () => {
    open();
    const due = await screen.findByTestId('reviewer-due-open-past');
    expect(due.textContent).toBe('Due 10/09/2026 · past due');
    expect(due.getAttribute('data-past-due')).toBe('true');
    expect(due.style.color).toContain('--color-wa');
  });

  it('★★ no date → no due line', async () => {
    open();
    await screen.findByTestId('reviewer-due-open-future');
    expect(screen.queryByTestId('reviewer-due-open-none')).toBeNull();
  });

  it('★★ approved is unchanged: its own date, no due line', async () => {
    open();
    await screen.findByTestId('reviewer-due-open-future');
    expect(screen.queryByTestId('reviewer-due-done')).toBeNull();
    expect(screen.getByTestId('reviewer-row-done').textContent).toContain('2026-10-05');
  });
});

describe('fix-638 §B — every chat message has a border', () => {
  const src = readFileSync(
    resolve(__dirname, '../components/ProjectDetail/ChatMessageRow.tsx'),
    'utf8',
  );

  it('★★★ the border is on the row root unconditionally — shaded or not', () => {
    // The root's className is a plain string literal, not a conditional, so
    // a shaded row and a white row carry the same border classes.
    expect(src).toContain('className="flex gap-2.5 border border-border"');
    // ★ and the negative margin that would make bordered neighbours touch is gone
    expect(src).not.toContain("margin: '-7px -9px'");
  });
});
