import { useScrapeFreshness } from '../hooks/useScrapeFreshness';
import {
  MISSED_SCRAPE_ACTION,
  MISSED_SCRAPE_HEADLINE,
  missedScrapeDetail,
} from '../lib/scrapeFreshness';

// ===========================================================================
// ★★★ fix-433 §C2 — the same fact, in the place errors are triaged
// ===========================================================================
//
// ★★★ ONE SYSTEM-LEVEL ENTRY, NEVER PER-PERMIT. A missed scrape is one fact
// about the Bridge, not 164 facts about permits. Bobby has separately ruled
// (P-088) that error triage is for Bridge errors rather than scraper warnings,
// and this belongs here for exactly that reason: "the scrape did not run" is a
// Bridge-side system fact, while the per-permit scraper warnings P-088 keeps
// out are not. That routing question is settled and this ticket does not
// reopen it.
//
// ★★★ IT IS DERIVED, SO IT HAS NO ACTIONS. Every other row on this page is an
// aggregate over stored `error_reports` rows and carries Queue / Resolve /
// Dismiss, which write a status. There is no row behind this one — nothing to
// queue, and "resolved" would be a claim the condition cannot honour. Giving
// it the same three buttons would be inventing exactly the stored alert state
// scope B forbids, and would land this in P-069 (warnings that come back after
// being resolved) on day one. It resolves itself when a run lands.
//
// ★★ IT SITS ABOVE THE LIST, OUTSIDE IT. The existing `<ul>`, its rows, its
// grouping and its empty state are untouched — the brief's MUST NOT CHANGE.
// Putting a synthetic member inside `groups` would have needed a fake
// fingerprint, a fake status and a fake count, and every one of those would
// have been read by something.

export default function MissedScrapeTriageEntry() {
  const freshness = useScrapeFreshness();
  if (!freshness.missed) return null;

  return (
    <div
      className="bg-surface border border-co-border rounded-lg px-3 py-2 flex items-start gap-2"
      data-testid="missed-scrape-triage-entry"
    >
      <span className="text-[9px] font-display font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-co-bg text-co border-co-border">
        System
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text leading-snug">
          <span className="font-semibold">{MISSED_SCRAPE_HEADLINE}</span>{' '}
          <span className="text-muted">{missedScrapeDetail(freshness)}</span>
        </div>
        <div className="text-[11px] text-dim mt-0.5">
          {MISSED_SCRAPE_ACTION}
        </div>
      </div>
      {/* ★ Says out loud that it is not a stored row, so nobody looks for the
          buttons the rows below it have. */}
      <span className="text-[10px] text-dim whitespace-nowrap">
        live check · not a logged error
      </span>
    </div>
  );
}
