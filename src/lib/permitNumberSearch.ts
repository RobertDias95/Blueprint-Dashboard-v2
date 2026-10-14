// ===========================================================================
// ★★★ fix-665 (P-348) — every search box finds a permit number
// ===========================================================================
//
// Bobby, 2026-10-13: *"miles noticed that the search queue doesnt work for
// permit numbers, can we include that?"* Four of the boxes that list projects,
// permits or tasks did not look at a permit number at all, and the ones that
// did matched it as raw text — so `2601495` missed Kirkland's `LSM26-01495`
// and `26108851` missed Bellevue's `26 108851 GD`.
//
// ★★★ ONE MATCHER. A permit number matches when the typed text — with case,
//     spaces and dashes ignored — is CONTAINED in any of the row's permit
//     numbers. A project or task row carries every permit number on its
//     project/permit; the caller decides which numbers those are.
//
// ★★ IT ADDS TO EACH BOX, IT DOES NOT REPLACE IT. Every box keeps its own
//    tokenizer and its AND / comma behaviour: a token now matches when it is in
//    the box's own haystack OR is part of a permit number. On top of that the
//    WHOLE query is tried as one permit number, so `7110427 CN` (two tokens,
//    and `cn` alone is not a permit number) still finds `7110427-CN`.
//
// ★★ A PERMIT-NUMBER MATCH NEEDS A DIGIT. Every permit number in prod has one
//    (measured 2026-10-13: 818 numbers, 8 cities). Without the rule, an address
//    word like `ne` or `st` would match through suffixes like `-NE`/`ST`, and a
//    search for `cn` would light up every Seattle construction permit.

/** A permit number (or typed text) with case, whitespace and dashes removed. */
export function permitNumberKey(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/[\s-]+/g, '');
}

/** ★★★ THE matcher: is `text` (case/space/dash-insensitive) contained in any of
 *  `nums`? Text without a digit never matches — see the header. */
export function matchesPermitNumber(
  text: string,
  nums: readonly (string | null | undefined)[],
): boolean {
  const key = permitNumberKey(text);
  if (key === '' || !/\d/.test(key)) return false;
  return nums.some((n) => permitNumberKey(n).includes(key));
}

/** A box's token-AND search with permit numbers added: the row matches when
 *  the whole query is a permit number on it, or when every token is either in
 *  the box's own `haystack` (already lower-cased by the caller, as today) or
 *  part of one of the row's permit numbers. */
export function tokensMatchWithPermitNumbers(
  query: string,
  tokens: readonly string[],
  haystack: string,
  nums: readonly (string | null | undefined)[],
): boolean {
  if (tokens.length === 0) return true;
  if (nums.length > 0 && matchesPermitNumber(query, nums)) return true;
  return tokens.every(
    (t) => haystack.includes(t) || (nums.length > 0 && matchesPermitNumber(t, nums)),
  );
}

/** Every non-empty permit number on a list of permits — the numbers a project
 *  row carries. Mirrors structAddressHaystack's null handling. */
export function permitNumbersOf(
  permits: readonly { num?: string | null }[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const p of permits ?? []) {
    const n = (p.num ?? '').trim();
    if (n !== '') out.push(n);
  }
  return out;
}

/** drawScheduleHelpers.multiMatchAddress's exact rule (space-separated tokens, all must
 *  hit, case-insensitive) with permit numbers added — for the boxes that use
 *  it: Projects list, Draw Schedule, Intake tracker. */
export function multiMatchAddressOrPermit(
  query: string,
  haystack: string,
  nums: readonly (string | null | undefined)[],
): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokensMatchWithPermitNumbers(query, tokens, haystack.toLowerCase(), nums);
}
