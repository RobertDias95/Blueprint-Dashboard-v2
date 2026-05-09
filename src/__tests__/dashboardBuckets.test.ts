import { describe, it, expect } from 'vitest';
import {
  bucketPermits,
  hideIssuedAtAddress,
  type BucketInput,
} from '../lib/permitStage';
import type { DrawScheduleRow, Permit, PermitCycle } from '../lib/database.types';

// Q2: bucketing-level integration tests. Confirms the matrix slot
// assignment + hideIssuedAtAddress rule (only hide issued permits when
// every permit at that address is also issued).

function permit(id: number, over: Partial<Permit> = {}): Permit {
  return {
    id,
    project_id: over.project_id ?? `p${id}`,
    type: 'BP',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    go_date: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    units: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    zone: null,
    product_type: null,
    project_tags: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    ...over,
  };
}

function cycle(over: Partial<PermitCycle>): PermitCycle {
  return {
    id: `c-${Math.random()}`,
    permit_id: 1,
    cycle_index: 1,
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

describe('bucketPermits', () => {
  it('routes permits into the correct slots', () => {
    const inputs: BucketInput[] = [
      { permit: permit(1, { project_id: 'a' }), cycles: [] },
      {
        permit: permit(2, { project_id: 'b' }),
        cycles: [cycle({ submitted: '2025-01-01' })],
      },
      {
        permit: permit(3, { project_id: 'c' }),
        cycles: [cycle({ submitted: '2025-01-01', corr_issued: '2025-02-01' })],
      },
      {
        permit: permit(4, { project_id: 'd', approval_date: '2025-03-01' }),
        cycles: [],
      },
      {
        permit: permit(5, { project_id: 'e', actual_issue: '2025-04-01' }),
        cycles: [],
      },
    ];
    const buckets = bucketPermits(inputs, new Map());
    expect(buckets.deEarly.map((p) => p.id)).toEqual([1]);
    expect(buckets.pm.map((p) => p.id)).toEqual([2]);
    expect(buckets.co.map((p) => p.id)).toEqual([3]);
    expect(buckets.ap.map((p) => p.id)).toEqual([4]);
    expect(buckets.is.map((p) => p.id)).toEqual([5]);
  });

  it('splits DE permits by draw schedule status', () => {
    const inputs: BucketInput[] = [
      { permit: permit(1, { project_id: 'a' }), cycles: [] },
      { permit: permit(2, { project_id: 'b' }), cycles: [] },
    ];
    const draw = new Map<string, DrawScheduleRow>([
      [
        'b',
        {
          project_id: 'b',
          status: 'DD / Permit Set',
          da_assigned: null,
          start_week: null,
          end_week: null,
          manual_status: null,
          manually_placed: null,
          dd_start: null,
          dd_end: null,
          notes: null,
          color_override: null,
          status_override: null,
          updated_at: '2026-05-08T10:00:00Z',
        },
      ],
    ]);
    const buckets = bucketPermits(inputs, draw);
    expect(buckets.deEarly.map((p) => p.id)).toEqual([1]);
    expect(buckets.deLate.map((p) => p.id)).toEqual([2]);
  });
});

describe('hideIssuedAtAddress', () => {
  it('keeps issued permits visible when sibling permits are still active', () => {
    const inputs: BucketInput[] = [
      {
        permit: permit(1, { project_id: 'a', actual_issue: '2025-01-01' }),
        cycles: [],
      },
      { permit: permit(2, { project_id: 'b' }), cycles: [] }, // de — active
    ];
    const projectAddrs = new Map([
      ['a', '123 Main'],
      ['b', '123 Main'],
    ]);
    const hidden = hideIssuedAtAddress(inputs, projectAddrs);
    expect(hidden.size).toBe(0);
  });

  it('hides issued permits when every permit at the address is issued', () => {
    const inputs: BucketInput[] = [
      {
        permit: permit(1, { project_id: 'a', actual_issue: '2025-01-01' }),
        cycles: [],
      },
      {
        permit: permit(2, { project_id: 'b', actual_issue: '2025-01-15' }),
        cycles: [],
      },
    ];
    const projectAddrs = new Map([
      ['a', '123 Main'],
      ['b', '123 Main'],
    ]);
    const hidden = hideIssuedAtAddress(inputs, projectAddrs);
    expect(hidden.has(1)).toBe(true);
    expect(hidden.has(2)).toBe(true);
  });
});
