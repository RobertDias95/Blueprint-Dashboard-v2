import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  evaluateScrapeFreshness,
  formatPacificClock,
  isPacificWeekend,
  lastScrapePhrase,
  missedScrapeDetail,
  pacificParts,
  resetMissedScrapeDismissal,
  MISSED_SCRAPE_HOUR_PT,
  type ScrapeFreshness,
} from '../lib/scrapeFreshness';

// ===========================================================================
// fix-433 — "no permit scrape has run today"
// ===========================================================================
//
// ★★★ THE TIMEZONE CASE IS THE FIRST TEST AND IT IS A REAL ONE. The last
// scrape row on 2026-08-28 landed at 20:11 Pacific, which is 03:11 UTC on the
// 29th. A UTC "today" files that under TOMORROW and then stays silent on the
// 29th — silent on the one day in the measured week that actually had no
// morning run. Everything here is asserted twice, once with the process in UTC
// and once in Pacific, because a rule that only works on the author's machine
// is not a rule.

// ---------------------------------------------------------------------------
// Timezone harness
// ---------------------------------------------------------------------------

const ORIGINAL_TZ = process.env.TZ;

/** Run `body` with the process clock set to `tz`. Node re-reads `process.env.TZ`
 *  on the next Date construction, so this genuinely changes what a naive
 *  `getHours()` / `getDate()` would answer. */
function inTimezone(tz: string, body: () => void) {
  process.env.TZ = tz;
  try {
    body();
  } finally {
    // ★ DELETE, do not assign `undefined`. CI's ubuntu runner has no TZ set at
    //   all, and `process.env.TZ = undefined` writes the literal string
    //   "undefined" — a garbage zone that would leak into every later test in
    //   this file. This is the one line that makes the harness safe off a
    //   developer machine.
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

/** Both of the two zones this app is actually opened in. */
const ZONES = ['UTC', 'America/Los_Angeles'] as const;

/** The prod fact, in UTC: 2026-08-28 20:11 Pacific. */
const AUG_28_2011_PT = '2026-08-29T03:11:00.000Z';
/** The brief's example, in UTC: 2026-08-28 17:01 Pacific. */
const AUG_28_1701_PT = '2026-08-29T00:01:00.000Z';

/** 2026-08-29 is a Saturday; 2026-08-31 a Monday; 2026-09-02 a Wednesday. */
const WED_1230_PT = new Date('2026-09-02T19:30:00.000Z'); // 12:30 PT
const WED_1130_PT = new Date('2026-09-02T18:30:00.000Z'); // 11:30 PT
const WED_1200_PT = new Date('2026-09-02T19:00:00.000Z'); // 12:00 PT exactly
const SAT_1500_PT = new Date('2026-08-29T22:00:00.000Z'); // Sat 15:00 PT
const SUN_1500_PT = new Date('2026-08-30T22:00:00.000Z'); // Sun 15:00 PT

describe('fix-433 §0 — Pacific is asked explicitly, never inferred', () => {
  it('★★ the harness is real: the host clock genuinely moves between the two zones', () => {
    // ★ Without this, every `for (const tz of ZONES)` below would be two
    //   identical passes and would prove nothing. Node re-reads process.env.TZ,
    //   so a NAIVE implementation reading getDate() really would disagree here.
    let utcDay = 0;
    let ptDay = 0;
    inTimezone('UTC', () => {
      utcDay = new Date(AUG_28_1701_PT).getDate();
    });
    inTimezone('America/Los_Angeles', () => {
      ptDay = new Date(AUG_28_1701_PT).getDate();
    });
    expect(utcDay).toBe(29);
    expect(ptDay).toBe(28);
  });

  it('★★★ a run at 17:01 PT counts as the 28th even though it is 00:01Z on the 29th', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        expect(pacificParts(new Date(AUG_28_1701_PT)).dayKey).toBe('2026-08-28');
        expect(formatPacificClock(new Date(AUG_28_1701_PT))).toBe('5:01pm');
      });
    }
  });

  it('★★ 20:11 PT on the 28th is 03:11Z on the 29th and still the 28th', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        expect(pacificParts(new Date(AUG_28_2011_PT)).dayKey).toBe('2026-08-28');
        expect(formatPacificClock(new Date(AUG_28_2011_PT))).toBe('8:11pm');
      });
    }
  });

  it('the weekday comes from Pacific, so a Saturday morning UTC is still Friday', () => {
    // 2026-08-29T04:00Z = Friday 2026-08-28 21:00 PT.
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        const d = new Date('2026-08-29T04:00:00.000Z');
        expect(pacificParts(d).weekday).toBe('Fri');
        expect(isPacificWeekend(d)).toBe(false);
      });
    }
  });

  it('midnight Pacific reads as hour 0, not 24', () => {
    expect(pacificParts(new Date('2026-09-02T07:00:00.000Z')).hour).toBe(0);
    expect(formatPacificClock(new Date('2026-09-02T07:00:00.000Z'))).toBe('12:00am');
    expect(formatPacificClock(new Date('2026-09-02T19:00:00.000Z'))).toBe('12:00pm');
  });
});

