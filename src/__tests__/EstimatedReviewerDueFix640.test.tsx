import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQuery } from '../test/renderWithQuery';
import ReviewerRollupChip from '../components/ProjectDetail/ReviewerRollupChip';
import {
  REVIEWER_ESTIMATE_MIN_SAMPLES,
  REVIEWER_WINDOWS,
  REVIEW_LENGTH_MAX_DAYS,
  addDays,
  disciplineKey,
  dueLine,
  estimateBasisText,
  roundOf,
  typicalReviewLength,
  usableCityTarget,
  type FinishedReview,
  type ReviewKey,
  type ReviewerEstimate,
} from '../lib/reviewerDueEstimate';
import type { PermitCycleReviewer, ReviewerStatus } from '../lib/database.types';

// ===========================================================================
// fix-640 (P-335) — every open reviewer gets a due date, estimated when the
// city gives none.
// ===========================================================================
//
// ⚖️ Bobby, 10-11: "i want to show due dates. even if past due, this is our
// queue to go follow up with a reviewer… if we do not know a review target
// date, maybe we can think of a smart way to create one?"
//
// ★★★ The review length is learned by fix-585's ONE learner (a new clock in
//     `bp_duration_stats`); the estimator only reads it. No cross-jurisdiction
//     level (Bobby, 2026-09-29).
// ★★ TESTED TWO WAYS (fix-153 — CI has no database): the TS MIRROR case by
//    case below, and the migration text pinned to every clause it assumes. The
//    SQL ran on prod in a rolled-back transaction before it was applied
//    (numbers in the PR).

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const sql = repo('migrations/fix_640_estimated_reviewer_due_dates.sql')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

const TODAY = '2026-10-11';
const RECENT = '2026-09-15'; // inside the 90-day window
const OLD = '2025-06-01'; // outside 365 days → only all-time

const KEY: ReviewKey = { discipline: 'Building', juris: 'Seattle', permitType: 'Building Permit', round: 2 };

/** n finished reviews of `days` each, ended on `endedOn`, with key overrides. */
function many(n: number, days: number, over: Partial<ReviewKey> = {}, endedOn = RECENT): FinishedReview[] {
  return Array.from({ length: n }, () => ({ ...KEY, ...over, days, endedOn }));
}

const EST_BASE = {
  basis_level: 1 as const, window_tier: 'all' as const, juris: 'Seattle', discipline: 'building',
  permit_type: 'Building Permit', round_label: 'round 2+', typical_days: 21, sample_n: 34,
};

// ---------------------------------------------------------------------------
// §C — which date shows
// ---------------------------------------------------------------------------

describe('fix-640 §C: the city date wins — unless it is the slot’s open date', () => {
  it('★★ a real city date is used as-is', () => {
    expect(usableCityTarget('2026-10-14', '2026-09-30')).toBe('2026-10-14');
    expect(dueLine('2026-10-14', null, TODAY)?.text).toBe('Due 10/14/2026');
  });

  it('★★★ a city date WINS over an estimate', () => {
    const line = dueLine(usableCityTarget('2026-10-14', null), { ...EST_BASE, estimated_due: '2026-10-20' }, TODAY);
    expect(line).toEqual({ text: 'Due 10/14/2026', pastDue: false, estimated: false, title: null });
  });

  it('★★★ a "target" equal to the slot’s open date is NOT a deadline — the estimate replaces it', () => {
    expect(usableCityTarget('2026-10-01', '2026-10-01')).toBeNull();
    const line = dueLine(usableCityTarget('2026-10-01', '2026-10-01'), { ...EST_BASE, estimated_due: '2026-10-20' }, TODAY);
    expect(line?.text).toBe('~Due 10/20/2026 (est.)');
  });

  it('a city date in the past is flagged, as fix-638 did', () => {
    expect(dueLine('2026-10-09', null, TODAY)?.text).toBe('Due 10/09/2026 · past due');
  });

  it('★★★ a PAST-DUE estimate is still flagged — it is the follow-up queue', () => {
    const line = dueLine(null, { ...EST_BASE, estimated_due: '2026-10-04' }, TODAY)!;
    expect(line.text).toBe('~Due 10/04/2026 (est.) · past due');
    expect(line.pastDue).toBe(true);
    expect(line.estimated).toBe(true);
  });

  it('no city date and no estimate → no line (never invented)', () => {
    expect(dueLine(null, null, TODAY)).toBeNull();
  });
});

