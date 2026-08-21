import { describe, it, expect } from 'vitest';
import migration from '../../migrations/fix_376_indexer_view_security_invoker.sql?raw';
import libSource from '../lib/indexerRun.ts?raw';
import hookSource from '../hooks/useIndexerRun.ts?raw';
import panelSource from '../components/Reports/IndexerFreshness.tsx?raw';
import worklistSource from '../components/Reports/CorrectionsMissingWorklist.tsx?raw';
import worklistHookSource from '../hooks/useCorrectionMissingWorklist.ts?raw';
import {
  AGE_WINDOWS,
  DEFAULT_AGE_WINDOW_DAYS,
  RUN_STALE_DAYS,
  ageDaysOf,
  ageWords,
  isUnmatched,
  numbersProvenance,
  runFreshness,
  runHeadline,
  runMode,
  runState,
  unmatchedReconciliation,
  windowCounts,
  windowSummary,
  withinWindow,
  type IndexerReconciliation,
  type IndexerRun,
} from '../lib/indexerRun';

// ===========================================================================
// fix-376 — the worklist is live; nobody could tell how stale the index was
// ===========================================================================
//
// fix-374 shipped the list and it works. fix-373 shipped the RECORD — the run
// stamp, its outcome, its mode, and the projects that matched no folder — and
// a grep before this ticket found ZERO consumers of any of it anywhere in src/.
//
// The indexer needs the `\\bpc-file` UNC share, so it cannot run in GitHub
// Actions. It runs when Bobby types the command. fix-373 said why that matters:
// *"if the last run was nine days ago, the Bridge must be able to say so. The
// run stamp is what makes an unscheduled tool safe to trust."*

