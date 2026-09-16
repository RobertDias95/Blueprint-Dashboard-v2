import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182b: read one quarter's saved Draw Schedule column layout, ordered
// left-to-right by `position`. Used by the Settings editor only — the live
// grid does not read this yet (Phase C). Disabled until both a tenant and a
// quarter are known.

// ===========================================================================
// ★★★ fix-578 §A (P-284) — A QUARTER WITH NO LAYOUT INHERITS THE LAST ONE
// ===========================================================================
//
// Bobby, 2026-09-15: *"I am noticing that Jade is not populating on future
// quarters… **It should be taking our current draw schedule and replicating
// that every quarter unless we go in there and make a change for the
// future.**"*
//
// That last sentence was the requirement, and it was not implemented: rows
// existed for 2024-Q1 → 2026-Q4 and nothing created them, so the first quarter
// past the end fell back to deriving columns from `dm_da_groups` — which drops
// a manager whose DAs have all left (see §0 in the fix-578 suite).
//
// ---------------------------------------------------------------------------
// ★★★ WHY INHERIT ON READ RATHER THAN SEED ON FIRST VIEW
// ---------------------------------------------------------------------------
//
// The alternative was to WRITE the prior quarter's rows into the asked quarter
// the first time somebody opened it. Both satisfy the sentence; they differ in
// what happens afterwards, and that is what decided it.
//
// ★★★ A SEEDED ROW SET IS A SNAPSHOT, AND SNAPSHOTS GO STALE. Seeding 2027-Q3
//     the day somebody happens to open it freezes the team as it looked THAT
//     DAY. Hire a DA next month and 2027-Q3 still shows the old shape — and
//     nothing on screen says why, because those rows look exactly like a
//     deliberate layout somebody saved. **Inheriting on read has nothing to go
//     stale**: change the team today and every future quarter reflects it on
//     the next render, which is what *"replicating that every quarter"* asks
//     for.
//
// ★★ AND A READ MUST NOT WRITE. Seeding fires on a VIEW, so it needs write
//    permission merely to look — the Draw Schedule is admin-write and
//    view-only for most of the team (fix-220), so for them the seed would fail
//    silently and the quarter would stay broken. It would also fire from
//    whichever teammate opened it first, stamping their timestamp on a layout
//    they did not choose.
//
// ★ THE COST, STATED: "no layout" and "inherited layout" stop being
//   distinguishable from the rows alone. That is why this returns
//   `inheritedFrom` rather than just rows — the Settings editor has to say
//   which it is showing before it lets somebody reorder it.
//
// ---------------------------------------------------------------------------
// ★★ ONE QUERY, NOT TWO, AND THE SAME ONE FOR BOTH CASES
// ---------------------------------------------------------------------------
//
// Asking for `quarter <= asked` ordered by quarter DESC puts the newest
// qualifying quarter's rows FIRST — and if the asked quarter has rows of its
// own, it IS the newest qualifying quarter. So the saved case and the
// inherited case are the same fetch, and which one happened is read off
// `rows[0].quarter`.
//
// ★ Quarter strings are `YYYY-Qn`, which sorts lexically in true chronological
//   order for every quarter this app can express (the selector floors at
//   2023-Q1 and `Q1…Q4` are single digits). That is what makes `lte` + a text
//   sort correct rather than merely convenient.

/**
 * How many rows to pull when hunting backwards for a donor quarter.
 *
 * ★★ The donor is the FIRST run in a DESC-ordered result, so this only has to
 *    exceed one quarter's column count — not the table. Prod's widest layout
 *    is 12 columns (2026-Q1); 64 leaves room for a team four times that size
 *    before the run could be clipped.
 *
 * ⚠️ IF IT EVER WERE CLIPPED the failure is visible rather than silent: the
 *    inherited quarter would render with missing right-hand columns, not with
 *    wrong ones. Stated because a cap that fails quietly is worse than no cap.
 */
export const LAYOUT_LOOKBACK_ROW_CAP = 64;

export interface QuarterLayoutResult {
  /** The layout to render, saved or inherited. */
  rows: DrawScheduleQuarterLayoutRow[];
  /**
   * ★★★ The quarter these rows were actually SAVED for, when it is not the one
   *     that was asked for — `null` when the asked quarter has its own layout
   *     (or when there is none to inherit).
   *
   * ★ A caller that only renders can ignore this. A caller that lets somebody
   *   EDIT must not: reordering an inherited layout writes a new layout for the
   *   asked quarter, and the person should know that before they drag.
   */
  inheritedFrom: string | null;
}

export function useQuarterLayout(quarter: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<DrawScheduleQuarterLayoutRow[]>({
    queryKey: queryKeys.drawScheduleQuarterLayout(tenantId ?? '', quarter ?? ''),
    enabled: !!tenantId && !!quarter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draw_schedule_quarter_layout')
        .select(
          // fix-190c: include top_label (fix-190b added the column + render but
          // the select omitted it, so the editor/grid never received it).
          'id, quarter, position, col_kind, da_name, group_label, label_override, top_label, updated_at',
        )
        // ★ fix-578 §A: `lte`, not `eq` — see the header. The asked quarter
        //   wins when it has rows, because it sorts first.
        .lte('quarter', quarter as string)
        .order('quarter', { ascending: false })
        .order('position', { ascending: true })
        .limit(LAYOUT_LOOKBACK_ROW_CAP);
      if (error) throw error;
      return (data ?? []) as DrawScheduleQuarterLayoutRow[];
    },
  });

  const all = q.data ?? [];
  // ★ The leading run: every row belonging to the newest quarter at or before
  //   the one asked for. Anything after it is an older quarter and is dropped.
  const donor = all.length > 0 ? all[0].quarter : null;
  const rows = donor === null ? [] : all.filter((r) => r.quarter === donor);

  return {
    ...q,
    rows,
    inheritedFrom: donor !== null && donor !== quarter ? donor : null,
  };
}
