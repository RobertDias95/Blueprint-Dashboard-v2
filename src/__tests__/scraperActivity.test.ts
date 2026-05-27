import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  categorizeAction,
  countUnread,
  countUnreadByIds,
  formatRelativeTime,
  groupActivityByProject,
  groupActivityByRun,
  matchesEntFilter,
  matchesSearch,
  parseCycleRowId,
  summarizeActivity,
  UNKNOWN_ADDRESS_LABEL,
} from '../lib/scraperActivity';
import {
  migrateLegacyLastSeen,
  READ_IDS_KEY,
  useNotificationStore,
} from '../stores/notificationStore';
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
    ent_lead: 'Bobby',
    // fix-61: required ScraperActivityRow fields. These helpers don't
    // exercise UI link rendering, so null defaults are fine.
    portal_url: null,
    project_id: null,
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

// ============================================================
// fix-28: project grouping
// ============================================================
describe('groupActivityByProject', () => {
  it('buckets rows by address, preserving newest-first order within each bucket', () => {
    const rows = [
      mkRow({ id: 1, address: '100 Main St', created_at: '2026-05-18T18:00:00Z' }),
      mkRow({ id: 2, address: '200 Oak Ave', created_at: '2026-05-18T17:00:00Z' }),
      mkRow({ id: 3, address: '100 Main St', created_at: '2026-05-18T16:00:00Z' }),
    ];
    const grouped = groupActivityByProject(rows);
    expect(Array.from(grouped.keys())).toEqual(['100 Main St', '200 Oak Ave']);
    expect(grouped.get('100 Main St')?.map((r) => r.id)).toEqual([1, 3]);
    expect(grouped.get('200 Oak Ave')?.map((r) => r.id)).toEqual([2]);
  });

  it('rows with null / empty address bucket under "Unknown address"', () => {
    const rows = [
      mkRow({ id: 1, address: null }),
      mkRow({ id: 2, address: '   ' }),
      mkRow({ id: 3, address: '100 Main St' }),
    ];
    const grouped = groupActivityByProject(rows);
    expect(grouped.get(UNKNOWN_ADDRESS_LABEL)?.map((r) => r.id)).toEqual([1, 2]);
    expect(grouped.get('100 Main St')?.map((r) => r.id)).toEqual([3]);
  });

  it('returns an empty Map on empty input', () => {
    expect(groupActivityByProject([]).size).toBe(0);
  });

  it('trims whitespace from address keys', () => {
    const rows = [
      mkRow({ id: 1, address: '  100 Main St  ' }),
      mkRow({ id: 2, address: '100 Main St' }),
    ];
    const grouped = groupActivityByProject(rows);
    // Both rows should land in the same trimmed bucket.
    expect(grouped.size).toBe(1);
    expect(grouped.get('100 Main St')?.length).toBe(2);
  });
});

// ============================================================
// fix-28: search
// ============================================================
describe('matchesSearch', () => {
  const summary = ['Status: Reviews In Process → Issued'];

  it('empty query matches every row', () => {
    expect(matchesSearch(mkRow(), '', summary)).toBe(true);
    expect(matchesSearch(mkRow(), '   ', summary)).toBe(true);
  });

  it('case-insensitive substring match against address', () => {
    const row = mkRow({ address: '3670 Interlake Ave N' });
    expect(matchesSearch(row, '3670', summary)).toBe(true);
    expect(matchesSearch(row, 'interlake', summary)).toBe(true);
    expect(matchesSearch(row, 'INTERLAKE', summary)).toBe(true);
  });

  it('matches permit number, type, juris, and ent_lead', () => {
    const row = mkRow({
      permit_num: '7101215-DM',
      permit_type: 'Demolition',
      juris: 'Seattle',
      ent_lead: 'Briana',
    });
    expect(matchesSearch(row, '7101215', summary)).toBe(true);
    expect(matchesSearch(row, 'demolition', summary)).toBe(true);
    expect(matchesSearch(row, 'seattle', summary)).toBe(true);
    expect(matchesSearch(row, 'briana', summary)).toBe(true);
  });

  it('matches against the summary text', () => {
    const row = mkRow();
    expect(matchesSearch(row, 'issued', summary)).toBe(true);
    expect(matchesSearch(row, 'reviews', summary)).toBe(true);
  });

  it('whitespace tokens act as AND', () => {
    const row = mkRow({
      address: '3670 Interlake Ave N',
      permit_num: '7101215-DM',
    });
    expect(matchesSearch(row, '3670 interlake', summary)).toBe(true);
    expect(matchesSearch(row, '3670 nonsense', summary)).toBe(false);
  });

  it('comma separator also acts as AND (Reports parity)', () => {
    const row = mkRow({
      address: '3670 Interlake Ave N',
      permit_num: '7101215-DM',
    });
    expect(matchesSearch(row, '3670, dm', summary)).toBe(true);
  });

  it('returns false when no field matches', () => {
    expect(matchesSearch(mkRow(), 'xyz-not-in-anything', summary)).toBe(false);
  });
});

