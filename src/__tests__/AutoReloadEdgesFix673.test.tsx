// ===========================================================================
// ★★★ fix-673 (P-353) — THE APP REFRESHES ITSELF AFTER SLEEP AND ON RETURN,
//     AND SAYS WHY WHEN IT DOESN'T
// ===========================================================================
//
// Bobby, 2026-10-14: *"when i open the bridge on the app or web, it used to
// auto refresh if outdated and an update was around, it no longer does that.
// why?"*
//
// fix-595 works most of the time (7 days: 90 notices, 52 auto-reloads). This
// file is about the misses, and §0 proved each cause with a test that FAILED on
// `fda0e26` before anything was changed:
//
//   §0.1 THE RETURN RACE. `onReturn` started a `check()` and did not wait for
//        it; `maybeAutoReload` then called `check()` again, which the 10 s
//        throttle turned into an immediate return — so the decision read
//        `newBuildIsLive()` BEFORE the fetch that would have set it. A real
//        fetch takes ~100 ms, so a deploy made while you were away was never
//        reloaded onto: the fetch landed afterwards and only the ribbon showed.
//        Bobby's `afca5fb` row: banner first shown 02:02:30, Reload pressed 7 s
//        later. fix-595's own test passed only because its mock resolves in
//        one microtask.
//   §0.2 SLEEP WITHOUT BLUR. The away clock started only on `blur` or
//        `visibilitychange:hidden`. A window that is in front and focused when
//        the PC sleeps fires neither, so waking it is not a "return" and
//        nothing decides.
//
// ⚠️ The rule (`lib/autoReload`) is NOT mocked, exactly as in fix-595's live
//    suite — only the network and the navigation are.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

import { __resetDirtyRegistry, setDirty } from '../lib/dirtyRegistry';
import { __resetAppQueryClient } from '../lib/appQueryClient';

const recordClientBuild = vi.hoisted(() =>
  vi.fn<(event?: string, now?: number, blocker?: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
);
const reloadOntoNewBuild = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));
const fetchDeployedBundleUrl = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

vi.mock('../lib/clientBuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/clientBuild')>();
  return { ...actual, recordClientBuild };
});
vi.mock('../lib/appVersion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/appVersion')>();
  return { ...actual, reloadOntoNewBuild, fetchDeployedBundleUrl };
});

import NewBuildNotice from '../components/NewBuildNotice';
import {
  BUILD_CHECK_FIRST_MS,
  BUILD_CHECK_INTERVAL_MS,
  __resetNewBuildLive,
} from '../lib/appVersion';

const RUNNING = '/assets/index-OLD.js';
const NEW = '/assets/index-NEW.js';
/** A real fetch of index.html is not one microtask. */
const FETCH_MS = 400;

/** The deployed bundle, answered after FETCH_MS of fake time. */
let deployed = NEW;
function slowFetch() {
  fetchDeployedBundleUrl.mockImplementation(
    () => new Promise((res) => window.setTimeout(() => res(deployed), FETCH_MS)),
  );
}

function mountWithBundle() {
  document.head.innerHTML = `<script type="module" src="${RUNNING}"></script>`;
  return render(<NewBuildNotice />);
}

