import { describe, it, expect } from 'vitest';

// fix-242: contract spec for the cycle auto-advance rule shared by both
// cycle-write paths. The rule is SQL
// (migrations/fix_242_cycle_autoadvance_bulk_path.sql →
// bp_apply_cycle_autoadvance, called by bp_replace_permit_cycles; and the
// identical inline snap in bp_upsert_permit_cycle_row / fix_119). No live DB in
// CI (the fix-153 / fix-220 precedent), so this is a pure-TS mirror of the rule
// + a documented read-only PROD probe of the pieces it depends on.
//
// PROD probe (2026-07-21, project eibnmwthkcuumyclyxoe, READ-ONLY):
//   - v2's cycle editor saves per-field via bp_upsert_permit_cycle_row (which
//     already auto-advances); it NEVER calls bp_replace_permit_cycles. The
//     stuck permits (26 108851 GD cyc2, 7102494-DM cyc1, 3043356-LU cyc0) were
//     written by the bulk path, which had no auto-advance — the fix-242 gap.
//   - UNIQUE (permit_id, cycle_index) index permit_cycles_permit_id_cycle_index_key
//     backs the ON CONFLICT.
//   - BEFORE INSERT trigger permit_cycles_default_tenant fills tenant_id when
//     omitted, so the helper's tenant-less INSERT lands on the caller's tenant.
//
// The rule (both paths, identical):
//   - cycle 0  + intake_accepted set → ensure cycle 1.submitted = intake_accepted
//   - cycle N>=1 + resubmitted set   → ensure cycle N+1.submitted = resubmitted
//   Idempotent + never-clobber: insert the next cycle if missing; if it exists
//   with a NULL submitted, fill it; if it exists with a non-null submitted,
//   leave it untouched.

interface Cycle {
  cycle_index: number;
  submitted: string | null;
  city_target?: string | null;
  corr_issued?: string | null;
  resubmitted?: string | null;
  intake_accepted?: string | null;
}

/** Pure-TS mirror of bp_apply_cycle_autoadvance(permit_id). Returns the new
 *  cycle set (sorted by index) plus the count of rows created/filled. */
function applyAutoAdvance(cycles: Cycle[]): { cycles: Cycle[]; created: number } {
  // Snapshot the trigger dates BEFORE mutating — the SQL FOR loop is evaluated
  // once, so a freshly-created next cycle is not re-advanced this pass.
  const advances: { nextIndex: number; date: string }[] = [];
  for (const c of cycles) {
    if (c.cycle_index === 0 && c.intake_accepted) {
      advances.push({ nextIndex: 1, date: c.intake_accepted });
    } else if (c.cycle_index >= 1 && c.resubmitted) {
      advances.push({ nextIndex: c.cycle_index + 1, date: c.resubmitted });
    }
  }

  const byIndex = new Map(cycles.map((c) => [c.cycle_index, { ...c }]));
  let created = 0;
  for (const a of advances.sort((x, y) => x.nextIndex - y.nextIndex)) {
    const existing = byIndex.get(a.nextIndex);
    if (!existing) {
      // INSERT — next cycle missing.
      byIndex.set(a.nextIndex, { cycle_index: a.nextIndex, submitted: a.date });
      created += 1;
    } else if (existing.submitted === null || existing.submitted === undefined) {
      // ON CONFLICT DO UPDATE ... WHERE submitted IS NULL AND distinct.
      if (existing.submitted !== a.date) {
        existing.submitted = a.date;
        created += 1;
      }
    }
    // else: non-null submitted → conflict absorbed, never clobbered.
  }

  return {
    cycles: [...byIndex.values()].sort((x, y) => x.cycle_index - y.cycle_index),
    created,
  };
}

describe('fix-242 cycle auto-advance rule', () => {
  it('resubmitted on cycle 1 creates cycle 2 (submitted = that date)', () => {
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 0, submitted: '2025-12-22', intake_accepted: '2025-12-26' },
      { cycle_index: 1, submitted: '2025-12-22', resubmitted: '2026-01-23' },
    ]);
    expect(created).toBe(1);
    const c2 = cycles.find((c) => c.cycle_index === 2);
    expect(c2?.submitted).toBe('2026-01-23');
  });

  it('intake on cycle 0 creates cycle 1 (submitted = intake)', () => {
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 0, submitted: '2025-12-20', intake_accepted: '2025-12-30' },
    ]);
    expect(created).toBe(1);
    expect(cycles.find((c) => c.cycle_index === 1)?.submitted).toBe('2025-12-30');
  });

  it('resubmitted on a deep review cycle (N>=1) advances to N+1', () => {
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 0, submitted: '2026-04-17', intake_accepted: '2026-04-21' },
      { cycle_index: 1, submitted: '2026-04-20' },
      { cycle_index: 2, submitted: '2026-07-02', resubmitted: '2026-07-02' },
    ]);
    expect(created).toBe(1);
    expect(cycles.find((c) => c.cycle_index === 3)?.submitted).toBe('2026-07-02');
  });

  it('is idempotent — re-running once the next cycle exists is a no-op', () => {
    const start: Cycle[] = [
      { cycle_index: 0, submitted: '2025-12-22', intake_accepted: '2025-12-26' },
      { cycle_index: 1, submitted: '2025-12-22', resubmitted: '2026-01-23' },
    ];
    const first = applyAutoAdvance(start);
    const second = applyAutoAdvance(first.cycles);
    expect(second.created).toBe(0);
    expect(second.cycles).toEqual(first.cycles);
  });

  it('never clobbers an existing non-null submitted on the next cycle', () => {
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 1, submitted: '2026-01-01', resubmitted: '2026-01-23' },
      // cycle 2 was manually set to a different submitted — must survive.
      { cycle_index: 2, submitted: '2026-01-30' },
    ]);
    expect(created).toBe(0);
    expect(cycles.find((c) => c.cycle_index === 2)?.submitted).toBe('2026-01-30');
  });

  it('fills a blank submitted on an existing next cycle', () => {
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 1, submitted: '2026-01-01', resubmitted: '2026-01-23' },
      { cycle_index: 2, submitted: null },
    ]);
    expect(created).toBe(1);
    expect(cycles.find((c) => c.cycle_index === 2)?.submitted).toBe('2026-01-23');
  });

  it('does not advance cycle 0 on resubmitted, nor review cycles on intake', () => {
    // Design-cycle resubmitted is V1 data noise; intake on a review cycle too.
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 0, submitted: '2026-01-01', resubmitted: '2026-02-01' },
      { cycle_index: 1, submitted: '2026-01-05', intake_accepted: '2026-01-10' },
    ]);
    expect(created).toBe(0);
    expect(cycles.find((c) => c.cycle_index === 2)).toBeUndefined();
  });

  it('advances multiple stuck cycles in one pass without re-advancing new rows', () => {
    // cycle 0 intake AND cycle 1 resubmitted both missing their next cycle.
    const { cycles, created } = applyAutoAdvance([
      { cycle_index: 0, submitted: '2026-01-01', intake_accepted: '2026-01-05' },
      { cycle_index: 1, submitted: '2026-01-05', resubmitted: '2026-02-01' },
    ]);
    // Creates cycle 1? No — cycle 1 already exists → fill only if null; it has a
    // submitted already, so no-op there. Creates cycle 2 from cycle 1 resub.
    expect(cycles.find((c) => c.cycle_index === 2)?.submitted).toBe('2026-02-01');
    // cycle 1 already had submitted 2026-01-05 → untouched by the intake rule.
    expect(cycles.find((c) => c.cycle_index === 1)?.submitted).toBe('2026-01-05');
    expect(created).toBe(1);
  });
});
