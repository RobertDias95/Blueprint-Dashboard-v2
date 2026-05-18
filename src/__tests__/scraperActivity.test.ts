import { describe, it, expect } from 'vitest';
import {
  categorizeAction,
  countUnread,
  formatRelativeTime,
  groupActivityByRun,
  parseCycleRowId,
  summarizeActivity,
} from '../lib/scraperActivity';
import type { ScraperActivityRow } from '../lib/database.types';

// fix-27: unit tests for the activity feed pure helpers. Components
// (NotificationBell) sit on top of these — keeping them deterministic
// keeps the UI predictable without DOM testing every action shape.

function mkRow(over: Partial<ScraperActivityRow> = {}): ScraperActivityRow {
  return {
    id: 1,
    created_at: '2026-05-18T18:00:00Z',
    action: 'scrape_change_applied',
    row_id: '100',
    changes: {},
    permit_num: 'BP-1',
    permit_type: 'Building Permit',
    address: '100 Main St',
    juris: 'Seattle',
    cycle_index: null,
    ...over,
  };
}

// ============================================================
// parseCycleRowId
// ============================================================
describe('parseCycleRowId', () => {
  it('parses well-formed cycle row_id', () => {
    expect(parseCycleRowId('318:cycle:1')).toEqual({
      permitId: 318,
      cycleIndex: 1,
    });
    expect(parseCycleRowId('99999:cycle:8')).toEqual({
      permitId: 99999,
      cycleIndex: 8,
    });
  });

  it('returns null for permit-only row_ids', () => {
    expect(parseCycleRowId('100')).toBeNull();
    expect(parseCycleRowId('342')).toBeNull();
  });

  it('returns null for null / empty / malformed', () => {
    expect(parseCycleRowId(null)).toBeNull();
    expect(parseCycleRowId(undefined)).toBeNull();
    expect(parseCycleRowId('')).toBeNull();
    expect(parseCycleRowId('318:cycle:')).toBeNull();
    expect(parseCycleRowId('318:cycle:0')).toBeNull(); // cycle 0 reserved
    expect(parseCycleRowId(':cycle:1')).toBeNull();
    expect(parseCycleRowId('318-cycle-1')).toBeNull();
  });
});

// ============================================================
// categorizeAction
// ============================================================
describe('categorizeAction', () => {
  it('maps known actions to expected buckets', () => {
    expect(categorizeAction('scrape_change_applied')).toBe('change');
    expect(categorizeAction('manual_admin_correction')).toBe('change');
    expect(categorizeAction('scrape_cycle_change_applied')).toBe('cycle');
    expect(categorizeAction('scrape_skipped_recent_manual_edit')).toBe(
      'skipped',
    );
    expect(categorizeAction('scrape_cycle_skipped_recent_manual_edit')).toBe(
      'skipped',
    );
    expect(categorizeAction('scrape_skipped')).toBe('skipped');
  });

  it('unknown actions fall into "other"', () => {
    expect(categorizeAction('scrape_cycle_disagreement')).toBe('other');
    expect(categorizeAction('something_new')).toBe('other');
  });
});

