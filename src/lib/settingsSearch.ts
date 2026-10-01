// ===========================================================================
// ★★★ fix-611 §D — A SEARCH THAT FINDS A SETTING BY WHAT IS *IN* IT
// ===========================================================================
//
// Bobby asked for *a search*, and the hint in the mock says what kind:
// *"Finds a setting by its name or anything in it: 'Kirkland', 'Gena', 'MHA',
// 'ULS'."*
//
// ★★★ WHICH IS THE WHOLE POINT, AND THE REASON A TITLE-ONLY SEARCH WOULD HAVE
//     BEEN WORSE THAN NONE. Nobody looking for Kirkland knows the block is
//     called "Jurisdictions" — if they did, they would have clicked it. The four
//     examples in the hint are all VALUES, and not one of them appears in any
//     block title. So values are matched, and the matched value is shown on the
//     result row: the answer to "where do I change this?" is "here, and here is
//     your thing in it".
//
// ★★ ONE QUERY WAS ADDED: `usePermitTypes()` on the Settings page. Everything
//    else the index needs was already being fetched by a block on one of these
//    categories — app_config (every pick list), jurisdictions, the roster, the
//    builder registry, the consultant directory. Permit types are fetched by
//    the Permits category only, so searching from My account had no list to
//    match "ULS" against until the page asked for it. It is the same React Query
//    key the Permits category uses, so arriving there afterwards is a cache hit.

import type { SettingsBlock } from './settingsBlocks';

/** The live values that belong to one block, so a hit can name what it found. */
export interface SettingsBlockValues {
  blockId: string;
  values: readonly string[];
}

export interface SettingsSearchHit {
  block: SettingsBlock;
  /** Where the match landed, so the row can explain itself. */
  via: 'title' | 'summary' | 'keyword' | 'value';
  /** The matched value, when `via` is 'value'. */
  value?: string;
}

/** ★ Below this we match nothing: one letter matches almost every block, which
 *  reads as "search is broken" rather than "keep typing". */
export const SETTINGS_SEARCH_MIN = 2;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Search the registry plus the live values.
 *
 * ★ Ordered by HOW the match happened, not by block order: a title hit is what
 *   you meant, a value hit is what you were looking for, and a keyword hit is a
 *   synonym somebody wrote down. Within a kind, registry order wins so the
 *   result list is stable between keystrokes.
 */
export function searchSettings(
  query: string,
  blocks: readonly SettingsBlock[],
  valuesByBlock: readonly SettingsBlockValues[] = [],
): SettingsSearchHit[] {
  const q = norm(query);
  if (q.length < SETTINGS_SEARCH_MIN) return [];

  const valueMap = new Map<string, readonly string[]>();
  for (const v of valuesByBlock) valueMap.set(v.blockId, v.values);

  const byTitle: SettingsSearchHit[] = [];
  const byValue: SettingsSearchHit[] = [];
  const bySummary: SettingsSearchHit[] = [];
  const byKeyword: SettingsSearchHit[] = [];

  for (const block of blocks) {
    if (norm(block.title).includes(q)) {
      byTitle.push({ block, via: 'title' });
      continue;
    }
    // ★ The first matching value is the one shown. A query matching twenty zones
    //   is one row saying "Zones · LR2", not twenty rows.
    const hit = (valueMap.get(block.id) ?? []).find((v) => norm(v).includes(q));
    if (hit !== undefined) {
      byValue.push({ block, via: 'value', value: hit });
      continue;
    }
    if (norm(block.summary).includes(q)) {
      bySummary.push({ block, via: 'summary' });
      continue;
    }
    if (norm(block.keywords).includes(q)) {
      byKeyword.push({ block, via: 'keyword' });
    }
  }

  return [...byTitle, ...byValue, ...bySummary, ...byKeyword];
}

/**
 * Split a string around the first case-insensitive match, for highlighting.
 *
 * ★ Returns the three pieces rather than HTML: the caller puts the middle one in
 *   a `<mark>`. Building markup here would mean escaping it there, and a search
 *   box is the one input where the text is guaranteed to be attacker-supplied.
 */
export function highlightParts(
  text: string,
  query: string,
): { before: string; match: string; after: string } {
  const q = norm(query);
  const i = q.length >= SETTINGS_SEARCH_MIN ? norm(text).indexOf(q) : -1;
  if (i < 0) return { before: text, match: '', after: '' };
  return {
    before: text.slice(0, i),
    match: text.slice(i, i + q.length),
    after: text.slice(i + q.length),
  };
}
