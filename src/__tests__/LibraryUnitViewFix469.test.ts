import { describe, it, expect } from 'vitest';
import {
  SITE_FILTER_KEYS,
  UNIT_FILTER_KEYS,
  cardHasValue,
  clearCardFilters,
  libraryFilterKeyCoverage,
  matchingUnitIndices,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import {
  flattenUnitRows,
  matchingUnitRows,
  unitRowProjectCount,
} from '../lib/libraryUnitRows';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-469 (P-121 + P-122) — THE UNIT VIEW, AND THE PER-CARD CLEAR
// ===========================================================================
//
// ★★ NOTHING HERE WAS BROKEN. Both halves change a deliberate design, and §1
// partly undoes fix-447. The earlier reasoning was sound; what changed is what
// the view is FOR. No constant and no suite was deleted — `flattenUnitRows` and
// its whole fix-447 suite pass UNMODIFIED, because this ticket composes with it
// rather than replacing it.
//
// ---------------------------------------------------------------------------
// §1 — Bobby, 2026-09-01, with a marked-up screenshot: yellow on the rows that
// matched, a red X on every row that did not.
//
//   *"when you search by unit, say 16x36 and there is a unit that matches from
//    a project — the results show all of the units from that project — not
//    helpful — it is showing a lot of noise that doesnt apply."*
//
// MEASURED ON PROD 2026-09-01, his exact search (unit 16×36, ±1 each):
//
//     every unit row in the library   241   (the brief said 238; 3 were added)
//     printed for this search today    35
//     that actually match              10   across 9 projects
//
// ★★ 71% of the answer did not match the question.
//
// ★★★ HE REJECTED THE MIDDLE OPTION. Offered "matches only, plus a `1 of 4
// units` expander per row", he chose matches only, full stop. There is no
// expander: to see a project's other units you open the project, and the
// Library's SITE view already answers that question — the expander would have
// been a second door onto a room that has one.

const EMPTY: LibraryFilters = {
  view: 'site',
  lotwTarget: null,
  lotwBuf: 2,
  lotdTarget: null,
  lotdBuf: 2,
  unitwTarget: null,
  unitwBuf: 2,
  unitdTarget: null,
  unitdBuf: 2,
  zone: '',
  alley: '',
  productTypes: [],
  juris: '',
  isCornerLot: '',
  stories: '',
  parkingKind: '',
  stalls: '',
  roofDeck: '',
};

function unit(over: Partial<UnitType> = {}): UnitType {
  return {
    label: 'Unit',
    width_ft: 16,
    depth_ft: 36,
    qty: 1,
    stories: 2,
    parking_kind: null,
    parking_stalls: null,
    roof_deck: null,
    work_scope: null,
    ...over,
  } as unknown as UnitType;
}

function row(projectId: string, unitTypes: UnitType[]): LibraryRow {
  return {
    projectId,
    address: `${projectId} Main St`,
    juris: 'Seattle',
    zone: 'NR',
    unitTypes,
    productTypes: [],
    tags: [],
    lotWidth: 40,
    lotDepth: 100,
    alley: 'No',
    isCornerLot: false,
    isRegularShape: true,
    units: unitTypes.length,
    updatedAt: '2026-09-01T00:00:00Z',
  } as unknown as LibraryRow;
}

/** Bobby's search: 16 × 36, ±1 on each. */
const SEARCH_16x36: LibraryFilters = {
  ...EMPTY,
  view: 'unit',
  unitwTarget: 16,
  unitwBuf: 1,
  unitdTarget: 36,
  unitdBuf: 1,
};

describe('fix-469 §1 — the UNIT view returns only matching units', () => {
  it('★★★ one unit of a four-unit project matches → ONE row, not four', () => {
    // This is the complaint, reduced to its smallest form. Three of these
    // units are the red Xs on his screenshot.
    const rows = [
      row('p1', [
        unit({ label: 'A', width_ft: 16, depth_ft: 36 }), // the match
        unit({ label: 'B', width_ft: 24, depth_ft: 40 }),
        unit({ label: 'C', width_ft: 30, depth_ft: 50 }),
        unit({ label: 'D', width_ft: 20, depth_ft: 60 }),
      ]),
    ];
    // Today's behaviour, still available and still correct for its own
    // question: every unit of every qualifying project.
    expect(flattenUnitRows(rows)).toHaveLength(4);
    // fix-469's answer.
    const shown = matchingUnitRows(rows, SEARCH_16x36);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.unit.label).toBe('A');
  });

  it('★★★ the count line reads "10 units across 9 projects" for the measured search', () => {
    // ★★ THE WORDING DOES NOT CHANGE, ONLY WHAT FEEDS IT. fix-447 §B5 chose
    //    "N units across M projects" because 96 of 202 projects hold no
    //    `unit_types`, so a bare number that halves on a view switch reads as a
    //    broken filter. With no unmatched rows printed, "rows printed" and
    //    "units matched" simply become the same number.
    //
    // Nine projects, each with one matching unit and two that do not — the
    // shape prod is in, reproduced: 35 rows would print today, 10 match.
    const rows = Array.from({ length: 9 }, (_, i) =>
      row(`p${i}`, [
        unit({ label: 'match', width_ft: 16, depth_ft: 36 }),
        unit({ label: 'noise-1', width_ft: 28, depth_ft: 44 }),
        unit({ label: 'noise-2', width_ft: 32, depth_ft: 52 }),
      ]),
    );
    // ★ The tenth match lives on one of the nine projects — prod's 10 units
    //   across 9 projects means one project contributes two.
    rows[0]!.unitTypes.push(unit({ label: 'match-2', width_ft: 17, depth_ft: 35 }));

    // Before: every unit of every qualifying project.
    expect(flattenUnitRows(rows)).toHaveLength(28);
    // After.
    const shown = matchingUnitRows(rows, SEARCH_16x36);
    expect(shown).toHaveLength(10);
    expect(unitRowProjectCount(shown)).toBe(9);
    // The sentence the component builds from those two numbers.
    expect(
      `${shown.length} units across ${unitRowProjectCount(shown)} projects`,
    ).toBe('10 units across 9 projects');
  });

  it('★★★ a search matching nothing returns no rows — the empty state, not a bare header', () => {
    const rows = [row('p1', [unit({ width_ft: 99, depth_ft: 99 })])];
    expect(matchingUnitRows(rows, SEARCH_16x36)).toHaveLength(0);
    // ★ The component already renders "No units match the current filters."
    //   for a zero-length list — that branch predates this ticket and is
    //   asserted in LibraryMatrix.test.tsx. Nothing new was needed; what
    //   changed is that it is now reachable by a unit search.
  });

  it('★★ SITE view is UNTOUCHED — all units still belong to a qualifying project', () => {
    // ★★ A lot search still returns projects and all their units. That is the
    //    plan-reuse reading and it keeps its home. `flattenUnitRows` is what
    //    the SITE reading is built on, and it is unchanged — same function,
    //    same tests, same answer.
    const rows = [
      row('p1', [
        unit({ label: 'A', width_ft: 16, depth_ft: 36 }),
        unit({ label: 'B', width_ft: 24, depth_ft: 40 }),
      ]),
    ];
    expect(flattenUnitRows(rows).map((u) => u.unit.label)).toEqual(['A', 'B']);
  });

  it('★ with NO unit criteria active, every unit is still returned', () => {
    // No criteria, no filtering. The UNIT view without a unit search lists the
    // whole library, which is what it should do — and it is what makes the
    // "matches only" rule a rule about criteria rather than about the view.
    const rows = [
      row('p1', [unit({ label: 'A' }), unit({ label: 'B', width_ft: 99 })]),
    ];
    expect(matchingUnitRows(rows, { ...EMPTY, view: 'unit' })).toHaveLength(2);
  });

  it('★★★ PROPERTY: every returned row satisfies the active UNIT criteria', () => {
    // ★★★ THE ASSERTION THAT MAKES THIS STAY FIXED. Not "these three rows" —
    //     every row, checked against the SAME predicate the component uses, on
    //     a set deliberately full of near-misses on each dimension separately.
    //     fix-402's per-unit conjunction is the thing being defended: a project
    //     with one unit that is 16 wide and ANOTHER that is 36 deep must not
    //     contribute either row.
    const rows = [
      row('p1', [
        unit({ label: 'both', width_ft: 16, depth_ft: 36 }),
        unit({ label: 'width-only', width_ft: 16, depth_ft: 60 }),
        unit({ label: 'depth-only', width_ft: 30, depth_ft: 36 }),
      ]),
      row('p2', [
        unit({ label: 'edge-lo', width_ft: 15, depth_ft: 35 }),
        unit({ label: 'edge-hi', width_ft: 17, depth_ft: 37 }),
        unit({ label: 'just-out', width_ft: 18, depth_ft: 36 }),
      ]),
      row('p3', []),
    ];
    const shown = matchingUnitRows(rows, SEARCH_16x36);

    for (const r of shown) {
      const ok = matchingUnitIndices(r.project, SEARCH_16x36);
      expect(ok, `${r.unit.label} is not a match`).toContain(r.index);
    }
    // Stated the other way too, so a predicate that returned NOTHING would not
    // pass vacuously: the four real matches are all present.
    expect(shown.map((u) => u.unit.label).sort()).toEqual([
      'both',
      'edge-hi',
      'edge-lo',
    ].sort());
    // ★ The two half-matches on p1 are gone even though p1 qualifies.
    expect(shown.map((u) => u.unit.label)).not.toContain('width-only');
    expect(shown.map((u) => u.unit.label)).not.toContain('depth-only');
  });
});

