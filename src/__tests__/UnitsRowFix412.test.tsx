import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
// ★ fix-486 §D: `fireEvent`/`waitFor` left with §B — every remaining
//   assertion in this file reads a rendered row rather than driving one.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import migrationSql from '../../migrations/fix_412_existing_to_remodel.sql?raw';
import { UNIT_MATRIX_GRID, UNIT_ROW_COLUMNS } from '../lib/unitRowLayout';
// ★★★ fix-486 §D (P-143) — `unitWorkScope` AND `libraryHelpers` ARE NO LONGER
//     IMPORTED HERE. Both belonged to §B/§B4; see the retirement record below.
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

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
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
    lot_size_sf: null,
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

// =========================================================================
// ★★★ §C, THIRD EDITION — AND EVERY EDITION WAS RIGHT WHEN IT SHIPPED
// =========================================================================
//
// fix-412  laid the unit fields across in ONE declared grid, because the header
//          strip and the row were two lists of widths that had drifted four
//          ways. **That ruling is still in force and is asserted below.**
// fix-417  wrapped the row in `overflow-x`, because at 620px it was setting the
//          width of the whole page.
// fix-418  went VERTICAL, which removed the scrollbar at source.
// fix-422  goes back to horizontal, because Bobby saw vertical on real
//          projects: *"When you have more than two different unit dimensions,
//          the page gets way too vertically long, and it stretches out
//          milestones, team, design plan of record, builder/owner… go back to
//          horizontal."*
//
// ★★★ WHAT ACTUALLY MOVED IS THE WIDTH, NOT THE SHAPE. fix-412's row was TEN
// columns and 620px because it spelled everything out — Label 84, Work 74,
// Parking 104. The matrix is NINE columns and 274px because Bobby asked for
// abbreviations, letter codes and no `×` separator, and because `work_scope`
// left the grid entirely. A horizontal row was never the problem; 620px of one
// was. `FIX_412_ROW_WIDTH` keeps that number as evidence, since fix-417 still
// depends on it.
//
// ★★ SO fix-412's REAL RULING SURVIVES ITS THIRD RESHAPE INTACT: the header and
// every row render from ONE `grid-template-columns`, so a header cannot sit
// over the wrong control. That is what this block asserts now.
describe('fix-412 §C (third edition, fix-422): one template, header and rows', () => {
  it('★★★ C-CORE: the header and every row render from the SAME template', () => {
    // ★★★ THE DEFECT fix-412 EXISTED FOR, and the property that has survived
    //     three layouts: two hand-kept lists drift, one template cannot.
    // ★ fix-486: the vocabulary, not the claim. Two DIFFERENT labels is all
    //   this needs; they just have to be labels the app still offers.
    setup(
      [unit({ label: 'Detached' }), unit({ label: 'Remodel' })],
      ['Detached', 'Remodel'],
    );
    const header = screen.getByTestId('pd-unit-header');
    expect(header.style.gridTemplateColumns).toBe(UNIT_MATRIX_GRID);
    const rows = screen.getAllByTestId('pd-unit-row');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.style.gridTemplateColumns).toBe(UNIT_MATRIX_GRID);
    }
  });

  it('★★★ C3: the field order is still Bobby\'s, declared once', () => {
    // ★ fix-422 Scope 7 took `work_scope` off the grid; fix-486 §D retired the
    //   field outright. The assertion below is kept and is STRONGER than it
    //   was — it used to mean "not a column", it now means "not a field" —
    //   because it is the one that catches the column list growing it back.
    //   Every other field is in the order Bobby gave, unchanged since fix-412.
    const keys = UNIT_ROW_COLUMNS.map((c) => c.key).filter((k) => k !== 'remove');
    expect(keys).toEqual([
      'label',
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
    ]);
    expect(UNIT_ROW_COLUMNS.some((c) => c.key === 'work_scope')).toBe(false);
  });

  it('★★ C1: the "Unit dimensions" heading is still there, its own section', () => {
    setup([unit()]);
    expect(screen.getByTestId('pd-project-units').textContent).toContain(
      'Unit dimensions',
    );
  });

  it('★★★ C5 IS REVERSED BY BOBBY, and the reasoning goes with it', () => {
    // fix-411 §3 wrote "RD" because the cell was 52px. fix-412 C5 restored
    // "Roof Deck" because reclaiming the gutter had bought the row 42px and the
    // constraint had expired. Bobby has now asked for the abbreviation back —
    // *"Roof deck could be RD"* — for a 26px cell.
    //
    // ★★★ NOT A REGRESSION TO fix-411's PROBLEM. What made bare "Deck" bad was
    // that it was ambiguous with nothing to disambiguate it. Every header here
    // carries a plain-language summary reachable by hover AND by Tab, so the
    // header is short and the meaning is one keystroke away — which is more
    // than either previous edition offered.
    const rd = UNIT_ROW_COLUMNS.find((c) => c.key === 'roof_deck')!;
    expect(rd.header).toBe('RD');
    expect(rd.tooltip).toBe('Whether this unit type has a roof deck.');
    expect(UNIT_ROW_COLUMNS.map((c) => c.header)).not.toContain('Deck');
  });

  it('★★★ every column that edits a field has a header AND a summary', () => {
    for (const c of UNIT_ROW_COLUMNS) {
      if (c.key === 'remove') {
        expect(c.header).toBe('');
        continue;
      }
      expect(c.header.length).toBeGreaterThan(0);
      expect(c.tooltip.length).toBeGreaterThan(20);
    }
  });
});

