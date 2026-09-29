// ===========================================================================
// ★★★ fix-595 §2 (P-292) — THE COMPONENT ACTUALLY RELOADS, AND ACTUALLY REFUSES
// ===========================================================================
//
// `AutoReloadOnReturnFix595` proves the RULE. This file proves the WIRING: that
// a real `NewBuildNotice`, mounted, walked away from and returned to, reaches
// `reloadOntoNewBuild` — and that each of the four conditions stops it from the
// outside rather than only inside a pure function.
//
// ⚠️ THE RULE ITSELF IS NOT MOCKED. `lib/autoReload` runs for real, so the two
//    suites cannot drift apart while both stay green. Only the two functions
//    that reach the network or navigate are stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { AUTO_RELOAD_AWAY_MS } from '../lib/autoReload';
import { __resetDirtyRegistry, setDirty } from '../lib/dirtyRegistry';
import { __resetAppQueryClient, setAppQueryClient } from '../lib/appQueryClient';

const recordClientBuild = vi.hoisted(() =>
  vi.fn<
    (event?: 'shown' | 'dismissed' | 'reloaded' | 'auto_reloaded') => Promise<void>
  >(() => Promise.resolve()),
);
const reloadOntoNewBuild = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));
const fetchDeployedBundleUrl = vi.hoisted(() =>
  vi.fn<() => Promise<string | null>>(() => Promise.resolve('/assets/index-NEW.js')),
);

vi.mock('../lib/clientBuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/clientBuild')>();
  return { ...actual, recordClientBuild };
});
vi.mock('../lib/appVersion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/appVersion')>();
  return { ...actual, reloadOntoNewBuild, fetchDeployedBundleUrl };
});

import NewBuildNotice from '../components/NewBuildNotice';
import { BUILD_CHECK_MIN_GAP_MS, __resetNewBuildLive } from '../lib/appVersion';

// ★★★ THE DOCUMENT MUST HAVE A MODULE SCRIPT or `runningBundleUrl()` is null and
//     `check()` returns before it can ever find a new build — the same "test
//     renderer" case its own doc comment names.
const RUNNING = '/assets/index-OLD.js';

function mountWithBundle() {
  document.head.innerHTML = `<script type="module" src="${RUNNING}"></script>`;
  return render(<NewBuildNotice />);
}

/** Walk away, wait `ms`, and come back — through the events the browser sends. */
async function awayAndBack(ms: number, how: 'hide' | 'blur' = 'hide') {
  await act(async () => {
    if (how === 'hide') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } else {
      window.dispatchEvent(new Event('blur'));
    }
    await Promise.resolve();
  });
  vi.setSystemTime(new Date(Date.now() + ms));
  await act(async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    // Let the awaited `check()` and `recordClientBuild` settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  recordClientBuild.mockClear();
  recordClientBuild.mockImplementation(() => Promise.resolve());
  reloadOntoNewBuild.mockClear();
  fetchDeployedBundleUrl.mockClear();
  fetchDeployedBundleUrl.mockResolvedValue('/assets/index-NEW.js');
  __resetDirtyRegistry();
  __resetAppQueryClient();
  // ★★★ `newBuildLive` is documented as PERMANENT for the life of a document —
  //     which under vitest is the life of this FILE. Without this, the first
  //     case that finds a deploy hands `true` to every case after it and
  //     "no newer build does nothing" would pass for the wrong reason.
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
describe('fix-595 §2 — coming back after half an hour', () => {
  it('★★★ 30 minutes away, nothing unsaved → it reloads itself', async () => {
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★★ 29 minutes away → it does not', async () => {
    mountWithBundle();
    await awayAndBack(29 * 60 * 1000);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ `auto_reloaded` is recorded, and BEFORE the reload', async () => {
    // fix-589's ordering reason: the reload tears the document down.
    const order: string[] = [];
    recordClientBuild.mockImplementation((e) => {
      if (e === 'auto_reloaded') order.push('record');
      return Promise.resolve();
    });
    reloadOntoNewBuild.mockImplementation(() => {
      order.push('reload');
      return Promise.resolve();
    });
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(order).toEqual(['record', 'reload']);
  });

  it('★★★ the RPC REJECTING the new event does not block the reload', async () => {
    // §3: the migration ships UNAPPLIED, so today `bp_record_client_build`
    // raises 22023 for `'auto_reloaded'`. The reload must happen anyway — this
    // is the assertion that lets the migration wait for Bobby.
    recordClientBuild.mockImplementation((e) =>
      e === 'auto_reloaded'
        ? Promise.reject(new Error('unknown notice event auto_reloaded'))
        : Promise.resolve(),
    );
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★★ a returning window with NO newer build does nothing', async () => {
    fetchDeployedBundleUrl.mockResolvedValue(RUNNING);
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ the check runs BEFORE the decision, so a deploy made while away counts', async () => {
    // ★★★ THE POPULATION THIS TICKET IS FOR. Somebody who left at 17:00 and came
    //     back at 08:00 has a document whose `newBuildIsLive()` is still false —
    //     the deploy happened while they were gone and nothing has looked yet.
    //     Deciding before the check would decline every single time.
    mountWithBundle();
    expect(fetchDeployedBundleUrl).not.toHaveBeenCalled();
    await awayAndBack(12 * 60 * 60 * 1000);
    expect(fetchDeployedBundleUrl).toHaveBeenCalled();
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2 — and what stops it', () => {
  it('★★★ a dirty surface blocks it at TEN HOURS away', async () => {
    mountWithBundle();
    setDirty('project-chat', true);
    await awayAndBack(10 * 60 * 60 * 1000);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ a mutation in flight blocks it', async () => {
    setAppQueryClient({ isMutating: () => 1 } as never);
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ a caret in a field blocks it — the net under the other two', async () => {
    mountWithBundle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ a SECOND return after a failed attempt does not try again', async () => {
    // The reload "succeeds" as far as this document can tell but the bundle does
    // not change — exactly the loop condition 4 exists for.
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + BUILD_CHECK_MIN_GAP_MS + 1));
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★★ a window that never left does not reload on a bare focus', async () => {
    // ★ `focus` fires for reasons that are not a return — clicking back into a
    //   window that was never hidden, a devtools open. With no away stamp there
    //   is no return to ride, and `leftAt === 0` is the guard.
    mountWithBundle();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2 — the away clock', () => {
  it('★★★ measured from the HIDE, not from a timer', async () => {
    // No timer is advanced anywhere in this test: `vi.setSystemTime` moves the
    // clock without firing a single scheduled callback. If the feature depended
    // on a `setTimeout` it could not pass.
    mountWithBundle();
    await awayAndBack(AUTO_RELOAD_AWAY_MS);
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★★ `blur` then `hidden` is ONE stretch, not a restarted clock', async () => {
    // Walking away from a window fires both. Re-stamping on the second would
    // restart the clock at ~0ms and the feature would never trigger — with
    // nothing on screen to say so.
    mountWithBundle();
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    vi.setSystemTime(new Date(Date.now() + AUTO_RELOAD_AWAY_MS));
    await act(async () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });

  it('★★ a return through `blur` → `focus` works too (alt-tab, never hidden)', async () => {
    // fix-424's lesson: `visibilitychange` does NOT fire when a window merely
    // loses focus to another window on another screen. That population is
    // exactly who this ticket is for, so `blur`/`focus` is the other half.
    mountWithBundle();
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await Promise.resolve();
    });
    vi.setSystemTime(new Date(Date.now() + AUTO_RELOAD_AWAY_MS));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
  });
});
