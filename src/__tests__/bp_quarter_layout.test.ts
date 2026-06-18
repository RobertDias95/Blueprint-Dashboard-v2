import { describe, it, expect } from 'vitest';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182a: contract spec for the quarter-versioned Draw Schedule layout
// backend (Phase A — data + RPCs, no render). The logic is SQL
// (migrations/fix_182a_quarter_layout_data.sql:
//   bp_upsert_quarter_layout_row / bp_delete_quarter_layout_row /
//   bp_reorder_quarter_layout / bp_clone_quarter_layout + the 2026-Q1 seed).
// No live DB in CI (the fix-153 precedent), so verification is a pure-TS mirror
// of the deterministic logic below + a rolled-back MCP probe against PROD.
//
// PROD probe (2026-06-18, simulated authenticated JWT in tenant
// 00000000-0000-0000-0000-000000000001, throwaway quarter '2099-Q9', whole
// transaction aborted by a final RAISE — zero rows persisted). Verbatim:
//
//   scope=[00000000-0000-0000-0000-000000000001];
//   clone=12; rows=12 pos11=Erick; shared_ids=0;   -- copies all 12, NEW ids
//   noforce=refused(23505);                         -- refuse non-empty target
//   force=12;                                       -- p_force overwrites
//   reorder=12; newpos0=Erick;                      -- full permutation renumbers
//   occ_stale=true; occ_fresh=false;                -- OCC conflict then success
//   open_check=enforced(23514);                     -- open lane must have NULL da
//   gate=blocked(42501);                            -- no-membership sub -> 42501
//
//   Seed (permanent) query — SELECT ... WHERE quarter='2026-Q1' ORDER BY position:
//     0 Francesca/Lindsay  1 Ainsley/Lindsay  2 Trevor/Lindsay
//     3 Nicky/Derry        4 Chad/Derry       5 Qisheng/Derry
//     6 Marc/Brittani      7 Ahmadi/Brittani  8 Fisk/Brittani
//     9 Nidhi/Jade        10 Alex/Jade       11 Erick/Jade
//   NB: Jade = Nidhi,Alex,Erick — the 2026-Q1 snapshot, NOT today's
//   dm_da_groups order (Nidhi,Erick,Alex). The point of versioning.
//   (Post-probe count: only 2026-Q1 = 12 rows; throwaway rolled back.)
//
// The pure functions below mirror the SQL so the contract is regression-guarded.

type Col = Pick<
  DrawScheduleQuarterLayoutRow,
  'position' | 'col_kind' | 'da_name' | 'group_label'
>;

// ---------------------------------------------------------------------------
// Mirror of the 2026-Q1 seed: flatten quarterTeams in dmOrder order, DA order
// within each manager, assigning position 0..n. group_label = manager name.
// ---------------------------------------------------------------------------
function seedLayout(
  quarterTeams: Record<string, string[]>,
  dmOrder: string[],
): Col[] {
  const rank = (dm: string): number => {
    const i = dmOrder.indexOf(dm);
    return i === -1 ? 999 : i + 1; // mirror COALESCE(ord, 999)
  };
  const managers = Object.keys(quarterTeams).sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b); // dm_rank, then key
  });
  const out: Col[] = [];
  let pos = 0;
  for (const dm of managers) {
    for (const da of quarterTeams[dm]) {
      out.push({ position: pos, col_kind: 'da', da_name: da, group_label: dm });
      pos += 1;
    }
  }
  return out;
}

// Mirror of bp_clone_quarter_layout: copy positions/labels verbatim; refuse a
// non-empty target unless force (then replace). Returns the cloned rows.
function cloneLayout(
  from: Col[],
  to: Col[],
  force: boolean,
): { rows: Col[]; refused: boolean } {
  if (to.length > 0 && !force) return { rows: to, refused: true };
  return {
    rows: from
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ ...c })),
    refused: false,
  };
}

// Mirror of bp_reorder_quarter_layout: ids must be the FULL set (a permutation);
// renumber position 0..n in the given order. Returns the renumbered rows or
// throws on an incomplete/foreign id set (the 22023 guard).
function reorderLayout(rows: Col[], orderedDas: string[]): Col[] {
  const present = rows.map((r) => r.da_name ?? '');
  const sameSet =
    orderedDas.length === rows.length &&
    present.every((d) => orderedDas.includes(d)) &&
    orderedDas.every((d) => present.includes(d));
  if (!sameSet) throw new Error('id set must be the full column set');
  return orderedDas.map((da, i) => {
    const src = rows.find((r) => r.da_name === da)!;
    return { ...src, position: i };
  });
}

// Mirror of the OCC gate shared by upsert/delete: a write succeeds only when
// the caller's expected updated_at matches the row's current value.
function occConflict(currentUpdatedAt: string, expectedUpdatedAt: string): boolean {
  return currentUpdatedAt !== expectedUpdatedAt;
}

// Mirror of the dsql_kind_da_consistency CHECK.
function kindConsistent(col_kind: 'da' | 'open', da_name: string | null): boolean {
  return (
    (col_kind === 'open' && da_name === null) ||
    (col_kind === 'da' && da_name !== null)
  );
}

