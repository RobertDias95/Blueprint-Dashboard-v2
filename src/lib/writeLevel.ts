// ===========================================================================
// fix-538 (P-026, P-234) — the roster decides who may write. STAGE ONE.
// ===========================================================================
//
// Bobby, 2026-09-10: *"design managers can go into the project details and edit
// anything. The design associate can only edit projects they are part of, and
// then entitlement people can edit the project details."*
//
// ★★★ THE SERVER IS THE GATE. This module is the MIRROR of
//     `public.bp_write_caps`, and it exists so the browser can decide what to
//     RENDER — never whether a write is allowed. Every capability here is
//     enforced again in the RPC, first and unconditional, and a `42501` is the
//     answer that counts. fix-532's `may_edit_library` is the precedent: the
//     hook decides whether to show an input, the server decides everything.
//
// ⚠️ If this map and `bp_write_caps` ever disagree, the SERVER is right and
//    this is the bug. `RoleWriteLevelsFix538` asserts the two texts agree.

/** The capabilities stage one knows about. Stage two adds the row scope. */
export type WriteCap = 'project_details' | 'schematic_designer' | 'reassign_da';

/**
 * ★★★ THE ONE PLACE, mirrored from the migration.
 *
 * A roster role (`team_members.role`) grants capabilities. Roles not named here
 * grant nothing, which is how `da`, `viewer`, `acq`, `acq_lead` and `ca` stay
 * **unchanged in stage one** — they hold no capability rather than a flat one.
 *
 * ⚠️ A DA who can edit every project is worse than a DA who can edit none, so
 *    `da` is deliberately absent. Row scoping is stage two and belongs there.
 */
export const ROLE_WRITE_CAPS: Record<string, readonly WriteCap[]> = {
  dm: ['project_details', 'schematic_designer', 'reassign_da'],
  director: ['project_details', 'schematic_designer', 'reassign_da'],
  ent: ['project_details'],
  ent_lead: ['project_details'],
  schematic: ['schematic_designer'],
};

/**
 * Collapse a person's roster rows to one answer.
 *
 * ★★★ THE RULE IS UNION, AND IT HAD TO BE. §A.2 named Jade's three rows;
 *     measured on prod 2026-09-13, **eight of 37 accounts hold more than one** —
 *     Jade (`da+dm+schematic`), Dave (`director+schematic`), Derry and Lindsay
 *     (`dm+schematic`), Briana, Miles and Bobby (`ent+ent_lead`), and Lucas
 *     (`ent+viewer`).
 *
 * ⚠️ §A.6 asks for "two rows that disagree" to fail closed. Read as "two
 *    different strings", that denies all eight — every `ent_lead`, both of
 *    P-234's design managers, and Bobby himself. **The rows do not disagree:
 *    they are an additive list of what a person does.** So a row can only ADD,
 *    never subtract, and Lucas is the case that proves it — `ent + viewer` must
 *    be `ent`, because a `viewer` row beside a real one is a second listing and
 *    not a demotion.
 *
 * ★ The genuine fail-closed cases are the ones with nothing to union: no roster
 *   row, every row inactive, no session. All four return `[]` — proved on prod.
 */
export function capsForRoles(roles: readonly string[] | null | undefined): WriteCap[] {
  const out = new Set<WriteCap>();
  for (const role of roles ?? []) {
    for (const cap of ROLE_WRITE_CAPS[(role ?? '').trim()] ?? []) out.add(cap);
  }
  return [...out].sort();
}

/** Does this capability set include `cap`? Admin is handled by the CALLER. */
export function hasCap(
  caps: readonly WriteCap[] | null | undefined,
  cap: WriteCap,
): boolean {
  return (caps ?? []).includes(cap);
}

/**
 * ★★ The admin escape hatch, applied the way the server applies it.
 *
 * The RPCs read `is_tenant_admin(tenant) OR bp_may_…()`, so the browser must
 * read `isAdmin || hasCap(…)` — the same shape, in the same order. `admin 7 ·
 * editor 30` is not a role model, and stage one does not make it one: it leaves
 * `profiles.role` exactly as it is and adds the roster beside it.
 */
export function mayWrite(
  isAdmin: boolean,
  caps: readonly WriteCap[] | null | undefined,
  cap: WriteCap,
): boolean {
  return isAdmin || hasCap(caps, cap);
}
