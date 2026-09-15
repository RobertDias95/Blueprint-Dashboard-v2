import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project, UnitType } from '../lib/database.types';
import LibraryMatrix from '../components/LibraryMatrix';
import {
  LIBRARY_UNIT_COLUMNS,
  LIBRARY_UNIT_COLUMN_LABELS,
} from '../lib/libraryUnitColumns';
import {
  UNIT_SORTABLE_COLUMNS,
  isUnitSortable,
  sortUnitRows,
  unitRowProjectCount,
  unitRowUnitCount,
  type LibraryUnitRow,
} from '../lib/libraryUnitRows';
import {
  UNIT_FILTER_KEYS,
  filterLibraryRows,
  matchingUnitIndices,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import {
  CANONICAL_STORIES,
  STORIES_OPTIONS_KEY,
  matchStoriesOption,
  storiesLabel,
  storiesOptions,
} from '../lib/unitVocabulary';

// ===========================================================================
// fix-571 — the Library counts what it says and orders what it shows (P-276)
// ===========================================================================
//
// ★★★ MEASURED ON PROD 2026-09-15, AFTER fix-562's MIGRATION WAS APPLIED:
//
//     unit_types rows          270  across 118 projects
//     summed qty               399  (102 of the 270 carry a qty above 1)
//     parking_kind / parking_stalls / roof_deck / stories keys   0
//     _fix562_unit_matrix_snapshot   270 rows, taken 18:10 UTC
//     app_config.storiesOptions      ["1","1+B","2","2+B","3","3+B","4","4+B"]
//
// ★ The three vocabulary columns render `—` on every unit and that is correct:
//   fix-562 §B cleared them by ruling and the team refills by hand.
//
// ===========================================================================
// THE THREE RULINGS
// ===========================================================================
//
// §A  STORIES filters as EIGHT VALUES, not as a base storey. This REVERSES
//     fix-562 §A, which read the split storage as licence to ask one question
//     and flagged it for correction in its own PR. Bobby corrected it:
//     *"i figured, in the unit stories, it would show 1, 1+b, 2, 2+B, etc."*
//
// §B  Each view leads with its OWN unit of account — units on the Unit view,
//     projects on the Site view — and **they deliberately do not agree**.
//     *"the bigger it feels, the more service it provides to the company."*
//
// §C  TYPE moves to the end of the unit block, between Stories and Juris.
//     fix-553 §C's principle one column further: a label is not a dimension.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));
const cfgMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false, error: null }),
}));
// ★ `useAppConfig` returns a MAP and several readers call `.get` on it — a
//   partial mock returning `{}` throws inside a `useMemo` at mount (the
//   partial-mock trap, recorded in fix-407, fix-514, fix-519 and fix-562).
//   ★★ It is a MUTABLE ref here because §A has to prove a NINTH registry value
//      reaches the filter with no code change, which means writing the key.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: cfgMap.current, isLoading: false }),
  // ★ The REAL coercion against the same mutable map, not a `() => []` stub:
  //   §C has to drive the product-type filter, which reads this export, and a
  //   stub returning nothing would make that control offer no options and the
  //   test would pass against a filter that never ran.
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map?.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  },
}));

const unit = (over: Partial<UnitType> = {}): UnitType =>
  ({
    label: 'Detached',
    width_ft: 20,
    depth_ft: 40,
    qty: 1,
    stories: null,
    basement: null,
    parking_kind: null,
    parking_count: null,
    roof_deck: null,
    penthouse: null,
    ...over,
  }) as UnitType;

