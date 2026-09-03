import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, UnitType } from '../lib/database.types';
import { parseUnitTypes } from '../lib/unitTypeNaming';

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
// ★★★ ALSO RETIRED — THE SCOPING HALF (fix-418 §B), BY fix-486 §D
// ---------------------------------------------------------------------------
//
// fix-418 §B's whole subject was `work_scope`, and fix-486 retired the field.
// See the named retirement below; §A is what this file still asserts.
//
// ★★★ AND fix-418 §B IS THE BEST ARGUMENT FOR RETIRING IT. Its own ruling was
// that the control renders ONLY on a unit already labelled `Remodel` — which is
// to say the app asked, on a row that says Remodel, whether it was a remodel.
// Bobby, 2026-09-03: *one way to say remodel — the type.*

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

// ★ fix-486 (P-143): `Duplex` became `Attached`. The fixture needs two
//   DIFFERENT labels, one of them a Remodel; the words just have to be words
//   the app still offers, or the row renders an off-list mark it never had.
const TWO_UNITS = [
  { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1 },
  { label: 'Attached', width_ft: 24, depth_ft: 40, qty: 2 },
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
    product_types: ['Remodel', 'Attached', 'Detached'],
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

// ★ fix-486 §D: `rerenderWith` went with fix-418 §B. Its only callers were the
//   relabel round-trips, which existed to prove a stored `work_scope` survived
//   a change of label — a field that no longer exists to survive anything.

beforeEach(() => {
  saves.length = 0;
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ===========================================================================
// ★★★ fix-486 §D (P-143) — fix-418 §B IS RETIRED, BY NAME
// ===========================================================================
//
// RETIRED FROM `fix-418 §B1: the Work control renders only on a Remodel`
//   · present on the Remodel and ABSENT on the Duplex — same rendered project
//   · ABSENT, not disabled and not greyed
//   · it appears the moment a unit is RELABELLED to Remodel
//
// RETIRED FROM `fix-418 §B2: the stored key and the three states are unchanged`
//   · parseUnitTypes STILL names work_scope — the whitelist trap
//   · the three states are still ""/none/performed
//   · SCOPE B4: the Library filter is untouched
//
// RETIRED FROM `fix-418 §B3: a stored work_scope survives a relabel`
//   · ROUND TRIP: Remodel → Duplex → Remodel keeps "performed"
//   · an UNRELATED edit to a non-Remodel unit does not drop its work_scope
//
// ---------------------------------------------------------------------------
// ★★★ ONE OF THEM IS NOT RETIRED SO MUCH AS **INVERTED**, AND IT IS KEPT
// ---------------------------------------------------------------------------
// "parseUnitTypes STILL names work_scope — the whitelist trap" was fix-412's
// hardest-won lesson: `parseUnitTypes` is a WHITELIST, both editors write the
// PARSED array back, so a key it stops naming is DELETED from the row on the
// next unrelated edit. That mechanism has not changed — what changed is that
// the deletion is now the POINT. The migration strips the key from the stored
// json; the whitelist is what stops the app putting it back. Asserted below in
// exactly that direction, because a mechanism this sharp deserves a test
// pointing at whichever way it is currently cutting.

describe('fix-418 §B (inverted by fix-486): the whitelist now REMOVES it', () => {
  it('★★★ parseUnitTypes DROPS work_scope — the whitelist, cutting the other way', () => {
    const parsed = parseUnitTypes([
      { label: 'Remodel', width_ft: 20, depth_ft: 30, qty: 1, work_scope: 'performed' },
      { label: 'Attached', width_ft: 24, depth_ft: 40, qty: 2, work_scope: 'none' },
    ]);
    expect('work_scope' in parsed[0]).toBe(false);
    expect('work_scope' in parsed[1]).toBe(false);
    // ★★ AND NOTHING ELSE WENT WITH IT. The blanket half: a whitelist edit is
    //    exactly the change that quietly takes a neighbour along.
    expect(parsed[0]).toMatchObject({
      label: 'Remodel',
      width_ft: 20,
      depth_ft: 30,
      qty: 1,
    });
    expect(parsed[1]).toMatchObject({ label: 'Attached', width_ft: 24, qty: 2 });
  });

  it('★★★ no unit row offers a work control at all any more', () => {
    // ★ fix-418 §B1's inverse. The control was Remodel-only, so a Remodel row
    //   is the one that proves it is gone rather than merely out of scope.
    renderHeader();
    expect(screen.queryByTestId('pd-unit-work-scope')).toBeNull();
    expect(screen.queryByTestId('pd-unit-work-chip')).toBeNull();
    expect(screen.getAllByTestId('pd-unit-row')[0].dataset.remodel).toBeUndefined();
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
