import { isParkingKind } from './database.types';
import type { UnitType } from './database.types';

// fix-81: shared "next Type X" computation for unit-types editors. The
// wizard's UnitTypesEditor and the Project Overview's UnitDimensions both
// auto-name newly-added rows; both call this. Deletes vacate letters
// (deleting "Type B" then re-adding lands "Type B" again) so the user's
// mental ordering stays stable. Freeform renames (e.g. "Cottage 1") are
// invisible to this function — they don't match the /^Type [A-Z]+$/
// pattern so they don't consume a letter.

/** Find the lowest unused single A-Z letter; if all 26 are taken, fall
 * back to Excel-style two-letter overflow (AA, AB, …, AZ, BA, …, ZZ).
 * Inputs that don't match the "Type X" pattern (renamed rows, blanks)
 * are ignored. */
export function nextUnitTypeLabel(existingLabels: readonly string[]): string {
  const used = new Set<string>();
  for (const l of existingLabels) {
    const m = /^Type ([A-Z]+)$/.exec(l);
    if (m) used.add(m[1]);
  }
  // Single-letter pool A-Z.
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    if (!used.has(letter)) return `Type ${letter}`;
  }
  // Two-letter overflow AA → ZZ.
  for (let i = 65; i <= 90; i++) {
    for (let j = 65; j <= 90; j++) {
      const pair = String.fromCharCode(i) + String.fromCharCode(j);
      if (!used.has(pair)) return `Type ${pair}`;
    }
  }
  // Beyond 26 + 676 = 702 distinct types is unreachable in practice;
  // hand back a generic blank-friendly fallback rather than throwing.
  return 'Type';
}

// ===========================================================================
// ★★★ fix-449 §C (P-077) — AN OFF-LIST LABEL IS SHOWN, NOT SWALLOWED
// ===========================================================================
//
// fix-205 → fix-209 → fix-212 → fix-449. What this function decided before:
//   • exactly ONE product type → that type IS the label, AUTHORITATIVELY —
//     a blank AND a custom value like "Type A" both resolved to the type.
//   • TWO or more → product-type-ONLY: anything not an exact product type,
//     custom values included, resolved to '' ("unpicked").
//   • ZERO → freeform, preserved.
//
// ★★★ SO A STORED LABEL THIS APP DID NOT RECOGNISE WAS EITHER BLANKED OR
// OVERWRITTEN ON SCREEN. Measured on prod 2026-08-29, 22 of 235 unit rows carry
// one: "Type A" ×5, "Type B" ×5, "SFR + Attached Units" ×4, "SFR w/ Accessory
// Units" ×4, "Type C" ×2, "Accessory Unit" ×1, "Type D" ×1. On a two-type
// project they rendered as "Pick type…"; on a one-type project they rendered as
// that type. Either way the person could not see what was actually stored, and
// the next click on that select wrote the substitute over the original.
//
// ★★★ THAT IS EXACTLY WHAT fix-415'S RULE FORBIDS — *"a value dropped from a
// registry must be SHOWN AS RETIRED / off-list, never silently vanish or be
// rewritten"* — and Bobby ruled it again for this field: the off-list labels
// render as stored, marked, and he decides separately what "Type A–D" should
// become. They read like per-project unit NAMES, not product types, and that is
// a ruling, not a mapping for a migration to guess.
//
// ★★ fix-212'S USEFUL HALF SURVIVES, AND IT IS THE ONLY HALF THAT WAS ABOUT
// ABSENCE: a BLANK label on a single-product-type project still reads as that
// type. Nothing is being displaced there — units are distinguished by
// W/D/Stories, so filling an empty label from the project's one type tells the
// truth. What stops is substituting for a value somebody actually stored.
//
//   • blank + exactly ONE type  → that type (fix-212, unchanged)
//   • blank + any other count   → ''
//   • ANY stored value          → itself, verbatim
export function resolveUnitLabel(
  label: string | null | undefined,
  productTypes: readonly string[] | null | undefined,
): string {
  const trimmed = (label ?? '').trim();
  const types = (productTypes ?? []).filter((t) => typeof t === 'string' && t.trim());
  // ★ The absence case — the only one where this function may supply a value.
  if (trimmed === '') return types.length === 1 ? types[0]! : '';
  // ★★★ Otherwise the STORED VALUE WINS, whether or not it is a product type.
  //     Callers ask `isOffListUnitLabel` and mark it; none of them rewrite it.
  return trimmed;
}

/**
 * ★★★ Is this label something the product-type registry does not offer?
 *
 * The mark's single source. A surface shows the value and this decides whether
 * it wears "not in list" beside it — the same shape as `isRetiredZone`
 * (fix-415) and for the same reason: a person seeing an odd value deserves to
 * know the app finds it odd too, rather than wondering whether they misread it.
 *
 * ★ A BLANK IS NOT OFF-LIST. "Nothing recorded" is not a wrong answer, and
 *   marking it would put a warning on every unit nobody has typed a label for.
 */
export function isOffListUnitLabel(
  label: string | null | undefined,
  productTypeOptions: readonly string[] | null | undefined,
): boolean {
  const trimmed = (label ?? '').trim();
  if (trimmed === '') return false;
  const opts = (productTypeOptions ?? []).filter(
    (t) => typeof t === 'string' && t.trim() !== '',
  );
  // ★ With no registry loaded yet nothing can be judged off-list — an empty
  //   options array means "not known", not "everything is wrong".
  if (opts.length === 0) return false;
  return !opts.includes(trimmed);
}

