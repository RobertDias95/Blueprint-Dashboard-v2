import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { Project, UnitType } from '../lib/database.types';
import {
  LIBRARY_UNIT_COLUMNS,
  LIBRARY_UNIT_COLUMN_LABELS,
} from '../lib/libraryUnitColumns';
import { LIBRARY_SITE_SHARED_FIELDS } from '../lib/librarySiteFields';

// ===========================================================================
// ★★★ fix-519 §A (P-230) + §C (P-228) — THE LIBRARY TELLS THE TRUTH
// ===========================================================================
//
// Bobby, 2026-09-10: *"when we click unit, the columns are not reflecting the
// right data? Roofdeck is reflecting parking? Etc?"*
//
// ★★★ THE BUG WAS TWO HAND-WRITTEN LISTS 500 LINES APART. `LibraryMatrix`'s
//     `<thead>` and `LibraryUnitRow`'s `<td>`s each declared the unit column
//     order, and fix-514 §H reordered ONE of them. Everything after
//     `Size (sf)` then printed under somebody else's heading.
//
// ★★★ SO EVERY ASSERTION BELOW IS BY NAME, NEVER BY POSITION. A positional
//     test — "the ninth cell holds X" — passes happily through the entire
//     broken period, because the ninth cell did hold something. The question a
//     test has to be able to ask is *"does the ROOF DECK column read
//     `roof_deck`?"*, and that is what `sourceKey` exists for.
//
// ⚠️ IT MATTERED BECAUSE OF THE BACKFILL. P-225 has Cam and others reading this
//    table to decide which unit fields are missing, so a parking code under
//    ROOF DECK does not stay on screen — it gets typed into the database as a
//    correction.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false, error: null }),
}));
// ★ A project with NO permits does not reach `buildLibraryRows` — the Library
//   is a table of permitted work, so a row needs one. One BP is enough.
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false, error: null }),
}));
// ★ `useAppConfig` returns a MAP, and `zoneOptions` calls `.get` on it — a
//   partial mock returning `{}` throws inside a `useMemo` at mount. The
//   partial-mock trap, recorded in fix-407 and fix-514 before this.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map<string, unknown>(), isLoading: false }),
  readAppConfigStringArray: () => [] as string[],
}));

import LibraryMatrix from '../components/LibraryMatrix';
import matrixSrc from '../components/LibraryMatrix.tsx?raw';

/**
 * ★★★ BOBBY'S ROW, FROM PROD. `10150 NE 64th St`, verified 2026-09-10:
 *
 *   {"label":"Detached","width_ft":24,"depth_ft":50.5,"size_sf":3352,
 *    "qty":1,"stories":3,"parking_kind":"garage","parking_stalls":2,
 *    "roof_deck":false}
 *
 * ★ Every value is DISTINCT, which is what makes the fixture able to catch a
 *   shift at all. Two columns holding `1` would have hidden it.
 */
const BOBBY_UNIT: UnitType = {
  label: 'Detached',
  width_ft: 24,
  depth_ft: 50.5,
  size_sf: 3352,
  qty: 1,
  stories: 3,
  parking_kind: 'garage',
  parking_stalls: 2,
  roof_deck: false,
} as unknown as UnitType;

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-519',
    address: '10150 NE 64th St',
    juris: 'Kirkland',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    schematic_designer: [],
    go_date: null,
    units: 3,
    zone: 'RM 3.6',
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    unit_types: [BOBBY_UNIT],
    parking_type: null,
    parking_stalls: null,
    alley: 'Yes',
    product_types: ['Detached'],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    closing_date: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

