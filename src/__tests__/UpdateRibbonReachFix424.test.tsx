import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import chromeSource from '../components/Chrome.tsx?raw';
import routerSource from '../router.tsx?raw';
import noticeSource from '../components/NewBuildNotice.tsx?raw';
import {
  BUILD_CHECK_FIRST_MS,
  BUILD_CHECK_INTERVAL_MS,
  BUILD_CHECK_MIN_GAP_MS,
  markNewBuildLive,
  newBuildIsLive,
} from '../lib/appVersion';
import NewBuildNotice from '../components/NewBuildNotice';

// ===========================================================================
// fix-424 — why the "new version is ready" ribbon never reaches the app
// ===========================================================================
//
// Bobby, 2026-08-27, with a screenshot of the ribbon in his hand: *"I feel like
// this is not popping up on the app and my other screens for some reason."*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0, AND THE HYPOTHESIS IN THE BRIEF IS WRONG — MEASURED, NOT ARGUED
// ---------------------------------------------------------------------------
//
// The brief guessed the service worker: an installed app is served by one, so
// perhaps a cached shell never sees the new bundle hash. It asked to be told
// plainly if STEP 0 disagreed. It disagrees.
//
// Measured in a real Chrome, on the real `npm run build` output served over
// http, with `/sw.js` registered AND `navigator.serviceWorker.controller`
// non-null:
//
//   · baseline            running === deployed, no false positive
//   · after a "deploy"    running /assets/index-B9-D05ZE.js
//                         deployed /assets/index-DEPLOY02.js   → wouldNotify true
//   · the real component  rendered the real ribbon, with the Reload button
//
// `public/sw.js` caches nothing — its `fetch` listener never calls
// `respondWith`, which is fix-369's central scope decision — so the build check
// reaches the network exactly as it would with no worker at all. **Nothing in
// this ticket touches the service worker**, which is also what keeps it on the
// SHIP side of the brief's gate.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT IS ACTUALLY WRONG IS *WHEN IT LOOKS* — AND fix-371 §1 KNEW
// ---------------------------------------------------------------------------
//
// From lib/realtimeLiveness, written by the SAME ticket that shipped this
// notice: *"The fallback poll is `window.setInterval`. Chrome throttles timers
// in a backgrounded page to once a minute and FREEZES them entirely in a
// backgrounded installed app."* §1 redesigned realtime liveness around that.
// §4 then built the notice on a `setInterval` plus one `visibilitychange`.
//
// And `visibilitychange` does not fire when a window merely gains FOCUS, so a
// window parked on a second monitor has no event trigger at all. Measured here:
// a visible-but-unfocused tab is NOT throttled (a 1s interval fired ~1/s), so
// that window polls — every fifteen minutes, and nothing else.
//
//     surface                          visibilitychange   setInterval   delay
//     focused tab                      on tab switch      runs          ≤ poll
//     visible, unfocused (2nd monitor) NEVER              runs          = poll
//     hidden tab                       on return          throttled     instant
//     backgrounded installed app       on restore         FROZEN        instant
//
// ★ jsdom HAS NO WINDOW MANAGER AND NO SERVICE WORKER. It cannot show that a
//   real second monitor is reached; what it CAN prove is that the listener is
//   registered, that the floor holds, and that the notice survives a remount.
//   The browser half is written up in the PR with the numbers above, and the
//   manual check Bobby can run is in the PR body.

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

// ---------------------------------------------------------------------------
// §A · STEP 0(a) — the mount point, asserted AT the mount point
// ---------------------------------------------------------------------------

