import { describe, it, expect } from 'vitest';
import migration from '../../migrations/fix_370_activity_window.sql?raw';
import hookSource from '../hooks/useScraperActivity.ts?raw';
import boardSource from '../lib/myBoard.ts?raw';
import notificationsSource from '../pages/Notifications.tsx?raw';
import bellSource from '../components/BoardBell.tsx?raw';
import activityPageSource from '../pages/ActivityPage.tsx?raw';
import {
  SCRAPER_ACTIVITY_DAYS_DEFAULT,
  SCRAPER_ACTIVITY_ROW_CAP,
  SCRAPER_SUPPRESSED_ROW_CAP,
} from '../hooks/useScraperActivity';
import {
  activityWindowLabel,
  isFeedTruncated,
  suppressedSampleNote,
  trueSuppressionCounts,
  truncationNote,
  type ActivitySummary,
} from '../lib/activityWindow';
import { suppressionGroups, type BoardViewer } from '../lib/myBoard';

// ===========================================================================
// fix-370 — the notification feed was a 19-hour window wearing a 14-day label
// ===========================================================================
//
// MEASURED ON PROD 2026-08-20, before anything was written:
//
//   rows matching bp_fetch_scraper_activity's own WHERE over 14 days   1,600
//   rows it returned                                                     300
//   dropped                                                     1,300 (81%)
//   where the 300th row fell                        2026-08-19 15:29 — YESTERDAY
//   rows in the last 24 hours alone                                      167
//
//   scrape_workflow_fetch_recovered            603 / 14d — 38% of ALL volume
//   scrape_*_skipped_recent_manual_edit         322 / 14d
//   showable (everything else)                  675 / 14d
//
// ★★★ Bobby's bell read "Not shown · 295" — 295 of the 300 rows that were
// fetched. About five slots were left for anything a person could be shown, and
// the suppression classifier ran AFTER the cap, so the number described the
// page rather than the fortnight it claimed.
//
// ★ These fixtures are built from that real shape, not from round numbers: a
// test that passes on 10 rows would have passed before the ticket too.

// ---------------------------------------------------------------------------
// The real shape, as a fixture
// ---------------------------------------------------------------------------

const RETRY = 'scrape_workflow_fetch_recovered';
const GUARD_A = 'scrape_skipped_recent_manual_edit';
const GUARD_B = 'scrape_cycle_skipped_recent_manual_edit';
const SHOWABLE = 'scrape_status_changed';

interface Row {
  id: number;
  action: string;
  ent_lead: string | null;
  created_at: string;
}

/** 14 days of prod-shaped volume: 603 retries, 322 guards, 675 showable. */
function fortnight(): Row[] {
  const rows: Row[] = [];
  let id = 0;
  const push = (action: string, n: number, ent: (i: number) => string | null) => {
    for (let i = 0; i < n; i += 1) {
      // Spread across the 14 days so "the oldest row" means something.
      const day = 7 + Math.floor((i / n) * 14);
      rows.push({
        id: (id += 1),
        action,
        ent_lead: ent(i),
        created_at: `2026-08-${String(Math.min(20, day)).padStart(2, '0')}T10:00:00Z`,
      });
    }
  };
  push(RETRY, 603, () => null);
  push(GUARD_A, 149, () => null);
  push(GUARD_B, 173, () => null);
  // ★ Two thirds of the showable rows belong to someone other than Bobby —
  // which is what makes `notYours` a per-viewer number rather than a constant.
  push(SHOWABLE, 675, (i) => (i % 3 === 0 ? 'Bobby' : 'Miles'));
  return rows;
}

const SUMMARY: ActivitySummary = {
  window_days: 14,
  total: 1600,
  showable: 675,
  retries: 603,
  guarded: 322,
  oldest_at: '2026-08-07T01:17:49Z',
  newest_at: '2026-08-20T15:31:58Z',
};

const BOBBY = { name: 'Bobby' } as BoardViewer;
const MILES = { name: 'Miles' } as BoardViewer;

/** What the OLD single-budget RPC returned: the newest 300 of everything. */
function oldPage(all: Row[]): Row[] {
  return [...all]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 300);
}

