// ===========================================================================
// ★★★ fix-587 §1b (P-287) — WHICH BUILD IS THIS BROWSER RUNNING?
// ===========================================================================
//
// THE REPORT: Bobby and Brittani, same screen, same filters, both on
// **Everyone** — 332 open against 65, 185 projects against 20.
//
// ★★★ THE SERVER WAS PROVEN INNOCENT AND SO WAS EVERY FILTER STAGE.
//     `bp_list_tasks()` called as each login returns **1,847 rows for both**
//     (impersonated on prod, rolled back), and every stage between the RPC and
//     the counter behaves correctly under `'all'` — see the census in
//     `EveryoneMeansEveryoneFix587.test.ts`.
//
// ★★★ WHAT ACTUALLY DIFFERED WAS THE BUNDLE. Brittani's toolbar was missing
//     **Co-assigned**, **Unclaimed** and **+ Task with no permit**. Those are
//     not filters — they are components, and they shipped on:
//
//       fix-445  Co-assigned              2026-08-29
//       fix-458  Unclaimed                2026-08-30
//       fix-460  + Task with no permit    2026-08-30
//
//     A client missing all three is running code from **before 2026-08-29** —
//     about three weeks stale on the day of the report, and therefore also
//     older than fix-428's scope defaults and fix-583's widened predicate.
//     A three-week-old bundle does not share this one's idea of "Everyone".
//
// ---------------------------------------------------------------------------
// ★★★ AND NOTHING IN THE APP COULD SAY SO. THAT IS THE FINDING.
// ---------------------------------------------------------------------------
//
// Before this file: `package.json` read `0.0.0`, there was no Vite `define`, no
// About panel, and no build field on any `error_reports` row. **A stale client
// was invisible to the person, to a support conversation, and to the error
// table alike.** So the first hypothesis was a data bug and the second was an
// RLS bug — both wrong, both expensive — and the thing that actually settled it
// was counting controls in a screenshot.
//
// ★★ THIS IS fix-579'S MOVE, APPLIED ONE LAYER OUT. That ticket shipped the
//    instrument instead of a fifth guess about an OCC refusal; this one ships
//    the instrument instead of a second guess about which code someone is
//    running. The question *"what does your Settings page say under Build?"*
//    now costs one message.
//
// ⚠️ IT IS NOT A CACHE-BUSTER AND DOES NOT RELOAD ANYBODY. Deciding when to
//    force a refresh is a separate ruling with real costs (work in progress,
//    open dialogs); this only makes the fact legible. Naming that boundary
//    rather than quietly widening the ticket.

declare const __BUILD_SHA__: string;
declare const __BUILT_AT__: string;

/** The short commit this bundle was built from, or `'unknown'` where git was
 *  not available at build time (a fresh clone, a container). */
export const BUILD_SHA: string =
  typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';

/** ISO timestamp of the build. ★ The one a person can compare to "today"
 *  without knowing what a commit is — which is the whole point on a support
 *  call. */
export const BUILT_AT: string =
  typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

/**
 * One short string for a report, a log line or a person to read aloud.
 *
 * ★ Deliberately terse and deliberately NOT parsed anywhere: it identifies a
 *   build, it does not encode policy. Nothing branches on it.
 */
export function buildStamp(): string {
  const day = BUILT_AT ? BUILT_AT.slice(0, 10) : 'unknown';
  return `${BUILD_SHA} · ${day}`;
}

/** How stale this bundle is, in whole days, or `null` when the build time is
 *  unknown. ★ Reported, never enforced — see the note above about not
 *  reloading anybody. */
export function buildAgeDays(now: Date = new Date()): number | null {
  if (!BUILT_AT) return null;
  const built = Date.parse(BUILT_AT);
  if (Number.isNaN(built)) return null;
  return Math.floor((now.getTime() - built) / 86_400_000);
}
