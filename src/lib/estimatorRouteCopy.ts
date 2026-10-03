import type {
  ProjectedApprovalRoute,
  ProjectedApprovalRouteFacts,
} from './projectedApproval';
import type { RecencyTier } from './scheduleBenchmarks';
import type { EstimatorInput, InputResolution } from './estimatorInputs';

// ===========================================================================
// ★★★ fix-491 (P-117) — THE ESTIMATOR SAYS WHICH ROUTE THE DATE TOOK
// ===========================================================================
//
// Bobby, 2026-08-31, on `554 N 75th St`: *"I don't see how our historical
// permit data shows we're going to get through without any corrections."*
//
// He was right about the sentence and the date was right too. The widget
// printed *"Holistic projection — learner expects approval in the first review
// with no corrections"* because `targetCycle === 1`. On the holistic branch that
// `1` is a CODE-PATH MARKER: the branch does not walk cycles at all, it returns
// `intake + avgIntakeToApproval`, and that average (Seattle BP, last 90d, n≈30,
// ~160 days) ALREADY CONTAINS the correction rounds those permits went through.
// The learner's actual pick for that cohort is cycle 3 — cycle 1 was 0 of 32.
//
// ★★★ SO THE COPY ATTRIBUTED TO THE LEARNER A CLAIM THE LEARNER NEVER MADE.
//     That is the rule this module enforces: **a fallback must not borrow the
//     confident voice**, and neither may a shortcut.
//
// ---------------------------------------------------------------------------
// ★★ WHAT THE OLD FOOTNOTE ALSO GOT WRONG, and why this is a module
// ---------------------------------------------------------------------------
// The walk's note read *"Walked N correction rounds + final review buffer.
// Italic values are derived; ✓ marks real cycle data."* — 9px italic in
// `--color-dim`, engineering slang, and a glyph used as a word. Bobby read it
// aloud as *"block two correction rounds… R drive, mark…"*.
//
// The sentences below were approved by him on 2026-09-04 (*"Go with these"*).
// They live in a pure module rather than in JSX so the wording can be asserted
// exactly, character for character, without rendering React.
//
// ★★★ BANNED, IN EVERY SENTENCE: "learner", "holistic", "walked", "derived",
//     "buffer", and a bare "✓". The suite greps for all six.

/** ★ The window a cohort was drawn from, in words rather than a tier key. */
export function recencyWindowLabel(tier: RecencyTier | undefined): string {
  switch (tier) {
    case 'last_90d':
      return 'last 90 days';
    case 'last_180d':
      return 'last 180 days';
    case 'last_365d':
      return 'last 365 days';
    case 'all_time':
      return 'all time';
    default:
      // ★ `'default'` means the cascade found nothing and fell through. There
      //   is no window to name, so the caller must not print one — see
      //   `holisticSentence`, which only reaches here with a real cohort.
      return '';
  }
}

/**
 * ★★★ A PROPORTION AS PEOPLE SAY IT: "3 in 4", not "75%" and not "0.75".
 *
 * Bobby's approved copy is *"⟨3 in 4⟩ needed two or more correction rounds"*.
 * A percentage invites a precision the sample size does not support — n≈30 —
 * and "0.75" is not a sentence anybody says out loud.
 *
 * ★★ THE LADDER IS DELIBERATELY COARSE. Rounding to the nearest of a handful of
 * familiar ratios is the honest resolution for a thirty-permit cohort; a
 * "17 in 23" would imply the third significant figure means something.
 *
 * ★ Below a tenth it says so in words rather than printing "0 in 10", which
 *   would read as "never" — a claim a small sample cannot support either.
 */