/** What the NEW two-budget RPC returns: each class ranked among itself. */
function newPage(
  all: Row[],
  limit = SCRAPER_ACTIVITY_ROW_CAP,
  suppressedLimit = SCRAPER_SUPPRESSED_ROW_CAP,
): Row[] {
  const isSuppressed = (a: string) => a === RETRY || a === GUARD_A || a === GUARD_B;
  const desc = (a: Row, b: Row) =>
    b.created_at.localeCompare(a.created_at) || b.id - a.id;
  const showable = all.filter((r) => !isSuppressed(r.action)).sort(desc).slice(0, limit);
  const suppressed = all
    .filter((r) => isSuppressed(r.action))
    .sort(desc)
    .slice(0, suppressedLimit);
  return [...showable, ...suppressed].sort(desc);
}

// ---------------------------------------------------------------------------
// §1 — ★★★ the window is delivered, not merely claimed
// ---------------------------------------------------------------------------

describe('fix-370 §1: the feed covers the window it advertises', () => {
  it('★★★ the old single budget was 81% loss and under a day of coverage', () => {
    // The bug, expressed as a test so the shape is on the record.
    const all = fortnight();
    expect(all).toHaveLength(1600);
    const before = oldPage(all);
    expect(before).toHaveLength(300);
    expect(all.length - before.length).toBe(1300);
    // ★★★ And the losers were the rows a person could be shown: the two loud
    // classes are 58% of volume and they win on recency.
    const showableBefore = before.filter((r) => r.action === SHOWABLE).length;
    expect(showableBefore).toBeLessThan(300);
  });

  it('★★★ a window whose volume exceeds the cap returns rows from the FULL period', () => {
    const all = fortnight();
    const page = newPage(all);
    const showable = page.filter((r) => r.action === SHOWABLE);
    // Every showable row in the fortnight arrives — not the newest slice of one.
    expect(showable).toHaveLength(675);
    const oldest = showable.reduce((a, r) => (r.created_at < a ? r.created_at : a), 'z');
    const newest = showable.reduce((a, r) => (r.created_at > a ? r.created_at : a), '');
    expect(oldest.slice(0, 10)).toBe('2026-08-07');
    expect(newest.slice(0, 10)).toBe('2026-08-20');
  });

  it('★★★ the two loud actions never occupy a showable slot', () => {
    // ★ Asserted by ACTION NAME, from the real strings — a class of row cannot
    // quietly rejoin the budget under a rename.
    const all = fortnight();
    const showableBudget = newPage(all).filter(
      (r) => ![RETRY, GUARD_A, GUARD_B].includes(r.action),
    );
    expect(showableBudget).toHaveLength(675);
    for (const action of [RETRY, GUARD_A, GUARD_B]) {
      expect(showableBudget.some((r) => r.action === action)).toBe(false);
    }
  });

  it('★★ …and they are still FETCHED, as a bounded sample', () => {
    // Not excluded: fix-336's centre lists these rows behind the count, and
    // deleting them would delete a signal two tickets built.
    const page = newPage(fortnight());
    const suppressed = page.filter((r) => [RETRY, GUARD_A, GUARD_B].includes(r.action));
    expect(suppressed).toHaveLength(SCRAPER_SUPPRESSED_ROW_CAP);
  });

  it('★★★ THE ARITHMETIC: the cap clears the worst fortnight on record', () => {
    // showable per 14 days today                          675
    // worst 14-day window across 60 days of history       799
    // busiest single day                                  199
    expect(SCRAPER_ACTIVITY_ROW_CAP).toBeGreaterThan(675);
    expect(SCRAPER_ACTIVITY_ROW_CAP).toBeGreaterThan(799);
    // ★ …with real headroom, not by one row. Volume would have to nearly
    // double and stay doubled for a fortnight before this bit.
    expect(SCRAPER_ACTIVITY_ROW_CAP / 799).toBeGreaterThan(1.8);
    expect(SCRAPER_ACTIVITY_DAYS_DEFAULT).toBe(14);
  });

  it('★ the caps are passed to the RPC, not left to a DEFAULT in a migration', () => {
    expect(hookSource).toContain('p_limit: SCRAPER_ACTIVITY_ROW_CAP');
    expect(hookSource).toContain('p_suppressed_limit: SCRAPER_SUPPRESSED_ROW_CAP');
    expect(migration).toContain('p_limit            integer DEFAULT 1500');
    expect(migration).toContain('p_suppressed_limit integer DEFAULT 300');
  });
});

