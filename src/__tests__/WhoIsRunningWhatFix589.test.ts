// ===========================================================================
// ★★★ fix-589 (P-289) — WHO IS RUNNING WHAT, AND DID THE NOTICE EVER APPEAR
// ===========================================================================
//
// The pure half: the escalation ladder, the surface detection, "how far
// behind", the unapplied-migration states, and the SQL itself. The component
// half — the heartbeat, the telemetry and the reload control — is
// `NoticeReportsItselfFix589.test.tsx`.
//
// ---------------------------------------------------------------------------
// ★★★ §1 MEASURED FIRST, AND IT KILLED THE BRIEF'S OWN HYPOTHESIS
// ---------------------------------------------------------------------------
//
// §0 proposed that the detector bypasses the HTTP cache (`cache: 'no-store'`)
// while `window.location.reload()` honours it, so a person could click Reload
// five times a day for three weeks and never move. **Measured on the deployed
// app, 2026-09-16, with the service worker controlling the page:**
//
//   1a  Cache-Control: public, max-age=0, s-maxage=300
//       ETag: W/"2258e322d35d4a45ef63c1fc60c811fe"
//       Last-Modified: Wed, 16 Sep 2026 23:19:29 UTC
//       cf-cache-status: MISS, then HIT with Age: 0
//
//   1c  location.reload() →  navigation.type 'reload'
//                            navigation.transferSize 2500
//                            navigation.deliveryType ''   ← NOT from cache
//
// `max-age=0` forces the browser to revalidate, and it does: the document goes
// to the network on every reload. **The browser half of §0 is dead.** What is
// real is `s-maxage=300` — the CDN may answer that revalidation from a copy up
// to five minutes old, and NOTHING IN THE REPO EVER DECIDED THAT. Five minutes
// cannot produce three weeks, so §1 does not explain Brittani's case either,
// which is exactly why §A exists: the question is not answerable from the
// client alone, and now it is recorded.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTICE_STEP_DAYS,
  currentDisplayMode,
  daysBehind,
  dismissQuietMs,
  noticeCopy,
  noticeStep,
  type NoticeStep,
} from '../lib/clientBuild';
import { classifyClientBuildsError, mapClientBuildRow } from '../hooks/useClientBuilds';
import swSource from '../../public/sw.js?raw';

// ===========================================================================
// §3b — THE LADDER
// ===========================================================================

