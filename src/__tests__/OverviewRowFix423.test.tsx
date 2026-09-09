import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import {
  MILESTONE_BOX_CHROME,
  MILESTONE_DATE_INPUT_MIN,
  MILESTONE_LABEL_GAP,
  MILESTONE_LABEL_WIDTH,
  MILESTONE_ROW_MIN_WIDTH,
  OVERVIEW_CARD_CHROME,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_CELL_ATTR,
  OVERVIEW_GRID_GAP,
  OVERVIEW_ROW_BREAK_CLASS,
  OVERVIEW_ROW_CLASS,
  OVERVIEW_ROW_CONTAINER,
  OVERVIEW_ROW_LINE_1_COUNT,
  OVERVIEW_ROW_LINE_1_MIN_WIDTH,
  OVERVIEW_ROW_LINE_2_MIN_WIDTH,
  OVERVIEW_ROW_MIN_WIDTH,
  OVERVIEW_ROW_RESPONSIVE_CSS,
  TEAM_INTERNAL_ROWS,
  overviewLineOf,
  overviewRowWidthAt,
  overviewWrapViewport,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import { UNIT_MATRIX_TRANSPOSED_WIDTH } from '../lib/projectCardLayout';
import { renderProjectData } from '../test/renderProjectData';

// ===========================================================================
// fix-423 — Milestones stops clipping, Team stops setting the height, and the
//           row stops scrolling sideways
// ===========================================================================
//
// Bobby, 2026-08-27, three observations:
//
//   *"In milestones, the dates no longer fit. I think there's enough space in
//    our current configuration to take a little bit of width out of
//    Builder/Owner and give that to Milestones so the dates can completely
//    render."*
//
//   *"The overall vertical height of this category … looks a little bit too
//    tall for the screen, and it looks like the primary height is coming from
//    Team. Could we do Acquisitions and Entitlement on the left-hand side of
//    Internal, and then horizontally on the right SD, Design Manager, Design
//    Associate?"*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0 — WHAT WAS MEASURED, AND IT CORRECTS THE BRIEF THREE TIMES
// ---------------------------------------------------------------------------
//
// Every number below was measured in Chrome, against the built stylesheet, on
// the markup these components actually render (dumped from jsdom and re-laid
// out in a real engine — jsdom has no layout, which is exactly why fix-417's
// clipping test proved nothing).
//
// ★★★ (b) WHICH CARD IS TALLEST — Bobby's diagnosis is right by 29px and no
//         more. Natural card heights, before this ticket, at a 1920 window:
//
//                          Milestones  Project  Team   PoR  Builder  TALLEST
//   (i)   no ext, 1 unit        452      474    493    266    425    Team +19
//   (ii)  no ext, 6 units       452      601    493    266    425    Project
//   (iii) 5 ext, 3 units        452      514    498    266    425    Project
//
//   The five cards share ONE row, so the row's height is a MAX and not a sum:
//   Team leads in shape (i) — which is 143 of 196 active projects — but only by
//   19px at 1920 (29px at 1280). Shaving 238px off Team therefore buys 19px of
//   PAGE and not a pixel more, because PROJECT is underneath it at 474. In
//   shapes (ii) and (iii) Team never led and Scope 2 buys nothing at all. Said
//   plainly, as the brief asked: the next height ticket is the PROJECT card.
//
// ★★★ (c) MILESTONES IS SHORT BY 82px, NOT BY 8. The brief estimated *"~168px
//         rendered against ~160px of need"*. The need is 222px: a bare
//         `<input type="date">` measures 100px at this card's 11px semibold,
//         its row 200px, the card 222px. It was rendering 140px at 1280 AND at
//         1440 and 169px at 1920 — so the dates clipped at every width, not
//         intermittently.
//
// ★★★ (d) THE `dd` floorReason WAS FALSE. "Dates and short state words; it
//         reflows" — four of the nine rows are date INPUTS and an input does
//         not reflow. Rewritten; §A asserts it no longer claims otherwise.
//
// ★★★ AND SCOPE 3's PREMISE WAS WRONG BY 211px. The brief called an empty
//     EXTERNAL block *"a heading plus a lone '+ Add discipline…' — about 40px
//     of chrome around nothing"*. fix-193 renders the COMMON FOUR as fill-in
//     slots whatever the project holds, under fix-196's empty-state banner: an
//     EMPTY External section measures **251px** against a FULL one's 256px. It
//     is the tallest section in the card, and it costs 98% of the full case to
//     say nothing — on 143 of 196 projects. Scope 3 stands; its reason changes.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
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


import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

// ★ fix-479 §A: `FIVE_EXTERNAL` (the five firms of Bobby's screenshot project
//   BSF26-05167), `WAITING_ON_OPTIONS` and `EXTERNAL_TEAM_COMMON_DISCIPLINES`
//   left with §C above — the External block they described no longer renders.
//   The equivalent five-firm fixture now lives in ExternalOutOfTeamFix479,
//   where its job is to prove the block is absent even when the blob is full.

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-423',
    address: '2724 Walnut Ave SW',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: 'Brianna',
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: 'Cameron',
    design_manager: 'Meredith',
    schematic_designer: null,
    da: 'Ainsley',
    go_date: '2026-03-02',
    closing_date: '2026-04-01',
    units: 6,
    zone: 'NR3',
    lot_width: 61,
    lot_depth: 192,
    lot_size_sf: null,
    num_lots: 1,
    is_corner_lot: false,
    alley: 'No',
    unit_types: [{ label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 2 }],
    product_types: ['SFR'],
    project_tags: null,
    builder_name: 'Owner LLC',
    builder_company: 'Builder Company LLC',
    builder_email: 'contact@builderco.com',
    builder_phone: '(206) 555-0100',
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function bpFixture(): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-423',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: '2026-05-04',
    dd_end: '2026-07-06',
    target_submit: '2026-07-13',
    target_submit_is_manual: false,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [
      { id: 1, permit_id: 100, cycle_index: 0, intake_accepted: '2026-07-20' },
    ],
  } as unknown as PermitWithCycles;
}

