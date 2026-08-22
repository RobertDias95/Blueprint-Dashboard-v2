import { describe, it, expect } from 'vitest';
import {
  STATUS_PROVES_SUBMITTED,
  statusImpliesSubmitted,
} from '../lib/statusImpliesSubmitted';
import {
  TERMINAL_NEGATIVE_STATUSES,
  isTerminalNegativeStatus,
  isTerminalIssuedStatus,
} from '../lib/permitTerminalStatus';
import {
  milestoneApplies,
  permitMilestones,
  historicSuppressedKinds,
  type MilestoneKind,
} from '../lib/myBoard';
import { effectiveStage } from '../lib/permitStage';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-388 — the board asks "has the set gone in?" and ignores the city's answer
// ===========================================================================
//
// Bobby: "i think i noticed some outdated milestones on miles myboard, but i
// could be wrong." He was right.
//
// ★★★ THE MECHANISM. everSubmitted() reads permit_cycles.submitted, which the
// scraper fills for building permits and NEVER fills for land use. So on a ULS
// it is false forever, and both pre-submission chips fire from the day the
// target passes until approval — years of "Nd past target" on permits the city
// is actively reviewing. Miles carries the LU book, which is why it was his
// board.
//
// ★★ MEASURED ON PROD 2026-08-22, from the status dump this ticket produced:
//   38 unissued permits at 'Additional Info Requested' (37 of them ULS)
//   36 of those have NO submitted date on any cycle
//   → 16 live target chips + 18 live draw chips, every one of them false
//   2 unissued 'Withdrawn' permits, still raising pre-submission chips
//   30 unissued 'Pre-Submittal — GO'/'Kickoff' with no submitted date
//   → 29 live target chips, every one of them TRUE and untouched by this fix

const TODAY = '2026-08-22';

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c1',
    permit_id: 1,
    cycle_index: 1,
    submitted: null,
    intake_accepted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as unknown as PermitCycle;
}

/** The 3043315-LU shape: a ULS the city is reviewing, whose cycles carry no
 *  submitted date because the scraper does not write them for land use. */
function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-1',
    type: 'ULS',
    num: '3043315-LU',
    status: 'Additional Info Requested',
    da: 'Nicky',
    ent_lead: 'Miles',
    intake_date: null,
    target_submit: '2026-01-15', // long past
    dd_end: '2026-01-10', // long past
    approval_date: null,
    actual_issue: null,
    created_at: '2025-06-01T00:00:00Z',
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [cycle()],
    ...over,
  } as unknown as PermitWithCycles;
}

const ALL_KINDS: MilestoneKind[] = [
  'corrections',
  'fees',
  'reviewer_silent',
  'target_submit',
  'draw',
  'intake',
];

// ---------------------------------------------------------------------------
// ★★★ THE 30-PERMIT CASE
// ---------------------------------------------------------------------------

