// ===========================================================================
// ★★★ fix-588 §2a (P-288) — A SAVE THAT CHANGED NOTHING MUST NOT SAY IT SAVED
// ===========================================================================
//
// THE REPORT: Bobby added the **HVL** tag to 403 W Dravus in Project Details,
// pressed Save, and was told *"Project details saved."* The tag is not in the
// row. `projects.updated_at` bumped and `audit_log` has **no row for that
// moment** — the trigger only skips the insert when nothing differed.
//
// ★★★ THE INSTRUMENT RAN FIRST AND THE CLIENT IS INNOCENT AT EVERY HOP. The
//     select carries `value={t}` and is matched by identity; `commit` does not
//     short-circuit; the draft entry survives; `projectPatch` reaches the
//     mutation as `{"project_tags":["ECA","HVL"]}`. **Hop 5 discards it:**
//     `bp_update_project_with_permits` applies its patch through an explicit
//     27-column `CASE WHEN v_patch ? 'col'` list and `project_tags` is not in
//     it — nor are `closing_date`, `num_lots` or `is_corner_lot`. The UPDATE
//     still runs (`v_patch <> '{}'`), every column falls to its `ELSE` and
//     writes itself to itself, and the save reports success.
//     `migrations/fix_588_atomic_save_drops_four_columns_PENDING_APPROVAL.sql`
//     adds the four.
//
// ---------------------------------------------------------------------------
// ★★★ SO WHY A CLIENT-SIDE AUDIT AT ALL, IF THE SERVER FIX IS WRITTEN?
// ---------------------------------------------------------------------------
//
// Because the migration closes THIS drop and nothing closes the NEXT one.
// fix-410 already wrote down that a new `projects` column is a four-place job
// and that three of the four fail silently; this is the third time that shape
// has cost somebody an edit. **The column list on the server and the columns
// the modal can send are two lists nobody compares** — and when they disagree
// the app says "saved".
//
// ★★★ THE RULE, AND THE REASON IT IS THIS NARROW:
//
//       dropped  ⇔  we asked for a value
//                   AND the stored value is not it
//                   AND the stored value is exactly what was there before
//
//     The third clause is what stops this being a nuisance. A column the
//     server legitimately NORMALISES (a date reformatted, a number rounded, a
//     trigger deriving `dm` from `da`) comes back different from what we sent
//     **and** different from what was there — that is a write that landed, not
//     a write that vanished, and it stays quiet. Only the exact signature of
//     the fix-588 defect — *the row is byte-for-byte what it was* — speaks.
//
// ⚠️ IT IS DELIBERATELY NOT "the patch was empty". §2 of the brief rules that
//    out in as many words: *"Do NOT implement this as a toast that fires on
//    every empty patch — an unchanged form saving cleanly is normal."* An empty
//    patch never reaches here; a patch we cannot verify (no read-back) is
//    silent too, because **"I could not check" is not "it failed"**.
//
// ★ PURE, AND KNOWS NOTHING ABOUT REACT OR SUPABASE, so the failure can be
//   CONSTRUCTED in a test — which is the only way to prove the person is told,
//   per the brief's *"construct the failure and assert the person is told"*.

import { projectValuesEqual } from '../hooks/useProjectFieldCommit';

/**
 * Are these two stored values the same fact?
 *
 * ★ `undefined` and `null` are one value here — an absent key in a PostgREST
 *   row and a NULL column are the same thing, and only one of them survives a
 *   round-trip. Everything else defers to {@link projectValuesEqual}, which is
 *   already the modal's definition of "did this column change?" (order-
 *   sensitive for arrays, on purpose — see the note on that function).
 */
export function savedValuesEqual(a: unknown, b: unknown): boolean {
  return projectValuesEqual(a ?? null, b ?? null);
}

/**
 * The columns we asked to write that the row does not have and never lost.
 *
 * @param sent   the patch put on the wire (`projectPatch`)
 * @param before the row as it was when the save started
 * @param after  the row read back afterwards, or `null` when it could not be
 *               read — in which case **nothing is reported**, because an
 *               unverifiable save is not a failed one.
 */
export function droppedPatchKeys(
  sent: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!after) return [];
  const dropped: string[] = [];
  for (const key of Object.keys(sent)) {
    // ★ A column the read-back did not return tells us nothing. Skipping is
    //   the same ruling as `after == null`, one column at a time.
    if (!(key in after)) continue;
    const want = sent[key];
    const got = after[key];
    if (savedValuesEqual(got, want)) continue;
    if (!savedValuesEqual(got, before[key])) continue;
    dropped.push(key);
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// ★★ NAMING THE COLUMN THE WAY THE PERSON READING KNOWS IT
// ---------------------------------------------------------------------------
//
// The same rule `useProjectFieldCommit`'s `label` follows for OCC toasts — "GO
// date", not "go_date". A save writes many columns at once so the label cannot
// come from the commit call, and this map is the modal's project columns; the
// fallback humanises anything not listed rather than leaving a person to read
// `is_corner_lot` out of a toast.
const FIELD_LABELS: Record<string, string> = {
  acq_lead: 'Acquisitions',
  address: 'Address',
  alley: 'Alley',
  archived: 'Archived',
  builder_address: 'Builder address',
  builder_company: 'Builder company',
  builder_email: 'Builder email',
  builder_name: 'Builder',
  builder_phone: 'Builder phone',
  closing_date: 'Closing date',
  construction_admin: 'Construction Admin',
  design_manager: 'Design Manager',
  entitlement_lead: 'Permitting Lead',
  go_date: 'GO date',
  is_backfill: 'Backfilled project',
  is_corner_lot: 'Corner Lot',
  is_regular_shape: 'Regular shape',
  juris: 'Jurisdiction',
  lot_depth: 'Lot depth',
  lot_size_sf: 'Lot size (sf)',
  lot_width: 'Lot width',
  notes: 'Notes',
  num_lots: 'Number of Lots',
  parking_stalls: 'Parking stalls',
  parking_type: 'Parking type',
  poc_email: 'Contact Email',
  poc_name: 'Point of Contact',
  product_types: 'Types',
  project_tags: 'Project Tags',
  units: 'Unit count',
  zone: 'Zone',
};

/** "project_tags" → "Project Tags"; an unlisted column → "Num lots". */
export function fieldLabel(column: string): string {
  const known = FIELD_LABELS[column];
  if (known) return known;
  const words = column.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What to tell the person, or `null` when there is nothing to tell them.
 *
 * ★★★ IT SAYS WHAT LANDED AS WELL AS WHAT DID NOT. A save that writes six
 *     columns and drops one is not a failed save, and telling somebody
 *     "couldn't save" about it would send them back to re-type five fields
 *     that are already in the database. The edit is kept in the draft, so the
 *     sentence can be true in both halves: this did not save, and it is still
 *     on screen.
 */
export function droppedPatchMessage(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  const names = dropped.map(fieldLabel);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} did not save — the server did not store the change. Your edit is still here; everything else saved.`;
}
