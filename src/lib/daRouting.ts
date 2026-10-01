// ★★★ fix-457 (P-007) — the pure half of the DA Routing editor.
//
// Grouping and gap-finding live here rather than in the panel so they can be
// tested without a DOM and without a QueryClient, the same way dmCoAssign holds
// the dm_da_groups equivalents.
//
// ===========================================================================
// ★★★ fix-617 (census gap 41) — THE ROUTING RULE LIVES HERE NOW, IN ONE COPY
// ===========================================================================
//
// `daHasRoutingFor` used to live in `hooks/useDaTeamRouting.ts` alongside the
// query, and the wizard imported it from there. That was one implementation
// already — the census row said the rule was "re-implemented client-side", and
// re-derived on main it is not: fix-497 had already consolidated the wizard and
// Step 3 onto this single function. **Two things were genuinely wrong, though:**
//
//   ★★ 1. "WHICH ROW IS THE DEFAULT" EXISTED IN TWO SHAPES THAT DISAGREED.
//      `daHasRoutingFor` tested `jurisdiction === null`; `groupRoutingByDa` and
//      `DaRoutingEditor`'s row both tested `=== null || trim() === ''`. So a row
//      with an EMPTY-STRING jurisdiction was a DEFAULT in Settings and NOT a
//      default in the wizard. `isDefaultRule` is now the one test, and it is
//      the SERVER'S (`jurisdiction IS NULL`) — see its own note for why the
//      laxer version was the wrong one to keep.
//
//   ★★★ 2. THE RULE SAT IN A MODULE TESTS FULLY MOCK. Six test files replace
//      `hooks/useDaTeamRouting` wholesale (`() => ({ useDaTeamRouting: ... })`,
//      no `...actual`), which makes every other export of that module
//      `undefined` inside the render. That is fix-415's trap, and a pure rule
//      living in a hook module is standing on it. `lib/daRouting.ts` is mocked
//      by nothing.
//
// ★ AND THE DEPENDENCY NOW POINTS ONE WAY. This file used to import the row
//   TYPE from the hook; the hook now imports it from here and re-exports it for
//   its eight existing readers. A type re-export is erased at build time, so it
//   costs those readers nothing.

/** fix-96-b: one da_team_routing row, in the shape the wizard's DA filter
 *  consumes. We only need the (da, jurisdiction) pair to decide selectability —
 *  ent_lead resolution still flows through the server's bp_ent_lead_for_da RPC
 *  (the SECURITY DEFINER ORDER BY is the source of truth for which row wins when
 *  both a juris-specific AND a NULL-juris row exist for the same DA).
 *
 *  ★ fix-617 moved this out of `hooks/useDaTeamRouting` so the pure rule below
 *    has no reason to reach into a hook module. The hook re-exports it. */
export interface DaTeamRoutingRow {
  da: string;
  jurisdiction: string | null;
  /** fix-306 #35: the entitlement lead this DA routes to. The wizard ignores
   *  it (it only needs the da/juris pair for selectability); My Board reads it
   *  to build an entitlement lead's team. Optional so the wizard's existing
   *  fixtures still typecheck. */
  ent_lead?: string | null;
  /** ★ fix-457: the row's identity and OCC token, for the Settings editor.
   *
   *  OPTIONAL for the same reason `ent_lead` is: eight readers and a pile of
   *  fixtures construct this shape by hand and none of them care which row a
   *  rule came from. Only DaRoutingEditor needs these, and it is the only
   *  caller that has to handle them being absent — which it does by refusing
   *  to offer an edit affordance for a row it cannot address. */
  id?: number;
  updated_at?: string;
}

/**
 * ★★★ fix-617 (gap 41) — IS THIS THE RULE THAT APPLIES WHEREVER NO SPECIFIC
 *     ONE DOES? One test, and it is the one the DATABASE applies.
 *
 * `bp_ent_lead_for_da` selects `WHERE jurisdiction = p_juris OR jurisdiction IS
 * NULL`. **NULL, and only NULL.** An empty-string jurisdiction matches neither
 * branch for any real jurisdiction, so the server treats such a row as applying
 * NOWHERE.
 *
 * ★★ SO THE LAXER CLIENT TEST WAS THE WRONG ONE TO KEEP, even though it looks
 *    like the forgiving choice. Calling `''` a default made Settings render that
 *    row as "applies everywhere" — a claim about behaviour the server does not
 *    implement, which is the specific kind of wrong fix-457's own header warns
 *    against ("it deliberately does not say falls back to Miles"). Under the one
 *    rule such a row shows up in `overrides`, labelled with the blank
 *    jurisdiction it actually has, which is the truth and is visibly odd.
 *
 * ★ Measured on prod 2026-10-01: 12 `da_team_routing` rows, 9 with a NULL
 *   jurisdiction and **0 with an empty-string one**. The two tests agreed on
 *   every row that exists — a latent disagreement, which is why it was a census
 *   gap and not an incident.
 */
export function isDefaultRule(
  row: Pick<DaTeamRoutingRow, 'jurisdiction'>,
): boolean {
  return row.jurisdiction === null;
}

/** fix-96-b: pure helper that mirrors bp_ent_lead_for_da's WHERE clause: a DA
 *  is routed for a juris when at least one row matches the juris specifically OR
 *  is the default (see `isDefaultRule`). DAs with no routing rows at all are NOT
 *  routed for any juris — that is the legitimate "floats between all three of
 *  us" state `unroutedActiveDas` documents below.
 *
 *  ★ fix-617 (gap 41): moved here from `hooks/useDaTeamRouting` and rebuilt on
 *    `isDefaultRule`, so the wizard's selectability gate and the Settings
 *    editor's "default vs override" layout cannot answer differently. */
export function daHasRoutingFor(
  da: string,
  juris: string | null,
  rows: readonly DaTeamRoutingRow[],
): boolean {
  for (const r of rows) {
    if (r.da !== da) continue;
    if (isDefaultRule(r) || r.jurisdiction === juris) return true;
  }
  return false;
}

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
    if (isDefaultRule(r)) {
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
