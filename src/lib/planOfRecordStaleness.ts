// ★ fix-358 §3: HOW OLD IS THE ANSWER?
//
// `computed_at` is when the indexer last WALKED the project — not when anything
// changed — and it only moves when Bobby runs it. A confident sentence from a
// stale walk is worse than no sentence, because it reads as current.
//
// ★ So the age is shown only when it is worth knowing. A fresh card says
// nothing about its age (that would be clutter on all 157 projects); once the
// walk is a week old the card says so, without a hover, in every state.
//
// ★★ This lives in lib/ rather than beside the component because a component
// module that also exports a function breaks fast refresh (the same rule
// fix-264 hit). It is a pure function of a timestamp, so it belongs here.
export const STALE_AFTER_DAYS = 7;

function daysSince(iso: string, now: number): number {
  const then = Date.parse(iso);
  // ★ An unparseable timestamp says NOTHING rather than guessing an age. A
  // wrong number here would be a confident claim about staleness, which is the
  // failure this section exists to prevent, inverted.
  if (Number.isNaN(then)) return 0;
  return Math.floor((now - then) / 86_400_000);
}

/** The line to print, or null when the walk is recent enough to say nothing. */
export function stalenessNote(computedAt: string, now = Date.now()): string | null {
  const days = daysSince(computedAt, now);
  if (days < STALE_AFTER_DAYS) return null;
  return `Last checked ${days} days ago — the folder may have changed since.`;
}
