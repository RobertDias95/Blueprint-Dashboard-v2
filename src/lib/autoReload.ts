// ===========================================================================
// ★★★ fix-595 (P-292) — A STALE APP CATCHES UP WHEN YOU COME BACK
// ===========================================================================
//
// ---------------------------------------------------------------------------
// WHAT fix-589's HEARTBEAT MEASURED, AND WHY IT KILLED EVERY EARLIER THEORY
// ---------------------------------------------------------------------------
//
// `client_build_seen`, four deploys 09-28 → 09-29:
//
//   · **14 of 14 people who pressed the ribbon's Reload moved build**, installed
//     app included. The reload path works. Brittani's *"I hit it and stayed
//     stale"* has not reproduced.
//   · **Ainsley and Matt F, both standalone, were active 07:05–07:09 on 09-29
//     still on `f60eb6b`** — four builds and sixteen hours behind.
//     `notice_shown_count = 1`, never dismissed, never reloaded. M. Divina and
//     Dom the night before.
//   · The ribbon renders until dismissed and records `'shown'` once per
//     document. **So count = 1 with no dismissal means the ribbon sat on their
//     screen the whole time and was ignored. Re-showing it will not help.**
//
// ★ Re-measured 2026-09-29 for this ticket: 31 people, 15 behind, 2 behind AND
//   active in the last twelve hours — and **0 of 31 have ever dismissed it.**
//   Nobody is fighting the ribbon; they are living with it.
//
// ⇒ **The cause of a weeks-old bundle is that the installed app never restarts,
//   and a quiet ribbon is easy to live with.** Detection was never the problem
//   and is not touched.
//
// ---------------------------------------------------------------------------
// ★★★ BOBBY'S RULING (2026-09-29) — THIS NARROWLY SUPERSEDES fix-371 §4
// ---------------------------------------------------------------------------
//
// fix-371 §4 forbade auto-reload, and its reason was right: *"being a day behind
// is a smaller problem than losing a paragraph."* **That reason is kept, whole.**
// What Bobby changed is the scope: reload automatically **only at the one moment
// nothing can be lost — when somebody comes back to a window they left idle.**
//
// ★★★ SO THIS IS NOT "AUTO-RELOAD" IN THE SENSE fix-371 REFUSED. fix-371 was
//     refusing a reload that could interrupt a person mid-sentence. Every one of
//     the four conditions below exists to make that impossible; if any of them is
//     even slightly in doubt, the answer is no and the ribbon — which is already
//     on screen — stays the whole story.

/** Everything the decision depends on. ★ A plain object, so the rule is a pure
 *  function and the truth table is a test rather than a walkthrough. */
export interface AutoReloadInput {
  /** `newBuildIsLive()` — a newer bundle is being served. */
  newBuild: boolean;
  /**
   * How long the document was away, in ms, measured from the `hidden`/`blur`
   * stamp to the moment it came back.
   *
   * ★★★ FROM A TIMESTAMP, NEVER FROM A TIMER. `appVersion.ts` already records
   *     why: *"Chrome throttles timers in a hidden tab"*, and in a backgrounded
   *     INSTALLED app they stop entirely — which is precisely the population
   *     this ticket is for. A `setTimeout(30 * 60_000)` would fire late, or
   *     never, on exactly the devices that need it.
   */
  awayMs: number;
  /** Anything registered in `dirtyRegistry` — a form, a composer, a dialog. */
  dirty: boolean;
  /** `queryClient.isMutating() > 0` — a save is in flight. */
  mutating: boolean;
  /** `document.activeElement` is an input / textarea / select / contenteditable. */
  activeIsInput: boolean;
  /** One attempt per build per document — see {@link AUTO_RELOAD_ONE_PER_BUILD}. */
  triedThisBuild: boolean;
}

/**
 * ★★★ THIRTY MINUTES, AND WHY IT IS NOT FIVE.
 *
 * The number is not about how stale the bundle is — the ribbon already handles
 * that, and escalates. It is about **how confident we can be that nobody is
 * mid-thought.** Five minutes away is a coffee; thirty is a meeting or a night.
 * A person who stepped out for five minutes still has their sentence in their
 * head and expects the screen they left.
 *
 * ★ It is also the number that makes the failure mode benign: the worst case of
 *   being too conservative is somebody sees the ribbon they were already seeing.
 */
