import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, UnitType } from '../lib/database.types';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import { UNIT_ROW_COLUMNS, unitFieldLabel } from '../lib/unitRowLayout';
import {
  OVERVIEW_CARD_COLUMNS,
  overviewRowWidthAt,
  OVERVIEW_ROW_MIN_WIDTH,
  OVERVIEW_GRID_GAP,
} from '../lib/overviewCardLayout';
import {
  PROJECT_INTERIOR_GAP,
  PROJECT_LEFT_MIN_WIDTH,
  PROJECT_TWO_COLUMN_MIN_INTERIOR,
  PROJECT_CARD_MEASUREMENTS,
  UNIT_BLOCK_MIN_WIDTH,
  projectCardIsTwoColumn,
  projectInteriorWidthAt,
} from '../lib/projectCardInterior';
import { WORK_SCOPES, matchWorkScope } from '../lib/unitWorkScope';

// ===========================================================================
// fix-418 — the PROJECT card goes two-column, Unit Dimensions reads vertically,
//           and Work belongs to a Remodel
// ===========================================================================
//
// Bobby, 2026-08-26:
//
//   *"Take the unit dimensions, move that to the middle slash right-hand side
//    of the project and make that more of a vertical stretch versus a
//    horizontal thing, because I don't like having the scroll bar in there. So
//    I think what we kind of have inside of project is maybe proposal, site,
//    and then those are two vertically stacked columns, and then to the right
//    of both of those is unit dimensions, and that reads vertically. So then
//    you'd have the unit type at the top and then you would kind of go down
//    however many unit quantities there are."*
//
//   *"I'm not sure what work is, if that is referring to the existing tab or
//    the remodel tab, and if so, that should only populate if and when the
//    remodel label is deployed."*
//
// ---------------------------------------------------------------------------
// ★★★ THIS SUPERSEDES fix-412 AND fix-417 §B — AND NEITHER WAS A MISTAKE
// ---------------------------------------------------------------------------
//
// fix-412 laid the unit fields out as a horizontal row and made every header
// sit over its own control, because the header strip and the row had drifted
// four ways. fix-417 §B then wrapped that row in `overflow-x` so it would stop
// dictating the page width. Both answered the question as it stood.
//
// Bobby has now answered a question nobody asked: he does not want the
// scrollbar CONTAINED, he wants it GONE. Vertical removes it at source. So the
// row, its shared header strip, its grid template and the scroller all retire
// together — and what fix-412 actually RULED (a label beside its own control,
// one declared field order, "Roof Deck" spelled in full, no-work suppression)
// survives intact and is asserted in the superseded fix-412 suite.
//
// ---------------------------------------------------------------------------
// ★★★ AND SCOPE B FIXES A SCOPING DEFECT THAT WAS MINE
// ---------------------------------------------------------------------------
//
// P-050 specified `work_scope` as a property of a REMODEL. fix-412 rendered
// the control on EVERY unit type. A Duplex has no meaningful answer to "was
// work performed?", and a greyed-out control still says "there is a question
// here you have not answered" — which is precisely the wrong thing to say.
// So: ABSENT, not disabled. See §B.

// ---------------------------------------------------------------------------
// §0 · THE MEASUREMENTS, AND WHY THE BRIEF'S GUESS WAS WRONG
// ---------------------------------------------------------------------------

