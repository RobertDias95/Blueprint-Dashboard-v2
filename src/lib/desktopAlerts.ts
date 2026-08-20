// ===========================================================================
// ★★★ fix-369 — the desktop rendering of a notification that already exists
// ===========================================================================
//
// Bobby: "can the app UI on the computer ribbon render on my pc so the app is
// noticeable?" … and "an auditory ding, similar to how Teams works."
//
// ---------------------------------------------------------------------------
// ★★★ THE ONE RULE THIS FILE EXISTS TO ENFORCE
// ---------------------------------------------------------------------------
//
// A DESKTOP BANNER IS A SECOND RENDERING OF A fix-360 ITEM. IT IS NEVER A
// SECOND SOURCE OF TRUTH.
//
// `useBoardNotifications` already decides what is unread and for whom — nine
// sources, two audiences, an epoch, a watermark key for the mutating one, and
// `unseenItems` applying read rows to the personal ones and skipping them for
// the shared ones. Everything here takes that list as an argument. Nothing here
// queries anything, and nothing here decides what is news.
//
// ★ That is not tidiness. The failure it prevents is the bell saying 3 and the
// banners having fired 5 times, at which point neither is believed again.
//
// ---------------------------------------------------------------------------
// ★★★ AND THE SECOND RULE, WHICH IS THE WHOLE OF §3 OF THE BRIEF
// ---------------------------------------------------------------------------
//
// "A sound for everything becomes a sound nobody has on in a week."
//
// So the audible set is small and the silent set is the default-sized one, and
// the line between them is not "important vs unimportant" — that is a judgement
// nobody agrees on — but:
//
//     ★★★ A PERSON AIMED IT AT YOU        →  it may ding
//     ★★★ THE MACHINE NOTICED SOMETHING   →  it is silent, always
//
// A mention, a post request, an answer to a post request you made, a project
// handed to you, a task a colleague assigned you: a human chose your name. A
// status flip the scraper found, a permit appearing, a task the machine closed
// when the permit issued, fifteen people reacting to your post: nobody chose
// anything.
//
// ★★ Reactions are named in the brief and they are the sharpest case. fix-360
// made them ONE aggregating row precisely so fifteen acknowledgements are not
// fifteen interruptions; a ding per reaction would undo that ticket. They are
// silent at every setting, and there is no setting that turns them on.

import type { NewItem, NewItemSource } from './boardReads';

// ---------------------------------------------------------------------------
// The preference
// ---------------------------------------------------------------------------

/** ★ Three settings, and the middle one is the default. */
export type SoundPref = 'all' | 'mentions' | 'off';

export const SOUND_PREFS: readonly SoundPref[] = ['all', 'mentions', 'off'];

/** ★★ THE DEFAULT IS THE MIDDLE OPTION, not everything.
 *
 *  A person who has never opened the control hears the things that name them
 *  and nothing else. Defaulting to `all` would put the loudest possible
 *  behaviour on 29 logins who never asked for it, and the first thing anybody
 *  does with a too-loud app is turn all of it off — including the part they
 *  would have wanted. */
export const DEFAULT_SOUND_PREF: SoundPref = 'mentions';

/** ★ The fix-365 board-lens idiom exactly: localStorage, keyed by auth user id,
 *  because two people share a machine and a preference is a person's, not a
 *  browser's. Not a row — see boardByAssociate's note on why none of these are.
 *  A preference with no server meaning does not earn a table, a migration, an
 *  RLS policy and a query. */
function storageKey(userId: string): string {
  return `notifySound.${userId}`;
}

function isSoundPref(v: unknown): v is SoundPref {
  return v === 'all' || v === 'mentions' || v === 'off';
}

/** ★ Returns null for NEVER CHOSEN, following `collapsePrefs` rather than
 *  `loadBoardLens` — the caller applies DEFAULT_SOUND_PREF, so "has this person
 *  ever decided?" stays answerable, which the control uses. */
export function loadSoundPref(userId: string | null | undefined): SoundPref | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return isSoundPref(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Best-effort. A full or blocked localStorage must not break the bell. */
export function saveSoundPref(
  userId: string | null | undefined,
  pref: SoundPref,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), pref);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// ★★★ What makes a sound
// ---------------------------------------------------------------------------

/** ★ The narrow set — a person said your name in a conversation.
 *
 *  `mention` covers a post OR a reply that tags you (see boardReads §5, which
 *  says so at the source), so "a reply in a thread you are in" is in here
 *  without a tenth source. */
export const MENTION_LEVEL_SOURCES: ReadonlySet<NewItemSource> = new Set<NewItemSource>([
  'mention',
  'post_request',
  'post_request_outcome',
]);

/** ★ The wide set — the above, plus a person handing you WORK. */
export const ALL_LEVEL_SOURCES: ReadonlySet<NewItemSource> = new Set<NewItemSource>([
  ...MENTION_LEVEL_SOURCES,
  'task',
  'handoff',
]);

/** ★★★ SILENT AT EVERY SETTING. Not "off by default" — unreachable.
 *
 *  There is no preference value that makes a reaction digest, a status flip, a
 *  scraper find or an automatic closure audible, because none of them is a
 *  person choosing you. Listed as a constant so the test can assert the set
 *  rather than assert four separate absences. */