// ============================================================
// summarizeActivity — per action shape
// ============================================================
describe('summarizeActivity', () => {
  it('scrape_change_applied: status diff', () => {
    const row = mkRow({
      action: 'scrape_change_applied',
      changes: {
        db: { status: 'Reviews In Process' },
        applied: { status: 'Issued' },
      },
    });
    const phrases = summarizeActivity(row);
    expect(phrases.join(' | ')).toMatch(/Status: Reviews In Process → Issued/);
  });

  it('scrape_change_applied: approval_date set', () => {
    const row = mkRow({
      action: 'scrape_change_applied',
      changes: { applied: { approval_date: '2026-05-08' } },
    });
    expect(summarizeActivity(row).join('|')).toMatch(/Approved 2026-05-08/);
  });

  it('scrape_change_applied: extras.latest_reviewer surfaces', () => {
    const row = mkRow({
      action: 'scrape_change_applied',
      changes: {
        applied: { extras: { latest_reviewer: 'Ben Roberts' } },
      },
    });
    expect(summarizeActivity(row).join('|')).toMatch(/Reviewer: Ben Roberts/);
  });

  it('scrape_change_applied: corr_rounds bump shows old → new', () => {
    const row = mkRow({
      action: 'scrape_change_applied',
      changes: {
        db: { corr_rounds: 0 },
        applied: { corr_rounds: 1 },
      },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /Correction rounds: 0 → 1/,
    );
  });

  it('scrape_change_applied: fallback when no known keys applied', () => {
    const row = mkRow({
      action: 'scrape_change_applied',
      changes: { applied: { future_field: 'x' } },
    });
    expect(summarizeActivity(row).join('|')).toMatch(/Updated: future_field/);
  });

  it('scrape_cycle_change_applied: prefixes Cycle N + field', () => {
    const row = mkRow({
      action: 'scrape_cycle_change_applied',
      row_id: '318:cycle:1',
      cycle_index: 1,
      changes: { applied: { submitted: '2026-01-28' } },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /Cycle 1 submitted: 2026-01-28/,
    );
  });

  it('scrape_skipped_recent_manual_edit: surfaces portal vs db diff', () => {
    const row = mkRow({
      action: 'scrape_skipped_recent_manual_edit',
      changes: {
        observed: { status: 'Issued' },
        db: { status: 'Corrections Required' },
      },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /Skipped.*portal says Issued.*db has Corrections Required/,
    );
  });

  it('scrape_cycle_skipped_recent_manual_edit: simple line', () => {
    const row = mkRow({
      action: 'scrape_cycle_skipped_recent_manual_edit',
      changes: { reason: 'parent permit had manual edit within 24h' },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /Cycle skipped — parent permit edited within 24h/,
    );
  });

  it('manual_admin_correction: renders before → after', () => {
    const row = mkRow({
      action: 'manual_admin_correction',
      changes: {
        before: { approval_date: '2026-01-05' },
        after: { approval_date: '2026-05-08' },
        reason: 'matched portal',
      },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /approval_date: 2026-01-05 → 2026-05-08 \(manual\)/,
    );
  });

  it('scrape_cycle_disagreement: renders disagreement per field', () => {
    const row = mkRow({
      action: 'scrape_cycle_disagreement',
      cycle_index: 2,
      changes: {
        disagreement: {
          submitted: { db: '2026-04-01', observed: '2026-04-03' },
        },
      },
    });
    expect(summarizeActivity(row).join('|')).toMatch(
      /Cycle 2 submitted: db=2026-04-01 vs portal=2026-04-03/,
    );
  });

  it('unknown action falls back to the raw action string', () => {
    const row = mkRow({ action: 'some_future_action' });
    expect(summarizeActivity(row)).toEqual(['some_future_action']);
  });

  it('never returns an empty array (defensive)', () => {
    const row = mkRow({ action: 'scrape_change_applied', changes: {} });
    expect(summarizeActivity(row).length).toBeGreaterThan(0);
  });
});

// ============================================================
// countUnread
// ============================================================
describe('countUnread', () => {
  const rows: ScraperActivityRow[] = [
    mkRow({ id: 1, created_at: '2026-05-18T20:00:00Z' }),
    mkRow({ id: 2, created_at: '2026-05-18T18:00:00Z' }),
    mkRow({ id: 3, created_at: '2026-05-17T08:00:00Z' }),
  ];

  it('returns full count when lastSeenAt is null', () => {
    expect(countUnread(rows, null)).toBe(3);
  });

  it('returns count of rows newer than cutoff', () => {
    expect(countUnread(rows, '2026-05-18T17:00:00Z')).toBe(2);
    expect(countUnread(rows, '2026-05-18T19:00:00Z')).toBe(1);
    expect(countUnread(rows, '2026-05-18T21:00:00Z')).toBe(0);
  });

  it('zero rows → zero unread regardless of cutoff', () => {
    expect(countUnread([], null)).toBe(0);
    expect(countUnread([], '2026-05-18T00:00:00Z')).toBe(0);
  });

  it('invalid cutoff string → treat as null (all unread)', () => {
    expect(countUnread(rows, 'not-a-date')).toBe(3);
  });
});

// ============================================================
// groupActivityByRun
// ============================================================
describe('groupActivityByRun', () => {
  it('returns empty array on empty input', () => {
    expect(groupActivityByRun([])).toEqual([]);
  });

  it('clusters rows within a 5-minute window into one group', () => {
    const rows = [
      mkRow({ id: 1, created_at: '2026-05-18T18:00:00Z' }),
      mkRow({ id: 2, created_at: '2026-05-18T18:01:30Z' }),
      mkRow({ id: 3, created_at: '2026-05-18T18:04:00Z' }),
    ];
    const groups = groupActivityByRun(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].rows.length).toBe(3);
  });

  it('splits when rows are > 5 minutes apart', () => {
    const rows = [
      mkRow({ id: 1, created_at: '2026-05-18T18:00:00Z' }),
      mkRow({ id: 2, created_at: '2026-05-18T17:00:00Z' }),
      mkRow({ id: 3, created_at: '2026-05-17T08:00:00Z' }),
    ];
    const groups = groupActivityByRun(rows);
    expect(groups.length).toBe(3);
  });
});

// ============================================================
// formatRelativeTime
// ============================================================
describe('formatRelativeTime', () => {
  const now = new Date('2026-05-18T20:00:00Z');

  it('< 1 minute → "just now"', () => {
    expect(formatRelativeTime('2026-05-18T19:59:30Z', now)).toBe('just now');
  });

  it('< 60 min → "N minutes ago"', () => {
    expect(formatRelativeTime('2026-05-18T19:30:00Z', now)).toMatch(
      /^30 minutes ago$/,
    );
    expect(formatRelativeTime('2026-05-18T19:59:00Z', now)).toBe('1 minute ago');
  });

  it('< 24h → "N hours ago"', () => {
    expect(formatRelativeTime('2026-05-18T17:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelativeTime('2026-05-18T19:00:00Z', now)).toBe('1 hour ago');
  });

  it('< 30d → "N days ago"', () => {
    expect(formatRelativeTime('2026-05-16T20:00:00Z', now)).toBe('2 days ago');
  });

  it('older falls back to ISO date prefix', () => {
    expect(formatRelativeTime('2026-01-01T00:00:00Z', now)).toBe('2026-01-01');
  });

  it('invalid input returns the input string', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });
});
