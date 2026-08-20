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

/** How often to look. Long: a new deploy is not urgent, and the check costs a
 *  request. The check also runs when the window becomes visible, which is when
 *  a person is actually there to be told. */
export const BUILD_CHECK_INTERVAL_MS = 15 * 60 * 1000;

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
