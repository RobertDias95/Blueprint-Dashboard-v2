import { describe, it, expect } from 'vitest';
import {
  derivePermitStatus,
  isApprovedNotIssued,
  APPROVED_NOT_ISSUED_LABEL,
} from '../lib/permitStatus';
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
    // Non-BP/Demo type: this exercises the cycle-chain "Approved" label
    // (approval_date milestone). For Building Permit / Demolition the same
    // data now reads "Approved — Not Issued" (fix-52, covered below).
    const r = derivePermitStatus(
      makePermit({
        type: 'SDOT Tree',
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
      // Uses an SDOT type ("Conceptually Approved" is an SDOT portal status):
      // fix-52 only re-labels Building Permit / Demolition as "Approved — Not
      // Issued", so a non-BP/Demo type still exercises the fix-31c terminal
      // override in isolation.
      const r = derivePermitStatus(
        makePermit({
          type: 'SDOT Tree',
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

  // ============================================================
  // fix-52 (2026-05-24): "Approved — Not Issued" for BP / Demolition
  // approved (approval_date set) but not yet issued (actual_issue null).
  // ============================================================
  describe('Approved — Not Issued (fix-52)', () => {
    it('held Demolition (portal "Awaiting Information") → "Approved — Not Issued", portal status as detail', () => {
      // 7122576-DM shape: city approved at Issuance-Prep entry, held on a
      // builder condition, portal status still the ambiguous "Awaiting
      // Information".
      const r = derivePermitStatus(
        makePermit({
          type: 'Demolition',
          status: 'Awaiting Information',
          approval_date: '2026-04-15',
          actual_issue: null,
        }),
      );
      expect(r.label).toBe(APPROVED_NOT_ISSUED_LABEL);
      expect(r.label).toBe('Approved — Not Issued');
      expect(r.date).toBe('2026-04-15');
      expect(r.detail).toBe('Awaiting Information'); // ready-vs-held nuance kept
      expect(r.derived).toBe(false);
    });

    it('ready Demolition (portal "Ready for Issuance") → "Approved — Not Issued", overriding the terminal-positive passthrough', () => {
      const r = derivePermitStatus(
        makePermit({
          type: 'Demolition',
          status: 'Ready for Issuance',
          approval_date: '2026-05-06',
          actual_issue: null,
        }),
      );
      expect(r.label).toBe(APPROVED_NOT_ISSUED_LABEL);
      expect(r.detail).toBe('Ready for Issuance');
    });

    it('Building Permit approved-not-issued behaves the same as Demolition', () => {
      const r = derivePermitStatus(
        makePermit({
          type: 'Building Permit',
          status: 'Ready for Issuance',
          approval_date: '2026-02-19',
          actual_issue: null,
        }),
      );
      expect(r.label).toBe(APPROVED_NOT_ISSUED_LABEL);
      expect(r.date).toBe('2026-02-19');
    });

    it('issued (actual_issue set) still reads "Issued" — Issued wins over fix-52', () => {
      const r = derivePermitStatus(
        makePermit({
          type: 'Demolition',
          status: 'Issued',
          approval_date: '2026-04-15',
          actual_issue: '2026-05-11',
        }),
      );
      expect(r.label).toBe('Issued');
      expect(r.date).toBe('2026-05-11');
      expect(r.detail).toBeUndefined();
    });

    it('non-BP/Demo type with approval_date set + actual_issue null is unaffected', () => {
      // An SDOT permit keeps the fix-31c terminal-positive passthrough; it is
      // never relabeled "Approved — Not Issued".
      const r = derivePermitStatus(
        makePermit({
          type: 'SDOT Tree',
          status: 'Ready for Issuance',
          approval_date: '2026-05-06',
          actual_issue: null,
        }),
      );
      expect(r.label).toBe('Ready for Issuance');
      expect(r.detail).toBeUndefined();
    });

    it('BP/Demo not yet approved (approval_date null) is unaffected', () => {
      const r = derivePermitStatus(
        makePermit({
          type: 'Demolition',
          status: 'Corrections Required',
          approval_date: null,
          actual_issue: null,
          permit_cycles: [
            cyc({ cycle_index: 0, intake_accepted: '2026-04-08' }),
            cyc({ cycle_index: 1, submitted: '2026-04-10', corr_issued: '2026-05-06' }),
          ],
        }),
      );
      expect(r.label).not.toBe(APPROVED_NOT_ISSUED_LABEL);
    });

    it('isApprovedNotIssued matches the same predicate', () => {
      expect(
        isApprovedNotIssued(
          makePermit({ type: 'Demolition', approval_date: '2026-04-15', actual_issue: null }),
        ),
      ).toBe(true);
      expect(
        isApprovedNotIssued(
          makePermit({ type: 'Building Permit', approval_date: '2026-04-15', actual_issue: '2026-05-01' }),
        ),
      ).toBe(false);
      expect(
        isApprovedNotIssued(
          makePermit({ type: 'SDOT Tree', approval_date: '2026-04-15', actual_issue: null }),
        ),
      ).toBe(false);
      expect(
        isApprovedNotIssued(
          makePermit({ type: 'Demolition', approval_date: null, actual_issue: null }),
        ),
      ).toBe(false);
    });
  });
});
