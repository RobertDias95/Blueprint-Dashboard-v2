import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import zoneMigrationSql from '../../migrations/fix_415_zone_registry_and_remap.sql?raw';
import lotMigrationSql from '../../migrations/fix_415_round_lot_dimensions.sql?raw';
import settingsSource from '../lib/settingsSections.ts?raw';
import headerSource from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import psmSource from '../components/ProjectDetail/ProjectSettingsModal.tsx?raw';
import wizardSource from '../components/NewProjectWizard.tsx?raw';
import step1Source from '../components/wizard/Step1ProjectInfo.tsx?raw';
import {
  CANONICAL_ZONES,
  ZONE_OPTIONS_KEY,
  isRetiredZone,
  zoneOptions,
} from '../lib/zoneOptions';
import { roundLotForStorage } from '../lib/lotDimensions';
import { filterLibraryRows, type LibraryFilters, type LibraryRow } from '../lib/libraryHelpers';
import { SETTINGS_SECTIONS } from '../lib/settingsSections';

// ===========================================================================
// fix-415 — zone becomes a registry, lot dimensions round in the database,
//           and the Settings section gets a name that says what it holds
// ===========================================================================
//
// ★★★ STEP 0's ANSWER, pinned here because it decided where the rounding goes:
//
// `zone`, `lot_width` and `lot_depth` are written by THREE paths, not one:
//
//   1. the Project Overview SITE card → `useUpdateProject` → a **direct
//      PostgREST table UPDATE**. This is the one people actually use, and it
//      touches NEITHER RPC.
//   2. the Project Settings modal → `bp_update_project_with_permits`.
//   3. the setup wizard → `bp_create_project_with_permits`.
//
// fix-410 established path 1 the hard way: `is_corner_lot` is absent from the
// update RPC's SET list entirely, because the Site editor never goes through
// it. So rounding server-side in the RPCs would have left the SITE card — the
// busiest surface — still storing 100.47. The rounding is on all three commits.

/** ★★ COMMENT-STRIPPED. Every file below now EXPLAINS what this suite asserts
 *  is absent, so a raw `not.toContain` matches the note describing the fix. The
 *  trap fix-387/390/395/405/406/411/412 each hit; the eighth time. */
const strip = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .split(/\r?\n/)
    .map((l) => (l.trim().startsWith('//') || l.trim().startsWith('--') ? '' : l.replace(/\s\/\/.*$/, '')))
    .join('\n');

// ---------------------------------------------------------------------------
// §A1 · THE MIGRATION, MIRRORED IN TS
// ---------------------------------------------------------------------------
//
// ★★★ There is no database in CI, so the migration's ARITHMETIC is reproduced
// here against the raw population measured on prod 2026-08-26. If the remap
// changes, these counts change and this fails — which is the property the brief
// asked for ("fails if any row lands outside the 21").

/** The 33 raw spellings and their prod counts, read off the database. */
const RAW_ZONES: ReadonlyArray<readonly [string, number]> = [
  ['NR', 125], ['NR3', 13], ['RS 7.2', 6], ['LR1', 3], ['LR1 (M)', 3],
  ['LR3', 3], ['MIO-37-LR3 (M)', 3], ['RS 8.5', 3], ['RSX 7.2', 3],
  ['LDR-S', 2], ['R-3', 2], ['RE-24', 2], ['RM 1.5', 2], ['RM 3.6', 2],
  ['LR 1', 1], ['LR 1 (M)', 1], ['LR 2 (M)', 1], ['LR 3 (M)', 1],
  ['LR1 (M1)', 1], ['LR1 M', 1], ['LR2', 1], ['LR2(M)', 1], ['LR3 (M)', 1],
  ['NC2-40(M)', 1], ['NR@', 1], ['NRW', 1], ['R-M1', 1], ['RE-43', 1],
  ['RS 5.0', 1], ['RSL', 1], ['RSL (M)', 1], ['SR-1', 1], ['SR-4', 1],
];

