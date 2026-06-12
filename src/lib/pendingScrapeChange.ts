import type { Permit } from './database.types';

// fix-159: the scraper's 24h manual-edit guard protects human edits, but a
// permit edited daily can carry stale portal data indefinitely with no signal.
// When the guard skips a KNOWN portal change, the scraper (part 2) merges
// `extras.pending_scrape_change` onto the permit and clears it once the write
// finally lands. The v2 side only READS it (PendingScrapeChip).

export interface PendingScrapeChange {
  /** The status the portal currently shows (load-bearing — chip hides without it). */
  observed_status: string;
  /** The (stale) status the dashboard is showing. */
  db_status: string;
  /** ISO timestamp the divergence was first seen. */
  first_seen?: string;
  /** How many consecutive scraper runs skipped the change. */
  runs_skipped?: number;
  /** ISO timestamp of the most recent run that skipped it. */
  last_run_at?: string;
}

/** Parse `extras.pending_scrape_change` defensively. Returns null when the key
 *  is absent or malformed (the scraper clears it after a successful write, so
 *  "null" is the steady state). */
export function readPendingScrapeChange(
  extras: Permit['extras'],
): PendingScrapeChange | null {
  if (!extras || typeof extras !== 'object') return null;
  const raw = (extras as Record<string, unknown>).pending_scrape_change;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const observed =
    typeof o.observed_status === 'string' ? o.observed_status.trim() : '';
  if (!observed) return null; // observed_status is required
  return {
    observed_status: observed,
    db_status: typeof o.db_status === 'string' ? o.db_status : '',
    first_seen: typeof o.first_seen === 'string' ? o.first_seen : undefined,
    runs_skipped: typeof o.runs_skipped === 'number' ? o.runs_skipped : undefined,
    last_run_at: typeof o.last_run_at === 'string' ? o.last_run_at : undefined,
  };
}
