import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReactNode } from 'react';
import type { ScraperActivityRow } from '../lib/database.types';

// ===========================================================================
// fix-619 (P-166 step 4b, P-173, P-312) — the lists in Settings drive every
// filter · a duplicate address gets a plain message
// ===========================================================================
//
// fix-321's rule: CHOOSING is current-only; SHOWING is whatever is recorded.
// A filter offers the Settings list PLUS any stored value the list no longer
// has, MARKED — and nothing else.

const reg = vi.hoisted(() => ({
  current: {
    jurisdictions: [] as string[],
    permitTypes: [] as string[],
    productTypes: [] as string[],
    projectTags: [] as string[],
    zones: [] as string[],
    entPeople: [] as string[],
  },
}));
vi.mock('../hooks/useFilterRegistries', () => ({
  useFilterRegistries: () => reg.current,
}));

function mkRow(over: Partial<ScraperActivityRow> = {}): ScraperActivityRow {
  return {
    id: 1,
    created_at: '2026-09-30T18:00:00Z',
    action: 'scrape_change_applied',
    row_id: '100',
    changes: { applied: { status: 'Issued' }, db: { status: 'Reviews In Process' } },
    permit_num: '7101215-DM',
    permit_type: 'Demolition',
    address: '3670 Interlake Ave N',
    juris: 'Seattle',
    cycle_index: null,
    ent_lead: 'Bobby',
    portal_url: null,
    project_id: '00000000-0000-0000-0000-000000000aaa',
    ...over,
  };
}
const ROWS: ScraperActivityRow[] = [
  mkRow({ id: 1, ent_lead: 'Bobby' }),
  mkRow({ id: 2, ent_lead: 'Dana', address: '200 Oak Ave', permit_num: 'BP-2' }),
  // A lead no longer on the roster — still findable, marked.
  mkRow({ id: 3, ent_lead: 'Old Lead', address: '500 Pike St', permit_num: 'BP-3' }),
];
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: ROWS, isLoading: false, error: null, refetch: vi.fn() }),
  SCRAPER_ACTIVITY_DAYS_DEFAULT: 14,
  SCRAPER_ACTIVITY_ROW_CAP: 300,
  useScraperActivitySummary: () => ({ data: null }),
}));