describe('fix-640 §C: the tooltip names the basis', () => {
  it('★ level 1 names all four (the brief’s example)', () => {
    expect(estimateBasisText({ ...EST_BASE, discipline: 'Building' }))
      .toBe('Typical for Seattle · building · BP · round 2+: 21 days (median of 34 reviews).');
  });
  it('level 2 drops the round; level 3 drops the type; the jurisdiction always stays', () => {
    expect(estimateBasisText({ ...EST_BASE, basis_level: 2 })).toBe('Typical for Seattle · building · BP: 21 days (median of 34 reviews).');
    expect(estimateBasisText({ ...EST_BASE, basis_level: 3 })).toBe('Typical for Seattle · building: 21 days (median of 34 reviews).');
  });
  it('a recent window is named', () => {
    expect(estimateBasisText({ ...EST_BASE, window_tier: '90d', typical_days: 15, sample_n: 24 }))
      .toBe('Typical for Seattle · building · BP · round 2+: 15 days (median of 24 reviews, last 90 days).');
    expect(estimateBasisText({ ...EST_BASE, window_tier: '365d' })).toContain('last year');
  });
  it('one day / one review read in the singular', () => {
    expect(estimateBasisText({ ...EST_BASE, basis_level: 3, typical_days: 1, sample_n: 1 }))
      .toBe('Typical for Seattle · building: 1 day (median of 1 review).');
  });
});

// ---------------------------------------------------------------------------
// §B — the estimate (MIRROR)
// ---------------------------------------------------------------------------

describe('fix-640 §B: the typical length falls back level by level', () => {
  it('★ level 1: discipline × jurisdiction × type × round', () => {
    const t = typicalReviewLength(KEY, [...many(5, 21), ...many(20, 99, { round: 1 })], TODAY);
    expect(t).toEqual({ level: 1, window: '90d', days: 21, n: 5 });
  });

  it('★ level 2: too few in the round → drop the round', () => {
    const t = typicalReviewLength(KEY, [...many(4, 21), ...many(3, 30, { round: 1 })], TODAY);
    expect(t).toEqual({ level: 2, window: '90d', days: 21, n: 7 });
  });

  it('★ level 3: too few of the type → any type, same jurisdiction', () => {
    const t = typicalReviewLength(KEY, [...many(2, 21), ...many(4, 10, { permitType: 'ULS', round: 1 })], TODAY);
    expect(t).toEqual({ level: 3, window: '90d', days: 10, n: 6 });
  });

  it('★★★ NEVER another jurisdiction (Bobby, 2026-09-29) — the brief’s level 4 is not built', () => {
    expect(typicalReviewLength(KEY, [...many(2, 21), ...many(50, 14, { juris: 'Kirkland' })], TODAY)).toBeNull();
    expect(typicalReviewLength({ ...KEY, juris: null }, many(50, 14), TODAY)).toBeNull();
  });

  it('★★ inside a level, the newest window that reaches 5 answers (the learner’s ladder)', () => {
    expect(REVIEWER_WINDOWS.map((w) => w.tier)).toEqual(['90d', '180d', '365d', 'all']);
    // 3 recent + 4 old at level 1: 90d has 3, all-time has 7 → level 1, all-time
    const t = typicalReviewLength(KEY, [...many(3, 10), ...many(4, 30, {}, OLD)], TODAY);
    expect(t).toEqual({ level: 1, window: 'all', days: 30, n: 7 });
  });

  it('★★★ below the minimum at every level → nothing', () => {
    expect(REVIEWER_ESTIMATE_MIN_SAMPLES).toBe(5);
    expect(typicalReviewLength(KEY, many(4, 21), TODAY)).toBeNull();
    // other disciplines never count
    expect(typicalReviewLength(KEY, [...many(4, 21), ...many(50, 9, { discipline: 'Zoning' })], TODAY)).toBeNull();
  });

  it('no discipline → nothing', () => {
    expect(typicalReviewLength({ ...KEY, discipline: null }, many(50, 21), TODAY)).toBeNull();
  });

  it('disciplines match whatever the portal’s spelling ("land_use" = "Land Use")', () => {
    expect(disciplineKey(' Land_Use ')).toBe('land use');
    const t = typicalReviewLength({ ...KEY, discipline: 'land use' }, many(5, 12, { discipline: 'LAND_USE' }), TODAY);
    expect(t?.days).toBe(12);
  });

  it('median rounds half away from zero; impossible lengths are dropped', () => {
    expect(typicalReviewLength(KEY, [...many(3, 10), ...many(3, 11)], TODAY)?.days).toBe(11); // 10.5 → 11
    expect(REVIEW_LENGTH_MAX_DAYS).toBe(730);
    expect(typicalReviewLength(KEY, [...many(4, 10), ...many(3, 900), ...many(3, -2)], TODAY)).toBeNull();
  });

  it('round 1 is cycle 1; every later cycle is round 2+; due = start + days (calendar)', () => {
    expect(roundOf(1)).toBe(1);
    expect(roundOf(2)).toBe(2);
    expect(roundOf(5)).toBe(2);
    expect(addDays('2026-09-29', 15)).toBe('2026-10-14');
  });
});

