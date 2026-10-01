// ===========================================================================
// fix-605 (P-302 part 1) — ONE rule for a stored value the registry retired
// ===========================================================================
//
// fix-601 wrote this for unit types: a stored value that is no longer in the
// Settings registry still DISPLAYS (so a row never renders blank or gets
// silently re-labelled), but as a DISABLED option carrying a marker — a fact
// about that row, never a choice for another one. fix-605 gives the permit-type
// select the same treatment, so the rule is generalised here rather than copied;
// `unitTypeNaming`'s names are kept as aliases of these.
//
// Bobby: *"our drop downs need to match our settings and no free form text."*

/** ★ The suffix on an option that is stored but no longer in the registry. */
export const RETIRED_OPTION_MARKER = ' (not a current type)';

/** ★ Is this option a stored leftover rather than a current choice? The empty
 *  placeholder is never retired. */
export function optionIsRetired(
  option: string,
  registry: readonly string[] | null | undefined,
): boolean {
  if (!option.trim()) return false;
  return !(registry ?? []).includes(option);
}

/**
 * The label an option shows: itself, or itself + the marker when retired.
 *
 * ★★ fix-606: THE MARKER IS A PARAMETER, and the default is unchanged — every
 *    existing caller keeps the exact string fix-601 and fix-605 pinned. It is
 *    parameterised because the RULE generalises but the WORD does not: *"(not a
 *    current type)"* is right for a unit type and a permit type, and wrong for a
 *    consultant discipline, which is not a type of anything. Reusing the rule
 *    while saying the wrong word would have been a worse kind of sharing.
 */
export function retiredOptionLabel(
  option: string,
  registry: readonly string[] | null | undefined,
  marker: string = RETIRED_OPTION_MARKER,
): string {
  return optionIsRetired(option, registry) ? `${option}${marker}` : option;
}
