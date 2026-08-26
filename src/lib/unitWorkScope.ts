// ===========================================================================
// ★★★ fix-412 SCOPE B — DOES THIS REMODEL HAVE WORK IN IT?
// ===========================================================================
//
// Bobby, 2026-08-26: *"a two-way toggle with a third, default state: No work /
// Work performed / not yet answered, because at intake the scope is often
// unknown and needs to be identifiable later."*
//
// ---------------------------------------------------------------------------
// ★★★ THREE STATES, AND A STRING RATHER THAN A NULLABLE BOOLEAN
// ---------------------------------------------------------------------------
//
// The brief's rule is "three states, not a boolean — a boolean would default
// 234 existing units to an answer nobody gave". A `boolean | null` would in
// fact hold three states (this is what `roof_deck` does), so the choice needed
// a reason of its own. Two:
//
//   · IT IS SELF-DESCRIBING WHERE IT IS STORED. These values live in a JSONB
//     blob a person will read in psql while chasing exactly this question.
//     `"work_scope": "none"` says what it means; `"work_scope": false` says
//     false-of-what, and the answer is only in this file.
//   · A THIRD REAL ANSWER IS PLAUSIBLE. "Partial" is one meeting away, and a
//     boolean cannot grow one without a migration of every stored value.
//
// ★★ NULL / ABSENT IS "NOT YET ANSWERED" AND IS THE WHOLE POINT. All 234 unit
// objects on prod today lack this key, so every one of them reads as
// unanswered — which is true. Bobby's own reason for the third state is that
// *"at intake the scope is often unknown and needs to be identifiable later"*:
// a field that cannot say "nobody has looked" hides the units somebody needs to
// chase, which is the failure this exists to avoid.
//
// ★ It is not a REMODEL-only column in the data. The key can sit on any unit;
// what is remodel-specific is that the UI only ASKS on a Remodel, because for
// an SFR the question has no meaning. Keeping the data shape general means a
// future product type that also needs the question needs no new key.

/** The two answers a person can give. Absent/null is the third state and is
 *  deliberately NOT a member — "not answered" is the absence of a value, not a
 *  value, and making it one would let it be written as if it were an answer. */
export const WORK_SCOPES = ['none', 'performed'] as const;

export type WorkScope = (typeof WORK_SCOPES)[number];

/** What each state is called on screen. */
export const WORK_SCOPE_LABEL: Record<WorkScope, string> = {
  none: 'No work',
  performed: 'Work performed',
};

/** ★ The short forms, for the unit row's narrow cell. The long forms are the
 *  filter's, where there is room and where an unqualified "None" would not say
 *  none-of-what. */
export const WORK_SCOPE_SHORT: Record<WorkScope, string> = {
  none: 'None',
  performed: 'Yes',
};

/** The glyph a not-answered unit renders, shared with fix-402's NOT_RECORDED so
 *  every unrecorded unit field looks the same. */
export const WORK_SCOPE_UNANSWERED = '—';

/** Coerce a stored value. Anything that is not one of the two answers reads as
 *  NOT ANSWERED — a hand-edited blob, a value from a build that shipped a third
 *  option, a `false` left by an earlier shape. Never throws, never guesses. */
export function asWorkScope(raw: unknown): WorkScope | null {
  return raw === 'none' || raw === 'performed' ? raw : null;
}

/** ★★★ Is this unit CONFIRMED to have no work in it?
 *
 *  ★ `true` only for an explicit 'none'. A unit nobody has answered for is not
 *  a no-work unit — it is an unknown one, and every caller below turns on that
 *  distinction. */
export function isNoWorkUnit(
  unit: { work_scope?: WorkScope | null } | null | undefined,
): boolean {
  return asWorkScope(unit?.work_scope) === 'none';
}

// ---------------------------------------------------------------------------
// ★★★ THE LIBRARY FILTER (Scope B4)
// ---------------------------------------------------------------------------
//
// Bobby's rule has two halves that pull in opposite directions, and both are
// implemented here rather than at the call site so they cannot be applied
// separately:
//
//   · *"A confirmed No-work remodel drops out of the Library set by default"* —
//     the unit exists on the site, it just has no drawn detail worth filtering
//     on. Searching for "3-storey, garage, roof deck" should not surface a
//     gutted shell that has none of those because nothing was drawn.
//   · *"A not-yet-answered remodel is NOT silently excluded"* — or the field
//     hides exactly the units somebody needs to chase.
//
// ★★ SO THE DEFAULT IS NOT "SHOW EVERYTHING". `''` (Any) means *every unit
// except a confirmed no-work one*, and the only way to see those is to ask for
// them by name. A hidden default exclusion is normally a bug; it is correct
// here **because it is askable** — 'none' is one of the filter's own options,
// so nothing becomes unreachable, which is the property that makes a default
// exclusion honest rather than a trap.
//
// ★ MEASURED: 0 of 234 unit objects carry this key today, so on the day this
// ships the default exclusion removes NOTHING. It starts mattering the first
// time somebody answers "No work", which is the first time it should.

/** '' = Any (excludes confirmed no-work) · a scope = only that · 'unanswered'
 *  = only the units nobody has answered for. */
export type WorkScopeFilter = '' | WorkScope | 'unanswered';

export const WORK_SCOPE_FILTERS: readonly WorkScopeFilter[] = [
  '',
  'performed',
  'none',
  'unanswered',
];

/**
 * Does this unit pass the work-scope filter?
 *
 * ★ The `''` arm is the one carrying Bobby's default ruling; the other three
 * are exact-match and are how a no-work or unanswered unit stays findable.
 */
export function matchWorkScope(
  raw: unknown,
  filter: WorkScopeFilter,
): boolean {
  const scope = asWorkScope(raw);
  if (filter === '') return scope !== 'none';
  if (filter === 'unanswered') return scope === null;
  return scope === filter;
}
