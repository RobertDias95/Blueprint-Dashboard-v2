// fix-309 #53 — the Schematic window, derived and display-only.
//
// ★ DECIDED: nothing is stored, there is no migration and no backfill. Schematic
// runs the four weeks that lead into DD, so it recomputes whenever DD start
// moves, and four weeks is a generic window rather than a per-project value.
//
// Lives in lib rather than beside the component because a component module may
// export ONLY components (react-refresh/only-export-components — the same rule
// fix-303 hit when TaskDetailEditor was lifted).

export const SCHEMATIC_LEAD_DAYS = 28;

/** The schematic window that runs into `ddStart`, or null when there is no DD
 *  start to work back from.
 *
 *  ★ Null in, null out — never a date computed from nothing. A window printed
 *  from a missing DD start would look authoritative and mean nothing, which is
 *  the missing-vs-absent failure this codebase keeps hitting. */
export function schematicWindow(
  ddStart: string | null | undefined,
): { start: string; end: string } | null {
  const iso = (ddStart ?? '').trim();
  if (!iso) return null;
  // Noon UTC so a DST boundary can never roll the date back a day.
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - SCHEMATIC_LEAD_DAYS);
  return { start: d.toISOString().slice(0, 10), end: iso };
}
