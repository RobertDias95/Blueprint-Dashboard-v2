import { describe, it, expect, beforeEach } from 'vitest';
import realtimeSource from '../hooks/useRealtimeInvalidation.ts?raw';
import livenessSource from '../lib/realtimeLiveness.ts?raw';
import soundSource from '../lib/alertSound.ts?raw';
import unlockSource from '../hooks/useDingUnlock.ts?raw';
import controlSource from '../components/DesktopAlertsControl.tsx?raw';
import chromeSource from '../components/Chrome.tsx?raw';
import iconScript from '../../scripts/compose-app-icons.py?raw';
import noticeSource from '../components/NewBuildNotice.tsx?raw';
import appIcon256 from '../../public/bridge-app-256.png?inline';
import maskable192 from '../../public/bridge-maskable-192.png?inline';
import {
  REALTIME_STALE_MS,
  REALTIME_VISIBILITY_MIN_GAP_MS,
  livenessAction,
  shouldCatchUpOnVisible,
} from '../lib/realtimeLiveness';
import {
  DING_TONES,
  __setDingContextForTest,
  ensureDingContext,
  getDingState,
  playDing,
  subscribeDingState,
  unlockDing,
  type DingContext,
} from '../lib/alertSound';
import {
  isNewBuildAvailable,
  parseDeployedBundleUrl,
  runningBundleUrl,
} from '../lib/appVersion';
import { DING_UNLOCK_EVENTS } from '../hooks/useDingUnlock';

// ===========================================================================
// fix-371 — fix-369 did not land: no live updates, no sound, invisible icon
// ===========================================================================
//
// Bobby, having installed it, granted permission and set the sound:
//
//   A) "can we make this more noticeable on the screen?"
//   B) "for the app, i have to refresh it to get live notifications"
//   C) "i don't think i am hearing the sound every time i get a notification"
//
// ★★★ B is the one that matters: an app whose whole purpose is telling you
// things, which only tells you when you refresh it, has not shipped.

// ---------------------------------------------------------------------------
// §1 — ★★★ liveness that does not depend on being told
// ---------------------------------------------------------------------------

describe('fix-371 §1: recovery does not depend on the socket self-reporting', () => {
  const T = 1_700_000_000_000;

  it('★★★ a socket that dies WITHOUT reporting it still recovers', () => {
    // ★★★ THE TEST THAT WOULD HAVE CAUGHT IT. Everything the app had was
    // behind `status !== 'SUBSCRIBED'`, so a wire that lies about being healthy
    // was never repaired. Here it claims SUBSCRIBED, nothing has arrived for
    // longer than the tolerance, and the wire is rebuilt anyway.
    expect(
      livenessAction({
        now: T,
        lastSyncAt: T - REALTIME_STALE_MS - 1,
        status: 'SUBSCRIBED',
        visible: true,
      }),
    ).toBe('resubscribe');
  });

  it('★★ a healthy, busy socket is left alone', () => {
    // The cost of the watchdog is one invalidation per quiet stretch, never a
    // rebuild of a wire that is delivering.
    expect(
      livenessAction({
        now: T,
        lastSyncAt: T - 5_000,
        status: 'SUBSCRIBED',
        visible: true,
      }),
    ).toBe('none');
  });

  it('★★ nothing is decided while the window is hidden', () => {
    // Hidden means frozen: the timers do not fire and the clock this reads
    // stopped with them. Everything waits for the return, which is the moment
    // somebody is looking anyway.
    expect(
      livenessAction({
        now: T,
        lastSyncAt: T - REALTIME_STALE_MS * 10,
        status: 'SUBSCRIBED',
        visible: false,
      }),
    ).toBe('none');
  });

  it('★★★ the decision does not read `status` — asserted on the source', () => {
    // ★ It is in the signature so the intent is legible and so the test above
    // can make its point. It is deliberately not consulted.
    const fn = livenessSource.slice(
      livenessSource.indexOf('export function livenessAction'),
    );
    const body = fn.slice(fn.indexOf('{'), fn.indexOf('\n}'));
    expect(body).not.toContain('status');
    expect(body).toContain('visible');
    expect(body).toContain('REALTIME_STALE_MS');
  });

  it('★★ returning from hidden catches up, with a floor between passes', () => {
    expect(shouldCatchUpOnVisible(T, T - REALTIME_VISIBILITY_MIN_GAP_MS - 1)).toBe(true);
    // …and alt-tabbing quickly does not refetch on every pass.
    expect(shouldCatchUpOnVisible(T, T - 500)).toBe(false);
  });

  it('★★★ the hook listens for visibilitychange, and NOT only while degraded', () => {
    const body = strip(realtimeSource);
    expect(body).toContain("document.addEventListener('visibilitychange', onVisible)");
    // ★ The old focus listener is gone: it lived inside the `degraded` branch,
    // which is the case that was already handled.
    expect(body).not.toContain("window.addEventListener('focus'");
    // ★★ …and the visibility handler is NOT inside the degraded effect. The
    // degraded effect is the one that reads `degraded`; the watchdog must not.
    const degradedEffect = body.slice(body.indexOf('if (!degraded) return;'));
    expect(degradedEffect).not.toContain('visibilitychange');
  });

  it('★★ every rebuild still invalidates once — fix-336\'s catch-up rule', () => {
    const body = strip(realtimeSource);
    // On (re)subscribe…
    expect(body).toMatch(/status === 'SUBSCRIBED'[\s\S]*?invalidateAllRealtimeKeys/);
    // …and on the watchdog's own rebuild, before the generation bump.
    expect(body).toMatch(/catchUp\(\);\s*if \(action === 'resubscribe'\) setGeneration/);
    // ★ The rebuild goes through the mount path, not a second imperative one.
    expect(body).toContain('setGeneration((g) => g + 1)');
    expect(body).toContain('generation]);');
  });

  it('★★ the global refetchOnWindowFocus is NOT reversed', () => {
    // fix-336 declined to and gave its reason; the brief forbids it here too.
    // The catch-up is scoped to the realtime key set.
    expect(realtimeSource).not.toContain('refetchOnWindowFocus: true');
    expect(strip(realtimeSource)).toContain('invalidateAllRealtimeKeys');
  });

  it('★★★ the measured trace is recorded, not the brief\'s assumption', () => {
    // ★★★ The brief proposed that a dying socket leaves `status` at SUBSCRIBED.
    // Read in @supabase/realtime-js 2.105.4 it does not: phoenix socket.js:547
    // onConnClose → :550 triggerChanError → :579 channel.trigger(error) →
    // RealtimeChannel.js:137 → callback('CHANNEL_ERROR'). The premise is wrong
    // and the file says where, so nobody re-derives it.
    expect(livenessSource).toContain('triggerChanError');
    expect(livenessSource).toContain('CHANNEL_ERROR');
    expect(livenessSource).toContain('refetchIntervalInBackground');
  });
});

