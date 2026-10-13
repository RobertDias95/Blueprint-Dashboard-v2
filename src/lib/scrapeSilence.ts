// ===========================================================================
// ★★★ fix-658 (P-343) — THE PERMIT SCRAPE HASN'T RUN FOR 36 WEEKDAY HOURS
// ===========================================================================
//
// ⚖️ Bobby 10-12: "if it goes over 36 hours without running, then an alert
//    should maybe go out."
//
// The rule lives in the database (`bp_scrape_silence_check`, hourly pg_cron,
// migrations/fix_658_scrape_silence_alert.sql). This module is its TS MIRROR
// for tests (no live DB in CI), pinned to the SQL by ScrapeSilenceFix658.test.ts,
// plus the Settings key.
//
// SILENT = more than 36 hours since the latest scraper_run.started_at, counting
// only Monday–Friday hours in Pacific time. Weekends do not count (the scrape
// is weekday-only); holidays DO count (no holiday calendar).

/** app_config key: who the scraper-down alert emails. */
export const SCRAPE_SILENCE_RECIPIENTS_KEY = 'scrapeSilenceAlertRecipients';

/** ★★ The threshold, in Pacific weekday hours. Twin of `c_threshold` in SQL. */
export const SCRAPE_SILENT_AFTER_WEEKDAY_HOURS = 36;

/** Where the fix is: the scrape workflow's page, with its "Run workflow" button. */
export const SCRAPE_WORKFLOW_URL =
  'https://github.com/RobertDias95/Blueprint-Dashboard-/actions/workflows/scrape-prod.yml';

const TZ = 'America/Los_Angeles';

function pacificDate(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** The instant a Pacific calendar day starts (DST-correct). */
function pacificMidnight(y: number, m: number, d: number): Date {
  // Guess UTC midnight + 8h, then correct by the zone's offset at that instant.
  const guess = Date.UTC(y, m - 1, d, 8);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const h = Number(local.find((p) => p.type === 'hour')?.value);
  const min = Number(local.find((p) => p.type === 'minute')?.value);
  return new Date(guess - (h * 60 + min) * 60_000);
}

/**
 * ★★ Twin of `bp_weekday_hours_between`: elapsed hours between two instants
 * that fall on a Pacific Monday–Friday.
 */
export function weekdayHoursBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let { y, m, d } = pacificDate(from);
  const end = pacificDate(to);
  let ms = 0;
  for (;;) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
    const start = pacificMidnight(y, m, d);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const ny = next.getUTCFullYear(), nm = next.getUTCMonth() + 1, nd = next.getUTCDate();
    const stop = pacificMidnight(ny, nm, nd);
    if (dow >= 1 && dow <= 5) {
      const a = Math.max(from.getTime(), start.getTime());
      const b = Math.min(to.getTime(), stop.getTime());
      if (b > a) ms += b - a;
    }
    if (y === end.y && m === end.m && d === end.d) break;
    y = ny; m = nm; d = nd;
  }
  return ms / 3_600_000;
}

export function isScrapeSilent(lastRun: Date | null, now: Date): boolean {
  if (!lastRun) return false; // ★ nothing recorded = unknown, not silent
  return weekdayHoursBetween(lastRun, now) > SCRAPE_SILENT_AFTER_WEEKDAY_HOURS;
}