import ActivityPage from '../pages/ActivityPage';
import { useNotificationStore } from '../stores/notificationStore';
import FilterDropdown from '../components/FilterDropdown';
import { filterOptionLabel, filterOptions, UNLISTED_MARKER } from '../lib/filterOptions';
import {
  duplicateAddressSentence,
  expectedUniqueRefusal,
  shouldSkipBackendRpcLog,
} from '../lib/errorLogger';
import { APP_CONFIG_KEY_LABELS, humanizeKey } from '../hooks/useSetAppConfigKey';
import {
  CANONICAL_ROOF_DECK,
  PARKING_OPTIONS_KEY,
  ROOF_DECK_OPTIONS_KEY,
  STORIES_OPTIONS_KEY,
  isStorableVocabularyEntry,
  matchRoofDeckOption,
  roofDeckLabel,
  roofDeckValueFor,
  vocabularyTooltip,
} from '../lib/unitVocabulary';
import { ZONE_OPTIONS_KEY } from '../lib/zoneOptions';
import { JURISDICTION_LINKS_KEY } from '../lib/jurisdictionLinks';
import { PERMIT_DESCRIPTIONS_KEY } from '../hooks/usePermitDescriptions';
import { WAITING_ON_CONFIG_KEY } from '../lib/waitingOn';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import { RoofDeckSelect } from '../components/shared/UnitParkingInputs';

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');
/** Code only — a comment that names a pattern must not satisfy a scan. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.getState()._reset();
  reg.current = {
    jurisdictions: [],
    permitTypes: [],
    productTypes: [],
    projectTags: [],
    zones: [],
    entPeople: [],
  };
});
afterEach(() => localStorage.clear());

// ---------------------------------------------------------------------------
describe('fix-619: what a filter offers', () => {
  it('★★★ the registry, then a stored-but-unlisted value marked — nothing else', () => {
    const set = filterOptions(
      ['Seattle', 'Bellevue', 'Kirkland'],
      ['Bellevue', 'Seatle', null, '', '  Seattle  ', 'Seatle'],
    );
    // Registry order first (a city with no project is still offered), then the
    // straggler. The blank, the null and the duplicate add nothing.
    expect(set.options).toEqual(['Seattle', 'Bellevue', 'Kirkland', 'Seatle']);
    expect([...set.unlisted]).toEqual(['Seatle']);
    expect(filterOptionLabel('Seatle', set)).toBe(`Seatle${UNLISTED_MARKER}`);
    expect(filterOptionLabel('Kirkland', set)).toBe('Kirkland');
  });

  it('★★ a rendered filter marks the straggler and only the straggler', () => {
    const set = filterOptions(['Townhome', 'SFR'], ['SFR', 'Legacy Type']);
    render(
      <FilterDropdown
        label="Product type"
        options={set.options}
        unlisted={set.unlisted}
        selected={new Set()}
        onChange={() => {}}
        testId="f619"
      />,
    );
    fireEvent.click(screen.getByTestId('f619').querySelector('button') ?? screen.getByTestId('f619'));
    expect(screen.getByTestId('f619-unlisted-Legacy Type')).toHaveTextContent(UNLISTED_MARKER.trim());
    expect(screen.queryByTestId('f619-unlisted-Townhome')).toBeNull();
    expect(screen.queryByTestId('f619-unlisted-SFR')).toBeNull();
  });

  // ★★★ Every filter the census named builds its options through the ONE
  //     helper, from a Settings registry — never from the stored data alone.
  const SITES: Array<[string, RegExp[]]> = [
    ['src/components/Reports/ReportsOverviewTab.tsx', [
      /filterOptions\(registries\.permitTypes,/,
      /filterOptions\(registries\.jurisdictions,/,
      /filterOptions\(registries\.entPeople,/,
      /filterOptions\(registries\.productTypes,/,
      /filterOptions\(registries\.projectTags,/,
    ]],
    ['src/components/Dashboard/StageFilters.tsx', [/filterOptions\(/]],
    ['src/pages/Trends.tsx', [/filterOptions\(/]],
    ['src/pages/ProjectList.tsx', [/filterOptions\(/]],
    ['src/pages/PhaseDurationsReport.tsx', [/filterOptions\(/]],
    ['src/pages/WeeklyDaReport.tsx', [/filterOptions\(/]],
    ['src/pages/CorrectionsReport.tsx', [/filterOptions\(registries\.permitTypes,/, /filterOptions\(/]],
    ['src/pages/MyTasks.tsx', [/filterOptions\(/]],
    ['src/components/Reports/RedesignsTab.tsx', [/filterOptions\(/]],
    ['src/components/Reports/TeamTab.tsx', [/filterOptions\(/]],
    ['src/components/LibraryMatrix.tsx', [
      /filterOptions\(jurisRegistry,/,
      /filterOptions\(zoneRegistry,/,
    ]],
    ['src/pages/ActivityPage.tsx', [/filterOptions\(entPeople,/]],
  ];
  for (const [rel, patterns] of SITES) {
    it(`★★ ${rel} builds its filter from the Settings list`, () => {
      const body = code(read(rel));
      for (const p of patterns) expect(body, String(p)).toMatch(p);
    });
  }
});

// ---------------------------------------------------------------------------
describe('fix-619 gaps 13 + two homes: one jurisdiction list', () => {
  it('★★★ nothing in src reads app_config.jurisdictions or app_config.permitTypes', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx)$/.test(name)) {
          const body = code(read(p));
          if (/(readAppConfigStringArray|\.get)\([^)]*'(jurisdictions|permitTypes)'\)/.test(body)) {
            hits.push(p);
          }
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(hits).toEqual([]);
  });

  it('★★ the Library juris EDITOR offers the table (the registry), not the data', () => {
    const body = code(read('src/components/LibraryMatrix.tsx'));
    expect(body).toMatch(/jurisRegistry\.length > 0 \? jurisRegistry : jurisOptions\.options/);
    expect(body).not.toMatch(/'jurisdictions'/);
  });
});

// ---------------------------------------------------------------------------
describe('fix-619 gap 20: the Activity lead filter is the roster', () => {
  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/activity']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    return render(<ActivityPage />, { wrapper });
  }
  const menuNames = () => {
    fireEvent.click(screen.getByTestId('activity-ent-toggle'));
    const menu = screen.getByTestId('activity-ent-menu');
    return Array.from(menu.querySelectorAll('input[data-testid^="activity-ent-opt-"]')).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('activity-ent-opt-', ''),
    );
  };

  it('★★★ offers the roster ENT people + a stored lead (marked) — no typed three', () => {
    reg.current = { ...reg.current, entPeople: ['Bobby', 'Dana', 'Priya'] };
    renderPage();
    expect(menuNames()).toEqual(['Bobby', 'Dana', 'Priya', 'Old Lead']);
    // ★ Briana and Miles were the typed defaults — not on this roster, not on a row.
    expect(screen.queryByTestId('activity-ent-opt-Briana')).toBeNull();
    expect(screen.getByTestId('activity-ent-unlisted-Old Lead')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-ent-unlisted-Dana')).toBeNull();
  });

  it('★★★ a new lead\'s rows are SHOWN by default (the old default hid them)', () => {
    reg.current = { ...reg.current, entPeople: ['Bobby', 'Dana'] };
    renderPage();
    expect(screen.getByTestId('activity-ent-toggle')).toHaveTextContent('All leads');
    expect(screen.getByTestId('activity-group-200 Oak Ave')).toBeInTheDocument();
  });

  it('★★ the selection the old default wrote for everyone reads as "everyone"', () => {
    localStorage.setItem('bp_activity_ent_filter', JSON.stringify(['Bobby', 'Briana', 'Miles']));
    reg.current = { ...reg.current, entPeople: ['Bobby', 'Dana'] };
    renderPage();
    expect(screen.getByTestId('activity-ent-toggle')).toHaveTextContent('All leads');
    expect(screen.getByTestId('activity-group-200 Oak Ave')).toBeInTheDocument();
  });

  it('★ a real narrowed choice is still kept', () => {
    localStorage.setItem('bp_activity_ent_filter', JSON.stringify(['Dana']));
    reg.current = { ...reg.current, entPeople: ['Bobby', 'Dana'] };
    renderPage();
    expect(screen.getByTestId('activity-ent-toggle')).toHaveTextContent('Dana');
    expect(screen.queryByTestId('activity-group-3670 Interlake Ave N')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-619 gap 18: a roof deck option added in Settings saves', () => {
  it('★★★ an undecoded pick is stored AS ITSELF; the three still decode', () => {
    expect(roofDeckValueFor('Rooftop terrace')).toEqual({
      deck: null,
      penthouse: null,
      label: 'Rooftop terrace',
    });
    expect(roofDeckValueFor('W/ PH')).toEqual({ deck: true, penthouse: true, label: null });
    for (const ok of CANONICAL_ROOF_DECK) expect(roofDeckValueFor(ok).label).toBeNull();
    expect(isStorableVocabularyEntry(ROOF_DECK_OPTIONS_KEY, 'Rooftop terrace')).toBe(true);
  });

  it('★★★ the parser KEEPS the label (a whitelist would delete it on the next save)', () => {
    const [u] = parseUnitTypes([{ label: 'A', roof_deck: null, penthouse: null, roof_deck_label: 'Rooftop terrace' }]);
    expect(u.roof_deck_label).toBe('Rooftop terrace');
    expect(roofDeckLabel(u.roof_deck, u.penthouse, u.roof_deck_label)).toBe('Rooftop terrace');
    expect(matchRoofDeckOption(u.roof_deck, u.penthouse, 'Rooftop terrace', u.roof_deck_label)).toBe(true);
    // ★ A unit holding one of the three is unchanged — no new key appears.
    const [plain] = parseUnitTypes([{ label: 'B', roof_deck: true, penthouse: false }]);
    expect('roof_deck_label' in plain).toBe(false);
    expect(roofDeckLabel(plain.roof_deck, plain.penthouse, plain.roof_deck_label)).toBe('W/O PH');
  });

  it('★★★ the select hands the label up instead of dropping the pick', () => {
    const onChange = vi.fn();
    render(
      <RoofDeckSelect
        deck={null}
        penthouse={null}
        options={['W/ PH', 'W/O PH', 'None', 'Rooftop terrace']}
        onChange={onChange}
        testid="rd"
      />,
    );
    fireEvent.change(screen.getByTestId('rd'), { target: { value: 'Rooftop terrace' } });
    expect(onChange).toHaveBeenCalledWith({ deck: null, penthouse: null, label: 'Rooftop terrace' });
  });

  it('★★ the select SHOWS a stored label', () => {
    render(
      <RoofDeckSelect
        deck={null}
        penthouse={null}
        storedLabel="Rooftop terrace"
        options={['W/ PH', 'W/O PH', 'None', 'Rooftop terrace']}
        onChange={() => {}}
        testid="rd2"
      />,
    );
    expect((screen.getByTestId('rd2') as HTMLSelectElement).value).toBe('Rooftop terrace');
  });

  it('★★ both editors that can write the label write it', () => {
    expect(code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'))).toMatch(
      /roof_deck_label: v\?\.label \?\? null/,
    );
    expect(code(read('src/components/LibraryMatrix.tsx'))).toMatch(/roof_deck_label: v\?\.label \?\? null/);
  });
});

// ---------------------------------------------------------------------------
describe('fix-619 gap 19: tooltips read the lists', () => {
  it('★★ a tooltip names whatever the list holds', () => {
    const t = vocabularyTooltip('Parking.', ['1-car garage', '5-car garage']);
    expect(t).toContain('5-car garage');
    expect(t).not.toContain('4-car garage');
  });
  it('★ no typed vocabulary is left in the unit tooltips', () => {
    const boxes = code(read('src/components/ProjectDetail/ProjectOverviewBoxes.tsx'));
    expect(boxes).not.toContain('1-car garage through 4-car garage');
    expect(boxes).not.toContain('W/ PH with penthouse');
    expect(code(read('src/lib/unitConfigFields.ts'))).not.toContain('1-car garage through 4-car garage');
  });
});

// ---------------------------------------------------------------------------
describe('fix-619 gap 25: every key Settings writes has a plain label', () => {
  const CONSTANTS: Record<string, string> = {
    ZONE_OPTIONS_KEY,
    PARKING_OPTIONS_KEY,
    ROOF_DECK_OPTIONS_KEY,
    STORIES_OPTIONS_KEY,
    JURISDICTION_LINKS_KEY,
    PERMIT_DESCRIPTIONS_KEY,
    WAITING_ON_CONFIG_KEY,
  };
  it('★★★ humanizeKey covers every key a setKey.mutate call writes', () => {
    const keys = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__') walk(p);
        } else if (/\.tsx?$/.test(name)) {
          const body = code(read(p));
          for (const m of body.matchAll(/setKey\.mutate(?:Async)?\(\{\s*key:\s*('([^']+)'|[A-Z_]+)/g)) {
            if (m[2]) keys.add(m[2]);
            else {
              const v = CONSTANTS[m[1]];
              expect(v, `unknown key constant ${m[1]} — add it here`).toBeDefined();
              keys.add(v);
            }
          }
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(keys.size).toBeGreaterThanOrEqual(11);
    for (const k of keys) {
      expect(APP_CONFIG_KEY_LABELS[k], k).toBeDefined();
      expect(humanizeKey(k)).not.toBe(k);
    }
  });
});

// ---------------------------------------------------------------------------
describe('fix-619 §Z (P-312): a duplicate address is a refusal, not a fault', () => {
  const dup = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "projects_address_unique_non_redesign"',
    details: 'Key (lower(address))=(123 cloverdale st) already exists.',
  };
  const other = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "team_members_name_role_key"',
    details: 'Key (name, role)=(Dana, DA) already exists.',
  };

  it('★★★ shows the plain sentence and is NOT filed to Triage', () => {
    expect(expectedUniqueRefusal(dup)).toBe('Another project already has this address.');
    expect(duplicateAddressSentence('123 Cloverdale St')).toContain('123 Cloverdale St');
    expect(duplicateAddressSentence(null)).toBe('Another project already has this address.');
    expect(shouldSkipBackendRpcLog(dup, ['projects'])).toBe(true);
  });

  it('★★★ …and any OTHER unique violation still reports', () => {
    expect(expectedUniqueRefusal(other)).toBeNull();
    expect(shouldSkipBackendRpcLog(other, ['team_members'])).toBe(false);
  });

  it('★★ both project save hooks say the sentence instead of the raw error', () => {
    expect(code(read('src/hooks/useUpdateProjectWithPermits.ts'))).toMatch(
      /expectedUniqueRefusal\(error\)[\s\S]{0,200}duplicateAddressSentence\(/,
    );
    expect(code(read('src/hooks/useUpdateProject.ts'))).toMatch(
      /expectedUniqueRefusal\(error\)[\s\S]{0,200}duplicateAddressSentence\(/,
    );
  });
});