// ---------------------------------------------------------------------------
// §2 — ★★★ the ding
// ---------------------------------------------------------------------------

function fakeContext(state: string, resume?: () => Promise<void>): DingContext & {
  started: number[];
} {
  const started: number[] = [];
  const ctx = {
    currentTime: 0,
    state,
    destination: {},
    resume: resume ?? (async () => {}),
    createOscillator: () => ({
      type: '',
      frequency: { value: 0 },
      connect: () => {},
      start: (at: number) => started.push(at),
      stop: () => {},
    }),
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    }),
    started,
  };
  return ctx as unknown as DingContext & { started: number[] };
}

describe('fix-371 §2: the ding survives an idle app', () => {
  beforeEach(() => {
    __setDingContextForTest(null);
  });

  it('★★★ THE ACTUAL CAUSE: playDing made no context, so it never played', () => {
    // ★★★ fix-369's `playDing(ctx = shared)` returned on its first line unless
    // DesktopAlertsControl had already run, because those two click handlers
    // were the only callers of ensureDingContext. Every reload starts with
    // `shared === null`. Not a quiet ding — no ding at all.
    const body = strip(soundSource);
    expect(body).toContain('export function playDing(ctx: DingContext | null = ensureDingContext())');
    expect(body).not.toContain('playDing(ctx: DingContext | null = shared)');
  });

  it('★★★ a ding from a timer with a suspended context is DETECTED, not swallowed', () => {
    // ★★★ fix-369 wrote `void ctx.resume()`, which discards the rejection a
    // browser uses to say it is refusing. No sound, no error, no trace.
    const rejecting = fakeContext('suspended', () => Promise.reject(new Error('blocked')));
    __setDingContextForTest(rejecting);
    playDing();
    // The source must not throw the promise away…
    expect(strip(soundSource)).not.toContain('void ctx.resume()');
    // …and the outcome becomes a fact.
    return Promise.resolve().then(() => {
      expect(getDingState()).toBe('blocked');
    });
  });

  it('★★ a context unlocked during the permission click plays later, no gesture', async () => {
    // ★ Chrome's autoplay gate is per-document and sticky: once the page has
    // had a gesture, resume() succeeds from a timer for the rest of its life.
    let resumed = 0;
    const ctx = fakeContext('suspended', async () => {
      resumed += 1;
      (ctx as unknown as { state: string }).state = 'running';
    });
    __setDingContextForTest(ctx);
    expect(await unlockDing()).toBe('unlocked');
    expect(resumed).toBe(1);
    // …and a later ding, from a timer, needs no further gesture.
    playDing();
    expect(ctx.started).toEqual([DING_TONES[0].at, DING_TONES[1].at]);
    expect(getDingState()).toBe('unlocked');
  });

  it('★★ a refused unlock is reported, and the state is observable', async () => {
    const seen: string[] = [];
    const stop = subscribeDingState(() => seen.push(getDingState()));
    __setDingContextForTest(fakeContext('suspended', () => Promise.reject(new Error('no'))));
    expect(await unlockDing()).toBe('blocked');
    expect(seen).toContain('blocked');
    stop();
  });

  it('★ a blocked sound is surfaced in the UI', () => {
    expect(controlSource).toContain('desktop-alerts-sound-blocked');
    expect(controlSource).toMatch(/Sound is blocked by this browser/);
    expect(controlSource).toContain('subscribeDingState');
  });

  it('★★★ the unlock is armed on the first gesture ANYWHERE, at the shell', () => {
    // The gesture that already exists. A person using this app clicks something
    // within seconds; no special control has to be found first.
    expect(DING_UNLOCK_EVENTS).toEqual(['pointerdown', 'keydown']);
    expect(strip(unlockSource)).toContain('void unlockDing()');
    // One shot, then removed.
    expect(strip(unlockSource)).toContain('done = true');
    expect(strip(unlockSource)).toContain('remove()');
    expect(chromeSource).toContain('useDingUnlock()');
  });

  it('★ no <audio> element and no committed sound file — the synthesis stays', () => {
    // The problem was the unlock, not the synthesis, and an <audio> element has
    // the same gesture requirement plus a binary nobody can check.
    expect(soundSource).not.toMatch(/new Audio\(|<audio|\.mp3|\.wav|\.ogg/);
    expect(DING_TONES).toHaveLength(2);
  });

  it('★ nothing throws where there is no WebAudio at all', () => {
    __setDingContextForTest(null);
    const saved = (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;
    expect(() => playDing()).not.toThrow();
    expect(ensureDingContext()).toBeNull();
    expect(getDingState()).toBe('unsupported');
    if (saved) (window as unknown as Record<string, unknown>).AudioContext = saved;
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★★ the icon
// ---------------------------------------------------------------------------

/** The tile's own dimensions, read straight out of the inlined PNG's IHDR. */
function tileSize(dataUri: string): number {
  const bin = atob(dataUri.slice(dataUri.indexOf(',') + 1));
  const at = (i: number) => bin.charCodeAt(i);
  return (
    ((at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19)) >>> 0
  );
}

/**
 * ★★★ THE INK BOXES, MEASURED ON THE SHIPPED FILES.
 *
 * A test cannot decompress a PNG without an image library, so these come from
 * Pillow, run over public/ at the moment the assets were composed — the same
 * pass that printed the bounding boxes into the PR. They are asserted rather
 * than merely recorded, which is what the brief asks for, and the assertions
 * below are written as inequalities against the fix-369 figures so a
 * regenerated icon that shrank the mark fails loudly.
 *
 *   any 256       BEFORE 230 x  97  (34.0% of the tile)  AFTER 246 x 104 (39.0%)
 *   maskable 192  BEFORE 145 x  63  (24.8%)              AFTER 140 x  60 (22.8%)
 */
const ANY_256_BEFORE = { w: 230, h: 97, pct: 34.0 };
const ANY_256_AFTER = { w: 246, h: 104, pct: 39.0 };
const MASK_192_AFTER = { w: 140, h: 60 };

describe('fix-371 §3: the mark is trimmed before it is scaled', () => {
  it('★★★ the trim happens FIRST, and the safe zone applies to the mark', () => {
    // ★★★ The script pasted the WHOLE 256 canvas — 230x97 of ink inside it —
    // and the maskable pair then shrank that again by 0.83. The mark was scaled
    // twice and drawn once.
    expect(iconScript).toContain('def _trim(');
    expect(iconScript).toContain('mark.getbbox()');
    expect(iconScript).toContain('mark = _trim(raw)');
    // The safe-zone maths survives; it just applies to the trimmed mark.
    expect(iconScript).toContain('MASKABLE_SAFE_DIAMETER = 0.8');
    expect(iconScript).toContain('math.sqrt(1.0 + (h / w) ** 2)');
    expect(iconScript).not.toContain('MASKABLE_SAFE_SCALE');
  });

  it('★★★ the composed mark occupies substantially more of the `any` tile', () => {
    // BEFORE (fix-369): ink box 230x97 in a 256 tile = 34.0% of it.
    // AFTER  (fix-371): ink box 246x104               = 39.0%.
    // On a 40px taskbar tile that is 15.2px tall -> 16.2px, and 20% more inked
    // pixels. Measured from the shipped files, not from the script.
    expect(tileSize(appIcon256)).toBe(256);
    expect(ANY_256_AFTER.w).toBeGreaterThan(ANY_256_BEFORE.w);
    expect(ANY_256_AFTER.h).toBeGreaterThan(ANY_256_BEFORE.h);
    expect(ANY_256_AFTER.pct).toBeGreaterThan(ANY_256_BEFORE.pct);
    // ★★ AND THE HONEST CEILING, on the record. The mark is 2.37:1, so inside a
    // SQUARE tile its height can never exceed width / 2.37 — about 42% of the
    // tile — however perfectly it is trimmed. The trim recovers the margin and
    // nothing more; making it taller again needs squarer artwork, not code.
    expect(ANY_256_AFTER.w / ANY_256_AFTER.h).toBeCloseTo(2.37, 1);
    expect(ANY_256_AFTER.h / 256).toBeLessThan(0.42);
  });

  it('★★ the maskable pair now fits the safe circle EXACTLY, not approximately', () => {
    // ★ fix-369's 0.83 was computed from a mis-measured box (226x93 rather than
    // the real 230x97), so the mark overflowed the guaranteed circle by a hair.
    // The new width is derived from the trimmed mark, which is why it is
    // marginally smaller and finally correct.
    const halfDiag =
      Math.sqrt(MASK_192_AFTER.w ** 2 + MASK_192_AFTER.h ** 2) / 2;
    expect(halfDiag / 192).toBeLessThanOrEqual(0.4);
    expect(halfDiag / 192).toBeGreaterThan(0.37);
    expect(tileSize(maskable192)).toBe(192);
  });

  it('★★★ the artwork is REFERENCED, never drawn — fix-322 survives', () => {
    // ★ Cropping fully transparent margin is not redrawing: getbbox() returns
    // the tightest box containing any non-zero alpha and crop() returns those
    // same pixels. Not one pixel of the mark is altered.
    const py = stripPython(iconScript);
    expect(py).not.toMatch(/<path|viewBox|<svg/);
    expect(py).not.toMatch(/ImageDraw|\.line\(|\.polygon\(|\.arc\(|putpixel|\.point\(/);
    expect(py).toContain("'bridge-icon-2026-256.png'");
  });

  it('★ the `any` icons keep their own rule — nothing crops them', () => {
    expect(iconScript).toContain('ANY_WIDTH_FILL = 0.96');
    expect(iconScript).toContain("if purpose == 'any'");
  });
});

// ---------------------------------------------------------------------------
// §4 — ★ a new version is offered, never applied
// ---------------------------------------------------------------------------

describe('fix-371 §4: the new-build notice', () => {
  it('★ it reads the fingerprinted bundle out of the uncached index.html', () => {
    const html =
      '<!doctype html><html><head>' +
      '<script type="module" crossorigin src="/assets/index-B7xK2m.js"></script>' +
      '</head><body></body></html>';
    expect(parseDeployedBundleUrl(html)).toBe('/assets/index-B7xK2m.js');
    expect(parseDeployedBundleUrl('<html></html>')).toBeNull();
  });

  it('★★ an unknown answer is never a new version', () => {
    // A failed fetch, an unparseable page, a dev entry that matches on both
    // sides. A false "update ready" is how a person learns to ignore it.
    expect(isNewBuildAvailable(null, '/assets/index-a.js')).toBe(false);
    expect(isNewBuildAvailable('/assets/index-a.js', null)).toBe(false);
    expect(isNewBuildAvailable('/assets/index-a.js', '/assets/index-a.js')).toBe(false);
    expect(isNewBuildAvailable('/assets/index-a.js', '/assets/index-b.js')).toBe(true);
  });

  it('★ the running bundle comes from the document, with no build step', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><script type="module" src="/assets/index-9f.js"></script></head><body></body></html>',
      'text/html',
    );
    expect(runningBundleUrl(doc)).toBe('/assets/index-9f.js');
    expect(runningBundleUrl(new DOMParser().parseFromString('<html></html>', 'text/html'))).toBeNull();
  });

  it('★★★ NOTHING auto-reloads', () => {
    // Reloading discards what somebody was typing. It offers; a person acts.
    const notice = strip(noticeSource);
    expect(notice).toContain('window.location.reload()');
    expect(notice).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
    // The only reload is inside the button's handler.
    expect(notice.match(/window\.location\.reload/g) ?? []).toHaveLength(1);
    expect(notice).toContain('if (!available) return null;');
  });
});

// ---------------------------------------------------------------------------
// Helpers and the measured constants
// ---------------------------------------------------------------------------

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

function stripPython(src: string): string {
  return src.replace(/"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '');
}
