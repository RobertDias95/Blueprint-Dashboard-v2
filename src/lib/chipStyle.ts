import type { CSSProperties } from 'react';

// ===========================================================================
// ★★★ fix-441 §D (P-091) — ONE chipStyle, AND THE FOUR WERE NOT IDENTICAL
// ===========================================================================
//
// Four files each declared `chipStyle(active)`: HoldFilter, ScopeToggle,
// MyTasks and ProjectList. The queue item called them "the same shape". Diffed
// before unifying, per the brief, and they are TWO implementations:
//
//   HoldFilter · ScopeToggle          MyTasks · ProjectList
//   ─────────────────────────────     ─────────────────────────────
//   inactive bg  --color-surface      inactive bg  --color-bg
//   active  ink  'white'              active  ink  '#fff'
//   returns CSSProperties             return type inferred
//
// ★★★ THE INACTIVE BACKGROUND IS A REAL DIFFERENCE, not a spelling one:
// `--color-surface` is #ffffff and `--color-bg` is #f0f4f8. Collapsing the four
// onto either value would restyle two of them — and D1's constraint is "no
// visual change", asserted by deep-equality against the four originals. So this
// takes the surface as an argument rather than picking a winner. The
// duplication that P-091 is about is the FUNCTION, and there is now one of it;
// the two tints stay because they are a real (if probably accidental) choice
// this ticket has no mandate to rule on.
//
// ★ 'white' vs '#fff' IS a spelling difference — the same colour, and jsdom
//   computes both to `rgb(255, 255, 255)`. Normalised to '#fff' (which two of
//   the four already used) and the test proves the computed colour is identical
//   at all four sites, not merely the string.
//
// ★★ NOT lib/libraryGroupPalette.chipStyle. That is a DIFFERENT function that
//    happens to share the name — it takes a palette and returns a chip's colours
//    from it, and has nothing to do with an active/inactive filter pill. It is
//    deliberately untouched; a rename would be churn on a working thing.

/** Which surface an inactive chip sits on. The two live answers, named. */
export type ChipSurface = 'surface' | 'bg';

const INACTIVE_BACKGROUND: Record<ChipSurface, string> = {
  // HoldFilter, ScopeToggle — chips on a card.
  surface: 'var(--color-surface)',
  // MyTasks, ProjectList — chips on the page ground.
  bg: 'var(--color-bg)',
};

/**
 * The filter-pill style. Active is the Design/Entitlements blue with white ink;
 * inactive is the named surface with a border and normal text.
 *
 * @param active   is this chip the selected one
 * @param surface  what an INACTIVE chip sits on — see the note above for why
 *                 this is a parameter and not a decision made here
 */
export function chipStyle(
  active: boolean,
  surface: ChipSurface = 'surface',
): CSSProperties {
  return {
    background: active ? 'var(--color-de)' : INACTIVE_BACKGROUND[surface],
    borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
    color: active ? '#fff' : 'var(--color-text)',
  };
}
