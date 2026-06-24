import { describe, it, expect } from 'vitest';

// fix-199: pure-TS MIRROR of the bidirectional Seattle-intake sync SQL
// (migrations/fix_199_intake_sync.sql). CI has no live DB, so this encodes the
// trigger + reverse-sync DECISION RULES as a regression contract; the SQL itself
// was verified against prod with a rolled-back BEGIN…ROLLBACK probe (see the PR).
//
//   permits.intake_date -> intake_records  : bp_sync_intake_record_from_permit()
//   intake_records -> permits              : bp_upsert_intake_records_row reverse sync
//
// The loop guard is value-equality on BOTH sides, so the trigger and the RPC
// can't ping-pong.

type Slot = {
  permit_id: number | null;
  intake_date: string | null;
  is_placeholder: boolean;
} | null;

type Permit = {
  type: string;
  juris: string;
  intake_date: string | null;
};

type SlotAction =
  | { kind: 'noop' }
  | { kind: 'delete' }
  | { kind: 'update'; date: string }
  | { kind: 'insert'; date: string };

/** Mirror of the AFTER INSERT/UPDATE trigger bp_sync_intake_record_from_permit. */
function syncSlotFromPermit(permit: Permit, slot: Slot): SlotAction {
  // Gate: Seattle Building Permit / Demolition only.
  if (permit.type !== 'Building Permit' && permit.type !== 'Demolition') {
    return { kind: 'noop' };
  }
  if (permit.juris !== 'Seattle') return { kind: 'noop' };
  // CLEAR: permit date removed -> drop its real-permit slot.
  if (permit.intake_date === null) {
    return slot ? { kind: 'delete' } : { kind: 'noop' };
  }
  // LOOP GUARD: slot already equals the permit's date -> nothing to do.
  if (slot && slot.intake_date === permit.intake_date) return { kind: 'noop' };
  if (slot) return { kind: 'update', date: permit.intake_date };
  return { kind: 'insert', date: permit.intake_date };
}

/** Mirror of the reverse sync inside bp_upsert_intake_records_row. */
function reverseSyncPermit(
  slot: NonNullable<Slot>,
  permit: Permit,
): { write: boolean; date?: string } {
  // Only a REAL-permit slot with a NON-NULL date drives the permit; a null slot
  // date is never pushed (preserves the valid "real slot, date TBD" state) and
  // never clears the permit here — clearing happens only from the permit side.
  if (slot.permit_id == null || slot.is_placeholder || slot.intake_date == null) {
    return { write: false };
  }
  // Value guard.
  if (permit.intake_date === slot.intake_date) return { write: false };
  return { write: true, date: slot.intake_date };
}

const realSlot = (date: string | null): NonNullable<Slot> => ({
  permit_id: 10322,
  intake_date: date,
  is_placeholder: false,
});
const seattleBP = (date: string | null): Permit => ({
  type: 'Building Permit',
  juris: 'Seattle',
  intake_date: date,
});

describe('permits -> intake_records trigger (mirror)', () => {
  it('gates out non-Seattle and non-CN/DM permits', () => {
    expect(syncSlotFromPermit({ type: 'Building Permit', juris: 'Kirkland', intake_date: '2026-11-11' }, null)).toEqual({ kind: 'noop' });
    expect(syncSlotFromPermit({ type: 'ULS', juris: 'Seattle', intake_date: '2026-11-11' }, null)).toEqual({ kind: 'noop' });
  });

  it('set date with no slot -> INSERT', () => {
    expect(syncSlotFromPermit(seattleBP('2026-11-11'), null)).toEqual({ kind: 'insert', date: '2026-11-11' });
  });

  it('change date with an existing slot -> UPDATE', () => {
    expect(syncSlotFromPermit(seattleBP('2026-12-01'), realSlot('2026-11-11'))).toEqual({ kind: 'update', date: '2026-12-01' });
  });

  it('slot already equals the permit date -> NOOP (loop guard)', () => {
    expect(syncSlotFromPermit(seattleBP('2026-11-11'), realSlot('2026-11-11'))).toEqual({ kind: 'noop' });
  });

  it('clear date with an existing slot -> DELETE (falls off the tracker)', () => {
    expect(syncSlotFromPermit(seattleBP(null), realSlot('2026-11-11'))).toEqual({ kind: 'delete' });
  });

  it('clear date with no slot -> NOOP', () => {
    expect(syncSlotFromPermit(seattleBP(null), null)).toEqual({ kind: 'noop' });
  });
});

describe('intake_records -> permits reverse sync (mirror)', () => {
  it('a real-permit slot with a non-null date drives the permit', () => {
    expect(reverseSyncPermit(realSlot('2026-12-15'), seattleBP('2026-11-11'))).toEqual({ write: true, date: '2026-12-15' });
  });

  it('a placeholder never writes the permit', () => {
    expect(reverseSyncPermit({ permit_id: null, intake_date: '2026-12-15', is_placeholder: true }, seattleBP('2026-11-11')).write).toBe(false);
  });

  it('a null slot date is never pushed (preserves "date TBD")', () => {
    expect(reverseSyncPermit(realSlot(null), seattleBP('2026-11-11')).write).toBe(false);
  });

  it('value guard: equal dates -> no write', () => {
    expect(reverseSyncPermit(realSlot('2026-11-11'), seattleBP('2026-11-11')).write).toBe(false);
  });
});

describe('no ping-pong (composition)', () => {
  it('RPC edits a slot -> writes the permit ONCE, and the permit-trigger then no-ops', () => {
    // 1. Tracker edits the slot to D (slot updated first, by the RPC).
    const slotAfter = realSlot('2026-12-15');
    const permitBefore = seattleBP('2026-11-11');
    // 2. RPC reverse sync writes the permit (value differs).
    const rev = reverseSyncPermit(slotAfter, permitBefore);
    expect(rev).toEqual({ write: true, date: '2026-12-15' });
    // 3. That permit write fires the trigger; the slot already equals D -> NOOP.
    const permitAfter = seattleBP(rev.date!);
    expect(syncSlotFromPermit(permitAfter, slotAfter)).toEqual({ kind: 'noop' });
  });

  it('Project Overview edits the permit -> slot syncs; no second permit write', () => {
    // 1. Permit set to D; no slot yet -> trigger INSERTs the slot at D.
    const action = syncSlotFromPermit(seattleBP('2026-11-11'), null);
    expect(action).toEqual({ kind: 'insert', date: '2026-11-11' });
    // 2. The slot insert does NOT call the reverse sync (it's a trigger write,
    //    not the RPC) — but even if evaluated, the value guard holds: slot == permit.
    const slot = realSlot('2026-11-11');
    expect(reverseSyncPermit(slot, seattleBP('2026-11-11')).write).toBe(false);
  });
});
