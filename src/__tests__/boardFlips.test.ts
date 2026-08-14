import { describe, it, expect } from 'vitest';
import {
  buildBellItems,
  parseFlips,
  type ActivityRowLike,
} from '../lib/boardFlips';
import type { BoardTask } from '../lib/myBoard';

// fix-304 §17/§18 — register #17 and #18.
//
// #17: "The scraper changed this from city target to corrections. That's a big
// thing." Designed in mockups v2–v7, never carried into a brief's scope, so the
// bell shipped with NO status-flip content at all — grep BoardBell for
// corrections/status/flip before this ticket and there is nothing.
//
// #18: the flip and the bot task it spawns are ONE event and must be ONE row.
//
// PROD MEASUREMENTS (2026-08-14, eibnmwthkcuumyclyxoe, READ-ONLY):
//   All 86 bot corr_issued tasks match a cycle flip on the same permit, and the
//     p95 gap between them is 0.22 SECONDS — the scraper writes both in one
//     run. Un-merged that is 86 duplicated pairs, and the duplicate is the
//     less informative half.
//   ★ 88 of 271 corr_issued flips (32%) applied a date more than 30 DAYS old,
//     the worst by 300 days — the scraper backfilling a permit's history. The
//     brief does not mention these; treated as flips they would announce
//     300-day-old news as if it broke this morning.
//   `extras` is the LARGEST applied key (241 in 30 days) and is pure churn —
//     reviewer names, descriptions, portal ids. Never a flip.

const AT = '2026-08-14T15:47:20Z';

function row(over: Partial<ActivityRowLike>): ActivityRowLike {
  return {
    id: 1,
    created_at: AT,
    action: 'scrape_cycle_change_applied',
    row_id: '10230:cycle:3',
    permit_num: 'BLD2026-0319',
    permit_type: 'Building Permit',
    address: '3626 164th Pl SE',
    ent_lead: 'Miles',
    project_id: 'p1',
    changes: {},
    ...over,
  };
}

function task(over: Partial<BoardTask>): BoardTask {
  return {
    id: 't1',
    permit_id: 10230,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '3626 164th Pl SE',
    permit_type: 'Building Permit',
    bucket: 'pm',
    text: 'Corrections Required — 12 items',
    status: 'Open',
    discipline: 'arch',
    start_date: null,
    target_date: null,
    due_date: '2026-08-26',
    done_at: null,
    sort_order: 0,
    assigned_to: null,
    primary_assignee: null,
    co_assignees: [],
    is_auto_generated: true,
    auto_event: 'corr_issued',
    created_at: AT,
    ...over,
  } as BoardTask;
}

// ---------------------------------------------------------------------------
describe('fix-304 §17: which flips reach a person', () => {
  it('a corrections status flip is a flip', () => {
    const f = parseFlips([
      row({ action: 'scrape_change_applied', changes: { applied: { status: 'Corrections Required' } } }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('corrections_required');
  });

  it('approved, issued, intake accepted, cycle open and close all reach it', () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ approval_date: '2026-08-13' }, 'approved'],
      [{ actual_issue: '2026-08-13' }, 'issued'],
      [{ intake_accepted: '2026-08-13' }, 'intake_accepted'],
      [{ submitted: '2026-08-13' }, 'cycle_opened'],
      [{ resubmitted: '2026-08-13' }, 'cycle_closed'],
    ];
    for (const [applied, kind] of cases) {
      const f = parseFlips([row({ changes: { applied } })]);
      expect(f.map((x) => x.kind)).toContain(kind);
    }
  });

  it('★ the scraper retry and manual-edit-guard events NEVER reach it', () => {
    // 50.8/day and 14.5/day, the two largest categories in the system, both
    // meaning "working as intended".
    const noisy = [
      'scrape_workflow_fetch_recovered',
      'scrape_skipped_recent_manual_edit',
      'scrape_cycle_skipped_recent_manual_edit',
      'scrape_reviewer_skipped_recent_manual_edit',
      'scrape_workflow_fetch_failed',
    ].map((action) => row({ action, changes: { applied: { status: 'Corrections Required' } } }));
    expect(parseFlips(noisy)).toEqual([]);
  });

  it('★ an `extras` change is never a flip — it is the largest key and pure churn', () => {
    const f = parseFlips([
      row({
        action: 'scrape_change_applied',
        changes: { applied: { extras: '{"latest_reviewer":"Ian Nisbet"}' } },
      }),
    ]);
    expect(f).toEqual([]);
  });

  it('a city_target move on its own is not a flip', () => {
    expect(parseFlips([row({ changes: { applied: { city_target: '2026-09-01' } } })])).toEqual(
      [],
    );
  });

  it('★ a BACKFILL is not news — an old applied date does not reach the bell', () => {
    // 32% of corr_issued flips apply a date >30 days old; the worst is 300.
    const f = parseFlips([
      row({ changes: { applied: { corr_issued: '2025-12-30' } } }),
    ]);
    expect(f).toEqual([]);
  });

  it('…but a same-week corrections date does', () => {
    const f = parseFlips([row({ changes: { applied: { corr_issued: '2026-08-13' } } })]);
    expect(f.map((x) => x.kind)).toEqual(['corrections_required']);
  });

  it('resolves the permit id out of a cycle row_id', () => {
    const f = parseFlips([row({ changes: { applied: { corr_issued: '2026-08-14' } } })]);
    expect(f[0]!.permitId).toBe(10230);
  });
});

