import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import migrationSql from '../../migrations/fix_412_existing_to_remodel.sql?raw';
import {
  UNIT_ROW_COLUMNS,
  UNIT_ROW_GRID,
  UNIT_ROW_SUPPRESSED_ON_NO_WORK,
} from '../lib/unitRowLayout';
import {
  WORK_SCOPES,
  asWorkScope,
  isNoWorkUnit,
  matchWorkScope,
} from '../lib/unitWorkScope';
import {
  filterLibraryRows,
  hasAnyUnitFilter,
  type LibraryFilters,
  type LibraryRow,
} from '../lib/libraryHelpers';
import type { UnitType } from '../lib/database.types';

// ===========================================================================
// fix-412 — the PROPOSAL → Units row, designed once
// ===========================================================================
//
//   A  rename Existing → Remodel (registry + 6 projects + 2 unit rows)
//   B  a Remodel says whether work was performed — three states
//   C  re-lay the row so every header sits over its own control
//
// ★★★ STEP 0's CORRECTIONS TO THE BRIEF, pinned so they are not rediscovered:
//
//   · `src/components/shared/UnitTypesEditor.tsx` DOES NOT EXIST. The file is
//     `src/components/wizard/UnitTypesEditor.tsx` (line 179 was right).
//   · `LibraryMatrix.tsx:875` is the LOT W×D **cell**; the column **header** is
//     at :691.
//   · The SITE card's lot row is `SiteLotRow`, starting at :2085, not :2100.
//   · Everything else in the brief's list was where it said it was.
//
// ★★ THE LAYOUT ASSERTIONS BELOW ARE ON RENDERED GEOMETRY, not on source
// strings — Scope C4's requirement, and the right call: the defect was that two
// hand-maintained width lists disagreed, and a source assertion would happily
// pass against two lists that still disagreed.

// ---------------------------------------------------------------------------
// Harness — the same shape ProjectDetailHeaderFix205.test.tsx uses
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
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function setup(unitTypes: UnitType[], productTypes: string[] = ['Remodel', 'SFR']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = {
    id: 'p-test',
    address: '500 Pike St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: unitTypes,
    alley: null,
    product_types: productTypes,
    project_tags: null,
    created_at: TOKEN,
    updated_at: TOKEN,
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

const unit = (over: Partial<UnitType> = {}): UnitType =>
  ({
    label: 'Remodel',
    width_ft: 20,
    depth_ft: 30,
    qty: 1,
    stories: 2,
    ...over,
  }) as UnitType;

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'p-test', updated_at: TOKEN });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// §C · THE ROW, LAID OUT ONCE
// ---------------------------------------------------------------------------