describe('fix-640: the SQL is the rule, and says what the mirror says', () => {
  it('★★★ the view carries target_date — appended, still security_invoker', () => {
    expect(sql).toContain('CREATE OR REPLACE VIEW public.permit_cycle_reviewers_current');
    expect(sql).toContain('WITH (security_invoker = true)');
    expect(sql).toMatch(/r\.updated_at,\s+r\.target_date\s+FROM public\.permit_cycle_reviewers r/);
  });

  it('★★★ the review length is a clock of the ONE learner, patched by anchor', () => {
    expect(sql).toContain("pg_get_functiondef('public.bp_duration_stats(uuid,text,text)'::regprocedure)");
    expect(sql).toContain("'reviewer_review:' || public.bp_reviewer_discipline_key(r.discipline)");
    // only when asked for by name — a NULL clock (bp_learned_durations) is unchanged
    expect(sql).toContain("WHERE p_clock = 'reviewer_review'");
    expect(sql).not.toContain("p_clock IS NULL OR p_clock = 'reviewer_review'");
    // refuses a missing / repeated anchor
    expect(sql).toContain('IF v_hits <> 1 THEN');
    // round start = the cycle's submitted (fix-253); round = 1 | 2; a verdict ends it
    expect(sql).toContain('(r.last_event_date - pc.submitted), r.last_event_date');
    expect(sql).toContain("CROSS JOIN LATERAL (VALUES (b.ptype), ('*'::text)) t(ptype2)");
    expect(sql).toContain("r.current_status IN ('approved', 'corrections_required')");
  });

  it('★★★ the estimator READS the learner and aggregates nothing itself', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.bp_reviewer_due_estimates'));
    expect(fn).toContain("public.bp_duration_stats(tn.tenant_id, NULL, 'reviewer_review')");
    expect(fn).not.toMatch(/percentile_cont|\bavg\s*\(/i);
  });

  it('★★ three levels, each at the same minimum as the mirror, newest window first', () => {
    const n = REVIEWER_ESTIMATE_MIN_SAMPLES;
    expect(sql.match(new RegExp(`s\\.n >= ${n}`, 'g'))?.length).toBe(3);
    expect(sql).toContain("VALUES ('90d', 1), ('180d', 2), ('365d', 3), ('all', 4)");
    expect(sql).toContain("s.scope = 'type_juris_cycle' AND s.cycle_index = t.rnd");
    expect(sql).toContain("AND s.juris = t.juris AND s.type = '*'");
    expect(sql).toContain('ORDER BY c.lvl, c.ord');
    // every level keeps the jurisdiction
    expect(sql.match(/s\.juris = t\.juris/g)?.length).toBe(3);
  });

  it('only OPEN reviewers are estimated; due = start + median (calendar days)', () => {
    expect(sql).toContain("r.current_status IN ('assigned', 'in_process', 'in_review', 'pending')");
    expect(sql).toContain('t.start_d + pick.median_days');
  });

  it('discipline key mirrors disciplineKey()', () => {
    expect(sql).toContain("replace(lower(COALESCE(p_discipline, '')), '_', ' ')");
  });

  it('★★★ read-only: no row is written', () => {
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_reviewer_due_estimates(uuid[]) TO authenticated, service_role;');
  });
});

