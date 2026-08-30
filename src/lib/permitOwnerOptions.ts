// ===========================================================================
// ★★★ fix-449 §B (P-077) — PERMIT OWNER BECOMES A REGISTRY
// ===========================================================================
//
// Bobby's rule, 2026-08-27/28: *"is the set of valid answers fixed? → list;
// genuinely open → free text; notes stay free text."* Permit owner names which
// side of the house owns a permit — Entitlements, Architecture, or Split. Three
// answers, and no fourth arrives without somebody deciding it should.
//
// ★★★ THIS IS fix-415'S SHAPE, TO THE LETTER, AND THAT IS WHY IT NEEDS NO
// MIGRATION. The zone registry seeds ITS canonical list CLIENT-SIDE: when the
// `app_config` key has never been written, `zoneOptions()` returns the shipped
// constant, so a fresh tenant gets a working dropdown and the first admin edit
// is what creates the row. Nothing is inserted server-side, so there is nothing
// to apply.
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED FIRST, AND IT CHANGED WHAT THIS FILE IS FOR
// ---------------------------------------------------------------------------
//
// Prod 2026-08-29: `permits.permit_owner` is NULL on 493 rows, "Entitlements"
// on 68, "Split" on 64, "Architecture" on 26.
//
// ★★★ AND THERE IS NO WRITE SURFACE ANYWHERE IN THE APP. Not the quick-edit
// modal, not PermitDetailV2, not the wizard — grep finds three readers and
// zero writers:
//   · PermitCard.tsx:54   `lead = ent_lead || permit_owner` — a DERIVATION
//   · reportMetrics.ts    search haystack
//   · Dashboard.tsx       search haystack
//
// So the 158 values arrived with the import and nothing in the app can change
// them. This registry therefore does the half that is useful today — it names
// the vocabulary, and the Settings editor counts the permits carrying each
// value including the off-list ones — and is ready for whichever surface grows
// an editor. It does NOT invent a write surface: that is a design call about a
// field nothing currently displays as itself.

const PERMIT_OWNER_KEY = 'permitOwnerOptions';

/** ★ The three values prod actually holds, in the order Bobby named them. The
 *  seeded default, and the fallback when the key has never been written. */
export const CANONICAL_PERMIT_OWNERS = [
  'Entitlements',
  'Architecture',
  'Split',
] as const;

function stringArray(configMap: Map<string, unknown>, key: string): string[] {
  const raw = configMap.get(key);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * The options a picker should offer.
 *
 * ★★ `current` is appended when it is not in the list — fix-415's rule, and
 * the reason a retired value never vanishes from the control that holds it. A
 * dropdown that silently drops the value it is displaying is a dropdown that
 * rewrites data the moment somebody touches the row next to it.
 */
export function permitOwnerOptions(
  configMap: Map<string, unknown>,
  current?: string | null,
): string[] {
  const configured = stringArray(configMap, PERMIT_OWNER_KEY);
  const base = configured.length > 0 ? configured : [...CANONICAL_PERMIT_OWNERS];
  const value = (current ?? '').trim();
  if (value && !base.includes(value)) return [...base, value];
  return base;
}

/** ★ Is this stored value still one an admin offers? Lets a surface MARK a
 *  retired owner so a person can see why it reads oddly — without taking it
 *  away from them. */
export function isRetiredPermitOwner(
  configMap: Map<string, unknown>,
  value: string | null | undefined,
): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  const configured = stringArray(configMap, PERMIT_OWNER_KEY);
  const base = configured.length > 0 ? configured : [...CANONICAL_PERMIT_OWNERS];
  return !base.includes(v);
}

export { PERMIT_OWNER_KEY };
