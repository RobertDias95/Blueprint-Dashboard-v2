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
