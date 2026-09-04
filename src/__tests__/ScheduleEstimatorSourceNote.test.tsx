import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ratioInWords,
  recencyWindowLabel,
  routeSentence,
} from '../lib/estimatorRouteCopy';
import { cohortLabelFrom } from '../lib/projectedApproval';

// ===========================================================================
// ★★★ fix-491 (P-117) — THE FOOTNOTE SAYS WHICH ROUTE, IN NUMBERS
// ===========================================================================
//
// Bobby, 2026-08-31, on `554 N 75th St` — Seattle Building Permit,
// pre-submittal, estimate 2027-03-12, footnote *"Holistic projection — learner
// expects approval in the first review with no corrections"*:
//
//   *"I don't see how our historical permit data shows we're going to get
//    through without any corrections."*
//
// ★★★ HE WAS RIGHT ABOUT THE SENTENCE AND THE DATE WAS RIGHT TOO. The widget
//     branched on `targetCycle === 1`, which on the holistic route is a
//     CODE-PATH MARKER — that branch never walks cycles. The date is
//     `intake + avgIntakeToApproval`, and that average ALREADY CONTAINS the
//     correction rounds of the cohort it came from. The learner's real pick for
//     that cohort is cycle 3; cycle 1 was 0 of 32.
//
// ★★ THE OLD SENTENCE WAS NEVER TESTED, which is how it survived. These are the
//    assertions that would have caught it.

// ---------------------------------------------------------------------------
// THE RATIO
// ---------------------------------------------------------------------------

describe('fix-491: ratioInWords — a proportion as people say it', () => {
  it('★★★ 28 of 32 is "9 in 10" — and the BRIEF SAID "3 in 4"', () => {
    // ★★★ A CORRECTION TO THE BRIEF, reported in the PR rather than absorbed.
    //     It specified *"3 in 4" from 28/32*. 28/32 is **0.875**, and the
    //     nearest familiar ratio is 9 in 10 (0.9, off by 0.025) — "3 in 4"
    //     (0.75) is off by 0.125, five times further.
    //
    // ★★★ AND ROUNDING IT DOWN WOULD REPEAT THIS TICKET'S OWN DEFECT. fix-491
    //     exists because the footnote UNDERSTATED how often corrections happen
    //     ("approval in the first review with no corrections"). Printing "3 in
    //     4" where the data says nearly nine in ten would be a smaller version
    //     of the same lie, in the sentence written to end it.
    expect(ratioInWords(28, 32)).toBe('9 in 10');
    // ★ …and "3 in 4" is what a cohort that actually is three-quarters gets.
    expect(ratioInWords(24, 32)).toBe('3 in 4');
  });

  it('★★★ 2 of 32 is "fewer than 1 in 10", NOT "0 in 10"', () => {
    // ★★ "0 in 10" reads as *never*, and a two-in-thirty-two sample cannot
    //    support "never" any more than it supports "always".
    expect(ratioInWords(2, 32)).toBe('fewer than 1 in 10');
  });

  it('★★ the familiar rungs, and the two ends', () => {
    expect(ratioInWords(16, 32)).toBe('1 in 2');
    expect(ratioInWords(21, 32)).toBe('2 in 3');
    expect(ratioInWords(8, 32)).toBe('1 in 4');
    expect(ratioInWords(29, 32)).toBe('9 in 10');
    expect(ratioInWords(32, 32)).toBe('every one');
    expect(ratioInWords(0, 32)).toBe('fewer than 1 in 10');
  });

  it('★★ it never divides by zero or prints NaN', () => {
    expect(ratioInWords(0, 0)).toBe('fewer than 1 in 10');
    expect(ratioInWords(1, Number.NaN)).toBe('');
  });
});

describe('fix-491: the window, in words', () => {
  it('★ every tier reads as a phrase, and `default` says nothing', () => {
    expect(recencyWindowLabel('last_90d')).toBe('last 90 days');
    expect(recencyWindowLabel('last_180d')).toBe('last 180 days');
    expect(recencyWindowLabel('last_365d')).toBe('last 365 days');
    expect(recencyWindowLabel('all_time')).toBe('all time');
    // ★ `'default'` means the cascade found nothing — there is no window to
    //   name, so it must not invent one.
    expect(recencyWindowLabel('default')).toBe('');
  });
});

