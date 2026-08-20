import { useCallback, useEffect, useState } from 'react';
import {
  BUILD_CHECK_FIRST_MS,
  BUILD_CHECK_INTERVAL_MS,
  fetchDeployedBundleUrl,
  isNewBuildAvailable,
  markNewBuildLive,
  runningBundleUrl,
} from '../lib/appVersion';

// ===========================================================================
// ★★ fix-371 §4 — a line that says a new version is ready, and a control
// ===========================================================================
//
// ★★★ IT OFFERS, IT NEVER ACTS. Reloading somebody's window discards what they
// were typing — a mid-sentence chat post, a date they were halfway through
// changing. The brief forbids an auto-reload and it is right to: being a day
// behind is a smaller problem than losing a paragraph.
//
// ★ It renders NOTHING until there is something to say, so the shell is
// unchanged for everybody on the current build — which is everybody, most of
// the time. See lib/appVersion for why this needs no build step and no version
// file.

export default function NewBuildNotice() {
  const [available, setAvailable] = useState(false);

  const check = useCallback(async () => {
    const running = runningBundleUrl();
    if (!running) return;
    const deployed = await fetchDeployedBundleUrl();
    // ★ Only ever set to true. Once a new build is out there, hiding the notice
    // again because one later fetch failed would be worse than leaving it up.
    if (isNewBuildAvailable(running, deployed)) {
      // fix-372 section 6 reads this to explain a mutation that died on the wire.
      markNewBuildLive();
      setAvailable(true);
    }
  }, []);

  useEffect(() => {
    // The first check is DEFERRED, for two reasons. It keeps a request off the
    // initial paint, and calling `check` straight from the effect body is a
    // synchronous setState inside an effect - which the React Compiler rejects,
    // the same family of rule that cost fix-350 two attempts.
    const first = window.setTimeout(() => void check(), BUILD_CHECK_FIRST_MS);
    const id = window.setInterval(() => void check(), BUILD_CHECK_INTERVAL_MS);
    // ★ …and when the window comes back, because that is when somebody is
    // there to read it. Same event fix-371 §1 uses for the same reason: a
    // backgrounded app's timers are frozen.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!available) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-de-bg border-b border-de-border text-[11px] text-text"
      role="status"
      data-testid="new-build-notice"
    >
      <span className="font-bold">A new version of the Bridge is ready.</span>
      <span className="text-muted">
        Reload when you are at a good stopping point — nothing reloads on its own.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ml-auto font-bold px-2.5 py-1 rounded-md border border-de text-de bg-surface hover:bg-de-bg transition"
        data-testid="new-build-reload"
      >
        Reload
      </button>
    </div>
  );
}