describe('fix-640: the view’s reader picks the new column up without a change', () => {
  it('useAllPermitCycleReviewers selects * from the view', () => {
    const hook = repo('src/hooks/useAllPermitCycleReviewers.ts');
    expect(hook).toContain(".select('*')");
    expect(hook).toContain("'permit_cycle_reviewers_current'");
  });
  it('fix-638’s second fetch is gone', () => {
    expect(() => repo('src/hooks/useReviewerTargetDates.ts')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §C — the popover
// ---------------------------------------------------------------------------

const rpcCalls: string[][] = [];
let estimates: ReviewerEstimate[] = [];
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (_fn: string, args: { p_ids: string[] }) => {
      rpcCalls.push(args.p_ids);
      return Promise.resolve({ data: estimates.filter((e) => args.p_ids.includes(e.reviewer_id)), error: null });
    },
  },
}));

function reviewer(id: string, status: ReviewerStatus, last: string | null, target: string | null): PermitCycleReviewer {
  return {
    id, tenant_id: 't', permit_id: 9, cycle_index: 2, reviewer_name: `Reviewer ${id}`,
    discipline: 'building', current_status: status, last_event_date: last,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', target_date: target,
  };
}

function est(id: string, due: string): ReviewerEstimate {
  return { reviewer_id: id, round_start: '2026-09-20', estimated_due: due, ...EST_BASE };
}

describe('fix-640 §C: the popover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0));
    rpcCalls.length = 0;
    estimates = [est('no-date', '2026-10-20'), est('open-date', '2026-10-05'), est('city', '2026-12-01')];
  });
  afterEach(() => vi.useRealTimers());

  function open() {
    renderWithQuery(
      <ReviewerRollupChip
        permitId={9}
        rows={[
          reviewer('city', 'in_review', '2026-09-20', '2026-10-14'),
          reviewer('no-date', 'in_review', '2026-09-22', null),
          reviewer('open-date', 'pending', '2026-09-25', '2026-09-25'),
          reviewer('done', 'approved', '2026-10-02', null),
        ]}
        fallbackReviewer={null}
      />,
    );
    fireEvent.click(screen.getByTestId('reviewer-chip-9'));
  }

  it('★★★ an open reviewer with no city date shows "~Due … (est.)", muted, with the basis', async () => {
    open();
    const due = await screen.findByTestId('reviewer-due-no-date');
    expect(due.textContent).toBe('~Due 10/20/2026 (est.)');
    expect(due.getAttribute('data-estimated')).toBe('true');
    expect(due.className).toContain('italic');
    expect(due.getAttribute('title')).toBe('Typical for Seattle · building · BP · round 2+: 21 days (median of 34 reviews).');
  });

  it('★★★ open-date-as-target is replaced by the estimate — and a passed one is flagged', async () => {
    open();
    const due = await screen.findByTestId('reviewer-due-open-date');
    expect(due.textContent).toBe('~Due 10/05/2026 (est.) · past due');
    expect(due.getAttribute('data-past-due')).toBe('true');
    expect(due.style.color).toContain('--color-wa');
  });

  it('★★ the city date wins, and is never sent for an estimate', async () => {
    open();
    await screen.findByTestId('reviewer-due-no-date');
    const city = screen.getByTestId('reviewer-due-city');
    expect(city.textContent).toBe('Due 10/14/2026');
    expect(city.getAttribute('data-estimated')).toBe('false');
    expect(rpcCalls.flat().sort()).toEqual(['no-date', 'open-date']);
  });

  it('a finished reviewer gets no due line', async () => {
    open();
    await screen.findByTestId('reviewer-due-no-date');
    expect(screen.queryByTestId('reviewer-due-done')).toBeNull();
  });
});

