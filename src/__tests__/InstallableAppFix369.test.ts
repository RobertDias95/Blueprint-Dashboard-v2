import { describe, it, expect, beforeEach, vi } from 'vitest';
import manifestRaw from '../../public/manifest.webmanifest?raw';
import swSource from '../../public/sw.js?raw';
import indexHtml from '../../index.html?raw';
import alertsSource from '../lib/desktopAlerts.ts?raw';
import driverSource from '../hooks/useDesktopAlerts.ts?raw';
import controlSource from '../components/DesktopAlertsControl.tsx?raw';
import iconScript from '../../scripts/compose-app-icons.py?raw';
import mainSource from '../main.tsx?raw';
// ★ The icon bytes themselves, inlined by Vite — the same idiom fix-351 uses
// to assert the lockup's real dimensions. No node:fs, and no @types/node in
// the app's tsconfig to argue with.
import appIcon64 from '../../public/bridge-app-64.png?inline';
import appIcon192 from '../../public/bridge-app-192.png?inline';
import appIcon256 from '../../public/bridge-app-256.png?inline';
import appIcon512 from '../../public/bridge-app-512.png?inline';
import maskable192 from '../../public/bridge-maskable-192.png?inline';
import maskable512 from '../../public/bridge-maskable-512.png?inline';
import favicon32 from '../../public/bridge-favicon-2026-32.png?inline';
import {
  ALL_LEVEL_SOURCES,
  DEFAULT_SOUND_PREF,
  MENTION_LEVEL_SOURCES,
  NEVER_AUDIBLE_SOURCES,
  bannerBody,
  bannerTag,
  isAudible,
  loadSoundPref,
  planAlerts,
  saveSoundPref,
  type SoundPref,
} from '../lib/desktopAlerts';
import { DING_TONES, playDing, __setDingContextForTest } from '../lib/alertSound';
import type { NewItem, NewItemSource } from '../lib/boardReads';

// ===========================================================================
// fix-369 — it installs, but it isn't an app
// ===========================================================================
//
// Bobby: "can the app UI on the computer ribbon render on my pc so the app is
// noticeable? It works for Miles's computer and shows normally but maybe I have
// dark mode." … and "an auditory ding, similar to how Teams works."
//
// ★★★ THE SCOPE LINE, and every test below sits on one side of it: DOES THE
// APP WINDOW EXIST RIGHT NOW. A manifest, a maskable icon, banners and a sound
// while the app is open, a count on the taskbar — in. Web Push, offline
// caching, background sync — out, and asserted out, because a half-built push
// path is worse than none.


interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
}

const manifest = JSON.parse(manifestRaw) as Manifest;

// ---------------------------------------------------------------------------
// ★ ONE whole-tree read, shared. Three of the assertions below are sweeps over
// every source file; globbing three times triples a transform cost that the
// full parallel suite already feels (fix-326 reads the tree the same way and
// budgets 60s for it). Lazy, awaited once, cached.
// ---------------------------------------------------------------------------

const SOURCE_GLOB = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
});

let sourceCache: Record<string, string> | null = null;

async function allSources(): Promise<Record<string, string>> {
  if (sourceCache) return sourceCache;
  const out: Record<string, string> = {};
  for (const [path, load] of Object.entries(SOURCE_GLOB)) {
    out[path] = (await load()) as string;
  }
  sourceCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// ★ Reading a PNG without an image library.
// ---------------------------------------------------------------------------
//
// ★★★ THE POINT OF DOING IT THIS WAY. "The icon is opaque" could be asserted
// by sampling pixels, but a PNG that HAS an alpha channel is one edit away from
// having a transparent pixel in it again. Colour type 2 is truecolour with NO
// ALPHA CHANNEL AT ALL, and `tRNS` is the only other way a PNG can express
// transparency — so asserting both means the format has nowhere left to put the
// bug. That is a stronger statement than any number of pixel samples.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface PngFacts {
  width: number;
  height: number;
  /** 0 grey · 2 truecolour · 3 palette · 4 grey+alpha · 6 truecolour+alpha */
  colourType: number;
  hasTransparencyChunk: boolean;
  bytes: number;
}