function run(over: Partial<IndexerRun> = {}): IndexerRun {
  return {
    id: 'r1',
    started_at: '2026-08-20T10:00:00Z',
    finished_at: '2026-08-20T10:04:00Z',
    seconds: 240,
    ok: true,
    exit_code: 0,
    error: null,
    mode: '--only corrections',
    scope: null,
    dry_run: false,
    forced: false,
    reconciliation_written: true,
    projects_with_corrections: 70,
    letters_level: 45,
    letters_behind: 5,
    no_letters_found: 20,
    missing_rounds: 152,
    unmatched_projects: 5,
    age_days: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §2 — ★★★ "never run" is today's real state
// ---------------------------------------------------------------------------

describe('fix-376 §2: the empty snapshot', () => {
  it('★★★ reads as "not run since this shipped", not healthy and not broken', () => {
    // ★★★ MEASURED 2026-08-21: indexer_run, indexer_project_reconciliation and
    // indexer_missing_letter all hold ZERO rows — fix-373 merged after Bobby's
    // last run. This is what ships until he runs it again, so it is not a
    // hypothetical branch.
    expect(runState(null, null)).toBe('never');
    const headline = runHeadline('never', null, null);
    expect(headline).toBe('The indexer has not run since this record was added.');
    // Not "everything is fine"…
    expect(headline).not.toMatch(/up to date|healthy|ok\b|fine/i);
    // …and not an error either.
    expect(headline).not.toMatch(/error|failed|broken|could not/i);
    // ★★ And it says the live list is unaffected, because it IS: 152 rows are
    // on screen underneath regardless of whether the snapshot has anything.
    expect(numbersProvenance('never', null)).toContain('list below is live');
  });

  it('★★ the panel names the live list explicitly in the empty case', () => {
    expect(panelSource).toContain('indexer-never-note');
    expect(panelSource).toMatch(/list below is live and unaffected/);
  });

  it('★ nothing is claimed while the reads are still in flight', () => {
    // A sentence like "has not run" is a CLAIM; made from an empty cache it is
    // a wrong one.
    expect(panelSource).toContain('indexer-freshness-loading');
    expect(panelSource).toMatch(/isLoading \|\| attemptQ\.isLoading/);
  });
});

// ---------------------------------------------------------------------------
// §1 — ★★★ the three run states
// ---------------------------------------------------------------------------

describe('fix-376 §1: the run states', () => {
  it('★★★ ok = NULL is distinguishable from ok = false', () => {
    // ★★★ THE CASE fix-373 BUILT DELIBERATELY. A killed process never reported
    // an outcome, and "never returned" is not "failed".
    const killed = run({ ok: null, finished_at: null, reconciliation_written: false });
    const failed = run({ ok: false, error: 'share unreachable', reconciliation_written: false });
    expect(runState(null, killed)).toBe('killed');
    expect(runState(null, failed)).toBe('failed');
    expect(runState(null, killed)).not.toBe(runState(null, failed));

    // …and they read differently, not just internally.
    expect(runHeadline('killed', null, killed)).toContain('never reported an outcome');
    expect(runHeadline('killed', null, killed)).not.toMatch(/failed/i);
    expect(runHeadline('failed', null, failed)).toContain('failed');
  });

  it('★★★ the killed case needs BOTH reads — the view alone cannot see it', () => {
    // ★★★ THE TRAP. `indexer_run_current` is defined `WHERE reconciliation_written`,
    // so a run killed before writing one NEVER APPEARS IN IT. Reading only the
    // view would make "the process never returned" look identical to "no run has
    // ever happened".
    const killed = run({
      id: 'r2',
      started_at: '2026-08-21T09:00:00Z',
      ok: null,
      finished_at: null,
      reconciliation_written: false,
    });
    const earlierOk = run({ id: 'r1', started_at: '2026-08-14T10:00:00Z', age_days: 7 });
    // The view still holds the older successful run…
    expect(runState(earlierOk, earlierOk)).toBe('ok');
    // …and the attempt is what the state describes once it is newer.
    expect(runState(earlierOk, killed)).toBe('killed');
    // ★★ …while the NUMBERS are still honestly attributed to the earlier run.
    expect(numbersProvenance('killed', earlierOk)).toContain('last run that finished');

    // The hook reads the table, not only the view, and says why.
    expect(hookSource).toContain("from('indexer_run')");
    expect(hookSource).toContain("from('indexer_run_current')");
    expect(hookSource).toContain('reconciliation_written');
  });

  it('★★ an older attempt does not override the run behind the numbers', () => {
    const current = run({ id: 'r2', started_at: '2026-08-20T10:00:00Z' });
    const older = run({ id: 'r1', started_at: '2026-08-01T10:00:00Z', ok: false });
    expect(runState(current, older)).toBe('ok');
  });

  it('★★ a stale run is visibly stale at seven days', () => {
    // ★★ SEVEN, and the reason is the work rather than taste: the list exists so
    // somebody can chase a round the week it lands, so a run older than a week
    // can be missing a whole week of new rounds.
    expect(RUN_STALE_DAYS).toBe(7);
    expect(runFreshness(0.5)).toBe('fresh');
    expect(runFreshness(3)).toBe('ageing');
    expect(runFreshness(7)).toBe('stale');
    // fix-373's own example.
    expect(runFreshness(9)).toBe('stale');
    expect(runFreshness(null)).toBe('unknown');
    expect(panelSource).toContain('indexer-stale-badge');
  });

  it('★ it is a date and a state, NOT an alarm', () => {
    // The brief forbids a new channel and so does this: no toast, no
    // notification, no badge count anywhere in the panel.
    const body = strip(panelSource) + strip(libSource) + strip(hookSource);
    expect(body).not.toMatch(/toast|notify|Notification|setAppBadge|logError/i);
  });

  it('★ the mode is the words Bobby typed, and absent parts stay absent', () => {
    expect(runMode(run({ mode: '--only corrections', forced: true })))
      .toBe('--only corrections · --force');
    expect(runMode(run({ mode: '--full', forced: false, dry_run: true })))
      .toBe('--full · --dry-run');
    expect(runMode(run({ mode: null, scope: null, forced: false, dry_run: false }))).toBe('');
    expect(runMode(null)).toBe('');
  });

  it('★ age is stated in whole days, in words', () => {
    expect(ageWords(0.3)).toBe('today');
    expect(ageWords(1.2)).toBe('yesterday');
    expect(ageWords(9)).toBe('9 days ago');
    expect(ageWords(null)).toBe('at an unknown time');
    // ★ `age_days` exists only on the view; for a raw run row it is computed.
    const now = Date.parse('2026-08-21T10:00:00Z');
    expect(ageDaysOf(run({ started_at: '2026-08-14T10:00:00Z', age_days: null }), now))
      .toBeCloseTo(7, 5);
    expect(ageDaysOf(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★★ the age window
// ---------------------------------------------------------------------------

describe('fix-376 §3: the default window states the full total', () => {
  // THE REAL SHAPE, measured on the live view 2026-08-21: 152 rows —
  // 13 undated, 13 within 30 days, 14 in 31–90, 78 in 91–365, 34 over a year.
  function corpus() {
    const rows: { days_since_corr_issued: number | null }[] = [];
    for (let i = 0; i < 13; i += 1) rows.push({ days_since_corr_issued: null });
    for (let i = 0; i < 13; i += 1) rows.push({ days_since_corr_issued: 5 + i });
    for (let i = 0; i < 14; i += 1) rows.push({ days_since_corr_issued: 40 + i });
    for (let i = 0; i < 78; i += 1) rows.push({ days_since_corr_issued: 100 + i });
    for (let i = 0; i < 34; i += 1) rows.push({ days_since_corr_issued: 400 + i * 30 });
    return rows;
  }

  it('★★★ the window shows the recent rows AND states the full total', () => {
    const rows = corpus();
    expect(rows).toHaveLength(152);
    const c = windowCounts(rows, DEFAULT_AGE_WINDOW_DAYS);
    // 13 within 30 + 14 in 31–90 + the 13 undated, which are in every window.
    expect(c.shown).toBe(40);
    expect(c.total).toBe(152);
    expect(c.hidden).toBe(112);
    // ★★★ BOTH NUMBERS RENDER. A filtered list that looks complete is the
    // fix-370 mistake repeated.
    const line = windowSummary(c, DEFAULT_AGE_WINDOW_DAYS);
    expect(line).toContain('40 in the last 90 days');
    expect(line).toContain('152 all time');
    expect(line).toContain('112 older not shown');
  });

  it('★★★ AN UNDATED ROW IS NEVER HIDDEN BY AN AGE FILTER', () => {
    // ★★★ THE TRAP, AND IT IS NOT IN THE BRIEF: 13 of the 152 rows carry no
    // `days_since_corr_issued` at all. A window written `days <= 90` drops every
    // one of them silently — and an undated row is not old, it is UNKNOWN, and
    // arguably the more suspicious kind.
    expect(withinWindow({ days_since_corr_issued: null }, 30)).toBe(true);
    expect(withinWindow({ days_since_corr_issued: null }, null)).toBe(true);
    expect(withinWindow({ days_since_corr_issued: 1424 }, 90)).toBe(false);
    const c = windowCounts(corpus(), 30);
    expect(c.undated).toBe(13);
    // …and the line SAYS why they are there, rather than merely counting them.
    expect(windowSummary(c, 30)).toContain('13 with no issue date, always shown');
  });

  it('★★ the default is 90 days and the backlog is one click away', () => {
    expect(DEFAULT_AGE_WINDOW_DAYS).toBe(90);
    expect(AGE_WINDOWS.map((w) => w.days)).toEqual([30, 90, 365, null]);
    expect(worklistSource).toContain('missing-worklist-window');
    expect(worklistSource).toContain('missing-worklist-show-all');
    // ★ Not hidden — defaulted away from, and said so.
    expect(worklistSource).toContain('missing-worklist-window-summary');
  });

  it('★★ all time shows everything and still states the total', () => {
    const c = windowCounts(corpus(), null);
    expect(c.shown).toBe(152);
    expect(c.hidden).toBe(0);
    const line = windowSummary(c, null);
    expect(line).toContain('152 in all time');
    expect(line).not.toContain('older not shown');
  });

  it('★ the export says which window it is', () => {
    // A spreadsheet has no filter control on it, so the filename carries it.
    expect(worklistSource).toContain('corrections-no-letter-found-all-time');
    expect(worklistSource).toContain('corrections-no-letter-found-last-');
  });
});

// ---------------------------------------------------------------------------
// §4 — ★★ the projects that match no folder
// ---------------------------------------------------------------------------

function recon(over: Partial<IndexerReconciliation> = {}): IndexerReconciliation {
  return {
    run_id: 'r1',
    project_id: 'p1',
    address: '10430 66th Ave S',
    juris: 'Seattle',
    status: 'unmatched',
    expected_max_round: 2,
    found_max_cycle: null,
    items_found: 0,
    rounds_behind: null,
    project_parked: false,
    ...over,
  };
}

describe('fix-376 §4: the unmatched projects', () => {
  it('★ they appear, and are NOT mixed into the missing-letter rows', () => {
    // ★★ A different problem: an unreachable or differently-named folder is a
    // FILING question, where a missing letter is a FETCHING one.
    const rows = [
      recon({ project_id: 'p1', address: '10430 66th Ave S' }),
      recon({ project_id: 'p2', address: '1301 6th Ave N' }),
      recon({ project_id: 'p3', address: '1515 Martin Luther King Jr Way' }),
      recon({ project_id: 'p4', address: '1524 Martin Luther King Jr Way' }),
      recon({ project_id: 'p5', address: '6825 Seward Park Ave S' }),
      // …and a project that DID index, which is not one of them.
      recon({ project_id: 'p6', address: '233 31st Ave E', items_found: 12, found_max_cycle: 2 }),
    ];
    const u = unmatchedReconciliation(rows, run());
    expect(u.rows).toHaveLength(5);
    expect(u.rows.map((r) => r.address)).toEqual([
      '10430 66th Ave S',
      '1301 6th Ave N',
      '1515 Martin Luther King Jr Way',
      '1524 Martin Luther King Jr Way',
      '6825 Seward Park Ave S',
    ]);
    // ★ Its own block, with its own testid, in the freshness panel — never in
    // the worklist table.
    expect(panelSource).toContain('indexer-unmatched');
    expect(worklistSource).not.toContain('indexer-unmatched-');
  });

  it('★★★ membership is STRUCTURAL, not a magic status string', () => {
    // ★★★ `indexer_project_reconciliation.status` has no CHECK constraint, no
    // column comment, and — the tables being empty — no observable values.
    // Hard-coding `status === 'unmatched'` against a vocabulary that cannot be
    // checked is how a list silently stays empty for ever.
    expect(isUnmatched(recon({ status: 'no_folder' }))).toBe(true);
    expect(isUnmatched(recon({ status: null }))).toBe(true);
    expect(isUnmatched(recon({ status: 'unmatched', items_found: 3, found_max_cycle: 1 })))
      .toBe(false);
    const body = strip(libSource);
    expect(body).not.toMatch(/status === '|status\s*==\s*'/);
    // ★ The status is still RENDERED — it is the record's own word for the row.
    expect(panelSource).toContain('{r.status}');
  });

  it('★★ the run\'s own count is checked against the rows, out loud', () => {
    const rows = [recon({ project_id: 'p1' }), recon({ project_id: 'p2' })];
    const agree = unmatchedReconciliation(rows, run({ unmatched_projects: 2 }));
    expect(agree.disagrees).toBe(false);
    const disagree = unmatchedReconciliation(rows, run({ unmatched_projects: 5 }));
    expect(disagree.disagrees).toBe(true);
    expect(disagree.reported).toBe(5);
    expect(panelSource).toContain('indexer-unmatched-disagree');
  });

  it('★ nothing renders when there are none', () => {
    expect(unmatchedReconciliation([], run()).rows).toEqual([]);
    expect(panelSource).toMatch(/unmatched\.rows\.length > 0 &&/);
  });
});

// ---------------------------------------------------------------------------
// Standing rules and prior contracts
// ---------------------------------------------------------------------------

describe('fix-376: standing rules', () => {
  it('★★ nothing recomputes the reconciliation in the browser', () => {
    // The counts come from the SNAPSHOT — fix-373's numbers are the finer ones,
    // taken with the share in hand — and the rows from the live view.
    const body = strip(libSource) + strip(hookSource) + strip(panelSource);
    expect(body).not.toMatch(/rounds_behind\s*=|items_found\s*=\s*[^=]/);
    expect(panelSource).toContain('current.projects_with_corrections');
    expect(panelSource).toContain('current.no_letters_found');
    // …and the panel derives no count of its own from the worklist.
    expect(panelSource).not.toContain('useCorrectionMissingWorklist');
  });

  it('★★★ it is read-only — nothing writes', () => {
    const body = strip(libSource) + strip(hookSource) + strip(panelSource);
    expect(body).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    const sql = migration.replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE/i);
  });

  it('★★ fix-374\'s worklist is unchanged — hook, paging and ordering', () => {
    // The list itself was already right. This ticket adds a header above it and
    // a window control beside its filters; it does not rebuild it.
    expect(worklistHookSource).toContain('fetchAllRows');
    expect(worklistHookSource).toContain('.range(from, to)');
    expect(worklistHookSource).toContain(
      "order('days_since_corr_issued', { ascending: false, nullsFirst: false })",
    );
    expect(worklistHookSource).toContain("order('permit_id', { ascending: true })");
    expect(worklistHookSource).toContain("order('cycle', { ascending: true })");
    // fix-374's wording contract survives untouched.
    expect(worklistSource).toContain('No letter found');
    expect(worklistSource).toContain('cannot tell which');
    expect(worklistSource).toContain('missing-worklist-note');
  });

  it('★★★ the snapshot views no longer bypass their own tables\' RLS', () => {
    // MEASURED before anything was built: correction_missing_worklist is
    // security_invoker with anon revoked (the house pattern); all three of
    // fix-373's views were neither.
    const sql = migration.replace(/^\s*--.*$/gm, '');
    for (const v of [
      'indexer_run_current',
      'indexer_reconciliation_current',
      'indexer_missing_letter_current',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER VIEW public\\.${v}\\s+SET \\(security_invoker = true\\)`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${v}\\s+FROM anon`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON public\\.${v}\\s+TO authenticated`));
    }
  });
});

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}