async function flush(ms = 0) {
  await act(async () => {
    if (ms) await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function hide() {
  await act(async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}
async function show() {
  await act(async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

/** The calls that recorded a blocker, as `[reason]`. */
const blockedCalls = () =>
  recordClientBuild.mock.calls
    .filter((c) => c[0] === 'auto_reload_blocked')
    .map((c) => c[2]);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
  recordClientBuild.mockClear();
  recordClientBuild.mockImplementation(() => Promise.resolve());
  reloadOntoNewBuild.mockClear();
  fetchDeployedBundleUrl.mockReset();
  deployed = NEW;
  slowFetch();
  __resetDirtyRegistry();
  __resetAppQueryClient();
  __resetNewBuildLive();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════
describe('§0.1 — the return race', () => {
  it('★★★ away 31 min, deployed while asleep (no tick ran), return → it reloads once the fetch lands', async () => {
    mountWithBundle();
    await hide();
    // ★ The clock moves; no scheduled callback fires — the interval never ran.
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await show();
    // The fetch is still in flight here; the decision must wait for it.
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    await flush(FETCH_MS + 50);
    expect(fetchDeployedBundleUrl).toHaveBeenCalledTimes(1);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★ the decision and the banner come from ONE fetch, not two', async () => {
    mountWithBundle();
    await hide();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await show();
    await flush(FETCH_MS + 50);
    expect(fetchDeployedBundleUrl).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('§0.2 — sleep without blur', () => {
  it('★★★ focused through an 8 h sleep, no blur, a deploy meanwhile → the first tick after waking reloads', async () => {
    deployed = RUNNING;
    mountWithBundle();
    // The first check and one interval tick run normally — nothing new yet.
    await flush(BUILD_CHECK_FIRST_MS + FETCH_MS);
    await flush(BUILD_CHECK_INTERVAL_MS - BUILD_CHECK_FIRST_MS);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    // ★ Sleep: timers pause, the wall clock jumps 8 h, no event fires.
    deployed = NEW;
    vi.setSystemTime(new Date(Date.now() + 8 * 60 * 60 * 1000));
    // Wake: the next interval tick is the first thing that runs.
    await flush(BUILD_CHECK_INTERVAL_MS);
    await flush(FETCH_MS + 50);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★ an ordinary tick (no jump) never reloads, even with a new build live', async () => {
    mountWithBundle();
    await flush(BUILD_CHECK_FIRST_MS + FETCH_MS);
    await flush(BUILD_CHECK_INTERVAL_MS);
    await flush(BUILD_CHECK_INTERVAL_MS);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★ the wake gap obeys the same gates: unsaved work still holds it', async () => {
    deployed = RUNNING;
    mountWithBundle();
    await flush(BUILD_CHECK_FIRST_MS + FETCH_MS);
    setDirty('project-chat', true);
    deployed = NEW;
    vi.setSystemTime(new Date(Date.now() + 8 * 60 * 60 * 1000));
    await flush(BUILD_CHECK_INTERVAL_MS);
    await flush(FETCH_MS + 50);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    expect(blockedCalls()).toEqual(['dirty']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('§3 — an empty focused field does not block', () => {
  async function awayWithFocusedField(value: string) {
    mountWithBundle();
    const input = document.createElement('input');
    input.type = 'search';
    document.body.appendChild(input);
    input.focus();
    input.value = value;
    await hide();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await show();
    await flush(FETCH_MS + 50);
  }

  it('★★★ an autofocused, EMPTY search box → it reloads', async () => {
    await awayWithFocusedField('');
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★★ a field holding typed text → it does not, and says why', async () => {
    await awayWithFocusedField('half a sentence');
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    expect(blockedCalls()).toEqual(['active-is-input']);
  });

  it('★★ whitespace only counts as empty', async () => {
    await awayWithFocusedField('   ');
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('§4 — why it did not reload is recorded', () => {
  it('★★★ blocked with a new build live → the blocker is recorded', async () => {
    mountWithBundle();
    await hide();
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    await show();
    await flush(FETCH_MS + 50);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    expect(blockedCalls()).toEqual(['not-away-long-enough']);
  });

  it('★★★ reloaded → no blocker recorded', async () => {
    mountWithBundle();
    await hide();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await show();
    await flush(FETCH_MS + 50);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
    expect(blockedCalls()).toEqual([]);
  });

  it('★★ no new build → nothing recorded (not a miss)', async () => {
    deployed = RUNNING;
    mountWithBundle();
    await hide();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await show();
    await flush(FETCH_MS + 50);
    expect(blockedCalls()).toEqual([]);
  });

  it('★★ the same blocker twice in a row is recorded once', async () => {
    mountWithBundle();
    for (let i = 0; i < 2; i++) {
      await hide();
      vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));
      await show();
      await flush(FETCH_MS + 50);
    }
    expect(blockedCalls()).toEqual(['not-away-long-enough']);
  });
});
