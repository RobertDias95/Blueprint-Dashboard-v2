import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_410_is_regular_shape.sql?raw';
import wizardStateSource from '../components/wizard/wizardState.ts?raw';
import step1Source from '../components/wizard/Step1ProjectInfo.tsx?raw';
import newProjectWizardSource from '../components/NewProjectWizard.tsx?raw';
import useProjectsSource from '../hooks/useProjects.ts?raw';
import headerSource from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import matrixSource from '../components/LibraryMatrix.tsx?raw';
import {
  SORTABLE_COLUMNS,
  buildLibraryRows,
  filterLibraryRows,
  isSortableColumn,
  sortLibraryRows,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import { loadLibraryFilters } from '../lib/surfaceFilterPrefs';
import { saveFilterState } from '../lib/filterPrefs';
import { makeEmptyWizardState, makeRedesignWizardState } from '../components/wizard/wizardState';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// fix-410 — "Regular shape" on the site information
// ===========================================================================
//
// Bobby, 2026-08-26 (register P-040): is the lot a regular rectangle — equal
// widths, equal lengths — or irregular? Three places: the Site step of setup,
// the Site section of the project overview, and the Library (column + filter).
// *"default should be yes, the other option is no."*
//
// ---------------------------------------------------------------------------
// ★★★ WHAT STEP 0 VERIFIED ON PROD, AND THE ONE CORRECTION TO THE BRIEF
// ---------------------------------------------------------------------------
//
//   THE TRAP IS REAL, BOTH HALVES. `bp_create_project_with_permits` has an
//   explicit `INSERT INTO projects (…)` column list, and every column of
//   `bp_update_project_with_permits` is `CASE WHEN v_patch ? 'col' … ELSE col
//   END`. A key neither names is SILENTLY DROPPED — "saved", unchanged, no
//   error. Confirmed by reading pg_get_functiondef() on 2026-08-26.
//
//   THE CORRECTION: `is_corner_lot`, `num_lots` and `closing_date` are NOT in
//   the UPDATE RPC's SET list and never were. The Project Overview Site section
//   does not save through that function at all — it uses a direct PostgREST
//   table UPDATE with row-level OCC (hooks/useUpdateProject). The RPC serves the
//   Project SETTINGS MODAL, which edits a different subset. `is_regular_shape`
//   was added to the RPC anyway, so it cannot become a silent no-op if it is
//   ever added to that modal.
//
// ★★ THE RPC ROUND-TRIPS THEMSELVES were run against PROD inside a rolled-back
// transaction (the fix-153 pattern) and are reported in the PR, because no test
// here can reach a database. What §4 pins is that the MIGRATION still contains
// the statements those probes proved, so the two cannot drift apart silently.

// ---------------------------------------------------------------------------
// §1 · THE WIZARD DEFAULTS TO YES
// ---------------------------------------------------------------------------

describe('fix-410 §1: the form carries the default, not the column', () => {
  it('★★★ a NEW project starts at Yes', () => {
    expect(makeEmptyWizardState().is_regular_shape).toBe('yes');
  });

  it('★★★ ...and the COLUMN has no default — the migration says so out loud', () => {
    // ★ A DDL default would have rewritten all 193 existing rows into a claim
    //   nobody verified, as a side effect of DDL. The backfill is a separate,
    //   approved, verifiable statement instead.
    expect(migrationSql).toContain(
      'ADD COLUMN IF NOT EXISTS is_regular_shape boolean;',
    );
    expect(migrationSql).not.toMatch(/is_regular_shape boolean[^;]*DEFAULT/i);
  });

  it('★★ the control has NO blank option — that is the difference from Corner', () => {
    // Corner Lot is tri-state because fix-122 refused to guess for historical
    // projects. This one is answered by the form every time, so irregular lots
    // are the ones somebody has to flag.
    const block = step1Source.slice(
      step1Source.indexOf('wizard-is-regular-shape') - 900,
      step1Source.indexOf('wizard-is-regular-shape') + 400,
    );
    expect(block).toContain('<option value="yes">Yes</option>');
    expect(block).toContain('<option value="no">No</option>');
    expect(block).not.toContain('<option value="">—</option>');
  });

  it('★★ the helper text says what "regular" means', () => {
    expect(step1Source).toContain(
      'Equal widths and equal lengths — a rectangle. Choose No for an',
    );
  });

  it('★★★ the wizard PAYLOAD carries it — the key the RPC reads', () => {
    // ★ Without this line the column stays NULL forever and the control is
    //   decoration. It is the client half of the same trap the RPC is the
    //   server half of.
    expect(newProjectWizardSource).toContain(
      'is_regular_shape: boolFromTri(state.is_regular_shape)',
    );
  });

  it('★★ a REDESIGN inherits the parent, and falls back to Yes when unanswered', () => {
    const parent = {
      id: 'p1',
      address: '100 Main St',
      is_regular_shape: false as boolean | null,
    };
    expect(makeRedesignWizardState(parent, 0).is_regular_shape).toBe('no');
    expect(
      makeRedesignWizardState({ ...parent, is_regular_shape: true }, 0)
        .is_regular_shape,
    ).toBe('yes');
    // ★ No recorded answer on the parent → the redesign is a NEW project, and
    //   Bobby's rule for a new project is Yes.
    expect(
      makeRedesignWizardState({ ...parent, is_regular_shape: null }, 0)
        .is_regular_shape,
    ).toBe('yes');
    expect(wizardStateSource).toContain('is_regular_shape');
  });
});

// ---------------------------------------------------------------------------
// §2 · THREE STATES, AND NULL IS NEVER "YES"
// ---------------------------------------------------------------------------

const proj = (over: Partial<Project>): Project =>
  ({
    id: 'p1',
    address: '100 Main St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    units: 1,
    zone: 'NR3',
    lot_width: 40,
    lot_depth: 100,
    alley: 'No',
    product_types: [],
    project_tags: [],
    unit_types: [],
    num_lots: 1,
    is_corner_lot: null,
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  }) as Project;

/** ★ A permit is REQUIRED: `buildLibraryRows` skips a project with none — the
 *  matrix is permit-data-driven. Passing `[]` returns an empty array, and the
 *  `[0]!` would have handed every assertion an `undefined` row that spread into
 *  a fixture with no fields at all. */
const permitFor = (projectId: string): PermitWithCycles =>
  ({
    id: 1,
    project_id: projectId,
    type: 'Building Permit',
    status: null,
    num: null,
    stage: 'de',
    permit_cycles: [],
  }) as unknown as PermitWithCycles;

const rowFor = (over: Partial<Project>): LibraryRow => {
  const p = proj(over);
  const rows = buildLibraryRows([p], [permitFor(p.id)]);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe('fix-410 §2: the row builder keeps all three states apart', () => {
  it('★★★ true / false / null survive as themselves', () => {
    expect(rowFor({ is_regular_shape: true }).isRegularShape).toBe(true);
    expect(rowFor({ is_regular_shape: false }).isRegularShape).toBe(false);
    expect(rowFor({ is_regular_shape: null }).isRegularShape).toBeNull();
  });

  it('★★★ an ABSENT column reads null, not false — the select-list trap', () => {
    // ★ `useProjects` uses an EXPLICIT select list. An unlisted column arrives
    //   as `undefined`, and a truthiness check would have turned that into a
    //   confident "Irregular" on every row in the app.
    const row = rowFor({});
    expect(row.isRegularShape).toBeNull();
    expect((proj({}) as { is_regular_shape?: unknown }).is_regular_shape)
      .toBeUndefined();
  });

  it('★★★ ...and the column IS on the select list, so it never happens', () => {
    // The fix-122 trap, then the fix-386 trap, now this. Three tickets.
    expect(useProjectsSource).toContain(
      "'num_lots, is_corner_lot, is_regular_shape, closing_date'",
    );
  });

  it('★★★ the Project Overview renders three distinct states, never null as Yes', () => {
    const block = headerSource.slice(
      headerSource.indexOf("label=\"Regular Shape\"") - 200,
      headerSource.indexOf("label=\"Regular Shape\"") + 700,
    );
    // Yes / No / '' — the empty string is the "nobody has said" rendering.
    expect(block).toContain("project.is_regular_shape === true");
    expect(block).toContain("? 'Yes'");
    expect(block).toContain("? 'No'");
    expect(block).toContain(": ''");
    expect(block).toContain("options={['', 'Yes', 'No']}");
    // ★ and it commits through the same path every other site field uses.
    expect(block).toContain("'is_regular_shape',");
  });

  it('★★ the Library cell renders Regular / Irregular / em dash', () => {
    expect(matrixSource).toContain('library-regular-shape-');
    expect(matrixSource).toMatch(
      /row\.isRegularShape === true[\s\S]{0,200}Regular[\s\S]{0,200}Irregular/,
    );
  });
});

// ---------------------------------------------------------------------------
// §3 · THE LIBRARY FILTER, INCLUDING "NOT SET"
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  search: '', lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  zone: '', alley: '', productTypes: [], tag: '', juris: '',
  isCornerLot: '', isRegularShape: '', stories: '',
  parkingKind: '', stalls: '', roofDeck: '',
};

const THREE: LibraryRow[] = [
  { ...rowFor({ is_regular_shape: true }), projectId: 'reg', address: 'A' },
  { ...rowFor({ is_regular_shape: false }), projectId: 'irr', address: 'B' },
  { ...rowFor({ is_regular_shape: null }), projectId: 'unset', address: 'C' },
];

describe('fix-410 §3: filter to each of the three states', () => {
  it('★★★ Any keeps all three', () => {
    expect(filterLibraryRows(THREE, BASE)).toHaveLength(3);
  });

  it('★★★ Regular keeps only true', () => {
    const out = filterLibraryRows(THREE, { ...BASE, isRegularShape: 'Regular' });
    expect(out.map((r) => r.projectId)).toEqual(['reg']);
  });

  it('★★★ Irregular keeps only false — a null is NOT irregular', () => {
    const out = filterLibraryRows(THREE, { ...BASE, isRegularShape: 'Irregular' });
    expect(out.map((r) => r.projectId)).toEqual(['irr']);
  });

  it('★★★ "Not set" is SELECTABLE, and finds exactly the nulls', () => {
    // ★ Bobby's default means this population should be empty. Making it
    //   findable is how anybody notices when it is not — a state you cannot
    //   filter for is a state you cannot audit.
    const out = filterLibraryRows(THREE, { ...BASE, isRegularShape: 'Not set' });
    expect(out.map((r) => r.projectId)).toEqual(['unset']);
  });

  it('★★ the counts agree with the rows shown', () => {
    const states: LibraryFilters['isRegularShape'][] = [
      'Regular', 'Irregular', 'Not set',
    ];
    const total = states
      .map((s) => filterLibraryRows(THREE, { ...BASE, isRegularShape: s }).length)
      .reduce((a, b) => a + b, 0);
    // Three disjoint buckets that partition the whole set — no row counted
    // twice, none missed.
    expect(total).toBe(THREE.length);
  });

  it('★★ it composes with the other SITE filters rather than replacing them', () => {
    const out = filterLibraryRows(THREE, {
      ...BASE,
      isRegularShape: 'Regular',
      juris: 'Bellevue', // no row matches
    });
    expect(out).toHaveLength(0);
  });

  it('★★ the filter is on the SITE card (fix-406 teal), not the UNIT one', () => {
    const site = matrixSource.slice(
      matrixSource.indexOf('data-testid="filter-card-site"'),
      matrixSource.indexOf('data-testid="filter-card-unit"'),
    );
    expect(site.length).toBeGreaterThan(100);
    expect(site).toContain('data-testid="filter-regular-shape"');
  });
});

// ---------------------------------------------------------------------------
// §4 · SORTING DOES NOT THROW — the fix-406 lesson, applied to a new column
// ---------------------------------------------------------------------------

describe('fix-410 §4: the new column sorts, and nothing throws', () => {
  it('★★★ it is in SORTABLE_COLUMNS *and* has a real sort arm', () => {
    // ★★ LISTING IT IS HALF THE JOB. `isSortableColumn` guards with this list,
    //    so a name listed here but NOT handled in sortLibraryRows falls through
    //    to `a[col].localeCompare(...)` on a boolean — the exact TypeError
    //    fix-406 had to fix, during render, taking the whole Library down.
    expect(SORTABLE_COLUMNS).toContain('isRegularShape');
    expect(isSortableColumn('isRegularShape')).toBe(true);
    expect(() =>
      sortLibraryRows(THREE, { col: 'isRegularShape', asc: true }),
    ).not.toThrow();
  });

  it('★★★ EVERY sortable column has an arm — the guard generalised', () => {
    // ★ Not just the new one. This is the assertion that would have caught
    //   fix-406's bug before it shipped, and it now covers whatever gets added
    //   next.
    for (const col of SORTABLE_COLUMNS) {
      expect(() => sortLibraryRows(THREE, { col, asc: true })).not.toThrow();
      expect(() => sortLibraryRows(THREE, { col, asc: false })).not.toThrow();
    }
  });

  it('★★ asc: regular < irregular < not-set (NULLs last, fix-122\'s rule)', () => {
    const out = sortLibraryRows(THREE, { col: 'isRegularShape', asc: true });
    expect(out.map((r) => r.isRegularShape)).toEqual([true, false, null]);
  });

  it('★★ desc flips the two answers and STILL puts nulls last', () => {
    const out = sortLibraryRows(THREE, { col: 'isRegularShape', asc: false });
    expect(out.map((r) => r.isRegularShape)).toEqual([false, true, null]);
  });

  it('★★ a stored sort naming a column that no longer exists still falls back', () => {
    expect(() =>
      sortLibraryRows(THREE, {
        col: 'isRegularShapeX' as never,
        asc: true,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5 · THE FILTER MEMORY (fix-403)
// ---------------------------------------------------------------------------

describe('fix-410 §5: the filter is remembered like every other one', () => {
  it('★★ it round-trips through the session store', () => {
    window.sessionStorage.clear();
    saveFilterState('library.filters', 'u-1', {
      ...BASE,
      isRegularShape: 'Irregular',
    });
    expect(loadLibraryFilters('u-1', BASE)!.isRegularShape).toBe('Irregular');
  });

  it('★★★ a session stored BEFORE this ticket has no key — it falls back to Any', () => {
    window.sessionStorage.clear();
    const { isRegularShape: _drop, ...preFix410 } = BASE;
    void _drop;
    saveFilterState('library.filters', 'u-1', preFix410);
    // ★ Not `undefined` into the <select> — that would make it uncontrolled
    //   and React would warn while the filter silently stopped working.
    expect(loadLibraryFilters('u-1', BASE)!.isRegularShape).toBe('');
  });

  it('★★ a value outside the closed set falls back, and the REST still restores', () => {
    window.sessionStorage.clear();
    saveFilterState('library.filters', 'u-1', {
      ...BASE,
      zone: 'kept',
      isRegularShape: 'Rhomboid',
    });
    const out = loadLibraryFilters('u-1', BASE)!;
    expect(out.isRegularShape).toBe('');
    expect(out.zone).toBe('kept');
  });
});

// ---------------------------------------------------------------------------
// §6 · THE MIGRATION — the trap, and the approved backfill
// ---------------------------------------------------------------------------

describe('fix-410 §6: both RPCs learn the key, and the backfill is honest', () => {
  it('★★★ the CREATE RPC gets it in the INSERT column list AND the VALUES', () => {
    // ★ Both halves, or the INSERT is malformed at runtime rather than here.
    expect(migrationSql).toContain('num_lots, is_corner_lot, is_regular_shape, closing_date');
    expect(migrationSql).toContain("v_pd ? ''is_regular_shape''");
  });

  it('★★★ the UPDATE RPC gets the `?` guard — an absent key means LEAVE ALONE', () => {
    expect(migrationSql).toContain("v_patch ? ''is_regular_shape''");
    expect(migrationSql).toContain('ELSE is_regular_shape END');
  });

  it('★★★ the function blocks PATCH the live definition, they do not retype it', () => {
    // migrations/ is partial and prod is ahead of it, so pasting a full
    // CREATE OR REPLACE risks silently reverting whatever shipped since. Each
    // block reads pg_get_functiondef() and RAISES if its anchor is not present
    // exactly once.
    expect(migrationSql).toContain('pg_get_functiondef');
    expect(migrationSql).toMatch(/anchor not found exactly once/);
  });

  it('★★★ the backfill suppresses the OCC + activity triggers, and re-enables them', () => {
    // ★ Letting projects_set_updated_at fire would tell every open client that
    //   all 193 projects were "modified by someone else" (fix-341's exact false
    //   alarm) and would claim every project was edited on the migration date.
    expect(migrationSql).toContain('DISABLE TRIGGER projects_set_updated_at');
    expect(migrationSql).toContain('DISABLE TRIGGER bp_log_user_activity');
    expect(migrationSql).toContain('ENABLE TRIGGER projects_set_updated_at');
    expect(migrationSql).toContain('ENABLE TRIGGER bp_log_user_activity');
  });

  it('★★★ the backfill is the ONLY data write, and it is guarded', () => {
    const updates = [...migrationSql.matchAll(/^\s*UPDATE\s+public\./gim)];
    expect(updates).toHaveLength(1);
    expect(migrationSql).toContain(
      'UPDATE public.projects SET is_regular_shape = true WHERE is_regular_shape IS NULL;',
    );
    // ★ It fails the migration rather than shipping a half-backfilled table.
    expect(migrationSql).toContain('backfill left % NULL rows');
  });

  it('★★ no _PENDING_APPROVAL file was added — Bobby approved this one', () => {
    expect(migrationSql).not.toContain('PENDING_APPROVAL');
  });
});