const Q1_TEAMS: Record<string, string[]> = {
  // jsonb object key order is NOT preserved — dmOrder is the source of truth.
  Jade: ['Nidhi', 'Alex', 'Erick'],
  Derry: ['Nicky', 'Chad', 'Qisheng'],
  Lindsay: ['Francesca', 'Ainsley', 'Trevor'],
  Brittani: ['Marc', 'Ahmadi', 'Fisk'],
};
const Q1_DMORDER = ['Lindsay', 'Derry', 'Brittani', 'Jade'];

describe('fix-182a quarter layout — seed shape', () => {
  const seeded = seedLayout(Q1_TEAMS, Q1_DMORDER);

  it('produces 12 columns', () => {
    expect(seeded).toHaveLength(12);
  });

  it('orders managers by dmOrder regardless of object key order', () => {
    const labels = [...new Set(seeded.map((c) => c.group_label))];
    expect(labels).toEqual(['Lindsay', 'Derry', 'Brittani', 'Jade']);
  });

  it('matches the prod seed positions exactly', () => {
    expect(seeded.map((c) => [c.position, c.da_name, c.group_label])).toEqual([
      [0, 'Francesca', 'Lindsay'],
      [1, 'Ainsley', 'Lindsay'],
      [2, 'Trevor', 'Lindsay'],
      [3, 'Nicky', 'Derry'],
      [4, 'Chad', 'Derry'],
      [5, 'Qisheng', 'Derry'],
      [6, 'Marc', 'Brittani'],
      [7, 'Ahmadi', 'Brittani'],
      [8, 'Fisk', 'Brittani'],
      [9, 'Nidhi', 'Jade'],
      [10, 'Alex', 'Jade'],
      [11, 'Erick', 'Jade'],
    ]);
  });

  it("preserves the quarter's DA order within a manager (Jade: Nidhi,Alex,Erick — not today's order)", () => {
    const jade = seeded.filter((c) => c.group_label === 'Jade').map((c) => c.da_name);
    expect(jade).toEqual(['Nidhi', 'Alex', 'Erick']);
  });

  it('ranks a manager absent from dmOrder last (COALESCE 999)', () => {
    const teams = { ...Q1_TEAMS, Zed: ['Newbie'] };
    const out = seedLayout(teams, Q1_DMORDER);
    expect(out[out.length - 1]).toMatchObject({ da_name: 'Newbie', group_label: 'Zed' });
  });

  it('is idempotent-safe: re-seeding the same input is identical', () => {
    expect(seedLayout(Q1_TEAMS, Q1_DMORDER)).toEqual(seeded);
  });
});

describe('fix-182a quarter layout — clone', () => {
  const from = seedLayout(Q1_TEAMS, Q1_DMORDER);

  it('copies every column into an empty target, positions intact', () => {
    const { rows, refused } = cloneLayout(from, [], false);
    expect(refused).toBe(false);
    expect(rows).toHaveLength(12);
    expect(rows.map((c) => c.position)).toEqual([...Array(12).keys()]);
    expect(rows[11]).toMatchObject({ da_name: 'Erick', group_label: 'Jade' });
  });

  it('refuses a non-empty target without force', () => {
    const existing = seedLayout(Q1_TEAMS, Q1_DMORDER);
    const { refused } = cloneLayout(from, existing, false);
    expect(refused).toBe(true);
  });

  it('overwrites a non-empty target with force', () => {
    const existing = seedLayout(Q1_TEAMS, Q1_DMORDER);
    const { rows, refused } = cloneLayout(from, existing, true);
    expect(refused).toBe(false);
    expect(rows).toHaveLength(12);
  });
});

describe('fix-182a quarter layout — reorder', () => {
  const rows = seedLayout(Q1_TEAMS, Q1_DMORDER);

  it('renumbers 0..n in the given order (reversal)', () => {
    const reversed = rows.map((c) => c.da_name!).reverse();
    const out = reorderLayout(rows, reversed);
    expect(out.map((c) => c.position)).toEqual([...Array(12).keys()]);
    expect(out[0]).toMatchObject({ da_name: 'Erick', position: 0 });
    expect(out[11]).toMatchObject({ da_name: 'Francesca', position: 11 });
  });

  it('rejects an incomplete id set (the 22023 full-permutation guard)', () => {
    expect(() => reorderLayout(rows, ['Erick', 'Alex'])).toThrow();
  });

  it('rejects a foreign id not in the quarter', () => {
    const swapped = rows.map((c) => c.da_name!);
    swapped[0] = 'Stranger';
    expect(() => reorderLayout(rows, swapped)).toThrow();
  });
});

describe('fix-182a quarter layout — OCC + CHECK guards', () => {
  it('flags a conflict on stale updated_at, succeeds on fresh', () => {
    expect(occConflict('2026-06-18T00:00:00Z', '2026-06-17T00:00:00Z')).toBe(true);
    expect(occConflict('2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')).toBe(false);
  });

  it('enforces col_kind/da_name consistency', () => {
    expect(kindConsistent('da', 'Francesca')).toBe(true);
    expect(kindConsistent('open', null)).toBe(true);
    expect(kindConsistent('open', 'Francesca')).toBe(false); // probe: 23514
    expect(kindConsistent('da', null)).toBe(false);
  });
});