// ---------------------------------------------------------------------------
// §2 — ★★★ the counts are of the window, not of the page
// ---------------------------------------------------------------------------

describe('fix-370 §2: the suppressed counts describe the whole window', () => {
  it('★★★ the count is LARGER than the page — which is exactly the bug', () => {
    const page = newPage(fortnight());
    const counts = trueSuppressionCounts(SUMMARY, page, BOBBY);
    expect(counts.retries).toBe(603);
    expect(counts.guarded).toBe(322);
    // ★★★ 925 suppressed against a 300-row sample of them. A count computed
    // over the page could not have exceeded the page; this one does, and that
    // is the whole point.
    expect(counts.retries + counts.guarded).toBeGreaterThan(
      page.filter((r) => [RETRY, GUARD_A, GUARD_B].includes(r.action)).length,
    );
  });

  it('★★★ the number Bobby reads goes from 295 to 925 + notYours', () => {
    const all = fortnight();
    // BEFORE: classify the old 300-row page, which is what shipped.
    const before = suppressionGroups(oldPage(all), BOBBY);
    const beforeTotal =
      before.retries.length + before.guarded.length + before.notYours.length;
    // AFTER: true totals for the two row-level classes.
    const after = trueSuppressionCounts(SUMMARY, newPage(all), BOBBY);
    const afterTotal = after.retries + after.guarded + after.notYours;
    expect(beforeTotal).toBeLessThanOrEqual(300);
    expect(afterTotal).toBeGreaterThan(beforeTotal * 3);
  });

  it("★★★ fix-298's signal survives: the line still renders and is non-zero", () => {
    // "Showing the SUPPRESSED COUNT is how a quiet day and a broken notifier
    // stop looking the same." The line is not deleted, and nothing in this
    // ticket may make it able to read zero on a day that was not quiet.
    const counts = trueSuppressionCounts(SUMMARY, newPage(fortnight()), BOBBY);
    expect(counts.retries).toBeGreaterThan(0);
    expect(counts.guarded).toBeGreaterThan(0);
    expect(counts.notYours).toBeGreaterThan(0);
    expect(bellSource).toContain('board-bell-suppressed');
    expect(bellSource).toContain('bell-suppressed-retries');
    expect(bellSource).toContain('bell-suppressed-guarded');
    expect(bellSource).toContain('bell-suppressed-notyours');
  });

  it('★★ a quiet window really does read zero — the signal still works both ways', () => {
    const quiet: ActivitySummary = {
      ...SUMMARY,
      total: 0,
      showable: 0,
      retries: 0,
      guarded: 0,
    };
    const counts = trueSuppressionCounts(quiet, [], BOBBY);
    expect(counts).toEqual({ retries: 0, guarded: 0, notYours: 0 });
  });

  it('★ with no summary yet it falls back to the page, never to zeros', () => {
    // ★ First paint, or a failed aggregate. An understated count is wrong; a
    // count that vanishes looks like a quiet day, which is the one thing this
    // line exists to prevent.
    const page = newPage(fortnight());
    const counts = trueSuppressionCounts(null, page, BOBBY);
    expect(counts.retries).toBe(
      page.filter((r) => r.action === RETRY).length,
    );
    expect(counts.retries).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★ notYours stays per viewer
// ---------------------------------------------------------------------------

describe('fix-370 §3: notYours is per viewer and stays in the browser', () => {
  it('★★ two viewers, the same rows, different counts', () => {
    const page = newPage(fortnight());
    const bobby = trueSuppressionCounts(SUMMARY, page, BOBBY);
    const miles = trueSuppressionCounts(SUMMARY, page, MILES);
    // Same window, so the row-level classes are identical…
    expect(bobby.retries).toBe(miles.retries);
    expect(bobby.guarded).toBe(miles.guarded);
    // …and the per-person one is not. 675 showable rows, one third Bobby's.
    expect(bobby.notYours).toBe(450);
    expect(miles.notYours).toBe(225);
    expect(bobby.notYours).not.toBe(miles.notYours);
  });

  it('★★★ the viewer is NEVER sent to the RPC', () => {
    // ★ One cached RPC result per person, and a rendering policy frozen into
    // SQL, in exchange for one number that the cap already makes exact. The
    // brief forbids it and so does this test.
    const stripped = migration
      .replace(/^\s*--.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');
    expect(stripped).not.toMatch(/p_viewer|viewer_name|auth\.uid\(\)|ent_lead\s*=/);
    expect(hookSource).not.toMatch(/p_viewer|viewer/i);
  });

  it('★★ notYours is exact while the feed is not truncated', () => {
    // ★ THE HONESTY ARGUMENT, asserted: the count is taken over the rows that
    // arrived, and every showable row in the window arrives, so it IS the
    // window's count. `isFeedTruncated` is what says when that stops holding.
    const page = newPage(fortnight());
    expect(isFeedTruncated(SUMMARY, page)).toBe(false);
    const counted = page.filter(
      (r) => r.action === SHOWABLE && r.ent_lead !== 'Bobby',
    ).length;
    expect(trueSuppressionCounts(SUMMARY, page, BOBBY).notYours).toBe(counted);
  });
});

// ---------------------------------------------------------------------------
// §4 — ★ a truncated feed says it is truncated
// ---------------------------------------------------------------------------

describe('fix-370 §4: truncation is stated, never implied', () => {
  it('★ nothing is claimed when nothing is hidden', () => {
    const page = newPage(fortnight());
    expect(isFeedTruncated(SUMMARY, page)).toBe(false);
    expect(truncationNote(SUMMARY, page)).toBeNull();
  });

  it('★★ a cap that DOES bite produces a sentence with both numbers', () => {
    // Force it: a 400-row budget against the same 675-row fortnight.
    const page = newPage(fortnight(), 400);
    expect(isFeedTruncated(SUMMARY, page)).toBe(true);
    const note = truncationNote(SUMMARY, page);
    expect(note).toContain('400');
    expect(note).toContain('675');
    expect(note).toContain('14 days');
  });

  it('★★ the suppressed sample says it is a sample', () => {
    expect(suppressedSampleNote(603, 300)).toContain('603');
    expect(suppressedSampleNote(603, 300)).toContain('300');
    // …and says nothing when the rows ARE the count.
    expect(suppressedSampleNote(12, 12)).toBeNull();
    expect(suppressedSampleNote(3, 12)).toBeNull();
  });

  it('★ the centre renders the true count and the sample note', () => {
    expect(notificationsSource).toContain('counts={suppressed}');
    expect(notificationsSource).toContain('{s.total.toLocaleString()}');
    expect(notificationsSource).toContain('suppressedSampleNote(s.total, s.rows.length)');
    // ★ The old header printed `rows.length` and called it the count.
    expect(notificationsSource).not.toContain('{s.title} · {s.rows.length}');
  });

  it('★ the bell renders the truncation sentence when there is one', () => {
    expect(bellSource).toContain('activityTruncationNote');
    expect(bellSource).toContain('bell-activity-truncated');
  });
});

// ---------------------------------------------------------------------------
// §5 — ★★ the Activity page had the same wound
// ---------------------------------------------------------------------------

describe('fix-370 §5: the Activity page states the window honestly', () => {
  it('★★★ it no longer prints a page size under a fortnight label', () => {
    // Was: "300 events in the last 14 days" — where 300 was 19 hours of them.
    expect(activityPageSource).not.toMatch(/\{all\.length\} event/);
    expect(activityPageSource).toContain('activityWindowLabel(');
    expect(activityPageSource).toContain('activity-window-label');
  });

  it('★★ both numbers when they differ, one when they do not', () => {
    expect(activityWindowLabel(SUMMARY, 975, 14)).toBe(
      '975 of 1,600 events in the last 14 days',
    );
    const complete: ActivitySummary = { ...SUMMARY, total: 42 };
    expect(activityWindowLabel(complete, 42, 14)).toBe('42 events in the last 14 days');
    expect(activityWindowLabel({ ...SUMMARY, total: 1 }, 1, 14)).toBe(
      '1 event in the last 14 days',
    );
  });

  it('★ before the aggregate lands it says what it has, with the real window', () => {
    expect(activityWindowLabel(null, 5, 14)).toBe('5 events in the last 14 days');
  });

  it('★★ the page and the bell read ONE model — fix-336 stands', () => {
    // Both go through useScraperActivity / useScraperActivitySummary; neither
    // builds its own definition of the window.
    expect(activityPageSource).toContain("from '../hooks/useScraperActivity'");
    expect(activityPageSource).not.toMatch(/supabase\.rpc|bp_fetch_scraper_activity/);
    expect(bellSource).not.toMatch(/supabase\.rpc|bp_fetch_scraper_activity/);
  });
});

// ---------------------------------------------------------------------------
// §6 — ★★ the SQL, and its twin
// ---------------------------------------------------------------------------

describe('fix-370 §6: the migration', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('★★★ each class is ranked in its OWN partition', () => {
    // The entire mechanism: 603 retries cannot take a slot a status flip
    // needed, because they are not competing for the same slots.
    expect(sql).toContain('PARTITION BY b.is_suppressed');
    expect(sql).toMatch(/row_number\(\) OVER/);
    expect(sql).toContain('r.rn <= GREATEST(p_limit, 1)');
    expect(sql).toContain('r.rn <= GREATEST(p_suppressed_limit, 0)');
    // ★ …and there is no bare LIMIT left to reintroduce a shared budget.
    expect(sql).not.toMatch(/\n\s*LIMIT\s+\d+/);
  });

  it('★★ the tie-break is there — row_number over a tie is not deterministic', () => {
    // Several audit rows routinely share a created_at to the microsecond; the
    // same query would otherwise return a different 1,500 on two runs.
    expect(sql).toContain('ORDER BY b.created_at DESC, b.id DESC');
  });

  it('★★ the one-argument function is DROPPED, not overloaded', () => {
    // Defaulted parameters create an overload, and a PostgREST call passing
    // only p_days would then be ambiguous and fail outright.
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bp_fetch_scraper_activity(integer)');
  });

  it('★★★ the summary is uncapped and returns no rows', () => {
    const summaryFn = sql.slice(sql.indexOf('bp_scraper_activity_summary'));
    expect(summaryFn).toContain('count(*)');
    expect(summaryFn).not.toMatch(/LIMIT|row_number/);
  });

  it('★★ the action vocabulary is single-sourced in SQL', () => {
    expect(sql).toContain('bp_scraper_retry_actions()');
    expect(sql).toContain('bp_scraper_guard_actions()');
    expect(sql).toContain(
      'SELECT public.bp_scraper_retry_actions() || public.bp_scraper_guard_actions();',
    );
    // The feed predicate too — a total over a different WHERE clause is a
    // number that disagrees with its own list.
    expect(sql).toContain('public.bp_scraper_activity_feed_action(al.action)');
    expect((sql.match(/bp_scraper_activity_feed_action\(al\.action\)/g) ?? []).length).toBe(2);
  });

  it('★★★ SQL and TS agree about what "suppressed" means', () => {
    // ★ THE TWIN. `myBoard.RETRY_ACTIONS` / `GUARD_ACTIONS` still classify these
    // rows in the browser for the centre's three sections; if the two lists
    // drift, the count and the list stop describing the same thing.
    for (const action of [RETRY, GUARD_A, GUARD_B]) {
      expect(sql, `SQL is missing ${action}`).toContain(`'${action}'`);
      expect(boardSource, `TS is missing ${action}`).toContain(`'${action}'`);
    }
    // ★ The one deliberate asymmetry, asserted so it cannot look like drift:
    // TS keeps the reviewer variant because its set is applied to rows from
    // anywhere; SQL omits it because the feed predicate excludes every
    // scrape_reviewer_% action one step earlier.
    expect(boardSource).toContain("'scrape_reviewer_skipped_recent_manual_edit'");
    expect(sql).not.toContain("'scrape_reviewer_skipped_recent_manual_edit'");
    expect(sql).toContain("NOT LIKE 'scrape\\_reviewer\\_%'");
  });

  it('★ anon gets nothing, and the RPCs stay SECURITY INVOKER', () => {
    // Unchanged posture: RLS on audit_log/permits/projects does the tenant
    // scoping exactly as it did before this ticket.
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bp_fetch_scraper_activity(integer, integer, integer) FROM PUBLIC, anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bp_scraper_activity_summary(integer) TO authenticated, service_role');
    expect(sql).not.toContain('SECURITY DEFINER');
    expect((sql.match(/SET search_path TO 'public', 'pg_temp'/g) ?? []).length).toBe(6);
  });

  it('★ no data is written — this is a read path', () => {
    expect(sql).not.toMatch(/INSERT INTO|UPDATE\s+public\.|DELETE FROM|TRUNCATE/);
  });
});
