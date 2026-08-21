// ===========================================================================
// fix-380 — a permit's own address finds nothing (structure-address search)
// ===========================================================================
//
// Bobby: "Sometimes the project gets an address, but then the individual
// building permits might get a separate address. Maybe I don't know the
// project by the project address, but I know it by the structure address.
// Just another way for us to search."
//
// ★★★ THE KEY SEMANTIC: a structure address finds the PROJECT. On every
// project-level surface, a project matches when ANY of its permits'
// struct_address matches — not only when its own address does. Permit-level
// surfaces match on their own permit's struct_address directly.
//
// Measured on prod 2026-08-21: 70 of 588 permits carry a struct_address and
// 67 differ from their project's address — a genuine second handle. 518 have
// none, so null-safety is the common case, not the edge.
//
// ★ ONE CONCEPT, ONE TERM (fix-364 applied to code): every surface that adds
// struct_address to its haystack goes through this helper rather than
// hand-rolling the null-trim-join. The token matching itself stays whatever
// each surface already does (multiMatchAddress, or a local tokenizer) —
// this only contributes the TEXT, so case/whitespace behave exactly like the
// existing address search on that surface.

/** The struct_address text a set of permits contributes to a search
 *  haystack: every non-empty, trimmed struct_address, space-joined.
 *  Null/undefined permits lists and null struct_address values contribute
 *  nothing — and never match the empty string, because empty strings are
 *  dropped rather than joined. */
export function structAddressHaystack(
  permits:
    | readonly { struct_address?: string | null }[]
    | null
    | undefined,
): string {
  if (!permits || permits.length === 0) return '';
  const parts: string[] = [];
  for (const p of permits) {
    const s = (p.struct_address ?? '').trim();
    if (s !== '') parts.push(s);
  }
  return parts.join(' ');
}