export function ratioInWords(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return '';
  if (denominator <= 0 || numerator <= 0) return 'fewer than 1 in 10';
  const p = numerator / denominator;
  if (p >= 1) return 'every one';
  if (p < 0.1) return 'fewer than 1 in 10';
  const LADDER: ReadonlyArray<readonly [number, string]> = [
    [1 / 10, '1 in 10'],
    [1 / 5, '1 in 5'],
    [1 / 4, '1 in 4'],
    [1 / 3, '1 in 3'],
    [1 / 2, '1 in 2'],
    [2 / 3, '2 in 3'],
    [3 / 4, '3 in 4'],
    [4 / 5, '4 in 5'],
    [9 / 10, '9 in 10'],
  ];
  let best = LADDER[0]!;
  for (const rung of LADDER) {
    if (Math.abs(rung[0] - p) < Math.abs(best[0] - p)) best = rung;
  }
  return best[1];
}

/** ★ "1 correction round" / "2 correction rounds". */
function rounds(n: number): string {
  return `${n} correction round${n === 1 ? '' : 's'}`;
}

/**
 * ★★ WHAT THE WIDGET KNOWS THAT THE PROJECTION DOES NOT.
 *
 * ★★★ THE TWO "no learned history" SENTENCES HAVE TO NAME THE PERMIT TYPE AND
 *     THE JURISDICTION — and on exactly those two routes there IS no learner,
 *     so `cohortLabel` (which is parsed out of `LearnedEstimate.source`) does
 *     not exist. `computeProjectedApproval` is handed `permit.type` but never
 *     the project's juris, so it could not supply them either.
 *
 * ★★ The component has both, so it passes them. Optional, and the sentences
 *    degrade to "this permit type in this jurisdiction" rather than printing
 *    "undefined" — a fallback must not borrow the confident voice, and that
 *    applies to its own missing inputs too.
 */
export interface RouteCopyContext {
  /** `permit.type` — "Building Permit". Pluralised in the sentence. */
  type?: string | null;
  /** The project's jurisdiction — "Seattle". */
  juris?: string | null;
}

/** ★ "Building Permits in Seattle", or an honest generic when either is absent. */
function typeInJuris(ctx: RouteCopyContext | undefined): string {
  const type = (ctx?.type ?? '').trim();
  const juris = (ctx?.juris ?? '').trim();
  if (type && juris) return `${type}s in ${juris}`;
  if (type) return `${type}s`;
  return 'this permit type in this jurisdiction';
}

/**
 * ★★ THE SENTENCE THE WIDGET PRINTS, for whichever route produced the date.
 *
 * Returns `null` when there is nothing to say — an `actual` date needs no
 * explanation, which is how the widget behaved before and after.
 */