describe('fix-418 §0: how much room the PROJECT card actually has', () => {
  it('★★★ the card is ~225px at 1280 expanded — NOT the ~257px the brief guessed', () => {
    // ★★ fix-417's five floors total 970px against 988px of row at 1280 with
    //    the ribbon expanded (the default). 18px is all there is to hand out by
    //    share, so the PROJECT card's 26% barely applies and the card lands on
    //    its 220px floor plus a sliver.
    const floors = OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0);
    const row = overviewRowWidthAt(1280, 'expanded');
    expect(floors + 4 * OVERVIEW_GRID_GAP).toBe(OVERVIEW_ROW_MIN_WIDTH);
    const free = row - OVERVIEW_ROW_MIN_WIDTH;
    expect(free).toBe(18);
    const proj = OVERVIEW_CARD_COLUMNS[1];
    const measured = proj.minPx + (free * proj.pct) / 100;
    expect(Math.round(measured)).toBe(225);
    expect(measured).toBeLessThan(257); // the brief's guess
    // ★ …and the recorded table agrees with the arithmetic.
    const m = PROJECT_CARD_MEASUREMENTS.find(
      (x) => x.vw === 1280 && x.ribbon === 'expanded',
    )!;
    expect(m.cardPx).toBe(225);
  });

  it('★★★ so two columns need 285px of interior, and that is the honest breakpoint', () => {
    expect(PROJECT_TWO_COLUMN_MIN_INTERIOR).toBe(
      PROJECT_LEFT_MIN_WIDTH + PROJECT_INTERIOR_GAP + UNIT_BLOCK_MIN_WIDTH,
    );
    expect(PROJECT_TWO_COLUMN_MIN_INTERIOR).toBe(285);
    // 285 of interior + 22 of card chrome = a 307px card.
    expect(projectInteriorWidthAt(307)).toBe(285);
    expect(projectCardIsTwoColumn(307)).toBe(true);
    expect(projectCardIsTwoColumn(306)).toBe(false);
  });

  it('★★ which viewports get two columns, stated rather than implied', () => {
    // ★ NOT 1280, and not 1440 with the ribbon expanded. Saying so out loud is
    //   the point — the alternative was to take width from the other four
    //   cards, which Scope A4 forbids and fix-417 decided against.
    const at = (vw: number, r: 'expanded' | 'collapsed') =>
      projectCardIsTwoColumn(
        PROJECT_CARD_MEASUREMENTS.find((x) => x.vw === vw && x.ribbon === r)!
          .cardPx,
      );
    expect(at(1280, 'expanded')).toBe(false);
    expect(at(1280, 'collapsed')).toBe(false);
    expect(at(1440, 'expanded')).toBe(false);
    expect(at(1440, 'collapsed')).toBe(true);
    expect(at(1920, 'expanded')).toBe(true);
    expect(at(1920, 'collapsed')).toBe(true);
  });

  it('★★★ SCOPE A4: the other four cards are UNTOUCHED — no width was taken', () => {
    // The brief's hard constraint. fix-417's table is the contract.
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.pct)).toEqual([14, 26, 15, 29, 16]);
    expect(OVERVIEW_CARD_COLUMNS.map((c) => c.minPx)).toEqual([
      140, 220, 140, 240, 190,
    ]);
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(970);
  });

  it('★★★ SCOPE A3: the vertical block cannot make the card overflow again', () => {
    // ★★ fix-417 §0 measured the horizontal row at 620px of columns + gaps,
    //    which made the card's min-content 642px — 2.4× its share, and the bug.
    //    A vertical block's min-content is ONE field wide.
    const horizontal = UNIT_ROW_COLUMNS.reduce((a, c) => a + c.width, 0) + 36;
    expect(horizontal).toBe(620);
    expect(UNIT_BLOCK_MIN_WIDTH).toBeLessThan(horizontal / 5);
    // …and it fits inside the card's fix-417 floor with the left column beside
    // it or below it, either way.
    expect(UNIT_BLOCK_MIN_WIDTH + 22).toBeLessThan(OVERVIEW_CARD_COLUMNS[1].minPx);
    expect(PROJECT_LEFT_MIN_WIDTH + 22).toBeLessThan(
      OVERVIEW_CARD_COLUMNS[1].minPx,
    );
  });
});

// ---------------------------------------------------------------------------
// RENDERED
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

/** ★ Every unit_types write the component makes, in order. */
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

const TWO_UNITS = [
  { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1 },
  { label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 2 },
];

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-418',
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
    unit_types: TWO_UNITS,
    alley: null,
    product_types: ['Remodel', 'Duplex', 'SFR'],
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

