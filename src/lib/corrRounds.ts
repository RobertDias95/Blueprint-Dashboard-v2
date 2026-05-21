import type { PermitCycle } from './database.types';

// fix-40: permits.corr_rounds is a single, engine-DERIVED value. It is owned
// server-side by bp_compute_corr_rounds (+ the permit_cycles AFTER trigger and
// the permits BEFORE-UPDATE-OF-status trigger) and is identical for every
// jurisdiction. The frontend only READS the stored column — it never writes it.
//
// This helper is the canonical CLIENT mirror of that SQL formula. It exists to
// (a) document the exact semantics in one place and (b) lock them under vitest
// so the definition can't silently diverge from the database engine. KEEP IN
// LOCKSTEP WITH bp_compute_corr_rounds (supabase migration
// fix_40_corr_rounds_derived_engine_owned).
//
//   corr_rounds = (count of permit_cycles WHERE cycle_index >= 1
//                   AND corr_issued IS NOT NULL)            -- closed corr cycles
//               + (1 IF the permit is in an OPEN correction round ELSE 0)
//
//   OPEN correction round =
//       status IN OPEN_CORRECTION_STATUSES
//       AND EXISTS a cycle WHERE cycle_index >= 1
//                  AND submitted IS NOT NULL AND corr_issued IS NULL
//
// Notes:
//  - cycle_index 0 is the design placeholder and NEVER counts.
//  - The +1 REQUIRES an open submitted review cycle — status alone never bumps.
//  - Same-day corr_issued == submitted DOES count (it's a closed corr cycle).

export const OPEN_CORRECTION_STATUSES = [
  'Corrections Required',
  'Awaiting Information',
  'Additional Info Requested',
] as const;

type CorrRoundsCycle = Pick<
  PermitCycle,
  'cycle_index' | 'submitted' | 'corr_issued'
>;

export function computeCorrRounds(
  cycles: CorrRoundsCycle[],
  status: string | null,
): number {
  const base = cycles.filter(
    (c) => c.cycle_index >= 1 && c.corr_issued != null,
  ).length;

  const inOpenStatus =
    status != null &&
    (OPEN_CORRECTION_STATUSES as readonly string[]).includes(status);

  const hasOpenSubmittedRound = cycles.some(
    (c) => c.cycle_index >= 1 && c.submitted != null && c.corr_issued == null,
  );

  return base + (inOpenStatus && hasOpenSubmittedRound ? 1 : 0);
}