describe('fix-433 §B — the rule', () => {
  it('★★★ THE 08-28 CASE: past noon, nothing since local midnight → it fires', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        const f = evaluateScrapeFreshness({
          // Yesterday evening Pacific.
          lastScrapeAt: '2026-09-02T03:11:00.000Z', // Tue 2026-09-01 20:11 PT
          now: WED_1230_PT,
        });
        expect(f.missed).toBe(true);
        expect(f.reason).toBe('missed');
        expect(f.todayKey).toBe('2026-09-02');
      });
    }
  });

  it('★★★ silent before noon Pacific even with no run at all today', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        const f = evaluateScrapeFreshness({
          lastScrapeAt: '2026-09-02T03:11:00.000Z',
          now: WED_1130_PT,
        });
        expect(f.missed).toBe(false);
        expect(f.reason).toBe('before_noon');
      });
    }
  });

  it('fires at exactly noon Pacific — the boundary is inclusive', () => {
    const f = evaluateScrapeFreshness({
      lastScrapeAt: '2026-09-02T03:11:00.000Z',
      now: WED_1200_PT,
    });
    expect(pacificParts(WED_1200_PT).hour).toBe(MISSED_SCRAPE_HOUR_PT);
    expect(f.missed).toBe(true);
  });

  it('★★★ silent the moment a run lands, however early in the Pacific day', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        const f = evaluateScrapeFreshness({
          // Wed 2026-09-02 00:05 PT — a run just after local midnight.
          lastScrapeAt: '2026-09-02T07:05:00.000Z',
          now: WED_1230_PT,
        });
        expect(f.missed).toBe(false);
        expect(f.reason).toBe('ran_today');
      });
    }
  });

  it('★★★ silent all weekend regardless — Saturday and Sunday, no run since Friday', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        for (const now of [SAT_1500_PT, SUN_1500_PT]) {
          const f = evaluateScrapeFreshness({
            lastScrapeAt: AUG_28_2011_PT, // Friday evening
            now,
          });
          expect(f.missed).toBe(false);
          expect(f.reason).toBe('weekend');
        }
      });
    }
  });

  it('Monday after a quiet weekend fires — a weekend is quiet, not forgiven', () => {
    // 2026-08-31 is a Monday. 12:30 PT = 19:30Z.
    const f = evaluateScrapeFreshness({
      lastScrapeAt: AUG_28_2011_PT, // Friday
      now: new Date('2026-08-31T19:30:00.000Z'),
    });
    expect(f.missed).toBe(true);
  });

  it('no record at all is an alarm, not a shrug — a run that died writing nothing reads the same', () => {
    const f = evaluateScrapeFreshness({ lastScrapeAt: null, now: WED_1230_PT });
    expect(f.missed).toBe(true);
    expect(f.lastRun).toBeNull();
    expect(missedScrapeDetail(f)).toBe('There is no record of an earlier run.');
  });

  it('a malformed timestamp degrades to "no record" rather than throwing', () => {
    const f = evaluateScrapeFreshness({ lastScrapeAt: 'not-a-date', now: WED_1230_PT });
    expect(f.missed).toBe(true);
    expect(f.lastRun).toBeNull();
  });
});

