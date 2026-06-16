import { describe, it, expect } from 'vitest';
import { filterHeldLearningSamples } from '../lib/scheduleBenchmarks';
import type { PermitWithCycles, ProjectHold } from '../lib/database.types';

// fix-170 (effect E): held permits are dropped from the learner's training set
// so a parked turnaround never skews the per-(type,juris) averages. The filter
// drops an APPROVED permit whose intake→approval span overlapped a hold on its
// project; everything else is kept (no-hold projects, unapproved permits).

function permit(over: Partial<PermitWithCycles> & { id: number; project_id: string }): PermitWithCycles {
  return {
    type: 'Building Permit',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
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
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function c0(intake: string): PermitWithCycles['permit_cycles'] {
  return [
    {
      id: 'c0',
      permit_id: 1,
      cycle_index: 0,
      submitted: null,
      city_target: null,
      corr_issued: null,
      resubmitted: null,
      intake_accepted: intake,
      created_at: '',
      updated_at: '',
    },
  ];
}

function hold(start: string, end: string | null): ProjectHold {
  return {
    id: `h-${start}`,
    tenant_id: 't1',
    project_id: 'pHeld',
    reason: 'MHA',
    note: null,
    hold_start: start,
    hold_end: end,
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

const TODAY = new Date(2026, 5, 20);

describe('filterHeldLearningSamples', () => {
  const approvedHeld = permit({
    id: 1,
    project_id: 'pHeld',
    approval_date: '2026-06-01',
    permit_cycles: c0('2026-03-01'), // span 2026-03-01 .. 2026-06-01
  });
  const approvedClean = permit({
    id: 2,
    project_id: 'pClean',
    approval_date: '2026-06-01',
    permit_cycles: c0('2026-03-01'),
  });

  it('no holds map → returns the same array untouched (common case)', () => {
    const all = [approvedHeld, approvedClean];
    expect(filterHeldLearningSamples(all, undefined)).toBe(all);
    expect(filterHeldLearningSamples(all, new Map())).toBe(all);
  });

  it('drops an approved sample whose intake→approval overlapped a hold', () => {
    const map = new Map([['pHeld', [hold('2026-04-01', '2026-04-20')]]]);
    const out = filterHeldLearningSamples([approvedHeld, approvedClean], map, TODAY);
    expect(out.map((p) => p.id)).toEqual([2]); // held sample dropped
  });

  it('keeps a sample whose hold did NOT overlap the measured span', () => {
    const map = new Map([['pHeld', [hold('2026-01-01', '2026-02-01')]]]); // before intake
    const out = filterHeldLearningSamples([approvedHeld], map, TODAY);
    expect(out.map((p) => p.id)).toEqual([1]);
  });

  it('an ACTIVE hold (end=today) overlapping the span drops the sample', () => {
    const map = new Map([['pHeld', [hold('2026-05-01', null)]]]); // active, within span
    const out = filterHeldLearningSamples([approvedHeld], map, TODAY);
    expect(out).toHaveLength(0);
  });

  it('keeps an UNAPPROVED permit even on a held project (not a sample)', () => {
    const unapproved = permit({
      id: 3,
      project_id: 'pHeld',
      approval_date: null,
      actual_issue: null,
      permit_cycles: c0('2026-03-01'),
    });
    const map = new Map([['pHeld', [hold('2026-04-01', '2026-04-20')]]]);
    const out = filterHeldLearningSamples([unapproved], map, TODAY);
    expect(out.map((p) => p.id)).toEqual([3]);
  });

  it('actual_issue counts as approval for the sample span', () => {
    const issuedHeld = permit({
      id: 4,
      project_id: 'pHeld',
      actual_issue: '2026-06-01',
      permit_cycles: c0('2026-03-01'),
    });
    const map = new Map([['pHeld', [hold('2026-04-01', '2026-04-20')]]]);
    expect(filterHeldLearningSamples([issuedHeld], map, TODAY)).toHaveLength(0);
  });
});
