import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, UnitType } from '../lib/database.types';
import { parseUnitTypes } from '../lib/unitTypeNaming';
import { WORK_SCOPE_LABEL } from '../lib/unitRowLayout';
import { WORK_SCOPES, matchWorkScope } from '../lib/unitWorkScope';

// ===========================================================================
// fix-418 — WHAT SURVIVED fix-422, AND WHY THE REST DID NOT
// ===========================================================================
//
// fix-418 did two things. fix-422 reversed one of them on Bobby's instruction
// and kept the other exactly, so this file is split accordingly.
//
// ---------------------------------------------------------------------------
// ★★★ RETIRED — THE LAYOUT HALF (fix-418 §A)
// ---------------------------------------------------------------------------
//
// fix-418 made Unit Dimensions a VERTICAL column in a two-column card interior,
// because Bobby did not want a horizontal scrollbar. Seen on real projects:
//
//   *"When you have more than two different unit dimensions, the page gets way
//    too vertically long, and it stretches out milestones, team, design plan of
//    record, builder/owner… go back to horizontal."*
//
// ★★ IT WAS NOT A MISTAKE, IT WAS A TRADE THAT TURNED OUT BADLY. Vertical
// removed the scrollbar by spending HEIGHT — and the five cards are
// `alignItems: stretch`, so height spent in the PROJECT card is charged to four
// cards that did not ask for it. fix-422 goes horizontal again with a matrix
// narrow enough not to need a scroller, which is the property fix-418 was
// protecting. Those assertions live in ProjectCardMatrixFix422.test.tsx now.
//
// ---------------------------------------------------------------------------
// ★★★ KEPT, IN FULL — THE SCOPING HALF (fix-418 §B)
// ---------------------------------------------------------------------------
//
// `work_scope` renders ONLY on a unit labelled Remodel. That was a real scoping
// defect from fix-412 (P-050 made it a property of a Remodel; fix-412 put the
// control on every unit type), and nothing about the reshape touches it. It
// moved from a grid cell to a chip under its own row — see fix-422 Scope 7 for
// why a three-state answer whose third state is "not yet answered" cannot be a
// one-glyph column — but WHEN it renders, and what happens to a stored value on
// a relabel, are unchanged and asserted here.

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
// §B1 · WORK RENDERS ONLY ON A REMODEL — UNCHANGED BY fix-422
// ---------------------------------------------------------------------------

describe('fix-418 §B1: the Work control renders only on a Remodel', () => {
  it('★★★ present on the Remodel and ABSENT on the Duplex — same rendered project', () => {
    // ★★ ONE project, deliberately: a suite that renders two would pass while
    //    the condition was actually keyed off something project-wide.
    renderHeader();
    const rows = screen.getAllByTestId('pd-unit-row');
    expect(rows).toHaveLength(2);
    const [remodel, duplex] = rows;
    expect(remodel.dataset.remodel).toBe('true');
    expect(duplex.dataset.remodel).toBe('false');

    // ★ fix-422 moved the control OUT of the row and under it, so the assertion
    //   walks to the row's group rather than into the grid.
    const chips = screen.getAllByTestId('pd-unit-work-chip');
    expect(chips).toHaveLength(1);
    expect(remodel.parentElement).toContainElement(chips[0]);
    expect(duplex.parentElement).not.toContainElement(chips[0]);
    expect(screen.getAllByTestId('pd-unit-work-scope')).toHaveLength(1);
  });

  it('★★★ ABSENT, not disabled and not greyed', () => {
    // ★ A greyed control still says "there is an unanswered question here",
    //   which is exactly the wrong thing to say about a Duplex.
    renderHeader();
    const duplexGroup = screen.getAllByTestId('pd-unit-row')[1].parentElement!;
    expect(
      duplexGroup.querySelectorAll('[data-testid="pd-unit-work-scope"]'),
    ).toHaveLength(0);
    expect(duplexGroup.textContent).not.toContain(WORK_SCOPE_LABEL);
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
    //     that unit. Neither fix-418 nor fix-422 touches what parses.
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
    // ★ `matchWorkScope(rawScope, filter)` is the Library's predicate. The
    //   Remodel-only rule is a render condition on ONE card and must not reach
    //   it. `''` means "anything but a confirmed no-work", not "everything".
    expect(matchWorkScope('performed', '')).toBe(true);
    expect(matchWorkScope('none', '')).toBe(false);
    expect(matchWorkScope(null, '')).toBe(true);
    expect(matchWorkScope('none', 'none')).toBe(true);
    expect(matchWorkScope('performed', 'none')).toBe(false);
    expect(matchWorkScope('performed', 'performed')).toBe(true);
    expect(matchWorkScope(null, 'unanswered')).toBe(true);
    expect(matchWorkScope('none', 'unanswered')).toBe(false);
    // ★★ …and it reads the SCOPE ALONE. It never sees a label, so a unit no
    //    longer labelled Remodel still filters on its stored answer — the filter
    //    reads DATA, not what the card chose to draw.
    const duplex = { label: 'Duplex', work_scope: 'none' } as UnitType;
    expect(matchWorkScope(duplex.work_scope, 'none')).toBe(true);
    expect(matchWorkScope(duplex.work_scope, '')).toBe(false);
  });
});

