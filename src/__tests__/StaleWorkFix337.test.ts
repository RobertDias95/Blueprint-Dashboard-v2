import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_337_stale_work.sql?raw';
import {
  DEFAULT_BOARD_THRESHOLDS,
  milestoneApplies,
  permitMilestones,
  type PermitMilestoneAck,
} from '../lib/myBoard';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-337 — work that no longer applies stops being on people's lists
// ===========================================================================
//
// ★★★ THE RULE, in Bobby's words: *"if it doesn't currently apply — meaning the
// project's been issued or approved, or did you send out first round
// corrections and we're already on cycle two or three — let's make sure that
// whatever we are currently displaying is currently visible."*
//
// ★★ "ISSUED" IS ONE CASE OF IT, NOT THE RULE. I proposed an issued-permit
// guard and was corrected, and the measurement is why. Prod, 2026-08-19:
//
//     latest cycle │ permits │ raising a stale intake prompt
//              0   │   108   │    2   ( 2%)
//              1   │   189   │  131   (69%)
//              2   │   110   │  101   (92%)
//              3   │    88   │   74   (84%)
//              4   │    20   │   20   (100%) ★
//              5   │     6   │    6   (100%) ★
//              6   │     3   │    3   (100%) ★
//                            │  337 of 524   — and 91 of them LIVE permits
//
// An issued-only guard would have fixed the finished ones and left every live
// permit past cycle 3 still asking to have its intake ticked.

const TODAY = '2026-08-19';

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: `c-${over.cycle_index ?? 0}`,
    permit_id: 1,
    cycle_index: 0,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-1',
    type: 'Building Permit',
    num: 'BP-1',
    status: 'In Review',
    stage_override: null,
    da: 'Nicky',
    ent_lead: 'Miles',
    intake_date: null,
    target_submit: null,
    dd_end: null,
    approval_date: null,
    actual_issue: null,
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

const kinds = (p: PermitWithCycles, acks: PermitMilestoneAck[] = []) =>
  permitMilestones(p, TODAY, DEFAULT_BOARD_THRESHOLDS, acks).map((m) => m.kind);

// ---------------------------------------------------------------------------
// ★★★ §1 — the core regression
// ---------------------------------------------------------------------------