const ICON_BYTES: Record<string, string> = {
  '/bridge-app-64.png': appIcon64,
  '/bridge-app-192.png': appIcon192,
  '/bridge-app-256.png': appIcon256,
  '/bridge-app-512.png': appIcon512,
  '/bridge-maskable-192.png': maskable192,
  '/bridge-maskable-512.png': maskable512,
  '/bridge-favicon-2026-32.png': favicon32,
};

function readPng(src: string): PngFacts {
  const dataUri = ICON_BYTES[src];
  expect(dataUri, `${src} is not inlined by this suite`).toBeTruthy();
  const bin = atob(dataUri.slice(dataUri.indexOf(',') + 1));
  const at = (i: number) => bin.charCodeAt(i);
  const be32 = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    expect(at(i), `${src} is not a PNG`).toBe(PNG_SIGNATURE[i]);
  }
  // IHDR is always the first chunk: 8 signature + 4 length + 4 type, then
  // width(4) height(4) bitDepth(1) colourType(1).
  return {
    width: be32(16),
    height: be32(20),
    colourType: at(25),
    hasTransparencyChunk: bin.includes('tRNS'),
    bytes: bin.length,
  };
}

// ---------------------------------------------------------------------------
// §1 — the manifest, and the icon that was actually broken
// ---------------------------------------------------------------------------

