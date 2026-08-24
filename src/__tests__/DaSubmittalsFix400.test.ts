import { describe, it, expect } from 'vitest';
import boardOwnershipSource from '../lib/boardOwnership.ts?raw';
import {
  DA_QUEUE_ROW_KINDS,
  daQueueAllowsRowKind,
  usesDaQueueShape,
} from '../lib/boardOwnership';
import { buildQueue, resolveBoardViewer, type BoardInput } from '../lib/myBoard';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// fix-400 — Bobby reversed fix-308b's half: DAs see their submittals too
// ===========================================================================
//
// ★★★ THE RULING, 2026-08-25, verbatim:
//
//   "DA's project queue should show submittals and corrections. city review is
//    just an addition to ENT."
//
// ★★ THIS IS THE THIRD DECISION ON ONE SET, and the suite is written so all
// three stay legible:
//
//   1. fix-308b — corrections and intakes only, pinned with a rendered test on
//      prod permit 165 (a Demolition, target_submit 2026-03-01, no arch tasks)
//      showing DA Cam an EMPTY queue.
//   2. fix-397 — reshaped the queue into kinds, tried to widen the set on its
//      own judgement, was caught by that very test, and deliberately left the
//      widening as "a product decision for Bobby, not a side effect of a
//      reshape".
//   3. fix-400 — Bobby made the decision. `submittal` is in; `city_review`
//      stays out.
//
// ★ SUPERSEDED, NOT MISTAKEN. fix-308b was right while a DA's dated design work
// had no home on the queue at all; fix-397 gave it one.

const TODAY = '2026-08-25';

const PROJECTS: Project[] = [
  { id: 'p-1', address: '3921 43rd Ave S' },
  { id: 'p-2', address: '554 N 75th St' },
] as unknown as Project[];

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-1',
    type: 'Demolition',
    num: '7133443-DM',
    status: 'Pre-Submittal — GO',
    da: 'Cam',
    ent_lead: 'Miles',
    parent_permit_id: null,
    target_submit: null,
    intake_date: null,
    dd_end: null,
    approval_date: null,
    actual_issue: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

const cycle = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  permit_id: 1,
  cycle_index: 1,
  submitted: '2026-08-01',
  intake_accepted: null,
  city_target: null,
  corr_issued: null,
  resubmitted: null,
  created_at: '',
  updated_at: '',
  ...over,
});

function queueFor(name: string, permits: PermitWithCycles[]) {
  return buildQueue({
    viewer: resolveBoardViewer(name, []),
    permits,
    projects: PROJECTS,
    tasks: [],
    today: TODAY,
  } as BoardInput);
}

/** The three shapes, one per kind, all owned by DA Cam and nobody else. */
const SUBMITTAL = permit({
  id: 11,
  status: 'Pre-Submittal — GO',
  ent_lead: null,
  target_submit: '2026-03-01', // prod permit 165's own date
});
const CORRECTIONS = permit({
  id: 12,
  status: 'Corrections Required',
  ent_lead: null,
  permit_cycles: [cycle({ permit_id: 12, corr_issued: '2026-08-10' })],
});
const CITY_REVIEW = permit({
  id: 13,
  project_id: 'p-2',
  status: 'Reviews In Process',
  ent_lead: null,
  permit_cycles: [cycle({ permit_id: 13, city_target: '2026-08-21' })],
});

// ---------------------------------------------------------------------------
// §1 · THE SET
// ---------------------------------------------------------------------------