describe('fix-424 §A: the ribbon is mounted on every authenticated route', () => {
  it('★★★ Chrome renders it, and Chrome is the layout element for "/"', () => {
    // ★ THE BRIEF ASKED FOR THIS TO BE ASSERTED AT THE MOUNT POINT rather than
    //   by rendering one page — rendering /dashboard and finding the ribbon
    //   says nothing about /project/:id. The router says it about all of them
    //   at once: every authenticated route is a CHILD of the element that
    //   renders the notice, so there is one answer and not fourteen.
    const chrome = strip(chromeSource);
    expect(chrome).toContain('<NewBuildNotice />');
    // Exactly one mount: a second would announce and re-announce.
    expect(chrome.match(/<NewBuildNotice\s*\/>/g) ?? []).toHaveLength(1);

    const router = strip(routerSource);
    // The '/' route's element is Chrome, and its `children` carry the pages.
    expect(router).toMatch(/path:\s*'\/'[\s\S]*?<Chrome\s*\/>[\s\S]*?children:\s*\[/);
    for (const path of ['dashboard', 'projects', 'project/:id', 'library', 'draw-schedule']) {
      expect(router, `${path} is a child of the Chrome layout`).toContain(`path: '${path}'`);
    }
  });

  it('★ …and /login is deliberately outside it', () => {
    // Not a defect and not this ticket: there is no app to be out of date on
    // the sign-in screen, and it is stated here so the next reader does not
    // "fix" it.
    const router = strip(routerSource);
    expect(router).toMatch(/path:\s*'\/login',\s*element:\s*<Login\s*\/>/);
  });
});

// ---------------------------------------------------------------------------
// §B · the notice survives a remount of the shell subtree
// ---------------------------------------------------------------------------

describe('fix-424 §B: a shown notice is never taken back down', () => {
  it('★★★ it seeds from newBuildIsLive(), so a remount keeps it', () => {
    // ★★ THE DEFECT: `available` was `useState(false)`. lib/appVersion records
    //    the discovery in a module-level flag documented as permanent — "Never
    //    unset: a deploy that has happened stays a fact for the life of this
    //    document" — and fix-372's save-failure banner already reads it. The
    //    component that DISCOVERS the fact was the one surface not consulting
    //    it, so any remount of the shell silently retracted the ribbon.
    //
    // ★★ AND THE REMOUNT IS REAL, not hypothetical: AuthGuard returns a plain
    //    <div>Loading…</div> / <div>Reconnecting…</div> INSTEAD OF its children
    //    while a session verify is in flight, which unmounts Chrome and
    //    everything under it. That happens to a window left open all day.
    markNewBuildLive();
    expect(newBuildIsLive()).toBe(true);
    const { unmount } = render(<NewBuildNotice />);
    expect(screen.getByTestId('new-build-notice')).toBeInTheDocument();
    unmount();
    // The remount — a fresh component instance, exactly as AuthGuard produces.
    render(<NewBuildNotice />);
    expect(screen.getByTestId('new-build-notice')).toBeInTheDocument();
    expect(screen.getByTestId('new-build-reload')).toBeInTheDocument();
  });

  it('★ and it still renders NOTHING before a deploy is seen', () => {
    // The guard that keeps the shell unchanged for everybody on the current
    // build, which is everybody most of the time. Asserted on the source,
    // because the module flag is process-wide within a test file.
    expect(strip(noticeSource)).toContain('if (!available) return null;');
  });
});

// ---------------------------------------------------------------------------
// §C · the triggers — the actual fix
// ---------------------------------------------------------------------------

describe('fix-424 §C: three triggers, because they cover different surfaces', () => {
  let added: string[];
  let winAdd: typeof window.addEventListener;
  let docAdd: typeof document.addEventListener;

  beforeEach(() => {
    added = [];
    winAdd = window.addEventListener;
    docAdd = document.addEventListener;
    window.addEventListener = function (type: string, ...rest: unknown[]) {
      added.push(`window:${type}`);
      return (winAdd as unknown as (...a: unknown[]) => void).call(window, type, ...rest);
    } as typeof window.addEventListener;
    document.addEventListener = function (type: string, ...rest: unknown[]) {
      added.push(`document:${type}`);
      return (docAdd as unknown as (...a: unknown[]) => void).call(document, type, ...rest);
    } as typeof document.addEventListener;
  });
  afterEach(() => {
    window.addEventListener = winAdd;
    document.addEventListener = docAdd;
  });

  it('★★★ it listens for FOCUS as well as visibilitychange', () => {
    // ★★★ THE ONE THAT REACHES "MY OTHER SCREENS". `visibilitychange` fires
    //     when a tab is switched to or an installed app is restored; it does
    //     NOT fire when a window that was already on screen is clicked into,
    //     because nothing about its visibility changed. A second monitor
    //     therefore had no event trigger at all and waited out the whole poll.
    //     fix-371 §1 chose visibilitychange over focus for the installed app
    //     and was right to — the mistake was treating them as alternatives.
    render(<NewBuildNotice />);
    expect(added).toContain('document:visibilitychange');
    expect(added).toContain('window:focus');
  });

  it('★★ both listeners are removed on unmount', () => {
    // A listener that outlives its component keeps fetching from a dead tree.
    const removed: string[] = [];
    const winRemove = window.removeEventListener;
    const docRemove = document.removeEventListener;
    window.removeEventListener = function (type: string, ...rest: unknown[]) {
      removed.push(`window:${type}`);
      return (winRemove as unknown as (...a: unknown[]) => void).call(window, type, ...rest);
    } as typeof window.removeEventListener;
    document.removeEventListener = function (type: string, ...rest: unknown[]) {
      removed.push(`document:${type}`);
      return (docRemove as unknown as (...a: unknown[]) => void).call(document, type, ...rest);
    } as typeof document.removeEventListener;
    try {
      render(<NewBuildNotice />).unmount();
    } finally {
      window.removeEventListener = winRemove;
      document.removeEventListener = docRemove;
    }
    expect(removed).toContain('document:visibilitychange');
    expect(removed).toContain('window:focus');
  });
});

describe('fix-424 §D: the poll is the latency for a window nobody touches', () => {
  it('★★★ the interval is at most five minutes', () => {
    // ★★ MEASURED, NOT PREFERRED. A visible-but-unfocused window fires neither
    //    event, and (measured in Chrome) its timers are NOT throttled — so this
    //    constant IS how long that screen shows a replaced layout. fix-371 set
    //    fifteen minutes reasoning "a new deploy is not urgent"; four deploys
    //    landed in four days and people reported bugs that were already fixed.
    expect(BUILD_CHECK_INTERVAL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    // ★ Still a poll, not a hammer: comfortably longer than the floor below.
    expect(BUILD_CHECK_INTERVAL_MS).toBeGreaterThan(BUILD_CHECK_MIN_GAP_MS * 10);
  });

  it('★★ a floor stops the three triggers bursting', () => {
    // With focus + visibilitychange both live, alt-tabbing between two windows
    // would otherwise cost a fetch on every pass. Same idea and same reason as
    // fix-371 §1's REALTIME_VISIBILITY_MIN_GAP_MS.
    expect(BUILD_CHECK_MIN_GAP_MS).toBeGreaterThan(0);
    expect(BUILD_CHECK_MIN_GAP_MS).toBeLessThan(BUILD_CHECK_INTERVAL_MS);
    expect(strip(noticeSource)).toContain('BUILD_CHECK_MIN_GAP_MS');
  });

  it('★★★ two triggers in quick succession cost ONE fetch, not two', () => {
    // The floor, exercised rather than read: fire the two events back to back
    // and count the requests that actually leave.
    const fetchSpy = vi.fn(async () => new Response('', { status: 500 }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    // A module script, so runningBundleUrl() is non-null and the check proceeds
    // past its first guard.
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/assets/index-TEST.js';
    document.head.appendChild(script);
    try {
      vi.useFakeTimers();
      render(<NewBuildNotice />);
      act(() => {
        vi.advanceTimersByTime(BUILD_CHECK_FIRST_MS + 1);
      });
      const afterFirst = fetchSpy.mock.calls.length;
      act(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(afterFirst).toBe(1);
      // Both extra triggers landed inside the floor ⇒ still one request.
      expect(fetchSpy.mock.calls.length).toBe(1);
      // …and past the floor, a trigger is honoured again.
      act(() => {
        vi.advanceTimersByTime(BUILD_CHECK_MIN_GAP_MS + 1);
        window.dispatchEvent(new Event('focus'));
      });
      expect(fetchSpy.mock.calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = realFetch;
      script.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// §E · the promise on screen
// ---------------------------------------------------------------------------

describe('fix-424 §E: it still only ever offers', () => {
  it('★★★ nothing reloads on its own — the copy is a commitment', () => {
    // ★ THE BRIEF'S FIRST MUST-NOT-CHANGE, and the reason is Bobby: he is
    //   often mid-edit, and a reload that eats an unsaved form is a far worse
    //   bug than a missing ribbon. The only reload in the file is the one
    //   inside the button's own handler — asserted by COUNT, so a second one
    //   cannot be added anywhere.
    const notice = strip(noticeSource);
    expect(notice).toContain('nothing reloads on its own');
    expect(notice).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
    expect(notice.match(/window\.location\.reload/g) ?? []).toHaveLength(1);
    // ★★ AND NOTHING HERE TOUCHES THE SERVICE WORKER. The gate in the brief
    //    turns on this: the worker's registration, caching and activation are
    //    untouched, which is why this shipped instead of stopping.
    expect(notice).not.toMatch(/serviceWorker|registration|skipWaiting/);
  });
});