describe('fix-412 §C: every header sits over its own control', () => {
  it('★★★ the header and the row are the SAME grid — the structural fix', () => {
    // ★★ THIS IS THE ASSERTION THAT MAKES THE DEFECT UNREPEATABLE. The bug was
    //    two independent width lists; if the header and the row render from one
    //    `grid-template-columns`, a header cannot sit over the wrong control
    //    because they are in the same column. Asserting the two STRINGS MATCH
    //    is asserting there is only one list.
    setup([unit()]);
    const header = screen.getByTestId('pd-unit-header');
    const row = screen.getByTestId('pd-unit-row');
    expect(header.style.gridTemplateColumns).toBe(UNIT_ROW_GRID);
    expect(row.style.gridTemplateColumns).toBe(UNIT_ROW_GRID);
    expect(header.style.gridTemplateColumns).toBe(row.style.gridTemplateColumns);
  });

  it('★★★ header cells and row cells are the SAME COUNT — no orphan control', () => {
    // ★ The remove × used to have no header column at all, so every cumulative
    //   error landed on the last real column. Same count = every control has a
    //   header and every header has a control.
    setup([unit()]);
    const header = screen.getByTestId('pd-unit-header');
    const row = screen.getByTestId('pd-unit-row');
    expect(header.children.length).toBe(UNIT_ROW_COLUMNS.length);
    expect(row.children.length).toBe(UNIT_ROW_COLUMNS.length);
  });

  it('★★★ DEFECT 1: "Roof Deck" is the LAST header, over the roof-deck control', () => {
    // Bobby: "RD did not sit over its own box."
    setup([unit()]);
    const header = screen.getByTestId('pd-unit-header');
    const row = screen.getByTestId('pd-unit-row');
    const rdIndex = UNIT_ROW_COLUMNS.findIndex((c) => c.key === 'roof_deck');
    expect(header.children[rdIndex].textContent).toBe('Roof Deck');
    // ★ The control in the SAME grid index is the roof-deck select.
    expect(
      within(row.children[rdIndex] as HTMLElement).queryByTestId(
        'pd-unit-roof-deck',
      ) ?? (row.children[rdIndex] as HTMLElement),
    ).toHaveAttribute('data-testid', 'pd-unit-roof-deck');
  });

  it('★★★ DEFECT 2: Stalls sits in its own column, not drifting into Parking', () => {
    // Bobby: "Stalls drifted toward Parking." It drifted because
    // ParkingKindSelect had NO width and auto-sized to "Surface + Garage".
    setup([unit()]);
    const header = screen.getByTestId('pd-unit-header');
    const row = screen.getByTestId('pd-unit-row');
    const pIdx = UNIT_ROW_COLUMNS.findIndex((c) => c.key === 'parking_kind');
    const sIdx = UNIT_ROW_COLUMNS.findIndex((c) => c.key === 'parking_stalls');
    expect(header.children[pIdx].textContent).toBe('Parking');
    expect(header.children[sIdx].textContent).toBe('Stalls');
    expect(row.children[pIdx]).toHaveAttribute('data-testid', 'pd-unit-parking-kind');
    expect(row.children[sIdx]).toHaveAttribute('data-testid', 'pd-unit-stalls');
    // ★ ...and the selects FILL their column now instead of auto-sizing, which
    //   is what made them push their neighbours around.
    expect((row.children[pIdx] as HTMLElement).className).toContain('w-full');
    expect((row.children[sIdx] as HTMLElement).className).toContain('w-full');
  });

  it('★★★ C3: Bobby\'s column order is intact, with `work` inserted after Label', () => {
    const keys = UNIT_ROW_COLUMNS.map((c) => c.key).filter((k) => k !== 'remove');
    expect(keys).toEqual([
      'label',
      'work_scope',
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
    ]);
    // ★ His eight, in his exact relative order, as a subsequence.
    expect(keys.filter((k) => k !== 'work_scope')).toEqual([
      'label',
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
    ]);
  });

  it('★★ C1: the "Unit dimensions" heading renders above the row', () => {
    setup([unit()]);
    expect(
      screen.getByTestId('pd-unit-dimensions-heading').textContent,
    ).toBe('Unit dimensions');
  });

  it('★★★ C2: the row is no longer indented behind a "Units" side-label', () => {
    // ★ The gutter Bobby pointed at: the old shape was
    //   `[36px "Units"] [gap] [row]`, so the row began ~42px in. The heading is
    //   a BLOCK above the row now, so the row starts at the container edge —
    //   which is the width that let "Roof Deck" go back to full words.
    setup([unit()]);
    const block = screen.getByTestId('pd-unit-dimensions-block');
    const heading = screen.getByTestId('pd-unit-dimensions-heading');
    const header = screen.getByTestId('pd-unit-header');
    // The heading and the grid are siblings stacked in the block, not a
    // label-beside-content pair.
    expect(block).toContainElement(heading);
    expect(block).toContainElement(header);
    expect(heading.nextElementSibling).toContainElement(header);
  });

  it('★★ C5: "Roof Deck" fits in full — the 52px that forced "RD" is gone', () => {
    const rd = UNIT_ROW_COLUMNS.find((c) => c.key === 'roof_deck')!;
    expect(rd.header).toBe('Roof Deck');
    expect(rd.width).toBeGreaterThan(52);
    setup([unit()]);
    expect(screen.getByTestId('pd-unit-header-roof_deck').textContent).toBe(
      'Roof Deck',
    );
  });
});

// ---------------------------------------------------------------------------
// §B · THE THREE-STATE WORK SCOPE
// ---------------------------------------------------------------------------

