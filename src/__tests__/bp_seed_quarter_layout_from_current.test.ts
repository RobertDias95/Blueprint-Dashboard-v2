import { describe, it, expect } from 'vitest';
import { reorderLayoutIds } from '../hooks/useReorderQuarterLayout';
import { deriveGroupSpans } from '../lib/quarterLayoutHelpers';

// fix-182b: contract spec for bp_seed_quarter_layout_from_current — the
// "start a quarter from today's team" path. The logic is SQL
// (migrations/fix_182b_seed_quarter_layout_from_current.sql). No live DB in CI
// (the fix-153 precedent), so verification is this pure-TS mirror + a
// rolled-back MCP probe against PROD.
//
// PROD probe (2026-06-18, simulated authenticated JWT in tenant
// 00000000-0000-0000-0000-000000000001, throwaway quarter '2099-Q9', whole
// transaction aborted by a final RAISE — zero rows persisted). Verbatim:
//
//   seed=12; rows=12 pos0=Francesca pos11=Alex/Jade;  -- from live dm_da_groups
//   noforce=refused(23505);                           -- refuse non-empty target
//   force=12;                                         -- p_force overwrites
//   gate=blocked(42501);                              -- no-membership sub -> 42501
//
//   NB pos11=Alex/Jade — Alex is the dm_order/da_order=999 row, last in Jade.
//   This is TODAY's dm_da_groups order, distinct from the 2026-Q1 historical
//   seed (fix-182a) which ended in Erick. Confirms seed reads current, not the
//   frozen quarter.

interface Group {
  dm_name: string;
  da_name: string;
  dm_order: number;
  da_order: number;
}
interface Col {
  position: number;
  col_kind: 'da';
  da_name: string;
  group_label: string;
}

// Mirror of the SQL: order dm_da_groups by (dm_order, da_order, dm_name,
// da_name), emit DA columns with group_label = manager, position 0..n.
function seedFromCurrent(groups: Group[]): Col[] {
  return groups
    .slice()
    .sort(
      (a, b) =>
        a.dm_order - b.dm_order ||
        a.da_order - b.da_order ||
        a.dm_name.localeCompare(b.dm_name) ||
        a.da_name.localeCompare(b.da_name),
    )
    .map((g, i) => ({
      position: i,
      col_kind: 'da' as const,
      da_name: g.da_name,
      group_label: g.dm_name,
    }));
}

// Today's prod dm_da_groups (fix-182a probe): Alex is the 999/999 trailing row.
const CURRENT: Group[] = [
  { dm_name: 'Lindsay', da_name: 'Francesca', dm_order: 1, da_order: 1 },
  { dm_name: 'Lindsay', da_name: 'Ainsley', dm_order: 1, da_order: 2 },
  { dm_name: 'Lindsay', da_name: 'Trevor', dm_order: 1, da_order: 3 },
  { dm_name: 'Derry', da_name: 'Nicky', dm_order: 2, da_order: 1 },
  { dm_name: 'Derry', da_name: 'Chad', dm_order: 2, da_order: 2 },
  { dm_name: 'Derry', da_name: 'Qisheng', dm_order: 2, da_order: 3 },
  { dm_name: 'Brittani', da_name: 'Marc', dm_order: 3, da_order: 1 },
  { dm_name: 'Brittani', da_name: 'Ahmadi', dm_order: 3, da_order: 2 },
  { dm_name: 'Brittani', da_name: 'Fisk', dm_order: 3, da_order: 3 },
  { dm_name: 'Jade', da_name: 'Nidhi', dm_order: 4, da_order: 1 },
  { dm_name: 'Jade', da_name: 'Erick', dm_order: 4, da_order: 2 },
  { dm_name: 'Jade', da_name: 'Alex', dm_order: 999, da_order: 999 },
];

describe('fix-182b seed-from-current — mirror', () => {
  const seeded = seedFromCurrent(CURRENT);

  it('produces one DA column per dm_da_groups row, positions 0..n', () => {
    expect(seeded).toHaveLength(12);
    expect(seeded.map((c) => c.position)).toEqual([...Array(12).keys()]);
    expect(seeded.every((c) => c.col_kind === 'da')).toBe(true);
  });

  it('matches the prod probe ends: pos0=Francesca, pos11=Alex/Jade', () => {
    expect(seeded[0]).toMatchObject({ da_name: 'Francesca', group_label: 'Lindsay' });
    expect(seeded[11]).toMatchObject({ da_name: 'Alex', group_label: 'Jade' });
  });

  it('orders by dm_order then da_order (the 999 row trails)', () => {
    expect(seeded.map((c) => c.group_label)).toEqual([
      'Lindsay', 'Lindsay', 'Lindsay',
      'Derry', 'Derry', 'Derry',
      'Brittani', 'Brittani', 'Brittani',
      'Jade', 'Jade', 'Jade',
    ]);
  });
});

describe('fix-182b reorderLayoutIds (dnd drop)', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves the active id into the over id slot', () => {
    expect(reorderLayoutIds(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderLayoutIds(ids, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op for same id or unknown id', () => {
    expect(reorderLayoutIds(ids, 'a', 'a')).toBe(ids);
    expect(reorderLayoutIds(ids, 'x', 'b')).toBe(ids);
  });
});

describe('fix-182b deriveGroupSpans (manager-header preview)', () => {
  it('merges contiguous same-label columns; nulls stay standalone', () => {
    const spans = deriveGroupSpans([
      { group_label: 'Lindsay' },
      { group_label: 'Lindsay' },
      { group_label: null },
      { group_label: null },
      { group_label: 'Jade' },
    ]);
    expect(spans).toEqual([
      { label: 'Lindsay', count: 2 },
      { label: null, count: 1 },
      { label: null, count: 1 },
      { label: 'Jade', count: 1 },
    ]);
  });

  it('does NOT merge a label that recurs non-contiguously', () => {
    const spans = deriveGroupSpans([
      { group_label: 'Ana' },
      { group_label: 'Bo' },
      { group_label: 'Ana' },
    ]);
    expect(spans).toEqual([
      { label: 'Ana', count: 1 },
      { label: 'Bo', count: 1 },
      { label: 'Ana', count: 1 },
    ]);
  });
});