describe('fix-369 §1: there is a manifest, and its icons are opaque', () => {
  it('★★ the manifest exists and declares an installable app', () => {
    expect(manifest.name).toBe('Blueprint Bridge');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    // ★ `standalone` is what gives it its own window and its own taskbar
    // entry. In `browser` display mode it is a bookmark, which is what it was.
    expect(manifest.display).toBe('standalone');
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
  });

  it('★★★ it declares a MASKABLE icon — the actual fix', () => {
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
    // ★ Both sizes Chrome asks for, so nothing has to be upscaled by the OS.
    expect(maskable.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
  });

  it('★★ …and Chrome\'s installability floor is met by the `any` set too', () => {
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(any).toContain('192x192');
    expect(any).toContain('512x512');
  });

  it('★★★ EVERY app icon file is opaque — no alpha channel, no tRNS chunk', () => {
    // ★★★ THIS IS THE BUG, ASSERTED. The shipped tab icon is dark navy line
    // art with a maximum alpha of 213/255 and 88% of its canvas empty; Windows
    // composited that against Bobby's dark taskbar and it disappeared. It was
    // never dark mode — it was the absence of a ground.
    for (const icon of manifest.icons) {
      const png = readPng(icon.src);
      expect(png.colourType, `${icon.src} has an alpha channel`).toBe(2);
      expect(png.hasTransparencyChunk, `${icon.src} carries tRNS`).toBe(false);
      expect(png.bytes).toBeGreaterThan(500);
    }
  });

  it('★★ every icon file is the size it claims to be', () => {
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      const png = readPng(icon.src);
      expect(png.width, icon.src).toBe(w);
      expect(png.height, icon.src).toBe(h);
    }
  });

  it('★★ the ORIGINAL tab icon is left transparent, and that is deliberate', () => {
    // ★ The favicon sits on the browser's own chrome, which supplies its own
    // ground. Flattening it would have been a change to a shipped asset for no
    // reason — and fix-351's suite asserts the tab still points at these two.
    const favicon = readPng('/bridge-favicon-2026-32.png');
    expect(favicon.colourType).toBe(6);
    expect(indexHtml).toContain('href="/bridge-favicon-2026-32.png"');
    expect(indexHtml).toContain('href="/bridge-icon-2026-256.png"');
  });

  it('★★★ the artwork is COMPOSED, never redrawn — fix-322 still holds', () => {
    // fix-322's standing contract, and the brief restates it: "Do not trace or
    // re-vector the mark." The generator opens the shipped PNG and pastes it;
    // it has no drawing primitive of any kind.
    expect(iconScript).toContain("public', 'bridge-icon-2026-256.png'");
    // ★ COMMENTS STRIPPED FIRST, in every one of these greps. These files
    // explain the contract they are keeping, so their own prose quotes the
    // markup being forbidden — and an absence assertion that reads its own
    // documentation as a violation is a test that punishes writing any down.
    for (const src of [
      stripPython(iconScript),
      stripComments(alertsSource),
      stripComments(driverSource),
      stripComments(controlSource),
    ]) {
      expect(src).not.toMatch(/<path|viewBox|<svg/);
    }
    // ★ No drawing API either — a polygon call would be redrawing by another
    // name.
    expect(stripPython(iconScript)).not.toMatch(/ImageDraw|\.line\(|\.polygon\(|\.arc\(/);
  });

  it('★ the public/ and src/assets/brand/ split is kept — fix-326', () => {
    // The manifest and its icons live in public/ and are referenced by stable
    // path, because the BROWSER fetches them: a fingerprinted name would
    // change under every installed copy. Nothing here is imported into the
    // bundle, and nothing here was added to src/assets/brand/.
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/bridge-')).toBe(true);
    }
    expect(driverSource).not.toMatch(/assets\/brand/);
  });
});

// ---------------------------------------------------------------------------
// §2 — the service worker, and what it deliberately does not do
// ---------------------------------------------------------------------------

describe('fix-369 §2: the worker is minimal on purpose', () => {
  it('★★★ THERE IS NO WEB PUSH — not a stub, not a handler, nothing', () => {
    // The expensive 20%: VAPID keys, a push service, a server that sends. It
    // buys the case where nobody has the app open, and these people keep it
    // open all day. A `push` listener with no server behind it would be a
    // placeholder that reads as a feature.
    expect(swSource).not.toMatch(/addEventListener\(['"]push['"]/);
    expect(stripComments(swSource)).not.toMatch(/pushManager|applicationServerKey|VAPID/i);
    for (const src of [driverSource, controlSource, alertsSource]) {
      expect(stripComments(src)).not.toMatch(/pushManager|applicationServerKey/i);
    }
  });

  it('★★ it caches nothing — no offline layer, by design', () => {
    expect(stripComments(swSource)).not.toMatch(/caches\.|CacheStorage|precache/i);
    // ★ A fetch handler EXISTS (Chrome's install criteria look for one) and is
    // empty — not calling respondWith leaves every request on the network,
    // which is what makes a stale-bundle bug impossible here.
    expect(swSource).toMatch(/addEventListener\(['"]fetch['"]/);
    expect(stripComments(swSource)).not.toContain('respondWith');
  });

  it('★★ a banner click focuses the tab that is already open', () => {
    expect(swSource).toMatch(/addEventListener\(['"]notificationclick['"]/);
    expect(swSource).toContain('matchAll');
    expect(swSource).toContain('focus');
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★★ what makes a sound, and what does not
// ---------------------------------------------------------------------------

function item(source: NewItemSource, over: Partial<NewItem> = {}): NewItem {
  return {
    key: `${source}:1`,
    source,
    title: 'Something happened',
    subtitle: null,
    where: '233 31st Ave E · Building Permit',
    at: '2026-08-20T10:00:00Z',
    permitId: null,
    projectId: 'p-1',
    ...over,
  };
}

describe('fix-369 §3: the sound rule', () => {
  it('★★★ a REACTION DIGEST makes no sound; a MENTION does', () => {
    // ★★★ The brief names this pair, and reactions are the sharp end of it.
    // fix-360 made fifteen reactions ONE aggregating row precisely so fifteen
    // acknowledgements are not fifteen interruptions. A ding per reaction
    // would undo that ticket.
    for (const pref of ['all', 'mentions'] as SoundPref[]) {
      expect(isAudible(item('reaction'), pref)).toBe(false);
      expect(isAudible(item('mention'), pref)).toBe(true);
    }
  });

  it('★★★ nothing the MACHINE noticed is audible, at any setting', () => {
    // The line is not "important vs unimportant" — nobody agrees on that. It
    // is: a person aimed it at you, or the machine noticed something.
    expect([...NEVER_AUDIBLE_SOURCES].sort()).toEqual([
      'auto_closed',
      'flip',
      'permit',
      'reaction',
    ]);
    for (const source of NEVER_AUDIBLE_SOURCES) {
      for (const pref of ['all', 'mentions', 'off'] as SoundPref[]) {
        expect(isAudible(item(source), pref), `${source} @ ${pref}`).toBe(false);
      }
    }
  });

  it('★★★ a task a PERSON assigned dings; a task the MACHINE made does not', () => {
    // ★★★ MEASURED on prod 2026-08-20 and it decided this: of the 299 tasks
    // created in the six days after the notification epoch, 173 were
    // bot-created and exactly ONE has a person recorded as its assigner. "A
    // task assigned to you dings" would have been ~50 interruptions a day
    // from the scraper — the "sound nobody has on in a week", in week one.
    //
    // ★★ fix-363 already tells them apart, and this needed no new fact: the
    // RPC behind `taskAssigners` filters `actor_uid IS NOT NULL`.
    expect(isAudible(item('task', { actor: 'Briana' }), 'all')).toBe(true);
    expect(isAudible(item('task', { actor: null }), 'all')).toBe(false);
    expect(isAudible(item('task', {}), 'all')).toBe(false);
    // ★ An absent actor keeps fix-363's meaning — NOT RECORDED, never
    // "nobody" — and silence is the safe side of that ambiguity.
    expect(isAudible(item('task', { actor: '   ' }), 'all')).toBe(false);
  });

  it('★★ "mentions only" is narrower than "all", and both exclude the machine', () => {
    expect([...MENTION_LEVEL_SOURCES].sort()).toEqual([
      'mention',
      'post_request',
      'post_request_outcome',
    ]);
    expect([...ALL_LEVEL_SOURCES].sort()).toEqual([
      'handoff',
      'mention',
      'post_request',
      'post_request_outcome',
      'task',
    ]);
    // Work assigned by a person is audible at `all` and silent at `mentions`.
    expect(isAudible(item('handoff'), 'all')).toBe(true);
    expect(isAudible(item('handoff'), 'mentions')).toBe(false);
    expect(isAudible(item('task', { actor: 'Briana' }), 'mentions')).toBe(false);
  });

  it('★ a reply in a thread you are in is covered — it arrives as a mention', () => {
    // boardReads §5 says so at the source: the mention item targets "the
    // message that mentions you — post OR reply". No tenth source was needed.
    expect(isAudible(item('mention'), 'mentions')).toBe(true);
  });

  it('★★ "off" silences everything, including a mention', () => {
    for (const source of ALL_LEVEL_SOURCES) {
      expect(isAudible(item(source, { actor: 'Briana' }), 'off')).toBe(false);
    }
  });

  it('★ ONE ding for a batch, never one per item', () => {
    const three = [
      item('mention', { key: 'm1' }),
      item('mention', { key: 'm2' }),
      item('mention', { key: 'm3' }),
    ];
    const plan = planAlerts(three, new Set<string>(), 'mentions');
    expect(plan.banners).toHaveLength(3);
    // A boolean, not a count — the same reasoning fix-360 applied to
    // reactions, applied to every source.
    expect(plan.ding).toBe(true);
  });

  it('★★ the ding is two real tones, held as data', () => {
    expect(DING_TONES).toHaveLength(2);
    // A rising minor third: A5 → C#6. Rising reads as "here is something";
    // falling reads as "something went wrong".
    expect(DING_TONES[1].hz).toBeGreaterThan(DING_TONES[0].hz);
    const total = DING_TONES[1].at + DING_TONES[1].for;
    expect(total).toBeLessThan(0.3);

    const started: number[] = [];
    playDing({
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: async () => {},
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
    });
    expect(started).toEqual([DING_TONES[0].at, DING_TONES[1].at]);
  });

  it('★ no sound at all when there is no audio context — never a throw', () => {
    __setDingContextForTest(null);
    expect(() => playDing()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3b — the preference
// ---------------------------------------------------------------------------

describe('fix-369 §3b: the sound preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('★★ it defaults to the MIDDLE option, not to everything', () => {
    expect(DEFAULT_SOUND_PREF).toBe('mentions');
    // ★ Null is "never chosen" — the caller applies the default, following
    // collapsePrefs rather than loadBoardLens, so the control can tell.
    expect(loadSoundPref('bobby-uuid')).toBeNull();
  });

  it('★ it persists PER PERSON — two logins on one machine', () => {
    saveSoundPref('bobby-uuid', 'all');
    saveSoundPref('miles-uuid', 'off');
    expect(loadSoundPref('bobby-uuid')).toBe('all');
    expect(loadSoundPref('miles-uuid')).toBe('off');
    // The fix-365 board-lens key shape exactly.
    expect(window.localStorage.getItem('notifySound.bobby-uuid')).toBe('all');
  });

  it('★ a signed-out or corrupt value is the default, never a crash', () => {
    expect(loadSoundPref(null)).toBeNull();
    window.localStorage.setItem('notifySound.bobby-uuid', 'LOUD');
    expect(loadSoundPref('bobby-uuid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §4 — banners come from ONE source, and the backlog trap
// ---------------------------------------------------------------------------

describe('fix-369 §4: a banner is a second rendering, not a second source', () => {
  it('★★★ the driver derives NOTHING — it reads fix-360 and nothing else', () => {
    // ★★★ The failure this prevents: the bell saying 3 while the banners have
    // fired 5 times, at which point neither number is believed again.
    expect(driverSource).toContain("from './useBoardNotifications'");
    expect(stripComments(driverSource)).not.toMatch(
      /supabase|useQuery|from '\.\.\/lib\/db|buildNewItems/,
    );
    expect(stripComments(alertsSource)).not.toMatch(/supabase|useQuery|buildNewItems/);
    // Its whole input is the list, the count and the loading flag.
    expect(driverSource).toContain('const { unseen, unseenCount, isLoading } = useBoardNotifications()');
  });

  it('★★★ the FIRST pass announces nothing — the backlog is not news', () => {
    // Open the app on a Monday with eleven unread items: a naive "banner
    // everything unseen" fires eleven banners for things that happened last
    // week, and again on every refresh.
    const backlog = [item('mention', { key: 'm1' }), item('flip', { key: 'f1' })];
    const first = planAlerts(backlog, null, 'mentions');
    expect(first.banners).toEqual([]);
    expect(first.ding).toBe(false);
    expect([...first.announced].sort()).toEqual(['f1', 'm1']);

    // …and what arrives AFTER the app was open is.
    const second = planAlerts(
      [...backlog, item('mention', { key: 'm2' })],
      first.announced,
      'mentions',
    );
    expect(second.banners.map((i) => i.key)).toEqual(['m2']);
    expect(second.ding).toBe(true);
  });

  it('★★ the same item is never announced twice', () => {
    const one = [item('mention', { key: 'm1' })];
    const seeded = planAlerts(one, null, 'mentions');
    const again = planAlerts(one, seeded.announced, 'mentions');
    expect(again.banners).toEqual([]);
    const third = planAlerts(one, again.announced, 'mentions');
    expect(third.banners).toEqual([]);
  });

  it('★ an empty pass keeps the seed, so a blank refetch cannot re-announce', () => {
    const seeded = planAlerts([item('mention', { key: 'm1' })], null, 'mentions');
    const blank = planAlerts([], seeded.announced, 'mentions');
    expect(blank.banners).toEqual([]);
    expect([...blank.announced]).toEqual(['m1']);
  });

  it('★★ a NEW reaction watermark banners again — but still silently', () => {
    // fix-360's reaction key carries the newest timestamp, so a 16th reaction
    // is a genuinely new key. It should land; it must not ding.
    const first = planAlerts(
      [item('reaction', { key: 'reaction:msg-1:2026-08-20T10:00:00Z' })],
      null,
      'all',
    );
    const next = planAlerts(
      [item('reaction', { key: 'reaction:msg-1:2026-08-20T11:00:00Z' })],
      first.announced,
      'all',
    );
    expect(next.banners).toHaveLength(1);
    expect(next.ding).toBe(false);
  });

  it('★ the banner reuses fix-360\'s words and fix-362\'s target', () => {
    const i = item('mention', {
      key: 'mention:msg-9',
      title: 'Mentioned you in chat',
      subtitle: 'can you check the tree report',
      target: { kind: 'message', projectId: 'p-1', messageId: 'msg-9' },
    });
    expect(bannerBody(i)).toBe(
      'can you check the tree report · 233 31st Ave E · Building Permit',
    );
    // ★ The tag is the item key, so re-showing REPLACES rather than stacks.
    expect(bannerTag(i)).toBe('mention:msg-9');
    expect(driverSource).toContain('targetHref(item)');
  });
});

// ---------------------------------------------------------------------------
// §5 — the taskbar count
// ---------------------------------------------------------------------------

describe('fix-369 §5: the badge', () => {
  it('★★ it MUST reach zero — fix-307\'s lesson, restated', () => {
    // A badge that never empties gets ignored, which is exactly why fix-307
    // stopped the bell counting outstanding work. `setAppBadge(0)` is
    // specified to show a badge with NO NUMBER rather than none, so zero has
    // to CLEAR instead of set.
    expect(driverSource).toContain('clearAppBadge');
    expect(driverSource).toMatch(/if \(count > 0\).*setAppBadge/s);
    expect(driverSource).toMatch(/else.*clearAppBadge/s);
  });

  it('★★ it is driven by the same count the bell shows', () => {
    expect(driverSource).toContain('applyBadge(unseenCount)');
    expect(driverSource).not.toMatch(/badge.*\.length \+ |badgeCount =/);
  });

  it('★ it asks for no permission and makes no sound', () => {
    const badgeBlock = driverSource.slice(
      driverSource.indexOf('function applyBadge'),
      driverSource.indexOf('export interface DesktopAlertsState'),
    );
    expect(badgeBlock).not.toContain('requestPermission');
    expect(badgeBlock).not.toContain('playDing');
  });
});

// ---------------------------------------------------------------------------
// §6 — ★★★ the permission, and the failure that cannot be undone
// ---------------------------------------------------------------------------

describe('fix-369 §6: permission is asked once, from a control', () => {
  it('★★★ NOTHING requests permission on load', async () => {
    // ★★★ A prompt on first paint is the one everybody denies, and a denial is
    // STICKY — Chrome will not ask again. Getting this wrong once costs that
    // person the feature permanently, so it is asserted over the WHOLE tree
    // rather than over the file that happens to be right today.
    const sources = await allSources();
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('__tests__'))
      .filter(([, src]) => stripComments(src).includes('requestPermission('))
      .map(([path]) => path);
    expect(offenders).toEqual(['../components/DesktopAlertsControl.tsx']);
  }, 60_000);

  it('★★★ …and even there it is inside a handler, never at module scope', () => {
    const body = stripComments(controlSource);
    const call = body.indexOf('Notification.requestPermission(');
    expect(call).toBeGreaterThan(-1);
    // The only call sits inside `askForPermission`, which the button's onClick
    // invokes. Module scope ends at the first function.
    const fn = body.indexOf('async function askForPermission');
    expect(fn).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(fn);
    expect(body).toContain('onClick={() => void askForPermission()}');
    // ★ Reading the permission shows no dialog and is fine anywhere.
    expect(body).toContain('Notification.permission');
  });

  it('★★ registering the worker is not asking for anything', () => {
    // The one piece that DOES belong on load, and it is safe there because it
    // raises no dialog and grants no capability.
    expect(mainSource).toContain('registerAppServiceWorker()');
    expect(stripComments(mainSource)).not.toContain('Notification');
  });
});

// ---------------------------------------------------------------------------
// §7 — ★★★ a denial leaves the mechanism intact
// ---------------------------------------------------------------------------

describe('fix-369 §7: a denied permission degrades cleanly', () => {
  it('★★★ the banner is the ONLY thing gated on permission', () => {
    const body = stripComments(driverSource);
    // One gate, and everything before it runs regardless.
    const gate = body.indexOf("permissionNow() !== 'granted'");
    expect(gate).toBeGreaterThan(-1);
    expect(body.match(/permissionNow\(\) !== 'granted'/g)).toHaveLength(1);

    // ★★★ The sound is decided and played BEFORE the gate…
    expect(body.indexOf('playDing()')).toBeLessThan(gate);
    // …and the badge is in a different effect entirely, so it cannot be
    // reached by the gate at all.
    const badgeEffect = body.indexOf('applyBadge(unseenCount)');
    expect(badgeEffect).toBeGreaterThan(-1);
    expect(body.slice(gate, badgeEffect)).not.toContain('applyBadge');
  });

  it('★★★ the bell, the badge and the centre never consult it', async () => {
    const sources = await allSources();
    for (const path of [
      '../components/BoardBell.tsx',
      '../pages/Notifications.tsx',
      '../hooks/useBoardNotifications.ts',
      '../lib/boardReads.ts',
    ]) {
      expect(stripComments(sources[path]), path).not.toMatch(
        /Notification\.permission|requestPermission/,
      );
    }
  });

  it('★★ and the control SAYS what still works', () => {
    // ★ The failure mode a dead end causes is somebody concluding
    // notifications are broken. Denied is not a blank — it names what is off,
    // that it cannot be reversed from here, and what is unaffected.
    expect(controlSource).toContain('desktop-alerts-denied');
    expect(controlSource).toMatch(/bell, the unread count and this page are\s+unaffected/);
    expect(controlSource).toContain('desktop-alerts-unsupported');
  });
});

// ---------------------------------------------------------------------------
// ★ Shared helper — the same comment-stripping fix-351 uses.
// ---------------------------------------------------------------------------

/** ★ Python's two comment forms, for the icon generator. */
function stripPython(src: string): string {
  return src.replace(/"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '');
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

// ---------------------------------------------------------------------------
// ★ Guard the seam the sound module exposes for tests.
// ---------------------------------------------------------------------------

describe('fix-369: prior contracts', () => {
  it('★ nothing here writes to the database', () => {
    for (const src of [alertsSource, driverSource, controlSource]) {
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/);
    }
  });

  it('★ the preference is localStorage, not a row — fix-365\'s rule', () => {
    expect(alertsSource).toContain('window.localStorage');
    expect(alertsSource).toContain('notifySound.');
  });

  it('★ the test seam is only ever used by tests', async () => {
    const sources = await allSources();
    const users = Object.entries(sources)
      .filter(([p]) => !p.includes('__tests__') && !p.endsWith('alertSound.ts'))
      .filter(([, s]) => s.includes('__setDingContextForTest'));
    expect(users).toEqual([]);
    vi.restoreAllMocks();
  });
});