/**
 * ★★★ The canonical product-type registry, read from an app_config map.
 *
 * ★★ IT TAKES THE MAP AND DOES ITS OWN READ — deliberately NOT importing
 * `readAppConfigStringArray` from `hooks/useAppConfig`. zoneOptions' header
 * records why: dozens of suites mock that module PARTIALLY, so a lib importing
 * a second export from it fails them all with *"No readAppConfigStringArray
 * export is defined on the mock"*. Caught here again, the same way.
 */
export function productTypeRegistry(
  configMap: Map<string, unknown> | null | undefined,
): string[] {
  const raw = configMap?.get('productTypeOptions');
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/** ★ The choices a unit-label picker offers: the registry, plus the stored
 *  value when it is off-list so the control can display what it holds
 *  (fix-415's append rule). `OTHER_UNIT_LABEL` is the deliberate way to add a
 *  new one — §C1's *"an off-list label is a deliberate act"*. */
export const OTHER_UNIT_LABEL = '__other__';

export function unitLabelOptions(
  productTypeOptions: readonly string[] | null | undefined,
  current?: string | null,
): string[] {
  const opts = (productTypeOptions ?? []).filter(
    (t) => typeof t === 'string' && t.trim() !== '',
  );
  const value = (current ?? '').trim();
  if (value && !opts.includes(value)) return [...opts, value];
  return [...opts];
}

// fix-22 → fix-206: canonical parse of the projects.unit_types JSONB array into
// the typed UnitType[] shape. Supports both v1's {w,d} keys and the new
// {width_ft,depth_ft} the editors write; defaults qty to 1 and stories to null.
// Shared by the Project Overview editor (ProjectDetailHeader) and the Library
// matrix (buildLibraryRows) so both surfaces read + write the identical shape —
// the whole point of fix-206 (one store, two editable views).
export function parseUnitTypes(raw: unknown): UnitType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .map((u) => ({
      label: typeof u.label === 'string' ? u.label : '',
      width_ft:
        typeof u.width_ft === 'number'
          ? u.width_ft
          : typeof u.w === 'number'
            ? u.w
            : null,
      depth_ft:
        typeof u.depth_ft === 'number'
          ? u.depth_ft
          : typeof u.d === 'number'
            ? u.d
            : null,
      qty: typeof u.qty === 'number' && u.qty > 0 ? u.qty : 1,
      stories: typeof u.stories === 'number' && u.stories > 0 ? u.stories : null,
      // ★★★ fix-402: the three unit-parking fields, read NULL-SAFELY.
      //
      // ★★ EVERY ONE OF THESE COERCES TO null, NEVER TO A DEFAULT. An absent
      // key, a wrong type, or a value outside the closed set all read as "not
      // recorded" — which is what they are. The temptations to resist, all
      // three of them fix-386's rule:
      //   parking_kind  → NOT 'none'   ("nobody said" ≠ "no parking")
      //   parking_stalls→ NOT 0        (0 is a recorded zero)
      //   roof_deck     → NOT false    (false is a recorded no)
      //
      // ★ parking_stalls admits 0 deliberately (>= 0, unlike qty/stories which
      // require > 0): a unit with a recorded zero stalls is a real answer.
      parking_kind: isParkingKind(u.parking_kind) ? u.parking_kind : null,
      parking_stalls:
        typeof u.parking_stalls === 'number' &&
        Number.isFinite(u.parking_stalls) &&
        u.parking_stalls >= 0
          ? u.parking_stalls
          : null,
      roof_deck: typeof u.roof_deck === 'boolean' ? u.roof_deck : null,
      // ★★★ fix-488 §B (P-150) — `size_sf`, THE UNIT'S TYPED FLOOR AREA.
      //
      // ★★★ THERE IS NO `width_ft * depth_ft` FALLBACK HERE AND THERE MUST NOT
      //     BE ONE. That product is a FOOTPRINT (square feet of ground); this
      //     is a FLOOR AREA across `stories`. A two-storey 20×40 unit covers
      //     800 sf and has ~1,600 sf of floor, so a fallback would answer
      //     "show me my 1,700 sf units" with the wrong rows and no way to tell.
      //     Bobby ruled it out in the sentence that asked for the field:
      //     *"It won't be W×D = unit size, but something we actually type in."*
      //
      // ★ `> 0`, like `qty` and `stories` and unlike `parking_stalls`: a
      //   zero-square-foot unit is not a recorded zero, it is a typo.
      size_sf:
        typeof u.size_sf === 'number' && Number.isFinite(u.size_sf) && u.size_sf > 0
          ? u.size_sf
          : null,
      // ★★★ fix-486 §D — `work_scope` IS NO LONGER NAMED HERE, AND THAT IS
      //     WHAT DELETES IT FROM EVERY ROW.
      //
      // fix-412's note is worth keeping because the mechanism is unchanged and
      // load-bearing in both directions: this function is a WHITELIST that
      // rebuilds each unit key by key, and both editors write the PARSED array
      // back. A key missing from this list is not merely invisible — it is
      // REMOVED from the row the first time anybody edits any other field on
      // it. That is exactly what is wanted now: the migration strips the key,
      // and this makes sure nothing puts it back.
    }));
}

// fix-206: normalize a unit_types array for persistence — resolve each row's
// "unnamed" label against the project's product types (blank + single type →
// that type). Shared by both editors so a save from the Library and a save from
// Project Overview produce byte-identical rows.
export function resolveUnitTypesForSave(
  rows: readonly UnitType[],
  productTypes: readonly string[] | null | undefined,
): UnitType[] {
  return rows.map((r) => ({ ...r, label: resolveUnitLabel(r.label, productTypes) }));
}