describe('fix-491: the cohort label', () => {
  it('★★ "30 Seattle Building Permits" out of the learner\'s source string', () => {
    expect(cohortLabelFrom('Last 90d · Building Permit · Seattle', 30)).toBe(
      '30 Seattle Building Permits',
    );
    expect(cohortLabelFrom('All-time · Demolition · Bellevue', 7)).toBe(
      '7 Bellevue Demolitions',
    );
  });

  it('★ one permit stays singular', () => {
    expect(cohortLabelFrom('Last 90d · Building Permit · Seattle', 1)).toBe(
      '1 Seattle Building Permit',
    );
  });

  it('★★★ an unexpected shape falls back to the raw source, never to a guess', () => {
    // ★★ `source` is a DIAGNOSTIC string from `buildEstimate`. Parsing a
    //    producer's diagnostics is fragile by nature, so the failure mode is
    //    "print what we were given" rather than a confidently-wrong phrase —
    //    the rule this whole ticket enforces.
    expect(cohortLabelFrom('something else', 12)).toBe('something else');
    expect(cohortLabelFrom('', 12)).toBe('');
    expect(cohortLabelFrom(null, 12)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// THE SENTENCES — one per route, exactly as approved 2026-09-04
// ---------------------------------------------------------------------------

const SEATTLE_BP = {
  cohortLabel: '30 Seattle Building Permits',
  sampleCount: 32,
  recencyTier: 'last_90d' as const,
  avgIntakeToApproval: 160,
  mostLikelyCycle: 3,
  cycleDist: { 1: 0, 2: 4, 3: 16, 4: 12 } as Record<1 | 2 | 3 | 4, number>,
};

describe('fix-491: the sentence for every route', () => {
  it('★★★ holistic_learned — THE BUG, in the words that replace it', () => {
    // ★★★ The old sentence said the learner expected approval in the FIRST
    //     REVIEW WITH NO CORRECTIONS. The new one says the opposite, because
    //     the opposite is what the data says: 28 of 32 needed two or more
    //     rounds, and the 160-day average already contains them.
    expect(routeSentence('holistic_learned', SEATTLE_BP)).toBe(
      'Based on 30 Seattle Building Permits approved in the last 90 days: ' +
        'intake to approval averaged 160 days, and 9 in 10 needed two or more ' +
        'correction rounds. This date is that average, not a round-by-round walk.',
    );
  });

  it('★★ …and the outlier note only appears when there were outliers', () => {
    expect(routeSentence('holistic_learned', SEATTLE_BP)).not.toContain('outlier');
    expect(
      routeSentence('holistic_learned', { ...SEATTLE_BP, filteredCount: 2 }),
    ).toContain('(2 outliers excluded)');
    expect(
      routeSentence('holistic_learned', { ...SEATTLE_BP, filteredCount: 1 }),
    ).toContain('(1 outlier excluded)');
  });

  it('★★★ "two or more correction rounds" counts cycles 3 AND 4, not 2', () => {
    // ★★★ A permit approved in cycle 2 went through ONE correction round, so
    //     two-or-more starts at cycle 3. An off-by-one here would be the same
    //     class of error the ticket exists to fix — a confident sentence about
    //     a number that means something else.
    const noneAtAll = {
      ...SEATTLE_BP,
      cycleDist: { 1: 0, 2: 32, 3: 0, 4: 0 } as Record<1 | 2 | 3 | 4, number>,
    };
    expect(routeSentence('holistic_learned', noneAtAll)).toContain(
      'fewer than 1 in 10 needed two or more correction rounds',
    );
  });

  it('★★ holistic_default — says there is no history BEFORE giving the number', () => {
    expect(
      routeSentence('holistic_default', { defaultDays: 210 }, {
        type: 'Building Permit',
        juris: 'Seattle',
      }),
    ).toBe(
      'No learned history yet for Building Permits in Seattle. Using the ' +
        'default of 210 days from intake for this permit type.',
    );
  });

  it('★★★ walk_learned — the cohort, the rounds, and the legend', () => {
    expect(
      routeSentence('walk_learned', { ...SEATTLE_BP, correctionRounds: 2 }),
    ).toBe(
      'Projected round by round from 30 Seattle Building Permits (last 90 ' +
        'days): 2 correction rounds, then a final review. Grey dates are ' +
        'projected; dates with a check mark are what the city actually recorded.',
    );
  });

  it('★★ walk_default — names the type and the jurisdiction it lacks', () => {
    expect(
      routeSentence('walk_default', { correctionRounds: 2 }, {
        type: 'Building Permit',
        juris: 'Seattle',
      }),
    ).toBe(
      'Projected round by round using default durations for Building ' +
        'Permits — no learned history yet for Seattle. 2 correction rounds, ' +
        'then a final review. Grey dates are projected; dates with a check ' +
        'mark are what the city actually recorded.',
    );
  });

  it('★★ walk_override — the target was set by hand, and says so first', () => {
    expect(
      routeSentence('walk_override', { correctionRounds: 2, overrideCycle: 3 }),
    ).toBe(
      'Target set by hand to cycle 3. Projected round by round from there. ' +
        'Grey dates are projected; dates with a check mark are what the city ' +
        'actually recorded.',
    );
  });

  it('★★★ the reviewer bump appends to ANY walk route, and explains itself', () => {
    for (const route of ['walk_learned', 'walk_default', 'walk_override'] as const) {
      const s = routeSentence(
        route,
        { ...SEATTLE_BP, correctionRounds: 2, overrideCycle: 3, reviewerBumpCycle: 2 },
        { type: 'Building Permit', juris: 'Seattle' },
      );
      expect(s, route).toContain(
        'Reviewers flagged corrections on cycle 2, so one more round was added.',
      );
    }
    // ★ …and never appears when nothing was bumped.
    expect(
      routeSentence('walk_learned', { ...SEATTLE_BP, correctionRounds: 2 }),
    ).not.toContain('Reviewers flagged');
  });

  it('★★ singular and plural — "1 correction round", "2 correction rounds"', () => {
    expect(
      routeSentence('walk_learned', { ...SEATTLE_BP, correctionRounds: 1 }),
    ).toContain('1 correction round,');
    expect(
      routeSentence('walk_learned', { ...SEATTLE_BP, correctionRounds: 2 }),
    ).toContain('2 correction rounds,');
    expect(
      routeSentence('walk_learned', { ...SEATTLE_BP, correctionRounds: 0 }),
    ).toContain('0 correction rounds,');
  });

  it('★ uls_anchor and none keep their meaning, in plain words', () => {
    expect(routeSentence('uls_anchor', {})).toBe(
      "Anchored to the sibling Building Permit's expected issue date plus 120 days.",
    );
    expect(routeSentence('none', {})).toBe(
      'Not enough data to project an approval date yet.',
    );
  });

  it('★★★ an ACTUAL date says nothing at all — as before', () => {
    expect(routeSentence('actual', {})).toBeNull();
    expect(routeSentence(undefined, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE BANNED VOCABULARY
// ---------------------------------------------------------------------------

describe('fix-491: no sentence borrows the old voice', () => {
  const ROUTES = [
    'holistic_learned',
    'holistic_default',
    'walk_learned',
    'walk_default',
    'walk_override',
    'uls_anchor',
    'none',
  ] as const;

  it('★★★ "learner", "holistic", "walked", "derived", "buffer" and a bare ✓ are gone', () => {
    // ★★★ EACH BANNED WORD IS A SPECIFIC FAILURE, not a style preference:
    //     "learner" attributed a claim to a component that never made it;
    //     "holistic" and "walked" are the names of code paths; "derived" and
    //     "buffer" are engineering words for a reader who does not have the
    //     code; and "✓" was being used as a WORD in a sentence rather than as
    //     a mark beside a date.
    for (const route of ROUTES) {
      const s =
        routeSentence(
          route,
          {
            ...SEATTLE_BP,
            correctionRounds: 2,
            overrideCycle: 3,
            defaultDays: 210,
            filteredCount: 2,
            reviewerBumpCycle: 2,
          },
          { type: 'Building Permit', juris: 'Seattle' },
        ) ?? '';
      for (const banned of [
        'learner',
        'holistic',
        'walked',
        'derived',
        'buffer',
        '✓',
      ]) {
        expect(s.toLowerCase(), `${route} / ${banned}`).not.toContain(banned);
      }
    }
  });

  it('★★★ …and the old sentences are GONE from the component', () => {
    // ★★ The pair Bobby quoted, asserted absent by their exact words. This is
    //    the half that fails on origin/main.
    //
    // ★★★ COMMENT-STRIPPED — THE NINTH TIME THIS REPO HAS MET THIS TRAP. The
    //     note explaining WHY the old sentence was wrong has to QUOTE the old
    //     sentence, so a raw grep finds it in the very comment that records its
    //     removal and fails for the opposite of the right reason.
    const src = stripComments(
      readFileSync(
        resolve(process.cwd(), 'src/components/ProjectDetail/ScheduleEstimator.tsx'),
        'utf8',
      ),
    );
    expect(src).not.toContain('learner expects approval in the first review');
    expect(src).not.toContain('Italic values are derived');
    expect(src).not.toContain('final review buffer');
    // ★ And the note no longer branches on the code-path marker.
    expect(src).not.toContain('result.targetCycle === 1');
  });

  it('★★★ §C: the note is 11px regular muted — a step UP from the body', () => {
    // ★★ Bobby's ruling, 2026-09-04. The widget's body is `text-[10px]` and its
    //    labels `text-[8px]`; the note was the smallest, faintest thing in the
    //    box while being the sentence people actually read.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/ScheduleEstimator.tsx'),
      'utf8',
    );
    const note = src.slice(src.indexOf('function SourceNote'));
    expect(note).toContain('text-[11px]');
    expect(note).toContain("fontStyle: 'normal'");
    expect(note).toContain("color: 'var(--color-muted)'");
    expect(note).not.toContain('text-[9px]');
  });

  it('★★★ §C: projected dates are GREY, so the sentence about them is true', () => {
    // ★★★ The note says "grey dates are projected". Before fix-491 they were
    //     `--color-text` — the same colour as everything else — and the whole
    //     distinction rode on an italic nobody reads as a legend. Saying it
    //     without doing it would have been a new version of the same defect.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/ScheduleEstimator.tsx'),
      'utf8',
    );
    expect(src).toContain(
      "color: it.isReal ? 'var(--color-pm)' : 'var(--color-muted)',",
    );
    // ★ The italic STAYS — two signals beat one.
    expect(src).toContain("fontStyle: it.isReal ? 'normal' : 'italic',");
  });
});

/** ★ Line and block comments removed, string literals kept — see the
 *  "comment-stripped" note above for the trap it exists for. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