/** The 14 spellings the migration moves — the same VALUES list, in TS. */
const REMAP: Readonly<Record<string, string>> = {
  'LR1 (M)': 'LR1',
  'LR 1': 'LR1',
  'LR 1 (M)': 'LR1',
  'LR1 (M1)': 'LR1',
  'LR1 M': 'LR1',
  'LR 2 (M)': 'LR2',
  'LR2(M)': 'LR2',
  'LR 3 (M)': 'LR3',
  'LR3 (M)': 'LR3',
  'MIO-37-LR3 (M)': 'MIO-37-LR3',
  'NC2-40(M)': 'NC2-40',
  'RSL (M)': 'RSL',
  'NR@': 'NR',
  NRW: 'NR',
};

const EXPECTED: Readonly<Record<string, number>> = {
  NR: 127, NR3: 13, LR1: 10, 'RS 7.2': 6, LR3: 5, 'MIO-37-LR3': 3, LR2: 3,
  'RS 8.5': 3, 'RSX 7.2': 3, 'LDR-S': 2, 'R-3': 2, 'RE-24': 2, 'RM 1.5': 2,
  'RM 3.6': 2, RSL: 2, 'NC2-40': 1, 'R-M1': 1, 'RE-43': 1, 'RS 5.0': 1,
  'SR-1': 1, 'SR-4': 1,
};

describe('fix-415 §A: the remap reproduces all 21 counts', () => {
  it('★★★ every one of the 21 canonical counts, exactly', () => {
    const got: Record<string, number> = {};
    for (const [raw, n] of RAW_ZONES) {
      const canon = REMAP[raw] ?? raw;
      got[canon] = (got[canon] ?? 0) + n;
    }
    expect(got).toEqual(EXPECTED);
  });

  it('★★★ NOTHING lands outside the 21 — the brief\'s stop condition', () => {
    for (const [raw] of RAW_ZONES) {
      const canon = REMAP[raw] ?? raw;
      expect(CANONICAL_ZONES).toContain(canon);
    }
  });

  it('★★★ exactly 18 rows move, and 191 keep a zone', () => {
    const moved = RAW_ZONES.filter(([raw]) => REMAP[raw] !== undefined)
      .reduce((a, [, n]) => a + n, 0);
    expect(moved).toBe(18);
    const total = RAW_ZONES.reduce((a, [, n]) => a + n, 0);
    expect(total).toBe(191);
    // ★ Five projects keep NO zone. Null is not a 22nd zone, and the migration
    //   asserts that server-side too.
    expect(total + 5).toBe(196);
  });

  it('★★ the registry is Bobby\'s 21, and the code and the migration agree', () => {
    expect(CANONICAL_ZONES).toHaveLength(21);
    expect(new Set(CANONICAL_ZONES).size).toBe(21);
    const sql = strip(zoneMigrationSql);
    for (const z of CANONICAL_ZONES) expect(sql).toContain(`"${z}"`);
    // ★ The (M) suffix is dropped ENTIRELY — not kept as a name.
    expect(CANONICAL_ZONES.some((z) => /\(M1?\)|\sM$/.test(z))).toBe(false);
  });

  it('★★★ MIO-37-LR3 is its OWN entry, not folded into LR3', () => {
    // The MIO overlay changes what can be built, so the two are different
    // answers to "what is this lot zoned".
    expect(CANONICAL_ZONES).toContain('MIO-37-LR3');
    expect(REMAP['MIO-37-LR3 (M)']).toBe('MIO-37-LR3');
    expect(EXPECTED['MIO-37-LR3']).toBe(3);
    expect(EXPECTED.LR3).toBe(5);
  });

  it('★★ every mapped pair is in the migration, and it is an EXPLICIT map', () => {
    const sql = strip(zoneMigrationSql);
    for (const [raw, canon] of Object.entries(REMAP)) {
      expect(sql).toContain(`'${raw}'`);
      expect(sql).toContain(`'${canon}'`);
    }
    // ★ A regex would decide the fate of spellings nobody has looked at.
    expect(sql).not.toMatch(/regexp_replace/i);
  });

  it('★★★ both backup tables drop the default anon DML', () => {
    for (const sql of [zoneMigrationSql, lotMigrationSql]) {
      const s = strip(sql);
      expect(s).toMatch(/REVOKE ALL ON [^\n]*FROM PUBLIC, anon, authenticated;/);
      expect(s).toMatch(/GRANT SELECT ON [^\n]*TO authenticated;/);
      expect(s).toMatch(/GRANT ALL\s+ON [^\n]*TO service_role;/);
    }
  });
});

