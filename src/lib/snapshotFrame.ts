// ===========================================================================
// ★★★ fix-568 (P-272) — THE SNAPSHOT LOOKS LIKE A SNAPSHOT, AND CLICKING IT
//     TAKES YOU TO THE CURRENT ONE
// ===========================================================================
//
// Bobby, 2026-09-14: *"what if the design plan of record, the project, the
// team, the permit section, all that was kind of grayed out? … then we can get
// rid of superseded and snapshot at the top right … and if you clicked anywhere
// on the screen versus clicking draw schedule, chat, or connect with a permit,
// it would take you to the current version."*
//
// ★★★ THE INSIGHT WORTH KEEPING: **the two chips were labels compensating for a
//     screen that never looked any different.** Change the appearance and they
//     stop earning their place — the same move fix-530 §A made when the legend
//     already carried colour→status and the block stopped repeating it.
//
// ---------------------------------------------------------------------------
// ★★★ §A — THE TREATMENT IS THE EXISTING ONE, AT A MEASURED VALUE
// ---------------------------------------------------------------------------
//
// The pattern to reuse is `SetButton`'s (PlanOfRecordCard): an **opacity on the
// wrapper** — `opacity: disabled ? 0.5 : 1` — which is how the Site Plan and
// Marketing buttons grey out when a set is absent. Same mechanism here, one
// wrapper, no second disabled style invented.
//
// ★★★ BUT 0.5 WOULD HAVE MADE IT UNREADABLE, AND THAT IS NOT A JUDGEMENT CALL —
//     it is arithmetic. `--color-text` #1a2540 on `--color-surface` #ffffff is
//     **15.19:1**. Composited at **0.5** it becomes #8c92a0 — **3.12:1 on
//     surface, 3.05:1 on --color-bg — BELOW the 4.5 threshold.** That is the
//     exact failure fix-564 measured (`--color-co` at 2.86:1) and had to switch
//     tokens for, and Bobby's own sentence rules it out: *"you could still read
//     the information."* A greyed card nobody can read replaces one problem
//     with a worse one.
//
// ★★★ MEASURED AT 0.65: #6a7183 → **4.88:1 on surface, 4.69:1 on
//     --color-bg**. Both clear 4.5. That is why this constant is 0.65 and not
//     the button's 0.5: **the button mutes a short bold label, this mutes body
//     text somebody has to read.** Same treatment, two measured values, one
//     module — which is fix-524 §A's rule (build the hatch once, parameterise
//     it) applied rather than a second style invented.
//
// ★★★ AND OPACITY ALONE WAS NOT ENOUGH. `--color-muted` (#5a6a85, the caption
//     ink) is 5.48:1 at full strength and only **2.70:1** at 0.65 — it would
//     have failed while the primary text passed, which is the worst outcome
//     because it looks fine. So inside this frame `--color-muted` and
//     `--color-dim` are remapped to `--color-text`: every token in the greyed
//     area then composites to the same 4.88:1. Two lines of CSS variables, no
//     component below has to know.
//
// ---------------------------------------------------------------------------
// ★★★ §C — THE CLICK HANDLER IS OPT-IN, AND THAT IS THE WHOLE TICKET
// ---------------------------------------------------------------------------
//
// ★★★ MEASURED, prod 2026-09-14: there are **18 superseded originals and ALL 18
//     have chat (68 messages), permits (60) AND plan-of-record sets (35).** So
//     every exemption below is load-bearing on **every single one** — there is
//     no original where the chat or the permits happen to be empty and a
//     swallowed click would go unnoticed.
//
// ★★★ SO IT IS WRITTEN AS "NAVIGATE ONLY IF THE CLICK CAME FROM NOTHING",
//     never as "navigate unless somebody remembered to stopPropagation".
//     The Overview has been rebuilt four times in a month (fix-506, 507, 556,
//     and this one); a handler that captures by default would silently swallow
//     the fifth rebuild's controls, and the failure would be a button that
//     navigates away instead of doing its job.
//
// ★★ `closest()` against the interactive selector is what makes it automatic:
//    a control added tomorrow is a `<button>` or an `<a>`, so it is exempt
//    before anybody thinks about this file. The named tests
//    (Chat · Draw schedule · Connect · a permit row · Site Plan · Marketing ·
//    the share icon) are there to prove the rule covers the ones that exist.
//
// ★★ AND A CLICK THAT LANDS ON A LINK DOES THE LINK'S JOB, NOT BOTH: this
//    handler simply returns, so the anchor's own default runs untouched.

/** ★★★ The measured opacity. See the contrast arithmetic above before changing
 *  it: 0.5 renders body text at 3.12:1 and fails. */
export const SNAPSHOT_MUTE_OPACITY = 0.65;

/** Contrast of every text token inside the frame, composited at
 *  {@link SNAPSHOT_MUTE_OPACITY}. Exported so the test asserts the NUMBER this
 *  file claims rather than re-deriving it — fix-450's rule: never let a comment
 *  be the only place a measurement lives. */
export const SNAPSHOT_CONTRAST = {
  onSurface: 4.88,
  onBackground: 4.69,
  /** What the SetButton's 0.5 would have produced, kept as the reason. */
  rejectedAtHalfOpacity: 3.12,
} as const;

/**
 * Everything a click may land on without navigating.
 *
 * ★★★ BY ROLE, NOT BY NAME. Listing `[data-testid="pd-chat-btn"]` and friends
 *     would be a list somebody has to remember to extend; every control in this
 *     app is already a button, an anchor, an input or carries a role, so this
 *     covers the ones that exist AND the ones that do not yet.
 * ★ `label` is here because clicking a label activates its control.
 */
export const SNAPSHOT_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[contenteditable="true"]',
  // ★ An explicit escape hatch for anything genuinely interactive that is none
  //   of the above — a drag surface, a canvas. Named so it is greppable.
  '[data-snapshot-live]',
].join(',');

/** Is this click one that should navigate to the current project? */
export function snapshotClickNavigates(
  target: Element | null,
  selectionText: string,
): boolean {
  if (!target) return false;
  // ★★ TEXT SELECTION IS NOT A CLICK. Dragging across a paragraph to copy a
  //    permit number ends in a click event on the card; navigating there would
  //    throw away the selection and the reason for it.
  if (selectionText.trim() !== '') return false;
  if (target.closest(SNAPSHOT_INTERACTIVE_SELECTOR)) return false;
  return true;
}