describe('fix-433 §C1 — the wording', () => {
  it('★★★ names the ACTUAL last-run clock time, not an elapsed span', () => {
    for (const tz of ZONES) {
      inTimezone(tz, () => {
        const f = evaluateScrapeFreshness({
          lastScrapeAt: AUG_28_1701_PT,
          // Saturday would be silent, so ask on the following Monday…
          now: new Date('2026-08-31T19:30:00.000Z'),
        });
        // …3 days later, so the phrase names the weekday, and the CLOCK is
        // still the stored 5:01pm rather than anything derived from `now`.
        expect(missedScrapeDetail(f)).toBe('The last one finished on Friday at 5:01pm.');
      });
    }
  });

  it('the brief’s example sentence, verbatim', () => {
    const f = evaluateScrapeFreshness({
      // Tue 2026-09-01 17:01 PT = Wed 00:01Z.
      lastScrapeAt: '2026-09-02T00:01:00.000Z',
      now: WED_1230_PT,
    });
    expect(missedScrapeDetail(f)).toBe('The last one finished yesterday at 5:01pm.');
  });

  it('★★ the clock time does not drift as the page is left open', () => {
    const later = new Date(WED_1230_PT.getTime() + 6 * 60 * 60 * 1000);
    const a = evaluateScrapeFreshness({
      lastScrapeAt: '2026-09-02T00:01:00.000Z',
      now: WED_1230_PT,
    });
    const b = evaluateScrapeFreshness({
      lastScrapeAt: '2026-09-02T00:01:00.000Z',
      now: later,
    });
    expect(missedScrapeDetail(a)).toContain('5:01pm');
    expect(missedScrapeDetail(b)).toContain('5:01pm');
  });

  it('a run older than a week names the date rather than a weekday', () => {
    const phrase = lastScrapePhrase(
      new Date('2026-08-21T21:04:00.000Z'), // Fri 2026-08-21 14:04 PT
      WED_1230_PT,
    );
    expect(phrase).toBe('on Aug 21 at 2:04pm');
  });

  it('never says "stale", "heartbeat" or a cron string', () => {
    const f = evaluateScrapeFreshness({
      lastScrapeAt: AUG_28_1701_PT,
      now: new Date('2026-08-31T19:30:00.000Z'),
    });
    const text = missedScrapeDetail(f).toLowerCase();
    expect(text).not.toMatch(/stale|heartbeat|cron|utc|\* \*/);
  });
});

// ---------------------------------------------------------------------------
// §A — the query
// ---------------------------------------------------------------------------

const chain = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const result = { rows: [] as { created_at: string }[], error: null as unknown };
  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  builder.select = record('select');
  builder.like = record('like');
  builder.order = record('order');
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    return Promise.resolve({ data: result.rows, error: result.error });
  };
  const from = (...args: unknown[]) => {
    calls.push({ method: 'from', args });
    return builder;
  };
  const rpc = (...args: unknown[]) => {
    calls.push({ method: 'rpc', args });
    return Promise.resolve({ data: [], error: null });
  };
  return { calls, result, from, rpc };
});

