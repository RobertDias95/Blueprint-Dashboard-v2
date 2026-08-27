// ===========================================================================
// ★★ fix-371 §4 — nobody is told a new version exists
// ===========================================================================
//
// Bobby: *"what happens as we make updates? will people be able to refresh
// their app so it has the current updates?"*
//
// ★★★ THE ANSWER TODAY IS YES, BY LUCK RATHER THAN DESIGN. fix-369's service
// worker caches nothing, so any reload fetches the new bundle. But an app left
// open for days keeps running the bundle it started with, and nothing tells
// anyone — which for an installed app that nobody ever closes is most of the
// time.
//
// ---------------------------------------------------------------------------
// ★★★ THE SMALLEST HONEST VERSION, AND WHY IT NEEDS NO BUILD STEP
// ---------------------------------------------------------------------------
//
// A version file would have to be generated at build time by a plugin, kept in
// step with the bundle, and cache-busted. None of that is necessary, because
// Vite already emits exactly the fact we need:
//
//   · index.html is UNFINGERPRINTED and served fresh;
//   · the module script it points at IS fingerprinted — /assets/index-<hash>.js.
//
// So the deployed build announces itself in the one file that is never cached.
// Fetch index.html with `cache: 'no-store'`, read the script src out of it, and
// compare with the one this document loaded. Different hash, different build.
// No plugin, no new file, no version to forget to bump.
//
// ★★ AND IT ONLY EVER OFFERS. Auto-reloading discards whatever somebody was
// typing, which is a worse bug than being a day behind. The brief says so and
// so does this file: nothing here reloads anything.

// ===========================================================================
// ★★★ fix-424 — THE NOTICE NEVER REACHED THE APP OR THE SECOND MONITOR
// ===========================================================================
//
// Bobby, 2026-08-27, holding a screenshot of the ribbon: *"I feel like this is
// not popping up on the app and my other screens for some reason."* So it
// renders — he photographed it — and does not reach the surfaces he actually
// works on. Four fixes shipped to Project Overview in four days; anyone who did
// not manually reload was reporting bugs that had been fixed hours earlier.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT WAS MEASURED, IN A REAL BROWSER, BEFORE ANYTHING WAS CHANGED
// ---------------------------------------------------------------------------
//
// The suspicion going in was the service worker: an installed app is served by
// one, so perhaps a cached shell never sees the new hash. **It is not that, and
// the check below is not the reason.** Measured on the real built bundle served
// locally, with `/sw.js` registered AND controlling the page: a simulated deploy
// was detected on the very next check, and the real component rendered the real
// ribbon. `public/sw.js` caches nothing — its `fetch` handler never calls
// `respondWith` — so every request, this one included, goes to the network
// exactly as it would with no worker at all. The detection works everywhere.
//
// ★★★ WHAT IS WRONG IS **WHEN IT LOOKS**, AND fix-371 §1 HAD ALREADY WRITTEN
// IT DOWN. From lib/realtimeLiveness, measured by that ticket:
//
//     "The fallback poll is `window.setInterval`. Chrome throttles timers in a
//      backgrounded page to once a minute and FREEZES them entirely in a
//      backgrounded installed app — which is precisely the state Bobby's window
//      is in while he is doing something else."
//
// §1 redesigned realtime liveness around that fact. §4 — the same ticket, forty
// lines away — then built this notice on a `setInterval` and one
// `visibilitychange` listener. The lesson did not cross the file boundary.
//
// ★★ AND `visibilitychange` DOES NOT FIRE WHEN A WINDOW MERELY GAINS FOCUS.
// A window parked on a second monitor is `visible` for hours and never fires
// it. Measured here: a visible-but-unfocused tab is NOT throttled (a 1s
// interval fired ~1/s), so that window's ONLY path to the news was the poll —
// and the poll was fifteen minutes. That is "my other screens", exactly.
//
//     surface                          visibilitychange   setInterval   delay
//     focused tab                      on tab switch      runs          ≤ poll
//     visible, unfocused (2nd monitor) NEVER              runs          = poll
//     hidden tab                       on return          throttled     instant
//     backgrounded installed app       on restore         FROZEN        instant
//
// Nobody was permanently starved — but on the two surfaces Bobby named, the
// poll interval WAS the notice's latency, and fifteen minutes is longer than
// anyone waits before deciding a thing is broken.