// ---------------------------------------------------------------------------
// §A3 · DROPDOWN-ONLY ON EVERY SURFACE THAT WRITES ZONE
// ---------------------------------------------------------------------------

describe('fix-415 §A3: no zone input accepts free text', () => {
  it('★★★ all three write surfaces mount ZoneSelect', () => {
    for (const src of [headerSource, psmSource, step1Source]) {
      expect(strip(src)).toContain('<ZoneSelect');
    }
  });

  it('★★★ none of them still renders a free-text zone input', () => {
    // ★ The failure this ticket exists to prevent: one surface left as a text
    //   box re-creates 33 spellings on its own.
    for (const src of [headerSource, psmSource, step1Source]) {
      const code = strip(src);
      expect(code).not.toMatch(/type="text"[\s\S]{0,200}data-testid="[^"]*zone"/i);
      expect(code).not.toMatch(/data-testid="[^"]*zone"[\s\S]{0,200}type="text"/i);
    }
  });

  it('★★★ SiteTextRow is DELETED, not left for a future caller', () => {
    // ★ It existed for exactly one field — Zone. A free-text row component in
    //   the Site editor is an invitation to use it, and using it is what
    //   produced the 33 spellings. The affordance is the bug.
    expect(strip(headerSource)).not.toContain('function SiteTextRow');
  });

  it('★★ the options come from the registry, with a retired value APPENDED', () => {
    const map = new Map<string, unknown>([[ZONE_OPTIONS_KEY, ['NR', 'LR1']]]);
    expect(zoneOptions(map)).toEqual(['NR', 'LR1']);
    // ★ A <select> whose value matches no option renders BLANK, which would
    //   silently claim the project has no zone. So it is appended, not dropped.
    expect(zoneOptions(map, 'RSL')).toEqual(['NR', 'LR1', 'RSL']);
    expect(isRetiredZone(map, 'RSL')).toBe(true);
    expect(isRetiredZone(map, 'NR')).toBe(false);
    expect(isRetiredZone(map, null)).toBe(false);
  });

  it('★★ an unwritten registry falls back to the shipped 21, never to empty', () => {
    expect(zoneOptions(new Map())).toEqual([...CANONICAL_ZONES]);
    // ★ ...and a corrupt value does too, rather than rendering a broken list.
    expect(zoneOptions(new Map([[ZONE_OPTIONS_KEY, 'not-an-array']]))).toEqual([
      ...CANONICAL_ZONES,
    ]);
    expect(zoneOptions(new Map([[ZONE_OPTIONS_KEY, ['NR', 7, null]]]))).toEqual(['NR']);
  });
});

// ---------------------------------------------------------------------------
// §B · ROUNDING
// ---------------------------------------------------------------------------