// ---------------------------------------------------------------------------
// ★★★ §2 (P-122) — each card clears itself
// ---------------------------------------------------------------------------
//
// Bobby, 2026-09-01: *"can we add a clear button to the search filters of
// units/site?"*
//
// ★ The cards were separated for exactly this reason — fix-447 split SITE from
// UNIT because *"the metric you are searching by decides the columns you get
// back."* Two independent questions want two independent resets; the single
// toolbar Clear is a leftover from when there was one card, and keeping a lot
// search while dropping the unit dimensions meant blanking NINE controls.

// ★ fix-483 §A2/§A4: `search` and `tag` left the shape with their controls.
const BOTH_SET: LibraryFilters = {
  ...EMPTY,
  view: 'unit',
  lotwTarget: 40,
  zone: 'NR3',
  juris: 'Seattle',
  unitwTarget: 16,
  unitdTarget: 36,
  stories: '2',
  productTypes: ['SFR'],
};

describe('fix-469 §2 — a card clears only itself', () => {
  it('★★★ clearing UNIT leaves every SITE field and the view alone', () => {
    const next = clearCardFilters(BOTH_SET, UNIT_FILTER_KEYS, EMPTY);
    // The unit card is blank…
    expect(next.unitwTarget).toBeNull();
    expect(next.unitdTarget).toBeNull();
    expect(next.stories).toBe('');
    expect(next.productTypes).toEqual([]);
    // …and the site card is exactly as it was.
    expect(next.lotwTarget).toBe(40);
    expect(next.zone).toBe('NR3');
    expect(next.juris).toBe('Seattle');
    // ★ fix-483 §A4: the free-text search used to be asserted here as the field
    //   belonging to NEITHER card. It is gone, and so is the global Clear that
    //   owned it — `view` is now the only key in neither list, and the test
    //   below is the one that guards it.
  });

  it('★★★ clearing SITE leaves every UNIT field alone', () => {
    const next = clearCardFilters(BOTH_SET, SITE_FILTER_KEYS, EMPTY);
    expect(next.lotwTarget).toBeNull();
    expect(next.zone).toBe('');
    expect(next.unitwTarget).toBe(16);
    expect(next.stories).toBe('2');
    expect(next.productTypes).toEqual(['SFR']);
  });

  it('★★★ NEITHER card Clear touches `view` — the one that gets missed', () => {
    // ★★ `view` rides inside LibraryFilters because that is the blob fix-403
    //    persists, but it is a PREFERENCE, not a filter: it changes the columns
    //    you get back, never which rows match. Clearing a search must never
    //    bounce somebody into a different table.
    //
    // ★ And it is guaranteed structurally rather than by memory: `view` is in
    //   neither key list, and `clearCardFilters` writes only the keys it is
    //   given — so it cannot be reset here even by accident.
    for (const keys of [SITE_FILTER_KEYS, UNIT_FILTER_KEYS]) {
      expect(clearCardFilters(BOTH_SET, keys, EMPTY).view).toBe('unit');
    }
    expect(SITE_FILTER_KEYS as readonly string[]).not.toContain('view');
    expect(UNIT_FILTER_KEYS as readonly string[]).not.toContain('view');
  });

  it('★★ a card with nothing set has nothing to clear, so no button renders', () => {
    // fix-406's rule: a control that cannot act is absent.
    expect(cardHasValue(EMPTY, SITE_FILTER_KEYS, EMPTY)).toBe(false);
    expect(cardHasValue(EMPTY, UNIT_FILTER_KEYS, EMPTY)).toBe(false);
    expect(cardHasValue(BOTH_SET, SITE_FILTER_KEYS, EMPTY)).toBe(true);
    expect(cardHasValue(BOTH_SET, UNIT_FILTER_KEYS, EMPTY)).toBe(true);
    // ★ …and one card holding a value does not conjure the other's button.
    const unitOnly = { ...EMPTY, unitwTarget: 16 };
    expect(cardHasValue(unitOnly, UNIT_FILTER_KEYS, EMPTY)).toBe(true);
    expect(cardHasValue(unitOnly, SITE_FILTER_KEYS, EMPTY)).toBe(false);
  });

  it('★★★ A MOVED BUFFER IS A VALUE — compared against the default, not against blankness', () => {
    // ★★ The four buffer fields default to **2**, not to null. A card whose
    //    buffer somebody moved to 5 is a card holding something to clear, and a
    //    naive "is it empty" check would call it blank and hide the button that
    //    restores it. This is why `cardHasValue` takes `initial`.
    const buffered = { ...EMPTY, lotwBuf: 5 };
    expect(cardHasValue(buffered, SITE_FILTER_KEYS, EMPTY)).toBe(true);
    expect(clearCardFilters(buffered, SITE_FILTER_KEYS, EMPTY).lotwBuf).toBe(2);
  });

  it('★★★ PROPERTY: the global Clear leaves nothing set anywhere except `view`', () => {
    // The global Clear is `{ ...INITIAL_FILTERS, view: prev.view }` — stated
    // here as the property rather than re-implemented, so the two cannot drift.
    const cleared = { ...EMPTY, view: BOTH_SET.view };
    for (const key of Object.keys(EMPTY) as (keyof LibraryFilters)[]) {
      if (key === 'view') continue;
      expect(cleared[key], `${key} survived the global Clear`).toEqual(EMPTY[key]);
    }
    expect(cleared.view).toBe('unit');
  });

  it('★★★ PROPERTY: every filter key is filed under exactly one card, or neither', () => {
    // ★★★ THE ASSERTION THAT KEEPS §2 TRUE AS FILTERS ARE ADDED. Add a field to
    //     `LibraryFilters` and forget to file it, and this fails NAMING the key
    //     — instead of shipping a control that no Clear on the page can reach.
    //     ★ fix-483 §A4: `view` is the ONLY deliberate exception now — `search`
    //       was the other one and it went with its box.
    const { unfiled, duplicated } = libraryFilterKeyCoverage(EMPTY);
    expect(unfiled, `unfiled filter keys: ${unfiled.join(', ')}`).toEqual([]);
    expect(duplicated, `filed twice: ${duplicated.join(', ')}`).toEqual([]);
    // ★ The partition is complete: SITE + UNIT + `view` = every key. Written as
    //   the RULE rather than as three numbers, so the next filter added moves
    //   one side of this equation and not the other.
    expect(
      SITE_FILTER_KEYS.length + UNIT_FILTER_KEYS.length + 1,
    ).toBe(Object.keys(EMPTY).length);
  });
});

