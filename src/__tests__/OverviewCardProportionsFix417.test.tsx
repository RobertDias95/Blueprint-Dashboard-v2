import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_AREAS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_GRID_TEMPLATE,
  OVERVIEW_ROW_MIN_WIDTH,
  overviewRowWidthAt,
} from '../lib/overviewCardLayout';
import { UNIT_ROW_COLUMNS, UNIT_ROW_GAP } from '../lib/unitRowLayout';

// ===========================================================================
// fix-417 — the Project Overview card row gets declared proportions
// ===========================================================================
//
// Bobby, on a marked-up 2724 Walnut Ave SW: *"the proportions are way off now.
// the Design plan of record should be the widest of the boxes, but the team and
// builder owner info is way too slim."* Builder/Owner was clipping mid-word.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER, AND IT IS NOT WHAT THE BRIEF GUESSED
// ---------------------------------------------------------------------------
//
// The brief expected to find that the five widths were decided by "nothing at
// all". They were declared — `0.86fr 1.00fr 0.74fr 1.58fr 0.72fr` on
// `project-overview-grid`, from fix-285/290/295. The bug is that **a bare
// `Nfr` track is `minmax(AUTO, Nfr)`**: its floor is its own min-content, so a
// card whose contents grow takes the difference from its neighbours and the
// declaration is only a preference.
//
// fix-412 grew the Units row to 620px of columns+gaps; with the card's 20px
// padding and 2px border the PROJECT card's min-content became **~642px**
// against a ~266px share, and the other four paid for it.
//
// ★★ So this suite pins BOTH halves: the explicit `minmax` floors (§A) and the
// scroll container that makes a narrow PROJECT card legal (§B). Removing either
// re-creates the bug, which is why they are asserted together.

// ---------------------------------------------------------------------------
// §0 · THE ARITHMETIC, RE-DERIVED FROM THE SOURCE OF TRUTH
// ---------------------------------------------------------------------------

describe('fix-417 §0: the cause, computed rather than quoted', () => {
  it('★★★ the Units row really is 620px, and the PROJECT card ~642px', () => {
    // ★ Read from fix-412's own table, so this cannot go stale the way a
    //   number copied into a comment would.
    const cols = UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0);
    const gaps = (UNIT_ROW_COLUMNS.length - 1) * UNIT_ROW_GAP;
    expect(cols).toBe(584);
    expect(gaps).toBe(36);
    expect(cols + gaps).toBe(620);
    // + OverviewCard's px-2.5 body padding (20) + 1px border each side.
    expect(cols + gaps + 20 + 2).toBe(642);
    // ★★ …which is 2.4× the PROJECT card's 26% share. A track that cannot go
    //    below its content is a track that decides the row.
    expect(642).toBeGreaterThan(OVERVIEW_CARD_COLUMNS[1].minPx * 2);
  });
});

// ---------------------------------------------------------------------------
// §A · ONE DECLARED PROPORTION TABLE
// ---------------------------------------------------------------------------