describe('fix-415 §B: the rounding rule', () => {
  it('★★★ Bobby\'s examples, and NULL survives as NULL', () => {
    expect(roundLotForStorage(100.47)).toBe(100);
    expect(roundLotForStorage(120.5)).toBe(121);
    expect(roundLotForStorage(100.49)).toBe(100);
    expect(roundLotForStorage(40)).toBe(40);
    // ★ A missing dimension is missing, not zero.
    expect(roundLotForStorage(null)).toBeNull();
    expect(roundLotForStorage(undefined)).toBeNull();
    expect(roundLotForStorage(Number.NaN)).toBeNull();
  });

  it('★★★ it is called on COMMIT at all three write paths', () => {
    // ★ Rounding on KEYSTROKE would destroy "100.5" at the "100." keystroke.
    //   Each of these is a blur or a submit.
    expect(strip(headerSource)).toContain('roundLotForStorage');
    expect(strip(psmSource)).toContain('roundLotForStorage(toNumOrNull(');
    expect(strip(wizardSource)).toContain('roundLotForStorage(numOrNull(');
    // ★ ...and never from an onChange.
    expect(strip(headerSource)).not.toMatch(/onChange=\{[^}]*roundLotForStorage/);
    expect(strip(step1Source)).not.toContain('roundLotForStorage');
  });

  it('★★ B4: after the backfill the sort needs no change — confirmed', () => {
    // fix-411 §2 left the Library sort reading the RAW value so 100.47 and
    // 100.4 kept their order. Both are 100 now, so the sort sees equal values
    // and the ordering question disappears. Nothing to change.
    expect(roundLotForStorage(100.47)).toBe(roundLotForStorage(100.4));
  });
});

// ---------------------------------------------------------------------------
// §A5 · THE LIBRARY FILTER GROUPS
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  search: '', lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  zone: '', alley: '', productTypes: [], tag: '', juris: '',
  isCornerLot: '', isRegularShape: '', stories: '',
  parkingKind: '', stalls: '', roofDeck: '', workScope: '',
};

const row = (id: string, zone: string): LibraryRow =>
  ({
    projectId: id, address: id, juris: '', productTypes: [], units: 0,
    zone, lotWidth: 40, lotDepth: 100, alley: '', tags: [], stage: 'de',
    unitTypes: [], numLots: null, isCornerLot: null, isRegularShape: null,
    updatedAt: null,
  }) as LibraryRow;

describe('fix-415 §A5: the zone filter finally groups', () => {
  it('★★★ every merged spelling is now one bucket', () => {
    // Before the remap these six rows were six different zone strings and the
    // filter found three of them. They are all LR1 now.
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => row(id, 'LR1'));
    expect(filterLibraryRows(rows, { ...BASE, zone: 'LR1' })).toHaveLength(6);
  });

  it('★★★ NR does NOT swallow NR3 — the substring bug this ticket exposed', () => {
    // ★ The filter matched with `.includes()`, which was fine for a free-text
    //   fragment and WRONG the moment the control offers exact values: "NR" is
    //   a substring of "NR3", so picking NR returned all 127 NR projects PLUS
    //   the 13 NR3 ones — the grouping silently not delivered.
    const rows = [row('a', 'NR'), row('b', 'NR3'), row('c', 'NR')];
    expect(
      filterLibraryRows(rows, { ...BASE, zone: 'NR' }).map((r) => r.projectId),
    ).toEqual(['a', 'c']);
    expect(
      filterLibraryRows(rows, { ...BASE, zone: 'NR3' }).map((r) => r.projectId),
    ).toEqual(['b']);
  });

  it('★★ Any still returns everything, including a project with no zone', () => {
    const rows = [row('a', 'NR'), row('b', '')];
    expect(filterLibraryRows(rows, BASE)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §C · THE SETTINGS SECTION RENAME
// ---------------------------------------------------------------------------

describe('fix-415 §C: the section says what it holds', () => {
  it('★★★ the LABEL changed and nothing addressable did — fix-310\'s rule', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'projects')!;
    expect(section.label).toBe('Lists & Catalogs');
    // ★ The id, the path and every testid are UNCHANGED. A rename that moves a
    //   route breaks every bookmark, and this has been /settings/projects since
    //   fix-319.
    expect(section.id).toBe('projects');
    expect(section.path).toBe('/settings/projects');
    expect(section.adminOnly).toBe(true);
    expect(strip(settingsSource)).not.toContain("path: '/settings/lists");
  });

  it('★★ the description names what is actually in there, zones included', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'projects')!;
    expect(section.desc.toLowerCase()).toContain('zones');
    expect(section.desc.toLowerCase()).toContain('product types');
  });
});