describe('fix-418 §B3: a stored work_scope survives a relabel', () => {
  it('★★★ ROUND TRIP: Remodel → Duplex → Remodel keeps "performed"', () => {
    // ★★★ Proven through the REAL save path rather than by reading the code.
    //     Erasing the value would destroy a real answer in order to fix a
    //     rendering bug; not CARRYING it would hit the `parseUnitTypes`
    //     whitelist trap on the very next edit.
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

    const sel = screen.getByTestId('pd-unit-work-scope') as HTMLSelectElement;
    expect(sel.value).toBe('performed');

    fireEvent.change(screen.getByTestId('pd-unit-label-select'), {
      target: { value: 'Duplex' },
    });
    expect(saves).toHaveLength(1);
    // ★★★ RETAINED IN DATA. The write carries work_scope through untouched.
    expect(saves[0].unit_types[0]).toMatchObject({
      label: 'Duplex',
      work_scope: 'performed',
    });

    rerenderWith(rerender, saves[0].unit_types);
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    expect(parseUnitTypes(saves[0].unit_types)[0].work_scope).toBe('performed');

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

// ---------------------------------------------------------------------------
// §A · RETIRED — and the one property of it that is still non-negotiable
// ---------------------------------------------------------------------------

describe('fix-418 §A (retired by fix-422): what the reshape must still honour', () => {
  it("★★★ the two-column interior is GONE — the sections are the card's own children again", () => {
    renderHeader();
    expect(screen.queryByTestId('pd-project-interior')).toBeNull();
    expect(screen.queryByTestId('pd-project-left')).toBeNull();
    expect(screen.queryByTestId('pd-project-units-col')).toBeNull();
    // ★ …which is the shape fix-331 §1 distributes height across natively. The
    //   `flex-1` fix-418 needed on its wrapper is not needed any more, because
    //   there is no wrapper.
    const card = screen.getByTestId('pd-project-card');
    for (const id of ['pd-project-proposal', 'pd-project-site', 'pd-project-units']) {
      expect(screen.getByTestId(id).parentElement).toBe(card);
    }
  });

  it('★★★ NO horizontal scroller came back with the horizontal layout', () => {
    // ★★ fix-418's one non-negotiable, and the reason the whole
    //    412 → 417 → 418 → 422 sequence exists. Asserted over the entire
    //    rendered subtree, not on the one element fix-417 happened to add.
    renderHeader();
    const card = screen.getByTestId('pd-project-card');
    expect(screen.queryByTestId('pd-unit-dimensions-scroll')).toBeNull();
    for (const el of Array.from(card.querySelectorAll('*')) as HTMLElement[]) {
      const cls = typeof el.className === 'string' ? el.className : '';
      expect(cls).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(el.style.overflowX).not.toBe('auto');
      expect(el.style.overflowX).not.toBe('scroll');
      expect(el.style.scrollbarGutter).not.toBe('stable');
    }
  });
});
