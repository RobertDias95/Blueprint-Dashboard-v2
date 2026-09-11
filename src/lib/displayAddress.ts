// ===========================================================================
// ★★★ fix-530 §C (P-245) — `[Redesign N]` COMES OFF THE SCREEN, NOT OUT OF THE
//     DATABASE
// ===========================================================================
//
// Bobby, 2026-09-11: *"the projects that say redesign on them, we want to get
// rid of that redesign because that is now the current project… get rid of the
// redesign concept completely on that."* Asked whether the stored address
// should change too: **"Hide it on screen, leave the data alone."**
//
// ★★★ AND THE DATA MUST NOT MOVE, WHICH IS NOT A PREFERENCE. **17 active
//     projects carry `[Redesign 1]` literally in `projects.address`** (measured
//     2026-09-11 — every one of them that exact form), and the address is the
//     KEY the indexer matches share folders on (fix-518b, P-168). Rewriting
//     them would risk the plan of record for exactly the 17 projects fix-524
//     just taught to read through to their original's drawings.
//
// ★★ ONE HELPER, USED BY EVERY SURFACE — not a regex per component. This Brain
//    has removed two-writers-of-one-rule three times (fix-264's cancelled
//    predicate, fix-519's unit columns, fix-522's three readers), and a strip
//    that lives in four components is four chances for one of them to keep the
//    suffix, or to strip a bracket that meant something else.

/**
 * The `[Redesign N]` suffix, and nothing else.
 *
 * ★ ANCHORED TO THE END and to the WORD. `[Redesign 1]` is the only form on
 *   prod, but the number is generated, so the digits are a range rather than a
 *   literal — and the anchor is what stops this eating a bracket that carries a
 *   different fact. An address reading `12 Main St [Lot 3]` keeps its bracket.
 *
 * ★★ The trailing `\s*` matters more than it looks: the stored form is
 *    `4000 SW Concord St [Redesign 1]` with a space before the bracket, and
 *    leaving that space behind produces `4000 SW Concord St ` — which is
 *    invisible until it is centred, and then it is not.
 */
const REDESIGN_SUFFIX = /\s*\[\s*redesign\s*\d*\s*\]\s*$/i;

/**
 * An address as a person should read it.
 *
 * ★★★ RENDER-ONLY. Nothing in this app may write the result back: the stored
 *     value is the indexer's join key. A caller that needs the real string —
 *     a search haystack, a folder match, an export — uses `project.address`
 *     directly and should say why.
 */
export function displayAddress(address: string | null | undefined): string {
  return (address ?? '').replace(REDESIGN_SUFFIX, '').trim();
}

/** True when this address carries the suffix. ★ Exported for the test that
 *  asserts the 17 still have it in the DATA while no surface prints it. */
export function hasRedesignSuffix(address: string | null | undefined): boolean {
  return REDESIGN_SUFFIX.test(address ?? '');
}
