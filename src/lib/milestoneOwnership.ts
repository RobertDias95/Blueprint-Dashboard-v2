import type { BoardLeg } from './myBoard';

// ===========================================================================
// ★★★ fix-446 — WHOSE MILESTONE IS IT, AND IS IT MINE OR SHARED?
// ===========================================================================
//
// Bobby, 2026-08-29: *"on My Tasks a design-leg milestone reaches the DA and
// the DM (DM derived from the DA via dm_da_groups, exactly as tasks do). NOT
// the schematic designer. The Board's own reach is unchanged in this PR."*
// And, amending ruling 3: *"A milestone that reaches the viewer only through
// the DM derivation is 'co-assigned' … Use the same ownsDirectly /
// isCoAssigned partition shape so a DM's one switch governs both their DA's
// tasks and their DA's milestones."*
//
// ---------------------------------------------------------------------------
// ★★★ WHY THIS EXISTS AT ALL: THE BOARD REACHES NOBODY WHO MANAGES
// ---------------------------------------------------------------------------
//
// `myBoard.prepare()` decides legs by a LITERAL match — `permit.da` for the
// design leg, `permit.ent_lead` for entitlement. Measured on prod 2026-08-29,
// un-acked milestone rows the forecast holds under that rule:
//
//     Bobby     36   (all entitlement: fees 32, target_submit 4)
//     Miles     14   (all entitlement: fees 12, target_submit 2)
//     Trevor     1   (design: draw)
//     Brittani   0     Derry  0     Lindsay  0     Cam  0
//
// Three of those four zeroes are DESIGN MANAGERS. A milestone feature that
// mirrored the Board exactly would have shipped rows to three people and
// nothing to the ones the ruling names. Hence the widening — and hence it
// living on My Tasks only, because the Board is a snapshot of what needs you
// now (fix-444 ruling 1) and is entitled to be narrower.
//
// ---------------------------------------------------------------------------
// ★★ THE PARTITION IS fix-445'S, DELIBERATELY THE SAME SHAPE
// ---------------------------------------------------------------------------
//
// `ownsDirectly` / `isCoAssigned` over tasks answers "is this mine, or work I
// share?" and one switch hides the second kind. A DM's relationship to their
// DA's MILESTONES is the same relationship they have to that DA's TASKS —
// reached through the mapping, not named on the row — so it is the same
// question and must ride the same switch. Anything else would mean a DM turns
// co-assigned off and half their shared work stays.
//
// ★ EXHAUSTIVE AND DISJOINT, like its sibling: `reach()` returns exactly one
// of 'direct' | 'co' | 'none', so a row can never be both and never be
// silently dropped.

export type MilestoneReach = 'direct' | 'co' | 'none';

/** The permit fields the reach rules read. */
export interface MilestonePermitRoles {
  da: string | null;
  ent_lead: string | null;
}

export interface MilestoneReachContext {
  /** The viewer's roster name. */
  name: string | null;
  /** DA name (lowercased) → the DM paired with them in dm_da_groups. The SAME
   *  mapping `useTaskOwnership` resolves a task's DM through, so the two
   *  answers cannot drift. */
  dmForDa: (da: string) => string | null;
  /** True under the "Everyone" scope: every leg of every permit is in view and
   *  the mine/shared question does not arise. */
  everyone?: boolean;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * How does this leg of this permit reach the viewer?
 *
 *   design leg  · permit.da === me                    → 'direct'
 *               · dm_da_groups(permit.da) === me      → 'co'
 *   ent leg     · permit.ent_lead === me              → 'direct'
 *   otherwise                                          → 'none'
 *
 * ★ NOT the schematic designer, by explicit ruling. It resolves co-assignees
 *   on TASKS (lib/taskTeam) but has no standing on a permit's relay legs, and
 *   adding it here would have been the one widening nobody asked for.
 *
 * ★★ The DA is checked BEFORE the DM derivation, so a person who is both the
 *   DA and (through some mapping) their own DM reads as direct. Same
 *   precedence as fix-445: if you own it, you own it.
 */
export function milestoneReach(
  permit: MilestonePermitRoles,
  leg: BoardLeg,
  ctx: MilestoneReachContext,
): MilestoneReach {
  if (ctx.everyone) return 'direct';
  const me = norm(ctx.name);
  if (!me) return 'none';

  if (leg === 'entitlement') {
    return norm(permit.ent_lead) === me ? 'direct' : 'none';
  }

  const da = (permit.da ?? '').trim();
  if (norm(da) === me) return 'direct';
  // ★ The DM derivation — the widening, and the only one.
  if (da !== '' && norm(ctx.dmForDa(da)) === me) return 'co';
  return 'none';
}

/**
 * The leg resolver handed to `buildForecast` through `BoardInput.legsFor`.
 *
 * ★★★ THE EMISSION PATH IS UNCHANGED. This decides only WHICH LEGS to walk;
 * `relayStateFor`, `milestoneVerb`, the ack suppression and the bucketing all
 * run exactly as they do for the Board. One implementation, two reaches.
 *
 * ★ Under "Everyone" both legs are always walked, so the tenant's whole
 * un-acked milestone set surfaces — `relayStateFor` still drops the legs a
 * permit does not have (a one-leg permit raises no design row).
 */
export function makeLegsFor(
  ctx: MilestoneReachContext,
): (permit: MilestonePermitRoles) => BoardLeg[] {
  return (permit) => {
    const out: BoardLeg[] = [];
    if (milestoneReach(permit, 'design', ctx) !== 'none') out.push('design');
    if (milestoneReach(permit, 'entitlement', ctx) !== 'none') {
      out.push('entitlement');
    }
    return out;
  };
}
