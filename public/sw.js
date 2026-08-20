/* ===========================================================================
 * ★★ fix-369 — the smallest service worker that makes this an app
 * ===========================================================================
 *
 * ★★★ THIS WORKER CACHES NOTHING, AND THAT IS THE SCOPE LINE OF THE TICKET.
 *
 * Bobby: "maybe we go with '80% of these features for half the work'". Offline
 * caching and background sync are the expensive 20%, and they buy the case
 * where the app is closed or the network is gone — which is not the case
 * anybody here is in. So there is no cache, no precache manifest, no
 * cache-first route, and no build step that generates one.
 *
 * ★ A stale-serving worker is also the single most common way a deployed SPA
 * gets stuck on last week's bundle. Having none means this file can never do
 * that: every request goes to the network exactly as it did before the worker
 * existed.
 *
 * ★★★ AND THERE IS NO PUSH HANDLER. Web Push is deliberately not built — see
 * the ticket. A `push` listener here with no server sending to it would be a
 * placeholder pretending to be a feature.
 *
 * WHAT IT IS FOR, all three things:
 *   1. Chrome's install criteria want a worker with a fetch handler before it
 *      will treat the site as installable rather than merely bookmarkable.
 *   2. `showNotification` from a registration is the reliable way to raise a
 *      desktop banner from a page, and it survives the page being backgrounded.
 *   3. `notificationclick` — clicking the banner focuses the tab that is
 *      already open and takes it to fix-362's target, instead of opening a
 *      second copy of the app.
 */

self.addEventListener('install', () => {
  // ★ Take over immediately. With no cache there is no old cache to drain, so
  // waiting for every tab to close buys nothing and only delays the fix.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ★★ Present, and deliberately empty. Not calling respondWith leaves the
// request entirely to the network — the handler exists for the install
// criterion, and doing anything in it would be the caching this ticket
// excludes.
self.addEventListener('fetch', () => {});

self.addEventListener('notificationclick', (event) => {
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        // ★★ FOCUS THE TAB THEY ALREADY HAVE. These people keep the app open
        // all day — that is the assumption the whole ticket rests on — so
        // opening a second window would be the wrong answer to a click nearly
        // every time.
        for (const client of windows) {
          if ('focus' in client) {
            if ('navigate' in client) {
              return client.navigate(url).then((c) => (c || client).focus());
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
      .catch(() => self.clients.openWindow(url)),
  );
});
