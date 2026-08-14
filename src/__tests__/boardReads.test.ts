import { describe, it, expect } from 'vitest';
import {
  BOARD_NOTIFICATIONS_EPOCH,
  buildNewItems,
  keyForFlip,
  keyForTask,
  unseenCount,
  unseenItems,
} from '../lib/boardReads';
import { parseFlips, type ActivityRowLike } from '../lib/boardFlips';
import type { BoardTask, PermitMilestoneAck } from '../lib/myBoard';
import type { PermitWithCycles } from '../lib/database.types';

// fix-307 (register #36–#41) — the badge counts what is UNSEEN, not undone.
//
// ★ A badge counting outstanding work never reaches zero, so it stops being a
// signal and becomes decoration. Zero must mean "I have seen everything new".

const AFTER = '2026-08-20T10:00:00Z'; // after the epoch
const BEFORE = '2026-08-01T10:00:00Z'; // before it — pre-deploy, never new

function permit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    num: 'BLD-1',
    da: 'Fisk',
    ent_lead: 'Miles',
    status: null,
    stage: null,
    stage_override: null,
    dm: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: BEFORE,
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function task(over: Partial<BoardTask>): BoardTask {
  return {
    id: 't1',
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: 'A St',
    permit_type: 'Building Permit',
    bucket: 'de',
    text: 'Do the thing',
    status: 'Open',
    discipline: 'ent',
    start_date: null,
    target_date: null,
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: 'Miles',
    primary_assignee: null,
    co_assignees: [],
    created_at: AFTER,
    ...over,
  } as BoardTask;
}

function activity(over: Partial<ActivityRowLike>): ActivityRowLike {
  return {
    id: 501,
    created_at: AFTER,
    action: 'scrape_cycle_change_applied',
    row_id: '1:cycle:2',
    permit_num: 'BLD-1',
    permit_type: 'Building Permit',
    address: 'A St',
    ent_lead: 'Miles',
    project_id: 'p1',
    changes: { applied: { corr_issued: '2026-08-20' } },
    ...over,
  };
}

const base = {
  flips: [],
  tasks: [],
  acks: [] as PermitMilestoneAck[],
  permits: [permit({})],
  viewerName: 'Miles',
};

