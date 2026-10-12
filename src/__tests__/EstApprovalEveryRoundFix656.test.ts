import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { routeSentence } from '../lib/estimatorRouteCopy';
import { FIX, cyc, learned, permit } from './fixtures656';
import PINNED from './fixtures/fix656_pinned_le4.json';

// ===========================================================================
// ★★★ fix-656 (P-341) — "Est. approval" walks EVERY review round, not 1–4.
// ===========================================================================

const TODAY = '2026-10-12';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

// 8256 Ashworth Ave N, SIP (permit 10305) — prod, 2026-10-12: six rounds, the
// sixth in corrections.
const C10305 = [
  cyc({ cycle_index: 1, submitted: '2025-11-14', city_target: '2025-11-18', corr_issued: '2025-12-17', resubmitted: '2025-12-22' }),
  cyc({ cycle_index: 2, submitted: '2025-12-22', city_target: '2026-06-18', resubmitted: '2026-02-06' }),
  cyc({ cycle_index: 3, submitted: '2026-02-06', city_target: '2026-03-17', corr_issued: '2026-03-12', resubmitted: '2026-03-24' }),
  cyc({ cycle_index: 4, submitted: '2026-03-24', city_target: '2026-04-15', corr_issued: '2026-04-10', resubmitted: '2026-05-18' }),
  cyc({ cycle_index: 5, submitted: '2026-05-18', city_target: '2026-06-23', corr_issued: '2026-06-18', resubmitted: '2026-08-06' }),
  cyc({ cycle_index: 6, submitted: '2026-08-06', city_target: '2026-09-19', corr_issued: '2026-09-14' }),
];

describe('fix-656: rounds 5+ are walked with their real dates', () => {
  it('a 6-round permit uses its round-5 and round-6 real dates', () => {
    const r = computeProjectedApproval({ permit: permit(), cycles: C10305, learnedEstimate: learned(2) });
    // Five actual correction rounds (2 has none) → it is on round 6, in corrections.
    expect(r.targetCycle).toBeGreaterThanOrEqual(6);
    expect(r.rounds).toMatchObject({
      corrIssued5: '2026-06-18',
      resubmitted5: '2026-08-06',
      corrIssued6: '2026-09-14',
    });
  });

  it('the open round past 4 projects forward, never into the past', () => {
    const cycles = [
      ...C10305.slice(0, 5),
      cyc({ cycle_index: 6, submitted: '2026-08-06' }),
    ];
    const r = computeProjectedApproval({ permit: permit(), cycles, learnedEstimate: learned(2) });
    expect(r.projection! >= TODAY).toBe(true);
    expect(r.projection! > '2026-08-06').toBe(true);
    for (const [k, v] of Object.entries(r.rounds ?? {})) {
      const n = Number(k.replace(/\D/g, ''));
      if (n >= 6 && v) expect(v >= TODAY).toBe(true);
    }
  });

  it('a round past the learner reuses the last learned round, and the sentence says so', () => {
    const r = computeProjectedApproval({ permit: permit(), cycles: C10305, learnedEstimate: learned(2) });
    expect(r.routeFacts?.roundsPastLearner).toBe(true);
    expect(routeSentence(r.route, r.routeFacts, { type: 'SIP', juris: 'Seattle' }))
      .toContain("Rounds past 4 reuse the last learned round's timing.");
  });
});

describe('fix-656: a permit with four rounds or fewer projects EXACTLY as before', () => {
  // The outputs in fixtures/fix656_pinned_le4.json were produced by the
  // pre-fix-656 code on these inputs. The only addition is the new route note
  // where a round past 4 is projected (an override to 8, or a fifth round).
  FIX.forEach((f, i) => {
    it(f.name, () => {
      const r = computeProjectedApproval(f.input as never);
      const facts = r.routeFacts ? { ...r.routeFacts } : r.routeFacts;
      if (facts) delete facts.roundsPastLearner;
      expect(JSON.parse(JSON.stringify({ ...r, routeFacts: facts }))).toEqual(PINNED[i]);
    });
  });
});