export function routeSentence(
  route: ProjectedApprovalRoute | undefined,
  facts: ProjectedApprovalRouteFacts | undefined,
  ctx?: RouteCopyContext,
): string | null {
  const f = facts ?? {};

  // ★ The half both walk sentences end with. It replaces "Italic values are
  //   derived; ✓ marks real cycle data" — same two facts, said in words, and
  //   `PerRoundBlock` was changed to make the first half TRUE (projected dates
  //   are muted as well as italic).
  const legend =
    'Grey dates are projected; dates with a check mark are what the city ' +
    'actually recorded.';

  const bump =
    f.reviewerBumpCycle !== undefined
      ? ` Reviewers flagged corrections on cycle ${f.reviewerBumpCycle}, so one more round was added.`
      : '';
  // ★ fix-614 (P-300): what the last round's correction count did.
  const corr = correctionSentence(f);
  // ★ fix-622 §B: any milestone that had passed and was moved forward.
  const moved = reanchorSentences(f);
  const corrPart = `${corr ? ` ${corr}` : ''}${moved ? ` ${moved}` : ''}`;

  switch (route) {
    case 'holistic_learned': {
      const window = recencyWindowLabel(f.recencyTier);
      const dist = f.cycleDist;
      const n = f.sampleCount ?? 0;
      // ★★ "two or more correction rounds" is cycles 3 and 4: a permit approved
      //    in cycle 2 went through ONE correction round, so two-or-more starts
      //    at cycle 3. Off by one here would be the same class of error the
      //    ticket exists to fix.
      const twoPlus = dist ? (dist[3] ?? 0) + (dist[4] ?? 0) : 0;
      const ratio = ratioInWords(twoPlus, n);
      const outliers =
        f.filteredCount && f.filteredCount > 0
          ? ` (${f.filteredCount} outlier${f.filteredCount === 1 ? '' : 's'} excluded)`
          : '';
      return (
        `Based on ${f.cohortLabel ?? `${n} permits`} approved in the ` +
        `${window || 'sample'}: intake to approval averaged ` +
        `${f.avgIntakeToApproval ?? 0} days, and ${ratio} needed two or more ` +
        `correction rounds. This date is that average, not a round-by-round ` +
        `walk.${outliers}`
      );
    }

    case 'holistic_default':
      // ★★ NO COHORT, NO CONFIDENT VOICE. This branch has no history at all, so
      //    the sentence says so FIRST and gives the number second — the reader
      //    should know the number is a default before they read it.
      return (
        `No learned history yet for ${typeInJuris(ctx)}. Using the default of ` +
        `${f.defaultDays ?? 0} days from intake for this permit type.`
      );

    case 'walk_learned': {
      const window = recencyWindowLabel(f.recencyTier);
      return (
        `Projected round by round from ${f.cohortLabel ?? 'past permits'}` +
        `${window ? ` (${window})` : ''}: ${rounds(f.correctionRounds ?? 0)}, ` +
        `then a final review.${bump}${corrPart} ${legend}`
      );
    }

    case 'walk_default': {
      const type = (ctx?.type ?? '').trim();
      const juris = (ctx?.juris ?? '').trim();
      const forWhat = type ? `for ${type}s` : 'for this permit type';
      const whereNot = juris ? `no learned history yet for ${juris}` : 'no learned history yet';
      return (
        `Projected round by round using default durations ${forWhat} — ` +
        `${whereNot}. ${rounds(f.correctionRounds ?? 0)}, then a final ` +
        `review.${bump}${corrPart} ${legend}`
      );
    }

    case 'walk_override':
      return (
        `Target set by hand to cycle ${f.overrideCycle ?? 1}. Projected round ` +
        `by round from there.${bump}${corrPart} ${legend}`
      );

    case 'uls_anchor':
      // ★ Today's ULS sentence, in plain words. The maths is untouched.
      return (
        "Anchored to the sibling Building Permit's expected issue date plus " +
        '120 days.'
      );

    case 'none':
      return 'Not enough data to project an approval date yet.';

    case 'actual':
    default:
      // ★ A real recorded date explains itself. Silent, exactly as before.
      return null;
  }
}

// ===========================================================================
// ★★★ fix-585 §7 — WHICH RUNG ANSWERED, FOR EVERY INPUT
// ===========================================================================
//
// `routeSentence` says which ROUTE produced the date. The forecast also needs
// each of its INPUTS to say where it came from, because most permits sitting
// on a correction have no parsed letter and the estimate is filling a hole.
// Same rule, same module: a fallback must not borrow the confident voice.
//
// ★★ The words follow the confidence: "measured" is stated flatly; "learned"
//    names the permits it came from; "policy" names the guardrail; "assumed"
//    SAYS assumed. The banned vocabulary above applies here too.

function scopeInWords(tier: string, ctx: RouteCopyContext | undefined, cycle?: number): string {
  const type = (ctx?.type ?? '').trim() || 'this permit type';
  const juris = (ctx?.juris ?? '').trim();
  const plural = type === 'this permit type' ? 'permits of this type' : `${type}s`;
  const inJuris = juris ? ` in ${juris}` : '';
  const atCycle = cycle != null ? ` at cycle ${cycle}` : '';
  // ★★★ Both tiers are within one jurisdiction — there is no "every
  //     jurisdiction" sentence to write, because no such tier exists.
  if (tier === 'type_juris_cycle') return `${plural}${inJuris}${atCycle}`;
  return `${plural}${inJuris}, across all cycles`;
}

const INPUT_NOUN: Record<EstimatorInput, string> = {
  correction_items: 'The number of correction items',
  anchor_date: 'The start date',
  city_review: "The city's review time",
  our_turnaround: 'Our turnaround time',
  city_target: "The city's finish date",
};

