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
import { UNIT_CONFIG_FIELDS } from '../lib/unitConfigFields';
import editorsSource from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
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
  // ★ fix-514 §F: `ProjectDataEditors` reads the project-tag registry now,
  //   so this partial mock has to carry the reader as well as the hook —
  //   the partial-mock trap, which this repo keeps meeting.
  readAppConfigStringArray: () => [],
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

// ★★★ fix-549 §B (P-255) — THIS SUITE IS ABOUT A PERMITTED USER.
//
// Every Project Data editor now asks `bp_may_write_project` before rendering an
// input, and the hook **fails closed** — so under a mocked supabase it answers
// "no" and every field would render read-only. That is the correct production
// behaviour and the wrong fixture for a suite about what the editor DOES.
//
// ★ Mocked permissive here, exactly as `useProjectConsultants` is mocked inert
//   above: the refusal path has its own suite (`CamEditsAnyProjectFix549`).
vi.mock('../hooks/useMayWriteProject', () => ({
  useMayWriteProject: () => true,
}));


// ===========================================================================
// ★★★ fix-506 §G (P-140) — THIS SUITE'S EDITOR MOVED, AND NOTHING ELSE DID
// ===========================================================================
//
// Bobby ruled the overview read-only: every project field is edited in the
// **Project Data** modal now. UnitDimensions is byte-for-byte what shipped on
// `origin/main` — the brief's rule was *"every write goes through the SAME
// hooks the overview uses today; no new RPC, same OCC tokens, same toasts"* —
// so every assertion below is unchanged and still means what it meant. Only the
// mount point moved, to the modal's **Units** tab.
// ★ fix-514 §A: the file and the component are `ProjectDetailsModal` now —
//   Project Settings is deleted and this is the one project modal.
import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';

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
  } as unknown as Parameters<typeof ProjectDetailsModal>[0]['project'];
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailsModal
      project={project}
      permits={[]}
      bp={null}
      initialTab="units"
      onClose={() => {}}
    />,
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
// ===========================================================================
// ★★★ fix-572 §C (P-277) — FOURTH EDITION, AND THE HEADER STRIP IS GONE
// ===========================================================================
//
// Bobby, 2026-09-15: *"types should be at the top and then unit configuration
// is the category that then nicely and cleanly organizes this info."*
//
// ★★★ fix-412's RULING IS NOW STRUCTURAL RATHER THAN ENFORCED. The defect it
//     existed for was two hand-kept width lists that drifted four ways and put
//     `Roof Deck` over a parking cell. fix-412 answered it by making the header
//     strip and every row render from ONE `gridTemplateColumns`, and this suite
//     pinned that string.
//
//     **There is no header strip now.** Each field is a `<label>` and its
//     control inside one element, in one piece of JSX. A label cannot sit over
//     the wrong control when it is not over a control at all — it is beside it,
//     in the same box. So the template assertion is replaced by one that says
//     the two can no longer be separate, which is a stronger form of the same
//     rule and cannot be satisfied by a template that happens to match.
//
// ★★ AND THE THIRD EDITION'S NUMBERS ARE KEPT, not deleted: `FIX_412_ROW_WIDTH`
//    (620) and `FIX_422_MATRIX_WIDTH` (266) live in `lib/unitConfigFields`
//    because fix-417's floor arithmetic still cites them. fix-422 kept fix-412's
//    620 for the same reason and said so.
describe('fix-412 §C (fourth edition, fix-572): label and control, one element', () => {
  it('★★★ C-CORE: the LABEL and the CONTROL are one JSX element', () => {
    // ★★★ THE PROPERTY THAT HAS SURVIVED FOUR LAYOUTS: two lists drift, one
    //     does not. The strongest version of it is not one template shared by
    //     two elements — it is ONE element, which is what `ConfigField` is.
    setup(
      [unit({ label: 'Detached' }), unit({ label: 'Remodel' })],
      ['Detached', 'Remodel'],
    );
    const blocks = screen.getAllByTestId('pd-unit-block');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      for (const f of UNIT_CONFIG_FIELDS) {
        // The label element and the control live inside ONE wrapper keyed to
        // the field, so there is no second list to drift against.
        const field = b.querySelector(`[data-testid="pd-unit-f-${f.key}"]`);
        expect(field, f.key).not.toBeNull();
        expect(
          field!.querySelector(`[data-testid="pd-unit-f-${f.key}-label"]`),
          f.key,
        ).not.toBeNull();
      }
    }
    // ★ And the header strip is GONE rather than merely unused — asserted on
    //   the source, because a leftover strip would be the second list again.
    expect(editorsSource).not.toContain('pd-unit-header');
    expect(editorsSource).not.toContain('pd-unit-row');
  });

  it('★★★ C3: the field order is still the one Bobby gave, declared once', () => {
    // ★★★ THE ORDER CHANGED BECAUSE BOBBY CHANGED IT, and the rule that it is
    //     declared in exactly ONE place did not. fix-412's order was
    //     `label · W · D · qty · stories · parking · roof deck`; §C gives
    //     *"Type · Quantity · Width · Depth · Unit Size · Stories · Parking ·
    //     Roof Deck"* — Quantity moves up beside Type, and Unit Size joins the
    //     dimensions it is read against.
    const keys = UNIT_CONFIG_FIELDS.map((c) => c.key);
    expect(keys).toEqual([
      'label',
      'qty',
      'width_ft',
      'depth_ft',
      // ★ fix-514 §E's separate list folds in here; see `unitConfigFields`.
      'size_sf',
      'stories',
      'parking_kind',
      // ★ fix-562 §A: `parking_stalls` left this list with the field.
      'roof_deck',
    ]);
    // ★ fix-486 §D retired `work_scope` outright. This is the assertion that
    //   catches the field list growing it back, and it is unchanged.
    expect(keys).not.toContain('work_scope');
    // ★★ ...and `remove` is not a FIELD any more. It was a ninth column with an
    //    empty header on the grid; it is the block's own × control now, which is
    //    why every entry below can be required to carry a real label.
    expect(keys).not.toContain('remove');
  });

  it('★★ C1: the editor still has a HEADING of its own', () => {
    // ★★★ fix-412 §C1 asked that the editor keep a heading rather than
    //     becoming a nameless block of inputs — Bobby had to be able to point
    //     at it. fix-506 §G gave it a whole tab; §C now splits that tab in two
    //     and names BOTH halves, which is the same guarantee twice over.
    setup([unit()]);
    expect(screen.getByTestId('project-data-tab-units').textContent).toBe('Units');
    const body = screen.getByTestId('project-data-body');
    expect(body.textContent).toContain('Types');
    expect(body.textContent).toContain('Unit configuration');
  });

  it('★★★ C5: the words are back, and this time nothing can take them again', () => {
    // fix-411 §3 wrote "RD" at a 52px cell; fix-412 §C5 restored "Roof Deck"
    // when the row bought 42px back; fix-422 abbreviated again at 26px. Three
    // editions, one argument, and the argument was always a WIDTH.
    //
    // ★★★ §C ENDS IT: *"Nothing in this block is abbreviated."* The fields are
    //     four equal tracks in a 760px modal, so no field can be squeezed to the
    //     point where a word does not fit — the condition that produced every
    //     previous swing simply cannot arise.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.label)).toEqual([
      'Type',
      'Quantity',
      'Width',
      'Depth',
      'Unit Size',
      'Stories',
      'Parking',
      'Roof Deck',
    ]);
    // ★ fix-411's original finding stays enforced: a bare "Deck" is ambiguous.
    expect(UNIT_CONFIG_FIELDS.map((c) => c.label)).not.toContain('Deck');
  });

  it('★★★ every field has a visible label AND a plain-language summary', () => {
    // ★ fix-422 put the summaries on a focusable header because the headers were
    //   letters. They stay now that the headers are words, because an accessible
    //   name is worth having either way — and §C requires the visible label.
    for (const c of UNIT_CONFIG_FIELDS) {
      expect(c.label.length, c.key).toBeGreaterThan(0);
      expect(c.hint.length, c.key).toBeGreaterThan(20);
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
      // ★ fix-562 §A: `pd-unit-stalls` left this list with the field.
      'pd-unit-roof-deck',
      'pd-unit-label-select',
      // ★ fix-572 §C folded fix-514 §E's separate list in as a field, so it
      //   joins the set that must never come back disabled.
      'pd-unit-size',
    ]) {
      expect(screen.getByTestId(testid)).not.toBeDisabled();
    }
    // ★ And the control itself is absent, not merely inert.
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    // ★ fix-572 §C: the flag rode on `pd-unit-row`, which the restack removed.
    //   The assertion is kept on the element that replaced it — dropping it
    //   would retire the falsifiable half of fix-486's retirement.
    expect(screen.getByTestId('pd-unit-block').dataset.noWork).toBeUndefined();
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