describe('fix-412 §B: three states, and null is not an answer', () => {
  it('★★★ B1/B2: the key is `work_scope`, and absent means NOT ANSWERED', () => {
    // ★ A boolean would have defaulted all 234 existing unit objects to an
    //   answer nobody gave. An absent key reads as null, which is true of every
    //   one of them.
    expect(asWorkScope(undefined)).toBeNull();
    expect(asWorkScope(null)).toBeNull();
    expect(asWorkScope('none')).toBe('none');
    expect(asWorkScope('performed')).toBe('performed');
    // ★ Anything else — a hand-edited blob, a `false` from an earlier shape —
    //   reads as not answered rather than guessing.
    for (const junk of [false, true, 0, 1, 'partial', {}, []]) {
      expect(asWorkScope(junk)).toBeNull();
    }
    expect([...WORK_SCOPES]).toEqual(['none', 'performed']);
  });

  it('★★★ only an explicit "none" is a no-work unit', () => {
    expect(isNoWorkUnit({ work_scope: 'none' })).toBe(true);
    expect(isNoWorkUnit({ work_scope: 'performed' })).toBe(false);
    expect(isNoWorkUnit({})).toBe(false);
    expect(isNoWorkUnit(null)).toBe(false);
  });

  it('★★★ B3: the control renders in the row, between Label and W', () => {
    setup([unit()]);
    const row = screen.getByTestId('pd-unit-row');
    const idx = UNIT_ROW_COLUMNS.findIndex((c) => c.key === 'work_scope');
    expect(row.children[idx]).toHaveAttribute('data-testid', 'pd-unit-work-scope');
    expect(screen.getByTestId('pd-unit-header-work_scope').textContent).toBe('Work');
    // Three options: not answered, No work, Work performed.
    const sel = screen.getByTestId('pd-unit-work-scope') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      '',
      'none',
      'performed',
    ]);
  });

  it('★★★ picking an answer writes it onto the unit object', async () => {
    setup([unit()]);
    fireEvent.change(screen.getByTestId('pd-unit-work-scope'), {
      target: { value: 'none' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(
      updateMutateAsync.mock.calls[0][0].patch.unit_types[0].work_scope,
    ).toBe('none');
  });

  it('★★★ B5: a No-work unit SUPPRESSES its detail inputs', () => {
    setup([unit({ work_scope: 'none' })]);
    expect(screen.getByTestId('pd-unit-row').dataset.noWork).toBe('true');
    for (const key of UNIT_ROW_SUPPRESSED_ON_NO_WORK) {
      const testid = {
        width_ft: 'pd-unit-w',
        depth_ft: 'pd-unit-d',
        qty: 'pd-unit-qty',
        stories: 'pd-unit-stories',
        parking_kind: 'pd-unit-parking-kind',
        parking_stalls: 'pd-unit-stalls',
        roof_deck: 'pd-unit-roof-deck',
      }[key]!;
      expect(screen.getByTestId(testid)).toBeDisabled();
    }
    // ★ The three that stay LIVE: you must be able to see what it is, change
    //   your mind, and delete the row.
    expect(screen.getByTestId('pd-unit-label-select')).not.toBeDisabled();
    expect(screen.getByTestId('pd-unit-work-scope')).not.toBeDisabled();
  });

  it('★★ NOT ANSWERED does not suppress — those units still need filling in', () => {
    setup([unit()]);
    expect(screen.getByTestId('pd-unit-row').dataset.noWork).toBe('false');
    expect(screen.getByTestId('pd-unit-w')).not.toBeDisabled();
    expect(screen.getByTestId('pd-unit-roof-deck')).not.toBeDisabled();
  });

  it('★★★ FALSIFIABLE CLAIM: suppressing does NOT orphan stored values', async () => {
    // The brief: *"Prove it with a test that round-trips a unit through No-work
    // and back."* The inputs are DISABLED, never cleared — so the stored values
    // survive the round trip and come straight back.
    const stored = unit({
      width_ft: 20.5,
      depth_ft: 30.5,
      stories: 3,
      roof_deck: true,
    });
    setup([{ ...stored, work_scope: 'none' }]);

    // Still rendering the stored numbers while suppressed — nothing was wiped.
    expect((screen.getByTestId('pd-unit-w') as HTMLInputElement).value).toBe('20.5');
    expect((screen.getByTestId('pd-unit-d') as HTMLInputElement).value).toBe('30.5');
    expect((screen.getByTestId('pd-unit-stories') as HTMLInputElement).value).toBe('3');
    expect((screen.getByTestId('pd-unit-roof-deck') as HTMLSelectElement).value).toBe(
      'Yes',
    );

    // Answer "work performed" again — the ONLY key that changes is work_scope.
    fireEvent.change(screen.getByTestId('pd-unit-work-scope'), {
      target: { value: 'performed' },
    });
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const written = updateMutateAsync.mock.calls[0][0].patch.unit_types[0];
    expect(written.work_scope).toBe('performed');
    expect(written.width_ft).toBe(20.5);
    expect(written.depth_ft).toBe(30.5);
    expect(written.stories).toBe(3);
    expect(written.roof_deck).toBe(true);
  });

  it('★★ MUST NOT CHANGE: fractional unit dimensions keep their precision', () => {
    // 102 of 232 unit rows carry a fractional width; half-feet are real design
    // dimensions. Bobby's rounding ruling (fix-411) was about LOT dimensions.
    setup([unit({ width_ft: 20.5, depth_ft: 30.25 })]);
    expect((screen.getByTestId('pd-unit-w') as HTMLInputElement).value).toBe('20.5');
    expect((screen.getByTestId('pd-unit-d') as HTMLInputElement).value).toBe('30.25');
  });
});

// ---------------------------------------------------------------------------
// §B4 · THE LIBRARY FILTER
// ---------------------------------------------------------------------------

const BASE: LibraryFilters = {
  search: '', lotwTarget: null, lotwBuf: 2, lotdTarget: null, lotdBuf: 2,
  unitwTarget: null, unitwBuf: 2, unitdTarget: null, unitdBuf: 2,
  zone: '', alley: '', productTypes: [], tag: '', juris: '',
  isCornerLot: '', isRegularShape: '', stories: '',
  parkingKind: '', stalls: '', roofDeck: '', workScope: '',
};

const libRow = (id: string, units: UnitType[]): LibraryRow =>
  ({
    projectId: id, address: id, juris: '', productTypes: [], units: units.length,
    zone: '', lotWidth: 40, lotDepth: 100, alley: '', tags: [], stage: 'de',
    unitTypes: units, numLots: null, isCornerLot: null, isRegularShape: null,
    updatedAt: null,
  }) as LibraryRow;

const ROWS: LibraryRow[] = [
  libRow('performed', [unit({ work_scope: 'performed' })]),
  libRow('none', [unit({ work_scope: 'none' })]),
  libRow('unanswered', [unit()]),
];

describe('fix-412 §B4: the Library filter, three states plus Any', () => {
  it('★★★ ANY excludes a confirmed No-work unit — Bobby\'s default ruling', () => {
    expect(matchWorkScope('none', '')).toBe(false);
    expect(matchWorkScope('performed', '')).toBe(true);
  });

  it('★★★ ...but a NOT-YET-ANSWERED unit is NOT silently excluded', () => {
    // ★ The half that matters most: the field must not hide exactly the units
    //   somebody needs to chase.
    expect(matchWorkScope(null, '')).toBe(true);
    expect(matchWorkScope(undefined, '')).toBe(true);
  });

  it('★★★ each of the three states is reachable BY NAME', () => {
    // ★ This is what makes the hidden default exclusion honest rather than a
    //   trap: nothing becomes unfindable.
    expect(matchWorkScope('none', 'none')).toBe(true);
    expect(matchWorkScope('performed', 'none')).toBe(false);
    expect(matchWorkScope('performed', 'performed')).toBe(true);
    expect(matchWorkScope(null, 'unanswered')).toBe(true);
    expect(matchWorkScope('none', 'unanswered')).toBe(false);
  });

  it('★★★ the filter actually narrows the Library rows', () => {
    // ★ Any: the no-work project drops, the unanswered one stays.
    expect(
      filterLibraryRows(ROWS, BASE).map((r) => r.projectId).sort(),
    ).toEqual(['performed', 'unanswered']);
    expect(
      filterLibraryRows(ROWS, { ...BASE, workScope: 'none' }).map((r) => r.projectId),
    ).toEqual(['none']);
    expect(
      filterLibraryRows(ROWS, { ...BASE, workScope: 'performed' }).map((r) => r.projectId),
    ).toEqual(['performed']);
    expect(
      filterLibraryRows(ROWS, { ...BASE, workScope: 'unanswered' }).map((r) => r.projectId),
    ).toEqual(['unanswered']);
  });

  it('★★★ hasAnyUnitFilter knows about it — or the filter would be INERT', () => {
    // ★ It gates whether matchingUnitIndices runs at all. fix-205 shipped this
    //   exact bug with `stories`, and the function's own comment records it.
    expect(hasAnyUnitFilter(BASE)).toBe(false);
    expect(hasAnyUnitFilter({ ...BASE, workScope: 'none' })).toBe(true);
  });

  it('★★ it ANDs onto the SAME unit as the other unit filters (fix-402)', () => {
    // A project with unit A (work performed, no deck) and unit B (no work,
    // deck) must NOT match "work performed AND roof deck".
    const split = libRow('split', [
      unit({ work_scope: 'performed', roof_deck: false }),
      unit({ work_scope: 'none', roof_deck: true }),
    ]);
    expect(
      filterLibraryRows([split], {
        ...BASE,
        workScope: 'performed',
        roofDeck: 'Yes',
      }),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §A · THE RENAME
// ---------------------------------------------------------------------------

describe('fix-412 §A: Existing → Remodel, and nothing else moved', () => {
  it('★★★ all three places are renamed in ONE migration', () => {
    // ★ The registry, the 6 projects and the 2 unit rows must move together:
    //   renaming the registry alone would leave 8 rows carrying a value the
    //   dropdown no longer offers, and resolveUnitLabel renders "Pick type…"
    //   for any label not in the registry.
    expect(migrationSql).toContain("key = 'productTypeOptions'");
    expect(migrationSql).toContain(
      "array_replace(product_types, 'Existing', 'Remodel')",
    );
    expect(migrationSql).toContain("jsonb_set(ut, '{label}', '\"Remodel\"'::jsonb)");
  });

  it('★★★ every match is on the EXACT string — no other product type moves', () => {
    // ★★ COMMENT-STRIPPED. The migration's own header says "no LIKE, no ILIKE",
    //    so a raw assertion matches the note describing the guarantee. That is
    //    the trap fix-387/390/395/405/406/411 each hit — the seventh time, and
    //    stripped rather than rediscovered an eighth.
    const sql = migrationSql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/ILIKE|LIKE\s+'%/i);
    // ★ And the registry length is asserted unchanged: a rename, not an add.
    expect(migrationSql).toContain('a rename must not add or drop');
  });

  it('★★ unit ORDER is preserved — a rename must not reshuffle a unit list', () => {
    // The rows render in array order and UnitRow is keyed by index.
    expect(migrationSql).toContain('WITH ORDINALITY');
    expect(migrationSql).toContain('ORDER BY ord');
  });

  it('★★★ a backup is taken BEFORE the write, and it is named', () => {
    expect(migrationSql).toContain(
      '_fix412_existing_to_remodel_backup_2026_08_26',
    );
    const backupAt = migrationSql.indexOf('CREATE TABLE IF NOT EXISTS');
    const firstUpdate = migrationSql.indexOf('UPDATE public.app_config');
    expect(backupAt).toBeGreaterThan(-1);
    expect(backupAt).toBeLessThan(firstUpdate);
  });

  it('★★★ the OCC + activity triggers are suppressed and RE-ENABLED', () => {
    // ★ A vocabulary rename is not "a person edited this project": letting
    //   projects_set_updated_at fire would give anyone with one of the 6 open a
    //   false "modified by someone else" (fix-341's shape).
    expect(migrationSql).toContain('DISABLE TRIGGER projects_set_updated_at');
    expect(migrationSql).toContain('ENABLE TRIGGER projects_set_updated_at');
    expect(migrationSql).toContain('DISABLE TRIGGER bp_log_user_activity');
    expect(migrationSql).toContain('ENABLE TRIGGER bp_log_user_activity');
  });

  it('★★★ it fails rather than shipping a half-rename', () => {
    expect(migrationSql).toContain('registry not renamed');
    expect(migrationSql).toContain('projects not renamed');
    expect(migrationSql).toContain('unit rows not renamed');
  });
});