/**
 * ★★★ THE SENTENCE FOR ONE RESOLVED INPUT. Never null: an input that could not
 * be resolved says what is missing, which is the point.
 */
export function inputSentence(
  res: InputResolution<unknown> & { rawTargetSetAside?: boolean },
  ctx?: RouteCopyContext & { cycle?: number },
): string {
  const noun = INPUT_NOUN[res.input];
  const missing = res.missing.length ? ` Missing: ${res.missing.join(', ')}.` : '';

  if (res.value == null) {
    if (res.input === 'anchor_date') {
      return (
        'Not enough to estimate: this permit has no intake accepted date, no ' +
        'cycle-1 submitted date and no intake date.'
      );
    }
    return `${noun} is unknown.${missing}`;
  }

  const setAside = res.rawTargetSetAside
    ? " The city's stated target was set aside because this jurisdiction's slip past it has not been measured."
    : '';

  switch (res.rung) {
    case 'no_letter':
      return 'No correction letter has been issued on this cycle.';
    case 'this_letter':
      return `${noun} is counted from the parsed correction letter.`;
    case 'prior_cycles':
      return (
        `${noun} is estimated from this permit's earlier letters, because this ` +
        `cycle's letter has not been parsed yet.`
      );
    case 'cohort':
      return (
        `${noun} is estimated from similar permits, because this cycle's letter ` +
        `has not been parsed yet.`
      );
    case 'assumption':
      return (
        `${noun} was assumed (${String(res.value)}): this cycle's letter has not ` +
        `been parsed and there is no history to go on.${missing}`
      );
    case 'intake_accepted':
      return 'Measured from the date the city accepted intake.';
    case 'cycle1_submitted':
      return 'Measured from the cycle-1 submitted date, because intake acceptance was not recorded.';
    case 'permit_intake_date':
      return (
        "Measured from the permit's intake date, because neither intake acceptance " +
        'nor a cycle-1 submittal was recorded.'
      );
    case 'own_cycles':
      return `${noun} is taken from this permit's own completed cycles.`;
    case 'policy':
      return `${noun} uses the set standard of ${String(res.value)} days — there is not enough history yet.`;
    case 'hardcoded':
      return `${noun} was assumed (${String(res.value)} days) — no history and no set standard.`;
    case 'target_plus_slip':
      return "The city's stated target, moved out by how late this jurisdiction usually runs.";
    case 'city_clock':
      return `Projected from the submittal date plus the city's usual review time.${setAside}`;
    default: {
      // A learned ladder tier.
      const n = res.ladder?.n ?? 0;
      const clampNote = res.ladder?.clamped
        ? ` Held to the set standard's range (history said ${String(res.ladder.learnedDays)}).`
        : '';
      if (n === 1) {
        // ★ One sample is not a median, and must not be called one.
        return (
          `${noun} is taken from the only past permit on record — ` +
          `${scopeInWords(res.rung, ctx, ctx?.cycle)}.` + clampNote
        );
      }
      return (
        `${noun} is the median of ${n} ${scopeInWords(res.rung, ctx, ctx?.cycle)}` +
        `${res.ladder?.windowTier ? ` (${recencyWindowLabelFor(res.ladder.windowTier)})` : ''}.` +
        clampNote
      );
    }
  }
}

function recencyWindowLabelFor(w: string): string {
  switch (w) {
    case '90d':
      return 'last 90 days';
    case '180d':
      return 'last 180 days';
    case '365d':
      return 'last 365 days';
    default:
      return 'all time';
  }
}

// ===========================================================================
// ★★★ fix-614 (P-300) — THE CORRECTION COUNT, IN PLAIN WORDS
// ===========================================================================
//
// One sentence per `correctionAdjust` (lib/correctionOdds). It is appended to
// the walk sentences — a permit with a correction round always walks — so it
// shows wherever the route copy already shows (the Schedule Estimator
// footnote), and nowhere new. The percentage is the CAUTIOUS one Bobby ruled
// (2026-09-30), and the sentence says which history it came from.

