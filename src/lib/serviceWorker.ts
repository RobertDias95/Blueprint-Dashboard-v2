// ===========================================================================
// ★ fix-369 — registering the worker, and nothing else
// ===========================================================================
//
// ★ Kept out of main.tsx so the registration can be tested without booting the
// app, and so the reasoning below has somewhere to live.

/** Resolves to the registration, or null where there is no worker support, no
 *  secure context, or the register call failed. Never throws — a browser that
 *  cannot install the app must still run it. */
export async function registerAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    // ★ Root scope, from public/, unfingerprinted. A worker can only control
    // pages at or below its own path, so a hashed name in assets/ would control
    // nothing.
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // ★★ Swallowed on purpose. This fails in exactly the situations where the
    // app must keep working anyway — an insecure origin, a locked-down
    // profile, a browser with workers disabled — and in every one of them the
    // bell, the badge and the notification centre are unaffected, because none
    // of them goes through here.
    return null;
  }
}

/** The active registration, if the browser has one for this page. Used to raise
 *  a banner; a null result degrades to no banner and nothing else. */
export async function appServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration('/')) ?? null;
  } catch {
    return null;
  }
}
