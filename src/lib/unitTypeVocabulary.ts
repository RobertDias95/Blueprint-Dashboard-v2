// ===========================================================================
// ★★★ fix-486 (P-143) — THE FIVE UNIT TYPES, AND HOW THE OLD ONES BECAME THEM
// ===========================================================================
//
// Bobby, 2026-09-02/03: *"attached, detached, ADU, DADU, and then remodel. We
// can easily take whatever we have and map it to these types, then update our
// settings."* And on the rule: *"a cottage is detached, an SFR is detached, a
// duplex (or triplex or ^plex) is attached."*
//
// ---------------------------------------------------------------------------
// ★★★ THE REGISTRY IS STILL DATA. THIS FILE IS NOT THE REGISTRY.
// ---------------------------------------------------------------------------
// `app_config.productTypeOptions` remains the single source every picker reads
// (fix-232), and Settings → Lists & Catalogs remains the only writer. What lives
// here is the pair of things that are RULES rather than a catalogue:
//
//   · `UNIT_TYPE_MAPPING` — how the old vocabulary became the new one. A
//     migration ran it once; it is kept because a rule nobody can read is a
//     rule nobody can check, and the migration test asserts against THIS.
//   · `WIZARD_PLACEHOLDER_LABELS` — the "Type A/B/C…" strings the wizard mints,
//     which were never types at all.
//
// ★★ SO THERE IS NO HARD-CODED LIST OF THE FIVE. Adding a sixth type stays a
//    Settings edit, exactly as adding a zone does (fix-415). A constant here
//    naming the five would be a second answer to "what types exist", and the
//    first ticket to disagree with it would be the one that added one.

/**
 * ★★★ THE MAP, WITH BOBBY'S REASON PER ROW. Keys are compared trimmed and
 * case-insensitively (`mapUnitType` below) — prod holds only the exact strings,
 * but a hand-typed "duplex" is the same building.
 *
 *   SFR, Cottages, SFR w/ Accessory Units  → Detached
 *   Duplex, Condo, SFR + Attached Units    → Attached
 *   ADU, DADU, Remodel                     → unchanged
 *
 * ★ `SFR w/ Accessory Units` maps to Detached and NOTHING ELSE. The accessory
 *   unit is its own row if the team wants one; inventing a second unit row from
 *   a label would be manufacturing data nobody entered.
 *
 * ★★ `SFR+ADU` IS NOT HERE, because it maps to two different things depending
 *    on WHERE it sits — see `mapProjectProductType` and `mapUnitLabel`.
 */
export const UNIT_TYPE_MAPPING: Readonly<Record<string, string>> = {
  sfr: 'Detached',
  cottages: 'Detached',
  'sfr w/ accessory units': 'Detached',
  duplex: 'Attached',
  condo: 'Attached',
  'sfr + attached units': 'Attached',
  adu: 'ADU',
  dadu: 'DADU',
  remodel: 'Remodel',
  // The five map to themselves, so a re-run is a no-op.
  detached: 'Detached',
  attached: 'Attached',
};

/** The one value whose answer depends on which column it is in. */
export const SPLIT_LABEL = 'SFR+ADU';

/** ★ The wizard's seed letters (`nextUnitTypeLabel`) — `Type A`, `Type B`, …
 *  including the two-letter overflow. These are PLACEHOLDERS: the intake habit
 *  is to add rows first and name them later, so they are not a vocabulary that
 *  needs mapping, they are a question that was never answered. */
export function isWizardPlaceholderLabel(label: string | null | undefined): boolean {
  return /^\s*Type(\s+[A-Z]{1,2})?\s*$/.test(label ?? '');
}

/** ★ Named for the report and the migration fixture; the predicate above is
 *  what the app uses, because the wizard can mint past D. */
export const WIZARD_PLACEHOLDER_LABELS: readonly string[] = [
  'Type A',
  'Type B',
  'Type C',
  'Type D',
];

/** The new value for an old one, or `null` when no rule covers it.
 *
 *  ★★★ `null` MEANS "REPORT IT", NEVER "GUESS". The brief's rule and the whole
 *  reason this returns a nullable: eleven prod rows are wizard placeholders and
 *  they keep their labels, marked as needing a type. A mapping that fell back to
 *  Detached would have silently declared eleven unanswered rows answered. */
export function mapUnitType(old: string | null | undefined): string | null {
  const key = (old ?? '').trim().toLowerCase();
  if (key === '') return null;
  return UNIT_TYPE_MAPPING[key] ?? null;
}

/**
 * ★★★ `SFR+ADU` ON A **PROJECT** BECOMES TWO VALUES — `Detached` AND `ADU`.
 *
 * `projects.product_types` is a LIST of what the project contains, so a project
 * that is both is both. 30 prod projects carry it.
 *
 * ★ Everything else maps one-to-one. The caller dedupes: `[SFR, Cottages]` is
 *   one Detached, not two.
 */
export function mapProjectProductType(old: string | null | undefined): string[] {
  const key = (old ?? '').trim().toLowerCase();
  if (key === SPLIT_LABEL.toLowerCase()) return ['Detached', 'ADU'];
  const mapped = mapUnitType(old);
  return mapped ? [mapped] : [];
}

/**
 * ★★★ `SFR+ADU` ON A **UNIT ROW** BECOMES `Detached` ALONE.
 *
 * One row is one unit. A unit row cannot be two types, and splitting it would
 * invent a second row with the first one's dimensions — which would be a
 * fabricated unit, not a migration. 6 prod rows on 5 projects; they are named in
 * the fix-486 report.
 *
 * ★ Returns `null` for anything unmapped (the wizard placeholders), which is
 *   the signal to LEAVE THE LABEL and mark it.
 */
export function mapUnitLabel(old: string | null | undefined): string | null {
  const key = (old ?? '').trim().toLowerCase();
  if (key === SPLIT_LABEL.toLowerCase()) return 'Detached';
  return mapUnitType(old);
}

/** Map a whole `product_types` list: every value mapped, then deduped, order of
 *  first appearance preserved. */
export function mapProductTypeList(
  old: readonly string[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const v of old ?? []) {
    for (const m of mapProjectProductType(v)) {
      if (!out.includes(m)) out.push(m);
    }
  }
  return out;
}

/**
 * ★★ Does this unit row still need somebody to say what it is?
 *
 * True for the wizard's placeholders — a label that was never a type. NOT true
 * for an off-list label somebody deliberately typed: that is a different state
 * with a different mark, and conflating them would tell a person who chose a
 * word that they had failed to answer a question.
 *
 * ★ A BLANK IS NOT THIS EITHER. `resolveUnitLabel` already resolves an empty
 *   label against the project's single product type; "nothing recorded" is
 *   handled there and marking it here would double up.
 */
export function unitLabelNeedsType(label: string | null | undefined): boolean {
  return isWizardPlaceholderLabel(label);
}