export const NEVER_AUDIBLE_SOURCES: ReadonlySet<NewItemSource> = new Set<NewItemSource>([
  'flip',
  'permit',
  'auto_closed',
  'reaction',
]);

/** The shape `isAudible` needs. Structural, so a test can build one without
 *  assembling a whole NewItem — and so this file does not care where it came
 *  from as long as fix-360 made it. */
export interface AudibleItem {
  source: NewItemSource;
  /** ★★★ fix-363's provenance, and the reason a task is not simply audible.
   *  Null means the machine made it, or nobody recorded who did. */
  actor?: string | null;
}

/**
 * ★★★ THE MEASUREMENT THAT SHAPED THIS, taken on prod 2026-08-20.
 *
 * Tasks created since the notification epoch (2026-08-14, six days):
 *
 *     created                                    299   ~50 a day
 *     …bot-created (is_auto_generated)           173
 *     …with a PERSON recorded as the assigner      1
 *
 * ★★★ So "a task assigned to you dings" would have dinged 298 times for work
 * no colleague chose to give anybody — roughly fifty interruptions a day from
 * the scraper. That is the "sound nobody has on in a week" arriving in week
 * one, and it is why the person/machine line is drawn INSIDE the task source
 * rather than around it.
 *
 * ★★ fix-363 already tells them apart and this needed no new fact: the RPC
 * behind `taskAssigners` filters `actor_uid IS NOT NULL`, so an entry exists
 * only when a human performed the assignment. `NewItem.actor` carries that
 * through, and its absence keeps fix-363's meaning — "not recorded", never
 * "nobody" — which is the safe way round here too: an unattributed task is
 * silent, and the worst case is a quiet notification rather than a false one.
 */
export function isAudible(item: AudibleItem, pref: SoundPref): boolean {
  if (pref === 'off') return false;
  const audible = pref === 'mentions' ? MENTION_LEVEL_SOURCES : ALL_LEVEL_SOURCES;
  if (!audible.has(item.source)) return false;
  // ★★★ A task only dings when a PERSON is recorded as having assigned it.
  if (item.source === 'task' && !(item.actor ?? '').trim()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ★★ Which items become a banner — and the backlog trap
// ---------------------------------------------------------------------------

export interface AlertPlan {
  /** The items to raise a desktop banner for, in arrival order. */
  banners: NewItem[];
  /** ★ ONE ding for the whole batch, never one per item — the same reasoning
   *  fix-360 applied to reactions, applied to everything. Three mentions
   *  landing in one refetch is one sound. */
  ding: boolean;
  /** The keys now considered announced. The caller holds this between passes. */
  announced: ReadonlySet<string>;
}

/**
 * ★★★ THE FIRST PASS ANNOUNCES NOTHING, AND THAT IS THE POINT.
 *
 * `unseen` is a BACKLOG, not an event stream: open the app on a Monday with
 * eleven unread items and a naive "banner everything unseen" fires eleven
 * banners and a sound, for things that happened last week. Worse, it does it
 * again on every hard refresh.
 *
 * So the first pass with data SEEDS — it records what was already waiting and
 * raises nothing. Only a key that appears AFTER the app was open is news in the
 * sense a banner means, which is exactly the sense §-scope of this ticket is
 * limited to: the window exists, and something arrived while you had it open.
 *
 * ★ The seeded set is replaced by the current keys each pass rather than
 * accumulated, so it stays the size of the unread list. A key cannot return
 * once read — reads are append-only (fix-307) — except a reaction key, whose
 * watermark deliberately CHANGES when a new reaction lands (fix-360). That is
 * a genuinely new item and it should raise a genuinely new banner; it just
 * must not make a sound, which `isAudible` handles.
 *
 * ★ An empty list keeps the previous set rather than clearing it, so a refetch
 * that momentarily yields nothing cannot re-announce the whole backlog.
 */
export function planAlerts(
  unseen: ReadonlyArray<NewItem>,
  announced: ReadonlySet<string> | null,
  pref: SoundPref,
): AlertPlan {
  const keys = unseen.map((i) => i.key);
  if (announced === null) {
    // First pass with data — seed and stay quiet.
    return { banners: [], ding: false, announced: new Set(keys) };
  }
  const banners = unseen.filter((i) => !announced.has(i.key));
  const next = keys.length > 0 ? new Set(keys) : announced;
  return {
    banners,
    ding: banners.some((i) => isAudible(i, pref)),
    announced: next,
  };
}

// ---------------------------------------------------------------------------
// ★ The banner's own words
// ---------------------------------------------------------------------------

/** The OS banner has a title line and a body line, and nothing else. fix-360's
 *  item already has both plus a place — `where` goes on the body because the
 *  address is what tells you whether to look now. */
export function bannerBody(item: NewItem): string {
  const parts = [item.subtitle, item.where].filter(
    (s): s is string => typeof s === 'string' && s.trim() !== '',
  );
  return parts.join(' · ');
}

/** ★ One banner per key, so re-showing is idempotent at the OS level: a
 *  notification with an existing tag REPLACES it rather than stacking. The key
 *  is fix-360's, which is why this is one line and not a scheme. */
export function bannerTag(item: NewItem): string {
  return item.key;
}