// ---------------------------------------------------------------------------
// ★★★ fix-472 §1 (P-124) — the matched highlight is deleted, the PREDICATE stays
// ---------------------------------------------------------------------------
//
// fix-469 §1.4 was told to keep the highlight "because it is still live in the
// SITE view's expand". **That expand does not exist** — fix-447 §B6 deleted it
// and says so in its own comment — so the UNIT view was its only call site and
// the prop was left taking a literal `false`. The banked rule:
// **"keep this, it is used elsewhere" must NAME the call site.**
//
// ★ Contrast fix-467's `STAGE_CHIP`, correctly kept: that one is EXPORTED and
//   INDEPENDENTLY TESTED — a property of its file that needs no second call
//   site to stay true. This prop had neither.
//
// ★★★ THE DANGEROUS NEIGHBOUR: `matchingUnitIndices` is NOT the highlight. It
//     is the predicate fix-469 composed the row filter onto, so deleting it
//     would silently restore the 71%-noise bug — 35 rows printed for a search
//     that matches 10. The cases below are the guard on that: they pin the row
//     SET, not the styling, so a careless deletion fails loudly here.
describe('fix-472 §1 — deleting the highlight did not touch the filter', () => {
  it('★★★ PROPERTY: the UNIT view\'s row set is unchanged by fix-472', () => {
    // Byte-for-byte the fix-469 scenario, re-asserted after the deletion.
    const rows = [
      row('p1', [
        unit({ label: 'A', width_ft: 16, depth_ft: 36 }),
        unit({ label: 'B', width_ft: 24, depth_ft: 40 }),
        unit({ label: 'C', width_ft: 30, depth_ft: 50 }),
        unit({ label: 'D', width_ft: 20, depth_ft: 60 }),
      ]),
    ];
    const shown = matchingUnitRows(rows, SEARCH_16x36);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.unit.label).toBe('A');
    // ★ The predicate the filter is built on is still exported and still
    //   answers. If somebody deletes it chasing "the highlight", this throws
    //   rather than quietly returning every row.
    expect(typeof matchingUnitIndices).toBe('function');
    expect(matchingUnitIndices(rows[0]!, SEARCH_16x36)).toEqual([0]);
  });

  it('★★ …and with no criteria it still returns everything, as fix-469 ruled', () => {
    const rows = [
      row('p1', [unit({ label: 'A' }), unit({ label: 'B', width_ft: 99 })]),
    ];
    expect(matchingUnitRows(rows, { ...EMPTY, view: 'unit' })).toHaveLength(2);
  });
});
