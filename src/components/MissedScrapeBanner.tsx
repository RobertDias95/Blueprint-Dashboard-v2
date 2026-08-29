import { useState } from 'react';
import { useScrapeFreshness } from '../hooks/useScrapeFreshness';
import {
  MISSED_SCRAPE_HEADLINE,
  dismissMissedScrapeFor,
  missedScrapeDetail,
  readMissedScrapeDismissal,
} from '../lib/scrapeFreshness';

// ===========================================================================
// ★★★ fix-433 — the Bridge says so when today's scrape never ran
// ===========================================================================
//
// Bobby: *"just once a day - if it didnt run, so we know that we need to go
// manually do it."* This is the "so we know" half. There is no outside service
// watching, no scheduler and no account — the question is asked by whoever
// opens the app, and this line is the answer when the answer is bad.
//
// ★★★ THE SHELL IS REUSED, NOT REINVENTED. `NewBuildNotice` and
// `SaveFailureBanner` already occupy this exact slot in `Chrome` — above the
// header, full width, rendering `null` until they have something to say. This
// is a third instance of that pattern rather than a new mechanism: same
// position, same 11px strip, same "dismiss on the right" affordance
// `SaveFailureBanner` established.
//
// ★★ IT IS NOT AN ERROR AND IT IS NOT A DEPLOY. Palette-wise it sits between
// them — the caution palette (`co`), not the error red `SaveFailureBanner`
// uses for a save that died on the wire and not the neutral `de` of the update
// notice. Nothing has broken in the app; a piece of data is missing.
//
// ★★★ WHAT IT SAYS, AND WHY IT NEVER SAYS "STALE". Bobby's own framing is
// "if it didnt run … we need to go manually do it", so the line names the
// fact, names when the last one was, and names the action. "Stale",
// "heartbeat" and a cron expression are all words that make somebody ask a
// second question before they can act.

export default function MissedScrapeBanner() {
  const freshness = useScrapeFreshness();
  // ★★ SEEDED FROM THE MODULE FACT, fix-424's lesson applied at write time
  // rather than after a bug report. `AuthGuard` replaces this whole subtree
  // with "Reconnecting…" on a session verify, so a dismissal held only in
  // component state would come back an hour later on a window left open all
  // day. See lib/scrapeFreshness for the day-keying.
  const [dismissedKey, setDismissedKey] = useState(readMissedScrapeDismissal);

  if (!freshness.missed) return null;
  if (dismissedKey === freshness.todayKey) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 bg-co-bg border-b border-co-border text-[11px] text-text"
      role="status"
      data-testid="missed-scrape-banner"
    >
      <span className="font-extrabold text-co" data-testid="missed-scrape-headline">
        {MISSED_SCRAPE_HEADLINE}
      </span>
      <span className="text-muted" data-testid="missed-scrape-detail">
        {missedScrapeDetail(freshness)}
      </span>
      {/* ★ Dismissible for the session, and it comes back. There is no
          "acknowledge" to record — the condition is still true after the
          dismissal, so a reload (or tomorrow) puts it back up. That is the
          C3 requirement and it is also the honest behaviour: hiding a line
          does not make the permits update. */}
      <button
        type="button"
        onClick={() => {
          dismissMissedScrapeFor(freshness.todayKey);
          setDismissedKey(freshness.todayKey);
        }}
        className="ml-auto font-bold px-2 py-1 rounded-md border border-border text-muted bg-surface hover:bg-s2 transition"
        data-testid="missed-scrape-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
