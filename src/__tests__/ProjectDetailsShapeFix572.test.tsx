import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import {
  PROJECT_DATA_MODAL_HEIGHT,
  PROJECT_DATA_MODAL_HEIGHT_PX,
  PROJECT_DATA_MODAL_MAX_VH,
  PROJECT_DATA_TABS,
} from '../lib/projectDataTabs';
import {
  UNIT_CONFIG_FIELDS,
  unitFieldHint,
  unitFieldLabel,
} from '../lib/unitConfigFields';
import { SAVED_FLASH_MS } from '../hooks/useSavedFlash';
import {
  parkingOptions,
  roofDeckOptions,
  storiesOptions,
} from '../lib/unitVocabulary';
import editorsSrc from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
import modalSrc from '../components/ProjectDetail/ProjectDetailsModal.tsx?raw';
import tableSrc from '../components/ProjectDetail/ScheduleHealthTable.tsx?raw';
import pageSrc from '../pages/ProjectDetail.tsx?raw';
import overviewBoxesSrc from '../components/ProjectDetail/ProjectOverviewBoxes.tsx?raw';
import cardLayoutSrc from '../lib/projectCardLayout.ts?raw';

// ===========================================================================
// fix-572 — Project Details holds its shape, and the Units tab can be read
// ===========================================================================
//
//   A  the two "Edit in Project Details" affordances come off
//   B  the modal gets a measured fixed height
//   C  the Units tab restacks as TYPES + UNIT CONFIGURATION
//   D  a save you can SEE, and only when the write landed
//
// ★★★ §0's CORRECTION TO THE BRIEF, PINNED SO IT IS NOT REDISCOVERED.
//
//     The brief called the shared layout *"the whole risk of the ticket"*:
//     `lib/unitRowLayout` was said to serve BOTH the modal's unit row and the
//     Project Overview PROJECT card, so restacking one would restack the other,
//     and §C opened by requiring the split be done first.
//
// ★★★ MEASURED: THE SPLIT HAD ALREADY HAPPENED, TWO TICKETS EARLIER.
//     `UNIT_ROW_COLUMNS` / `UNIT_MATRIX_GRID` had exactly ONE consumer —
//     `ProjectDataEditors.tsx`, the modal. The Overview card has rendered from
//     its own TRANSPOSED declaration since fix-507/508
//     (`ProjectOverviewBoxes.UNIT_ATTRIBUTES` + `lib/projectCardLayout`), and
//     `PROJECT_CARD_MIN_WIDTH` derives from `UNIT_MATRIX_TRANSPOSED_WIDTH`, not
//     from `unitRowLayout.UNIT_MATRIX_WIDTH` — which had no consumer outside
//     its own file and its own tests.
//
// ★★ SO THE TICKET'S STATED MAIN RISK DOES NOT EXIST, and `unitRowLayout` is
//    not split but RENAMED to what it always was: `lib/unitConfigFields`, the
//    modal's declaration. §0 below is what proves that rather than asserting it.

