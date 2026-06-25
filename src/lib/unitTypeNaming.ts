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

// fix-205 → fix-209: resolve a unit-type row's Label against the project's
// product types. The rule depends on how many product types the project carries:
//   • exactly ONE  → that type IS the label. A blank auto-fills to it; a custom
//     freeform label (e.g. "Type A") is preserved. (Bobby: a lone SFR's row
//     should say "SFR", not "unnamed".)
//   • TWO or more  → the Label is product-type-ONLY (fix-209). The value must be
//     one of the project's product types; anything else (blank, or a legacy/
//     custom value like "Type A" / "Ex. SFR") is "unpicked" and resolves to ''
//     — forcing the user to choose a real type. We deliberately do NOT carry a
//     custom value forward or auto-pick a type for them.
//   • ZERO         → freeform; the stored label is preserved.
export function resolveUnitLabel(
  label: string | null | undefined,
  productTypes: readonly string[] | null | undefined,
): string {
  const trimmed = (label ?? '').trim();
  const types = (productTypes ?? []).filter((t) => typeof t === 'string' && t.trim());
  if (types.length >= 2) {
    // Product-type-only: keep it only if it's an exact product type, else blank.
    return types.includes(trimmed) ? trimmed : '';
  }
  if (trimmed) return trimmed;
  return types.length === 1 ? types[0] : '';
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
