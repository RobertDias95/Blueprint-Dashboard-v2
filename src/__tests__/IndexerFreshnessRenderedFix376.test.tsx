import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IndexerReconciliation, IndexerRun } from '../lib/indexerRun';

// ===========================================================================
// fix-376 — the panel, rendered
// ===========================================================================
//
// ★★★ THE EMPTY CASE IS TODAY'S CASE. Measured 2026-08-21: `indexer_run`,
// `indexer_project_reconciliation` and `indexer_missing_letter` all hold ZERO
// rows, because fix-373 merged after Bobby's last run. That is what ships until
// he runs it again, so it is the first thing asserted rather than a branch
// nobody exercises.

const state = vi.hoisted(() => ({
  current: null as IndexerRun | null,
  attempt: null as IndexerRun | null,
  recon: [] as IndexerReconciliation[],
  loading: false,
}));

vi.mock('../hooks/useIndexerRun', () => ({
  useIndexerRunCurrent: () => ({ data: state.current, isLoading: state.loading }),
  useIndexerLastAttempt: () => ({ data: state.attempt, isLoading: state.loading }),
  useIndexerReconciliation: () => ({ data: state.recon, isLoading: state.loading }),
}));

import IndexerFreshness from '../components/Reports/IndexerFreshness';

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

beforeEach(() => {
  state.current = null;
  state.attempt = null;
  state.recon = [];
  state.loading = false;
});

describe('fix-376: the freshness panel', () => {
  it('★★★ an empty snapshot reads as "not run since this shipped"', () => {
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-state-never')).toBeInTheDocument();
    const headline = screen.getByTestId('indexer-headline').textContent ?? '';
    expect(headline).toBe('The indexer has not run since this record was added.');
    // ★★ Neither healthy nor broken — and it says the live list is unaffected,
    // because it is: 152 rows render underneath either way.
    expect(screen.getByTestId('indexer-never-note').textContent).toContain(
      'list below is live and unaffected',
    );
    expect(screen.queryByTestId('indexer-error')).toBeNull();
    expect(screen.queryByTestId('indexer-counts')).toBeNull();
    // Nothing claims an unmatched list it does not have.
    expect(screen.queryByTestId('indexer-unmatched')).toBeNull();
  });

  it('★ it says nothing at all while the reads are in flight', () => {
    state.loading = true;
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-freshness-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('indexer-headline')).toBeNull();
  });

  it('★★★ a killed run reads differently from a failed one, on screen', () => {
    state.attempt = run({ ok: null, finished_at: null, reconciliation_written: false });
    const { unmount } = render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-state-killed')).toBeInTheDocument();
    expect(screen.getByTestId('indexer-killed-note').textContent).toContain(
      'different from a run that failed',
    );
    expect(screen.getByTestId('indexer-headline').textContent).not.toMatch(/failed/i);
    unmount();

    state.attempt = run({ ok: false, error: 'share unreachable', reconciliation_written: false });
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-state-failed')).toBeInTheDocument();
    expect(screen.getByTestId('indexer-error').textContent).toBe('share unreachable');
    expect(screen.queryByTestId('indexer-killed-note')).toBeNull();
  });

  it('★★ a nine-day-old run is visibly stale, and its numbers are attributed', () => {
    // fix-373's own example: "if the last run was nine days ago, the Bridge
    // must be able to say so."
    state.current = run({ age_days: 9 });
    state.attempt = state.current;
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-stale-badge')).toBeInTheDocument();
    expect(screen.getByTestId('indexer-headline').textContent).toContain('9 days ago');
    expect(screen.getByTestId('indexer-provenance').textContent).toContain(
      'from that run',
    );
    expect(screen.getByTestId('indexer-mode').textContent).toContain('--only corrections');
  });

  it('★ a run from today carries no stale badge', () => {
    state.current = run({ age_days: 0.2 });
    state.attempt = state.current;
    render(<IndexerFreshness />);
    expect(screen.queryByTestId('indexer-stale-badge')).toBeNull();
    expect(screen.getByTestId('indexer-headline').textContent).toContain('today');
  });

  it('★★★ when the attempt failed, the numbers are attributed to the earlier run', () => {
    state.current = run({ id: 'r1', started_at: '2026-08-14T10:00:00Z', age_days: 7 });
    state.attempt = run({
      id: 'r2',
      started_at: '2026-08-21T09:00:00Z',
      ok: null,
      finished_at: null,
      reconciliation_written: false,
    });
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-state-killed')).toBeInTheDocument();
    // ★★ The counts on screen are the earlier run's, and the line says so.
    expect(screen.getByTestId('indexer-provenance').textContent).toContain(
      'last run that finished, 7 days ago',
    );
  });

  it('★ the five unmatched projects render in their own block', () => {
    state.current = run();
    state.attempt = state.current;
    state.recon = [
      recon({ project_id: 'p1', address: '10430 66th Ave S' }),
      recon({ project_id: 'p2', address: '1301 6th Ave N' }),
      recon({ project_id: 'p3', address: '1515 Martin Luther King Jr Way' }),
      recon({ project_id: 'p4', address: '1524 Martin Luther King Jr Way' }),
      recon({ project_id: 'p5', address: '6825 Seward Park Ave S' }),
      recon({ project_id: 'p6', address: '233 31st Ave E', items_found: 12, found_max_cycle: 2 }),
    ];
    render(<IndexerFreshness />);
    const block = screen.getByTestId('indexer-unmatched');
    expect(block.textContent).toContain('5 projects matched no folder');
    // ★★ A filing question, not a fetching one, and it says so.
    expect(block.textContent).toContain('filing question, not a missing letter');
    expect(screen.getByTestId('indexer-unmatched-p1')).toBeInTheDocument();
    // The project that DID index is not in the list.
    expect(screen.queryByTestId('indexer-unmatched-p6')).toBeNull();
    // The run and the rows agree, so nothing is flagged.
    expect(screen.queryByTestId('indexer-unmatched-disagree')).toBeNull();
  });

  it('★★ a run count that disagrees with its own rows is said out loud', () => {
    state.current = run({ unmatched_projects: 5 });
    state.attempt = state.current;
    state.recon = [recon({ project_id: 'p1' }), recon({ project_id: 'p2' })];
    render(<IndexerFreshness />);
    expect(screen.getByTestId('indexer-unmatched-disagree').textContent).toContain(
      'the run reported 5',
    );
  });
});
