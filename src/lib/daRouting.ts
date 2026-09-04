import type { DaTeamRoutingRow } from '../hooks/useDaTeamRouting';

// ★★★ fix-457 (P-007) — the pure half of the DA Routing editor.
//
// Grouping and gap-finding live here rather than in the panel so they can be
// tested without a DOM and without a QueryClient, the same way dmCoAssign holds
// the dm_da_groups equivalents.

/** One DA's rules: the default (jurisdiction NULL) and any overrides. */
export interface DaRoutingGroup {
  da: string;
  /** The rule that applies wherever no specific one does. Null when this DA has
   *  only jurisdiction-specific rules — a real and slightly alarming state,
   *  which is why the panel labels it rather than hiding it. */
  default: DaTeamRoutingRow | null;
  /** Jurisdiction-specific rules, alphabetical. */
  overrides: DaTeamRoutingRow[];
}

/**
 * ★★★ GROUPED SO THAT MOST-SPECIFIC-WINS IS LEGIBLE FROM THE LAYOUT (§A2).
 *
 * `bp_ent_lead_for_da` resolves with:
 *
 *     WHERE da = p_da
 *       AND (jurisdiction = p_juris OR jurisdiction IS NULL)
 *     ORDER BY (jurisdiction IS NULL) ASC   -- non-NULL (specific) juris first
 *     LIMIT 1;
 *
 * — a specific row beats the default. So the default is rendered first, as the
 * heading of the group, and the overrides sit indented beneath it as the
 * exceptions they are. The shape of the list IS the precedence rule; nobody has
 * to be told it separately.
 */
export function groupRoutingByDa(
  rows: readonly DaTeamRoutingRow[],
): DaRoutingGroup[] {
  const byDa = new Map<string, DaRoutingGroup>();
  for (const r of rows) {
    const da = (r.da ?? '').trim();
    if (da === '') continue;
    let g = byDa.get(da);
    if (!g) {
      g = { da, default: null, overrides: [] };
      byDa.set(da, g);
    }
    if (r.jurisdiction === null || (r.jurisdiction ?? '').trim() === '') {
      // ★ If two defaults somehow exist, keep the FIRST and let the second show
      //   up as what it is. The RPC refuses to create one (the unique
      //   constraint cannot, because NULL != NULL in Postgres), but this
      //   function must not crash on data that predates the guard.
      if (g.default === null) g.default = r;
      else g.overrides.push(r);
    } else {
      g.overrides.push(r);
    }
  }
  for (const g of byDa.values()) {
    g.overrides.sort((a, b) =>
      (a.jurisdiction ?? '').localeCompare(b.jurisdiction ?? ''),
    );
  }
  return [...byDa.values()].sort((a, b) => a.da.localeCompare(b.da));
}

/**
 * ★★★ §A5 — THE GAP THE TABLE CANNOT SHOW.
 *
 * An active DA with no row at all is invisible in a list of rows. It is also
 * not harmless, and the harm is NOT the one the brief expected:
 *
 * ★★★ THERE IS NO "DEFAULTS TO MILES" RULE. `bp_ent_lead_for_da` returns NULL
 * for an unrouted DA, and `bp_cascade_ent_lead_for_project` carries
 * `AND public.bp_ent_lead_for_da(p.da, pr.juris) IS NOT NULL` — so the cascade
 * SKIPS that permit and `ent_lead` stays NULL. Every DA appearing to route to
 * Miles is fix-72's SEED data, not a fallback. Measured 2026-08-30.
 *
 * What actually happens to an unrouted DA:
 *   1. the ENT cascade never fills their permits' `ent_lead`, and
 *   2. the wizard ASKS for the lead instead of deriving one.
 *
 * ★★★ POINT 2 CHANGED IN fix-497 (P-157), AND THE OLD TEXT IS WORTH KEEPING AS
 * THE RECORD: it read *"Step1ProjectInfo renders them as a DISABLED option…
 * they cannot be picked as lead DA on a new project at all."* That was true
 * and it was the reason two real people could not be picked.
 *
 * Bobby, 2026-09-04, on Cam and Shire: *"they arent really mapped to people…
 * shire and cam work on generally all projects… they float between all three
 * of us."* Prod agreed — Cam's 27 open permits are led Miles 15 / Briana 12.
 * **A missing routing row is now a legitimate state**, meaning "no default
 * lead; ask on each project", and the wizard's ENT dropdown does the asking
 * (`PermitAssignmentRow`, plus a submit gate so a floater's permit cannot be
 * created leaderless).
 *
 * ★★ POINT 1 IS UNCHANGED AND WAS ALWAYS RIGHT: there is still no "defaults to
 * Miles" rule anywhere. The cascade skips NULL, which is exactly what makes
 * deleting a floater's row safe.
 *
 * Matched trimmed + case-folded, exactly like `unmappedActiveDas`, so a roster
 * name differing only in spacing is not reported as a gap it is not.
 */
export function unroutedActiveDas(
  activeDaNames: readonly string[],
  rows: readonly DaTeamRoutingRow[],
): string[] {
  const routed = new Set(
    rows
      .map((r) => (r.da ?? '').trim().toLowerCase())
      .filter((k) => k !== ''),
  );
  return activeDaNames.filter((n) => {
    const key = (n ?? '').trim().toLowerCase();
    return key !== '' && !routed.has(key);
  });
}

/**
 * The sentence a delete confirm shows. Kept here, beside the reasoning above,
 * because it is a factual claim about what the database will do and it must not
 * drift from `unroutedActiveDas`' comment.
 *
 * ★★ IT DELIBERATELY DOES NOT SAY "falls back to Miles" — see above. Saying so
 * would be inventing behaviour the functions do not implement, which is exactly
 * what STEP 0c forbids.
 */
export function removeRuleConsequence(
  da: string,
  jurisdiction: string | null,
  group: DaRoutingGroup | undefined,
): string {
  if (jurisdiction !== null && (jurisdiction ?? '').trim() !== '') {
    const fallback = group?.default?.ent_lead;
    return fallback
      ? `${da} will fall back to their default rule (${fallback}) in ${jurisdiction}.`
      : `${da} will have no routed lead in ${jurisdiction}, and no default rule to fall back to.`;
  }
  const remaining = group?.overrides.length ?? 0;
  const scope =
    remaining > 0
      ? `outside their ${remaining} jurisdiction rule${remaining === 1 ? '' : 's'}`
      : 'anywhere';
  return (
    `${da} will have no routed entitlement lead ${scope}. ` +
    'The ENT cascade will leave their permits’ lead unset, and ' +
    `${da} cannot be picked as lead DA on a new project until a rule exists.`
  );
}