function project(id: string, units: UnitType[], over: Partial<Project> = {}): Project {
  return {
    id,
    address: `${id} Main St`,
    juris: 'Kirkland',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    product_types: ['Detached'],
    project_tags: [],
    units: units.length,
    zone: 'RM 3.6',
    alley: 'Yes',
    lot_width: 40,
    lot_depth: 90,
    lot_size_sf: 3600,
    is_corner_lot: true,
    is_regular_shape: true,
    num_lots: 1,
    unit_types: units as unknown as Project['unit_types'],
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function renderLibrary(projects: Project[]) {
  refsProjects.current = projects;
  refsPermits.current = projects.map((p) => ({
    id: `perm-${p.id}`,
    project_id: p.id,
    type: 'Building Permit',
    stage: 'de',
    cycle: 1,
    corr_rounds: 0,
    submitted: null,
    status: null,
    portal_url: null,
    struct_address: null,
    parent_permit_id: null,
    expected_issue: null,
    approval_date: null,
    actual_issue: null,
    extras: null,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<LibraryMatrix />, { wrapper });
}

function goUnitView() {
  fireEvent.click(screen.getByTestId('filter-chip-unit'));
  expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
}

/** The rendered headings of a table, in order, arrows stripped. ★ Off the
 *  `<thead>` — never off the exported array — because §C is a claim about what
 *  a reader SEES, and an array assertion would pass through the whole of the
 *  P-230 period (fix-519 §A's own rule about itself). */
function headings(testid: string): string[] {
  return within(screen.getByTestId(testid))
    .getAllByRole('columnheader')
    .map((h) => (h.textContent ?? '').replace(/[↑↓↕]/g, '').trim());
}

beforeEach(() => {
  // ★ The Library remembers its filters — `view` included — in sessionStorage
  //   (fix-403). Without this the first test to switch views leaves every later
  //   one mounted on the wrong table.
  window.sessionStorage.clear();
  cfgMap.current = new Map<string, unknown>();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// §A · STORIES FILTERS AS EIGHT VALUES
// ---------------------------------------------------------------------------

describe('fix-571 §A: the Stories filter offers every registry value', () => {
  it('★★★ exactly the 8 registry values, in registry order, each its own option', () => {
    renderLibrary([project('a', [unit({ stories: 3, basement: false })])]);
    const sel = screen.getByTestId('filter-stories') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      '', // Any
      ...CANONICAL_STORIES,
    ]);
    // ★ …and they are the app_config list, not a copy: the control reads
    //   `storiesOptions(map)`, which falls back to CANONICAL_STORIES when the
    //   key has never been written — which is what an empty map models.
    expect(storiesOptions(new Map())).toEqual([...CANONICAL_STORIES]);
  });

  it('★★★ ADDING A 9TH VALUE MAKES IT APPEAR WITH NO CODE CHANGE', () => {
    // ★★★ THE PROPERTY THAT MAKES "registry-driven" TRUE RATHER THAN
    //     DECORATIVE. fix-562 made stories a shape-decoded registry precisely
    //     so this costs an admin one edit in Settings and costs a deploy
    //     nothing — which is also what pays for the `4+` tier this ticket
    //     removed (a 5-storey unit is findable by adding `5`).
    cfgMap.current = new Map<string, unknown>([
      [STORIES_OPTIONS_KEY, [...CANONICAL_STORIES, '5', '5+B']],
    ]);
    renderLibrary([project('a', [unit({ stories: 5, basement: false })])]);
    const sel = screen.getByTestId('filter-stories') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toContain('5');
    expect(Array.from(sel.options).map((o) => o.value)).toContain('5+B');

    // ★ …and it FILTERS, not merely renders. A control that offers a value it
    //   cannot act on is the inert-filter shape fix-412 warned about.
    fireEvent.change(sel, { target: { value: '5' } });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: '5+B' } });
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
  });

  it('★★★ SELECTING 3 RETURNS ONLY 3 AND EXCLUDES 3+B — the returned SET', () => {
    // ★★★ THE RULING, ASSERTED ON WHAT COMES BACK rather than on whether a
    //     filter ran. fix-562 returned both; Bobby ruled they are separate
    //     answers.
    renderLibrary([
      project('plain', [unit({ stories: 3, basement: false })]),
      project('base', [unit({ stories: 3, basement: true })]),
      project('two', [unit({ stories: 2, basement: false })]),
    ]);
    const sel = screen.getByTestId('filter-stories') as HTMLSelectElement;

    fireEvent.change(sel, { target: { value: '3' } });
    expect(screen.getByTestId('library-row-plain')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-base')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-two')).not.toBeInTheDocument();

    fireEvent.change(sel, { target: { value: '3+B' } });
    expect(screen.queryByTestId('library-row-plain')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-row-base')).toBeInTheDocument();
  });

  it('★★★ …and the UNIT view returns only the matching unit ROWS', () => {
    // fix-469 §1: the unit view prints matching units, not every unit of a
    // qualifying project. A per-value stories filter has to honour that too.
    renderLibrary([
      project('a', [
        unit({ label: 'A', stories: 3, basement: false }),
        unit({ label: 'B', stories: 3, basement: true }),
        unit({ label: 'C', stories: 2, basement: false }),
      ]),
    ]);
    fireEvent.change(screen.getByTestId('filter-stories'), { target: { value: '3+B' } });
    goUnitView();
    expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(1);
    expect(screen.getByTestId('library-unit-row-a-1')).toBeInTheDocument();
  });

  it('★★★ PARKING AND ROOF DECK ALREADY FILTERED PER VALUE — checked, not assumed', () => {
    // ★★★ §A asked me to look while I was in there, and the answer is that
    //     fix-562 §A already did both: each renders `FilterSelect` over its own
    //     `app_config` registry and matches by composed label. Stories was the
    //     LAST hand-written vocabulary list on the screen.
    //
    // ★★ A filter vocabulary that is right on one of three columns is the
    //    half-applied treatment fix-553 kept hitting — so this asserts all
    //    three have the same shape rather than only the one that changed.
    renderLibrary([project('a', [unit()])]);
    for (const testid of ['filter-parking-kind', 'filter-roof-deck', 'filter-stories']) {
      const sel = screen.getByTestId(testid) as HTMLSelectElement;
      // Any, then one option per registry value — no grouping, no tier.
      expect(sel.options[0]!.value, testid).toBe('');
      expect(sel.options.length, testid).toBeGreaterThan(1);
      const values = Array.from(sel.options).slice(1).map((o) => o.value);
      expect(new Set(values).size, testid).toBe(values.length);
      // ★ And no option carries a range marker — the shape a tier leaves behind.
      expect(values.some((v) => v.endsWith('+')), testid).toBe(false);
    }
  });

  it('★★ an unanswered unit matches nothing but Any', () => {
    // ★★★ AFTER fix-562 §B's WIPE THIS IS EVERY UNIT ON PROD — 0 of 270 carry a
    //     `stories` key — so it is the common case rather than the corner.
    expect(matchStoriesOption(null, null, '3')).toBe(false);
    expect(matchStoriesOption(null, null, '')).toBe(true);
    const row = { projectId: 'p', unitTypes: [unit(), unit()] } as unknown as LibraryRow;
    expect(filterLibraryRows([row], { ...BASE, stories: '3' })).toEqual([]);
    expect(filterLibraryRows([row], BASE)).toHaveLength(1);
    expect(matchingUnitIndices(row, BASE)).toEqual([0, 1]);
  });

  it('★★ `stories` is still filed under the UNIT card, so a Clear reaches it', () => {
    // fix-469 §2 / `libraryFilterKeyCoverage`: a key that changes type must not
    // fall out of its card's clear list on the way.
    expect(UNIT_FILTER_KEYS as readonly string[]).toContain('stories');
  });
});

// ---------------------------------------------------------------------------
// §B · EACH VIEW LEADS WITH ITS OWN UNIT OF ACCOUNT
// ---------------------------------------------------------------------------

const uRow = (i: number, u: UnitType): LibraryUnitRow => ({
  key: `p:${i}`,
  index: i,
  unit: u,
  project: { projectId: 'p' } as unknown as LibraryRow,
});

describe('fix-571 §B: the Unit view counts UNITS, the Site view counts PROJECTS', () => {
  it('★★★ the unit count is sum(qty) — the §0 fixture, 270 rows → 399 units', () => {
    // ★★★ PROD'S OWN SHAPE, SCALED TO A FIXTURE THAT REPRODUCES ITS TOTAL:
    //     270 rows carrying 399 units, 102 of them above 1. The arithmetic the
    //     screen does is what is asserted, against the number Bobby will see.
    //
    //     168×1 + 86×2 + 5×3 + 11×4 = 168 + 172 + 15 + 44 = 399, over 270 rows.
    const rows: LibraryUnitRow[] = [];
    let i = 0;
    for (const [qty, n] of [[1, 168], [2, 86], [3, 5], [4, 11]] as const) {
      for (let k = 0; k < n; k++) rows.push(uRow(i++, unit({ qty })));
    }
    expect(rows).toHaveLength(270);
    expect(unitRowUnitCount(rows)).toBe(399);
  });

  it('★★★ a qty: 3 row contributes 3, and a row with NO qty key contributes 1', () => {
    expect(unitRowUnitCount([uRow(0, unit({ qty: 3 }))])).toBe(3);
    // ★★ A raw row with the key ABSENT. `parseUnitTypes` has normalised this to
    //    1 since fix-22, so the `?? 1` here is defensive rather than decisive —
    //    but a fixture or an un-parsed caller must not contribute nothing.
    //    ★ This is NOT fix-386 being broken: `qty` has no "not recorded" state
    //      to protect, because a unit_types row IS at least one unit.
    const bare = { label: 'A', width_ft: null, depth_ft: null } as unknown as UnitType;
    expect(unitRowUnitCount([uRow(0, bare)])).toBe(1);
    expect(unitRowUnitCount([uRow(0, unit({ qty: 0 }))])).toBe(1);
    expect(unitRowUnitCount([])).toBe(0);
  });

  it('★★★ THE HEADLINE ON SCREEN IS THE UNIT TOTAL, NOT THE ROW COUNT', () => {
    // Three rows, seven units, one project.
    renderLibrary([
      project('a', [unit({ qty: 4 }), unit({ qty: 2 }), unit({ qty: 1 })]),
    ]);
    goUnitView();
    expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(3);
    // ⚠️ THE NUMBER JUMPS. On prod this line reads 270 before this ticket and
    //    399 after, with no data having moved.
    expect(screen.getByTestId('library-count').textContent).toContain(
      '7 units across 1 project',
    );
  });

  it('★★★ …and the SITE view leads with PROJECTS — the two do NOT agree, on purpose', () => {
    // ★★★ DO NOT RECONCILE THEM. The headline is whatever the view is a view
    //     OF; an earlier reading of this ticket had them agreeing and Bobby
    //     corrected it. A unit total is not the Site view's subject.
    renderLibrary([
      project('a', [unit({ qty: 4 })]),
      project('b', [unit({ qty: 2 })]),
    ]);
    expect(screen.getByTestId('library-count').textContent).toContain('2 projects');
    expect(screen.getByTestId('library-count').textContent).not.toContain('unit');
    goUnitView();
    expect(screen.getByTestId('library-count').textContent).toContain(
      '6 units across 2 projects',
    );
  });

  it('★★ the count follows the FILTER, not the whole library', () => {
    // A headline computed off the unfiltered set would read "the tool's reach"
    // while the table beneath it showed a search — the number has to be about
    // what is on screen.
    renderLibrary([
      project('a', [unit({ qty: 4, stories: 3, basement: false })]),
      project('b', [unit({ qty: 9, stories: 2, basement: false })]),
    ]);
    fireEvent.change(screen.getByTestId('filter-stories'), { target: { value: '3' } });
    goUnitView();
    expect(screen.getByTestId('library-count').textContent).toContain(
      '4 units across 1 project',
    );
  });

  it('★★ singular and plural are both right at 1', () => {
    renderLibrary([project('a', [unit({ qty: 1 })])]);
    goUnitView();
    expect(screen.getByTestId('library-count').textContent).toContain(
      '1 unit across 1 project',
    );
  });

  it('★★ the project half is unchanged — it still counts DISTINCT projects', () => {
    const rows = [uRow(0, unit()), uRow(1, unit())];
    expect(unitRowProjectCount(rows)).toBe(1);
  });

  it('★★★ QTY IS STILL NOT A COLUMN — the count reads a field the table hides', () => {
    // ★★★ fix-562 §H removed it from BOTH views by ruling; the field stays in
    //     `unit_types` and is typed on Project Details → Units. So this figure
    //     is correct AND unverifiable from the table beneath it — worth an
    //     assertion so nobody "fixes" the discrepancy by re-adding the column
    //     or by making the count `rows.length` again.
    renderLibrary([project('a', [unit({ qty: 4 })])]);
    expect(headings('library-table')).not.toContain('Units');
    expect(headings('library-table')).not.toContain('Qty');
    goUnitView();
    expect(headings('library-table-unit')).not.toContain('Qty');
    expect(screen.getByTestId('library-count').textContent).toContain('4 units');
  });
});

// ---------------------------------------------------------------------------
// §C · TYPE MOVES TO THE END OF THE UNIT BLOCK
// ---------------------------------------------------------------------------

describe('fix-571 §C: Type reads between Stories and Juris', () => {
  it('★★★ THE RENDERED HEADER SEQUENCE — Stories, then Type, then Juris', () => {
    // ★★★ ASSERTED OFF THE `<thead>`, NOT OFF THE ARRAY. fix-519 §A's own rule
    //     about itself: a positional or array-based assertion passes happily
    //     through the entire broken period, because the array was never the
    //     thing that was wrong — the heading above the cell was.
    renderLibrary([project('a', [unit()])]);
    goUnitView();
    const h = headings('library-table-unit');
    expect(h).toEqual([
      'Address',
      'Width',
      'Depth',
      'Size (sf)',
      'Parking',
      'Roof Deck',
      'Stories',
      'Type',
      'Juris',
      'Stage',
    ]);
    // ★ Bobby's sentence, as an adjacency rather than as a list — so it still
    //   holds if a column is added elsewhere on the row.
    expect(h[h.indexOf('Stories') + 1]).toBe('Type');
    expect(h[h.indexOf('Type') + 1]).toBe('Juris');
    // ★★ THE BRIEF SAID `… Type · Juris · Zone · Alley · Stage`, AND THAT IS
    //    THE SITE TABLE'S TAIL. Measured, not assumed: the unit view carries
    //    Juris and Stage only — `Zone` and `Alley` are on the other table.
    expect(h).not.toContain('Zone');
    expect(h).not.toContain('Alley');
  });

  it('★★★ THE CELL MOVED WITH THE HEADING — one list, two readers', () => {
    // ★★★ The property fix-519 §A cost a ticket to get. Under the two
    //     hand-written lists it replaced, this move is EXACTLY what produced
    //     P-230: every value after the moved column printing under somebody
    //     else's heading. Resolving by heading is what can see that.
    renderLibrary([
      project('a', [unit({ label: 'Detached', stories: 3, basement: true, width_ft: 24 })]),
    ]);
    goUnitView();
    const row = screen.getByTestId('library-unit-row-a-0');
    const h = headings('library-table-unit');
    const cells = within(row).getAllByRole('cell');
    const at = (label: string) => (cells[h.indexOf(label)]!.textContent ?? '').trim();
    expect(at('Type')).toContain('Detached');
    expect(at('Stories')).toBe('3+B');
    expect(at('Width')).toBe('24');
    expect(at('Juris')).toBe('Kirkland');
  });

  it('★★★ it STILL SORTS, both ways', () => {
    // A sort that broke on a column MOVE would be the position-bound reader
    // fix-519 §A removed. `unitLabel` keeps its `col` key, so the name-bound
    // arm never noticed.
    expect(UNIT_SORTABLE_COLUMNS as readonly string[]).toContain('unitLabel');
    expect(isUnitSortable('unitLabel')).toBe(true);
    const rows = [
      uRow(0, unit({ label: 'Remodel' })),
      uRow(1, unit({ label: 'ADU' })),
      uRow(2, unit({ label: 'Detached' })),
    ];
    expect(
      sortUnitRows(rows, { col: 'unitLabel', asc: true }).map((r) => r.unit.label),
    ).toEqual(['ADU', 'Detached', 'Remodel']);
    expect(
      sortUnitRows(rows, { col: 'unitLabel', asc: false }).map((r) => r.unit.label),
    ).toEqual(['Remodel', 'Detached', 'ADU']);
  });

  it('★★★ …and clicking the header sorts the rendered table', () => {
    renderLibrary([
      project('a', [unit({ label: 'Remodel' }), unit({ label: 'ADU' })], {
        product_types: ['Remodel', 'ADU'],
      }),
    ]);
    goUnitView();
    const labels = () =>
      screen
        .getAllByTestId(/^library-unit-a-\d+-label$/)
        .map((el) => (el.textContent ?? '').trim());
    fireEvent.click(screen.getByTestId('library-uth-unitLabel'));
    expect(labels()).toEqual(['ADU', 'Remodel']);
    fireEvent.click(screen.getByTestId('library-uth-unitLabel'));
    expect(labels()).toEqual(['Remodel', 'ADU']);
  });

  it('★★★ …and it STILL FILTERS — at the PROJECT grain, which is worth naming', () => {
    // ★★★ §C asked whether Type's header and its filter should be unified into
    //     one declared list the way fix-519 §C did for juris/zone/alley. THEY
    //     MUST NOT BE, because they are not two declarations of one field:
    //
    //       · the COLUMN is the UNIT's own label (`unit_types[].label`),
    //         resolved against the project's types (fix-209/212/232);
    //       · the FILTER is `projects.product_types`, matched any-of at the
    //         PROJECT grain (fix-91).
    //
    //     They share the word "Type" and nothing else. Unifying them would
    //     claim one field where there are two — the opposite of what fix-519 §C
    //     was for, which was two declarations of the SAME three fields.
    cfgMap.current = new Map<string, unknown>([
      ['productTypeOptions', ['Detached', 'ADU']],
    ]);
    renderLibrary([
      project('a', [unit({ label: 'Detached' })], { product_types: ['Detached'] }),
      project('b', [unit({ label: 'ADU' })], { product_types: ['ADU'] }),
    ]);
    fireEvent.change(screen.getByTestId('filter-product-type'), {
      target: { value: 'ADU' },
    });
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    goUnitView();
    expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(1);
    expect(screen.getByTestId('library-unit-row-b-0')).toBeInTheDocument();
  });

  it('★★★ the empty-state row spans every column — on BOTH tables', () => {
    // ★★★ A STALE colSpan IS INVISIBLE UNTIL THE TABLE IS EMPTY, which is why
    //     it has gone wrong twice (fix-447, fix-483 §A2) and why this asserts it
    //     against the RENDERED header count rather than against a number typed
    //     in a test. A moved column is exactly when it goes stale again.
    renderLibrary([project('a', [unit()])]);
    const siteHeaders = headings('library-table').length;
    // ★ Corner is a tri-state over a fixture that says Yes — a control that is
    //   guaranteed to empty the table without depending on a derived option
    //   list existing in this harness.
    fireEvent.change(screen.getByTestId('filter-corner'), { target: { value: 'No' } });
    const siteEmpty = within(screen.getByTestId('library-table')).getByText(
      /No projects match/,
    );
    expect(Number(siteEmpty.getAttribute('colspan'))).toBe(siteHeaders);

    fireEvent.change(screen.getByTestId('filter-corner'), { target: { value: '' } });
    goUnitView();
    const unitHeaders = headings('library-table-unit').length;
    fireEvent.change(screen.getByTestId('filter-stories'), { target: { value: '4+B' } });
    const unitEmpty = within(screen.getByTestId('library-table-unit')).getByText(
      /No units match/,
    );
    expect(Number(unitEmpty.getAttribute('colspan'))).toBe(unitHeaders);
  });

  it('★★ the declared list and the rendered heading agree about Type', () => {
    // ★ The array form, kept as a SECOND check rather than the only one — it
    //   catches a `label` rename that the sequence test would still pass.
    expect(LIBRARY_UNIT_COLUMN_LABELS.at(-1)).toBe('Type');
    expect(LIBRARY_UNIT_COLUMNS.at(-1)!.col).toBe('unitLabel');
    expect(LIBRARY_UNIT_COLUMNS.at(-1)!.sourceKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shared fixture for the pure-helper assertions above
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  view: 'site',
  lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  lotsizeTarget: null, lotsizeBuf: 500,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  unitsizeTarget: null, unitsizeBuf: 100,
  zone: '', alley: '', productTypes: [], juris: '',
  isCornerLot: '', stories: '', parkingKind: '', roofDeck: '',
};

describe('fix-571: the composed label is what the filter asks for', () => {
  it('★★ the filter value and the cell text are the same string', () => {
    // ★★★ THE PROPERTY THAT MAKES A REGISTRY FILTER HONEST: what you pick is
    //     what you read in the column. A filter offering `3+B` over a column
    //     printing `3 (B)` would be two vocabularies for one field.
    for (const label of CANONICAL_STORIES) {
      const m = /^(\d+)(\+B)?$/.exec(label)!;
      const composed = storiesLabel(Number(m[1]), m[2] !== undefined);
      expect(composed, label).toBe(label);
      expect(matchStoriesOption(Number(m[1]), m[2] !== undefined, label), label).toBe(true);
    }
  });
});