describe('fix-400 §1: a DA-only queue is submittals and corrections', () => {
  it('★★★ all three kinds, asserted together — two in, one out', () => {
    const rows = queueFor('Cam', [SUBMITTAL, CORRECTIONS, CITY_REVIEW]).rows;
    expect(rows.map((r) => r.kind).sort()).toEqual(['corrections', 'submittal']);
    // ★ Named rather than merely counted, so a future off-by-one in the set
    // cannot pass by swapping which kind is missing.
    expect(rows.map((r) => r.permitId).sort()).toEqual([11, 12]);
    expect(rows.some((r) => r.kind === 'city_review')).toBe(false);
  });

  it('★★★ the submittal row is the one fix-308b used to exclude', () => {
    // prod permit 165's shape: a Demolition with target_submit 2026-03-01 and
    // no arch tasks. Under the relay its design leg reads 'mine', which is why
    // the filter — not the relay — is what decided this for three tickets.
    const row = queueFor('Cam', [SUBMITTAL]).rows[0]!;
    expect(row.kind).toBe('submittal');
    expect(row.num).toBe('7133443-DM');
    expect(row.due).toBe('2026-03-01');
    expect(row.band).toBe('past_due');
  });

  it('★★ corrections still come through — fix-308b\'s surviving half', () => {
    expect(queueFor('Cam', [CORRECTIONS]).rows.map((r) => r.kind)).toEqual([
      'corrections',
    ]);
  });

  it('★★★ city review is TWICE-ruled out, and stays out', () => {
    // fix-308b: "a permit sitting quietly with the city is neither an intake
    // nor a correction". Bobby, 2026-08-25: "city review is just an addition to
    // ENT." Same answer, ten weeks apart.
    expect(queueFor('Cam', [CITY_REVIEW]).total).toBe(0);
    expect(daQueueAllowsRowKind('city_review')).toBe(false);
  });

  it('★ the set itself', () => {
    expect([...DA_QUEUE_ROW_KINDS].sort()).toEqual(['corrections', 'submittal']);
    expect(daQueueAllowsRowKind('submittal')).toBe(true);
    expect(daQueueAllowsRowKind('corrections')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 · WHO THE FILTER APPLIES TO
// ---------------------------------------------------------------------------

describe('fix-400 §2: the DA shape is unchanged — design-every-leg only', () => {
  it('★★ a MIXED-ROLE viewer still gets all three kinds', () => {
    // Cam is the DA here and the ENT lead there. Narrowing his queue would hide
    // his entitlement work, which is the reason `usesDaQueueShape` has always
    // required design to be EVERY leg — untouched by this ticket.
    const asEntElsewhere = permit({
      id: 14,
      project_id: 'p-2',
      status: 'Reviews In Process',
      da: null,
      ent_lead: 'Cam',
      permit_cycles: [cycle({ permit_id: 14, city_target: '2026-08-21' })],
    });
    const rows = queueFor('Cam', [
      SUBMITTAL,
      CORRECTIONS,
      asEntElsewhere,
    ]).rows;
    expect(rows.map((r) => r.kind).sort()).toEqual([
      'city_review',
      'corrections',
      'submittal',
    ]);
  });

  it('★★ …and a viewer holding BOTH legs on one permit keeps city review', () => {
    // The filter is per-VIEWER, not per-permit: `usesDaQueueShape` reads the
    // legs this viewer holds on this permit, and holding both is not the DA
    // shape.
    const both = permit({
      id: 15,
      project_id: 'p-2',
      status: 'Reviews In Process',
      da: 'Cam',
      ent_lead: 'Cam',
      permit_cycles: [cycle({ permit_id: 15, city_target: '2026-08-21' })],
    });
    expect(queueFor('Cam', [both]).rows.map((r) => r.kind)).toEqual(['city_review']);
  });

  it('★ the shape predicate is untouched', () => {
    expect(usesDaQueueShape(['design'])).toBe(true);
    expect(usesDaQueueShape(['design', 'entitlement'])).toBe(false);
    expect(usesDaQueueShape(['entitlement'])).toBe(false);
    expect(usesDaQueueShape([])).toBe(false);
  });

  it('★★ an ENT lead is unaffected — city review is "an addition to ENT"', () => {
    expect(
      queueFor('Miles', [
        permit({ id: 16, project_id: 'p-2', status: 'Reviews In Process', da: 'Cam',
                 ent_lead: 'Miles',
                 permit_cycles: [cycle({ permit_id: 16, city_target: '2026-08-21' })] }),
      ]).rows.map((r) => r.kind),
    ).toEqual(['city_review']);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE RECORD
// ---------------------------------------------------------------------------

/** ★ Comment leaders stripped and whitespace collapsed, so an assertion is
 *  about what the file SAYS rather than about where the lines happen to wrap.
 *  Chasing wrap-safe fragments instead is how these assertions rot. */
const prose = boardOwnershipSource
  .replace(/^\s*(\/\*+|\*+\/|\*|\/\/)/gm, ' ')
  .replace(/\s+/g, ' ');

describe('fix-400 §3: three decisions, all still visible', () => {
  it('★★★ the ruling is quoted where the set is defined', () => {
    expect(prose).toContain(
      "DA's project queue should show submittals and corrections. city review is just an addition to ENT.",
    );
  });

  it('★★★ …and so are the two decisions it builds on', () => {
    // The point of keeping all three is that a reader sees an EVOLUTION rather
    // than a contradiction: fix-308b ruled it out, fix-397 declined to overrule
    // it on its own judgement, Bobby overruled it himself.
    expect(prose).toContain(
      'For design associates, what they really need to focus on is upcoming intakes, and then your corrections.',
    );
    expect(prose).toContain('a product decision for Bobby, not a side effect of a reshape');
    expect(prose).toContain('SUPERSEDED, NOT MISTAKEN');
  });

  it('★ fix-308b\'s own MilestoneKind set is left alone', () => {
    // DA_QUEUE_KINDS names MilestoneKinds and has had nothing in the queue to
    // filter since fix-397. It is the historical record of decision 1 and is
    // not rewritten to match decision 3 — that would erase the evolution.
    expect(boardOwnershipSource).toMatch(/DA_QUEUE_KINDS[\s\S]{0,120}'intake'/);
  });

  it('★ no row is written — this ticket is a set literal and its record', () => {
    expect(boardOwnershipSource).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});
