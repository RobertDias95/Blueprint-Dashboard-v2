import { describe, it, expect } from 'vitest';
import {
  matchesPermitNumber,
  multiMatchAddressOrPermit,
  permitNumberKey,
  permitNumbersOf,
  tokensMatchWithPermitNumbers,
} from '../lib/permitNumberSearch';
import { multiMatchAddress } from '../lib/drawScheduleHelpers';
import { matchesLedgerSearch, type ProjectRow } from '../lib/reportMetrics';
import { searchIntakes } from '../lib/intakeHelpers';
import { filterRows, type SnapshotRow } from '../lib/weeklySnapshot';
import { filterReuseSources, type ReuseSource } from '../components/wizard/reuseSourceHelpers';
import { matchesSearch as matchesActivitySearch } from '../lib/scraperActivity';
import type { IntakeRecord, ScraperActivityRow } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-665 (P-348) — every search box finds a permit number
// ===========================================================================
//
// Bobby, 2026-10-13: "miles noticed that the search queue doesnt work for
// permit numbers, can we include that?" Real numbers from prod, one per shape:
// Seattle `7110427-CN`, Kirkland `LSM26-01495` (dash in the middle), Bellevue
// `26 108851 GD` (spaces).

const SEATTLE = '7110427-CN';
const KIRKLAND = 'LSM26-01495';
const BELLEVUE = '26 108851 GD';

describe('fix-665: the shared matcher', () => {
  it('the key drops case, spaces and dashes', () => {
    expect(permitNumberKey(SEATTLE)).toBe('7110427cn');
    expect(permitNumberKey(BELLEVUE)).toBe('26108851gd');
    expect(permitNumberKey(null)).toBe('');
  });

  it.each([
    // [typed, number, matches]
    ['7110427-CN', SEATTLE, true], // full
    ['7110427', SEATTLE, true], // digits only
    ['71104', SEATTLE, true], // partial
    ['7110427cn', SEATTLE, true], // no dash
    ['7110427 CN', SEATTLE, true], // a space for the dash
    ['7110427-cn', SEATTLE, true], // case
    ['LSM26-01495', KIRKLAND, true],
    ['2601495', KIRKLAND, true], // digits only across the dash
    ['26014', KIRKLAND, true],
    ['lsm2601495', KIRKLAND, true],
    ['26108851', BELLEVUE, true], // digits only across the spaces
    ['26-108851-gd', BELLEVUE, true],
    ['7110428', SEATTLE, false], // a different number
    ['cn', SEATTLE, false], // ★ no digit, never a permit-number match
    ['', SEATTLE, false],
    ['  - ', SEATTLE, false],
  ])('%s vs %s → %s', (typed, num, want) => {
    expect(matchesPermitNumber(typed, [num])).toBe(want);
  });

  it('any of the row’s numbers counts, and blanks are skipped', () => {
    expect(matchesPermitNumber('2601495', [null, '', SEATTLE, KIRKLAND])).toBe(true);
    expect(matchesPermitNumber('2601495', [])).toBe(false);
    expect(permitNumbersOf([{ num: ' 7110427-CN ' }, { num: null }, { num: '' }, {}])).toEqual([
      '7110427-CN',
    ]);
  });

  it('★★ keeps the box’s AND: every token must hit the haystack or a permit number', () => {
    const hay = '12238 4th ave nw';
    expect(tokensMatchWithPermitNumbers('4th 7110427', ['4th', '7110427'], hay, [SEATTLE])).toBe(true);
    expect(tokensMatchWithPermitNumbers('pike 7110427', ['pike', '7110427'], hay, [SEATTLE])).toBe(false);
    // The whole query as ONE number — `cn` alone is not a permit number.
    expect(tokensMatchWithPermitNumbers('7110427 cn', ['7110427', 'cn'], hay, [SEATTLE])).toBe(true);
  });

  it('★★ with no permit numbers it IS multiMatchAddress', () => {
    for (const [q, hay] of [
      ['4th ave', '12238 4th Ave NW'],
      ['4th pike', '12238 4th Ave NW'],
      ['', 'anything'],
      ['7110427', '12238 4th Ave NW'],
    ]) {
      expect(multiMatchAddressOrPermit(q, hay, [])).toBe(multiMatchAddress(q, hay));
    }
  });
});

describe('fix-665: each box’s helper finds a row by permit number', () => {
  it('Reports table (ledger) — digits across a dash', () => {
    const row = {
      address: '11231 NE 67th St',
      juris: 'Kirkland',
      permits: [{ permit: { num: KIRKLAND }, productTypes: [] }],
    } as unknown as ProjectRow;
    expect(matchesLedgerSearch(row, '2601495')).toBe(true);
    expect(matchesLedgerSearch(row, 'kirkland, 26014')).toBe(true); // comma AND kept
    expect(matchesLedgerSearch(row, 'seattle, 26014')).toBe(false);
  });

  it('Intake tracker — by its permit number, even with no address', () => {
    const a = { id: 1, address: '12238 4th Ave NW', permit_num: SEATTLE } as IntakeRecord;
    const b = { id: 2, address: null, permit_num: KIRKLAND } as IntakeRecord;
    expect(searchIntakes([a, b], '7110427').map((r) => r.id)).toEqual([1]);
    expect(searchIntakes([a, b], '2601495').map((r) => r.id)).toEqual([2]);
    expect(searchIntakes([a, b], '4th').map((r) => r.id)).toEqual([1]);
  });

  it('Weekly Update snapshot — whole-phrase box, now dash/space-blind', () => {
    const rows = [
      { permit_id: 1, num: BELLEVUE, address: 'x' },
      { permit_id: 2, num: SEATTLE, address: 'y' },
    ] as SnapshotRow[];
    expect(filterRows(rows, '26108851').map((r) => r.permit_id)).toEqual([1]);
    expect(filterRows(rows, '7110427cn').map((r) => r.permit_id)).toEqual([2]);
  });

  it('wizard reuse picker — a permit number on the plan’s project', () => {
    const s = {
      id: 'p1',
      address: '12238 4th Ave NW',
      juris: 'Seattle',
      zone: null,
      primaryDa: null,
      product_types: [],
      permitNums: [SEATTLE],
    } as unknown as ReuseSource;
    expect(filterReuseSources([s], '71104')).toHaveLength(1);
    expect(filterReuseSources([s], '71105')).toHaveLength(0);
  });

  it('Activity — digits across a dash', () => {
    const row = { address: '11231 NE 67th St', permit_num: KIRKLAND } as ScraperActivityRow;
    expect(matchesActivitySearch(row, '2601495', [])).toBe(true);
    expect(matchesActivitySearch(row, 'lsm26-01495', [])).toBe(true);
    expect(matchesActivitySearch(row, '2601496', [])).toBe(false);
  });
});
