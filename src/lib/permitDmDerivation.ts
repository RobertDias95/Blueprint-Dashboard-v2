import type { DmDaGroupRow } from './database.types';
import { dmForDa } from './dmCoAssign';

// ===========================================================================
// fix-379 — permits.dm is DERIVED: the manager of the permit's DA.
// ===========================================================================
//
// ★★ THE RULE LIVES IN THE DATABASE, not here. `bp_trg_permit_derive_dm`
// (migrations/fix_379_dm_derived.sql) fires BEFORE INSERT OR UPDATE OF
// da, dm, type on permits, so it holds for every writer — direct client
// updates, the wizard's insert path, bp_move_draw_schedule_da, bp_rename_dm.
// This module is the pure-TS twin, for the fix-153-pattern regression tests
// (no live DB in CI). KEEP IN LOCKSTEP with the SQL.
//
// Bobby's rule: "If the design associate is assigned to a permit, then that
// design manager would also see the permit… Their job is to oversee the
// associates." So:
//
//   1. ★★★ A ULS permit carries NEITHER a DM nor a DA, whatever the project
//      says ("generally speaking, ULS permits are never assigned to a DM or
//      DA"). The trigger strips both.
//   2. ★★★ NO DA means NO DM — a manager with nobody to oversee does not
//      belong on the permit.
//   3. ★★ A mapped DA resolves to their dm_da_groups manager, always —
//      whatever a writer tried to store in dm.
//   4. ★ An UNMAPPED DA (Cam, Shire) resolves to NOTHING and is reported
//      (bp_dm_gap_report), never guessed. dm stays a human-managed field
//      there — with one exception: when the permit just changed hands FROM a
//      mapped DA and dm merely rode along, the stale manager is cleared.
//      fix-368's dm_of_project fallback still covers those DAs' TASKS.

export interface DerivedDm {
  /** The value permits.dm must hold, when `determinate`. */
  dm: string | null;
  /** false = the DA has no mapping row: the derivation is silent and dm is
   *  left to people. */
  determinate: boolean;
}

/** ★ The TS twin of SQL `bp_derived_dm_for_permit(p_type, p_da, p_tenant)`. */
export function derivePermitDm(
  type: string | null | undefined,
  da: string | null | undefined,
  rows: DmDaGroupRow[],
): DerivedDm {
  if (type === 'ULS') return { dm: null, determinate: true };
  const key = (da ?? '').trim();
  if (key === '') return { dm: null, determinate: true };
  const mapped = dmForDa(key, rows);
  if (mapped !== null) return { dm: mapped, determinate: true };
  return { dm: null, determinate: false };
}

export interface PermitDmWrite {
  op: 'insert' | 'update';
  type: string | null;
  /** NEW.da / NEW.dm — what the writer is storing. */
  da: string | null;
  dm: string | null;
  /** OLD.da / OLD.dm / OLD.type — ignored on insert. */
  prevDa?: string | null;
  prevDm?: string | null;
  prevType?: string | null;
  rows: DmDaGroupRow[];
}

/** ★★ The TS twin of the trigger `bp_trg_permit_derive_dm`: what the row
 *  looks like AFTER the BEFORE trigger has run. Returns the final
 *  { da, dm } pair. */
export function applyPermitDmDerivation(w: PermitDmWrite): {
  da: string | null;
  dm: string | null;
} {
  // 0. ★★ fix-346's "identical value" guard, for a new reason: a writer
  // re-asserting unchanged values (a scraper upsert, a bulk save) must not
  // silently apply the pending backfill to the rows it touches. The rule
  // acts on a CHANGE.
  if (
    w.op === 'update' &&
    (w.prevDa ?? null) === (w.da ?? null) &&
    (w.prevDm ?? null) === (w.dm ?? null) &&
    (w.prevType ?? null) === (w.type ?? null)
  ) {
    return { da: w.da, dm: w.dm };
  }

  // 1. ULS: strip both — the violation cannot regrow on a real edit.
  if (w.type === 'ULS') return { da: null, dm: null };

  const d = derivePermitDm(w.type, w.da, w.rows);
  if (d.determinate) return { da: w.da, dm: d.dm };

  // Unmapped DA. Clear a manager that merely RODE ALONG through a change of
  // hands from a mapped DA (their manager is now nobody's answer); keep
  // anything a person set, and keep everything on a plain rename (the old
  // DA was unmapped too, so no stale mapped manager is riding).
  if (
    w.op === 'update' &&
    (w.prevDa ?? null) !== (w.da ?? null) &&
    (w.prevDm ?? null) === (w.dm ?? null) &&
    dmForDa(w.prevDa ?? '', w.rows) !== null
  ) {
    return { da: w.da, dm: null };
  }
  return { da: w.da, dm: w.dm };
}
