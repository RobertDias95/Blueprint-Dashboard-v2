import { describe, it, expect } from 'vitest';
import {
  UNKNOWN_CYCLE,
  UNSPECIFIED_DISCIPLINE,
  WHOLE_PROJECT,
  correctionTopicKey,
  groupCorrections,
  summarizeCorrections,
} from '../lib/correctionItems';
import type { CorrectionItem } from '../lib/database.types';

// fix-276: grouping + summary for the read-only Corrections panel.
//
// The two fixtures below are the real production shapes (queried from
// public.correction_items) that the feature is accepted against:
//
//   10044 37th Ave SW — Seattle. 20 items, building NULL throughout, six named
//     disciplines in cycle 1 and a single Addressing item in cycle 2. Exactly
//     ONE topic repeats across cycles (Addressing / Address assignment).
//   10431 SE 19th St — Bellevue. 48 items, building SFR 1..4 at 12 each, all
//     cycle 1, discipline NULL on every row.
//
// Between them they cover both branches of every conditional in the module:
// building present vs absent, discipline named vs null, one cycle vs two.

let seq = 0;
function row(over: Partial<CorrectionItem>): CorrectionItem {
  seq += 1;
  return {
    id: `ci-${seq}`,
    project_id: 'p1',
    permit_id: null,
    building: null,
    discipline: null,
    cycle: 1,
    letter_date: '2025-08-29',
    reviewer: null,
    item_no: 1,
    subject: 'Subject',
    body: 'Body',
    codes: null,
    category: null,
    theme: null,
    source_file: 'letter.pdf',
    ...over,
  };
}

/** n rows in one discipline of one cycle, item_no 1..n, all one category. */
function letter(
  opts: Pick<CorrectionItem, 'discipline' | 'cycle' | 'source_file'> & {
    n: number;
    category?: string;
    building?: string | null;
  },
): CorrectionItem[] {
  return Array.from({ length: opts.n }, (_, i) =>
    row({
      discipline: opts.discipline,
      cycle: opts.cycle,
      source_file: opts.source_file,
      item_no: i + 1,
      category: opts.category ?? 'Unclassified',
      building: opts.building ?? null,
    }),
  );
}

// ---------------------------------------------------------------- fixtures --

/** 10044 37th Ave SW, exactly as production holds it. */
function seattleProject(): CorrectionItem[] {
  return [
    ...letter({
      discipline: 'Addressing', cycle: 1, n: 1,
      source_file: '10044 - Addressing Corr 1.pdf',
      category: 'Address assignment / display',
    }),
    ...letter({
      discipline: 'Energy', cycle: 1, n: 5,
      source_file: '10044 - Energy Corr 1.pdf', category: 'Lighting efficacy',
    }),
    ...letter({
      discipline: 'OS', cycle: 1, n: 5,
      source_file: '10044 - OS Corr 1.pdf', category: 'Egress / stairs / guards',
    }),
    ...letter({
      discipline: 'SCL', cycle: 1, n: 2,
      source_file: '10044 - SCL Corr 1.pdf', category: 'Unclassified',
    }),
    ...letter({
      discipline: 'Tree', cycle: 1, n: 3,
      source_file: '10044 - Tree Corr 1.pdf', category: 'Tree inventory / survey',
    }),
    ...letter({
      discipline: 'Zoning', cycle: 1, n: 3,
      source_file: '10044 - Zoning Corr 1.pdf', category: 'Height & grade calc',
    }),
    // Cycle 2: the SAME topic (Addressing / Address assignment) comes back.
    ...letter({
      discipline: 'Addressing', cycle: 2, n: 1,
      source_file: '10044 - Addressing Corr 2.pdf',
      category: 'Address assignment / display',
    }),
  ];
}

/** 10431 SE 19th St — four buildings, 12 items each, no discipline. */
function eastsideProject(): CorrectionItem[] {
  return ['SFR 1', 'SFR 2', 'SFR 3', 'SFR 4'].flatMap((building) =>
    letter({
      discipline: null, cycle: 1, n: 12, building,
      source_file: `10431 - ${building} - Correction Letter 1.pdf`,
      category: 'Missing / incorrect plan info',
    }),
  );
}

// --------------------------------------------------------------- summarize --

describe('fix-276 summarizeCorrections — 10044 37th Ave SW (Seattle)', () => {
  const rows = seattleProject();

  it('counts 20 items across cycles 1 and 2', () => {
    const s = summarizeCorrections(rows);
    expect(s.total).toBe(20);
    expect(s.cycles).toEqual([1, 2]);
    expect(s.hasUnknownCycle).toBe(false);
  });

  it('finds exactly ONE repeat topic', () => {
    // Addressing / Address assignment appears in cycle 1 AND cycle 2. Nothing
    // else does — the other five disciplines are cycle 1 only.
    expect(summarizeCorrections(rows).repeatTopics).toBe(1);
  });

  it('hides the building level — every Seattle row has building NULL', () => {
    expect(summarizeCorrections(rows).showBuildingLevel).toBe(false);
  });
});