// ============================================================
// fix-28: ent multi-select filter
// ============================================================
describe('matchesEntFilter', () => {
  const allEnts = ['Bobby', 'Briana', 'Miles'];

  it('null selectedEnts is a no-op (all rows visible)', () => {
    expect(matchesEntFilter(mkRow(), null, allEnts)).toBe(true);
    expect(matchesEntFilter(mkRow({ ent_lead: null }), null, allEnts)).toBe(true);
  });

  it('selectedEnts size matching options is "all selected"', () => {
    const all = new Set(allEnts);
    expect(matchesEntFilter(mkRow({ ent_lead: 'Bobby' }), all, allEnts)).toBe(true);
    // Null ent_lead row visible when all are selected.
    expect(matchesEntFilter(mkRow({ ent_lead: null }), all, allEnts)).toBe(true);
  });

  it('narrowed selection only passes matching ent_lead rows', () => {
    const onlyBobby = new Set(['Bobby']);
    expect(matchesEntFilter(mkRow({ ent_lead: 'Bobby' }), onlyBobby, allEnts)).toBe(true);
    expect(matchesEntFilter(mkRow({ ent_lead: 'Briana' }), onlyBobby, allEnts)).toBe(false);
  });

  it('null ent_lead rows are filtered out when selection is narrowed', () => {
    const onlyBobby = new Set(['Bobby']);
    expect(matchesEntFilter(mkRow({ ent_lead: null }), onlyBobby, allEnts)).toBe(false);
  });

  it('case-insensitive comparison', () => {
    const onlyBobby = new Set(['Bobby']);
    expect(matchesEntFilter(mkRow({ ent_lead: 'bobby' }), onlyBobby, allEnts)).toBe(true);
  });

  it('empty selection blocks every row', () => {
    const none = new Set<string>();
    expect(matchesEntFilter(mkRow(), none, allEnts)).toBe(false);
    expect(matchesEntFilter(mkRow({ ent_lead: null }), none, allEnts)).toBe(false);
  });
});

// ============================================================
// fix-28: countUnreadByIds + readIds store
// ============================================================
describe('countUnreadByIds', () => {
  it('returns full row count when set is empty', () => {
    const rows = [mkRow({ id: 1 }), mkRow({ id: 2 }), mkRow({ id: 3 })];
    expect(countUnreadByIds(rows, new Set())).toBe(3);
  });

  it('subtracts rows present in the set', () => {
    const rows = [mkRow({ id: 1 }), mkRow({ id: 2 }), mkRow({ id: 3 })];
    expect(countUnreadByIds(rows, new Set([1, 3]))).toBe(1);
  });

  it('zero rows → zero unread', () => {
    expect(countUnreadByIds([], new Set([1, 2, 3]))).toBe(0);
  });
});

describe('notificationStore + migrateLegacyLastSeen', () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.getState()._reset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('markRead persists id to localStorage', () => {
    useNotificationStore.getState().markRead(42);
    expect(useNotificationStore.getState().readIds.has(42)).toBe(true);
    const raw = localStorage.getItem(READ_IDS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toContain(42);
  });

  it('markUnread removes the id', () => {
    useNotificationStore.getState().markRead(42);
    useNotificationStore.getState().markUnread(42);
    expect(useNotificationStore.getState().readIds.has(42)).toBe(false);
  });

  it('markManyRead merges into the existing set without duplication', () => {
    useNotificationStore.getState().markRead(1);
    useNotificationStore.getState().markManyRead([1, 2, 3]);
    expect(useNotificationStore.getState().readIds.size).toBe(3);
  });

  it('migrateLegacyLastSeen marks every row at or before the cutoff as read', () => {
    localStorage.setItem('bp_notif_last_seen_at', '2026-05-18T17:00:00Z');
    const rows = [
      mkRow({ id: 1, created_at: '2026-05-18T18:00:00Z' }), // after cutoff → still unread
      mkRow({ id: 2, created_at: '2026-05-18T17:00:00Z' }), // == cutoff → read
      mkRow({ id: 3, created_at: '2026-05-18T16:00:00Z' }), // before cutoff → read
    ];
    migrateLegacyLastSeen(rows);
    const ids = useNotificationStore.getState().readIds;
    expect(ids.has(1)).toBe(false);
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
    // Legacy key removed once migration ran.
    expect(localStorage.getItem('bp_notif_last_seen_at')).toBeNull();
  });

  it('migrateLegacyLastSeen is a no-op when read_ids already exists', () => {
    localStorage.setItem('bp_notif_last_seen_at', '2026-05-18T17:00:00Z');
    useNotificationStore.getState().markRead(99); // populates READ_IDS_KEY
    migrateLegacyLastSeen([mkRow({ id: 1, created_at: '2020-01-01T00:00:00Z' })]);
    // The legacy timestamp should be untouched because migration short-circuited
    // (existing READ_IDS_KEY means we already migrated or the user is on fix-28).
    expect(localStorage.getItem('bp_notif_last_seen_at')).toBe(
      '2026-05-18T17:00:00Z',
    );
    // And id=1 should NOT have been auto-added.
    expect(useNotificationStore.getState().readIds.has(1)).toBe(false);
  });

  it('migrateLegacyLastSeen with no legacy key is a no-op', () => {
    migrateLegacyLastSeen([mkRow({ id: 1 })]);
    expect(useNotificationStore.getState().readIds.size).toBe(0);
  });
});
