import { describe, it, expect } from 'vitest';
import { derivePermitStatus } from '../lib/permitStatus';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// fix-25e: derivePermitStatus reuses getHighlightedMilestone's chain rule
// and reformats the result as a status pill ({ label, date, derived }).
// Falls back to permits.status when nothing is populated.

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: 'Pre-Submittal — GO',
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
    updated_at: '2026-05-15T12:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function cyc(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-15T12:00:00Z',
    ...over,
  };
}

describe('derivePermitStatus', () => {
  it('fresh permit (nothing populated) → falls back to stored permits.status, derived=false', () => {
    const r = derivePermitStatus(makePermit({ status: 'Pre-Submittal — GO' }));
    expect(r).toEqual({
      label: 'Pre-Submittal — GO',
      date: null,
      derived: false,
    });
  });

  it('fresh permit + null status column → falls back to default label', () => {
    const r = derivePermitStatus(makePermit({ status: null }));
    expect(r.label).toBe('Pre-Submittal — GO');
    expect(r.derived).toBe(false);
  });

  it('fresh permit + scraper-populated status → falls back to scraper value', () => {
    const r = derivePermitStatus(makePermit({ status: 'Reviews In Process' }));
    expect(r).toEqual({
      label: 'Reviews In Process',
      date: null,
      derived: false,
    });
  });

  it('target_submit populated, no cycles → "Target Submit" + date, derived=true', () => {
    const r = derivePermitStatus(makePermit({ target_submit: '2026-06-01' }));
    expect(r).toEqual({
      label: 'Target Submit',
      date: '2026-06-01',
      derived: true,
    });
  });

  it('cycle 0 with submitted only → "Initial Submit" + date', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [cyc({ cycle_index: 0, submitted: '2026-05-15' })],
      }),
    );
    expect(r).toEqual({
      label: 'Initial Submit',
      date: '2026-05-15',
      derived: true,
    });
  });

  it('cycle 0 with submitted + intake_accepted → "Intake Accepted" + date (chain-position)', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({
            cycle_index: 0,
            submitted: '2026-05-15',
            intake_accepted: '2026-05-21',
          }),
        ],
      }),
    );
    expect(r).toEqual({
      label: 'Intake Accepted',
      date: '2026-05-21',
      derived: true,
    });
  });

  it('cycle 1 with submitted (snap value) → "Submitted (Cycle 1)" + date', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({
            cycle_index: 0,
            submitted: '2026-05-15',
            intake_accepted: '2026-05-21',
          }),
          cyc({ cycle_index: 1, submitted: '2026-05-21' }),
        ],
      }),
    );
    expect(r).toEqual({
      label: 'Submitted (Cycle 1)',
      date: '2026-05-21',
      derived: true,
    });
  });

  it('cycle 1 with corr_issued → "Corr Required (Cycle 1)" + date', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({ cycle_index: 0, intake_accepted: '2026-05-21' }),
          cyc({
            cycle_index: 1,
            submitted: '2026-05-21',
            city_target: '2026-06-15',
            corr_issued: '2026-06-12',
          }),
        ],
      }),
    );
    expect(r.label).toBe('Corr Required (Cycle 1)');
    expect(r.date).toBe('2026-06-12');
    expect(r.derived).toBe(true);
  });

  it('cycle 2 with corr_issued → "Corr Required (Cycle 2)" + date (highest cycle wins)', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({ cycle_index: 0, intake_accepted: '2026-05-21' }),
          cyc({
            cycle_index: 1,
            submitted: '2026-05-21',
            corr_issued: '2026-06-12',
            resubmitted: '2026-06-25',
          }),
          cyc({
            cycle_index: 2,
            submitted: '2026-06-25',
            corr_issued: '2026-07-15',
          }),
        ],
      }),
    );
    expect(r.label).toBe('Corr Required (Cycle 2)');
    expect(r.date).toBe('2026-07-15');
  });

  it('cycle 1 with resubmitted → "Resubmitted (Cycle 1)" + date', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({ cycle_index: 0, intake_accepted: '2026-05-21' }),
          cyc({
            cycle_index: 1,
            submitted: '2026-05-21',
            corr_issued: '2026-06-12',
            resubmitted: '2026-06-25',
          }),
        ],
      }),
    );
    expect(r.label).toBe('Resubmitted (Cycle 1)');
    expect(r.date).toBe('2026-06-25');
  });

  it('approval_date populated → "Approved" + date (overrides cycle state)', () => {
    const r = derivePermitStatus(
      makePermit({
        approval_date: '2026-08-01',
        permit_cycles: [
          cyc({ cycle_index: 1, submitted: '2026-05-21', corr_issued: '2026-06-12' }),
        ],
      }),
    );
    expect(r).toEqual({
      label: 'Approved',
      date: '2026-08-01',
      derived: true,
    });
  });

  it('actual_issue populated → "Issued" + date (highest precedence)', () => {
    const r = derivePermitStatus(
      makePermit({
        actual_issue: '2026-08-15',
        approval_date: '2026-08-01',
        permit_cycles: [cyc({ cycle_index: 1, submitted: '2026-05-21' })],
      }),
    );
    expect(r).toEqual({
      label: 'Issued',
      date: '2026-08-15',
      derived: true,
    });
  });

  it('cycle 1 with city_target only → "City Target (Cycle 1)" + date (chain-position: city_target above submitted in REVIEW chain)', () => {
    const r = derivePermitStatus(
      makePermit({
        permit_cycles: [
          cyc({ cycle_index: 0, intake_accepted: '2026-05-21' }),
          cyc({
            cycle_index: 1,
            submitted: '2026-05-21',
            city_target: '2026-06-15',
          }),
        ],
      }),
    );
    expect(r.label).toBe('City Target (Cycle 1)');
    expect(r.date).toBe('2026-06-15');
  });
});