// ---------------------------------------------------------------------------
describe('fix-307 #36/#38: what counts as new', () => {
  it('a scraper flip on my permit is new', () => {
    const flips = parseFlips([activity({})], 3650);
    const items = buildNewItems({ ...base, flips });
    expect(items.map((i) => i.source)).toContain('flip');
  });

  it('a task newly assigned to me is new', () => {
    const items = buildNewItems({ ...base, tasks: [task({})] });
    expect(items.find((i) => i.source === 'task')?.subtitle).toBe('Assigned to you');
  });

  it('being added as a CO-assignee is new, and says so', () => {
    const items = buildNewItems({
      ...base,
      tasks: [task({ assigned_to: 'Briana', co_assignees: ['Miles'] })],
    });
    expect(items.find((i) => i.source === 'task')?.subtitle).toBe('Added as co-assignee');
  });

  it('a handoff arriving is new to the entitlement lead', () => {
    const acks: PermitMilestoneAck[] = [
      {
        id: 'a1',
        permit_id: 1,
        milestone: 'design_complete',
        anchor: '2',
        acked_by_name: 'Fisk',
        acked_at: AFTER,
      },
    ];
    const items = buildNewItems({ ...base, acks });
    expect(items.find((i) => i.source === 'handoff')?.subtitle).toContain('Fisk');
  });

  it('a permit newly naming me is new', () => {
    const items = buildNewItems({
      ...base,
      permits: [permit({ created_at: AFTER })],
    });
    expect(items.map((i) => i.source)).toContain('permit');
  });

  it("somebody else's task is not new to me", () => {
    const items = buildNewItems({
      ...base,
      tasks: [task({ assigned_to: 'Briana', co_assignees: [] })],
    });
    expect(items).toEqual([]);
  });

  it('★ a SUPPRESSED event never becomes new', () => {
    // Retry-recovered (50.8/day) and the manual-edit guards (14.5/day) are not
    // notifications, so they cannot be unseen ones either.
    for (const action of [
      'scrape_workflow_fetch_recovered',
      'scrape_skipped_recent_manual_edit',
      'scrape_cycle_skipped_recent_manual_edit',
    ]) {
      const flips = parseFlips([activity({ action })], 3650);
      expect(buildNewItems({ ...base, flips })).toEqual([]);
    }
  });

  it('★ a BACKFILLED flip (300 days stale) never becomes new', () => {
    // Reuses the fix-304 freshness rule rather than restating it: 32% of
    // corr_issued flips apply a date over 30 days old.
    const flips = parseFlips([
      activity({ changes: { applied: { corr_issued: '2025-10-20' } } }),
    ]);
    expect(flips).toEqual([]);
    expect(buildNewItems({ ...base, flips })).toEqual([]);
  });

  it('★ nothing older than the deploy epoch is ever new — the zero-row backfill', () => {
    // Otherwise everybody opens the tool to a three-figure badge on day one.
    expect(Date.parse(BEFORE)).toBeLessThan(Date.parse(BOARD_NOTIFICATIONS_EPOCH));
    const items = buildNewItems({
      ...base,
      tasks: [task({ created_at: BEFORE })],
      permits: [permit({ created_at: BEFORE })],
    });
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-307 #41: ★ the key is stable across re-derivation', () => {
  it('the same flip produces the same key every time it is parsed', () => {
    const rows = [activity({})];
    const a = parseFlips(rows, 3650)[0]!;
    const b = parseFlips(rows, 3650)[0]!;
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(keyForFlip(501, 'corrections_required'));
  });

  it('★ so a read flip does NOT become new again on the next load', () => {
    const flips = parseFlips([activity({})], 3650);
    const items = buildNewItems({ ...base, flips });
    const read = new Set(items.map((i) => i.key));

    // Re-derive from scratch, exactly as a page reload would.
    const again = buildNewItems({ ...base, flips: parseFlips([activity({})], 3650) });
    expect(unseenCount(again, read)).toBe(0);
  });

  it('one audit row carrying several applied keys yields separate items', () => {
    // A cycle row can apply submitted + corr_issued at once, and each is
    // separately acknowledgeable — hence the kind in the key.
    const flips = parseFlips(
      [activity({ changes: { applied: { submitted: '2026-08-20', corr_issued: '2026-08-20' } } })],
      3650,
    );
    const keys = flips.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(keyForFlip(501, 'corrections_required'));
    expect(keys).toContain(keyForFlip(501, 'cycle_opened'));
  });

  it('a task key is its uuid, which cannot change under the row', () => {
    expect(keyForTask('abc-123')).toBe('task:abc-123');
  });
});

// ---------------------------------------------------------------------------
describe('fix-307 #39/#40: unseen, not undone', () => {
  it('★ a PAST-DUE item that has been read does not count', () => {
    // The whole point: outstanding work stays outstanding, the badge does not.
    const items = buildNewItems({
      ...base,
      tasks: [task({ due_date: '2020-01-01' })], // wildly past due
    });
    expect(unseenCount(items, new Set())).toBe(1);
    expect(unseenCount(items, new Set([keyForTask('t1')]))).toBe(0);
  });

  it('★ reading removes it from the badge but not from the list of items', () => {
    // It stays on the board — reading is not doing.
    const items = buildNewItems({ ...base, tasks: [task({})] });
    const read = new Set([keyForTask('t1')]);
    expect(unseenItems(items, read)).toHaveLength(0);
    expect(items).toHaveLength(1); // the item itself is untouched
  });

  it('★ reading is per USER — two viewers keep separate state', () => {
    const shared = [task({ assigned_to: 'Miles', co_assignees: ['Briana'] })];
    const forMiles = buildNewItems({ ...base, tasks: shared, viewerName: 'Miles' });
    const forBriana = buildNewItems({ ...base, tasks: shared, viewerName: 'Briana' });
    // Miles reads it…
    const milesRead = new Set(forMiles.map((i) => i.key));
    expect(unseenCount(forMiles, milesRead)).toBe(0);
    // …and Briana still has it. (The DB enforces this too: RLS only exposes a
    // caller their own rows, so Miles's read row is invisible to her.)
    expect(unseenCount(forBriana, new Set())).toBe(1);
  });

  it('an unmapped viewer has nothing new rather than everything', () => {
    expect(buildNewItems({ ...base, tasks: [task({})], viewerName: null })).toEqual([]);
  });
});