describe('fix-589 §3b — the notice escalates by age, and never forces', () => {
  it('★★★ the STEP changes as the bundle ages — asserted as steps, not wording', () => {
    // The brief: *"assert the step, not the wording."* A sentence is something
    // somebody will reasonably want to reword; a ladder with four rungs is the
    // decision.
    expect(noticeStep(0)).toBe('ready');
    expect(noticeStep(0.9)).toBe('ready');
    expect(noticeStep(1)).toBe('dated');
    expect(noticeStep(2)).toBe('dated');
    expect(noticeStep(3)).toBe('behind');
    expect(noticeStep(6)).toBe('behind');
    expect(noticeStep(7)).toBe('stale');
    expect(noticeStep(21)).toBe('stale'); // Brittani's three weeks
  });

  it('★ each rung takes over exactly at its own threshold', () => {
    for (const [step, day] of Object.entries(NOTICE_STEP_DAYS)) {
      expect(noticeStep(day)).toBe(step as NoticeStep);
      if (day > 0) expect(noticeStep(day - 0.001)).not.toBe(step);
    }
  });

  it('★★ an UNKNOWN age is the calm rung', () => {
    // A dev build or a clone with no git has no build time. Not knowing how old
    // something is has never been a reason to shout at anybody.
    expect(noticeStep(null)).toBe('ready');
    expect(noticeStep(undefined)).toBe('ready');
    expect(noticeStep(Number.NaN)).toBe('ready');
  });

  it('★★★ the ESCALATION is how soon it comes back, and it tightens', () => {
    // The only mechanism that gets more insistent. Strictly decreasing, so a
    // future rung cannot be added that quietly buys MORE quiet than the one
    // below it.
    const quiet = (['ready', 'dated', 'behind', 'stale'] as const).map(dismissQuietMs);
    for (let i = 1; i < quiet.length; i += 1) {
      expect(quiet[i]).toBeLessThan(quiet[i - 1] as number);
    }
    expect(dismissQuietMs('ready')).toBe(Number.POSITIVE_INFINITY);
    expect(dismissQuietMs('stale')).toBe(15 * 60 * 1000);
  });

  it('★★★ NO STEP BLOCKS WORK, and every step keeps the promise', () => {
    // Bobby's standing ruling, restated by fix-371 and again by this brief:
    // auto-reloading discards what somebody is typing. The loudest rung is the
    // one where that would be most tempting, so it is asserted too.
    for (const step of ['ready', 'dated', 'behind', 'stale'] as const) {
      const copy = noticeCopy(step, 9);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.detail.toLowerCase()).toContain('nothing reloads on its own');
    }
  });

  it('★ it says the age out loud once it is real, and not before', () => {
    expect(noticeCopy('ready', 0).headline).not.toMatch(/\d+ days? old/);
    expect(noticeCopy('dated', 1).headline).toContain('1 day old');
    expect(noticeCopy('behind', 4).headline).toContain('4 days old');
    expect(noticeCopy('stale', 21).headline).toContain('21 days old');
  });

  it('★ only the far rungs are loud — two tones, not four', () => {
    expect(noticeCopy('ready', 0).tone).toBe('calm');
    expect(noticeCopy('dated', 1).tone).toBe('calm');
    expect(noticeCopy('behind', 3).tone).toBe('loud');
    expect(noticeCopy('stale', 7).tone).toBe('loud');
  });
});

// ===========================================================================
// §A — WHICH SURFACE, AND HOW FAR BEHIND
// ===========================================================================

describe('fix-589 §A — display_mode is the column the ticket is for', () => {
  function fakeWindow(standalone: boolean, iosStandalone?: boolean): Window {
    return {
      matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') }),
      navigator: { standalone: iosStandalone },
    } as unknown as Window;
  }

  it('★★★ reports `standalone` in an installed context', () => {
    expect(currentDisplayMode(fakeWindow(true))).toBe('standalone');
  });

  it('★★★ and `browser` in a tab', () => {
    expect(currentDisplayMode(fakeWindow(false))).toBe('browser');
  });

  it('★ iOS Safari, which predates display-mode, still reads as installed', () => {
    expect(currentDisplayMode(fakeWindow(false, true))).toBe('standalone');
  });

  it('★ a context with no matchMedia is a tab, never a crash', () => {
    expect(currentDisplayMode({ navigator: {} } as unknown as Window)).toBe('browser');
  });
});

describe('fix-589 §A — how far behind current', () => {
  const now = '2026-09-16T12:00:00Z';

  it('★★★ says how far behind, in whole days', () => {
    expect(daysBehind({ built_at: '2026-08-26T12:00:00Z' }, now)).toBe(21);
    expect(daysBehind({ built_at: '2026-09-15T12:00:00Z' }, now)).toBe(1);
  });

  it('★★ a build NEWER than the viewer’s reads as 0, never negative', () => {
    // The admin reading this screen is themselves running something. Somebody
    // ahead of them is not "-2 days behind"; they are not behind.
    expect(daysBehind({ built_at: '2026-09-18T12:00:00Z' }, now)).toBe(0);
  });

  it('★★★ an unknown build time is NULL, not zero', () => {
    // A made-up zero here would render as "current" — a false all-clear about
    // the exact question this panel exists to answer.
    expect(daysBehind({ built_at: null }, now)).toBeNull();
    expect(daysBehind({ built_at: '2026-08-26T12:00:00Z' }, '')).toBeNull();
    expect(daysBehind({ built_at: 'not a date' }, now)).toBeNull();
  });
});