describe('fix-417 §A: the proportions are declared once', () => {
  it('★★★ A3: the five percentages sum to exactly 100', () => {
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
    expect(OVERVIEW_CARD_COLUMNS).toHaveLength(5);
  });

  it('★★★ A3: every card has a floor, and every floor is a real number', () => {
    for (const c of OVERVIEW_CARD_COLUMNS) {
      expect(c.minPx).toBeGreaterThan(0);
      expect(Number.isFinite(c.minPx)).toBe(true);
      // ★ …and a stated reason, so a later edit has to argue with something.
      expect(c.floorReason.length).toBeGreaterThan(20);
    }
  });

  it('★★★ A3: Plan of Record is the largest SHARE — a later edit cannot demote it', () => {
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') expect(por.pct).toBeGreaterThan(c.pct);
    }
    expect(por.pct).toBe(29);
  });

  it('★★★ …and the largest FLOOR, so it is widest at every width, not just wide ones', () => {
    // ★ The share alone is not enough: below ~1030px of row the floors bind and
    //   the shares stop deciding anything. If PROJECT's floor were the larger,
    //   Plan of Record would be demoted in exactly the narrow window where
    //   Bobby's complaint started.
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') expect(por.minPx).toBeGreaterThan(c.minPx);
    }
  });

  it('★★★ every track carries an EXPLICIT px minimum — never a bare fr', () => {
    // ★ THE WHOLE FIX. A bare `Nfr` is `minmax(auto, Nfr)` and hands the card
    //   with the widest contents the power to resize its neighbours.
    const tracks = OVERVIEW_GRID_TEMPLATE.match(/minmax\([^)]*\)/g) ?? [];
    expect(tracks).toHaveLength(5);
    for (const t of tracks) expect(t).toMatch(/minmax\(\d+px, \d+fr\)/);
    expect(OVERVIEW_GRID_TEMPLATE).not.toMatch(/(^|\s)[\d.]+fr(\s|$)/);
  });

  it('★★ the areas line up with the columns, in order', () => {
    expect(OVERVIEW_GRID_AREAS).toBe('"dd proj team por builder"');
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.key)).toEqual([
      'dd', 'proj', 'team', 'por', 'builder',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §A · NO SIDEWAYS SCROLL AT ANY SUPPORTED WIDTH
// ---------------------------------------------------------------------------

describe('fix-417: the page body never scrolls sideways', () => {
  it('★★★ the floors fit at 1280, 1440 and 1920 — with the ribbon EXPANDED', () => {
    // ★★ EXPANDED IS THE BINDING CASE and it is the default
    //    (`loadRibbonCollapsed(userId) ?? false`). 212px of ribbon, 48px of
    //    shell padding and 32px of header padding come off the viewport first.
    for (const vw of [1280, 1440, 1920]) {
      const available = overviewRowWidthAt(vw, 'expanded');
      expect(OVERVIEW_ROW_MIN_WIDTH).toBeLessThanOrEqual(available);
    }
    // The narrowest supported row, spelled out: 1280 − 212 − 48 − 32 = 988.
    expect(overviewRowWidthAt(1280, 'expanded')).toBe(988);
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(970);
  });

  it('★★★ Bobby\'s own floors would NOT have fitted — which is why they moved', () => {
    // ★ He gave 180/340/180/320/230 = 1250px, + 4 gaps = 1290px, against 988px
    //   of row at 1280px. His PERCENTAGES are kept exactly; only the floors are
    //   scaled, and they only bind below ~1030px of row.
    const bobbysFloors = 180 + 340 + 180 + 320 + 230 + 4 * OVERVIEW_GRID_GAP;
    expect(bobbysFloors).toBe(1290);
    expect(bobbysFloors).toBeGreaterThan(overviewRowWidthAt(1280, 'expanded'));
    // The percentages ARE his.
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.pct)).toEqual([14, 26, 15, 29, 16]);
  });

  it('★★ at the width Bobby measured, every squeezed card grows back', () => {
    // His screenshot: ~1345px of row. Distribute the free space by share and
    // compare with what he actually saw.
    const row = 1345;
    const free = row - OVERVIEW_ROW_MIN_WIDTH;
    const widths = OVERVIEW_CARD_COLUMNS.map(
      (c) => c.minPx + (free * c.pct) / 100,
    );
    const [dd, proj, team, por, builder] = widths;
    // measured: 230 · 660 · 100 · 270 · 110
    expect(team).toBeGreaterThan(100 * 1.7);      // was ~100px
    expect(builder).toBeGreaterThan(110 * 1.9);   // was ~110px, and clipping
    expect(por).toBeGreaterThan(270);             // was third widest
    expect(proj).toBeLessThan(660 / 1.9);         // stops eating the row
    expect(por).toBeGreaterThan(proj);
    expect(por).toBe(Math.max(...widths));
    expect(dd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §B · THE UNITS ROW STOPS DICTATING THE PAGE WIDTH
// ---------------------------------------------------------------------------

// =========================================================================
// ★★★ §B IS SUPERSEDED BY fix-418 — AND IT WAS THE RIGHT ANSWER AT THE TIME
// =========================================================================
//
// fix-417 §B wrapped fix-412's horizontal unit row in an `overflow-x` container
// so it would stop setting the page width. Bobby, 2026-08-26: *"make that more
// of a vertical stretch versus a horizontal thing, because I don't like having
// the scroll bar in there."* He does not want the scrollbar CONTAINED, he wants
// it GONE — so the fields run down a column now and the scroller, the row and
// its grid template are all retired.
//
// ★★ WHAT §B WAS PROTECTING STILL HOLDS AND IS ASSERTED HERE: the PROJECT card
// must not be able to set the row's width. The scroller did that by containing
// overflow; vertical does it by never overflowing. The §A proportions and their
// floors — the part of fix-417 that is still load-bearing — are untouched.
describe('fix-417 §B (superseded by fix-418): nothing scrolls sideways', () => {
  it('★★★ the units scroller is GONE, not merely hidden', () => {
    renderHeader();
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
  });

  it('★★★ NOTHING inside the PROJECT card has overflow-x', () => {
    // ★ The point of the change, asserted on the rendered tree rather than on
    //   the one element fix-417 happened to add.
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      expect(el.className).not.toContain('overflow-x-auto');
      expect(el.className).not.toContain('overflow-x-scroll');
      expect(el.style.overflowX).not.toBe('auto');
      expect(el.style.overflowX).not.toBe('scroll');
    }
  });

  it('★★ the fix-412 column table survives as the field declaration', () => {
    // ★ The widths are now the RECORD of why fix-417 happened — 584 + 36 = 620
    //   is what made the card's min-content 642px. Deleting them would delete
    //   the evidence for a fix that is still load-bearing.
    expect(UNIT_ROW_COLUMNS).toHaveLength(10);
    expect(UNIT_ROW_GAP).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// RENDERED
// ---------------------------------------------------------------------------

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

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

/** ★ THE VALUES BOBBY PHOTOGRAPHED BEING CUT OFF, at full length. */
const LONG_EMAIL = 'contact@buildercompany.com';
const LONG_OWNER = 'Owner / LLC and Partners';
const PHONE = '(206) 555-0100';

function renderHeader(over: Partial<Project> = {}) {
  const project = {
    id: 'p-417',
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
    units: 4,
    zone: null,
    lot_width: null,
    lot_depth: null,
    unit_types: [{ label: 'SFR', width_ft: 20, depth_ft: 30, qty: 1 }],
    alley: null,
    product_types: ['SFR'],
    project_tags: null,
    builder_name: LONG_OWNER,
    builder_company: 'Builder Company LLC',
    builder_email: LONG_EMAIL,
    builder_phone: PHONE,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[] as PermitWithCycles[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('fix-417 (rendered): the row renders from the declared table', () => {
  it('★★★ the grid renders the module\'s template, gap and areas — not literals', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.gridTemplateColumns).toBe(OVERVIEW_GRID_TEMPLATE);
    expect(grid.style.gridTemplateAreas).toBe(OVERVIEW_GRID_AREAS);
    expect(grid.style.gap).toBe(`${OVERVIEW_GRID_GAP}px`);
  });

  it('★★★ Plan of Record is the widest rendered track', () => {
    renderHeader();
    const tracks =
      screen.getByTestId('project-overview-grid').style.gridTemplateColumns.match(
        /minmax\((\d+)px, (\d+)fr\)/g,
      ) ?? [];
    const shares = tracks.map((t) => parseFloat(/(\d+)fr/.exec(t)![1]));
    const mins = tracks.map((t) => parseFloat(/(\d+)px/.exec(t)![1]));
    expect(shares[3]).toBe(Math.max(...shares));
    expect(mins[3]).toBe(Math.max(...mins));
  });

  it('★★ fix-309 #55 survives: equal heights are untouched', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.alignItems).toBe('stretch');
    for (const child of Array.from(grid.children) as HTMLElement[]) {
      expect(child.style.height).toBe('100%');
    }
  });
});

describe('fix-417: THE REPORTED DEFECT — Builder/Owner clips mid-word', () => {
  it('★★★ a full email survives at the card\'s NARROWEST supported width', () => {
    // ★★★ THIS IS THE TEST THAT FAILS BEFORE AND PASSES AFTER. Bobby
    //     photographed `builder@email`, `contact@email`, `(206) 555-010` and
    //     `Owner / LLC a` — all cut off. These are <input> elements, and an
    //     input does NOT wrap: its value scrolls out of sight, so the ONLY fix
    //     available is width. The card's floor exists to hold this string.
    renderHeader();
    const card = screen.getByTestId('pd-builder-cell');
    const email = within(card).getByTestId('pd-builder-email') as HTMLInputElement;
    // The whole value is present, not a truncation of it.
    expect(email.value).toBe(LONG_EMAIL);
    expect(email.value).toContain('@');
    expect(email.value.endsWith('.com')).toBe(true);

    const phone = within(card).getByTestId('pd-builder-phone') as HTMLInputElement;
    expect(phone.value).toBe(PHONE);
    const owner = within(card).getByTestId('pd-builder-name') as HTMLInputElement;
    expect(owner.value).toBe(LONG_OWNER);

    // ★★★ AND THIS IS THE HALF THAT ACTUALLY FAILS BEFORE THE FIX.
    //
    // The three assertions above pass either way, and saying so matters: jsdom
    // has no layout engine, so an <input>'s `value` is the whole string however
    // narrow the box is. The CLIPPING Bobby photographed is visual, and the
    // only thing about it that is measurable here is the WIDTH THE CARD IS
    // GUARANTEED.
    //
    // Before this fix the builder track was a bare `0.72fr` — `minmax(auto,
    // 0.72fr)` — with no declared floor at all, so there was no width to
    // assert and nothing stopping the PROJECT card taking it down to ~110px.
    // Verified by reverting the template and re-running: this expectation
    // fails, the three above do not.
    const builderTrack = /minmax\((\d+)px, \d+fr\)/g;
    const tracks = [
      ...screen
        .getByTestId('project-overview-grid')
        .style.gridTemplateColumns.matchAll(builderTrack),
    ];
    expect(tracks).toHaveLength(5);
    const builderFloor = parseFloat(tracks[4][1]);
    // 12px bold averages ~6.2px/char, + the card's 20px body padding + 2px
    // border. A floor below this and the input starts clipping again.
    expect(builderFloor).toBeGreaterThanOrEqual(LONG_EMAIL.length * 6.2 + 22);
  });

  it('★★★ the floor is wide enough for that email at this card\'s type size', () => {
    // ★ jsdom has no text metrics, so the honest assertion is arithmetic on the
    //   declared floor: 12px bold averages ~6.2px/char, plus the card's 20px
    //   body padding and 2px border. If somebody lowers this floor, the input
    //   starts clipping again and this fails.
    const builder = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'builder')!;
    const needed = LONG_EMAIL.length * 6.2 + 20 + 2;
    expect(builder.minPx).toBeGreaterThanOrEqual(needed);
  });
});

describe('fix-417 §B (superseded): the PROJECT card still cannot set the row width', () => {
  it('★★★ the interior wraps instead of scrolling', () => {
    // fix-418 §A: two columns that WRAP below 285px of interior, so the card
    // never demands more width than its fix-417 floor gives it — the property
    // §B's scroller existed to guarantee, now structural.
    renderHeader();
    const interior = screen.getByTestId('pd-project-interior');
    expect(interior.className).toContain('flex-wrap');
    expect(interior.className).not.toContain('overflow');
  });

  it('★★★ the fix-417 card floors are UNTOUCHED — Plan of Record still widest', () => {
    // The brief's hard constraint for fix-418: overviewCardLayout must not move.
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.minPx)).toEqual([
      140, 220, 140, 240, 190,
    ]);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.pct)).toEqual([14, 26, 15, 29, 16]);
    const por = OVERVIEW_CARD_COLUMNS.find((c) => c.key === 'por')!;
    for (const c of OVERVIEW_CARD_COLUMNS) {
      if (c.key !== 'por') {
        expect(por.pct).toBeGreaterThan(c.pct);
        expect(por.minPx).toBeGreaterThan(c.minPx);
      }
    }
  });
});

describe('fix-417 §C: the SITE rows are sized to their content', () => {
  it('★★★ a Yes/No select no longer spans the whole card', () => {
    // Bobby: a two-character answer with its chevron parked hundreds of pixels
    // away, using more width than the whole TEAM card.
    renderHeader();
    for (const id of ['pd-site-corner', 'pd-site-alley', 'pd-site-lots']) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain('w-[90px]');
      expect(el.className).not.toContain('flex-1');
    }
  });

  it('★★ Zone gets more room — its longest option is MIO-37-LR3, not "Yes"', () => {
    renderHeader();
    const zone = screen.getByTestId('pd-site-zone');
    expect(zone.className).toContain('w-[124px]');
    expect(zone.className).not.toContain('flex-1');
  });

  it('★★★ …and this does NOT lower the PROJECT card\'s floor', () => {
    // ★ Said plainly because it would be easy to present as part of the
    //   proportions fix. These selects already carried `min-w-0`, so they could
    //   shrink to nothing and never contributed to min-content. The Units row
    //   set that floor and §B is what moved it. §C is looks.
    const unitsRowMin =
      UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0) +
      (UNIT_ROW_COLUMNS.length - 1) * UNIT_ROW_GAP;
    // 90px and 124px are both far below the row that actually sets the floor.
    expect(90).toBeLessThan(unitsRowMin);
    expect(124).toBeLessThan(unitsRowMin);
  });
});