// ===========================================================================
// ★★★ fix-486 §D (P-143) — §B AND §B4 ARE RETIRED, BY NAME
// ===========================================================================
//
// Bobby, 2026-09-03: **one way to say remodel — the type.** `work_scope` is
// gone from the type, the row, the Library and the stored json, so the twelve
// tests below have nothing left to assert. Naming them is the point: a deleted
// test nobody can find later reads as coverage that quietly lapsed.
//
// ---------------------------------------------------------------------------
// RETIRED FROM `fix-412 §B: three states, and null is not an answer`
// ---------------------------------------------------------------------------
//   · B1/B2: the key is `work_scope`, and absent means NOT ANSWERED
//   · only an explicit "none" is a no-work unit
//   · B3 (fix-418): the control renders only on a REMODEL
//   · picking an answer writes it onto the unit object
//   · B5: a No-work unit SUPPRESSES its detail inputs
//   · NOT ANSWERED does not suppress — those units still need filling in
//   · FALSIFIABLE CLAIM: suppressing does NOT orphan stored values
//
// ---------------------------------------------------------------------------
// RETIRED FROM `fix-412 §B4: the Library filter, three states plus Any`
// ---------------------------------------------------------------------------
//   · ANY excludes a confirmed No-work unit — Bobby's default ruling
//   · ...but a NOT-YET-ANSWERED unit is NOT silently excluded
//   · each of the three states is reachable BY NAME
//   · a confirmed no-work project still drops out, by default and always
//   · …and a project is only dropped when EVERY unit is a confirmed no-work
//
// ---------------------------------------------------------------------------
// ★★★ TWO OF THOSE ASSERTED A BEHAVIOUR THAT NEVER ONCE HAPPENED
// ---------------------------------------------------------------------------
// "B5 SUPPRESSES its detail inputs" and "a confirmed no-work project drops out
// of the Library" both fire on `work_scope === 'none'`. Measured on prod
// 2026-09-03: 245 unit rows, 95 carrying the key at all, **zero non-null**. In
// the six weeks the field shipped, no row was ever suppressed and no project
// was ever dropped. The tests passed on fixtures the data never produced —
// which is not a criticism of them (they were the only way to prove the rule)
// so much as the strongest argument for retiring the rule.
//
// ---------------------------------------------------------------------------
// ★★ TWO THINGS FROM THIS BLOCK ARE **KEPT**, RE-HOMED HERE
// ---------------------------------------------------------------------------
// They are about the unit ROW, not about work_scope, and losing them with the
// field would be an accident.

describe('fix-412 §B (surviving): the unit row, after work_scope', () => {
  it('★★ MUST NOT CHANGE: fractional unit dimensions keep their precision', () => {
    // 102 of 232 unit rows carry a fractional width; half-feet are real design
    // dimensions. Bobby's rounding ruling (fix-411) was about LOT dimensions.
    // ★ Named in fix-486's "must not change" list too — the remap touches
    //   `label` and nothing else on the row.
    setup([unit({ width_ft: 20.5, depth_ft: 30.25 })]);
    expect((screen.getByTestId('pd-unit-w') as HTMLInputElement).value).toBe('20.5');
    expect((screen.getByTestId('pd-unit-d') as HTMLInputElement).value).toBe('30.25');
  });

  it('★★★ nothing on the row is disabled any more — the suppression is GONE', () => {
    // ★★★ THE FALSIFIABLE HALF OF THE RETIREMENT. fix-412 §B5 disabled seven
    //     inputs on a "no work" unit. There is no such answer now, so a row
    //     that would once have carried one must render fully live. If the
    //     suppression came back — a stray `disabled` from a re-added rule —
    //     this fails rather than the behaviour silently returning.
    setup([unit({ label: 'Remodel' })], ['Remodel']);
    for (const testid of [
      'pd-unit-w',
      'pd-unit-d',
      'pd-unit-qty',
      'pd-unit-stories',
      'pd-unit-parking-kind',
      'pd-unit-stalls',
      'pd-unit-roof-deck',
      'pd-unit-label-select',
    ]) {
      expect(screen.getByTestId(testid)).not.toBeDisabled();
    }
    // ★ And the control itself is absent, not merely inert.
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    expect(screen.getByTestId('pd-unit-row').dataset.noWork).toBeUndefined();
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