describe('fix-276 summarizeCorrections — 10431 SE 19th St (east side)', () => {
  const rows = eastsideProject();

  it('counts 48 items in a single cycle', () => {
    const s = summarizeCorrections(rows);
    expect(s.total).toBe(48);
    expect(s.cycles).toEqual([1]);
  });

  it('shows the building level — every row names one', () => {
    expect(summarizeCorrections(rows).showBuildingLevel).toBe(true);
  });

  it('reports no repeats — one cycle cannot repeat', () => {
    expect(summarizeCorrections(rows).repeatTopics).toBe(0);
  });
});

describe('fix-276 repeat-topic rules', () => {
  it('the topic is building + discipline + category', () => {
    const a = row({ building: 'SFR 1', discipline: 'Zoning', category: 'Setbacks' });
    const b = row({ building: 'SFR 1', discipline: 'Zoning', category: 'Setbacks' });
    const differentBuilding = row({
      building: 'SFR 2', discipline: 'Zoning', category: 'Setbacks',
    });
    expect(correctionTopicKey(a)).toBe(correctionTopicKey(b));
    expect(correctionTopicKey(a)).not.toBe(correctionTopicKey(differentBuilding));
  });

  it('the SAME topic twice in ONE cycle is not a repeat', () => {
    const rows = [
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks', item_no: 1 }),
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks', item_no: 2 }),
    ];
    expect(summarizeCorrections(rows).repeatTopics).toBe(0);
  });

  it('the same topic in two cycles IS a repeat', () => {
    const rows = [
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 2, discipline: 'Zoning', category: 'Setbacks' }),
    ];
    expect(summarizeCorrections(rows).repeatTopics).toBe(1);
  });

  it('counts a topic spanning three cycles ONCE, not twice', () => {
    const rows = [1, 2, 3].map((cycle) =>
      row({ cycle, discipline: 'Zoning', category: 'Setbacks' }),
    );
    expect(summarizeCorrections(rows).repeatTopics).toBe(1);
  });

  it('separates topics that differ only by building', () => {
    // Same discipline+category, different structures, one cycle each — two
    // distinct topics, neither repeating.
    const rows = [
      row({ cycle: 1, building: 'SFR 1', discipline: 'Planning', category: 'Setbacks' }),
      row({ cycle: 2, building: 'SFR 2', discipline: 'Planning', category: 'Setbacks' }),
    ];
    expect(summarizeCorrections(rows).repeatTopics).toBe(0);
  });

  it('a null-cycle row cannot evidence a repeat', () => {
    // "the city raised it again in a later round" is meaningless without the
    // round, so the null-cycle row is excluded from the topic index.
    const rows = [
      row({ cycle: null, discipline: 'Zoning', category: 'Setbacks' }),
      row({ cycle: 1, discipline: 'Zoning', category: 'Setbacks' }),
    ];
    const s = summarizeCorrections(rows);
    expect(s.repeatTopics).toBe(0);
    expect(s.hasUnknownCycle).toBe(true);
    expect(s.cycles).toEqual([1]);
    expect(s.total).toBe(2); // still counted as an item
  });

  it('null discipline and null category form their own topic, not a crash', () => {
    const rows = [
      row({ cycle: 1, discipline: null, category: null }),
      row({ cycle: 2, discipline: null, category: null }),
    ];
    expect(summarizeCorrections(rows).repeatTopics).toBe(1);
  });

  it('an empty project summarizes to zeroes', () => {
    expect(summarizeCorrections([])).toEqual({
      total: 0,
      cycles: [],
      hasUnknownCycle: false,
      repeatTopics: 0,
      showBuildingLevel: false,
    });
  });

  it('one row that names a building turns the building level on', () => {
    const rows = [row({ building: null }), row({ building: 'SFR 1' })];
    expect(summarizeCorrections(rows).showBuildingLevel).toBe(true);
  });

  it('a whitespace-only building does not count as naming one', () => {
    expect(summarizeCorrections([row({ building: '   ' })]).showBuildingLevel)
      .toBe(false);
  });
});

// ------------------------------------------------------------------ groups --