export const AUTO_RELOAD_AWAY_MS = 30 * 60 * 1000;

/**
 * ★★ ONE ATTEMPT PER BUILD PER DOCUMENT, which is condition 4 and the thing that
 *    makes this safe to be wrong about.
 *
 *    If the server keeps serving the same new bundle and something about the
 *    reload does not take, a per-return rule would reload on every single return
 *    for ever — a loop that looks exactly like the app being broken. Recording
 *    the attempt against the BUILD means a genuinely new deploy is still
 *    eligible, and a failed one is tried exactly once.
 */
export const AUTO_RELOAD_ONE_PER_BUILD = true;

/**
 * Should the app reload itself right now?
 *
 * ★★★ ALL FOUR MUST HOLD, AND THE ORDER IS THE ARGUMENT: is there anything to
 *     get, has the person been away long enough that nothing is in flight in
 *     their head, is there anything on screen that could be lost, and have we
 *     already tried. Every one of them, alone, is a no.
 */
export function shouldAutoReload(input: AutoReloadInput): boolean {
  if (!input.newBuild) return false;
  if (input.awayMs < AUTO_RELOAD_AWAY_MS) return false;
  // ★★★ THE THREE HALVES OF "NOTHING UNSAVED", and they are deliberately
  //     separate: a registered dirty surface (typed text that survives a blur),
  //     a write already on the wire, and a caret sitting in a field. The third
  //     is the safety net for every editor nobody remembered to register —
  //     including a search box somebody is halfway through.
  if (input.dirty) return false;
  if (input.mutating) return false;
  if (input.activeIsInput) return false;
  if (input.triedThisBuild) return false;
  return true;
}

/**
 * Why it declined, for the one place that wants to say so out loud.
 *
 * ★ Not shown to anybody — `NewBuildNotice` logs nothing when it declines,
 *   because §2 says so and because a person who has just come back does not need
 *   a message about a reload that did not happen. This exists so a test can
 *   assert WHICH condition blocked rather than only that something did.
 */
export type AutoReloadBlocker =
  | 'no-new-build'
  | 'not-away-long-enough'
  | 'dirty'
  | 'mutating'
  | 'active-is-input'
  | 'already-tried'
  | null;

export function autoReloadBlocker(input: AutoReloadInput): AutoReloadBlocker {
  if (!input.newBuild) return 'no-new-build';
  if (input.awayMs < AUTO_RELOAD_AWAY_MS) return 'not-away-long-enough';
  if (input.dirty) return 'dirty';
  if (input.mutating) return 'mutating';
  if (input.activeIsInput) return 'active-is-input';
  if (input.triedThisBuild) return 'already-tried';
  return null;
}

// ---------------------------------------------------------------------------
// The caret test
// ---------------------------------------------------------------------------

/**
 * Is the caret in something a person types into?
 *
 * ★★ `contentEditable` IS CHECKED TOO, and it is not hypothetical: the chat
 *    composer and the notes editors are the surfaces fix-371 §4 was written
 *    about, and a rich-text field is not an `<input>`.
 *
 * ★★★ AND IT IS CHECKED TWICE, ON PURPOSE. `isContentEditable` is the right
 *     question — it is the COMPUTED answer, so it is true for a child of an
 *     editable region as well as for the region itself. But **jsdom does not
 *     implement it**: it is `undefined` there, measured, which would have made
 *     this branch permanently false in every test that will ever be written
 *     about it. The `closest()` fallback asks the DOM the same question in a way
 *     both agree on, inheritance included, and `:not([contenteditable="false"])`
 *     keeps an explicitly non-editable island out.
 *
 * ★ A `readOnly` or `disabled` field does not count — nothing can be typed into
 *   one, so treating it as unsaved work would block the reload on a screen that
 *   is purely being read.
 */
export function activeElementIsInput(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  if (el.closest?.('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  const field = el as HTMLInputElement;
  if (field.readOnly === true || field.disabled === true) return false;
  return true;
}
