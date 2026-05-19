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

  it('target_submit populated, no cycle progress → falls back to stored status (fix-25e Project Overview)', () => {
    // Bobby's stance (2026-05-17): target_submit is a planned date, not a
    // lifecycle milestone. Post fix-25-feat-i/-j most permits have a
    // computed target_submit, so the previous "Target Submit" pill was
    // taking over from the stored "Pre-Submittal — GO" everywhere.
    const r = derivePermitStatus(
      makePermit({ target_submit: '2026-06-01', status: 'Pre-Submittal — GO' }),
    );
    expect(r).toEqual({
      label: 'Pre-Submittal — GO',
      date: null,
      derived: false,
    });
  });

  it('target_submit + cycle 0 with submitted set → cycle wins over target_submit', () => {
    // Sanity: target_submit fallback only kicks in when the cycle chain
    // is empty. Any real cycle progress still drives the derived label.
    const r = derivePermitStatus(
      makePermit({
        target_submit: '2026-06-01',
        permit_cycles: [cyc({ cycle_index: 0, submitted: '2026-05-15' })],
      }),
    );
    expect(r).toEqual({
      label: 'Initial Submit',
      date: '2026-05-15',
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

  // ============================================================
  // fix-31c (2026-05-19): terminal-positive permit.status override
  // ============================================================
  describe('terminal-positive status override (fix-31c)', () => {
    it('Conceptually Approved + stale cycle.corr_issued → permit.status wins, no "(Cycle N)" suffix', () => {
      // SDOTTRLA0002310 scenario verbatim: city resolved a historical
      // correction at the parent level (permit.status moved to
      // Conceptually Approved) but cycle 1.corr_issued still holds
      // the date. Pre fix-31c the pill said "Corr Required (Cycle 1)";
      // post fix-31c it mirrors permit.status.
      const r = derivePermitStatus(
        makePermit({
          status: 'Conceptually Approved',
          permit_cycles: [
            cyc({
              cycle_index: 1,
              submitted: '2026-04-10',
              corr_issued: '2026-05-06',
            }),
          ],
        }),
      );
      expect(r.label).toBe('Conceptually Approved');
      expect(r.label).not.toContain('Cycle');
      expect(r.derived).toBe(false);
    });

    it('Conceptually Approved + approval_date set → date surfaces from approval_date', () => {
      const r = derivePermitStatus(
        makePermit({
          status: 'Conceptually Approved',
          approval_date: '2026-05-07',
        }),
      );
      expect(r).toEqual({
        label: 'Conceptually Approved',
        date: '2026-05-07',
        derived: false,
      });
    });

    it('Issued status + actual_issue set → actual_issue beats approval_date for date', () => {
      const r = derivePermitStatus(
        makePermit({
          status: 'Issued',
          actual_issue: '2026-05-10',
          approval_date: '2026-05-07',
        }),
      );
      expect(r).toEqual({
        label: 'Issued',
        date: '2026-05-10',
        derived: false,
      });
    });

    it('terminal status + neither outcome date set → label only, date null', () => {
      // Some statuses (e.g. "Closed") may land before formal approval_date
      // is recorded. The pill renders without a date suffix.
      const r = derivePermitStatus(
        makePermit({ status: 'Closed' }),
      );
      expect(r).toEqual({
        label: 'Closed',
        date: null,
        derived: false,
      });
    });

    it('every TERMINAL_POSITIVE_STATUSES value triggers override', () => {
      for (const status of [
        'Conceptually Approved',
        'Approved',
        'Issued',
        'Completed',
        'Ready for Issuance',
        'Closed',
      ]) {
        const r = derivePermitStatus(
          makePermit({
            status,
            permit_cycles: [
              cyc({ cycle_index: 1, corr_issued: '2026-05-06' }),
            ],
          }),
        );
        expect(r.label).toBe(status);
        expect(r.label).not.toContain('Cycle');
      }
    });

    it('whitespace-padded status still triggers override', () => {
      const r = derivePermitStatus(
        makePermit({ status: '  Conceptually Approved  ' }),
      );
      expect(r.label).toBe('Conceptually Approved');
    });

    it('non-terminal status (e.g. Reviews In Process) falls through to cycle-derived label', () => {
      // Sanity: no regression on the pre-fix-31c path. Matches the
      // setup of the standalone "cycle 1 with corr_issued" test above
      // (cycle 0.intake_accepted populated so the chain advances past
      // the design slot before evaluating cycle 1's corr_issued).
      const r = derivePermitStatus(
        makePermit({
          status: 'Reviews In Process',
          permit_cycles: [
            cyc({ cycle_index: 0, intake_accepted: '2026-04-08' }),
            cyc({
              cycle_index: 1,
              submitted: '2026-04-10',
              corr_issued: '2026-05-06',
            }),
          ],
        }),
      );
      expect(r.label).toBe('Corr Required (Cycle 1)');
      expect(r.date).toBe('2026-05-06');
      expect(r.derived).toBe(true);
    });
  });
});
