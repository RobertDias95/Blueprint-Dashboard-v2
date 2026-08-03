import { describe, it, expect } from 'vitest';
import {
  PERMIT_TASK_AUDIT_FIELDS,
  permitTaskAuditShouldWrite,
  buildPermitTaskAuditRow,
  changedAuditFields,
  type WatchedTaskFields,
} from '../lib/permitTaskAudit';

// fix-272: the pure mirror of bp_audit_permit_task (see
// migrations/fix_272_permit_task_audit.sql). CI has no live database, so this
// mirror IS the tested contract — the fix-153 pattern.
//
// The point of the table: user_activity already records WHICH permit_tasks
// fields changed, so the COUNT of consultant date moves is answerable today.
// It does not record the VALUES, so "3 changes and 15 days delay" is lost the
// moment it happens. Capture now, report later.

function row(over: Partial<WatchedTaskFields> = {}): WatchedTaskFields {
  return {
    target_date: '2026-08-15',
    start_date: '2026-07-27',
    completion_status: 'In Progress',
    waiting_on: 'Structural',
    ...over,
  };
}

describe('fix-272 the watched fields', () => {
  it('is exactly the four that describe consultant turnaround', () => {
    // Pinned: widening this silently would change what the slippage metric
    // means, and narrowing it would lose data that cannot be recovered later.
    expect([...PERMIT_TASK_AUDIT_FIELDS]).toEqual([
      'target_date',
      'start_date',
      'completion_status',
      'waiting_on',
    ]);
  });
});

describe('fix-272 the early-return guard', () => {
  it.each([
    ['target_date', { target_date: '2026-08-22' }],
    ['start_date', { start_date: '2026-07-28' }],
    ['completion_status', { completion_status: 'Resolved' }],
    ['waiting_on', { waiting_on: 'Surveyor' }],
  ])('a %s change writes a row', (_label, patch) => {
    expect(permitTaskAuditShouldWrite('UPDATE', row(), row(patch))).toBe(true);
  });

  it('an edit touching NONE of the four writes NOTHING', () => {
    // The guard. On prod this is 126 of 762 logged updates — notes,
    // assigned_to, priority, sort_order, co_assignees and so on.
    const before = row();
    const after = row(); // identical watched slice; something else moved
    expect(permitTaskAuditShouldWrite('UPDATE', before, after)).toBe(false);
    expect(changedAuditFields(before, after)).toEqual([]);
  });

  it('is idempotent — re-saving identical values writes nothing', () => {
    expect(permitTaskAuditShouldWrite('UPDATE', row(), row())).toBe(false);
  });

  it('treats NULL vs NULL as unchanged (SQL IS DISTINCT FROM, not JS ==)', () => {
    const blank = row({ target_date: null, start_date: null });
    expect(permitTaskAuditShouldWrite('UPDATE', blank, row(blank))).toBe(false);
  });

  it.each([
    ['null → value', null, '2026-08-15'],
    ['value → null', '2026-08-15', null],
  ])('treats %s as a change', (_label, from, to) => {
    // Setting the first promise, and clearing one, are both real events.
    expect(
      permitTaskAuditShouldWrite(
        'UPDATE',
        row({ target_date: from }),
        row({ target_date: to }),
      ),
    ).toBe(true);
  });

  it('INSERT and DELETE always write, guard or no guard', () => {
    expect(permitTaskAuditShouldWrite('INSERT', null, row())).toBe(true);
    expect(permitTaskAuditShouldWrite('DELETE', row(), null)).toBe(true);
  });
});

describe('fix-272 the captured row', () => {
  it('a target_date move records both old and new — the magnitude user_activity loses', () => {
    const r = buildPermitTaskAuditRow(
      'UPDATE',
      row({ target_date: '2026-01-15' }),
      row({ target_date: '2026-01-30' }),
    );
    expect(r.target_date_from).toBe('2026-01-15');
    expect(r.target_date_to).toBe('2026-01-30');
  });

  it('MULTIPLE watched fields in one UPDATE produce ONE row with all pairs', () => {
    // Marking a task started writes completion_status AND — via the fix-268
    // trigger — start_date, in the same statement. That is one event.
    const r = buildPermitTaskAuditRow(
      'UPDATE',
      row({ completion_status: 'Open', start_date: null }),
      row({ completion_status: 'In Progress', start_date: '2026-08-03' }),
    );
    expect(r.completion_status_from).toBe('Open');
    expect(r.completion_status_to).toBe('In Progress');
    expect(r.start_date_from).toBeNull();
    expect(r.start_date_to).toBe('2026-08-03');
    expect(changedAuditFields(
      row({ completion_status: 'Open', start_date: null }),
      row({ completion_status: 'In Progress', start_date: '2026-08-03' }),
    )).toEqual(['start_date', 'completion_status']);
  });

  it('carries the UNCHANGED pairs too, so a reader needs no join for context', () => {
    const r = buildPermitTaskAuditRow(
      'UPDATE',
      row({ target_date: '2026-08-15' }),
      row({ target_date: '2026-08-22' }),
    );
    // waiting_on did not move, but it is on the row — which consultant this
    // slippage belongs to is the whole point of capturing it.
    expect(r.waiting_on_from).toBe('Structural');
    expect(r.waiting_on_to).toBe('Structural');
  });

  it('INSERT has null FROMs — nothing preceded it', () => {
    const r = buildPermitTaskAuditRow('INSERT', null, row({ target_date: null }));
    for (const f of PERMIT_TASK_AUDIT_FIELDS) {
      expect(r[`${f}_from` as keyof typeof r], `${f}_from`).toBeNull();
    }
    expect(r.waiting_on_to).toBe('Structural');
    // The templates create tasks with a NULL target_date, so the "original
    // promise" is the first UPDATE to a non-null value, never the INSERT.
    expect(r.target_date_to).toBeNull();
  });

  it('DELETE has null TOs — nothing follows it', () => {
    const r = buildPermitTaskAuditRow('DELETE', row(), null);
    for (const f of PERMIT_TASK_AUDIT_FIELDS) {
      expect(r[`${f}_to` as keyof typeof r], `${f}_to`).toBeNull();
    }
    expect(r.target_date_from).toBe('2026-08-15');
  });

  it('records the op on every row', () => {
    expect(buildPermitTaskAuditRow('INSERT', null, row()).op).toBe('INSERT');
    expect(buildPermitTaskAuditRow('UPDATE', row(), row()).op).toBe('UPDATE');
    expect(buildPermitTaskAuditRow('DELETE', row(), null).op).toBe('DELETE');
  });
});

describe('fix-272 the slippage question this makes answerable', () => {
  it('a four-step target slide is four rows whose deltas sum to the total delay', () => {
    // Bobby's example: 1.15 → 1.20 → 1.25 → 1.30 = 3 changes, 15 days.
    const promises = ['2026-01-15', '2026-01-20', '2026-01-25', '2026-01-30'];
    const rows = promises.slice(0, -1).map((from, i) =>
      buildPermitTaskAuditRow(
        'UPDATE',
        row({ target_date: from }),
        row({ target_date: promises[i + 1] }),
      ),
    );
    expect(rows).toHaveLength(3);

    const days = (a: string, b: string) =>
      (Date.parse(b) - Date.parse(a)) / 86_400_000;
    const total = rows.reduce(
      (sum, r) => sum + days(r.target_date_from!, r.target_date_to!),
      0,
    );
    expect(total).toBe(15);
    // ...and every row knows which consultant it belongs to.
    expect(new Set(rows.map((r) => r.waiting_on_to))).toEqual(
      new Set(['Structural']),
    );
  });
});
