import { describe, it, expect } from 'vitest';
import { targetApproval, addCalendarMonths } from '../lib/targetApproval';
import { formatUsDate } from '../lib/dateUtils';
import {
  lotDimensionsComplete,
  mayDeriveLotSize,
  lotSizeView,
} from '../lib/lotDimensions';

import healthSrc from '../components/ProjectDetail/ScheduleHealthTable.tsx?raw';

// ===========================================================================
// fix-512 §A (P-204) — THE BADGE AND THE COLUMN MEASURED AGAINST DIFFERENT DATES
// ===========================================================================
//
// VERIFIED ON PROD 2026-09-09. `4137 54th Ave SW`:
//
//   permits.expected_issue  2026-01-28      ← what the badge subtracted
//   projects.closing_date   2026-10-28
//   projects.go_date        2026-08-14      → + 6 months = 2027-02-14
//   Target Approval         2027-02-14      ← what the column printed
//
// Est. approval 2027-03-23 against the first is **419 days behind**; against
// the second it is **37**. 419 − 37 = 382, which is exactly the gap between the
// two targets. The badge's subtraction was never wrong; its minuend was.
//
// ★★★ THIS IS fix-508 §D's OTHER HALF, AND THE REASON THESE TWO SECTIONS ARE
//     ONE TICKET. §D moved Target Approval's WRITERS — the inline input left
//     Schedule Health for Project Data, the column went read-only — and left
//     its READERS where they were. `expected_issue` stopped being the answer
//     and became one of three candidates in a `max`, and nothing told the thing
//     that was still subtracting it.
//
//     **When a value becomes derived, enumerate every consumer of the old
//     value.** §A2's enumeration is in the fix-512 PR; three separate half-done
//     fix-508 sections came from nobody having had it.

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PROD = {
  expected_issue: '2026-01-28',
  closing_date: '2026-10-28',
  go_date: '2026-08-14',
} as const;

describe('fix-512 §A — the prod row, arithmetic first', () => {
  it('★★★ 4137 54th Ave SW: the two targets are 382 days apart', () => {
    const t = targetApproval(
      { closing_date: PROD.closing_date, go_date: PROD.go_date },
      { expected_issue: PROD.expected_issue },
    );
    expect(t.date).toBe('2027-02-14');
    expect(t.driver).toBe('go');
    const gap =
      (Date.parse(t.date! + 'T12:00:00') -
        Date.parse(PROD.expected_issue + 'T12:00:00')) /
      86_400_000;
    expect(Math.round(gap)).toBe(382);
  });

  it('★★★ …and the badge therefore moves 419 → 37, which is the reported number', () => {
    const projection = '2027-03-23';
    const days = (target: string) =>
      Math.round(
        (Date.parse(projection + 'T12:00:00') - Date.parse(target + 'T12:00:00')) /
          86_400_000,
      );
    expect(days(PROD.expected_issue)).toBe(419);
    expect(days('2027-02-14')).toBe(37);
  });

  it('★★★ the ACQ date is one of THREE candidates, so the target can never move EARLIER', () => {
    // ★ This is why 0 of 685 prod permits get a WORSE badge: `expected_issue`
    //   is itself in the `max`, so the new target is >= the old one for every
    //   row that has one. The board-wide improvement is structural, not luck —
    //   which is the sentence SHIPPED.md needs, because an unexplained
    //   board-wide improvement reads as somebody resetting the numbers.
    for (const closing of [null, '2020-01-01', '2030-01-01']) {
      for (const go of [null, '2020-01-01', '2030-01-01']) {
        const t = targetApproval(
          { closing_date: closing, go_date: go },
          { expected_issue: '2026-06-15' },
        );
        expect(t.date! >= '2026-06-15').toBe(true);
      }
    }
  });

  it('★★ a target can APPEAR where the ACQ date is absent — 167 prod permits', () => {
    // The direction the brief did not anticipate: no ACQ date meant no badge at
    // all, and a closing or GO date now supplies one.
    const t = targetApproval(
      { closing_date: '2026-12-01', go_date: null },
      { expected_issue: null },
    );
    expect(t.date).toBe('2026-12-01');
    expect(t.driver).toBe('closing');
  });

  it('★ …and with none of the three there is still no badge, not an epoch', () => {
    const t = targetApproval({ closing_date: null, go_date: null }, { expected_issue: null });
    expect(t.date).toBeNull();
    expect(t.driver).toBeNull();
  });

  it('★ the six-month step is CALENDAR months with the end-of-month clamp', () => {
    // 2026-08-31 has no 31st to land on six months later; JS `Date` rolls into
    // March and this clamps to the last day of February. Postgres's
    // `+ interval '6 months'` clamps the same way, which is what makes the prod
    // distribution in the PR comparable to what the app will render.
    expect(addCalendarMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addCalendarMonths('2026-08-14', 6)).toBe('2027-02-14');
  });
});