function corrections(n: number): string {
  return `${n} correction${n === 1 ? '' : 's'}`;
}

export function correctionSentence(f: ProjectedApprovalRouteFacts): string | null {
  // ★★ fix-622 (P-300 item 1): the reviewers answered because the letter
  //    hasn't been read. Same cautious rule, and the sentence names the signal.
  if (f.correctionSource === 'reviewers') return reviewerSentence(f);
  switch (f.correctionAdjust) {
    case 'next_round_last':
      return (
        `Last round had ${corrections(f.correctionCount ?? 0)}. Past ${f.cellLabel} with ` +
        `${f.correctionBucket} got approved the next round about ${f.nextRoundChancePct}% of the time, read ` +
        `cautiously (${f.cellRounds} rounds), so this plans for the next round to be the last.`
      );
    case 'one_more_round':
      return (
        `Last round had ${corrections(f.correctionCount ?? 0)}. Past ${f.cellLabel} with ` +
        `${f.correctionBucket} got approved the next round about ${f.nextRoundChancePct}% of the time, read ` +
        `cautiously (${f.cellRounds} rounds), so this plans one more round.`
      );
    case 'unknown_letter':
      // ★ fix-622: this now means NEITHER signal — the letter is unread and no
      //   reviewer is marked as asking for corrections.
      return (
        "The last correction letter hasn't been read and no reviewer is marked " +
        "as asking for corrections, so neither is used."
      );
    case 'no_history':
      return `No past rounds for ${f.cellLabel} yet, so the count isn't used.`;
    default:
      return null;
  }
}

// ===========================================================================
// ★★★ fix-622 — THE REVIEWERS, AND THE MILESTONES THAT MOVED FORWARD
// ===========================================================================

function reviewers(n: number): string {
  return `${n} reviewer${n === 1 ? '' : 's'}`;
}

/** e.g. *"3 reviewers asked for corrections (the letter hasn't been read);
 *  past odds of approval next round 14% (read cautiously, 21 Kirkland Building
 *  Permits rounds) — planned one more round."* */
function reviewerSentence(f: ProjectedApprovalRouteFacts): string | null {
  const who = `${reviewers(f.reviewerCount ?? 0)} asked for corrections (the letter hasn't been read)`;
  switch (f.correctionAdjust) {
    case 'next_round_last':
      return (
        `${who}; past odds of approval next round ${f.nextRoundChancePct}% (read cautiously, ` +
        `${f.cellRounds} ${f.cellLabel} rounds) — planned the next round as the last.`
      );
    case 'one_more_round':
      return (
        `${who}; past odds of approval next round ${f.nextRoundChancePct}% (read cautiously, ` +
        `${f.cellRounds} ${f.cellLabel} rounds) — planned one more round.`
      );
    case 'no_history':
      return `${who}, but no past ${f.cellLabel} rounds had that many yet, so it isn't used.`;
    default:
      return null;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 26" from an ISO date. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * ★★★ fix-622 §B (P-300 item 3): *"Move forward and say why."* One sentence per
 * milestone that had already passed without happening and was re-anchored
 * from today (lib/projectedApproval ProjectionReanchor).
 */
export function reanchorSentences(f: ProjectedApprovalRouteFacts): string | null {
  const list = f.reanchors ?? [];
  if (list.length === 0) return null;
  return list
    .map((r) =>
      r.kind === 'city_late'
        ? `City is ${days(r.daysLate)} past its own review date (due ${shortDate(r.due)})` +
          ((r.plannedDays ?? 0) > 0
            ? ` — planned ${days(r.plannedDays ?? 0)} from today, how late this city ` +
              `typically runs once past due (${r.lateRounds} late rounds).`
            : ' — planned from today.')
        : `Our resubmittal is ${days(r.daysLate)} past the usual turnaround — planned from today.`,
    )
    .join(' ');
}