// ---------------------------------------------------------------------------
describe('fix-304 §18: ★ the flip and its bot task are ONE row', () => {
  const flip = () =>
    parseFlips([row({ changes: { applied: { corr_issued: '2026-08-14' } } })]);

  it('★ merges — the task is the row, the flip is its subtitle', () => {
    const items = buildBellItems(flip(), [task({})]);
    expect(items).toHaveLength(1);
    expect(items[0]!.merged).toBe(true);
    // The TASK is the headline…
    expect(items[0]!.title).toBe('Corrections Required — 12 items');
    // …and the FLIP is the reason under it, with the task's due date.
    expect(items[0]!.subtitle).toContain('Corrections Required');
    expect(items[0]!.subtitle).toContain('2026-08-26');
  });

  it('★ un-merged this would DOUBLE every correction cycle', () => {
    // The specific regression the register calls out. One event in, one row out.
    const items = buildBellItems(flip(), [task({})]);
    expect(items).toHaveLength(1);
  });

  it('a flip with no bot task stands alone', () => {
    const items = buildBellItems(flip(), []);
    expect(items).toHaveLength(1);
    expect(items[0]!.merged).toBe(false);
    expect(items[0]!.title).toBe('Corrections Required');
  });

  it('a bot task on a DIFFERENT permit does not merge', () => {
    const items = buildBellItems(flip(), [task({ permit_id: 999 })]);
    expect(items[0]!.merged).toBe(false);
  });

  it('a bot task outside the ~15 minute window does not merge', () => {
    const items = buildBellItems(flip(), [
      task({ created_at: '2026-08-14T12:00:00Z' }),
    ]);
    expect(items[0]!.merged).toBe(false);
  });

  it('a HUMAN task never merges — the rule is bot-authored', () => {
    const items = buildBellItems(flip(), [
      task({ is_auto_generated: false }),
    ]);
    expect(items[0]!.merged).toBe(false);
  });

  it('one bot task is consumed by one flip, not by every flip', () => {
    const twoFlips = parseFlips([
      row({ id: 1, changes: { applied: { corr_issued: '2026-08-14' } } }),
      row({ id: 2, changes: { applied: { corr_issued: '2026-08-14' } } }),
    ]);
    const items = buildBellItems(twoFlips, [task({})]);
    expect(items.filter((i) => i.merged)).toHaveLength(1);
    expect(items).toHaveLength(2);
  });

  it('the row carries where to go — project and permit', () => {
    const items = buildBellItems(flip(), [task({})]);
    expect(items[0]!.projectId).toBe('p1');
    expect(items[0]!.permitId).toBe(10230);
    expect(items[0]!.where).toContain('3626 164th Pl SE');
  });
});