describe('fix-337 §1: a milestone is only live if it still applies', () => {
  // ★★★ THE ONE THIS TICKET EXISTS FOR. 337 permits were asking for this.
  it('★★★ a permit at cycle 3 whose cycle-0 intake was accepted raises NO intake prompt', () => {
    const p = permit({
      intake_date: '2026-03-01',
      permit_cycles: [
        cycle({ cycle_index: 0, submitted: '2026-02-20', intake_accepted: '2026-03-01' }),
        cycle({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-04-01', resubmitted: '2026-04-20' }),
        cycle({ cycle_index: 2, submitted: '2026-04-20', corr_issued: '2026-05-20', resubmitted: '2026-06-01' }),
        // ★ The newest cycle has a null intake_accepted — as every later cycle
        // always will. That is what fired the prompt forever.
        cycle({ cycle_index: 3, submitted: '2026-06-01' }),
      ],
    });
    expect(kinds(p)).not.toContain('intake');
    expect(milestoneApplies('intake', p)).toBe(false);
  });

  // ★ …and the rule must not silence a REAL one. These are the 2 survivors.
  it('★★ a permit at cycle 0 with no intake acceptance STILL raises one', () => {
    const p = permit({
      intake_date: '2026-08-10',
      permit_cycles: [cycle({ cycle_index: 0, submitted: '2026-08-01' })],
    });
    expect(kinds(p)).toContain('intake');
    expect(milestoneApplies('intake', p)).toBe(true);
  });

  it('★ …including a permit with no cycles at all', () => {
    const p = permit({ intake_date: '2026-08-10', permit_cycles: [] });
    expect(kinds(p)).toContain('intake');
  });

  // ★ The legacy shape: pre-fix-26 permits carry the design fields on cycle 1.
  // "Has intake been accepted ANYWHERE" answers both shapes; "is it on cycle 0"
  // would re-raise the prompt for every one of them.
  it('★ intake accepted on cycle 1 (the pre-fix-26 shape) also counts', () => {
    const p = permit({
      intake_date: '2026-03-01',
      permit_cycles: [
        cycle({ cycle_index: 0 }),
        cycle({ cycle_index: 1, intake_accepted: '2026-03-01', submitted: '2026-03-01' }),
      ],
    });
    expect(kinds(p)).not.toContain('intake');
  });

  // ★★ The consequence, not a seventh rule: with every kind asking whether it
  // still applies, an issued permit has nothing left to say.
  it('★★ an issued permit raises no milestones at all', () => {
    const p = permit({
      intake_date: '2026-03-01',
      target_submit: '2026-02-01',
      dd_end: '2026-01-15',
      approval_date: '2026-07-01',
      actual_issue: '2026-07-20',
      permit_cycles: [
        cycle({ cycle_index: 0 }),
        cycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ],
    });
    expect(kinds(p)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ★ Each kind, against a permit that has and has not passed it
// ---------------------------------------------------------------------------

describe('fix-337 §1: every milestone kind states its own condition', () => {
  it('★ intake — before acceptance vs after', () => {
    const before = permit({ intake_date: '2026-08-10', permit_cycles: [cycle()] });
    const after = permit({
      intake_date: '2026-08-10',
      permit_cycles: [cycle({ intake_accepted: '2026-08-12' })],
    });
    expect(milestoneApplies('intake', before)).toBe(true);
    expect(milestoneApplies('intake', after)).toBe(false);
  });

  it('★★ target_submit — before ANY submission vs after one, on any cycle', () => {
    const before = permit({ target_submit: '2026-08-01', permit_cycles: [cycle()] });
    expect(milestoneApplies('target_submit', before)).toBe(true);
    // ★ The same bug as intake, one row down: cycle 3 exists and has not been
    // submitted YET, but the set plainly went in on cycle 0.
    const after = permit({
      target_submit: '2026-08-01',
      permit_cycles: [
        cycle({ cycle_index: 0, submitted: '2026-08-02' }),
        cycle({ cycle_index: 3 }),
      ],
    });
    expect(milestoneApplies('target_submit', after)).toBe(false);
    expect(kinds(after)).not.toContain('target_submit');
  });

  it('★ draw — the DD window closes at the first submission', () => {
    const before = permit({ dd_end: '2026-08-01', permit_cycles: [cycle()] });
    const after = permit({
      dd_end: '2026-08-01',
      permit_cycles: [cycle({ submitted: '2026-08-02' }), cycle({ cycle_index: 2 })],
    });
    expect(milestoneApplies('draw', before)).toBe(true);
    expect(milestoneApplies('draw', after)).toBe(false);
  });

  it('★★ reviewer_silent — quiet in review vs issued', () => {
    const quiet = permit({
      updated_at: '2026-07-01T09:00:00Z',
      permit_cycles: [cycle({ submitted: '2026-06-01' })],
    });
    expect(kinds(quiet)).toContain('reviewer_silent');
    // ★ Three permits were asking somebody to chase a reviewer on a permit the
    // city had already issued.
    const issued = permit({
      updated_at: '2026-07-01T09:00:00Z',
      actual_issue: '2026-07-10',
      permit_cycles: [cycle({ submitted: '2026-06-01' })],
    });
    expect(kinds(issued)).not.toContain('reviewer_silent');
  });

  it('★ fees — approved and not issued vs issued (the kind that was already right)', () => {
    const approved = permit({ approval_date: '2026-08-01' });
    const issued = permit({ approval_date: '2026-08-01', actual_issue: '2026-08-10' });
    expect(kinds(approved)).toContain('fees');
    expect(kinds(issued)).not.toContain('fees');
  });

  it('★ corrections — the current cycle decides, and an issued permit is out', () => {
    const inCorr = permit({
      permit_cycles: [cycle({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-07-01' })],
    });
    expect(kinds(inCorr)).toContain('corrections');
    // Answered — the resubmittal closes the round (fix-214's rule, unchanged).
    const answered = permit({
      permit_cycles: [
        cycle({
          cycle_index: 1,
          submitted: '2026-06-01',
          corr_issued: '2026-07-01',
          resubmitted: '2026-07-20',
        }),
      ],
    });
    expect(kinds(answered)).not.toContain('corrections');
  });

  // ★ The prompts a LIVE permit should still get — the false-positive guard for
  // §1. 91 of the 337 were live permits; they must keep the prompts they earn.
  it('★★ a live permit mid-review keeps everything that still applies', () => {
    const p = permit({
      intake_date: '2026-08-18',
      target_submit: '2026-08-25',
      updated_at: `${TODAY}T09:00:00Z`,
      permit_cycles: [cycle({ cycle_index: 0 })],
    });
    expect(kinds(p).sort()).toEqual(['intake', 'target_submit']);
  });
});

// ---------------------------------------------------------------------------
// ★★ No acks — the fix is the derivation
// ---------------------------------------------------------------------------

describe('fix-337: the fix is the derivation, not a pile of acks', () => {
  // ★ An ack is an anchored SNOOZE ("an ack suppresses its milestone only while
  // this still matches"), so 337 of them would have expired the moment an
  // anchor moved — and the prompts would have come back.
  it('★★ nothing in this ticket inserts a milestone ack', () => {
    expect(MIGRATION).not.toMatch(/INSERT\s+INTO\s+public\.permit_milestone_acks/i);
    expect(MIGRATION).not.toMatch(/permit_milestone_acks/i);
  });

  it('★ an existing ack still suppresses its own milestone, unchanged', () => {
    const p = permit({ approval_date: '2026-08-01' });
    const ack: PermitMilestoneAck = {
      id: 'a-1',
      permit_id: 1,
      milestone: 'fees',
      anchor: '2026-08-01',
      acked_by_name: 'Miles',
      acked_at: '2026-08-02T10:00:00Z',
    };
    expect(kinds(p, [ack])).not.toContain('fees');
  });
});

// ---------------------------------------------------------------------------
// ★★ §2 — the one-time clear and the standing rule
// ---------------------------------------------------------------------------
//
// ★ There is no live database in CI, so what is asserted here is the MIGRATION
// — that it clears the set it says it clears, that it cannot touch anything
// else, and that the rule shipped WITH the clear. The prod counts (88 cleared,
// 57 results_ready left, 60 approved-not-issued untouched, 0 acks written) are
// in the PR, measured after applying.

describe('fix-337 §2: the clear, and the rule that keeps it clear', () => {
  it('★★ the clear is bounded to open tasks on ISSUED permits', () => {
    expect(MIGRATION).toMatch(/p\.actual_issue IS NOT NULL/);
    expect(MIGRATION).toMatch(/t\.completion_status <> 'Resolved'/);
    // ★ …and it can only ever write those two columns.
    const updates = MIGRATION.match(/UPDATE public\.permit_tasks[\s\S]*?WHERE/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/SET completion_status = 'Resolved'/);
    expect(updates[0]).toMatch(/auto_closed_reason = 'permit_issued'/);
    // Nothing else — no dates, no assignments, no human fields.
    expect(updates[0]).not.toMatch(/assigned_to|due_date|target_date|notes|text/);
  });

  // ★ The task that exists BECAUSE the permit issued is not stale work.
  it('★★ results_ready is excluded by name — 57 live tasks kept', () => {
    expect(MIGRATION).toMatch(/auto_event IS DISTINCT FROM 'results_ready'/);
  });

  // ★★★ "This is a ONE-TIME clear plus a STANDING RULE… Both, or neither."
  it('★★★ the standing rule ships in the same migration as the clear', () => {
    // Half one: the moment a permit issues, its stale work closes.
    expect(MIGRATION).toMatch(/CREATE TRIGGER permits_issued_clear_tasks/);
    expect(MIGRATION).toMatch(/AFTER UPDATE OF actual_issue ON public\.permits/);
    // Half two: stop creating them. Only the issuance's own task survives.
    expect(MIGRATION).toMatch(
      /v_permit\.actual_issue IS NOT NULL AND p_event <> 'results_ready'/,
    );
    // ★ And both halves call the SAME function the one-time clear used, so
    // "no longer applies" cannot come to mean two different things.
    const calls = MIGRATION.match(/bp_clear_tasks_for_issued_permit/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('★★ the closure is attributable — and not by overloading auto_event', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS auto_closed_reason/);
    expect(MIGRATION).toMatch(/auto_closed_reason IS NULL OR auto_closed_reason IN \('permit_issued'\)/);
    // auto_event says why a task was CREATED; it is never written by the clear.
    expect(MIGRATION).not.toMatch(/SET[^;]*auto_event\s*=/);
  });

  it('★ approved-but-not-issued permits are never in scope', () => {
    // The predicate keys off actual_issue alone — an approved permit still has
    // fees to pay and a permit to collect, and the board raises `fees` for it.
    expect(MIGRATION).not.toMatch(/approval_date IS NOT NULL/);
  });
});