// ===========================================================================
// §A — THE PANEL MUST NOT REPORT ALL-CLEAR ABOUT A TABLE THAT DOES NOT EXIST
// ===========================================================================

describe('fix-589 §A — the migration ships unapplied, and the screen knows', () => {
  it('★★★ a missing function reads as "not recorded", never as "nobody is stale"', () => {
    // PGRST202 is PostgREST's "no function matches" — the state of production
    // from merge until Bobby runs the migration. Collapsing it into an empty
    // list would be fix-588's injury in a new costume.
    expect(classifyClientBuildsError({ code: 'PGRST202', message: 'not found' })).toEqual({
      kind: 'unavailable',
    });
  });

  it('★★ a refusal is the gate working, and reads differently', () => {
    expect(classifyClientBuildsError({ code: '42501', message: 'admin only' })).toEqual({
      kind: 'refused',
    });
  });

  it('★ no error at all is not a state — the caller proceeds to the rows', () => {
    expect(classifyClientBuildsError(null)).toBeNull();
  });

  it('★★ and anything else is still "cannot say"', () => {
    // A network blip must not become an all-clear either.
    expect(classifyClientBuildsError({ code: '08006', message: 'connection' })).toEqual({
      kind: 'unavailable',
    });
  });

  it('★ the row mapper keeps an unknown display mode readable', () => {
    const row = mapClientBuildRow({
      out_user_id: 'u1',
      out_email: 'x@y.z',
      out_name: 'Brittani',
      out_build: 'abc1234',
      out_built_at: '2026-08-26T12:00:00Z',
      out_display_mode: 'window-controls-overlay',
      out_first_seen_at: '2026-08-26T12:00:00Z',
      out_last_seen_at: '2026-09-16T12:00:00Z',
      out_notice_shown_count: null,
      out_notice_first_shown_at: null,
      out_notice_dismissed_at: null,
      out_notice_reloaded_at: null,
    });
    expect(row.display_mode).toBe('browser');
    expect(row.notice_shown_count).toBe(0);
    expect(row.name).toBe('Brittani');
  });
});

// ===========================================================================
// THE MIGRATION — RLS IS THE HALF THAT CANNOT BE TESTED AGAINST A LIVE DB HERE
// ===========================================================================
//
// ★ There is no database in CI (see the repo's standing note), so the policies
//   are asserted as text. The behavioural half was run against prod inside a
//   transaction that aborted — the PR quotes it.