function renderHeader(over: Partial<Project> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const bp = bpFixture();
  return render(
    <ProjectDetailHeader project={makeProject(over)} permits={[bp]} bp={bp} />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

const col = (key: string) => {
  const c = OVERVIEW_CARD_COLUMNS.find((x) => x.key === key);
  if (!c) throw new Error(`no column "${key}"`);
  return c;
};
const widthOf = (key: string, rowPx: number) =>
  resolveOverviewWidths(rowPx)[OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === key)];

// ---------------------------------------------------------------------------
// §A · SCOPE 1 — Milestones gets width; Builder/Owner gives share, not floor
// ---------------------------------------------------------------------------

describe('fix-423 §A → fix-506 §A: the Milestones floor, and the card that had it', () => {
  // ★★★ EVERY ASSERTION IN fix-423 §A WAS ABOUT A CARD THAT NO LONGER EXISTS,
  //     AND ITS FINDING IS WHY THE CARD COULD GO.
  //
  //     fix-423 measured the Milestones floor honestly for the first time:
  //     four of its nine rows are `<input type="date">`, an input does NOT
  //     reflow, and the card had been rendering 140px against a 222px need — so
  //     the dates clipped at every width. It fixed that by raising the floor,
  //     which pushed the row minimum UP (1,218) and the wrap point with it.
  //
  // ★★★ fix-506 §A TOOK THE OTHER EXIT. The overview is read-only now (P-140),
  //     so those dates are PRINTED text in the Project card's Dates box — 60px
  //     each instead of 100 — and the card itself is retired. The row minimum
  //     falls to 904 and the wrap point to a 1474px window.
  //
  // ★★ THE CONSTANTS SURVIVE AND ARE STILL LOAD-BEARING: `MilestoneDateRow` is
  //    the Project Data modal's Dates tab (fix-506 §G), so its declared minimum
  //    still describes a real control — just one in a 760px modal rather than a
  //    222px column.

  it('★★★ the row minimum is STILL derived from its parts', () => {
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(
      MILESTONE_LABEL_WIDTH +
        MILESTONE_LABEL_GAP +
        MILESTONE_BOX_CHROME +
        MILESTONE_DATE_INPUT_MIN,
    );
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(200);
  });

  it('★★★ SUPERSEDED: there is no `dd` column, and no `consultants` column', () => {
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual(['por', 'proj', 'team']);
    // ★ And the row got CHEAPER, which is the opposite direction from fix-423 —
    //   because this ticket removed cards rather than re-measuring them.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBeLessThan(1172);
  });

  it('★★★ Plan of Record is still the widest card, floor and share', () => {
    // ★ fix-423's own guard, kept: the ruling has to hold where the FLOORS
    //   bind, not just where the shares do.
    const at1920 = resolveOverviewWidths(overviewRowWidthAt(1920));
    expect(widthOf('por', overviewRowWidthAt(1920))).toBe(Math.max(...at1920));
    expect(widthOf('por', OVERVIEW_ROW_MIN_WIDTH)).toBe(col('por').minPx);
    expect(col('por').minPx).toBeGreaterThan(col('proj').minPx);
  });

  it('★★ resolveOverviewWidths runs the REAL fr algorithm, not floor-plus-share', () => {
    // ★★★ THE OLD MODEL WAS 47px OUT ON THE PROJECT CARD. It returned
    //     `floor + free × pct`, which said 343px at 1920; the browser renders
    //     296, because a track whose fr share falls under its floor FREEZES at
    //     the floor and the space it gives up is re-shared among the rest.
    // ★★★ THE ALGORITHM IS WHAT THIS TEST IS ABOUT, AND IT IS UNCHANGED. The
    //     five-card numbers fix-423 measured in Chrome (222/296/217/370/204)
    //     described a row that no longer exists; the three-card row resolves to
    //     466 / 412 / 452 at 1920, within 5px of the v14 mock's own
    //     `470px 1.05fr 1.15fr` — which is the check that actually matters,
    //     because it is the drawing this row is supposed to reproduce.
    // ★★★ fix-507 §A/§B MOVE THE THREE NUMBERS AGAIN, and the mock comparison
    //     retires with them rather than being quietly re-baselined. The v14
    //     drawing's 470 was a PoR column on a 188px rail with no Site/Dates
    //     requirement of its own; Bobby's 2026-09-09 rulings add one (the pair
    //     side by side, on every machine) and it is Project that has to be wide
    //     enough for it. The row now resolves **485 / 478 / 403** at 1920 —
    //     confirmed in Chrome, not computed — and PoR is still the widest,
    //     which is the part of the mock that was ever a rule.
    const w = resolveOverviewWidths(overviewRowWidthAt(1920));
    [485, 478, 403].forEach((expected, i) => {
      expect(Math.abs(w[i] - expected), OVERVIEW_CARD_COLUMNS[i].key).toBeLessThanOrEqual(1);
    });
    // ★★ AND FREEZING IS STILL ITERATIVE, which is the property the old
    //    assertion was really pinning. At 1600 `por` freezes on its floor,
    //    which lifts everyone else's share, which is what then pushes `proj`
    //    under ITS floor — two freezes from one pass.
    // ★★ fix-507 §A: at 1600 the row is 1065 (was 1015), and the shares now
    //    clear every floor — PoR 371, Project 366, Team 308 — so nothing
    //    freezes there any more. The ITERATIVE property is still what this test
    //    is about, so it is asserted where it still bites: at 1280, where the
    //    row is under its own minimum and every track sits on its floor.
    const at1600 = resolveOverviewWidths(overviewRowWidthAt(1600));
    expect(at1600.map((n) => Math.round(n))).toEqual([371, 366, 308]);
    const at1280 = resolveOverviewWidths(overviewRowWidthAt(1280));
    expect(at1280[0]).toBe(col('por').minPx);
    expect(at1280[1]).toBe(col('proj').minPx);
    // And the widths always fill the row exactly.
    const row = overviewRowWidthAt(1920);
    const sum = resolveOverviewWidths(row).reduce((a, b) => a + b, 0);
    expect(Math.round(sum + (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP)).toBe(row);
  });

  it('★ the rendered label column is the width the floor was derived from', () => {
    // ★★ THE TWIN ASSERTION, the same shape fix-422 used for `h-[16px]`: the
    //    constant and the Tailwind class that produces it, held together, so a
    //    class change cannot silently re-open the clipping.
    // ★★★ THE TWIN IS INTACT; THE ROW MOVED. `MilestoneDateRow` is the Project
    //     Data modal's Dates tab now (fix-506 §G), and the constant-vs-class
    //     pairing fix-423 built — the same shape fix-422 used for `h-[16px]` —
    //     is exactly as load-bearing there. A class change still cannot
    //     silently re-open the clipping.
    renderProjectData(makeProject(), [bpFixture()], 'dates');
    const row = screen
      .getByTestId('pd-bp-dd_start')
      .closest('[data-milestone-row]') as HTMLElement;
    expect(row.firstElementChild?.className).toContain('w-20');
    expect(MILESTONE_LABEL_WIDTH).toBe(80); // Tailwind w-20
    expect(MILESTONE_LABEL_GAP).toBe(6); // the row's gap-1.5
  });
});

// ---------------------------------------------------------------------------
// §B · SCOPE 2 — the Team card's Internal block goes two columns
// ---------------------------------------------------------------------------

describe("fix-423 §B: ACQ / ENT on the left, SD / DM / DA on the right", () => {
  it("★★★ the order and the columns are ONE declared list", () => {
    // ★ fix-487 appends CA. `column` is vestigial since fix-475 replaced the
    //   two-up with one block per role, but it is still declared consistently
    //   so the field keeps meaning something if the two-up ever returns — which
    //   is why the split below is still asserted rather than deleted.
    expect(TEAM_INTERNAL_ROWS.map((r) => r.label)).toEqual([
      'ACQ', 'ENT', 'SD', 'DM', 'DA', 'CA',
    ]);
    expect(TEAM_INTERNAL_ROWS.filter((r) => r.column === 'left').map((r) => r.label)).toEqual([
      'ACQ', 'ENT',
    ]);
    expect(TEAM_INTERNAL_ROWS.filter((r) => r.column === 'right').map((r) => r.label)).toEqual([
      'SD', 'DM', 'DA', 'CA',
    ]);
  });

  // =========================================================================
  // ★★★ SUPERSEDED BY fix-475 §2 (P-116) — ONE ROLE PER BLOCK, NOT TWO COLUMNS
  // =========================================================================
  //
  // Three tests lived here: the two columns are siblings; an unset SD renders
  // an em dash in its own row; the columns collapse by wrapping. All three
  // described a SHAPE Bobby has now replaced.
  //
  // ★★★ WHAT fix-423 WAS PROTECTING, AND WHETHER IT STILL HOLDS:
  //
  //   · THE HEIGHT. *"Five stacked rows were the tallest thing in this card"*,
  //     so it paired them. fix-475 stacks them again AND adds a Builder/Owner
  //     section, so this card gets taller in both directions at once. That is
  //     a real cost and it is Bobby's call — he asked for the roster shape
  //     directly, with a face per role. ★ It is not a WIDTH change, so it
  //     cannot re-open the sideways scroll fix-423 existed to close, and the
  //     test below proves the row minimum did not rise.
  //
  //   · THE EM DASH (fix-321): *"a blank reads as a rendering fault; the em
  //     dash reads as an unfilled role."* fix-475 inverts it — an unfilled
  //     role renders NOTHING — and the reason is the avatar: an empty circle
  //     beside an empty name reads as a BROKEN avatar, which is worse than
  //     either. The rule flipped because the row gained a face.
  //
  //   · THE WRAPPING (`TEAM_INTERNAL_COLUMN_MIN`) is not deleted from
  //     overviewCardLayout — it is the record of the measurement, and Team's
  //     160px floor still rests on the reasoning around it.
  it('★★★ fix-475: one block per role, in TEAM_INTERNAL_ROWS order', () => {
    renderHeader();
    const internal = screen.getByTestId('project-overview-team-internal');
    // ★ The two-column children are gone; the container is not.
    expect(
      within(internal).queryByTestId('project-overview-team-internal-left'),
    ).toBeNull();
    const wrap = within(internal).getByTestId(
      'project-overview-team-internal-columns',
    );
    expect(wrap.className).not.toContain('flex-wrap');
  });


});

// ---------------------------------------------------------------------------
// §C · SCOPE 3 — RETIRED BY fix-479 §A (P-132), 2026-09-02
// ---------------------------------------------------------------------------
// ★★★ THE SUBJECT IS GONE, NOT THE ASSERTION WEAKENED. fix-423 §C collapsed an
// EMPTY External block from 251px to one line, on the reading that "the empty
// case costs 98% of the full case to say nothing at all, on 143 of 196 active
// projects". Bobby, 2026-09-02: *"that external team, under team, is no longer
// going to be there. We are going to move that external team over to
// consultants."* There is no External block in the Team card to collapse — the
// whole 251px left, which is strictly more than §C's 200px saving and is
// measured in docs/FIX_479_OVERVIEW_HEIGHT_MEASUREMENT.md.
//
// ★ §C's FINDING outlives its tests and is worth keeping in words: the empty
//   state of a fill-in-the-slots editor can cost as much as its full state, and
//   the way to find that out is to measure the empty one.
//
// ★ The four tests removed here (`pd-ext-section`, `pd-ext-none`,
//   `pd-ext-add-discipline`, `pd-ext-row-*`) all addressed testids that no
//   longer render. Their replacement — the section is ABSENT — is asserted in
//   ExternalOutOfTeamFix479.test.tsx, which is where the External surfaces are
//   now pinned as gone.

// ---------------------------------------------------------------------------
// §D · SCOPE 4 — the row wraps below the width where it fits
// ---------------------------------------------------------------------------

describe('fix-423 §D: two lines below the wrap point, and nothing scrolls', () => {
  it('★★★ the wrap point is MEASURED, not assumed — 1742px expanded (fix-475)', () => {
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(
      OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0) +
        (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP,
    );
    // ★ fix-475: 1218 → 1172. fix-506 §A: 1172 → 904, and that one is not a
    //   re-share — two cards left the row.
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(904);
    // ★★★ 1742 → 1474 EXPANDED. This is the number the fix-506 brief cared
    //     about: 1600 is now 126px clear of the threshold instead of 142 short
    //     of it, so the overview runs on ONE line at the width Bobby works at.
    // ★★★ fix-507 §A: 1474 → 1439. The floors did not move; the CHROME did —
    //     the permits rail gave up 50px and STEP 0 charged the row 15px for the
    //     pillbox scrollbar nobody had counted.
    expect(overviewWrapViewport('expanded')).toBe(1439);
    expect(overviewWrapViewport('collapsed')).toBe(1283);
  });

  it('★★★ BOTH lines fit at 1280 — which is the whole reason team.minPx stayed 160', () => {
    // ★★ Line one is Milestones + Project + Team at 698px against the 710px
    //    this row gets at a 1280 window. The brief asked for team.minPx 185,
    //    which puts line one at 723 and re-opens the sideways scroll. Refused
    //    with the number, as fix-422 refused Scope 10(ii).
    // ★★★ THE GROUPING IS TWO-AND-ONE NOW: Plan of Record and Project — the
    //     pair that is read against each other — then Team.
    expect(OVERVIEW_ROW_LINE_1_COUNT).toBe(2);
    expect(OVERVIEW_ROW_LINE_1_MIN_WIDTH).toBe(732);
    expect(OVERVIEW_ROW_LINE_2_MIN_WIDTH).toBe(162);

    // ★★★ AND AT 1280 THE FORCED BREAK IS SWITCHED OFF, WHICH IS THE PART
    //     WORTH READING CAREFULLY. 732 does NOT fit the 710px a 1280 window
    //     gives, so a naive reading says fix-423's no-sideways-scroll guarantee
    //     is re-opened. It is not: `OVERVIEW_ROW_RESPONSIVE_CSS` shows the break
    //     only in the band `[LINE_1_MIN, ROW_MIN)`, precisely so that below its
    //     own minimum the grouping stops being promised and flex breaks
    //     wherever it must — one card per line here. fix-423 wrote that guard
    //     for a case it never hit; fix-506 is the case.
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain(
      `(min-width:${OVERVIEW_ROW_LINE_1_MIN_WIDTH}px)`,
    );
    for (const ribbon of ['expanded', 'collapsed'] as const) {
      const row = overviewRowWidthAt(1440, ribbon);
      expect(OVERVIEW_ROW_LINE_1_MIN_WIDTH, `1440 ${ribbon}`).toBeLessThanOrEqual(row);
      expect(OVERVIEW_ROW_LINE_2_MIN_WIDTH, `1440 ${ribbon}`).toBeLessThanOrEqual(row);
    }
  });

  it('★★★ NOTHING SCROLLS SIDEWAYS at 1280 or 1440, either ribbon state', () => {
    // ★ The defect fix-422 reported and did not fix: five floors of 1136 in a
    //   710px row, inside a pillbox whose `overflow-y:auto` makes `overflow-x`
    //   compute to `auto`. The widest line, not the five floors, is what has to
    //   fit now.
    // ★★★ THE HONEST GUARANTEE IS ABOUT THE WIDEST CARD, NOT THE WIDEST LINE.
    //     A LINE is only promised while the forced break is on; below
    //     `OVERVIEW_ROW_LINE_1_MIN_WIDTH` the break is off and flex puts as
    //     many cards on a line as fit. What can never fit is a single card
    //     whose FLOOR exceeds the row — that is the state that scrolls
    //     sideways, and it is what this asserts.
    const widestCard = Math.max(...OVERVIEW_CARD_COLUMNS.map((c) => c.minPx));
    for (const viewport of [1280, 1440, 1600, 1920]) {
      for (const ribbon of ['expanded', 'collapsed'] as const) {
        expect(widestCard, `${viewport} ${ribbon}`).toBeLessThanOrEqual(
          overviewRowWidthAt(viewport, ribbon),
        );
      }
    }
    // ★ …and where the grouping IS promised, both of its lines fit.
    for (const ribbon of ['expanded', 'collapsed'] as const) {
      const row = overviewRowWidthAt(1440, ribbon);
      expect(
        Math.max(OVERVIEW_ROW_LINE_1_MIN_WIDTH, OVERVIEW_ROW_LINE_2_MIN_WIDTH),
        `1440 ${ribbon}`,
      ).toBeLessThanOrEqual(row);
    }
  });

  it('★★ one line at 1920, two below the wrap point, in Bobby\'s reading order', () => {
    expect(overviewLineOf('por', overviewRowWidthAt(1920))).toBe(0);
    expect(overviewLineOf('team', overviewRowWidthAt(1920))).toBe(0);
    // ★ 1600 is ONE line now, which it was not before fix-506 §A.
    expect(overviewLineOf('team', overviewRowWidthAt(1600))).toBe(0);
    // ★★ fix-507 §A: 1440 is ONE line now too, by a single pixel (905 of row
    //    against a 904 minimum). The wrapped band is asserted at 1280, which is
    //    where it actually renders.
    expect(overviewLineOf('team', overviewRowWidthAt(1440))).toBe(0);
    for (const viewport of [1280]) {
      const row = overviewRowWidthAt(viewport);
      expect(['por', 'proj'].map((k) => overviewLineOf(k, row))).toEqual([1, 1]);
      expect(['team'].map((k) => overviewLineOf(k, row))).toEqual([2]);
    }
  });

  it('★★★ the stylesheet is generated from the SAME constants as the template', () => {
    // ★ Built in TS and not imported from a .css file: a `?raw` CSS import
    //   reads EMPTY under vitest (fix-406), and these are exactly the numbers
    //   that must not drift unasserted. So the parse is asserted to have found
    //   something, then the numbers.
    expect(OVERVIEW_ROW_RESPONSIVE_CSS.length).toBeGreaterThan(200);
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain(
      `@container ${OVERVIEW_ROW_CONTAINER} (max-width:${OVERVIEW_ROW_MIN_WIDTH - 0.02}px)`,
    );
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain(
        `[${OVERVIEW_CELL_ATTR}="${c.key}"]{flex:${c.pct} 0 ${c.minPx}px;min-width:${c.minPx}px}`,
      );
    }
    // ★★ THE STRETCH OVERRIDE IS LOAD-BEARING, not tidying. The cells carry
    //    `height:100%` for the grid, and a flex item whose cross size is not
    //    `auto` is NOT stretched — without this the cards on a wrapped line
    //    come out at three different heights and fix-309 #55 is silently lost.
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain('height:auto!important');
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain('align-self:stretch!important');
    // ★ The forced break, and the band it is switched on in.
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain(
      `(min-width:${OVERVIEW_ROW_LINE_1_MIN_WIDTH}px) and (max-width:${OVERVIEW_ROW_MIN_WIDTH - 0.02}px)`,
    );
    expect(OVERVIEW_ROW_RESPONSIVE_CSS).toContain('flex-basis:100%!important');
  });

  it('★★★ the row renders the container, the class, the cells and ONE break', () => {
    renderHeader();
    const header = screen.getByTestId('project-detail-header');
    // ★★ THE BREAKPOINT IS THE ROW'S OWN WIDTH. A media query would be wrong
    //    half the time — the ribbon collapses 156px without the window
    //    changing size — so the container is the element whose content box IS
    //    the row.
    expect(header.style.containerType).toBe('inline-size');
    expect(header.style.containerName).toBe(OVERVIEW_ROW_CONTAINER);
    expect(within(header).getByTestId('pd-overview-row-css').textContent).toBe(
      OVERVIEW_ROW_RESPONSIVE_CSS,
    );
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.className).toContain(OVERVIEW_ROW_CLASS);
    // Every cell says which card it is, so the narrow band can size it without
    // depending on child order — which the break element changes.
    expect(
      Array.from(grid.querySelectorAll(`:scope > [${OVERVIEW_CELL_ATTR}]`)).map((e) =>
        e.getAttribute(OVERVIEW_CELL_ATTR),
      ),
    ).toEqual(OVERVIEW_CARD_COLUMNS.map((c) => c.key));
    const breaks = grid.querySelectorAll(`:scope > .${OVERVIEW_ROW_BREAK_CLASS}`);
    expect(breaks.length).toBe(1);
    // ★ It sits after Team — the grouping Bobby's row reads in. Left to itself
    //   flex puts FOUR cards on line one at 1217px of row and leaves
    //   Builder/Owner alone on a 1217px line.
    const kids = Array.from(grid.children);
    expect(kids.indexOf(breaks[0])).toBe(OVERVIEW_ROW_LINE_1_COUNT);
    // A layout instruction, not content.
    expect(breaks[0].getAttribute('aria-hidden')).toBe('true');
    expect(breaks[0].textContent).toBe('');
  });

  it('★ fix-309 #55 is untouched: the row is still a stretched grid when wide', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.alignItems).toBe('stretch');
    expect(grid.style.gridTemplateColumns).toContain('minmax(');
    // ★ The wide layout stays an INLINE style deliberately: fix-309, fix-331
    //   and fix-417 all read it off this element, and moving it into the
    //   stylesheet would take three regression guards with it.
    expect(grid.style.gridTemplateAreas).toBe('"por proj team"');
  });
});