describe('fix-512 §A — the badge and the column, in the component', () => {
  it('★★★ ONE derivation per row, handed to both readers', () => {
    const c = code(healthSrc);
    // ★★★ fix-517 §C STRENGTHENS THIS RATHER THAN WEAKENING IT. Sortable
    //     headers cannot order by a number only the child knows, so the whole
    //     derivation moved into ONE parent pass and `Row` became presentational
    //     — the single-derivation rule now covers the SORT as well as the two
    //     readers. The expressions moved; the invariant is the same one.
    // The row model derives it once…
    expect(c).toContain('const target = targetApproval(project, permit);');
    // …the badge measures against THAT…
    expect(c).toContain('computeHealthDiff(approval.date, target.date)');
    // …and the cell is HANDED it rather than calling again.
    expect(c).toContain('<TargetApprovalCell permitId={permit.id} target={target} />');
  });

  it('★★★ the badge no longer subtracts expected_issue anywhere', () => {
    const c = code(healthSrc);
    expect(c).not.toContain('permit.expected_issue');
    expect(c).not.toMatch(/acqTarget/);
  });

  it('★★ `targetApproval` is called exactly ONCE in the file', () => {
    // Two call sites is how the badge and the column drifted apart in the first
    // place. This is the structural version of "assert equality rather than two
    // computations".
    const c = code(healthSrc);
    const calls = c.match(/targetApproval\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('★★★ the column prints the Dates card\'s format, not the raw ISO', () => {
    const c = code(healthSrc);
    expect(c).toContain('formatUsDate(target.date)');
    expect(formatUsDate('2027-02-14')).toBe('02/14/2027');
  });
});

// ===========================================================================
// fix-512 §B (P-192) — A LOT SIZE IS DERIVED ONLY WHEN BOTH DIMENSIONS EXIST
// ===========================================================================

describe('fix-512 §B — the derivation rule', () => {
  it('★★★ refused with one dimension missing', () => {
    expect(mayDeriveLotSize(60, null)).toBe(false);
    expect(mayDeriveLotSize(null, 100)).toBe(false);
    expect(mayDeriveLotSize(null, null)).toBe(false);
    // …and the view produces no size at all, rather than a half-guess.
    const w = lotSizeView(60, null, null);
    expect(w.sizeSf).toBeNull();
    expect(w.sizeDerived).toBe(false);
    expect(w.sizeText).toBeNull();
  });

  it('★★★ permitted with both, and marked as ARITHMETIC not survey', () => {
    expect(mayDeriveLotSize(60, 100)).toBe(true);
    const v = lotSizeView(60, 100, null);
    expect(v.sizeSf).toBe(6_000);
    expect(v.sizeDerived).toBe(true);
  });

  it('★★ a TYPED size is never refused — the rule bounds derivation, not entry', () => {
    // Bobby's case: an irregular parcel whose area somebody measured. One
    // dimension, a typed size, and the size stands.
    const v = lotSizeView(60, null, 7_200);
    expect(v.sizeSf).toBe(7_200);
    expect(v.sizeDerived).toBe(false);
    expect(v.depthVaries).toBe(true);
  });

  it('★ zero is not a dimension — the Library\'s 0 sentinel cannot derive', () => {
    expect(lotDimensionsComplete(0, 100)).toBe(false);
    expect(mayDeriveLotSize(60, 0)).toBe(false);
    expect(lotSizeView(0, 100, null).sizeSf).toBeNull();
  });

  it('★★★ ONE PREDICATE, TWO CONSUMERS — P-192 and P-161 are the same condition', () => {
    // P-161 (fix-506 §C): "width × depth both present reads as a rectangle;
    // one of them plus a lot size reads as irregular." That is this predicate
    // and its negation, so the two rules cannot drift.
    for (const [w, d] of [
      [60, 100],
      [60, null],
      [null, 100],
      [null, null],
    ] as const) {
      const complete = lotDimensionsComplete(w, d);
      expect(mayDeriveLotSize(w, d)).toBe(complete);
      // The shape is only ASSERTED (a "varies" side) when the dimensions are
      // incomplete AND somebody typed an area to assert it against.
      const v = lotSizeView(w, d, 7_200);
      expect(v.widthVaries || v.depthVaries).toBe(!complete && (w !== null || d !== null));
    }
  });

  it('★★ …and a derived size can never be irregular, because it IS the product', () => {
    const v = lotSizeView(60, 100, null);
    expect(v.irregular).toBe(false);
    // Irregularity is a disagreement, so it needs two independent numbers.
    expect(lotSizeView(60, 100, 12_000).irregular).toBe(true);
  });
});