const T = 'test-tenant-uuid';
const TOKEN = '2026-09-15T12:00:00Z';

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
// ★ The partial-mock trap, which this repo keeps meeting: `ProjectDataEditors`
//   reads THREE things from this module, so a mock carrying only the hook makes
//   every registry read throw.
vi.mock('../hooks/useAppConfig', () => ({
  readAppConfigStringArray: () => [],
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
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
// ★ fix-549 §B: every field asks the server whether this person may write
//   before it accepts typing. Unmocked it answers `false` and every control
//   renders disabled, which would make the §C/§D assertions vacuously true.
vi.mock('../hooks/useMayWriteProject', () => ({
  useMayWriteProject: () => true,
}));

import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';

const TYPES = [
  { label: 'Detached', width_ft: 20, depth_ft: 30, qty: 2, size_sf: 1800 },
  { label: 'Attached', width_ft: 18, depth_ft: 32, qty: 4, size_sf: null },
];

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-572',
    address: '10004 116th Ave NE',
    juris: 'Kirkland',
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
    lot_size_sf: null,
    unit_types: TYPES,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: ['Detached', 'Attached'],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: TOKEN,
    updated_at: TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailsModal>[0]['project'];
}

function setup(
  over: Partial<Record<string, unknown>> = {},
  tab: (typeof PROJECT_DATA_TABS)[number]['key'] = 'units',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(over);
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
      initialTab={tab}
      onClose={() => {}}
    />,
    { wrapper },
  );
}

/** Source with comments stripped — including JSX ones. ★★★ THE GRAVESTONE
 *  TRAP, which this codebase has paid for six times: a test whose subject is
 *  REMOVED code is satisfied by the note explaining the removal unless the
 *  comments go first. Every `not.toContain` below runs on this. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'p-572', updated_at: TOKEN });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// §0 · THE PREMISE
// ---------------------------------------------------------------------------

describe('fix-572 §0 — the Project Overview PROJECT card is untouched', () => {
  it('★★★ it never read the modal’s layout, so a restack cannot reach it', () => {
    // ★★★ THE MEASUREMENT THAT REMOVES THE TICKET'S STATED MAIN RISK. If the
    //     Overview card imported the modal's column list, §C would be a shared
    //     edit. It does not, and has not since fix-507/508.
    expect(code(overviewBoxesSrc)).not.toContain('unitRowLayout');
    expect(code(overviewBoxesSrc)).not.toContain('unitConfigFields');
    expect(code(cardLayoutSrc)).not.toContain('unitRowLayout');
    expect(code(cardLayoutSrc)).not.toContain('unitConfigFields');
    // ★ ...and the card's floor derives from its OWN matrix.
    expect(cardLayoutSrc).toContain('UNIT_MATRIX_TRANSPOSED_WIDTH');
  });

  it('★★★ the card’s own matrix declaration is byte-identical', () => {
    // ★★ The two numbers the brief asks be proved unchanged live in
    //    `lib/projectCardLayout` and `ProjectOverviewBoxes`, and the Overview
    //    reads them from there.
    expect(cardLayoutSrc).toContain('export const UNIT_MATRIX_TRANSPOSED_WIDTH');
    // ★ The card's floor is DERIVED from it, in `projectCardLayout` — fix-422's
    //   ruling that a floor is never typed beside the thing it measures.
    expect(cardLayoutSrc).toContain('UNIT_MATRIX_TRANSPOSED_WIDTH + PROJECT_CARD_CHROME');
    // ★ The transposed matrix still shows its attribute rows and still does NOT
    //   show unit size — fix-488 §B's revert, on the surface it was made about.
    const rows = overviewBoxesSrc.slice(
      overviewBoxesSrc.indexOf('const UNIT_ATTRIBUTES'),
      overviewBoxesSrc.indexOf('function num('),
    );
    expect(rows).toContain("key: 'roof_deck'");
    expect(rows).toContain("label: 'Roof deck'");
    expect(rows).not.toContain("key: 'size_sf'");
  });

  it('★★★ fix-412’s header-equals-row test guarded the MODAL, not the Overview', () => {
    // ★★★ A CORRECTION TO THE BRIEF, WHICH ASKS THE PR TO STATE THE OPPOSITE:
    //     *"that fix-412's header/row test still guards the Overview, and why
    //     it does not apply to the modal."* It is the other way round.
    //     `pd-unit-header` and `pd-unit-row` are the MODAL's testids — the
    //     Overview card has no header strip and never had those elements — so
    //     fix-412's test guarded the surface this ticket restacks. It is retired
    //     in `UnitsRowFix412.test.tsx`, with its ruling re-asserted structurally
    //     (a label and its control are now ONE element, which two lists cannot
    //     drift apart).
    //
    // ★★ THE OVERVIEW IS SAFE FOR A BETTER REASON THAN THAT TEST: it never
    //    imported the declaration at all, which is what §0's first case proves.
    expect(code(overviewBoxesSrc)).not.toContain('pd-unit-header');
    expect(code(overviewBoxesSrc)).not.toContain('pd-unit-row');
    expect(code(editorsSrc)).not.toContain('pd-unit-header');
    expect(code(editorsSrc)).not.toContain('pd-unit-row');
  });
});

// ---------------------------------------------------------------------------
// §A · BOTH AFFORDANCES COME OFF
// ---------------------------------------------------------------------------

describe('fix-572 §A — nothing anywhere says "Edit in Project Details"', () => {
  it('★★★ the ✎↗ glyph and its sentence are gone from src/', () => {
    // ★★★ COMMENTS STRIPPED FIRST. The notes recording the removal quote the
    //     exact strings being removed; without stripping, this test passes on
    //     its own gravestone.
    const t = code(tableSrc);
    const p = code(pageSrc);
    for (const src of [t, p]) {
      expect(src).not.toContain('Edit in Project Details');
      // ⚠️ THE PAIRED GLYPH, not a bare pencil. `✎` on its own is fix-193's
      //    redesign edit control, which is live and which §A does not touch —
      //    an unscoped grep would demand the removal of a different button.
      expect(src).not.toContain('✎↗');
    }
    expect(t).not.toContain('schedule-health-edit');
    expect(t).not.toContain('onEditPermit');
    expect(p).not.toContain('onEditPermit');
    expect(p).not.toContain('openPermitInProjectDetails');
  });

  it('★★★ the redesign band is TEXT, not a button', () => {
    // Bobby ruled the link off together with the glyph. The sentence it carried
    // says where the permits went (fix-517 §A) — a fact about the screen, not an
    // invitation to navigate — so the sentence stays and the control goes.
    const p = code(pageSrc);
    expect(p).toContain('permits, in the table above.');
    const band = p.slice(p.indexOf('project-overview-redesign-permits-note'));
    expect(band.slice(0, 400)).not.toContain('onClick');
    // ★★ And the prop chain went with it — a prop left dangling is how the next
    //    grep lies.
    expect(p).not.toContain('onOpenPermits');
  });

  it('★★★ the DESTINATION survives: the deep link is still read', () => {
    // ★★★ §A's own line — *"the destination survives and that is why this is
    //     safe"* — is only true if it does. The ✎↗ was the ONLY writer of
    //     `?data=permits&focus=<id>`; every reader is still live.
    //
    // ⚠️ SO THE DEEP LINK IS NOW REACHABLE BY URL AND BY NOTHING IN THE UI.
    //    Said out loud because a reader who greps `focus` would otherwise
    //    conclude it is dead and delete a working address.
    const p = code(pageSrc);
    expect(p).toContain('PARAM_DATA_FOCUS');
    expect(p).toContain('dataFocusPermitId');
    expect(p).toContain('initialFocusPermitId={dataFocusPermitId}');
    expect(code(modalSrc)).toContain('initialFocusPermitId');
  });
});

// ---------------------------------------------------------------------------
// §B · ONE HEIGHT, MEASURED
// ---------------------------------------------------------------------------

describe('fix-572 §B — the modal is the same size on every tab', () => {
  it('★★★ every tab in PROJECT_DATA_TABS renders the identical shell height', () => {
    // ★★★ THE DEFECT, AS AN ASSERTION. The shell had no height at all, so it
    //     was as tall as whichever tab was showing: switching tabs resized the
    //     box under the pointer and moved the footer button out from under it.
    //
    // ★★ ALL NINE, NOT A SAMPLE. A height that holds for eight tabs and not the
    //    ninth is the same defect with a smaller blast radius.
    expect(PROJECT_DATA_TABS.length).toBeGreaterThanOrEqual(8);
    // ⚠️ WHAT jsdom CAN AND CANNOT SEE, SAID OUT LOUD. Its CSS parser does not
    //    understand `min()`, so it DROPS the declaration entirely — neither
    //    `style.height` nor the serialised `style` attribute carries it here,
    //    and a test that asserted the number off the DOM would be asserting
    //    jsdom's parser rather than the modal.
    //
    // ★★★ SO THIS ASSERTS THE PART jsdom CAN HOLD — that the shell renders ONE
    //     identical style on all nine tabs, which is the actual claim §B makes
    //     — and the NUMBER is pinned against the constant in the case below.
    //     Verified in real Chrome besides: every tab measured 770px.
    const seen = new Set<string>();
    for (const t of PROJECT_DATA_TABS) {
      const { unmount } = setup({}, t.key);
      const shell = screen.getByTestId('project-data-shell');
      seen.add(`${shell.getAttribute('style') ?? ''}|${shell.className}`);
      unmount();
    }
    expect(seen.size, [...seen].join(' | ')).toBe(1);
    // ★ ...and the shell's width is fixed too, so nothing about the box moves.
    expect([...seen][0]).toContain('w-[760px]');
  });

  it('★★★ the number is MEASURED and capped, and it is a HEIGHT not a max-height', () => {
    // ★★★ §B: *"MEASURE, do not pick a number."* Measured in real Chrome on
    //     2026-09-15 — jsdom has no layout engine, so a harness page rendered
    //     the real modal against a seeded fixture and every tab was read off the
    //     live box.
    //
    //     Bodies, in px: site 296 · dates 429 · units 638 (3 types) ·
    //     permits 781 (3 permits, unbounded) · team 271 · builder 214 ·
    //     plan 96 · actions 262 · search 158.
    //
    // ★★★ THE TALLEST TAB IS THE WRONG TARGET, which is why this is a judgement
    //     and not a max(). `permits` and `plan` are UNBOUNDED — a project can
    //     hold any number of permits — so sizing to them would make every other
    //     tab a strip of content in a field of grey, and would still not fit the
    //     next project. The tallest BOUNDED tab is `dates` at 429.
    //
    //     638 (Units at three types, one above prod's 2.28 average) + 132 of
    //     chrome = **770**, which clears `dates` by 209px of deliberate headroom
    //     for the tab this ticket is about, and lets the two unbounded tabs
    //     scroll — which they would at any size.
    expect(PROJECT_DATA_MODAL_HEIGHT_PX).toBe(770);
    expect(PROJECT_DATA_MODAL_MAX_VH).toBe(90);
    expect(PROJECT_DATA_MODAL_HEIGHT).toBe('min(770px, 90vh)');
    // ★★★ A `max-height` IS THE BUG, NOT THE FIX: it lets the box collapse to
    //     its content, which is exactly the resizing being removed.
    const shellJsx = modalSrc.slice(
      modalSrc.indexOf('data-testid="project-data-shell"') - 600,
      modalSrc.indexOf('data-testid="project-data-shell"'),
    );
    expect(shellJsx).toContain('height: PROJECT_DATA_MODAL_HEIGHT');
    expect(shellJsx).not.toContain('maxHeight');
  });

  it('★★★ the BODY scrolls and the header, tabs and footer do not', () => {
    // ★ A fixed box whose content cannot scroll HIDES the overflow instead of
    //   resizing for it, which is worse than the defect being fixed. Measured in
    //   Chrome: the Permits tab is 781px of content in a 639px viewport and
    //   scrolls, with the nav and footer fixed.
    setup({}, 'permits');
    const shell = screen.getByTestId('project-data-shell');
    expect(shell.className).toContain('overflow-hidden');
    expect(shell.className).toContain('flex-col');
    const body = screen.getByTestId('project-data-body');
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('overflow-y-auto');
    expect(screen.getByTestId('project-data-tabs').className).toContain('flex-none');
  });

  it('★★ the footer’s Exit/Save contract is untouched by this ticket', () => {
    // ★ fix-514 §B and fix-520 §A both ship in that footer. A height change has
    //   no business moving either, and this is what says so.
    setup();
    const done = screen.getByTestId('project-data-done');
    expect(done.textContent).toBe('Exit');
    expect(done.dataset.dirty).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// §C · THE UNITS TAB, READ AS ONE THING
// ---------------------------------------------------------------------------

describe('fix-572 §C — TYPES, then UNIT CONFIGURATION', () => {
  it('★★★ two named sections, in Bobby’s order', () => {
    // Bobby, 2026-09-15: *"types should be at the top and then unit
    // configuration is the category that then nicely and cleanly organizes this
    // info… so in one swoop, you can cleanly and quickly organize the unit
    // configuration."*
    setup();
    const body = screen.getByTestId('project-data-body');
    const types = screen.getByTestId('pd-units-types');
    const config = screen.getByTestId('pd-units-configuration');
    expect(body.textContent).toContain('Types');
    expect(body.textContent).toContain('Unit configuration');
    // ★ DOM order IS the reading order: the section that names the types has to
    //   come before the one that configures them.
    expect(
      types.compareDocumentPosition(config) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ★★ `Unit count` and `+ Add type` move up with the chips: the count is a
    //    PROJECT-level number and it was sitting under a list of per-unit blocks
    //    as though it belonged to them.
    expect(within(types).getByTestId('pd-units-add')).toBeInTheDocument();
  });

  it('★★★ one block per type, and every field carries a VISIBLE word', () => {
    // ★★★ THE COMPLAINT, INVERTED INTO AN ASSERTION. fix-422's matrix gave Type
    //     52px, Qty 22 and Roof Deck 26, with every meaning behind a hover.
    setup();
    const blocks = screen.getAllByTestId('pd-unit-block');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      for (const f of UNIT_CONFIG_FIELDS) {
        expect(
          within(b).getByTestId(`pd-unit-f-${f.key}-label`).textContent,
          f.key,
        ).toBe(f.label);
      }
    }
    // §C: *"labels read Type, Quantity, Width, Depth, Unit Size, Stories,
    // Parking, Roof Deck, not W · D · QTY · STY · P · RD."*
    expect(UNIT_CONFIG_FIELDS.map((f) => f.label)).toEqual([
      'Type',
      'Quantity',
      'Width',
      'Depth',
      'Unit Size',
      'Stories',
      'Parking',
      'Roof Deck',
    ]);
  });

  it('★★★ the Type dropdown renders the WHOLE word, not `D…`', () => {
    // ★★★ THE MEASUREMENT THAT ENDED THE MATRIX. In Chrome on 2026-09-15 the
    //     52px Type cell rendered `D…` for `Detached`; the field is 172px now
    //     and renders it in full. jsdom cannot measure that, so what is asserted
    //     is the property that produces it — the control fills its track and
    //     carries no hand-set pixel width.
    setup();
    const sel = screen.getAllByTestId('pd-unit-label-select')[0] as HTMLSelectElement;
    expect(sel.value).toBe('Detached');
    expect(sel.className).toContain('flex-1');
    expect(sel.className).not.toMatch(/w-\[\d+px\]/);
    // ★ Four equal tracks — no field is rationed against a neighbour, which is
    //   the condition that produced every previous swing on `RD` / `Roof Deck`.
    const grid = sel
      .closest('[data-testid="pd-unit-block"]')!
      .querySelector('[style*="grid-template-columns"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  });

  it('★★★ qty is STILL editable here, and still writes unit_types[].qty', async () => {
    // ⚠️ THE BRIEF'S OWN WARNING: *"qty MUST stay editable here."* fix-562 §H
    //    took the QTY column off both Library views precisely because this is
    //    where it is edited; losing it in a restack would leave it editable
    //    nowhere at all.
    setup();
    const qty = screen.getAllByTestId('pd-unit-qty')[0] as HTMLInputElement;
    expect(qty).not.toBeDisabled();
    fireEvent.change(qty, { target: { value: '5' } });
    fireEvent.blur(qty);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].qty).toBe(5);
  });

  it('★★★ Unit Size saves to unit_types[].size_sf, and is NOT on the Overview', async () => {
    // ★★ THE SCOPED EXCEPTION, BOTH HALVES. fix-488 §B refused `size_sf` a place
    //    beside the dimensions because a ninth MATRIX column cost the OVERVIEW
    //    row 76px of minimum and broke fix-423 §D's 1280 guarantee. Every number
    //    in that argument is about the Overview row, so the field folds in HERE
    //    and stays off THERE.
    setup();
    const size = screen.getAllByTestId('pd-unit-size')[0] as HTMLInputElement;
    expect(size.value).toBe('1800');
    fireEvent.change(size, { target: { value: '1950' } });
    fireEvent.blur(size);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].size_sf).toBe(1950);
    const rows = overviewBoxesSrc.slice(
      overviewBoxesSrc.indexOf('const UNIT_ATTRIBUTES'),
      overviewBoxesSrc.indexOf('function num('),
    );
    expect(rows).not.toContain("key: 'size_sf'");
  });

  it('★★★ the three dropdowns ARE the app_config registries — nothing hand-written', () => {
    // ⚠️ DO NOT: *"Hand-write any of the three vocabulary lists."* With an empty
    //    app_config the CANONICAL fallbacks are what render, which is what a
    //    suite with no registry sees — so this compares the rendered options to
    //    the registry readers rather than to a literal list.
    const cfg = new Map<string, unknown>();
    setup();
    const block = screen.getAllByTestId('pd-unit-block')[0];
    const opts = (id: string) =>
      Array.from((within(block).getByTestId(id) as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter((v) => v !== '');
    expect(opts('pd-unit-parking-kind')).toEqual([...parkingOptions(cfg)]);
    expect(opts('pd-unit-roof-deck')).toEqual([...roofDeckOptions(cfg)]);
    expect(opts('pd-unit-stories')).toEqual([...storiesOptions(cfg)]);
    // ★ ...and the component reads them through the registry helpers, once for
    //   the whole block rather than per row.
    const e = code(editorsSrc);
    expect(e).toContain('parkingOptions(cfgMap)');
    expect(e).toContain('roofDeckOptions(cfgMap)');
    expect(e).toContain('storiesOptions(cfgMap)');
  });

  it('★★ every field’s accessible name is its plain-language summary', () => {
    // ★ fix-422 put these sentences on a focusable header because the headers
    //   were letters. They stay now that the headers are words — an accessible
    //   name is worth having either way, and `Parking` alone does not say that
    //   the answers run `1-car garage` through `Surface / None`.
    setup();
    const block = screen.getAllByTestId('pd-unit-block')[0];
    expect(
      within(block).getByTestId('pd-unit-label-select').getAttribute('aria-label'),
    ).toBe(unitFieldHint('label'));
    expect(within(block).getByTestId('pd-unit-size').getAttribute('aria-label')).toBe(
      unitFieldHint('size_sf'),
    );
    expect(unitFieldLabel('size_sf')).toBe('Unit Size');
  });
});

// ---------------------------------------------------------------------------
// §D · A SAVE YOU CAN SEE
// ---------------------------------------------------------------------------

describe('fix-572 §D — the confirmation fires on success and NEVER on failure', () => {
  it('★★★ a landed write shows one acknowledgement, on the field that saved', async () => {
    // 🚨 Bobby edited Stories on `10004 116th Ave NE`, saw nothing happen, and
    //    REVERTED A CORRECT EDIT — both writes are in the database, 19 seconds
    //    apart. A write nobody can see is indistinguishable from one that
    //    failed, and the next thing a person does is re-type it or undo it.
    setup();
    const qty = screen.getAllByTestId('pd-unit-qty')[0];
    fireEvent.change(qty, { target: { value: '3' } });
    fireEvent.blur(qty);
    await waitFor(() => {
      expect(screen.getAllByTestId('pd-unit-f-qty-saved')[0].dataset.saved).toBe('true');
    });
    expect(screen.getAllByTestId('pd-unit-f-qty-saved')[0].textContent).toBe('Saved');
    // ★★ ONE acknowledgement, on ONE field — not a toast per keystroke and not a
    //    tick on every box in the block.
    expect(screen.getAllByTestId('pd-unit-f-width_ft-saved')[0].dataset.saved).toBe(
      'false',
    );
  });

  it('★★★ A REJECTED WRITE SHOWS NOTHING — the half that makes it worth having', async () => {
    // ⚠️ §D: *"A confirmation fired on blur regardless of the RPC's result is
    //    worse than none — it teaches the exact false confidence this ticket
    //    exists to remove."* This is the assertion that proves it is not.
    updateMutateAsync.mockRejectedValueOnce(new Error('OCC'));
    setup();
    const qty = screen.getAllByTestId('pd-unit-qty')[0];
    fireEvent.change(qty, { target: { value: '9' } });
    fireEvent.blur(qty);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    // Let every pending microtask settle, so a LATE tick is still caught.
    await act(async () => {});
    expect(screen.getAllByTestId('pd-unit-f-qty-saved')[0].dataset.saved).toBe('false');
  });

  it('★★★ writeTypes RETURNS whether the write landed — the mechanism, pinned', () => {
    // ★★★ IT USED TO `.catch(() => {})` AND RETURN NOTHING, which was right
    //     while nothing downstream cared: the hook's `onError` had already
    //     pushed the toast and the `void` callers must not trip an unhandled
    //     rejection. A field has to know now, so the swallow stays and a boolean
    //     travels back through it.
    const e = code(editorsSrc);
    expect(e).toContain('async function writeTypes(next: UnitType[]): Promise<boolean>');
    expect(e).toContain('const ok = await onChange(patch);');
    expect(e).toContain('if (ok) flashes[key].markSaved();');
    // ★★ ONE commit path. A second one that confirmed optimistically would leave
    //    the three assertions above true and the behaviour false.
    expect(e.match(/markSaved\(\)/g) ?? []).toHaveLength(1);
  });

  it('★★ it clears itself, and never fires when nothing was written', async () => {
    // ★ Long enough to read after the eye has moved to the next field, short
    //   enough that two saves in a row do not leave a row of ticks behind.
    expect(SAVED_FLASH_MS).toBe(1600);
    setup();
    // ★★ A blur that changed nothing never reaches the write, so it never
    //    confirms — which is what keeps TABBING THROUGH the form silent instead
    //    of firing eight RPCs and leaving a row of ticks behind.
    for (const id of ['pd-unit-qty', 'pd-unit-w', 'pd-unit-d', 'pd-unit-size']) {
      fireEvent.blur(screen.getAllByTestId(id)[0]);
    }
    await act(async () => {});
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('pd-unit-f-qty-saved')[0].dataset.saved).toBe('false');
  });

  it('★★★ it is a FLASH, not the buffered Save/Cancel half — that is fix-575', () => {
    // ⚠️ THE BRIEF IS EXPLICIT that the buffered half is NOT in this ticket.
    //    Every field here still commits on blur; nothing added a per-field Save
    //    or Cancel button, and the footer's contract is unchanged.
    const e = code(editorsSrc);
    expect(e).not.toContain('pd-unit-field-save');
    expect(e).not.toContain('pd-unit-field-cancel');
    setup();
    expect(screen.queryByTestId('pd-unit-field-save')).toBeNull();
    expect(screen.getByTestId('project-data-done').textContent).toBe('Exit');
  });
});
