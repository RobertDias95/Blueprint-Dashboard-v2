import { describe, it, expect } from 'vitest';
import ARCHIVE_SQL from '../../migrations/fix_402_archive_then_clear_site_parking.sql?raw';
import COASSIGN_SQL from '../../migrations/fix_402_erick_coassign_remainder.sql?raw';
import libraryMatrixSource from '../components/LibraryMatrix.tsx?raw';
import projectHeaderSource from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import segmentsSource from '../lib/correctionsSegments.ts?raw';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import {
  filterLibraryRows,
  matchingUnitIndices,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import {
  NOT_RECORDED,
  parkingKindLabel,
  parkingRollup,
  roofDeckLabel,
  roofDeckRollup,
  stallsLabel,
  matchParkingKind,
  matchRoofDeck,
  matchStallsTier,
  parseStalls,
} from '../lib/unitParking';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// fix-402 — parking belongs to the unit, and the Library learns to say so
// ===========================================================================
//
// Bobby, 2026-08-25:
//
//   "Remove [parking] from the holistic site and merge that under the units for
//    proposal … by unit it's broken down: is it a garage, is it surface, is it
//    both, and how many stalls per unit … we need to go back and backfill all
//    the units parking … in the Project Overview and in the Library, we need to
//    make that not only a searchable but a displayable thing."
//
// ★★★ THE ONE RULE EVERYTHING BELOW TURNS ON: NULL IS NOT "none". 231 unit rows
// across 102 projects ship NULL and are backfilled by hand, so for a while MOST
// rows are unrecorded — which makes every "treat NULL as the empty case"
// shortcut wrong at scale rather than in the corner.

const unit = (over: Partial<UnitType> = {}): UnitType => ({
  label: 'Type A',
  width_ft: 20,
  depth_ft: 40,
  qty: 1,
  stories: null,
  parking_kind: null,
  parking_stalls: null,
  roof_deck: null,
  ...over,
});

// ---------------------------------------------------------------------------
// §1 · NULL vs none
// ---------------------------------------------------------------------------

describe('fix-402 §1: NULL is not none, anywhere', () => {
  it('★★★ a NULL-parking unit renders "—", and an explicit none renders "None"', () => {
    expect(parkingKindLabel(null)).toBe(NOT_RECORDED);
    expect(parkingKindLabel(undefined)).toBe(NOT_RECORDED);
    expect(parkingKindLabel('none')).toBe('None');
    // ★★ The distinction the whole ticket exists for, in one line: two
    // different renderings for two different facts.
    expect(parkingKindLabel(null)).not.toBe(parkingKindLabel('none'));
  });

  it('★★★ a RECORDED ZERO is not a NULL — stalls', () => {
    expect(stallsLabel(null)).toBe(NOT_RECORDED);
    expect(stallsLabel(0)).toBe('0');
    expect(parseStalls('')).toBeNull();
    expect(parseStalls('0')).toBe(0);
  });

  it('★★★ a RECORDED FALSE is not a NULL — roof deck', () => {
    expect(roofDeckLabel(null)).toBe(NOT_RECORDED);
    expect(roofDeckLabel(false)).toBe('No');
    expect(roofDeckLabel(true)).toBe('Yes');
  });

  it('★★★ the PARSER never invents a default', () => {
    // The three temptations, all refused: an absent key must not become
    // 'none' / 0 / false. This is where a careless default would enter.
    const [u] = parseUnitTypes([{ label: 'A', width_ft: 1, depth_ft: 2, qty: 1 }]);
    expect(u!.parking_kind).toBeNull();
    expect(u!.parking_stalls).toBeNull();
    expect(u!.roof_deck).toBeNull();
  });

  it('★★ the parser rejects out-of-set and out-of-range values as NOT RECORDED', () => {
    const [u] = parseUnitTypes([
      { label: 'A', qty: 1, parking_kind: 'carport', parking_stalls: -3, roof_deck: 'yes' },
    ]);
    expect(u!.parking_kind).toBeNull();
    expect(u!.parking_stalls).toBeNull();
    expect(u!.roof_deck).toBeNull();
  });

  it('★★ ...but keeps every legitimate value, zero and false included', () => {
    const [u] = parseUnitTypes([
      { label: 'A', qty: 1, parking_kind: 'none', parking_stalls: 0, roof_deck: false },
    ]);
    expect(u!.parking_kind).toBe('none');
    expect(u!.parking_stalls).toBe(0);
    expect(u!.roof_deck).toBe(false);
  });

  it('★★★ a NULL unit fails a "garage" filter; an explicit none matches "none"', () => {
    expect(matchParkingKind(null, 'garage')).toBe(false);
    expect(matchParkingKind('none', 'garage')).toBe(false);
    // ★ Picking "None" is a real query, and it matches ONLY recorded nones.
    expect(matchParkingKind('none', 'none')).toBe(true);
    expect(matchParkingKind(null, 'none')).toBe(false);
    // ★ Any matches everything, including the unrecorded — the only state in
    //   which a NULL unit survives a unit filter.
    expect(matchParkingKind(null, '')).toBe(true);
  });

  it('★★ stalls and roof-deck filters drop NULLs too', () => {
    expect(matchStallsTier(null, '1+')).toBe(false);
    expect(matchStallsTier(0, '1+')).toBe(false);
    expect(matchStallsTier(1, '1+')).toBe(true);
    expect(matchStallsTier(1, '2+')).toBe(false);
    expect(matchStallsTier(null, '')).toBe(true);
    expect(matchRoofDeck(null, 'No')).toBe(false); // unanswered is not a No
    expect(matchRoofDeck(false, 'No')).toBe(true);
    expect(matchRoofDeck(null, '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 · The rollup
// ---------------------------------------------------------------------------

describe('fix-402 §2: the rollup chip refuses to overclaim', () => {
  it('★★ same kind everywhere → that kind, with the stall sum', () => {
    const r = parkingRollup([
      unit({ parking_kind: 'garage', parking_stalls: 2 }),
      unit({ parking_kind: 'garage', parking_stalls: 2 }),
    ]);
    expect(r.label).toBe('Garage · 4 stalls');
    expect(r.mixed).toBe(false);
    expect(r.partial).toBe(false);
  });

  it('★★ kinds disagree → "Mixed"', () => {
    const r = parkingRollup([
      unit({ parking_kind: 'garage', parking_stalls: 2 }),
      unit({ parking_kind: 'surface', parking_stalls: 2 }),
    ]);
    expect(r.mixed).toBe(true);
    expect(r.label).toBe('Mixed · 4 stalls');
  });

  it('★★★ nothing recorded → "—", and NOT "none" or "0 stalls"', () => {
    const r = parkingRollup([unit(), unit()]);
    expect(r.label).toBe(NOT_RECORDED);
    expect(r.stalls).toBeNull();
    expect(r.kind).toBeNull();
  });

  it('★★★ PARTIAL data is marked, not averaged over', () => {
    // The common case during the backfill: a confident "Garage · 2 stalls" read
    // off one of three units would give a reader no way to tell a finished
    // project from a half-entered one.
    const r = parkingRollup([
      unit({ parking_kind: 'garage', parking_stalls: 2 }),
      unit(),
      unit(),
    ]);
    expect(r.partial).toBe(true);
    expect(r.unrecordedKinds).toBe(2);
    expect(r.label).toBe('Garage · 2 stalls · 1 of 3 recorded');
  });

  it('★★ roof deck reads "N of M" over RECORDED units only', () => {
    expect(roofDeckRollup([unit(), unit()]).label).toBe(NOT_RECORDED);
    expect(
      roofDeckRollup([unit({ roof_deck: true }), unit({ roof_deck: false })]).label,
    ).toBe('1 of 2');
    // ★ An untouched project must not read "0 of 5" — that asserts five
    //   recorded noes.
    const mixed = roofDeckRollup([unit({ roof_deck: true }), unit(), unit()]);
    expect(mixed.label).toBe('1 of 1');
    expect(mixed.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §3 · Any-unit-matches, as a CONJUNCTION on one unit
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  view: 'site' as const,
  lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  zone: '', alley: '', productTypes: [], juris: '',
  isCornerLot: '', stories: '', parkingKind: '', stalls: '', roofDeck: '',
};

const row = (units: UnitType[]): LibraryRow => ({
  projectId: 'p1', address: '1 Main St', juris: 'Seattle', productTypes: [],
  units: units.length, zone: 'NR', lotWidth: 50, lotDepth: 100, alley: 'No',
  tags: [], stage: 'de', unitTypes: units, numLots: null, isCornerLot: null,
  isRegularShape: null,
  updatedAt: null,
});

describe('fix-402 §3: one unit must satisfy ALL the unit filters', () => {
  it('★★★ THE RULING — A(garage,no deck) + B(surface,deck) does NOT match garage AND deck', () => {
    // Under a per-FILTER reading this project would match: some unit is a
    // garage, some unit has a deck. Under the per-UNIT conjunction — the
    // ruling — it does not, because no single unit is both. A reader who
    // opened it would find no such unit exists.
    const r = row([
      unit({ label: 'A', parking_kind: 'garage', roof_deck: false }),
      unit({ label: 'B', parking_kind: 'surface', roof_deck: true }),
    ]);
    expect(
      filterLibraryRows([r], { ...BASE, parkingKind: 'garage', roofDeck: 'Yes' }),
    ).toEqual([]);
  });

  it('★★★ ...and it DOES match when one unit satisfies both', () => {
    const r = row([
      unit({ label: 'A', parking_kind: 'garage', roof_deck: true }),
      unit({ label: 'B', parking_kind: 'surface', roof_deck: false }),
    ]);
    const out = filterLibraryRows([r], {
      ...BASE, parkingKind: 'garage', roofDeck: 'Yes',
    });
    expect(out).toHaveLength(1);
    // ★ ...and only the qualifying unit is highlighted in the expansion.
    expect(matchingUnitIndices(out[0]!, { ...BASE, parkingKind: 'garage', roofDeck: 'Yes' }))
      .toEqual([0]);
  });

  it('★★ the conjunction spans the OLD filters too, not just the new ones', () => {
    // width/depth/stories were already per-unit (fix-81/205); parking joins
    // them on the same unit rather than beside them.
    const r = row([
      unit({ label: 'A', width_ft: 20, stories: 2, parking_kind: 'garage' }),
      unit({ label: 'B', width_ft: 40, stories: 3, parking_kind: 'surface' }),
    ]);
    expect(
      filterLibraryRows([r], { ...BASE, unitwTarget: 40, unitwBuf: 1, parkingKind: 'garage' }),
    ).toEqual([]);
    expect(
      filterLibraryRows([r], { ...BASE, unitwTarget: 20, unitwBuf: 1, parkingKind: 'garage' }),
    ).toHaveLength(1);
  });

  it('★★ a NULL-parking book matches nothing but Any — correct until the backfill', () => {
    const r = row([unit(), unit()]);
    expect(filterLibraryRows([r], { ...BASE, parkingKind: 'garage' })).toEqual([]);
    expect(filterLibraryRows([r], { ...BASE, stalls: '1+' })).toEqual([]);
    expect(filterLibraryRows([r], { ...BASE, roofDeck: 'No' })).toEqual([]);
    expect(filterLibraryRows([r], BASE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §4 · The archive, and the readers it left behind
// ---------------------------------------------------------------------------

const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, '');

/** ★ Comment leaders stripped and whitespace collapsed, so a "the ruling is
 *  recorded" assertion is about what a file SAYS rather than where its lines
 *  happen to wrap. Chasing wrap-safe fragments is how these rot (fix-400). */
const prose = (s: string) =>
  s.replace(/^\s*(\/\*+|\*+\/|\*|\/\/)/gm, ' ').replace(/\s+/g, ' ');
const stripTs = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('fix-402 §4: archive then clear, and the reader sweep', () => {
  it('★★★ it archives BEFORE it clears, and aborts on any mismatch', () => {
    const sql = stripSql(ARCHIVE_SQL);
    const insertAt = sql.indexOf('INSERT INTO public._parking_site_archive');
    const updateAt = sql.indexOf('UPDATE public.projects');
    expect(insertAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(insertAt); // archive first, always
    expect(sql).toContain('v_archived <> v_expected');
    expect(sql).toContain('v_cleared <> v_expected');
    expect(sql).toContain('v_left <> 0');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('★★ ...and proves the archive carries values, not empties', () => {
    expect(stripSql(ARCHIVE_SQL)).toContain(
      'WHERE parking_type IS NULL AND parking_stalls IS NULL',
    );
    expect(stripSql(ARCHIVE_SQL)).toContain('archive rows carry no value');
  });

  it('★★★ NOTHING pre-fills the new unit fields', () => {
    // The temptation was to seed each unit from its project's old site value.
    // A site that said "Garage" says nothing about unit 3 of 4, and a guess
    // that looks like an answer is worse than a NULL.
    // ★ Asserted on the EXECUTABLE statements: the table COMMENT deliberately
    //   names projects.unit_types to point a reader at where parking went, so
    //   a whole-file match would hit the signpost rather than a write.
    const dml = stripSql(ARCHIVE_SQL).replace(/COMMENT ON TABLE[\s\S]*?;/g, ' ');
    expect(dml).not.toMatch(/unit_types/);
    expect(dml).not.toMatch(/parking_kind|roof_deck/);
  });

  it('★★ the Project Overview site block no longer renders parking', () => {
    const src = stripTs(projectHeaderSource);
    expect(src).not.toContain('pd-site-parking');
    expect(src).not.toContain('pd-site-stalls');
    // ★ ...and the ruling is recorded where they were removed.
    expect(projectHeaderSource).toContain('PARKING LEFT THE SITE SECTION');
  });

  it('★★ the corrections report dropped its parking segment', () => {
    // The fix-122 trap in reverse: a reader left pointing at a cleared column
    // renders "—" forever without erroring. This one would have bucketed every
    // project under a single "—".
    expect(stripTs(segmentsSource)).not.toContain("key: 'parking_type'");
    expect(prose(segmentsSource)).toContain('That is the fix-122 trap in reverse');
  });
});

// ---------------------------------------------------------------------------
// §5 · The filter split
// ---------------------------------------------------------------------------

describe('fix-402 §5: two cards, and the Lots filter is gone', () => {
  it('★★★ the Lots FILTER is removed, with the ruling recorded', () => {
    const src = stripTs(libraryMatrixSource);
    expect(src).not.toContain('filter-num-lots');
    expect(prose(libraryMatrixSource)).toContain(
      'we dont need it as a filtering option for this screen',
    );
  });

  it('★★★ ...and fix-406 took the COLUMN too, one day later', () => {
    // ★★ THIS TEST USED TO ASSERT THE OPPOSITE, and it was right to.
    //
    //   2026-08-25: *"we dont need it as a filtering option for this screen"*
    //               → filter gone, column kept, and this test pinned the
    //                 distinction: `library-num-lots-` and `row.numLots`
    //                 both still present in the source.
    //   2026-08-26: *"we can remove lots from the vertical bar below for the
    //                 sort column as it isnt really relevant here."*
    //               → the column and its sort go too.
    //
    // SUPERSEDED, NOT MISTAKEN (fix-400's rule). fix-402 read the evidence it
    // had correctly; the ruling widened. The assertion inverts, and the old
    // one is quoted here so the reversal is a decision on the record rather
    // than a test that quietly changed sign.
    const src = stripTs(libraryMatrixSource);
    expect(src).not.toContain('library-num-lots-');
    expect(src).not.toContain('row.numLots');
    // ★ And the second ruling is recorded in the source, next to the first.
    expect(prose(libraryMatrixSource)).toContain(
      'we can remove lots from the vertical bar below for the sort column',
    );
  });

  it('★★ SITE and UNIT are two bordered cards with coloured chips', () => {
    const src = stripTs(libraryMatrixSource);
    expect(src).toContain('filter-card-site');
    expect(src).toContain('filter-card-unit');
    expect(src).toContain('filter-chip-site');
    expect(src).toContain('filter-chip-unit');
  });

  it('★★★ ALLEY AND CORNER ARE ON THE SITE CARD — Bobby\'s own correction', () => {
    const src = stripTs(libraryMatrixSource);
    const siteAt = src.indexOf('filter-card-site');
    const unitAt = src.indexOf('filter-card-unit');
    expect(siteAt).toBeGreaterThan(-1);
    expect(unitAt).toBeGreaterThan(siteAt);
    // ★ fix-483 §2: 'filter-tag' left this list with the Tag filter (Bobby,
    //   2026-09-02). The claim — lot-shaped filters live on the SITE card — is
    //   unchanged and is what the four remaining ids still prove.
    for (const id of ['filter-alley', 'filter-corner', 'filter-zone', 'filter-juris']) {
      const at = src.indexOf(id);
      expect(at, `${id} must sit in the SITE card`).toBeGreaterThan(siteAt);
      expect(at, `${id} must sit in the SITE card`).toBeLessThan(unitAt);
    }
    // ...and the unit-shaped ones sit after it.
    for (const id of ['filter-parking-kind', 'filter-stalls', 'filter-roof-deck', 'filter-stories']) {
      expect(src.indexOf(id), `${id} must sit in the UNIT card`).toBeGreaterThan(unitAt);
    }
  });

  it('★★ the existing filters keep their MEANING — they moved house only', () => {
    // Corner is still tri-state with NULLs falling out (fix-122); stories still
    // matches at-least-one-unit (fix-205). Asserted behaviourally, not by
    // reading the markup.
    const r = row([unit({ stories: 2 })]);
    const withCorner = { ...r, isCornerLot: null };
    expect(filterLibraryRows([withCorner], { ...BASE, isCornerLot: 'No' })).toEqual([]);
    expect(filterLibraryRows([r], { ...BASE, stories: '2' })).toHaveLength(1);
    expect(filterLibraryRows([r], { ...BASE, stories: '3' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 · The fix-401 remainder
// ---------------------------------------------------------------------------

describe('fix-402 §6: the 9 co-assignee rows, through the sanctioned path', () => {
  it('★★★ every value comes from fix-368\'s rule function, not from a literal', () => {
    const sql = stripSql(COASSIGN_SQL);
    expect(sql).toContain('public.bp_coassign_for_task');
    // ★★ No manager's name is hand-written anywhere in the statement.
    expect(sql).not.toMatch(/'Derry'/);
    // Jade appears only in the before/after ASSERTIONS, never as a written value.
    expect(sql).not.toMatch(/assignee\s*=\s*'Jade'/);
  });

  it('★★ manual co-assignees are never withdrawn by a machine (fix-346)', () => {
    const sql = stripSql(COASSIGN_SQL);
    expect(sql).toMatch(/source IN \('dm_of_da', 'dm_of_project'\)/);
    expect(sql).not.toMatch(/source\s*=\s*'manual'/);
  });

  it('★★ open tasks only, and it self-verifies before committing', () => {
    const sql = stripSql(COASSIGN_SQL);
    expect(sql).toContain('bp_task_is_open');
    expect(sql).toContain('still name Jade');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('★★ the trigger could not express it, and the file says why', () => {
    // bp_trg_task_coassign_dm returns early when assigned_to is unchanged
    // (fix-346's guard), so `SET assigned_to = assigned_to` is a no-op — the
    // same shape that refused fix-401's `SET dm = dm`.
    expect(COASSIGN_SQL).toContain('WHY THE TRIGGER COULD NOT DO IT');
    expect(COASSIGN_SQL).toContain('GROUP C CONTRACT');
  });
});
