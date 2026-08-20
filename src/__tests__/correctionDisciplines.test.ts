import { describe, it, expect } from 'vitest';
import {
  breakdownSummary,
  canonicalDiscipline,
  clusterDiscipline,
  DOMINANT_SHARE,
  groupByDiscipline,
  isRealDiscipline,
  NOT_RECORDED,
  SEVERAL,
} from '../lib/correctionDisciplines';

// ===========================================================================
// fix-374 · §1 — group by the column that is already right
// ===========================================================================
//
// Bobby: *"whats interesting, is it said General for this item, but it is a
// drainage correction, as mentioned in the first few words."*
//
// ★★★ Measured on prod 2026-08-20: all 476 items whose subject is `General`
// carry a real, non-empty discipline. One hundred percent. Every fixture below
// is a real value from that measurement.

describe('fix-374 what discipline a General item is really about', () => {
  it('reads the discipline that was already recorded', () => {
    // The worked example Bobby hit: drainage boilerplate filed under `General`.
    expect(canonicalDiscipline('Drainage')).toBe('Drainage');
    expect(canonicalDiscipline('Energy')).toBe('Energy');
    expect(canonicalDiscipline('Zoning')).toBe('Zoning');
  });

  it('★★★ refuses to name a winner when the pile is genuinely split', () => {
    // The real `subject:general` breakdown, straight from the RPC.
    const general = clusterDiscipline([
      { discipline: 'Drainage', items: 206 },
      { discipline: 'Energy', items: 203 },
      { discipline: 'Reveg', items: 7 },
      { discipline: 'Compiled', items: 6 },
    ]);
    // Drainage is 50.4% of the real disciplines — a coin toss, not a fact.
    expect(general.mixed).toBe(true);
    expect(general.label).toBe(SEVERAL);
    expect(general.dominant).toBe('Drainage');
    expect(general.share).toBeLessThan(DOMINANT_SHARE);
    // ...and it says what it is made of instead of picking one.
    expect(breakdownSummary(general)).toBe('Drainage 206 · Energy 203 · Reveg 7');
  });

  it('names the discipline when one really does own the pile', () => {
    // `subject:dwc general` — Drainage 34 and nothing else.
    const dwc = clusterDiscipline([{ discipline: 'Drainage', items: 34 }]);
    expect(dwc.mixed).toBe(false);
    expect(dwc.label).toBe('Drainage');
    expect(dwc.share).toBe(1);
  });

  it('a stray minority does not make a pile mixed', () => {
    const tree = clusterDiscipline([
      { discipline: 'Tree', items: 25 },
      { discipline: 'Arborist', items: 2 },
    ]);
    expect(tree.mixed).toBe(false);
    expect(tree.label).toBe('Tree');
  });
});

// ---------------------------------------------------------------------------
// ★ §1 — "Compiled and any other non-discipline value must not become a new
// junk drawer. Check what values discipline actually takes."
//
// It takes 40. These are the ones that are not simply a discipline spelled
// correctly, each with its measured item count.
// ---------------------------------------------------------------------------

