import { describe, it, expect } from 'vitest';

// fix-183: contract spec for the active-quarter-aware seed/clone RPCs
// (migrations/fix_183_seed_clone_respect_active_quarters.sql). Both now filter
// 'da' columns through bp_member_active_in_quarter(<member window>, target) so a
// departed DA is never re-introduced, then renumber positions contiguously.
// No live DB in CI (fix-153 precedent) -> pure-TS mirror + rolled-back prod probe.
//
// PROD probe (2026-06-18, simulated authenticated JWT, throwaway quarters, whole
// transaction aborted by a final RAISE — zero rows persisted). Verbatim:
//
//   seed_count=9 maxpos=8;
//   seeded=Francesca,Ainsley,Trevor,Nicky,Qisheng,Marc,Ahmadi,Fisk,Erick;
//     -- Chad/Nidhi/Alex (ended 2026-Q1) excluded; Jade=Erick only; 0..8 contiguous.
//   clone_count=2; cloned=OPEN@0,Erick@1;
//     -- source [Chad(da), OPEN, Erick(da)] cloned to a quarter where Chad is
//        inactive -> Chad dropped, OPEN + Erick kept, renumbered contiguous.
//   noforce=refused(23505); gate=blocked(42501);

interface Group { dm_name: string; da_name: string; dm_order: number; da_order: number }
interface Col { position: number; col_kind: 'da' | 'open'; da_name: string | null; group_label: string | null; label_override?: string | null }

/** Mirror of bp_seed_quarter_layout_from_current: keep dm_da_groups DAs active
 *  in the target quarter (unknown DA => active, matching the LEFT JOIN / NULL
 *  window default), order by (dm_order, da_order, names), renumber 0..n. */
function seedActive(groups: Group[], activeInTarget: (da: string) => boolean): Col[] {
  return groups
    .filter((g) => activeInTarget(g.da_name))
    .slice()
    .sort(
      (a, b) =>
        a.dm_order - b.dm_order ||
        a.da_order - b.da_order ||
        a.dm_name.localeCompare(b.dm_name) ||
        a.da_name.localeCompare(b.da_name),
    )
    .map((g, i) => ({ position: i, col_kind: 'da', da_name: g.da_name, group_label: g.dm_name }));
}

/** Mirror of bp_clone_quarter_layout: copy source order; keep OPEN lanes always
 *  and 'da' columns only if the DA is active in the target; renumber 0..n. */
function cloneActive(src: Col[], activeInTarget: (da: string) => boolean): Col[] {
  return src
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((c) => c.col_kind === 'open' || (c.da_name != null && activeInTarget(c.da_name)))
    .map((c, i) => ({ ...c, position: i }));
}

// Today's dm_da_groups + the ended-2026-Q1 set (Chad, Nidhi, Alex).
const GROUPS: Group[] = [
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
const ENDED_Q1 = new Set(['Chad', 'Nidhi', 'Alex']);
const activeInFuture = (da: string) => !ENDED_Q1.has(da);

describe('fix-183 seed respects active-quarters', () => {
  const seeded = seedActive(GROUPS, activeInFuture);

  it('excludes DAs inactive in the target quarter (matches the prod probe: 9 cols)', () => {
    expect(seeded).toHaveLength(9);
    expect(seeded.map((c) => c.da_name)).toEqual([
      'Francesca', 'Ainsley', 'Trevor', 'Nicky', 'Qisheng', 'Marc', 'Ahmadi', 'Fisk', 'Erick',
    ]);
    expect(seeded.some((c) => ['Chad', 'Nidhi', 'Alex'].includes(c.da_name!))).toBe(false);
  });

  it('renumbers positions contiguously 0..n with no gaps', () => {
    expect(seeded.map((c) => c.position)).toEqual([...Array(9).keys()]);
  });

  it('keeps a DA with no team_members row (unknown => active)', () => {
    const out = seedActive(
      [{ dm_name: 'X', da_name: 'Newbie', dm_order: 1, da_order: 1 }],
      activeInFuture,
    );
    expect(out.map((c) => c.da_name)).toEqual(['Newbie']);
  });
});

describe('fix-183 clone respects active-quarters', () => {
  const src: Col[] = [
    { position: 0, col_kind: 'da', da_name: 'Chad', group_label: 'Derry' },
    { position: 1, col_kind: 'open', da_name: null, group_label: null, label_override: 'OPEN' },
    { position: 2, col_kind: 'da', da_name: 'Erick', group_label: 'Jade' },
  ];

  it('drops a da column inactive in the target, keeps OPEN + active, renumbers', () => {
    const out = cloneActive(src, activeInFuture); // Chad inactive
    expect(out.map((c) => `${c.col_kind === 'open' ? 'OPEN' : c.da_name}@${c.position}`)).toEqual([
      'OPEN@0', 'Erick@1',
    ]);
  });

  it('OPEN lanes always carry over even if every da column is dropped', () => {
    const out = cloneActive(src, () => false);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ col_kind: 'open', position: 0 });
  });

  it('preserves group_label/label_override on kept columns', () => {
    const out = cloneActive(src, activeInFuture);
    expect(out.find((c) => c.da_name === 'Erick')?.group_label).toBe('Jade');
    expect(out.find((c) => c.col_kind === 'open')?.label_override).toBe('OPEN');
  });
});