// ---------------------------------------------------------------------------
// §B (rendered) · THE ROUND TRIP ON THE PATH PEOPLE ACTUALLY USE
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';
const TOKEN = '2026-05-15T12:00:00Z';
const updateMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map([['zoneOptions', ['NR', 'NR3', 'LR1']]]) }),
  readAppConfigStringArray: (m: Map<string, unknown>, k: string) => {
    const v = m.get(k);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  },
  readConsultantTypes: () => [],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function setupSite(over: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const project = {
    id: 'p-test', address: '500 Pike St', juris: 'Seattle', archived: false,
    notes: null, acq_lead: null, external_team: {}, builder_id: null,
    permit_order: [], entitlement_lead: null, design_manager: null,
    go_date: null, units: 4, zone: 'NR', lot_width: null, lot_depth: null,
    unit_types: null, alley: null, product_types: [], project_tags: null,
    created_at: TOKEN, updated_at: TOKEN, ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'p-test', updated_at: TOKEN });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-415: the SITE card — the direct-table write path', () => {
  it('★★★ ROUND TRIP: type 100.47, blur, and 100 is what gets written', () => {
    setupSite();
    const w = screen.getByTestId('pd-site-lot-w') as HTMLInputElement;
    fireEvent.change(w, { target: { value: '100.47' } });
    // ★ Still 100.47 in the box — rounding happens on COMMIT, not keystroke.
    expect(w.value).toBe('100.47');
    fireEvent.blur(w);
    return waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      expect(updateMutateAsync.mock.calls[0][0].patch.lot_width).toBe(100);
    });
  });

  it('★★★ 120.5 rounds UP to 121', () => {
    setupSite();
    const d = screen.getByTestId('pd-site-lot-d') as HTMLInputElement;
    fireEvent.change(d, { target: { value: '120.5' } });
    fireEvent.blur(d);
    return waitFor(() => {
      expect(updateMutateAsync.mock.calls[0][0].patch.lot_depth).toBe(121);
    });
  });

  it('★★ clearing a dimension still writes NULL, not 0', () => {
    setupSite({ lot_width: 40 });
    const w = screen.getByTestId('pd-site-lot-w') as HTMLInputElement;
    fireEvent.change(w, { target: { value: '' } });
    fireEvent.blur(w);
    return waitFor(() => {
      expect(updateMutateAsync.mock.calls[0][0].patch.lot_width).toBeNull();
    });
  });

  it('★★★ Zone is a SELECT here, offering the registry plus a blank', () => {
    setupSite();
    const zone = screen.getByTestId('pd-site-zone') as HTMLSelectElement;
    expect(zone.tagName).toBe('SELECT');
    expect(Array.from(zone.options).map((o) => o.value)).toEqual([
      '', 'NR', 'NR3', 'LR1',
    ]);
    expect(zone.value).toBe('NR');
  });

  it('★★★ picking a zone commits it; picking blank commits NULL', async () => {
    setupSite();
    const zone = screen.getByTestId('pd-site-zone');
    fireEvent.change(zone, { target: { value: 'LR1' } });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.zone).toBe('LR1');

    updateMutateAsync.mockClear();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: '' } });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    // ★ Five projects on prod legitimately have no zone. Blank is how they say
    //   so — it is not a 22nd zone, and it must reach the column as NULL.
    expect(updateMutateAsync.mock.calls[0][0].patch.zone).toBeNull();
  });

  it('★★ a stored zone an admin has RETIRED still renders, marked', () => {
    setupSite({ zone: 'RSL' }); // not in the mocked registry
    const zone = screen.getByTestId('pd-site-zone') as HTMLSelectElement;
    expect(zone.value).toBe('RSL');
    expect(zone.dataset.retired).toBe('true');
    expect(Array.from(zone.options).map((o) => o.value)).toContain('RSL');
  });
});
