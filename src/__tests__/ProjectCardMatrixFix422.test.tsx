import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, UnitType } from '../lib/database.types';
import {
  FIX_412_ROW_WIDTH,
  UNIT_MATRIX_GRID,
  UNIT_MATRIX_ROW_GAP,
  UNIT_MATRIX_ROW_HEIGHT,
  UNIT_MATRIX_WIDTH,
  UNIT_ROW_COLUMNS,
  UNIT_ROW_GAP,
  UNIT_WD_GAP,
  WORK_SCOPE_LABEL,
  fix418BandHeight,
  unitBandHeight,
  unitFieldTooltip,
} from '../lib/unitRowLayout';
import {
  OVERVIEW_CARD_CHROME,
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_ROW_MIN_WIDTH,
  SHELL_CHROME_PX,
  overviewMinViewport,
  overviewRowFitsAt,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import { PARKING_KIND_CODE, parkingKindCode, roofDeckCode } from '../lib/unitParking';

// ===========================================================================
// fix-422 — the unit matrix, and the five cards re-shared around it
// ===========================================================================
//
// Bobby, 2026-08-27:
//
//   *"When you have more than two different unit dimensions, the page gets way
//    too vertically long, and it stretches out milestones, team, design plan of
//    record, builder/owner… go back to horizontal."*
//   *"For type, the box is way too wide — we only need it as wide as duplex or
//    cottage."* · *"Parking can be like P … Roof deck could be RD, and it just
//    needs to show a Y."* · *"I don't think we need the X between width and
//    depth."* · *"If someone hovered their cursor over QTY, or STY, or P, or S,
//    there'd be a summary of what that is."* · *"Maybe the stack goes proposal,
//    site, then unit dimensions at the bottom of that category."*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER, AND IT CONTRADICTS THE BRIEF ON EVERY NUMBER
// ---------------------------------------------------------------------------
//
// The brief asked to be corrected and it needs to be, twice:
//
//   · it estimated the PROJECT card at 244 / 296 / 423px expanded at
//     1280 / 1440 / 1920. The real figures are 220 / 220 / 319 — because
//   · fix-417's `overviewRowWidthAt` was **278px optimistic**. It modelled the
//     chrome as ribbon + shell padding + header padding and never counted the
//     240px permits rail, its 12px gap, the pillbox border or ProjectDetail's
//     own `px-3`. The row gets 710px at 1280, not 988.
//
// ★★★ SO THE PREMISE OF SCOPE 9 IS FALSE. "PROJECT is over-wide at every
// viewport — 423px at 1920" was arithmetic on the wrong row width. At 319px
// with a 274px matrix inside it, PROJECT is very nearly exactly right, and
// there is no spare width in the row to hand to Team or Builder/Owner. What was
// actually wrong is the FLOORS, and one of their stated reasons was already
// false on main — see §D.

// ---------------------------------------------------------------------------
// §A · THE MATRIX, DECLARED ONCE
// ---------------------------------------------------------------------------

describe('fix-422 §A: the columns are Bobby\'s, sized to what they hold', () => {
  it('★★★ Type · W · D · Qty · Sty · P · # · RD, then remove', () => {
    expect(UNIT_ROW_COLUMNS.map((c) => c.key)).toEqual([
      'label',
      'width_ft',
      'depth_ft',
      'qty',
      'stories',
      'parking_kind',
      'parking_stalls',
      'roof_deck',
      'remove',
    ]);
    expect(UNIT_ROW_COLUMNS.map((c) => c.header)).toEqual([
      'Type', 'W', 'D', 'Qty', 'Sty', 'P', '#', 'RD', '',
    ]);
  });

  it('★★★ the whole matrix is 274px — half of what fix-417 was raised for', () => {
    // ★★ THE NUMBER THAT MAKES HORIZONTAL LEGAL AGAIN. fix-412's row was ten
    //    columns and 620px because it spelled everything out; abbreviations,
    //    letter codes, no `×` and moving `work_scope` off the grid take it to
    //    nine columns and 274.
    expect(UNIT_MATRIX_WIDTH).toBe(274);
    expect(UNIT_MATRIX_WIDTH).toBeLessThan(FIX_412_ROW_WIDTH / 2);
  });

  it('★★★ SCOPE 3: no `×`, and W–D are set TIGHTER than everything else', () => {
    // Bobby: *"I don't think we need the X between width and depth."*
    //
    // ★★ REMOVING THE SEPARATOR COSTS THE PAIR ITS GRAMMAR — `20 × 30` reads as
    //    one dimension, `20  30` reads as two adjacent numbers. So the pair
    //    groups by proximity instead: 2px between W and D, 4px everywhere else.
    expect(UNIT_WD_GAP).toBeLessThan(UNIT_ROW_GAP);
    expect(UNIT_ROW_COLUMNS.some((c) => c.header === '×')).toBe(false);
    // ★ The template carries the per-gap widths, because one `gap` property
    //   cannot express a tighter pair — one source for the whole geometry.
    expect(UNIT_MATRIX_GRID).toBe(
      '52px 4px 30px 2px 30px 4px 22px 4px 22px 4px 26px 4px 20px 4px 26px 4px 16px',
    );
  });

  it('★★ SCOPE 3: the freed width is BANKED, not spent on padding', () => {
    // Bobby asked for it to stay available for a future column. A ninth data
    // column at the widest current size still leaves the matrix under fix-412's.
    const widest = Math.max(...UNIT_ROW_COLUMNS.map((c) => c.width));
    expect(UNIT_MATRIX_WIDTH + widest + UNIT_ROW_GAP).toBeLessThan(
      FIX_412_ROW_WIDTH,
    );
  });

  it('★★ Type is sized for `Cottages`, the longest registry value Bobby named', () => {
    const type = UNIT_ROW_COLUMNS.find((c) => c.key === 'label')!;
    expect(type.width).toBe(52);
    // ★ NOT sized for the 9 off-registry rows in prod ("SFR w/ Accessory Units"
    //   at 22 characters). Those truncate — see §E.
    expect(type.width).toBeLessThan(22 * 5);
  });
});

// ---------------------------------------------------------------------------
// §B · HEIGHT — the thing the ticket is actually about
// ---------------------------------------------------------------------------

describe('fix-422 §B: the vertical cost per unit type', () => {
  it('★★★ SIX types now cost LESS than ONE type did under fix-418', () => {
    // ★★★ THE ACCEPTANCE CRITERION, AS ARITHMETIC. The brief asks that a
    //     six-type project's card row not exceed the other four cards' natural
    //     heights — which jsdom cannot measure, because it has no layout
    //     engine. This is the honest form of the same claim, computed from the
    //     declared model both layouts render(ed) from.
    expect(unitBandHeight(6)).toBe(130);
    expect(fix418BandHeight(1)).toBe(186);
    expect(unitBandHeight(6)).toBeLessThan(fix418BandHeight(1));
    // ★★ And the number Bobby saw: the one six-type project in prod.
    expect(fix418BandHeight(6)).toBe(1146);
    expect(fix418BandHeight(6) - unitBandHeight(6)).toBeGreaterThan(1000);
  });

  it('★★★ …and the cost per EXTRA type is one row, not one stack', () => {
    // ★ The five cards are `alignItems: stretch`, so this per-type figure is
    //   charged to Milestones, Team, Plan of Record and Builder/Owner too. That
    //   is why the marginal cost is the number that matters, not the total.
    const marginal = unitBandHeight(3) - unitBandHeight(2);
    expect(marginal).toBe(UNIT_MATRIX_ROW_HEIGHT + UNIT_MATRIX_ROW_GAP);
    expect(marginal).toBe(20);
    expect(fix418BandHeight(3) - fix418BandHeight(2)).toBeGreaterThan(
      marginal * 9,
    );
  });
});

// ---------------------------------------------------------------------------
// §C · THE CODES AND THE VOCABULARY
// ---------------------------------------------------------------------------

describe('fix-422 §C: letter codes that do not conflate two answers', () => {
  it('★★★ `none` is `N` and only NULL is `—` — the brief said both were `—`', () => {
    // ★★★ THE ONE PLACE I DID NOT FOLLOW SCOPE 4, and it is fix-402's rule I am
    //     protecting: *"NULL IS NOT none."* `none` is a recorded answer that a
    //     unit has no parking; NULL is the absence of one. Prod has 4 NULL
    //     `parking_kind` rows against 1 recorded `none`, so mapping both to `—`
    //     would make the commonest state indistinguishable from the rarest
    //     recorded one — on the field the whole backfill exists for.
    expect(PARKING_KIND_CODE).toEqual({
      garage: 'G',
      surface: 'S',
      both: 'B',
      none: 'N',
    });
    expect(parkingKindCode(null)).toBe('—');
    expect(parkingKindCode(undefined)).toBe('—');
    expect(parkingKindCode('none')).toBe('N');
    expect(parkingKindCode('none')).not.toBe(parkingKindCode(null));
  });

  it('★★ …and P\'s tooltip carries the full legend, including that distinction', () => {
    const t = unitFieldTooltip('parking_kind');
    expect(t).toContain('G garage');
    expect(t).toContain('S surface');
    expect(t).toContain('B both');
    expect(t).toContain('N none');
    expect(t).toContain('— not recorded');
  });

  it('★★★ roof deck is Y / N / — with nothing conflated', () => {
    // ★ A boolean maps cleanly onto three glyphs; no argument needed.
    expect(roofDeckCode(true)).toBe('Y');
    expect(roofDeckCode(false)).toBe('N');
    expect(roofDeckCode(null)).toBe('—');
  });

  it('★★ `B` means BOTH, because prod has no valet', () => {
    // The brief's own default, confirmed against the registry.
    expect(Object.keys(PARKING_KIND_CODE).sort()).toEqual([
      'both', 'garage', 'none', 'surface',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §D · THE RE-SHARE
// ---------------------------------------------------------------------------

describe('fix-422 §D: the five cards, re-shared against the real row', () => {
  it('★★★ the PROJECT floor was justified by a scroller that no longer exists', () => {
    // ★★★ STEP 0(d), CONFIRMED. fix-417 justified 220px with "its widest
    //     content — the Units row — SCROLLS inside the card now (fix-417 §B)".
    //     fix-418 deleted that scroller, so the justification has been false on
    //     main since ef9b0eb and the card has been free to clip its own
    //     contents — `OverviewCard` is `overflow-hidden`.
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    // ★ The old reason is QUOTED rather than deleted — the next reader needs
    //   to know it was there and why it stopped being true.
    expect(proj.floorReason).toContain('fix-418 DELETED that scroller');
    expect(proj.floorReason).toContain('false on main since ef9b0eb');
    expect(proj.floorReason).toContain('DERIVED from UNIT_MATRIX_WIDTH');
    // ★★★ AND THE FLOOR IS NOW A DERIVATION, so the two cannot disagree again.
    expect(proj.minPx).toBe(UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME);
    expect(proj.minPx).toBe(296);
  });

  it('★★★ every floor states whether it is HARD or SOFT, and why', () => {
    // ★ Which cards CLIP below their floor and which merely reflow is what
    //   decides who gives way when the row is short. Saying so is the point.
    const byKey = Object.fromEntries(
      OVERVIEW_CARD_COLUMNS.map((c) => [c.key, c.floorReason]),
    );
    expect(byKey.proj).toContain('HARD');
    expect(byKey.builder).toContain('HARD');
    expect(byKey.dd).toContain('SOFT');
    expect(byKey.team).toContain('SOFT');
    expect(byKey.por).toContain('SOFT');
  });

  it('★★★ Plan of Record is STILL the widest card, at every width', () => {
    // Bobby's fix-417 ruling, unrevoked. Scope 10(ii) offered this floor as the
    // place to find room; taking it puts Project ahead of it EVERYWHERE, so it
    // was measured and refused.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') {
        expect(por.pct).toBeGreaterThan(c.pct);
        expect(por.minPx).toBeGreaterThan(c.minPx);
      }
    }
    for (const vw of [1280, 1440, 1920, 2560]) {
      for (const r of ['expanded', 'collapsed'] as const) {
        const w = resolveOverviewWidths(overviewRowWidthAt(vw, r));
        expect(w[3]).toBe(Math.max(...w));
      }
    }
  });

  it('★★★ Team and Builder gain SHARE — the only lever the row still has', () => {
    // ★★ AND THEY DO NOT GAIN WIDTH AT 1920 EXPANDED, which is the honest half.
    //    The row's free space there is 214px against 1136px of floors, so the
    //    floors dominate and there is nothing to redistribute. Scope 9 expected
    //    to reclaim ~100px from an over-wide PROJECT card; that card does not
    //    exist. Recorded so the next brief starts from the real number.
    const team = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'team')!;
    const builder = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'builder')!;
    expect(team.pct).toBeGreaterThan(15);
    // ★★★ SUPERSEDED BY fix-423 for Builder/Owner ONLY, by Bobby's own
    //     instruction — *"take a little bit of width out of Builder/Owner and
    //     give that to Milestones"* — so its share is 16 again. This assertion
    //     was never really about the share: what it guards is that the re-share
    //     did not shrink the card that was clipping emails, and at 1920 it
    //     renders 204px against a 190px floor. Team's half is untouched.
    expect(builder.pct).toBe(16);
    expect(builder.minPx).toBe(190);
    expect(team.minPx).toBeGreaterThan(140);
    const free =
      overviewRowWidthAt(1920, 'expanded') - OVERVIEW_ROW_MIN_WIDTH;
    expect(free).toBeLessThan(220);
  });

  it('★★★ SCOPE 10: which remedy was used, recorded as arithmetic', () => {
    // (i)  TIGHTEN — applied and spent. 274px is abbreviations, letter codes,
    //      no separator and `work_scope` off the grid. The eight data columns
    //      alone are 228px; there is no meaningful slack left.
    const dataOnly = UNIT_ROW_COLUMNS.filter((c) => c.key !== 'remove').reduce(
      (a, c) => a + c.width,
      0,
    );
    expect(dataOnly).toBe(228);
    expect(UNIT_MATRIX_WIDTH - dataOnly).toBeLessThan(50);

    // (ii) TAKE IT FROM PLAN OF RECORD — REFUSED, and here is why in numbers.
    //      Its floor must EXCEED Project's or Bobby's "widest box" ruling fails
    //      at every width the floors bind, which below 1788px is all of them
    //      (fix-422 wrote 1706; fix-423's honest Milestones floor moved it).
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    const proj = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'proj')!;
    expect(por.minPx).toBeGreaterThan(proj.minPx);
    expect(por.minPx - proj.minPx).toBe(14); // the smallest margin that holds

    // (iii) …so the condition for the fallback IS met, and it is stated rather
    //       than quietly absorbed: below a 1706px window (ribbon expanded) the
    //       five-card row cannot hold the matrix at its floors. Building the
    //       full-width band is Bobby's call, not this ticket's.
    // ★★★ fix-423 ANSWERED THIS. The condition is still met — and by MORE
    //     than fix-422 recorded, since measuring Milestones honestly added 82px
    //     to the floors — but the fallback that shipped is not the full-width
    //     units band. It is the row WRAPPING to two lines below the threshold,
    //     which removes the sideways scroll without taking width from any card.
    //     Bobby has still not ruled on the band; nothing here pre-empts it.
    expect(overviewMinViewport('expanded')).toBe(1788);
    expect(overviewRowFitsAt(1600, 'expanded')).toBe(false);
    expect(overviewRowFitsAt(1920, 'expanded')).toBe(true);
  });

  it('★★★ the row has NEVER fitted at 1280 — this predates fix-422', () => {
    // ★★★ THE PRE-EXISTING DEFECT, held against fix-417's own floors so it
    //     cannot be read as something this ticket caused. 970px of floors
    //     against 710px of row: short by 260px on main today.
    expect(overviewRowWidthAt(1280, 'expanded')).toBe(710);
    expect(970).toBeGreaterThan(overviewRowWidthAt(1280, 'expanded'));
    // The three boxes fix-417 never counted, together, are the whole gap.
    const missed =
      SHELL_CHROME_PX.permitsRail +
      SHELL_CHROME_PX.permitsRailGap +
      SHELL_CHROME_PX.pillboxBorder +
      SHELL_CHROME_PX.pageRowPadding;
    expect(missed).toBe(278);
  });
});

// ---------------------------------------------------------------------------
// RENDERED
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const saves: { unit_types: UnitType[] }[] = [];

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
  useUpdateProject: () => ({
    mutateAsync: vi.fn(async (v: { patch: Record<string, unknown> }) => {
      if (v?.patch && 'unit_types' in v.patch) {
        saves.push({ unit_types: v.patch.unit_types as UnitType[] });
      }
      return undefined;
    }),
    isPending: false,
  }),
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
  useExternalTeamDirectory: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertDirectoryFirm: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
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

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

const PRODUCT_TYPES = ['SFR', 'Cottages', 'Duplex', 'Condo', 'ADU', 'Remodel'];

/** ★ The six-type project that exists in prod — the case Bobby reported. */
const SIX_TYPES = PRODUCT_TYPES.map((t, i) => ({
  label: t,
  width_ft: 20 + i,
  depth_ft: 30 + i,
  qty: 1,
}));

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-422',
    address: '2724 Walnut Ave SW',
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
    units: 6,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: [
      { label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 2 },
      { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1 },
    ],
    alley: null,
    product_types: PRODUCT_TYPES,
    project_tags: null,
    builder_name: 'Owner LLC',
    builder_company: 'Builder Company LLC',
    builder_email: 'contact@builder.com',
    builder_phone: '(206) 555-0100',
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function header(project: Project): ReactElement {
  return (
    <ProjectDetailHeader
      project={project}
      permits={[] as PermitWithCycles[]}
      bp={null}
    />
  );
}

function renderHeader(over: Partial<Project> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(header(makeProject(over)), { wrapper });
}

beforeEach(() => {
  saves.length = 0;
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ---------------------------------------------------------------------------
// §1 · BAND ORDER
// ---------------------------------------------------------------------------

describe('fix-422 §1: PROPOSAL, SITE, UNIT DIMENSIONS', () => {
  it('★★★ in that order, as direct children of the card', () => {
    // Bobby: *"Maybe the stack goes proposal, site, then unit dimensions at the
    // bottom of that category."*
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(card.querySelectorAll(':scope > section'));
    const at = (id: string) => sections.indexOf(screen.getByTestId(id));
    expect(at('pd-project-proposal')).toBeGreaterThanOrEqual(0);
    expect(at('pd-project-proposal')).toBeLessThan(at('pd-project-site'));
    expect(at('pd-project-site')).toBeLessThan(at('pd-project-units'));
  });

  it('★★★ UNITS IS LAST ON PURPOSE — it is the only band whose height varies', () => {
    // ★ Between Proposal and Site, every extra unit type pushes Site down the
    //   card. At the foot it grows against the card's bottom edge, where the
    //   spare height already is.
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(card.querySelectorAll(':scope > section'));
    const units = screen.getByTestId('pd-project-units');
    const notPinned = sections.filter(
      (s) => (s as HTMLElement).dataset.pinBottom !== 'true',
    );
    expect(notPinned[notPinned.length - 1]).toBe(units);
  });
});

// ---------------------------------------------------------------------------
// §2 · ONE HEADER, N ROWS
// ---------------------------------------------------------------------------

describe('fix-422 §2: one header row, one row per unit type', () => {
  it('★★★ the header appears ONCE however many types there are', () => {
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    expect(screen.getAllByTestId('pd-unit-header')).toHaveLength(1);
    expect(screen.getAllByTestId('pd-unit-row')).toHaveLength(6);
  });

  it('★★★ N types produce exactly N rows, for every N in prod', () => {
    // prod: 1 type ×15 · 2 ×56 · 3 ×22 · 4 ×9 · 6 ×1.
    for (const n of [2, 3, 4, 6]) {
      const { unmount } = renderHeader({
        unit_types: SIX_TYPES.slice(0, n),
      } as unknown as Partial<Project>);
      expect(screen.getAllByTestId('pd-unit-row')).toHaveLength(n);
      expect(screen.getAllByTestId('pd-unit-header')).toHaveLength(1);
      unmount();
    }
  });

  it('★★★ the header and every row render from the SAME template', () => {
    // ★★★ fix-412's ruling, which has now survived three reshapes: a header
    //     cannot sit over the wrong control when they are the same grid column.
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    expect(screen.getByTestId('pd-unit-header').style.gridTemplateColumns).toBe(
      UNIT_MATRIX_GRID,
    );
    for (const r of screen.getAllByTestId('pd-unit-row')) {
      expect(r.style.gridTemplateColumns).toBe(UNIT_MATRIX_GRID);
    }
  });

  it("★★★ every control is a DIRECT grid child of the row — the definition of horizontal", () => {
    // ★★★ MERE PRESENCE PROVES NOTHING. fix-418's vertical block ALSO contained
    //     all eight controls; each just sat inside its own `UnitField` wrapper,
    //     stacked. The first version of this test passed against pre-fix code
    //     and was therefore worth nothing. What "on one row" actually means is
    //     PARENTAGE: a direct child of a grid whose template is the matrix.
    renderHeader();
    const row = screen.getAllByTestId('pd-unit-row')[0];
    expect(row.style.gridTemplateColumns).toBe(UNIT_MATRIX_GRID);
    for (const t of [
      'pd-unit-label-select', 'pd-unit-w', 'pd-unit-d', 'pd-unit-qty',
      'pd-unit-stories', 'pd-unit-remove',
    ]) {
      expect(within(row).getByTestId(t).parentElement).toBe(row);
    }
    // ★ The three coded cells sit one level down, inside the glyph wrapper the
    //   overlay pattern needs — so their WRAPPER is the direct grid child.
    for (const t of ['pd-unit-parking-kind', 'pd-unit-stalls', 'pd-unit-roof-deck']) {
      const el = within(row).getByTestId(t);
      expect(el.parentElement === row || el.parentElement!.parentElement === row).toBe(true);
    }
  });

  it('★★ the declared row height and the rendered class cannot drift', () => {
    // ★ §B's arithmetic is only worth anything if the component renders it.
    renderHeader();
    expect(screen.getAllByTestId('pd-unit-w')[0].className).toContain(
      `h-[${UNIT_MATRIX_ROW_HEIGHT}px]`,
    );
  });

  it('★★★ + Add type and per-row remove still work', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-units-add'));
    expect(saves[0].unit_types).toHaveLength(3);
    saves.length = 0;
    const rows = screen.getAllByTestId('pd-unit-row');
    fireEvent.click(within(rows[0]).getByTestId('pd-unit-remove'));
    expect(saves[0].unit_types.map((u) => u.label)).toEqual(['Remodel']);
  });
});

// ---------------------------------------------------------------------------
// §3 · TOOLTIPS — hover AND focus
// ---------------------------------------------------------------------------

describe('fix-422 §3: every header explains itself, by hover and by Tab', () => {
  it('★★★ every header carries Scope 6\'s copy as a `title`', () => {
    renderHeader();
    for (const c of UNIT_ROW_COLUMNS) {
      if (!c.header) continue;
      const h = screen.getByTestId(`pd-unit-h-${c.key}`);
      expect(h.getAttribute('title')).toBe(c.tooltip);
      expect(h.textContent).toBe(c.header);
    }
  });

  it('★★★ …and it is REACHABLE BY KEYBOARD, not only by pointer', () => {
    // ★★★ THE HALF THAT GETS FORGOTTEN. A `title` never fires for somebody
    //     tabbing the form and never fires on a tablet. With eight
    //     abbreviations — `P`, `#`, `RD`, `Sty` — a mouse-only tooltip leaves
    //     the matrix unreadable to both, which is worse than the spelled-out
    //     headers fix-412 shipped.
    renderHeader();
    for (const c of UNIT_ROW_COLUMNS) {
      if (!c.header) continue;
      const h = screen.getByTestId(`pd-unit-h-${c.key}`);
      // A <button> is in the natural tab order with no tabindex needed.
      expect(h.tagName).toBe('BUTTON');
      expect(h.getAttribute('type')).toBe('button');
      expect(h.getAttribute('aria-label')).toContain(c.tooltip);
      h.focus();
      expect(document.activeElement).toBe(h);
    }
  });

  it('★★ the four Bobby named by name are all covered', () => {
    // *"If someone hovered their cursor over QTY, or STY, or P, or S…"*
    for (const key of ['qty', 'stories', 'parking_kind', 'parking_stalls']) {
      expect(unitFieldTooltip(key).length).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 · CELLS: CODES, WORDS, AND THE EM DASH
// ---------------------------------------------------------------------------

describe('fix-422 §4: the cell shows a code, the menu shows the words', () => {
  it('★★★ parking renders G in the cell and "Garage" in the menu', () => {
    renderHeader({
      unit_types: [{ label: 'Duplex', qty: 1, parking_kind: 'garage' }],
    } as unknown as Partial<Project>);
    const sel = screen.getByTestId('pd-unit-parking-kind') as HTMLSelectElement;
    // ★ The MENU is words — Bobby's requirement, and the platform's own.
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      '— not recorded', 'Garage', 'Surface', 'Both', 'None',
    ]);
    // ★ The CELL is a glyph. The select is the real control, laid over it at
    //   zero opacity, so keyboard and the a11y tree are the platform's.
    expect(sel.parentElement!.textContent).toContain('G');
    expect(sel.className).toContain('opacity-0');
    expect(sel.getAttribute('aria-label')).toBe('Parking kind');
  });

  it('★★★ each recorded kind paints its own letter', () => {
    for (const [kind, code] of Object.entries(PARKING_KIND_CODE)) {
      const { unmount } = renderHeader({
        unit_types: [{ label: 'Duplex', qty: 1, parking_kind: kind }],
      } as unknown as Partial<Project>);
      const cell = screen.getByTestId('pd-unit-parking-kind').parentElement!;
      expect(cell.textContent).toContain(code);
      unmount();
    }
  });

  it('★★★ roof deck renders Y / N / — with the words still in the menu', () => {
    for (const [value, code] of [
      [true, 'Y'],
      [false, 'N'],
      [null, '—'],
    ] as const) {
      const { unmount } = renderHeader({
        unit_types: [{ label: 'Duplex', qty: 1, roof_deck: value }],
      } as unknown as Partial<Project>);
      const sel = screen.getByTestId('pd-unit-roof-deck') as HTMLSelectElement;
      expect(sel.parentElement!.textContent).toContain(code);
      expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
        '— not recorded', 'Yes', 'No',
      ]);
      unmount();
    }
  });

  it('★★★ an UNSET field renders an em dash, never an empty box', () => {
    // ★★ fix-402's rule, at the point it bites hardest: NULL is "nobody has
    //    said", and a blank cell says nothing at all.
    renderHeader({
      unit_types: [{ label: 'Duplex', qty: 1 }],
    } as unknown as Partial<Project>);
    expect(
      screen.getByTestId('pd-unit-parking-kind').parentElement!.textContent,
    ).toContain('—');
    expect(
      screen.getByTestId('pd-unit-roof-deck').parentElement!.textContent,
    ).toContain('—');
    // The numeric cells say it with a placeholder, which is the same claim.
    for (const t of ['pd-unit-w', 'pd-unit-d', 'pd-unit-stalls']) {
      const el = screen.getByTestId(t) as HTMLInputElement;
      expect(el.value).toBe('');
      expect(el.getAttribute('placeholder')).toBe('—');
    }
  });

  it('★★ picking a value still writes through to the unit', () => {
    renderHeader({
      unit_types: [{ label: 'Duplex', qty: 1 }],
    } as unknown as Partial<Project>);
    fireEvent.change(screen.getByTestId('pd-unit-parking-kind'), {
      target: { value: 'surface' },
    });
    expect(saves[0].unit_types[0].parking_kind).toBe('surface');
  });
});

// ---------------------------------------------------------------------------
// §7 · THE WORK CHIP
// ---------------------------------------------------------------------------

describe('fix-422 §7: work_scope is a chip, not a column', () => {
  it('★★★ it is NOT a matrix column, and the reason is its third state', () => {
    // ★★★ Every other cell answers with one glyph. `work_scope` cannot: its
    //     third state is "not yet answered", and any letter in a one-glyph box
    //     reads as an answer — while `—` is already spoken for by "not
    //     recorded" in the columns beside it.
    expect(UNIT_ROW_COLUMNS.some((c) => c.key === 'work_scope')).toBe(false);
    renderHeader();
    expect(screen.queryByTestId('pd-unit-h-work_scope')).toBeNull();
  });

  it('★★★ the chip appears only on a Remodel row, and carries all three states', () => {
    renderHeader();
    const chips = screen.getAllByTestId('pd-unit-work-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain(WORK_SCOPE_LABEL);
    const sel = within(chips[0]).getByTestId(
      'pd-unit-work-scope',
    ) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      '—', 'None', 'Yes',
    ]);
    // ★ "not yet answered" is the DEFAULT, and it is selectable back to.
    expect(sel.value).toBe('');
  });

  it('★★★ it sits under the row it belongs to, not beside another one', () => {
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const chips = screen.getAllByTestId('pd-unit-work-chip');
    expect(chips).toHaveLength(1);
    const rows = screen.getAllByTestId('pd-unit-row');
    const remodel = rows.find((r) => r.dataset.remodel === 'true')!;
    expect(remodel.parentElement).toContainElement(chips[0]);
  });
});

// ---------------------------------------------------------------------------
// §8 · LONG LABELS
// ---------------------------------------------------------------------------

describe('fix-422 §8: an off-registry label truncates and stays readable', () => {
  it('★★★ a 22-character label truncates, with the full text on hover', () => {
    // ★ 9 of 235 prod rows carry off-registry free text; the longest is
    //   "SFR w/ Accessory Units". Sizing the Type column for those nine would
    //   tax the other 226 and every project that has none of them.
    const LONG = 'SFR w/ Accessory Units';
    expect(LONG).toHaveLength(22);
    renderHeader({
      unit_types: [{ label: LONG, width_ft: null, depth_ft: null, qty: 1 }],
      product_types: [],
    } as unknown as unknown as Partial<Project>);
    const cell = screen.getByTestId('pd-unit-label-readonly');
    expect(cell.className).toContain('truncate');
    expect(cell.getAttribute('title')).toContain(LONG);
    expect(cell.textContent).toBe(LONG);
  });

  it('★★ a registry label on the dropdown truncates the same way', () => {
    renderHeader({
      unit_types: [{ label: 'Cottages', qty: 1 }],
    } as unknown as Partial<Project>);
    const sel = screen.getByTestId('pd-unit-label-select');
    expect(sel.className).toContain('truncate');
    expect(sel.getAttribute('title')).toBe('Cottages');
  });
});

// ---------------------------------------------------------------------------
// §9 · NO SCROLLER, AND fix-331 UNHARMED
// ---------------------------------------------------------------------------

describe('fix-422 §9: horizontal came back, the scrollbar did not', () => {
  it('★★★ nothing in the PROJECT card scrolls sideways — with SIX unit types', () => {
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      const cls = typeof el.className === 'string' ? el.className : '';
      expect(cls).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(el.style.overflowX).not.toBe('auto');
      expect(el.style.overflowX).not.toBe('scroll');
    }
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
  });

  it('★★★ fix-331 §1 is unharmed: every unpinned section still grows equally', () => {
    // ★ fix-418 needed `flex-1` on a wrapper to keep this alive; fix-422 has no
    //   wrapper, so the sections are the card's own children again and the rule
    //   applies natively. Asserted because it was a live regression yesterday.
    renderHeader({ unit_types: SIX_TYPES } as unknown as Partial<Project>);
    const card = screen.getByTestId('pd-project-card');
    const sections = Array.from(
      card.querySelectorAll(':scope > section'),
    ) as HTMLElement[];
    const distributed = sections.filter((s) => s.dataset.pinBottom !== 'true');
    expect(distributed.length).toBeGreaterThanOrEqual(3);
    for (const s of distributed) {
      expect(s.style.flexGrow).toBe('1');
      expect(s.style.flexShrink).toBe('0');
    }
  });
});