/** ★ Re-render with a new unit_types array, exactly as a landed save would. */
function rerenderWith(
  rerender: (ui: ReactElement) => void,
  unit_types: UnitType[],
) {
  rerender(header(makeProject({ unit_types } as Partial<Project>)));
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
// §A1 · TWO COLUMNS: PROPOSAL OVER SITE, UNIT DIMENSIONS BESIDE THEM
// ---------------------------------------------------------------------------

describe('fix-418 §A1: the interior is two columns', () => {
  it('★★★ PROPOSAL and SITE share the LEFT column, in that order', () => {
    renderHeader();
    const left = screen.getByTestId('pd-project-left');
    const proposal = screen.getByTestId('pd-project-proposal');
    const site = screen.getByTestId('pd-project-site');
    expect(left).toContainElement(proposal);
    expect(left).toContainElement(site);
    // ★ Bobby: *"proposal, site … two vertically stacked columns"* — Proposal
    //   above Site, and a COLUMN flex so they stack rather than pair up.
    const kids = Array.from(left.querySelectorAll('*'));
    expect(kids.indexOf(proposal)).toBeLessThan(kids.indexOf(site));
    expect(left.className).toContain('flex-col');
  });

  it('★★★ UNIT DIMENSIONS is its OWN column, to the right of both', () => {
    renderHeader();
    const interior = screen.getByTestId('pd-project-interior');
    const left = screen.getByTestId('pd-project-left');
    const unitsCol = screen.getByTestId('pd-project-units-col');
    expect(unitsCol).not.toContainElement(left);
    expect(left).not.toContainElement(unitsCol);
    // ★ Both are DIRECT children of the interior, left first.
    const direct = Array.from(interior.children);
    expect(direct).toContain(left);
    expect(direct).toContain(unitsCol);
    expect(direct.indexOf(left)).toBeLessThan(direct.indexOf(unitsCol));
    expect(within(unitsCol).getByTestId('pd-project-units')).toBeInTheDocument();
  });

  it('★★★ …and it is NOT inside PROPOSAL any more', () => {
    // ★ Where fix-412 left it. This is the assertion that fails against the old
    //   tree even though every testid in it still exists.
    renderHeader();
    const proposal = screen.getByTestId('pd-project-proposal');
    expect(within(proposal).queryByTestId('pd-project-units')).toBeNull();
    expect(within(proposal).queryByTestId('pd-unit-row')).toBeNull();
  });

  it('★★ TAGS stays with PROPOSAL — a decision, not an oversight', () => {
    // ★ A close call. "ECA" is arguably a parcel fact and would read under
    //   SITE. Bobby made the placement optional ("unless it reads better under
    //   Site"), and moving it is churn he did not ask for — so it stays where
    //   every reader already knows to look.
    renderHeader();
    const proposal = screen.getByTestId('pd-project-proposal');
    expect(proposal.textContent).toContain('Tags');
    expect(screen.getByTestId('pd-project-site').textContent).not.toContain('Tags');
  });

  it('★★★ the two columns declare their minimums from the module, not literals', () => {
    renderHeader();
    expect(screen.getByTestId('pd-project-left').style.minWidth).toBe(
      `${PROJECT_LEFT_MIN_WIDTH}px`,
    );
    expect(screen.getByTestId('pd-project-units-col').style.minWidth).toBe(
      `${UNIT_BLOCK_MIN_WIDTH}px`,
    );
  });
});

// ---------------------------------------------------------------------------
// §A2 · UNIT DIMENSIONS READS VERTICALLY
// ---------------------------------------------------------------------------

describe('fix-418 §A2: the unit block reads top to bottom', () => {
  it('★★★ the horizontal ROW and its shared HEADER STRIP are gone', () => {
    renderHeader();
    expect(screen.queryByTestId('pd-unit-header')).toBeNull();
    for (const row of screen.getAllByTestId('pd-unit-row')) {
      expect(row.style.gridTemplateColumns).toBe('');
      expect(row.className).toContain('flex-col');
    }
  });

  it('★★★ the unit TYPE is at the top, and the fields go down from there', () => {
    // Bobby: *"you'd have the unit type at the top and then you would kind of
    // go down however many unit quantities there are."*
    renderHeader();
    const row = screen.getAllByTestId('pd-unit-row')[0];
    const all = Array.from(row.querySelectorAll('*'));
    const at = (t: string) => all.indexOf(within(row).getByTestId(t));
    const label = at('pd-unit-label-select');
    for (const t of [
      'pd-unit-work-scope',
      'pd-unit-w',
      'pd-unit-d',
      'pd-unit-qty',
      'pd-unit-stories',
      'pd-unit-parking-kind',
      'pd-unit-stalls',
      'pd-unit-roof-deck',
    ]) {
      expect(at(t)).toBeGreaterThan(label);
    }
  });

  it('★★★ every field carries its OWN label beside its OWN control', () => {
    // fix-412's ruling, now structural: the label and the control are the same
    // component and cannot drift apart at any width.
    renderHeader();
    const row = screen.getAllByTestId('pd-unit-row')[0];
    for (const [key, testid] of [
      ['width_ft', 'pd-unit-w'],
      ['depth_ft', 'pd-unit-d'],
      ['qty', 'pd-unit-qty'],
      ['stories', 'pd-unit-stories'],
      ['parking_kind', 'pd-unit-parking-kind'],
      ['parking_stalls', 'pd-unit-stalls'],
      ['roof_deck', 'pd-unit-roof-deck'],
    ] as const) {
      const field = within(row).getByTestId(testid).closest('div')!;
      expect(field.textContent).toContain(unitFieldLabel(key));
    }
  });

  it("★★ the labels come from fix-412's table — one declaration, still", () => {
    expect(unitFieldLabel('roof_deck')).toBe('Roof Deck');
    expect(unitFieldLabel('work_scope')).toBe('Work');
    expect(() => unitFieldLabel('nope')).toThrow(/no unit field/);
  });

  it('★★★ MULTIPLE unit types STACK — measured, not assumed', () => {
    // ★★ At 1920 with the ribbon expanded the units column is ~194px of a
    //    391px card; two 110px blocks plus a gap need more than that, so in
    //    practice they never pair. `flex-wrap` is used anyway so they would
    //    pair on their own if the card ever got wider — no second breakpoint
    //    to keep in step with the first.
    const unitsColAt1920 =
      391 - 22 - PROJECT_LEFT_MIN_WIDTH - PROJECT_INTERIOR_GAP;
    expect(unitsColAt1920).toBe(194);
    expect(2 * UNIT_BLOCK_MIN_WIDTH + 6).toBeGreaterThan(unitsColAt1920);

    renderHeader();
    const blocks = screen.getByTestId('pd-unit-blocks');
    expect(blocks.className).toContain('flex-wrap');
    expect(screen.getAllByTestId('pd-unit-row')).toHaveLength(2);
    for (const b of screen.getAllByTestId('pd-unit-row')) {
      expect(b.parentElement!.style.minWidth).toBe(`${UNIT_BLOCK_MIN_WIDTH}px`);
    }
  });
});

// ---------------------------------------------------------------------------
// §A3 · NO HORIZONTAL SCROLLBAR ANYWHERE INSIDE THE CARD
// ---------------------------------------------------------------------------

describe('fix-418 §A3: nothing inside the PROJECT card scrolls sideways', () => {
  it("★★★ fix-417 §B's scroller is DELETED, not restyled", () => {
    renderHeader();
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
  });

  it('★★★ NO element in the card has overflow-x, in class or style', () => {
    // ★ Asserted over the whole rendered subtree rather than on the one element
    //   fix-417 happened to add, so a future scroller anywhere in the card
    //   fails this too.
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    const offenders: string[] = [];
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/overflow-x-(auto|scroll)/.test(cls)) offenders.push(cls);
      if (el.style.overflowX === 'auto' || el.style.overflowX === 'scroll') {
        offenders.push(el.dataset.testid ?? el.tagName);
      }
      // ★ …and no reserved scrollbar gutter, which exists only to dress one up.
      expect(el.style.scrollbarGutter).not.toBe('stable');
    }
    expect(offenders).toEqual([]);
  });

  it('★★★ the interior WRAPS instead — so the card can never demand more width', () => {
    // SCOPE A4: below 285px of interior the second column takes its own line
    // and the content stacks. No media query, no number to keep in step.
    renderHeader();
    const interior = screen.getByTestId('pd-project-interior');
    expect(interior.className).toContain('flex-wrap');
    expect(interior.className).not.toContain('overflow');
    for (const el of [
      screen.getByTestId('pd-project-left'),
      screen.getByTestId('pd-project-units-col'),
    ]) {
      // ★ flex-1 + a declared minimum is what makes the wrap happen at 285.
      expect(el.className).toContain('flex-1');
      expect(parseInt(el.style.minWidth, 10)).toBeGreaterThan(0);
    }
  });

  it('★★★ the wrapper GROWS, so fix-331 §1 survives being wrapped', () => {
    // ★★★ A REGRESSION I CAUSED AND HAD TO FIX. fix-331 §1 says every section
    //     grows to take an equal share of the card's spare height, so there is
    //     no void above the pinned Connect button; fix-345 §3 depends on it to
    //     land three cards' buttons on one line. A plain `<div>` between the
    //     card and its sections SWALLOWS that — the div is content-height, the
    //     sections inside it have nothing to distribute, and the void comes
    //     back. `flex-1` on the wrapper hands the spare height down: the
    //     wrapper grows, each column stretches to it, the sections inside each
    //     column distribute as before.
    //
    // ★★ Two tests in MilestonesCard.test.tsx caught this, and their query —
    //    `:scope > section` — had to change with the shape. The RULE did not.
    renderHeader();
    expect(screen.getByTestId('pd-project-interior').className).toContain('flex-1');
    for (const col of ['pd-project-left', 'pd-project-units-col']) {
      expect(screen.getByTestId(col).className).toContain('flex-col');
    }
    // ★ …and the pinned action is still a DIRECT child of the card, outside
    //   the wrapper, or `marginTop: auto` would resolve against the wrapper.
    const card = screen.getByTestId('pd-project-card');
    const pinned = Array.from(
      card.querySelectorAll('section[data-pin-bottom="true"]'),
    );
    expect(pinned).toHaveLength(1);
    expect(pinned[0].parentElement).toBe(card);
  });

  it('★★★ …and no CARD demands more than the row can give, at 1280/1440/1920', () => {
    // The page-body assertion, done as arithmetic because jsdom has no layout
    // engine: the card min-contents must fit the row at every supported width.
    const interiorMin = Math.max(PROJECT_LEFT_MIN_WIDTH, UNIT_BLOCK_MIN_WIDTH);
    expect(interiorMin + 22).toBeLessThanOrEqual(OVERVIEW_CARD_COLUMNS[1].minPx);
    for (const vw of [1280, 1440, 1920]) {
      for (const r of ['expanded', 'collapsed'] as const) {
        expect(OVERVIEW_ROW_MIN_WIDTH).toBeLessThanOrEqual(
          overviewRowWidthAt(vw, r),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §A5 · ADD AND REMOVE STILL WORK
// ---------------------------------------------------------------------------

describe('fix-418 §A5: + Add type and per-block remove are unharmed', () => {
  it('★★★ + Add type still appends a unit', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-units-add'));
    expect(saves).toHaveLength(1);
    expect(saves[0].unit_types).toHaveLength(3);
    expect(saves[0].unit_types[0].label).toBe('Remodel');
  });

  it("★★★ each block's × still removes THAT block", () => {
    renderHeader();
    const rows = screen.getAllByTestId('pd-unit-row');
    fireEvent.click(within(rows[1]).getByTestId('pd-unit-remove'));
    expect(saves).toHaveLength(1);
    expect(saves[0].unit_types.map((u) => u.label)).toEqual(['Remodel']);
  });

  it('★★ + Add type sits on its own line, not competing for a column', () => {
    renderHeader();
    expect(screen.getByTestId('pd-units-add').className).toContain('basis-full');
  });
});

// ---------------------------------------------------------------------------
// §B · WORK BELONGS TO A REMODEL
// ---------------------------------------------------------------------------

describe('fix-418 §B1: the Work control renders only on a Remodel', () => {
  it('★★★ present on the Remodel and ABSENT on the Duplex — same rendered project', () => {
    // ★★ THE BRIEF'S OWN TEST, and the reason it insists on ONE project: a
    //    suite that renders two would pass while the condition was actually
    //    keyed off something project-wide.
    renderHeader();
    const rows = screen.getAllByTestId('pd-unit-row');
    expect(rows).toHaveLength(2);
    const [remodel, duplex] = rows;
    expect(remodel.dataset.remodel).toBe('true');
    expect(duplex.dataset.remodel).toBe('false');
    expect(within(remodel).getByTestId('pd-unit-work-scope')).toBeInTheDocument();
    expect(within(duplex).queryByTestId('pd-unit-work-scope')).toBeNull();
  });

  it('★★★ ABSENT, not disabled and not greyed', () => {
    // ★ A greyed control still says "there is an unanswered question here",
    //   which is exactly the wrong thing to say about a Duplex.
    renderHeader();
    const duplex = screen.getAllByTestId('pd-unit-row')[1];
    expect(
      duplex.querySelectorAll('[data-testid="pd-unit-work-scope"]'),
    ).toHaveLength(0);
    expect(duplex.textContent).not.toContain(unitFieldLabel('work_scope'));
  });

  it('★★★ it appears the moment a unit is RELABELLED to Remodel', () => {
    // ★ Not a load-time decision — the condition reads the live label.
    const { rerender } = renderHeader({
      unit_types: [{ label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 1 }],
    } as Partial<Project>);
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    fireEvent.change(screen.getByTestId('pd-unit-label-select'), {
      target: { value: 'Remodel' },
    });
    expect(saves).toHaveLength(1);
    expect(saves[0].unit_types[0].label).toBe('Remodel');
    rerenderWith(rerender, saves[0].unit_types);
    expect(screen.getByTestId('pd-unit-work-scope')).toBeInTheDocument();
  });
});

describe('fix-418 §B2: the stored key and the three states are unchanged', () => {
  it('★★★ parseUnitTypes STILL names work_scope — the whitelist trap', () => {
    // ★★★ fix-412's hardest-won lesson: `parseUnitTypes` is a WHITELIST. A key
    //     it stops naming is DELETED from the row on the next unrelated edit to
    //     that unit. Scope B changes what RENDERS, never what parses.
    const parsed = parseUnitTypes([
      { label: 'Remodel', work_scope: 'performed' },
      { label: 'Duplex', work_scope: 'none' },
    ]);
    expect(parsed[0].work_scope).toBe('performed');
    expect(parsed[1].work_scope).toBe('none');
    expect('work_scope' in parsed[0]).toBe(true);
  });

  it('★★★ the three states are still ""/none/performed', () => {
    renderHeader();
    const sel = screen.getByTestId('pd-unit-work-scope') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      '',
      'none',
      'performed',
    ]);
    expect(WORK_SCOPES).toEqual(['none', 'performed']);
  });

  it('★★ SCOPE B4: the Library filter is untouched', () => {
    // ★ `matchWorkScope(rawScope, filter)` is the Library's predicate. Scope B
    //   is a render condition on ONE card and must not reach it. Note the
    //   argument order and that `''` means "anything but a confirmed no-work",
    //   not "everything" — I had both backwards first time.
    expect(matchWorkScope('performed', '')).toBe(true);
    expect(matchWorkScope('none', '')).toBe(false);
    expect(matchWorkScope(null, '')).toBe(true);
    expect(matchWorkScope('none', 'none')).toBe(true);
    expect(matchWorkScope('performed', 'none')).toBe(false);
    expect(matchWorkScope('performed', 'performed')).toBe(true);
    expect(matchWorkScope(null, 'unanswered')).toBe(true);
    expect(matchWorkScope('none', 'unanswered')).toBe(false);
    // ★★ …and it reads the SCOPE ALONE. It never sees a label, so a unit that
    //    is no longer labelled Remodel still filters on its stored answer —
    //    the filter reads DATA, not what the card chose to draw.
    const duplex = { label: 'Duplex', work_scope: 'none' } as UnitType;
    expect(matchWorkScope(duplex.work_scope, 'none')).toBe(true);
    expect(matchWorkScope(duplex.work_scope, '')).toBe(false);
  });
});

describe('fix-418 §B3: a stored work_scope survives a relabel', () => {
  it('★★★ ROUND TRIP: Remodel → Duplex → Remodel keeps "performed"', () => {
    // ★★★ THE BRIEF'S REQUIREMENT, proven through the REAL save path rather
    //     than by reading the code. Erasing the value would destroy a real
    //     answer in order to fix a rendering bug; not CARRYING it would hit the
    //     `parseUnitTypes` whitelist trap on the very next edit.
    const start = [
      {
        label: 'Remodel',
        width_ft: 20,
        depth_ft: 30,
        qty: 1,
        work_scope: 'performed',
      },
    ];
    const { rerender } = renderHeader({ unit_types: start } as Partial<Project>);

    // 1 · it renders, showing the stored answer
    const sel = screen.getByTestId('pd-unit-work-scope') as HTMLSelectElement;
    expect(sel.value).toBe('performed');

    // 2 · relabel away from Remodel
    fireEvent.change(screen.getByTestId('pd-unit-label-select'), {
      target: { value: 'Duplex' },
    });
    expect(saves).toHaveLength(1);
    // ★★★ RETAINED IN DATA. The write carries work_scope through untouched.
    expect(saves[0].unit_types[0]).toMatchObject({
      label: 'Duplex',
      work_scope: 'performed',
    });

    // 3 · with the write applied, the control is gone but the value is not
    rerenderWith(rerender, saves[0].unit_types);
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    expect(parseUnitTypes(saves[0].unit_types)[0].work_scope).toBe('performed');

    // 4 · relabel BACK, and the answer is there again
    fireEvent.change(screen.getByTestId('pd-unit-label-select'), {
      target: { value: 'Remodel' },
    });
    expect(saves).toHaveLength(2);
    expect(saves[1].unit_types[0]).toMatchObject({
      label: 'Remodel',
      work_scope: 'performed',
    });
    rerenderWith(rerender, saves[1].unit_types);
    const back = screen.getByTestId('pd-unit-work-scope') as HTMLSelectElement;
    expect(back.value).toBe('performed');
  });

  it('★★★ an UNRELATED edit to a non-Remodel unit does not drop its work_scope', () => {
    // ★★ The whitelist trap's actual failure mode: the value survives the
    //    relabel and then vanishes on the next width change, because the row
    //    was rebuilt from a parse that no longer names the key.
    renderHeader({
      unit_types: [
        { label: 'Duplex', width_ft: 24, depth_ft: 40, qty: 1, work_scope: 'none' },
      ],
    } as Partial<Project>);
    const w = screen.getByTestId('pd-unit-w');
    fireEvent.change(w, { target: { value: '26' } });
    fireEvent.blur(w);
    expect(saves).toHaveLength(1);
    expect(saves[0].unit_types[0]).toMatchObject({
      width_ft: 26,
      work_scope: 'none',
    });
  });
});
