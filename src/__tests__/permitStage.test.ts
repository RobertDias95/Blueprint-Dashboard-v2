import { describe, it, expect } from 'vitest';
import {
  computeStage,
  effectiveStage,
  classifyDeBucket,
} from '../lib/permitStage';
import type { Permit, PermitCycle } from '../lib/database.types';

// Q2: stage-classification rules ported from v1. Lock them down with
// targeted unit tests so the matrix render can rely on the contract.

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p',
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

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'c-100',
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

describe('computeStage', () => {
  it('returns "de" for a fresh permit with no cycles', () => {
    expect(computeStage(makePermit(), [])).toBe('de');
  });

  it('returns "is" once actual_issue is set', () => {
    expect(computeStage(makePermit({ actual_issue: '2025-01-01' }), [])).toBe('is');
  });

  it('returns "co" when latest cycle has corr_issued and no resubmitted', () => {
    const cycles = [
      cycle({ cycle_index: 1, submitted: '2024-09-01', corr_issued: '2024-10-15', resubmitted: '2024-11-01' }),
      cycle({ cycle_index: 2, submitted: '2024-11-15', corr_issued: '2024-12-20', resubmitted: null }),
    ];
    expect(computeStage(makePermit(), cycles)).toBe('co');
  });

  it('returns "pm" when latest cycle has submitted but no open corrections', () => {
    const cycles = [cycle({ submitted: '2024-09-01', corr_issued: null })];
    expect(computeStage(makePermit(), cycles)).toBe('pm');
  });

  it('honors stage_override', () => {
    expect(
      computeStage(makePermit({ stage_override: 'ap' }), []),
    ).toBe('ap');
  });

  it('ignores unknown stage_override values', () => {
    expect(
      computeStage(makePermit({ stage_override: 'gibberish' }), []),
    ).toBe('de');
  });
});

describe('effectiveStage', () => {
  it('promotes approval_date to "ap"', () => {
    expect(
      effectiveStage(makePermit({ approval_date: '2025-01-15' }), []),
    ).toBe('ap');
  });

  it('actual_issue beats approval_date', () => {
    expect(
      effectiveStage(
        makePermit({ approval_date: '2025-01-15', actual_issue: '2025-02-15' }),
        [],
      ),
    ).toBe('is');
  });
});

describe('classifyDeBucket', () => {
  it('Scheduled status = early bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Scheduled')).toBe('early');
  });

  it('Schematic status = early bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Schematic')).toBe('early');
  });

  it('DD / Permit Set status = late bucket', () => {
    expect(classifyDeBucket(makePermit(), 'DD / Permit Set')).toBe('late');
  });

  it('Pending Consultants status = late bucket', () => {
    expect(classifyDeBucket(makePermit(), 'Pending Consultants')).toBe('late');
  });

  it('dd_start with empty draw status stays early — empty counts as early', () => {
    // Mirrors v1 line 2647-2650: late condition is dd_start AND status NOT
    // in ['Scheduled','Schematic','']. An empty/missing status keeps it early.
    expect(
      classifyDeBucket(makePermit({ dd_start: '2025-01-01' }), null),
    ).toBe('early');
  });

  it('dd_start with a non-early non-late status = late bucket', () => {
    expect(
      classifyDeBucket(makePermit({ dd_start: '2025-01-01' }), 'In Review'),
    ).toBe('late');
  });

  it('Schematic with dd_start = still early (status wins)', () => {
    expect(
      classifyDeBucket(
        makePermit({ dd_start: '2025-01-01' }),
        'Schematic',
      ),
    ).toBe('early');
  });
});