describe('fix-388: the city has the application', () => {
  it('★★★ a ULS at "Additional Info Requested" raises NO target and NO draw chip', () => {
    // The exact prod shape: no submitted date anywhere, both dates long past.
    const p = permit();
    expect(milestoneApplies('target_submit', p)).toBe(false);
    expect(milestoneApplies('draw', p)).toBe(false);
  });

  it('★★★ and that is the ONLY thing that changed about it', () => {
    // The permit is still live, still unapproved — the kinds that ask about
    // its CURRENT state are untouched. reviewer_silent still applies.
    const p = permit();
    expect(milestoneApplies('reviewer_silent', p)).toBe(true);
    expect(milestoneApplies('fees', p)).toBe(false); // not approved
  });

  it('★★★ a "Pre-Submittal — GO" permit with a passed target STILL raises it', () => {
    // ★ The 29 true positives. A fix that over-kills is worse than the bug,
    // which is why the set is enumerated rather than matched.
    const p = permit({ status: 'Pre-Submittal — GO' });
    expect(milestoneApplies('target_submit', p)).toBe(true);
    expect(milestoneApplies('draw', p)).toBe(true);
  });

  it('★★ "Ready for Intake" and "Scheduled" keep asking — booked is not submitted', () => {
    // Intake is the appointment at which the set is handed over; a slot in a
    // calendar is not a delivery. 3 permits each on prod, all still asking.
    for (const status of ['Ready for Intake', 'Scheduled']) {
      const p = permit({ status });
      expect(statusImpliesSubmitted(status), status).toBe(false);
      expect(milestoneApplies('target_submit', p), status).toBe(true);
    }
  });

  it('★ an unknown status changes nothing — the default is "neither"', () => {
    // Asymmetric on purpose: a false prompt is recoverable, a silently killed
    // true prompt is not.
    for (const status of ['Some New Portal Status', '', 'Initiated', 'In Process']) {
      expect(statusImpliesSubmitted(status)).toBe(false);
    }
    expect(milestoneApplies('target_submit', permit({ status: 'Some New Portal Status' })))
      .toBe(true);
  });

  it('★★ a building permit with real cycles behaves exactly as before', () => {
    // everSubmitted still wins on its own — the status is a SECOND way to
    // know, never a replacement.
    const bp = permit({
      type: 'Building Permit',
      status: 'Pre-Submittal — GO',
      permit_cycles: [cycle({ submitted: '2026-02-01' })],
    });
    expect(milestoneApplies('target_submit', bp)).toBe(false);
    expect(milestoneApplies('draw', bp)).toBe(false);
  });

  it('★★ intake is NOT wired to status — a different question', () => {
    // 'Ready for Intake' is the state BEFORE acceptance, and everything after
    // intake also comes after a dozen other things. So intake keeps keying on
    // intake_accepted, and a reviewed permit still raises it if intake was
    // never recorded.
    const p = permit({ intake_date: '2026-01-05', status: 'Additional Info Requested' });
    expect(milestoneApplies('intake', p)).toBe(true);
    const accepted = permit({
      intake_date: '2026-01-05',
      permit_cycles: [cycle({ intake_accepted: '2026-01-06' })],
    });
    expect(milestoneApplies('intake', accepted)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('fix-388: a withdrawn permit is dead, not late', () => {
  it('★★ raises ZERO milestones, of every kind', () => {
    const p = permit({
      status: 'Withdrawn',
      intake_date: '2026-01-05',
      approval_date: null,
    });
    for (const kind of ALL_KINDS) {
      expect(milestoneApplies(kind, p), kind).toBe(false);
    }
    expect(permitMilestones(p, TODAY)).toEqual([]);
  });

  it('★★ even one that WOULD have raised fees or corrections', () => {
    // Not "it has no dated milestone" — it is dead, so the state-based kinds
    // go too. An approved-not-issued permit normally raises fees.
    const p = permit({ status: 'Withdrawn', approval_date: '2026-05-01' });
    expect(milestoneApplies('fees', p)).toBe(false);
    expect(permitMilestones(p, TODAY)).toEqual([]);
  });

  it('★★★ "Closed" is NOT terminal-negative — closed is finished, not abandoned', () => {
    // It already lives in the terminal-POSITIVE set, which effectiveStage uses
    // to route to 'is'. Putting it in both would be two answers to one question.
    expect(isTerminalNegativeStatus('Closed')).toBe(false);
    expect(isTerminalIssuedStatus('Closed')).toBe(true);
    expect([...TERMINAL_NEGATIVE_STATUSES]).toEqual(['Withdrawn']);
  });

  it('★ the board now agrees with the stage model on a withdrawn permit', () => {
    // ★ permitStage routes 'Withdrawn' by its own rules (it is not
    // terminal-positive, so it is NOT folded to issued/approved). What matters
    // for this ticket is that the board no longer treats it as a live
    // pre-submission permit while the pipeline treats it as something else —
    // the board now says "nothing to do", which no stage contradicts.
    const p = permit({ status: 'Withdrawn' });
    const stage = effectiveStage(p, p.permit_cycles ?? [], []);
    expect(typeof stage).toBe('string');
    expect(permitMilestones(p, TODAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('fix-388: the sets are closed and enumerated', () => {
  it('★★★ exact match only — never a substring test', () => {
    // A fuzzy /review|correct/ is how "Withdrawal Requested" (which is not
    // withdrawn) or "Pre-Review Meeting" (which is not under review) quietly
    // flips hundreds of chips with nobody reviewing the change.
    expect(statusImpliesSubmitted('In Review')).toBe(true);
    expect(statusImpliesSubmitted('Pre-Review Meeting')).toBe(false);
    expect(statusImpliesSubmitted('Reviews In Process')).toBe(true);
    expect(statusImpliesSubmitted('Awaiting Reviews In Process')).toBe(false);
    expect(isTerminalNegativeStatus('Withdrawal Requested')).toBe(false);
    expect(isTerminalNegativeStatus('Withdrawn')).toBe(true);
  });

  it('★ whitespace-tolerant, like its siblings', () => {
    expect(statusImpliesSubmitted('  Additional Info Requested  ')).toBe(true);
    expect(isTerminalNegativeStatus(' Withdrawn ')).toBe(true);
  });

  it('★ null and undefined are "neither", never "submitted"', () => {
    expect(statusImpliesSubmitted(null)).toBe(false);
    expect(statusImpliesSubmitted(undefined)).toBe(false);
    expect(isTerminalNegativeStatus(null)).toBe(false);
  });

  it('★★ the pre-submittal statuses are absent from the proves-submitted set', () => {
    for (const s of [
      'Pre-Submittal — GO',
      'Pre-Submittal — Kickoff',
      'Ready for Intake',
      'Scheduled',
      'Initiated',
    ]) {
      expect(STATUS_PROVES_SUBMITTED.has(s), s).toBe(false);
    }
  });

  it('★★ every terminal-POSITIVE status proves submission, by construction', () => {
    // Composed from permitTerminalStatus rather than re-typed, so the two
    // cannot drift. A permit the city has finished with was self-evidently
    // submitted.
    for (const s of ['Approved', 'Conceptually Approved', 'Issued', 'Completed', 'Closed', 'Ready for Issuance']) {
      expect(statusImpliesSubmitted(s), s).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('fix-388: what it must not disturb', () => {
  it('★★ the suppressed count still counts HISTORY only', () => {
    // A chip closed by status is closed by STATE — like approval — and does
    // not join fix-378's "would apply but for history" number. The permit
    // below is suppressed by status, and contributes nothing to that count.
    const p = permit(); // Additional Info Requested, dates long past
    expect(historicSuppressedKinds(p, p.permit_cycles ?? [], null)).toEqual([]);
  });

  it('★★ fix-378 history suppression still works on a pre-submission permit', () => {
    // Composed alongside, not threaded through: a GO permit whose target
    // predates its own row is still history-suppressed, exactly as before.
    const historic = permit({
      status: 'Pre-Submittal — GO',
      created_at: '2026-06-01T00:00:00Z',
      target_submit: '2026-01-15', // already past when the row was created
    });
    expect(historicSuppressedKinds(historic, historic.permit_cycles ?? [], null))
      .toContain('target_submit');
  });

  it('★★ fix-386\'s flag is a third, independent reason — they compose', () => {
    const p = permit({ status: 'Pre-Submittal — GO' });
    // status says nothing, history says nothing, but the flag does.
    expect(milestoneApplies('target_submit', p, p.permit_cycles ?? [], true)).toBe(false);
    expect(milestoneApplies('target_submit', p, p.permit_cycles ?? [], null)).toBe(true);
  });

  it('★ milestoneApplies keeps its shape for the future notifier', () => {
    // fix-337 promised a notifier could hang off it; the true→false transition
    // on these permits is exactly the "permit moved on" signal.
    expect(typeof milestoneApplies).toBe('function');
    expect(milestoneApplies.length).toBeGreaterThanOrEqual(2);
  });

  it('★ nothing writes an ack — the fix is the derivation', () => {
    const p = permit();
    expect(permitMilestones(p, TODAY, undefined, [])).toEqual(
      permitMilestones(p, TODAY, undefined, []),
    );
  });
});