/** Mount the Library on the SITE view (its default). */
function renderLibrary(projects: Project[] = [project()]) {
  refsProjects.current = projects as unknown[];
  refsPermits.current = projects.map((p, i) => ({
    id: 900 + i,
    project_id: p.id,
    type: 'Building Permit',
    num: 'BP-1',
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

/** Mount the Library and switch to the UNIT view, which is where P-230 lived.
 *  ★ Through the chip a user clicks, not by reaching into state — the two
 *    tables are different components and mounting the wrong one is how a suite
 *    quietly stops testing anything (fix-514's lesson about `renderProjectData`). */
function renderUnitView(projects: Project[] = [project()]) {
  const r = renderLibrary(projects);
  fireEvent.click(screen.getByTestId('filter-chip-unit'));
  expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
  return r;
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

/** Read a cell by the COLUMN's heading, resolving the index off the rendered
 *  `<thead>` rather than off a number typed here. ★ This is the whole method:
 *  a helper that took an index would be the bug's own accomplice. */
function cellUnderHeading(row: HTMLElement, heading: string): string {
  const headings = screen
    .getAllByRole('columnheader')
    .map((h) => (h.textContent ?? '').replace(/[↑↓↕]/g, '').trim());
  const i = headings.indexOf(heading);
  expect(i, `no column headed "${heading}"`).toBeGreaterThan(-1);
  return (within(row).getAllByRole('cell')[i].textContent ?? '').trim();
}

// ---------------------------------------------------------------------------
// §A — the unit columns
// ---------------------------------------------------------------------------

describe('fix-519 §A (P-230) — every unit column reads its own key', () => {
  it('★★★ NO COLUMN IS RESOLVED BY INDEX — the header and the cells are ONE list', () => {
    // ★★★ THE STRUCTURAL ASSERTION, and the only one that stops this
    //     recurring. Reordering the row's cells would have fixed the instance
    //     and left the cause: two lists that drift the next time a column is
    //     inserted. Both readers must name `LIBRARY_UNIT_COLUMNS`.
    const code = matrixSrc
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // The header renders from the list…
    expect(code).toContain('{LIBRARY_UNIT_COLUMNS.map((c) => (');
    // …and so does the row.
    expect(code).toContain('{LIBRARY_UNIT_COLUMNS.map((c) =>');
    expect(code.match(/LIBRARY_UNIT_COLUMNS\.map/g)?.length).toBe(2);
    // ★ And no hand-written unit header survives to drift from it. Four `<UTh`
    //   remain: `Address`, `Juris` and `Stage` — the PROJECT cells around the
    //   unit run, which the list deliberately does not own — plus the single
    //   one inside the map above. Nine columns, one declaration.
    expect(code.match(/<UTh\s/g)?.length).toBe(4);
  });

  it('★★★ BOBBY’S ROW: `roof_deck:false` prints under ROOF DECK, `garage` under PARKING', () => {
    // ★★★ THE CONCLUSIVE PAIR. `roof_deck` is a BOOLEAN and `parking_kind` is a
    //     closed vocabulary, so a `G` under ROOF DECK cannot be a coincidence,
    //     a rounding or a formatting choice — it can only be the wrong key.
    //     That is what made Bobby's report diagnosable from one screenshot.
    renderUnitView();
    const row = screen.getByTestId('library-unit-row-p-519-0');
    expect(cellUnderHeading(row, 'Roof Deck')).toBe('N');
    expect(cellUnderHeading(row, 'Parking')).toBe('G');
  });

  it('★★★ …and so does every other column, checked against its own key', () => {
    // The full row, by heading. Before this ticket four of these were wrong.
    renderUnitView();
    const row = screen.getByTestId('library-unit-row-p-519-0');
    expect(cellUnderHeading(row, 'Unit type')).toContain('Detached');
    expect(cellUnderHeading(row, 'Width')).toBe('24');
    expect(cellUnderHeading(row, 'Depth')).toBe('50.5');
    expect(cellUnderHeading(row, 'Size (sf)')).toBe('3352');
    expect(cellUnderHeading(row, 'Parking')).toBe('G');
    expect(cellUnderHeading(row, 'Stalls')).toBe('2');
    expect(cellUnderHeading(row, 'Roof Deck')).toBe('N');
    expect(cellUnderHeading(row, 'Stories')).toBe('3');
    expect(cellUnderHeading(row, 'Qty')).toBe('1');
  });

  it('★★★ the testid a cell carries matches the KEY it reads, not its position', () => {
    // ★★ The other half of "by name" — and stated precisely, because this one
    //    would NOT have caught P-230 and it is worth knowing why. The pre-fix
    //    row attached each testid to the cell that read its own key, so
    //    `-roofdeck` always printed `roof_deck`; what was wrong was the HEADER
    //    it sat under. **Only `cellUnderHeading` catches that**, which is the
    //    argument for resolving a column by its heading rather than by a
    //    testid. This test guards the other direction: a testid that stops
    //    naming the key its cell reads would make a wrong test look right.
    renderUnitView();
    expect(screen.getByTestId('library-unit-p-519-0-roofdeck').textContent).toBe('N');
    expect(screen.getByTestId('library-unit-p-519-0-parking').textContent).toBe('G');
    expect(screen.getByTestId('library-unit-p-519-0-stalls').textContent).toBe('2');
    expect(screen.getByTestId('library-unit-p-519-0-stories').textContent).toBe('3');
    expect(screen.getByTestId('library-unit-p-519-0-qty').textContent).toBe('1');
  });

  it('★★ every column NAMES the `unit_types` key it reads', () => {
    // ★ The declaration itself, so a column added without a `sourceKey` — or
    //   with the wrong one — is caught here rather than by a screenshot.
    const byCol = Object.fromEntries(
      LIBRARY_UNIT_COLUMNS.map((c) => [c.col, c.sourceKey]),
    );
    expect(byCol).toEqual({
      unitLabel: null, // resolved against the project's product types
      width: 'width_ft',
      depth: 'depth_ft',
      size: 'size_sf',
      parking: 'parking_kind',
      stalls: 'parking_stalls',
      roofDeck: 'roof_deck',
      stories: 'stories',
      qty: 'qty',
    });
  });

  it('★★ the order is fix-514 §H’s, which is the UNIT filter box’s', () => {
    // *"the table reads in the order the filter reads"* — width, depth, size,
    // parking, stalls, roof deck, stories; with the type identifying the row
    // and Qty (which has no filter) counting it at the end.
    expect(LIBRARY_UNIT_COLUMN_LABELS).toEqual([
      'Unit type',
      'Width',
      'Depth',
      'Size (sf)',
      'Parking',
      'Stalls',
      'Roof Deck',
      'Stories',
      'Qty',
    ]);
  });

  it('★★ `null` is NOT RECORDED and is a different fact from `false` / `0`', () => {
    // fix-386's rule, and it is why ROOF DECK has three states rather than two.
    // A Library filter reading an unmeasured unit as zero is how somebody
    // searching for 1,700 sf units silently misses them.
    renderUnitView([
      project({
        unit_types: [
          {
            label: 'Detached',
            width_ft: null,
            depth_ft: null,
            size_sf: null,
            qty: 0,
            stories: null,
            parking_kind: null,
            parking_stalls: 0,
            roof_deck: null,
          },
        ] as unknown as Project['unit_types'],
      }),
    ]);
    const row = screen.getByTestId('library-unit-row-p-519-0');
    expect(cellUnderHeading(row, 'Roof Deck')).toBe('—');
    expect(cellUnderHeading(row, 'Parking')).toBe('—');
    expect(cellUnderHeading(row, 'Width')).toBe('—');
    // …and a recorded zero prints as zero, on the field that admits one.
    // ★ `parking_stalls` takes `>= 0` deliberately — nought stalls is a fact.
    //   `qty` and `stories` take `> 0` and normalise 0 to 1 in
    //   `parseUnitTypes`, because a unit type with none of them is not a unit
    //   type. Asserted so the asymmetry is a decision on the record rather
    //   than something the next reader has to rediscover from a fixture.
    expect(cellUnderHeading(row, 'Stalls')).toBe('0');
    expect(cellUnderHeading(row, 'Qty')).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// §C — the filter and the table agree
// ---------------------------------------------------------------------------

describe('fix-519 §C (P-228) — jurisdiction before zone, in both', () => {
  it('★★★ the FILTER moved and the TABLE did not', () => {
    // ★★★ THE DIRECTION IS THE RULING. P-196 said *"the table reads in the
    //     order the filter reads"*, which would have moved the table — but
    //     jurisdiction is the coarser fact and the data settles it: **0 of 219
    //     active projects are missing a jurisdiction, 3 are missing a zone.**
    //     You narrow from the field everybody has.
    renderLibrary();
    const filters = [
      screen.getByTestId('filter-juris'),
      screen.getByTestId('filter-zone'),
      screen.getByTestId('filter-alley'),
    ];
    // In DOM order, jurisdiction first.
    expect(
      filters[0].compareDocumentPosition(filters[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      filters[1].compareDocumentPosition(filters[2]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ★ The table is UNCHANGED — Juris then Zone then Alley, as it already was.
    const headings = screen
      .getAllByRole('columnheader')
      .map((h) => (h.textContent ?? '').replace(/[↑↓↕]/g, '').trim());
    expect(headings.indexOf('Juris')).toBeLessThan(headings.indexOf('Zone'));
    expect(headings.indexOf('Zone')).toBeLessThan(headings.indexOf('Alley'));
  });

  it('★★★ both orders come from ONE list', () => {
    // ★★ fix-514 §H recorded this deviation in a COMMENT — *"Bobby's list reads
    //    jurisdiction before zone; the filter box asks Zone first"* — and a
    //    comment is not a rule. Now they read the same array, so they cannot
    //    drift without both moving.
    expect(LIBRARY_SITE_SHARED_FIELDS.map((f) => f.key)).toEqual([
      'juris',
      'zone',
      'alley',
    ]);
    const code = matrixSrc
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Twice: once in the filter box, once in the `<thead>`.
    expect(code.match(/LIBRARY_SITE_SHARED_FIELDS\.map/g)?.length).toBe(2);
  });

  it('★ the filter asks the long name and the column prints the short one', () => {
    // ★ Not drift: a filter is read as a question ("Jurisdiction?") and a
    //   column is read against ten others, where every character is width.
    //   Declared as two fields of ONE entry so they cannot come apart.
    renderLibrary();
    expect(screen.getByText('Jurisdiction')).toBeInTheDocument();
    const headings = screen
      .getAllByRole('columnheader')
      .map((h) => (h.textContent ?? '').replace(/[↑↓↕]/g, '').trim());
    expect(headings).toContain('Juris');
    expect(headings).not.toContain('Jurisdiction');
  });
});

// ---------------------------------------------------------------------------
// The sweep, turned into a guard for the table next door
// ---------------------------------------------------------------------------

describe('fix-519 §A — the SITE table next door still agrees with itself', () => {
  it('★★★ every SITE heading sits over the value it names', () => {
    // ★★★ THE SWEEP FOUND FOUR TABLES BUILT THIS WAY and only the UNIT one had
    //     drifted. The other three — this table, `ProjectList` and
    //     `CorrectionsReport`'s items — agree today and NOTHING TESTED THAT.
    //     This is the cheapest of the three to hold, because it is in the same
    //     file as the one that broke: the header is in `LibraryMatrix`'s
    //     `<thead>` and the cells are in `Row`, which is the exact shape that
    //     produced P-230 one table up.
    //
    // ★ Asserted on VALUES rather than on a column list, because this table's
    //   cells are not declared anywhere — that is the point. A fixture whose
    //   every field is distinct is the only way to notice a shift.
    renderLibrary([
      project({
        address: '10150 NE 64th St',
        lot_width: 40,
        lot_depth: 90,
        lot_size_sf: 3600,
        juris: 'Kirkland',
        zone: 'RM 3.6',
        alley: 'Yes',
        units: 3,
      }),
    ]);
    const row = screen.getByTestId('library-row-p-519');
    expect(cellUnderHeading(row, 'Address')).toContain('10150 NE 64th St');
    expect(cellUnderHeading(row, 'Lot W')).toContain('40');
    expect(cellUnderHeading(row, 'Lot D')).toContain('90');
    expect(cellUnderHeading(row, 'Lot SF')).toContain('3,600');
    expect(cellUnderHeading(row, 'Juris')).toBe('Kirkland');
    expect(cellUnderHeading(row, 'Zone')).toBe('RM 3.6');
    expect(cellUnderHeading(row, 'Alley')).toBe('Yes');
    expect(cellUnderHeading(row, 'Units')).toBe('3');
  });
});