describe('fix-374 the non-disciplines, handled deliberately', () => {
  it.each([
    ['Ordinace', 'Ordinance', 10],
    ['Strucutral', 'Structural', 3],
    ['Drsinge', 'Drainage', 1],
    ['Drinage', 'Drainage', 1],
    ['Addresssing', 'Addressing', 1],
    ['Structural Calcs', 'Structural', 1],
  ])('folds the misspelling %s into %s (%i items)', (raw, want) => {
    expect(canonicalDiscipline(raw)).toBe(want);
  });

  it.each([
    ['Revegetation', 'Reveg'],
    ['City Light', 'SCL'],
    ['Spu Ss', 'Side Sewer'],
    ['Sdot Shoring', 'Shoring'],
  ])('folds %s into its other name %s', (raw, want) => {
    expect(canonicalDiscipline(raw)).toBe(want);
  });

  it('★ Combined and Compiled mean "the letter covered several"', () => {
    // NOT folded into "not recorded": "we covered everything in one letter"
    // and "we do not know" are different facts.
    expect(canonicalDiscipline('Compiled')).toBe(SEVERAL);
    expect(canonicalDiscipline('Combined')).toBe(SEVERAL);
    expect(canonicalDiscipline('Combine')).toBe(SEVERAL);
    expect(isRealDiscipline(SEVERAL)).toBe(false);
  });

  it('★ recovers a discipline hiding behind an address', () => {
    // Real values: the parser caught the project address too.
    expect(canonicalDiscipline('4052- -Tree')).toBe('Tree');
    expect(canonicalDiscipline('4222- Zoning')).toBe('Zoning');
  });

  it('★ an address with no discipline in it is not a new junk drawer', () => {
    expect(canonicalDiscipline('4113 Sw Ida')).toBe(NOT_RECORDED);
    expect(canonicalDiscipline(null)).toBe(NOT_RECORDED);
    expect(canonicalDiscipline('')).toBe(NOT_RECORDED);
    expect(canonicalDiscipline('   ')).toBe(NOT_RECORDED);
    expect(isRealDiscipline(NOT_RECORDED)).toBe(false);
  });

  it('★★ a discipline we have never seen passes through untouched', () => {
    // Folding an unrecognised value into "not recorded" would hide a
    // discipline the city has only just started using — the junk-drawer
    // mistake this ticket is about, committed a second time by us.
    expect(canonicalDiscipline('Geotechnical')).toBe('Geotechnical');
    expect(isRealDiscipline('Geotechnical')).toBe(true);
  });

  it('merges the folded spellings into one slice', () => {
    const d = clusterDiscipline([
      { discipline: 'Drainage', items: 46 },
      { discipline: 'Drinage', items: 1 },
    ]);
    expect(d.breakdown).toEqual([{ discipline: 'Drainage', items: 47 }]);
    expect(d.mixed).toBe(false);
  });

  it('judges the winner among REAL disciplines only', () => {
    // Half "not recorded" is still a Drainage pile to anyone reading it.
    const d = clusterDiscipline([
      { discipline: 'Drainage', items: 10 },
      { discipline: null as unknown as string, items: 40 },
    ]);
    expect(d.label).toBe('Drainage');
    expect(d.breakdown[0]).toEqual({ discipline: NOT_RECORDED, items: 40 });
  });

  it('a pile with nothing but non-disciplines says so', () => {
    const d = clusterDiscipline([{ discipline: 'Compiled', items: 6 }]);
    expect(d.label).toBe(SEVERAL);
    expect(clusterDiscipline([]).label).toBe(NOT_RECORDED);
  });
});

// ---------------------------------------------------------------------------
// ★★★ "The change is which field ORGANISES the view, not which fields exist."
// ---------------------------------------------------------------------------

describe('fix-374 grouping keeps fix-372 ranking intact', () => {
  const rows = [
    { key: 'a', d: 'Zoning' },
    { key: 'b', d: 'Drainage' },
    { key: 'c', d: 'Zoning' },
    { key: 'd', d: SEVERAL },
    { key: 'e', d: NOT_RECORDED },
    { key: 'f', d: 'Drainage' },
  ];

  it('groups by discipline without re-ordering inside a group', () => {
    const groups = groupByDiscipline(rows, (r) => r.d);
    const zoning = groups.find((g) => g.discipline === 'Zoning');
    expect(zoning?.rows.map((r) => r.key)).toEqual(['a', 'c']);
    const drainage = groups.find((g) => g.discipline === 'Drainage');
    expect(drainage?.rows.map((r) => r.key)).toEqual(['b', 'f']);
  });

  it('orders groups by their best-ranked member, never by size', () => {
    // Zoning first because `a` outranks `b` — not because it has more rows.
    const groups = groupByDiscipline(rows, (r) => r.d);
    expect(groups.slice(0, 2).map((g) => g.discipline)).toEqual(['Zoning', 'Drainage']);
  });

  it('★★★ the mixed group is NOT sunk — rank is rank', () => {
    // `General` is the highest-reach pattern in the corpus (75 projects,
    // 63.6%) AND the pile no single discipline owns. Sinking "Several
    // disciplines" would bury the biggest recurring correction at the foot of
    // the view whose whole job is to rank them.
    const ranked = [
      { key: 'general', d: SEVERAL },
      { key: '302 fire', d: 'Building' },
      { key: 'unlabelled', d: NOT_RECORDED },
    ];
    expect(groupByDiscipline(ranked, (r) => r.d).map((g) => g.discipline))
      .toEqual([SEVERAL, 'Building', NOT_RECORDED]);
  });

  it('a coded subject still clusters as itself — fix-372 unbroken', () => {
    // `302 Fire Separation` is one discipline and one pile; grouping does not
    // split it, rename it or move it off the top of its group.
    const fire = clusterDiscipline([{ discipline: 'Building', items: 106 }]);
    expect(fire.label).toBe('Building');
    const groups = groupByDiscipline(
      [{ key: '302 Fire Separation', d: fire.label }], (r) => r.d);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows[0].key).toBe('302 Fire Separation');
  });
});