describe('fix-276 groupCorrections — 10044 37th Ave SW', () => {
  const groups = groupCorrections(seattleProject());

  it('produces one (unnamed) building group', () => {
    expect(groups).toHaveLength(1);
    expect(groups[0].building).toBeNull();
    expect(groups[0].label).toBe(WHOLE_PROJECT);
    expect(groups[0].count).toBe(20);
  });

  it('splits into cycle 1 (19 items) and cycle 2 (1 item)', () => {
    const cycles = groups[0].cycles;
    expect(cycles.map((c) => c.cycle)).toEqual([1, 2]);
    expect(cycles.map((c) => c.count)).toEqual([19, 1]);
    expect(cycles.map((c) => c.label)).toEqual(['Cycle 1', 'Cycle 2']);
  });

  it('cycle 1 holds the six disciplines with the expected counts', () => {
    const counts = Object.fromEntries(
      groups[0].cycles[0].disciplines.map((d) => [d.label, d.items.length]),
    );
    expect(counts).toEqual({
      Energy: 5,
      OS: 5,
      Tree: 3,
      Zoning: 3,
      SCL: 2,
      Addressing: 1,
    });
  });

  it('orders disciplines alphabetically for a stable read', () => {
    expect(groups[0].cycles[0].disciplines.map((d) => d.label)).toEqual([
      'Addressing', 'Energy', 'OS', 'SCL', 'Tree', 'Zoning',
    ]);
  });

  it('cycle 2 holds only the returning Addressing item', () => {
    const cycle2 = groups[0].cycles[1];
    expect(cycle2.disciplines).toHaveLength(1);
    expect(cycle2.disciplines[0].label).toBe('Addressing');
    expect(cycle2.disciplines[0].items).toHaveLength(1);
  });
});

describe('fix-276 groupCorrections — 10431 SE 19th St', () => {
  const groups = groupCorrections(eastsideProject());

  it('produces one group per building, 12 items each', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'SFR 1', 'SFR 2', 'SFR 3', 'SFR 4',
    ]);
    expect(groups.map((g) => g.count)).toEqual([12, 12, 12, 12]);
  });

  it('each building has exactly one cycle', () => {
    for (const g of groups) {
      expect(g.cycles).toHaveLength(1);
      expect(g.cycles[0].cycle).toBe(1);
      expect(g.cycles[0].count).toBe(12);
    }
  });

  it('a null discipline renders as its own Unspecified group, not dropped', () => {
    const disciplines = groups[0].cycles[0].disciplines;
    expect(disciplines).toHaveLength(1);
    expect(disciplines[0].label).toBe(UNSPECIFIED_DISCIPLINE);
    expect(disciplines[0].items).toHaveLength(12);
  });

  it('keeps every one of the 48 items', () => {
    const total = groups.reduce(
      (n, g) =>
        n +
        g.cycles.reduce(
          (m, c) => m + c.disciplines.reduce((k, d) => k + d.items.length, 0),
          0,
        ),
      0,
    );
    expect(total).toBe(48);
  });
});

describe('fix-276 group ordering edge cases', () => {
  it('sorts buildings naturally — SFR 2 before SFR 10', () => {
    const rows = ['SFR 10', 'SFR 2', 'SFR 1'].map((building) =>
      row({ building }),
    );
    expect(groupCorrections(rows).map((g) => g.label)).toEqual([
      'SFR 1', 'SFR 2', 'SFR 10',
    ]);
  });

  it('puts the whole-project bucket after the named buildings', () => {
    const rows = [row({ building: null }), row({ building: 'SFR 1' })];
    expect(groupCorrections(rows).map((g) => g.label)).toEqual([
      'SFR 1', WHOLE_PROJECT,
    ]);
  });

  it('puts the unknown-cycle bucket after the numbered cycles', () => {
    const rows = [
      row({ cycle: null }), row({ cycle: 2 }), row({ cycle: 1 }),
    ];
    expect(groupCorrections(rows)[0].cycles.map((c) => c.label)).toEqual([
      'Cycle 1', 'Cycle 2', UNKNOWN_CYCLE,
    ]);
  });

  it('puts the Unspecified discipline after the named ones', () => {
    const rows = [
      row({ discipline: null }),
      row({ discipline: 'Zoning' }),
      row({ discipline: 'Drainage' }),
    ];
    expect(
      groupCorrections(rows)[0].cycles[0].disciplines.map((d) => d.label),
    ).toEqual(['Drainage', 'Zoning', UNSPECIFIED_DISCIPLINE]);
  });

  it('orders items by source file then item_no, so each letter stays contiguous', () => {
    // item_no restarts at 1 per letter, so sorting on item_no alone would
    // interleave two letters of the same discipline.
    const rows = [
      row({ discipline: 'Zoning', source_file: 'b.pdf', item_no: 1, subject: 'b1' }),
      row({ discipline: 'Zoning', source_file: 'a.pdf', item_no: 2, subject: 'a2' }),
      row({ discipline: 'Zoning', source_file: 'a.pdf', item_no: 1, subject: 'a1' }),
    ];
    const items = groupCorrections(rows)[0].cycles[0].disciplines[0].items;
    expect(items.map((i) => i.subject)).toEqual(['a1', 'a2', 'b1']);
  });

  it('returns nothing for an empty project', () => {
    expect(groupCorrections([])).toEqual([]);
  });
});