// ---------------------------------------------------------------------------
// §E · what this ticket must NOT have changed
// ---------------------------------------------------------------------------

describe('fix-423 §E: the guards', () => {
  it("★★ the Project floor is still DERIVED from UNIT_MATRIX_WIDTH", () => {
    // fix-422's rule, and it wins any argument with a wrap rule: a card
    // narrower than its contents truncates SILENTLY, because OverviewCard is
    // `overflow-hidden`.
    // ★ fix-506 §D transposed the matrix — types across, attributes down — so
    //   the derivation is unchanged and the grid it derives from is different.
    expect(col('proj').minPx).toBe(
      UNIT_MATRIX_TRANSPOSED_WIDTH + OVERVIEW_CARD_CHROME,
    );
    expect(col('por').minPx).toBe(col('proj').minPx + 14);
  });

  it('★ the Project card still declares its matrix in ONE template', () => {
    // ★ fix-412's ruling, which every units ticket since has kept: the header
    //   strip and the value rows come from one declaration, so a header can
    //   never sit over the wrong control. fix-506 §D transposed it, and the
    //   rule survived the rotation — the type columns and the attribute column
    //   are one `gridTemplateColumns`.
    // ★★★ fix-507 §E TURNED THE GRID INTO A `table` (P-175), so "one
    //     declaration" is now one header row over one column set —
    //     `table-layout: fixed` with a 19% corner, which is what makes the
    //     matrix FILL its box at any unit count instead of drawing a 152px
    //     strip inside a 400px card. fix-412's rule survives the change of
    //     element: a header can never sit over the wrong control, because the
    //     header row and every value row are generated from the same list, in
    //     the same table, with the same column count.
    renderHeader();
    const grid = screen.getByTestId('pd-units-matrix-grid');
    expect(grid.tagName).toBe('TABLE');
    expect(grid.style.tableLayout).toBe('fixed');
    expect(grid.style.width).toBe('100%');
    const headers = Array.from(grid.querySelectorAll('thead th'));
    const firstRow = Array.from(grid.querySelectorAll('tbody tr'))[0];
    expect(headers.length).toBe(firstRow.children.length);
  });

  it('★ roles are still read the way they were — this is layout only', () => {
    // P-075 is about to change what ent_lead / dm / da MEAN. Nothing here
    // pre-empts it: the same five values, from the same resolver, in new boxes.
    renderHeader();
    const internal = screen.getByTestId('project-overview-team-internal');
    expect(internal.textContent).toContain('Brianna'); // acq_lead
    expect(internal.textContent).toContain('Cameron'); // entitlement_lead
    expect(internal.textContent).toContain('Meredith'); // design_manager
    expect(internal.textContent).toContain('Ainsley'); // da
  });
});