vi.mock('../lib/supabase', () => ({
  supabase: { from: chain.from, rpc: chain.rpc },
}));
// The Errors page pulls in the toast store, which transitively imports the
// error logger; stub it so the page's own paths do not re-enter the mock.
vi.mock('../lib/errorLogger', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { useLastScrapeAt } from '../hooks/useScrapeFreshness';
import { useAuthStore } from '../stores/authStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/** One client per test — built in `beforeEach`, not per render, because a
 *  wrapper that constructs a QueryClient on every render never resolves. */
let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('fix-433 §A — one indexed row, not a feed', () => {
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    chain.calls.length = 0;
    chain.result.rows = [];
    chain.result.error = null;
    useAuthStore.setState({
      activeTenantId: 'tenant-uuid',
      memberships: [{ tenant_id: 'tenant-uuid', role: 'admin' }],
    });
  });

  it('★★★ reads audit_log directly: created_at only, scrape%, newest first, LIMIT 1', async () => {
    chain.result.rows = [{ created_at: AUG_28_2011_PT }];
    const { result } = renderHook(() => useLastScrapeAt(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(AUG_28_2011_PT);

    const byMethod = (m: string) => chain.calls.find((c) => c.method === m);
    expect(byMethod('from')?.args[0]).toBe('audit_log');
    // ★ ONE column. The row is 14k-deep in a table this app otherwise reads
    //   through an RPC; selecting * would drag a jsonb `changes` blob along.
    expect(byMethod('select')?.args[0]).toBe('created_at');
    expect(byMethod('like')?.args).toEqual(['action', 'scrape%']);
    expect(byMethod('order')?.args).toEqual([
      'created_at',
      { ascending: false },
    ]);
    // ★★★ THE WHOLE POINT: one row. Measured on prod as an index scan on
    //   audit_log_created_at_idx, 0.097 ms.
    expect(byMethod('limit')?.args).toEqual([1]);
  });

  it('an empty table is a settled null, not an error', async () => {
    chain.result.rows = [];
    const { result } = renderHook(() => useLastScrapeAt(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('★★ WRITES NOTHING. The chain is select-only — no insert/update/upsert/delete', async () => {
    chain.result.rows = [{ created_at: AUG_28_2011_PT }];
    const { result } = renderHook(() => useLastScrapeAt(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const methods = new Set(chain.calls.map((c) => c.method));
    // ★ The call list is non-empty, so this is an assertion and not a vacuous
    //   pass — the trap a "no forbidden method was called" test always sets.
    expect(methods.has('from')).toBe(true);
    for (const forbidden of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      expect(methods.has(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §C — where it shows
// ---------------------------------------------------------------------------

const freshnessState = vi.hoisted(() => ({
  value: null as ScrapeFreshness | null,
}));

vi.mock('../hooks/useScrapeFreshness', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../hooks/useScrapeFreshness')>();
  return {
    ...actual,
    useScrapeFreshness: () =>
      freshnessState.value ?? {
        missed: false,
        reason: 'loading' as const,
        lastRun: null,
        todayKey: '2026-09-02',
        now: WED_1230_PT,
      },
  };
});

import { MemoryRouter } from 'react-router-dom';
import MissedScrapeBanner from '../components/MissedScrapeBanner';
import MissedScrapeTriageEntry from '../components/MissedScrapeTriageEntry';
import ErrorsPage from '../pages/Errors';

const MISSED: ScrapeFreshness = {
  missed: true,
  reason: 'missed',
  lastRun: new Date('2026-09-02T00:01:00.000Z'), // Tue 17:01 PT
  todayKey: '2026-09-02',
  now: WED_1230_PT,
};

describe('fix-433 §C1 — the banner', () => {
  beforeEach(() => {
    freshnessState.value = null;
    resetMissedScrapeDismissal();
  });
  afterEach(() => {
    resetMissedScrapeDismissal();
  });

  it('renders nothing while the answer is still loading', () => {
    render(<MissedScrapeBanner />);
    expect(screen.queryByTestId('missed-scrape-banner')).toBeNull();
  });

  it('renders nothing when a run landed today', () => {
    freshnessState.value = { ...MISSED, missed: false, reason: 'ran_today' };
    render(<MissedScrapeBanner />);
    expect(screen.queryByTestId('missed-scrape-banner')).toBeNull();
  });

  it('★★★ says the fact and names when the last one finished', () => {
    freshnessState.value = MISSED;
    render(<MissedScrapeBanner />);
    expect(screen.getByTestId('missed-scrape-headline').textContent).toBe(
      'No permit scrape has run today.',
    );
    expect(screen.getByTestId('missed-scrape-detail').textContent).toBe(
      'The last one finished yesterday at 5:01pm.',
    );
  });

  it('★★ dismissal survives a REMOUNT of the shell subtree (fix-424: AuthGuard)', () => {
    freshnessState.value = MISSED;
    const first = render(<MissedScrapeBanner />);
    fireEvent.click(screen.getByTestId('missed-scrape-dismiss'));
    expect(screen.queryByTestId('missed-scrape-banner')).toBeNull();
    first.unmount();
    // A fresh mount is what AuthGuard's "Reconnecting…" swap produces.
    render(<MissedScrapeBanner />);
    expect(screen.queryByTestId('missed-scrape-banner')).toBeNull();
  });

  it('★★★ ...and comes back the next Pacific day, because the condition still holds', () => {
    freshnessState.value = MISSED;
    const first = render(<MissedScrapeBanner />);
    fireEvent.click(screen.getByTestId('missed-scrape-dismiss'));
    first.unmount();
    freshnessState.value = { ...MISSED, todayKey: '2026-09-03' };
    render(<MissedScrapeBanner />);
    expect(screen.getByTestId('missed-scrape-banner')).toBeInTheDocument();
  });
});

describe('fix-433 §C2 — the triage entry', () => {
  beforeEach(() => {
    freshnessState.value = null;
  });

  it('renders nothing when nothing is wrong', () => {
    freshnessState.value = { ...MISSED, missed: false, reason: 'ran_today' };
    render(<MissedScrapeTriageEntry />);
    expect(screen.queryByTestId('missed-scrape-triage-entry')).toBeNull();
  });

  it('★★★ ONE system-level entry, with no status actions — it is derived, not stored', () => {
    freshnessState.value = MISSED;
    const { container } = render(<MissedScrapeTriageEntry />);
    const entries = container.querySelectorAll(
      '[data-testid="missed-scrape-triage-entry"]',
    );
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.textContent).toContain('No permit scrape has run today.');
    expect(entry.textContent).toContain('yesterday at 5:01pm');
    // ★★ No Queue / Resolve / Dismiss. There is no row to write a status to,
    //    and "resolved" on a live condition is how P-069 happens.
    expect(entry.querySelectorAll('button')).toHaveLength(0);
    expect(entry.textContent).toContain('not a logged error');
  });

  it('★★★ it appears ON the triage page, above the list, and the list is untouched', async () => {
    freshnessState.value = MISSED;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useAuthStore.setState({
      activeTenantId: 'tenant-uuid',
      memberships: [{ tenant_id: 'tenant-uuid', role: 'admin' }],
    });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ErrorsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const entry = await screen.findByTestId('missed-scrape-triage-entry');
    expect(entry).toBeInTheDocument();
    // ★★ OUTSIDE the existing <ul>. Nothing about the stored rows, their
    //    grouping or their empty state changes — the brief's MUST NOT CHANGE.
    expect(entry.closest('[data-testid="errors-list"]')).toBeNull();
    // ★ Exactly one, on a page whose other rows are per-fingerprint.
    expect(
      container.querySelectorAll('[data-testid="missed-scrape-triage-entry"]'),
    ).toHaveLength(1);
    // ★ The empty state below it still renders its own words.
    expect(await screen.findByTestId('errors-empty')).toBeInTheDocument();
  });

  it('★ hidden on the Resolved tab — a condition that is TRUE has not been resolved', async () => {
    freshnessState.value = MISSED;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ErrorsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('missed-scrape-triage-entry');
    fireEvent.click(screen.getByTestId('errors-tab-resolved'));
    expect(screen.queryByTestId('missed-scrape-triage-entry')).toBeNull();
  });

  it('★ never per-permit: the entry mentions no permit or address', () => {
    freshnessState.value = MISSED;
    render(<MissedScrapeTriageEntry />);
    const text =
      screen.getByTestId('missed-scrape-triage-entry').textContent ?? '';
    expect(text).not.toMatch(/permit #|\bBLD\d|\d{3,} [A-Z]/);
  });
});

// ---------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------
//
// ★ Comment-stripped before every assertion. The two files below discuss
//   `getHours`, `getDate` and "UTC" at length in prose, and this codebase has
//   now shipped six tickets where an assertion matched a comment rather than
//   the code it was about.

import chromeSrc from '../components/Chrome.tsx?raw';
import freshnessSrc from '../lib/scrapeFreshness.ts?raw';
import hookSrc from '../hooks/useScrapeFreshness.ts?raw';

/** Strip `//` line comments and `/* … *\/` blocks. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('fix-433 — source contract', () => {
  it('the strippers actually stripped, so the assertions below mean something', () => {
    expect(freshnessSrc).toContain('★★★ THE TIMEZONE TRAP IS REAL');
    expect(code(freshnessSrc)).not.toContain('THE TIMEZONE TRAP IS REAL');
    expect(code(chromeSrc).length).toBeGreaterThan(500);
  });

  it('★★★ the banner is mounted in the SHELL, so it reaches every authenticated route', () => {
    const src = code(chromeSrc);
    expect(src).toContain("import MissedScrapeBanner from './MissedScrapeBanner'");
    expect(src).toContain('<MissedScrapeBanner />');
    // ★ Beside the two banners that already own this slot, not in a page.
    expect(src).toContain('<NewBuildNotice />');
    expect(src).toContain('<SaveFailureBanner />');
  });

  it('★★★ every date question is asked of an explicit timezone — no local-clock reads', () => {
    const src = code(freshnessSrc);
    expect(src).toContain("timeZone: PACIFIC_TZ");
    // ★★ THE TRAP, ASSERTED: getHours/getDay/getDate answer in the HOST zone.
    //    One of them anywhere in this file would make a UTC browser disagree
    //    with a Pacific one on the very day the banner is supposed to speak.
    expect(src).not.toMatch(/\.getHours\(|\.getDay\(|\.getDate\(|\.getMonth\(|\.getFullYear\(/);
  });

  it('★★ scope B: nothing is stored — no table, no insert, no alert row', () => {
    for (const src of [code(freshnessSrc), code(hookSrc)]) {
      expect(src).not.toMatch(/\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
    }
  });

  it('★★ scope A: the fact is one row and does NOT go through fetchAllRows', () => {
    const src = code(hookSrc);
    expect(src).not.toContain('fetchAllRows');
    expect(src).toContain('.limit(1)');
  });
});
