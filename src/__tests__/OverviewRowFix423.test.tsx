import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import { WAITING_ON_OPTIONS } from '../lib/database.types';
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
  TEAM_INTERNAL_COLUMN_GUTTER,
  TEAM_INTERNAL_COLUMN_MIN,
  TEAM_INTERNAL_ROWS,
  TEAM_INTERNAL_TWO_UP_MIN,
  overviewLineOf,
  overviewRowWidthAt,
  overviewWrapViewport,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import { UNIT_MATRIX_WIDTH } from '../lib/unitRowLayout';
import { EXTERNAL_TEAM_COMMON_DISCIPLINES } from '../lib/externalTeam';

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

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

/** ★ The five external firms of Bobby's screenshot project, BSF26-05167. */
const FIVE_EXTERNAL = {
  Civil: 'Facet Engineering',
  Surveyor: 'Emerald Land',
  Structural: 'SSS Structural',
  Arborist: 'Tree Solutions',
  Geotech: 'Pan GEO',
};

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

describe("fix-423 §A: the Milestones floor holds a date input and its label", () => {
  it('★★★ the floor is DERIVED from the row, and the row from its parts', () => {
    expect(MILESTONE_ROW_MIN_WIDTH).toBe(
      MILESTONE_LABEL_WIDTH +
        MILESTONE_LABEL_GAP +
        MILESTONE_BOX_CHROME +
        MILESTONE_DATE_INPUT_MIN,
    );
    // ★ 222px. Measured in Chrome, not estimated — the brief guessed ~160.
    expect(col('dd').minPx).toBe(MILESTONE_ROW_MIN_WIDTH + OVERVIEW_CARD_CHROME);
    expect(col('dd').minPx).toBe(222);
  });

  it('★★★ the floor exceeds what the card was rendering at EVERY width', () => {
    // ★ The three widths of the complaint, before this ticket: 140 / 140 / 169.
    //   All three are under the 222 the card needs, which is why it clipped at
    //   1440 as well as at 1280 — "intermittently" was the brief's word and it
    //   was wrong.
    expect(col('dd').minPx).toBeGreaterThan(169);
    // ★★ AND THE FLOOR IS WHAT DELIVERS IT AT EVERY SUPPORTED WIDTH. 16% of the
    //    row only exceeds 222px above a ~1427px row (a ~1997px window), so on a
    //    1920 screen this card sits ON its floor. The share is Bobby's stated
    //    intent and it decides above that; the floor is the mechanism below it.
    for (const viewport of [1280, 1440, 1920]) {
      expect(widthOf('dd', overviewRowWidthAt(viewport))).toBeGreaterThanOrEqual(
        MILESTONE_ROW_MIN_WIDTH + OVERVIEW_CARD_CHROME,
      );
    }
  });

  it("★★★ the floorReason no longer claims the card reflows", () => {
    // ★ fix-417 wrote "Dates and short state words, all of which reflow" and
    //   set 140 on that reading. THAT SENTENCE is why the floor was never
    //   revisited, so the test is on the sentence as well as on the number.
    const reason = col('dd').floorReason;
    // ★ The old reason CLASSIFIED the card, in its first word: "SOFT. Dates and
    //   short state words, all of which reflow". The new one quotes that
    //   sentence in order to say it is false, so the guard is on the
    //   classification and on the correction — not on the words appearing.
    expect(reason.startsWith('SOFT')).toBe(false);
    expect(reason).toMatch(/HARD/);
    expect(reason).toMatch(/does NOT reflow|is FALSE/);
    expect(reason).toMatch(/input/i);
  });

  it('★★ Builder/Owner gives SHARE and keeps its FLOOR', () => {
    expect(col('builder').pct).toBe(16);
    // ★★★ THE FLOOR IS UNTOUCHED. It is fix-417's reported defect — a full
    //     email in an <input> that does not wrap — and it still has to hold at
    //     the narrow end.
    expect(col('builder').minPx).toBe(190);
    // ★ The slack is real and it is what was taken: 247px rendered at 1920
    //   against a 190px floor. After: 204px, still 14 above the floor.
    const after = widthOf('builder', overviewRowWidthAt(1920));
    expect(after).toBeGreaterThan(col('builder').minPx);
    expect(Math.round(after)).toBe(204);
  });

  it('★ the five shares still sum to 100', () => {
    expect(OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.pct, 0)).toBe(100);
  });

  it("★★★ the Plan of Record is the widest card at the floors AND at 1920", () => {
    // Bobby's standing fix-417 ruling. fix-422 refused to break it and so does
    // this: the largest SHARE and the largest FLOOR, so it holds wherever the
    // deciding factor is.
    const widest = OVERVIEW_CARD_COLUMNS.reduce((a, c) => (c.minPx > a.minPx ? c : a));
    expect(widest.key).toBe('por');
    expect(Math.max(...OVERVIEW_CARD_COLUMNS.map((c) => c.pct))).toBe(col('por').pct);
    const at1920 = resolveOverviewWidths(overviewRowWidthAt(1920));
    const porW = widthOf('por', overviewRowWidthAt(1920));
    expect(porW).toBe(Math.max(...at1920));
    // ★ …and at the floors themselves, where the shares decide nothing.
    expect(widthOf('por', OVERVIEW_ROW_MIN_WIDTH)).toBe(col('por').minPx);
    expect(col('por').minPx).toBeGreaterThan(col('proj').minPx);
  });

  it('★★ resolveOverviewWidths runs the REAL fr algorithm, not floor-plus-share', () => {
    // ★★★ THE OLD MODEL WAS 47px OUT ON THE PROJECT CARD. It returned
    //     `floor + free × pct`, which said 343px at 1920; the browser renders
    //     296, because a track whose fr share falls under its floor FREEZES at
    //     the floor and the space it gives up is re-shared among the rest.
    //     Measured in Chrome: 222 / 296 / 217 / 370 / 204.
    // ★ Held against what CHROME laid out, to ±1px — the browser rounds its
    //   layout units down where this rounds to nearest, and a model that
    //   claimed to be exact would be lying about the last pixel.
    const w = resolveOverviewWidths(overviewRowWidthAt(1920));
    [222, 296, 217, 370, 204].forEach((measured, i) => {
      expect(Math.abs(w[i] - measured), OVERVIEW_CARD_COLUMNS[i].key).toBeLessThanOrEqual(1);
    });
    // Freezing is iterative: dd freezes, which lifts everyone's share, which is
    // what then pushes proj under ITS floor.
    expect(w[1]).toBe(col('proj').minPx);
    // And the widths always fill the row exactly.
    const row = overviewRowWidthAt(1920);
    const sum = resolveOverviewWidths(row).reduce((a, b) => a + b, 0);
    expect(Math.round(sum + (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP)).toBe(row);
  });

  it('★ the rendered label column is the width the floor was derived from', () => {
    // ★★ THE TWIN ASSERTION, the same shape fix-422 used for `h-[16px]`: the
    //    constant and the Tailwind class that produces it, held together, so a
    //    class change cannot silently re-open the clipping.
    renderHeader();
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
    expect(TEAM_INTERNAL_ROWS.map((r) => r.label)).toEqual([
      'ACQ', 'ENT', 'SD', 'DM', 'DA',
    ]);
    expect(TEAM_INTERNAL_ROWS.filter((r) => r.column === 'left').map((r) => r.label)).toEqual([
      'ACQ', 'ENT',
    ]);
    expect(TEAM_INTERNAL_ROWS.filter((r) => r.column === 'right').map((r) => r.label)).toEqual([
      'SD', 'DM', 'DA',
    ]);
  });

  it('★★★ the two columns are rendered, and they are SIBLINGS', () => {
    // ★★ PARENTAGE, NOT PRESENCE — fix-422 §E's lesson. The five rows existed
    //    before this ticket too; what is new is that two of them hang off one
    //    column element and three off another, side by side.
    renderHeader();
    const internal = screen.getByTestId('project-overview-team-internal');
    const left = within(internal).getByTestId('project-overview-team-internal-left');
    const right = within(internal).getByTestId('project-overview-team-internal-right');
    expect(left.parentElement).toBe(right.parentElement);
    expect(left.parentElement).toBe(
      within(internal).getByTestId('project-overview-team-internal-columns'),
    );
    expect(Array.from(left.textContent ?? '').length).toBeGreaterThan(0);
    expect(left.textContent).toContain('ACQ');
    expect(left.textContent).toContain('ENT');
    expect(left.textContent).not.toContain('DA');
    expect(right.textContent).toContain('SD');
    expect(right.textContent).toContain('DM');
    expect(right.textContent).toContain('DA');
    expect(right.textContent).not.toContain('ACQ');
  });

  it("★★★ an unset SD renders an em dash IN ITS OWN ROW, never an empty cell", () => {
    // Bobby's mock puts SD at the top of the right-hand column, and SD is
    // frequently unset. A blank there reads as a rendering fault; the em dash
    // reads as an unfilled role, which is what the four rows around it already
    // do. Same treatment the unit matrix uses for "not recorded".
    renderHeader({ schematic_designer: null } as unknown as Partial<Project>);
    const right = screen.getByTestId('project-overview-team-internal-right');
    const sdRow = Array.from(right.children).find((c) => c.textContent?.startsWith('SD'));
    expect(sdRow, 'SD keeps a row of its own when unset').toBeTruthy();
    expect(sdRow?.textContent).toBe('SD—');
    // ★ …and it is a row, not a hole: the column still holds all three.
    expect(right.children.length).toBe(3);
  });

  it("★★ the columns COLLAPSE BY WRAPPING — declared, because jsdom cannot lay out", () => {
    // ★★★ jsdom HAS NO LAYOUT ENGINE (fix-417). "They sit side by side" cannot
    //     be measured here and a width assertion on rendered output proves
    //     nothing. What CAN be asserted is the declaration that produces it,
    //     and it was verified in Chrome: side by side at 94px each when the
    //     Team card is 217px (a 1920 window), stacked when it is 172px (the
    //     wrapped 1280).
    renderHeader();
    const wrap = screen.getByTestId('project-overview-team-internal-columns');
    expect(wrap.className).toContain('flex-wrap');
    for (const side of ['left', 'right']) {
      const c = screen.getByTestId(`project-overview-team-internal-${side}`);
      expect(c.style.flex).toBe(`1 1 ${TEAM_INTERNAL_COLUMN_MIN}px`);
      expect(c.style.minWidth).toBe(`${TEAM_INTERNAL_COLUMN_MIN}px`);
    }
    // Two columns and their gutter — what the section body needs before the
    // second column can sit beside the first.
    expect(TEAM_INTERNAL_TWO_UP_MIN).toBe(
      TEAM_INTERNAL_COLUMN_MIN * 2 + TEAM_INTERNAL_COLUMN_GUTTER,
    );
    // ★ And the card that holds it: 206px. Team renders 217 at 1920.
    expect(TEAM_INTERNAL_TWO_UP_MIN + OVERVIEW_CARD_CHROME).toBeLessThanOrEqual(
      widthOf('team', overviewRowWidthAt(1920)),
    );
  });

  it("★★★ fix-331's height distribution survives: no new wrapper around the sections", () => {
    // ★ THE BRIEF NAMED THIS AS THE RISK, because fix-418 added a wrapper
    //   inside the PROJECT card and two MilestonesCard tests caught the
    //   regression. The new grid replaces the Internal section's EXISTING body
    //   div — same element, same depth — so every section is still a direct
    //   child of the card and still carries fix-331 §1's flexGrow.
    renderHeader();
    const card = screen.getByTestId('project-overview-team');
    for (const id of [
      'project-overview-team-internal',
      'project-overview-team-external',
      'project-overview-team-chat',
    ]) {
      const section = screen.getByTestId(id);
      expect(section.parentElement).toBe(card);
      expect(section.style.flexGrow).toBe('1');
      expect(section.style.flexShrink).toBe('0');
    }
    const pinned = screen.getByTestId('pd-chat-section');
    expect(pinned.parentElement).toBe(card);
    expect(pinned.style.flexGrow).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// §C · SCOPE 3 — an EXTERNAL block with nothing in it is one line
// ---------------------------------------------------------------------------

describe('fix-423 §C: the empty External block collapses', () => {
  it('★★★ zero disciplines ⇒ one row, no banner, no empty slots', () => {
    // ★ Measured: 251px before, 51px after. The empty case is the common case
    //   — 143 of 196 active projects.
    renderHeader({ external_team: {} } as unknown as Partial<Project>);
    const ext = screen.getByTestId('pd-ext-section');
    expect(within(ext).getByTestId('pd-ext-none')).toBeInTheDocument();
    expect(within(ext).queryByTestId('pd-ext-empty-cta')).toBeNull();
    for (const d of EXTERNAL_TEAM_COMMON_DISCIPLINES) {
      expect(
        within(ext).queryByTestId(`pd-ext-row-${d}`),
        `${d} slot is not drawn when nothing is assigned`,
      ).toBeNull();
    }
    // ★★ ONE ROW: the state and the way out of it, side by side.
    expect(ext.children.length).toBe(2);
  });

  it('★★★ the collapsed picker still offers EVERY discipline', () => {
    // ★ THE PRESENTATION COLLAPSES, THE AFFORDANCE DOES NOT. Deleting the four
    //   slots without widening the picker would put a Surveyor further away on
    //   exactly the projects that have not got one.
    renderHeader({ external_team: {} } as unknown as Partial<Project>);
    const picker = screen.getByTestId('pd-ext-add-discipline') as HTMLSelectElement;
    const offered = Array.from(picker.options).map((o) => o.value).filter(Boolean);
    expect(offered).toEqual([...WAITING_ON_OPTIONS]);
    for (const d of EXTERNAL_TEAM_COMMON_DISCIPLINES) expect(offered).toContain(d);
  });

  it('★★ picking one opens the section into the block that renders today', () => {
    // ★ The collapse is keyed off "nothing assigned AND nothing surfaced". If
    //   it were keyed off `noneAssigned` alone, surfacing one of the common
    //   four would change nothing on screen and the control would look broken.
    renderHeader({ external_team: {} } as unknown as Partial<Project>);
    fireEvent.change(screen.getByTestId('pd-ext-add-discipline'), {
      target: { value: 'Civil' },
    });
    expect(screen.queryByTestId('pd-ext-none')).toBeNull();
    for (const d of EXTERNAL_TEAM_COMMON_DISCIPLINES) {
      expect(screen.getByTestId(`pd-ext-row-${d}`)).toBeInTheDocument();
    }
  });

  it('★★★ a FILLED External list is NOT restructured', () => {
    // The brief is explicit and so is this: five stacked dropdowns help 19
    // projects two-up and Bobby has not asked for it. Nothing here changes.
    renderHeader({ external_team: FIVE_EXTERNAL } as unknown as Partial<Project>);
    const ext = screen.getByTestId('pd-ext-section');
    expect(within(ext).queryByTestId('pd-ext-none')).toBeNull();
    expect(within(ext).queryByTestId('pd-ext-empty-cta')).toBeNull();
    for (const d of Object.keys(FIVE_EXTERNAL)) {
      expect(within(ext).getByTestId(`pd-ext-row-${d}`)).toBeInTheDocument();
    }
    // Stacked, one under the next, exactly as before.
    expect(ext.className).toContain('flex-col');
  });
});

// ---------------------------------------------------------------------------
// §D · SCOPE 4 — the row wraps below the width where it fits
// ---------------------------------------------------------------------------

describe('fix-423 §D: two lines below the wrap point, and nothing scrolls', () => {
  it('★★★ the wrap point is MEASURED, not assumed — 1788px expanded', () => {
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(
      OVERVIEW_CARD_COLUMNS.reduce((a, c) => a + c.minPx, 0) +
        (OVERVIEW_CARD_COLUMNS.length - 1) * OVERVIEW_GRID_GAP,
    );
    expect(OVERVIEW_ROW_MIN_WIDTH).toBe(1218);
    // ★ The brief estimated ~1750 and invited a correction. 1788 with the
    //   ribbon expanded (the default), 1632 collapsed.
    expect(overviewWrapViewport('expanded')).toBe(1788);
    expect(overviewWrapViewport('collapsed')).toBe(1632);
  });

  it('★★★ BOTH lines fit at 1280 — which is the whole reason team.minPx stayed 160', () => {
    // ★★ Line one is Milestones + Project + Team at 698px against the 710px
    //    this row gets at a 1280 window. The brief asked for team.minPx 185,
    //    which puts line one at 723 and re-opens the sideways scroll. Refused
    //    with the number, as fix-422 refused Scope 10(ii).
    expect(OVERVIEW_ROW_LINE_1_COUNT).toBe(3);
    expect(OVERVIEW_ROW_LINE_1_MIN_WIDTH).toBe(698);
    expect(OVERVIEW_ROW_LINE_2_MIN_WIDTH).toBe(510);
    for (const ribbon of ['expanded', 'collapsed'] as const) {
      const row = overviewRowWidthAt(1280, ribbon);
      expect(OVERVIEW_ROW_LINE_1_MIN_WIDTH, `1280 ${ribbon}`).toBeLessThanOrEqual(row);
      expect(OVERVIEW_ROW_LINE_2_MIN_WIDTH, `1280 ${ribbon}`).toBeLessThanOrEqual(row);
    }
  });

  it('★★★ NOTHING SCROLLS SIDEWAYS at 1280 or 1440, either ribbon state', () => {
    // ★ The defect fix-422 reported and did not fix: five floors of 1136 in a
    //   710px row, inside a pillbox whose `overflow-y:auto` makes `overflow-x`
    //   compute to `auto`. The widest line, not the five floors, is what has to
    //   fit now.
    const widestLine = Math.max(
      OVERVIEW_ROW_LINE_1_MIN_WIDTH,
      OVERVIEW_ROW_LINE_2_MIN_WIDTH,
    );
    for (const viewport of [1280, 1440]) {
      for (const ribbon of ['expanded', 'collapsed'] as const) {
        expect(widestLine, `${viewport} ${ribbon}`).toBeLessThanOrEqual(
          overviewRowWidthAt(viewport, ribbon),
        );
      }
    }
  });

  it('★★ one line at 1920, two below the wrap point, in Bobby\'s reading order', () => {
    expect(overviewLineOf('dd', overviewRowWidthAt(1920))).toBe(0);
    expect(overviewLineOf('builder', overviewRowWidthAt(1920))).toBe(0);
    for (const viewport of [1280, 1440]) {
      const row = overviewRowWidthAt(viewport);
      expect(['dd', 'proj', 'team'].map((k) => overviewLineOf(k, row))).toEqual([1, 1, 1]);
      expect(['por', 'builder'].map((k) => overviewLineOf(k, row))).toEqual([2, 2]);
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
    expect(grid.style.gridTemplateAreas).toBe('"dd proj team por builder"');
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
    expect(col('proj').minPx).toBe(UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME);
    expect(col('por').minPx).toBe(UNIT_MATRIX_WIDTH + OVERVIEW_CARD_CHROME + 14);
  });

  it('★ the Project card and the unit matrix are untouched', () => {
    renderHeader();
    expect(screen.getByTestId('pd-unit-header').style.gridTemplateColumns).toContain('52px');
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
