import { describe, it, expect } from 'vitest';
import {
  deriveLandUsePhase,
  isLandUsePermit,
  LAND_USE_PHASE_LABEL,
  type DeriveLandUsePhaseInput,
} from '../lib/landUsePhase';
import type { PermitCycle } from '../lib/database.types';

// fix-169: land-use phase derivation. One model, optional phases — the deriver
// returns the FURTHEST phase reached; missing milestones skip a phase. Until the
// scraper (fix-78) populates the milestone columns they're NULL, so the badge
// falls back to the cycle-derived phase.

function cyc(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 1,
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

type PermitLike = DeriveLandUsePhaseInput['permit'];
function lu(over: Partial<PermitLike> = {}): PermitLike {
  return {
    type: 'ULS',
    num: 'LUP-1001',
    status: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    design_review_date: null,
    decision_published_date: null,
    publication_end_date: null,
    ...over,
  };
}

const TODAY = new Date(2026, 5, 20); // 2026-06-20 local

describe('isLandUsePermit', () => {
  it('true for ULS / LBA / Short Plat types', () => {
    expect(isLandUsePermit({ type: 'ULS' })).toBe(true);
    expect(isLandUsePermit({ type: 'LBA' })).toBe(true);
    expect(isLandUsePermit({ type: 'Short Plat' })).toBe(true);
  });
  it('true when the permit number ends in -LU (subtype-agnostic)', () => {
    expect(isLandUsePermit({ type: 'Something', num: '3045678-LU' })).toBe(true);
    expect(isLandUsePermit({ type: null, num: '9999-lu' })).toBe(true);
  });
  it('false for non-LU permits + null', () => {
    expect(isLandUsePermit({ type: 'Building Permit', num: '7105181-CN' })).toBe(false);
    expect(isLandUsePermit(null)).toBe(false);
    expect(isLandUsePermit({ type: null, num: null })).toBe(false);
  });
});

describe('deriveLandUsePhase', () => {
  it('returns null for a non-land-use permit (no LU phase/badge)', () => {
    expect(
      deriveLandUsePhase({ permit: lu({ type: 'Building Permit', num: '123-CN' }), cycles: [] }),
    ).toBeNull();
  });

  it('no milestones, no cycles → Intake', () => {
    const r = deriveLandUsePhase({ permit: lu(), cycles: [], today: TODAY });
    expect(r?.phase).toBe('intake');
  });

  it('no milestones, a submitted cycle → In Review (cycle-based fallback)', () => {
    const r = deriveLandUsePhase({
      permit: lu(),
      cycles: [cyc({ cycle_index: 0, submitted: '2026-02-01' })],
      today: TODAY,
    });
    expect(r?.phase).toBe('in_review');
    expect(r?.date).toBe('2026-02-01');
  });

  it('open corrections cycle (corr_issued && !resubmitted) → Corrections', () => {
    const r = deriveLandUsePhase({
      permit: lu(),
      cycles: [
        cyc({ cycle_index: 0, submitted: '2026-02-01' }),
        cyc({ cycle_index: 1, submitted: '2026-03-01', corr_issued: '2026-03-20' }),
      ],
      today: TODAY,
    });
    expect(r?.phase).toBe('corrections');
    expect(r?.date).toBe('2026-03-20');
  });

  it('design_review_date set, no decision → Design Review', () => {
    const r = deriveLandUsePhase({
      permit: lu({ design_review_date: '2026-04-10' }),
      cycles: [cyc({ cycle_index: 0, submitted: '2026-02-01' })],
      today: TODAY,
    });
    expect(r?.phase).toBe('design_review');
    expect(r?.date).toBe('2026-04-10');
  });

  it('design review beats an open corrections cycle (furthest phase wins)', () => {
    const r = deriveLandUsePhase({
      permit: lu({ design_review_date: '2026-04-10' }),
      cycles: [cyc({ cycle_index: 1, corr_issued: '2026-03-20' })],
      today: TODAY,
    });
    expect(r?.phase).toBe('design_review');
  });

  it('decision_published + publication_end in the future → In Publication until X', () => {
    const r = deriveLandUsePhase({
      permit: lu({
        design_review_date: '2026-04-10',
        decision_published_date: '2026-06-16',
        publication_end_date: '2026-06-30',
      }),
      cycles: [],
      today: TODAY, // 2026-06-20 ≤ 2026-06-30
    });
    expect(r?.phase).toBe('in_publication');
    expect(r?.label).toBe(LAND_USE_PHASE_LABEL.in_publication);
    expect(r?.until).toBe('2026-06-30');
    expect(r?.date).toBe('2026-06-16');
  });

  it('decision_published, publication window closed, no final cycle → Decision Published', () => {
    const r = deriveLandUsePhase({
      permit: lu({
        decision_published_date: '2026-05-20',
        publication_end_date: '2026-06-03',
      }),
      cycles: [],
      today: TODAY, // 2026-06-20 > 2026-06-03
    });
    expect(r?.phase).toBe('decision_published');
    expect(r?.until).toBeNull();
  });

  it('a review cycle submitted AFTER the publication window → Final Review', () => {
    const r = deriveLandUsePhase({
      permit: lu({
        decision_published_date: '2026-05-20',
        publication_end_date: '2026-06-03',
      }),
      cycles: [
        cyc({ cycle_index: 1, submitted: '2026-03-01' }), // before window — ignored
        cyc({ cycle_index: 2, submitted: '2026-06-10' }), // after window → final review
      ],
      today: TODAY,
    });
    expect(r?.phase).toBe('final_review');
    expect(r?.date).toBe('2026-06-10');
  });

  it('approval_date set → Recorded', () => {
    const r = deriveLandUsePhase({
      permit: lu({ approval_date: '2026-06-15', decision_published_date: '2026-05-01' }),
      cycles: [],
      today: TODAY,
    });
    expect(r?.phase).toBe('recorded');
    expect(r?.date).toBe('2026-06-15');
  });

  it('actual_issue set → Recorded (wins over everything)', () => {
    const r = deriveLandUsePhase({
      permit: lu({ actual_issue: '2026-06-18', design_review_date: '2026-04-10' }),
      cycles: [cyc({ cycle_index: 0, corr_issued: '2026-03-01' })],
      today: TODAY,
    });
    expect(r?.phase).toBe('recorded');
    expect(r?.date).toBe('2026-06-18');
  });

  it('terminal-positive status → Recorded', () => {
    const r = deriveLandUsePhase({
      permit: lu({ status: 'Issued' }),
      cycles: [],
      today: TODAY,
    });
    expect(r?.phase).toBe('recorded');
  });

  it('intake_date present, nothing submitted → Intake with the intake date', () => {
    const r = deriveLandUsePhase({
      permit: lu({ intake_date: '2026-01-15' }),
      cycles: [cyc({ cycle_index: 0, intake_accepted: '2026-01-20' })],
      today: TODAY,
    });
    expect(r?.phase).toBe('intake');
    expect(r?.date).toBe('2026-01-15');
  });
});