// ★★ THE COMMENT-STRIPPING TRAP, WHICH THIS REPO HAS FALLEN INTO SIX TIMES.
//    Every file below DISCUSSES the thing it must not contain — the migration
//    explains in prose that there is no `p_user_id`, and `sw.js` spends two
//    paragraphs on the caching it deliberately does not do. An assertion run
//    against the raw text matches the paragraph and passes or fails for the
//    wrong reason. Strip first, always.
function sqlCode(src: string): string {
  return src.replace(/^\s*--.*$/gm, '');
}
function jsCode(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-589 — the staged migration', () => {
  const sql = sqlCode(
    readFileSync(
      join(process.cwd(), 'migrations', 'fix_589_client_build_seen.sql'),
      'utf8',
    ),
  );

  it('★ the table carries every column the brief named', () => {
    for (const col of [
      'user_id',
      'build',
      'display_mode',
      'user_agent',
      'first_seen_at',
      'last_seen_at',
      'tenant_id',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(sql).toContain('PRIMARY KEY (user_id, build)');
  });

  it('★★★ a person may write only their OWN row', () => {
    // Pinned to auth.uid() rather than to a tenant, so an admin cannot write a
    // heartbeat on somebody else's behalf either. A record that can be forged
    // is worse than none, because it reads as evidence.
    expect(sql).toMatch(/FOR INSERT WITH CHECK \(\s*user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/FOR UPDATE USING \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/WITH CHECK \(user_id = auth\.uid\(\)\)/);
    // ★ And the function takes no user id at all, so "record a build for
    //   somebody else" has no expression.
    expect(sql).not.toMatch(/p_user_id/);
  });

  it('★★★ reading the roster is tenant-admin only, in the policy AND the function', () => {
    expect(sql).toMatch(/FOR SELECT USING \([\s\S]*?is_tenant_admin\(tenant_id\)/);
    // The list RPC is SECURITY DEFINER, so RLS does not apply inside it and
    // this guard IS the gate.
    expect(sql).toMatch(/NOT public\.is_tenant_admin\(v_tenant\)[\s\S]*?RAISE EXCEPTION/);
    expect(sql).toContain("USING ERRCODE = '42501'");
  });

  it('★★ neither function is reachable by anon — fix-157 / fix-273 posture', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bp_record_client_build[\s\S]*?FROM PUBLIC, anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bp_list_client_builds\(\)[\s\S]*?FROM PUBLIC, anon/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.client_build_seen FROM PUBLIC, anon/);
  });

  it('★ it is a heartbeat: one row per person per build, updated in place', () => {
    expect(sql).toContain('ON CONFLICT (user_id, build) DO UPDATE SET');
    // first_seen never moves; last_seen always does.
    expect(sql).toMatch(/last_seen_at = now\(\)/);
    expect(sql).not.toMatch(/first_seen_at = now\(\)\s*,?\s*$/m);
  });

  it('★★★ it records the notice’s own life — the half that was unanswerable', () => {
    for (const col of [
      'notice_first_shown_at',
      'notice_shown_count',
      'notice_dismissed_at',
      'notice_reloaded_at',
    ]) {
      expect(sql).toContain(col);
    }
    // ★ FIRST shown is never overwritten; the COUNT is what grows. "It showed
    //   once three weeks ago" and "it has shown 60 times" are different answers
    //   to Bobby's question and both matter.
    expect(sql).toMatch(/notice_first_shown_at = COALESCE\(c\.notice_first_shown_at/);
    expect(sql).toMatch(/notice_shown_count\s*= c\.notice_shown_count \+ EXCLUDED\.notice_shown_count/);
  });

  it('⛔ it builds no analytics pipeline — one table, no event stream', () => {
    // §4: "Do not build a general analytics or telemetry pipeline." One table,
    // and no second one hiding in the same file.
    const creates = sql.match(/CREATE TABLE/gi) ?? [];
    expect(creates).toHaveLength(1);
    expect(sql).not.toMatch(/page_path|route|dwell|session_id|referrer/i);
  });
});

// ===========================================================================
// §4 — THE TWO STANDING RULINGS
// ===========================================================================

describe('fix-589 §4 — what this ticket did not touch', () => {
  it('⛔ sw.js still caches NOTHING', () => {
    // fix-369 excluded it on purpose, and §0 explains why it is the classic
    // cause of the very bug this ticket chased. Asserted on the file, so the
    // next person to reach for a cache here trips this first.
    const sw = jsCode(swSource);
    expect(sw).not.toMatch(/caches\.|respondWith|CACHE_NAME|precache/i);
    expect(sw).toMatch(/addEventListener\('fetch', \(\) => \{\}\)/);
  });

  it('⛔ the render.yaml header split does not cache the entry point', () => {
    const yaml = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');
    // index.html must never be stored; the fingerprinted bundle may be kept
    // for ever. That is the whole decision, and it is now written down where
    // it can be reviewed instead of being a host default nobody chose.
    expect(yaml).toMatch(/path: \/index\.html[\s\S]*?value: no-store, must-revalidate/);
    expect(yaml).toMatch(/path: \/assets\/\*[\s\S]*?value: public, max-age=31536000, immutable/);
    // ★ And it restates the SPA rewrite, so linking this Blueprint cannot turn
    //   every deep link into a 404.
    expect(yaml).toMatch(/type: rewrite[\s\S]*?destination: \/index\.html/);
  });
});
