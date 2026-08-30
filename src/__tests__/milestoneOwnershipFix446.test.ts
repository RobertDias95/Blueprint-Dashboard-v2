import { describe, it, expect } from 'vitest';
import {
  makeLegsFor,
  milestoneReach,
  type MilestoneReachContext,
} from '../lib/milestoneOwnership';

// ===========================================================================
// ★★★ fix-446 — WHO A MILESTONE REACHES, AND HOW
// ===========================================================================
//
// Bobby, 2026-08-29: *"on My Tasks a design-leg milestone reaches the DA and
// the DM (DM derived from the DA via dm_da_groups, exactly as tasks do). NOT
// the schematic designer."* And, amending ruling 3: a row that arrives only
// through the DM derivation is CO-ASSIGNED.

// Trevor is the DA; Derry is the DM paired with Trevor; Miles is the ENT lead;
// Sam is the project's schematic designer and must never reach a milestone.
const DM_BY_DA: Record<string, string> = { trevor: 'Derry' };
const dmForDa = (da: string) => DM_BY_DA[da.trim().toLowerCase()] ?? null;

const ctxFor = (name: string | null, everyone = false): MilestoneReachContext => ({
  name,
  dmForDa,
  everyone,
});

const permit = { da: 'Trevor', ent_lead: 'Miles' };

describe('fix-446: milestoneReach', () => {
  it('★★★ the DA reaches a design-leg milestone DIRECTLY', () => {
    expect(milestoneReach(permit, 'design', ctxFor('Trevor'))).toBe('direct');
  });

  it('★★★ the DM reaches it as CO-ASSIGNED, through dm_da_groups', () => {
    // ★ This is the widening, and the whole reason the feature is not inert:
    //   measured on prod 2026-08-29 the Board's literal rule gave Brittani,
    //   Derry and Lindsay — all design managers — ZERO milestone rows each.
    expect(milestoneReach(permit, 'design', ctxFor('Derry'))).toBe('co');
  });

  it('★★★ the SCHEMATIC DESIGNER reaches it not at all', () => {
    // Explicitly ruled out. It resolves co-assignees on TASKS (lib/taskTeam)
    // but has no standing on a permit's relay legs.
    expect(milestoneReach(permit, 'design', ctxFor('Sam'))).toBe('none');
  });

  it('★★ the ENT LEAD does not reach the DESIGN leg', () => {
    expect(milestoneReach(permit, 'design', ctxFor('Miles'))).toBe('none');
  });

  it('★★ …and the reverse: the ent leg is the ENT lead, directly, and nobody else', () => {
    expect(milestoneReach(permit, 'entitlement', ctxFor('Miles'))).toBe('direct');
    expect(milestoneReach(permit, 'entitlement', ctxFor('Trevor'))).toBe('none');
    // ★ The DM derivation is DESIGN-side only. A DM has no claim on the
    //   entitlement leg just because their DA is on the permit.
    expect(milestoneReach(permit, 'entitlement', ctxFor('Derry'))).toBe('none');
  });

  it('★★ a person who is BOTH the DA and its DM reads as DIRECT', () => {
    // Same precedence as fix-445's partition: if you own it, you own it.
    const selfManaged = { da: 'Solo', ent_lead: 'Miles' };
    const ctx: MilestoneReachContext = {
      name: 'Solo',
      dmForDa: () => 'Solo',
      everyone: false,
    };
    expect(milestoneReach(selfManaged, 'design', ctx)).toBe('direct');
  });

  it('★ nobody reaches anything without a name', () => {
    expect(milestoneReach(permit, 'design', ctxFor(null))).toBe('none');
    expect(milestoneReach(permit, 'entitlement', ctxFor('   '))).toBe('none');
  });

  it('★ a permit with no DA raises no design reach, even for a DM', () => {
    const noDa = { da: null, ent_lead: 'Miles' };
    expect(milestoneReach(noDa, 'design', ctxFor('Derry'))).toBe('none');
  });

  it('★★ under EVERYONE every leg reaches, and reads as direct', () => {
    // The scope is not defined by ownership, so "shared with you" has no
    // meaning in it — and a CO-ASSIGNED mark there would be a lie.
    const ctx = ctxFor('Nobody At All', true);
    expect(milestoneReach(permit, 'design', ctx)).toBe('direct');
    expect(milestoneReach(permit, 'entitlement', ctx)).toBe('direct');
  });
});

describe('fix-446: makeLegsFor', () => {
  it('★★ the DA walks design only; the ENT lead entitlement only', () => {
    expect(makeLegsFor(ctxFor('Trevor'))(permit)).toEqual(['design']);
    expect(makeLegsFor(ctxFor('Miles'))(permit)).toEqual(['entitlement']);
  });

  it('★★ the DM walks the DESIGN leg — which is what makes their rows exist', () => {
    expect(makeLegsFor(ctxFor('Derry'))(permit)).toEqual(['design']);
  });

  it('★★ somebody on both legs walks both, in the Board’s order', () => {
    const both = { da: 'Ash', ent_lead: 'Ash' };
    expect(makeLegsFor(ctxFor('Ash'))(both)).toEqual(['design', 'entitlement']);
  });

  it('★ a stranger walks nothing, which skips the permit entirely', () => {
    expect(makeLegsFor(ctxFor('Sam'))(permit)).toEqual([]);
  });

  it('★★ under EVERYONE both legs are always walked', () => {
    // relayStateFor still drops the legs a permit does not have — a one-leg
    // permit raises no design row — so this widens the WALK, not the truth.
    expect(makeLegsFor(ctxFor(null, true))(permit)).toEqual([
      'design',
      'entitlement',
    ]);
  });
});