/** How often to look.
 *
 *  ★★ fix-424: 15 minutes → 5. fix-371 set 15 reasoning that "a new deploy is
 *  not urgent, and the check costs a request", and that is true of a window
 *  somebody is using — it has `visibilitychange` and now `focus` to shortcut
 *  the wait. It is NOT true of a window that is merely visible on another
 *  screen, which fires neither event and for which this interval IS the
 *  latency. The cost is one conditional GET of an unfingerprinted 3KB
 *  index.html per window per five minutes. */
export const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** ★ The floor between two checks, so the three triggers cannot burst.
 *
 *  With `focus` and `visibilitychange` both live, alt-tabbing between two
 *  windows would otherwise fetch on every pass. Same idea, and the same
 *  reason, as fix-371 §1's REALTIME_VISIBILITY_MIN_GAP_MS. */
export const BUILD_CHECK_MIN_GAP_MS = 10_000;

/** How long after mount the FIRST check runs. Off the initial paint, and late
 *  enough that a person opening the app is not competing with it for a
 *  connection. */
export const BUILD_CHECK_FIRST_MS = 10_000;

const MODULE_SCRIPT = /<script[^>]+type="module"[^>]+src="([^"]+)"/i;

// *** fix-372 section 6 reads this. fix-371 already discovers that a new build
// is deployed; a deploy restarts the server and cuts requests that were in
// flight, which is the one cause of a dead mutation that is both known and
// recoverable. Recording it here rather than re-deriving it keeps ONE answer to
// "is a new version live" - the banner and the notice cannot disagree.
let newBuildLive = false;

/** Called by the notice when it finds a newer bundle. Never unset: a deploy
 *  that has happened stays a fact for the life of this document. */
export function markNewBuildLive(): void {
  newBuildLive = true;
}

/**
 * ★★ Whether a newer build has been seen at any point in this document's life.
 *
 * ★★★ fix-424: THE NOTICE ITSELF READS THIS NOW, and not reading it was a bug.
 * `available` was component state seeded `false`, so any remount of the shell
 * subtree silently RETRACTED a notice that had already been shown — and
 * AuthGuard swaps that whole subtree for "Loading…" / "Reconnecting…" whenever
 * a session verify is in flight. The flag above is documented as permanent
 * ("Never unset: a deploy that has happened stays a fact for the life of this
 * document"); the component that discovers the fact was the one surface not
 * consulting it.
 */
export function newBuildIsLive(): boolean {
  return newBuildLive;
}

/** The bundle THIS document is running, straight from the DOM. Null in a
 *  context with no module script (a test renderer, an unusual host). */
export function runningBundleUrl(doc: Document = document): string | null {
  const el = doc.querySelector('script[type="module"][src]');
  const src = el?.getAttribute('src');
  return src ? normalise(src) : null;
}

/** The bundle the SERVER is currently handing out, parsed from index.html. */
export function parseDeployedBundleUrl(html: string): string | null {
  const m = MODULE_SCRIPT.exec(html);
  return m ? normalise(m[1]) : null;
}

/** ★ Compared as paths, so an absolute URL in one place and a relative one in
 *  the other do not read as a new build every fifteen minutes. */
function normalise(src: string): string {
  try {
    return new URL(src, 'http://x/').pathname;
  } catch {
    return src;
  }
}

/**
 * ★★ Both must be known before anything is claimed.
 *
 * A failed fetch, an unparseable page, a dev server whose entry is
 * `/src/main.tsx` on both sides — every one of those must read as "no new
 * version", never as one. A false "update ready" that reloads into the same
 * build is how a person learns to ignore the banner.
 */
export function isNewBuildAvailable(
  running: string | null,
  deployed: string | null,
): boolean {
  if (!running || !deployed) return false;
  return running !== deployed;
}

/** Fetches index.html uncached and returns the bundle it points at, or null on
 *  any failure. Never throws — this is an enhancement, not a dependency. */
export async function fetchDeployedBundleUrl(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    // ★ `no-store` and a cache-busting query: a service worker or an
    // intermediary that served a stale index.html would make this compare the
    // running build against itself for ever.
    const res = await fetchImpl(`/?build-check=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return parseDeployedBundleUrl(await res.text());
  } catch {
    return null;
  }
}
