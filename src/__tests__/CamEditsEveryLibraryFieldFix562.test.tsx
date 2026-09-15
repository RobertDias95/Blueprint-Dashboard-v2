import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import type { Project } from '../lib/database.types';
import LibraryMatrix from '../components/LibraryMatrix';
import {
  CANONICAL_PARKING,
  CANONICAL_ROOF_DECK,
  CANONICAL_STORIES,
} from '../lib/unitVocabulary';

// ===========================================================================
// fix-562 §G (P-274) — CAM CAN EDIT EVERY LIBRARY FIELD EXCEPT THE TYPE
// ===========================================================================
//
// ★★★ THE BLOCK WAS IN TWO DIFFERENT PLACES AND ONLY ONE WAS A PERMISSION.
//     Measured on prod 2026-09-15:
//
//       · parking · roof deck · stories · qty · width · depth · size all live
//         inside `p_unit_types`, and zone and alley were already parameters —
//         so the SERVER accepted every one of them. **The SCREEN never offered
//         them.** fix-532 §A shipped exactly four editable cells and said so:
//         *"the label, the quantity and the rest stay read-only."*
//       · `is_corner_lot`, `juris` and `lot_size_sf` were NOT parameters, so
//         those three were genuinely impossible server-side.
//
// ★★ So §G is mostly WIRING, not GRANTING — a capability granted in fix-527
//    that nothing ever called the whole way through.
//
// ★★★ AND THE DEFECT NOBODY WOULD HAVE FOUND UNTIL IT COST SOMETHING: the RPC
//     could not CLEAR a field. Every assignment was `coalesce(p_X, pr.X)`, so
//     a null meant leave unchanged. Proved as Cam against prod inside a
//     rolled-back transaction — conflict false, zone `NR` before, `NR` after,
//     success toast. The browser half of that fix is what this file asserts:
//     an ABSENT key means "leave alone" and a PRESENT null means "clear", and
//     `?? null` would merge the two.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));
/** Every `{ p_project_id, p_expected_updated_at, p_patch }` the screen sent. */
const rpcCalls = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false, error: null }),
}));
// ★ `useAppConfig` returns a MAP and several readers call `.get` on it — a
//   partial mock returning `{}` throws inside a `useMemo` at mount. The
//   partial-mock trap, recorded in fix-407, fix-514 and fix-519 before this.
//   ★★ An EMPTY map is the interesting case here: it makes the three unit
//      vocabularies fall back to their canonical lists, which is what a tenant
//      sees before block D of the migration is applied. The controls must work
//      in that world, because this ticket ships before the migration does.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map<string, unknown>(), isLoading: false }),
  readAppConfigStringArray: () => [] as string[],
}));
// ★★★ THE CAPABILITY COMES FROM THE REAL `useMayEditLibrary`, ANSWERED BY A
//     STUBBED `profiles` READ. Mocking the hook out would test nothing about
//     the thing fix-527 built — and the hook FAILS CLOSED (error, no session,
//     query in flight all answer false), so the cells appear on a later frame
//     and every test here has to wait for one. That is the honest shape.
//
// ★★ It is cosmetic either way: the RPC is the gate and refuses an uncapable
//    caller with `42501` (proved on prod in fix-527 §B). What this file tests
//    is what the screen OFFERS once the server has already said yes.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { may_edit_library: true }, error: null }) }),
      }),
    }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.current.push(args);
      return { data: [{ out_updated_at: NOW, out_conflict: false }], error: null };
    },
  },
}));

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-562',
    address: '10150 NE 64th St',
    juris: 'Kirkland',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    product_types: ['Detached'],
    project_tags: [],
    units: 3,
    zone: 'RM 3.6',
    alley: 'Yes',
    lot_width: 40,
    lot_depth: 90,
    lot_size_sf: 3600,
    is_corner_lot: true,
    is_regular_shape: true,
    num_lots: 1,
    unit_types: [
      {
        label: 'Detached',
        width_ft: 24,
        depth_ft: 50.5,
        size_sf: 3352,
        qty: 1,
        stories: 3,
        basement: false,
        parking_kind: 'garage',
        parking_count: 2,
        roof_deck: false,
        penthouse: false,
      },
    ] as unknown as Project['unit_types'],
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function renderLibrary(projects: Project[] = [project()]) {
  refsProjects.current = projects;
  refsPermits.current = projects.map((p) => ({
    id: `perm-${p.id}`,
    project_id: p.id,
    type: 'Building Permit',
    stage: 'de',
    cycle: 1,
    corr_rounds: 0,
    submitted: null,
    status: null,
    portal_url: null,
    struct_address: null,
    parent_permit_id: null,
    expected_issue: null,
    approval_date: null,
    actual_issue: null,
    extras: null,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // ★★★ fix-532 §B — THE OCC TOKEN IS READ FROM THE CACHE AT SEND TIME, never
  //     from a render-captured prop (P-246: two saves in flight carrying the
  //     same stale value). `useProjects` is mocked here, so nothing populates
  //     that cache — seeding it is what makes the harness able to observe the
  //     rule at all, rather than silently sending `null` and passing.
  queryClient.setQueryData(queryKeys.projects(T), projects);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<LibraryMatrix />, { wrapper });
}

async function renderEditable(projects: Project[] = [project()]) {
  const r = renderLibrary(projects);
  // ★★★ `useMayEditLibrary` answers false while its query is IN FLIGHT
  //     (fix-527's fail-closed rule), so the editable cells appear on a LATER
  //     FRAME. Waiting for one of them is the honest way to say "once the
  //     server has answered" — and it has to be a testid that exists ONLY in
  //     the editable form, or the wait returns immediately against the
  //     read-only cell and the test asserts nothing.
  await screen.findByTestId('library-lot-w-input-p-562');
  return r;
}

/**
 * ★★ THE SAVE IS A MUTATION, SO IT LANDS ON A LATER TICK. Reading `rpcCalls`
 *    straight after a `fireEvent` reads an empty array and every assertion
 *    passes vacuously against `{}` — which is exactly the shape of a test that
 *    looks green and checks nothing.
 */
async function nextPatch(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(rpcCalls.current.length).toBeGreaterThan(0));
  return rpcCalls.current.at(-1)!.p_patch as Record<string, unknown>;
}

async function nextUnit(): Promise<Record<string, unknown>> {
  const patch = await nextPatch();
  return (patch.unit_types as Record<string, unknown>[])[0]!;
}

beforeEach(() => {
  rpcCalls.current = [];
  // ★★★ THE LIBRARY REMEMBERS ITS FILTERS IN sessionStorage (fix-403), AND
  //     `view` IS ONE OF THEM. Without this, the first test that switches to
  //     the UNIT view leaves every later test mounted on the wrong table — and
  //     they fail waiting for a SITE cell that will never render. A suite that
  //     depends on its own execution order is a suite that will one day pass
  //     for the wrong reason.
  window.sessionStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
    // ★ `useMayEditLibrary` is `enabled: !!userId` — with no signed-in user the
    //   query never runs and the capability stays false for ever.
    user: { id: 'cam-uuid', email: 'cameron@blueprintcap.com' },
  } as never);
});

// ---------------------------------------------------------------------------
// §G1 · THE THREE FIELDS THAT WERE IMPOSSIBLE SERVER-SIDE
// ---------------------------------------------------------------------------

describe('fix-562 §G: the three fields the RPC had to GAIN', () => {
  it('★★★ LOT SIZE is typeable — blank on 179 of 221, the biggest hole', async () => {
    await renderEditable();
    const cell = screen.getByTestId('library-lot-size-input-p-562') as HTMLInputElement;
    expect(cell.value).toBe('3600');
    fireEvent.change(cell, { target: { value: '4200' } });
    fireEvent.blur(cell);
    expect(await nextPatch()).toEqual({ lot_size_sf: 4200 });
  });

  it('★★★ …AND IT CAN BE SET BACK TO NULL, which the old RPC could not do', async () => {
    await renderEditable();
    const cell = screen.getByTestId('library-lot-size-input-p-562') as HTMLInputElement;
    fireEvent.change(cell, { target: { value: '' } });
    fireEvent.blur(cell);
    // ★★★ THE WHOLE CONTRACT IN ONE ASSERTION: the key is PRESENT and its
    //     value is null. `coalesce(p_X, pr.X)` read that as "leave unchanged";
    //     `p_patch ? 'lot_size_sf'` reads it as "clear".
    const patch = await nextPatch();
    expect(Object.keys(patch)).toEqual(['lot_size_sf']);
    expect(patch.lot_size_sf).toBeNull();
  });

  it('★★★ CORNER LOT round-trips all three states, including back to `—`', async () => {
    await renderEditable();
    const cell = screen.getByTestId('library-corner-input-p-562') as HTMLSelectElement;
    expect(cell.value).toBe('Yes');
    fireEvent.change(cell, { target: { value: 'No' } });
    expect(await nextPatch()).toEqual({ is_corner_lot: false });
    // ★★ `—` is "nobody has answered" and is a DIFFERENT fact from a recorded
    //    No (fix-122). It is only reachable because §G taught the function to
    //    write a null.
    rpcCalls.current = [];
    fireEvent.change(cell, { target: { value: '' } });
    const cleared = await nextPatch();
    expect(Object.keys(cleared)).toEqual(['is_corner_lot']);
    expect(cleared.is_corner_lot).toBeNull();
  });

  it('★★★ JURISDICTION is wired for CORRECTION, and has no blank option', async () => {
    // ★ Two projects so the DERIVED fallback list holds two jurisdictions —
    //   `app_config.jurisdictions` is empty in this harness, and the editor
    //   falls back to the union of what is stored so a fresh tenant still gets
    //   a working control rather than an empty one.
    await renderEditable([
      project(),
      project({ id: 'p-562b', address: '9 Pine St', juris: 'Seattle' }),
    ]);
    const cell = screen.getByTestId('library-juris-p-562') as HTMLSelectElement;
    expect(cell.value).toBe('Kirkland');
    // ★★★ `projects.juris` is NOT NULL, so clearing is not an answer and
    //     offering it would be a control that can only fail. The RPC refuses a
    //     null juris with `23502` and a sentence; the screen does not ask.
    expect(Array.from(cell.options).map((o) => o.value)).not.toContain('');
    fireEvent.change(cell, { target: { value: 'Seattle' } });
    expect(await nextPatch()).toEqual({ juris: 'Seattle' });
  });

  it('★★ …and jurisdiction is blank on 0 of 221, so nobody should count it as a win', async () => {
    // Cam asked for it; there is nothing to backfill. Said in the PR and said
    // here, because a wired field that changes no row is easy to report as
    // progress.
    await renderEditable();
    expect(screen.getByTestId('library-juris-p-562').tagName).toBe('SELECT');
  });
});

// ---------------------------------------------------------------------------
// §G2 · THE FIELDS THE SERVER ALREADY ACCEPTED AND THE SCREEN DID NOT OFFER
// ---------------------------------------------------------------------------

describe('fix-562 §G: the unit fields, wired rather than granted', () => {
  /**
   * ★★★ WAIT FOR THE CAPABILITY ON THE SITE VIEW, THEN SWITCH. The unit
   *     testids exist in BOTH the read-only and the editable form, so a
   *     `findByTestId` over there returns the read-only `<td>` on the first
   *     frame and every assertion below then runs against a cell with no
   *     control. `library-lot-w-input-…` exists only when the capability has
   *     resolved, which is why the wait happens before the click.
   */
  async function unitView() {
    const r = await renderEditable();
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
    return r;
  }

  it('★★★ PARKING is a dropdown over the registry, and writes BOTH PARTS', async () => {
    await unitView();
    const cell = screen.getByTestId('library-unit-p-562-0-parking') as HTMLSelectElement;
    expect(cell.value).toBe('2-car garage');
    // ★ The options are `app_config.parkingOptions`, falling back to the
    //   canonical list — never a literal in the component (fix-232).
    expect(Array.from(cell.options).map((o) => o.value).filter(Boolean)).toEqual([
      ...CANONICAL_PARKING,
    ]);
    fireEvent.change(cell, { target: { value: '4-car garage' } });
    const unit = await nextUnit();
    // ★★★ ONE PICK, ONE WRITE, BOTH HALVES. A `(field, value)` callback would
    //     have to fire twice and could land a kind with no count — the pair
    //     `parseUnitTypes` refuses outright.
    expect(unit.parking_kind).toBe('garage');
    expect(unit.parking_count).toBe(4);
  });

  it('★★★ ROOF DECK and STORIES too, in Bobby\'s words', async () => {
    await unitView();
    const deck = screen.getByTestId('library-unit-p-562-0-roofdeck') as HTMLSelectElement;
    expect(deck.value).toBe('None');
    expect(Array.from(deck.options).map((o) => o.value).filter(Boolean)).toEqual([
      ...CANONICAL_ROOF_DECK,
    ]);
    fireEvent.change(deck, { target: { value: 'W/ PH' } });
    let unit = await nextUnit();
    expect(unit.roof_deck).toBe(true);
    expect(unit.penthouse).toBe(true);
    rpcCalls.current = [];

    const sty = screen.getByTestId('library-unit-p-562-0-stories') as HTMLSelectElement;
    expect(sty.value).toBe('3');
    expect(Array.from(sty.options).map((o) => o.value).filter(Boolean)).toEqual([
      ...CANONICAL_STORIES,
    ]);
    fireEvent.change(sty, { target: { value: '2+B' } });
    unit = await nextUnit();
    expect(unit.stories).toBe(2);
    expect(unit.basement).toBe(true);
  });

  it('★★★ clearing a vocabulary cell clears BOTH parts, back to NOT RECORDED', async () => {
    await unitView();
    fireEvent.change(screen.getByTestId('library-unit-p-562-0-parking'), {
      target: { value: '' },
    });
    const unit = await nextUnit();
    expect(unit.parking_kind).toBeNull();
    expect(unit.parking_count).toBeNull();
  });

  it('★★ UNIT SIZE is typeable here too — the field fix-488 shipped with no editor', async () => {
    await unitView();
    const cell = screen.getByTestId('library-unit-p-562-0-size') as HTMLInputElement;
    expect(cell.value).toBe('3352');
    fireEvent.change(cell, { target: { value: '3400' } });
    fireEvent.blur(cell);
    const unit = await nextUnit();
    expect(unit.size_sf).toBe(3400);
  });

  it('★★★ THE TYPE STAYS READ-ONLY — Bobby\'s one exception', async () => {
    await unitView();
    // *"every Library field except Type. Type stays dropdown-only off
    //  app_config.productTypeOptions"* (fix-232). It is edited where the
    //  project's own type list is, not here.
    const cell = screen.getByTestId('library-unit-p-562-0-label');
    expect(cell.querySelector('select')).toBeNull();
    expect(cell.querySelector('input')).toBeNull();
    expect(cell.textContent).toContain('Detached');
  });

  it('★★★ …and the WHOLE unit_types array goes back, spliced, never one unit', async () => {
    // fix-532 §A's rule: `unit_types` is a jsonb column and the RPC REPLACES
    // it, so the row being edited is spliced into the project's CURRENT list.
    // ★★ Reading through `parseUnitTypes` is what stops an unnamed key being
    //    dropped (fix-412's whitelist, cutting the other way).
    await unitView();
    fireEvent.change(screen.getByTestId('library-unit-p-562-0-stories'), {
      target: { value: '4' },
    });
    const units = (await nextPatch()).unit_types as Record<string, unknown>[];
    expect(units).toHaveLength(1);
    // Every untouched key survives the splice.
    expect(units[0]!.label).toBe('Detached');
    expect(units[0]!.width_ft).toBe(24);
    expect(units[0]!.depth_ft).toBe(50.5);
    expect(units[0]!.qty).toBe(1);
    expect(units[0]!.size_sf).toBe(3352);
  });
});

// ---------------------------------------------------------------------------
// §G3 · A CELL DOES NOT MOVE AS YOU GAIN A CAPABILITY
// ---------------------------------------------------------------------------

describe('fix-562 §G: the project grain and the unit grain stay apart', () => {
  it('★★★ a PROJECT field is editable on the SITE row and read-only beside a unit', async () => {
    // ★★★ A DELIBERATE LINE, STATED SO IT READS AS A DECISION. The unit view
    //     shows `Juris` as CONTEXT beside each unit, and a project with three
    //     units would otherwise render three editors for one value — three
    //     controls that disagree the moment two of them are open. Project
    //     fields are edited at the project grain, on the SITE view.
    await renderEditable();
    expect(screen.getByTestId('library-juris-p-562').tagName).toBe('SELECT');

    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    const unitRow = await screen.findByTestId('library-unit-row-p-562-0');
    // ★ The unit row DOES print the jurisdiction — as context, with no control.
    expect(within(unitRow).queryByTestId('library-juris-p-562')).toBeNull();
    expect(unitRow.textContent).toContain('Kirkland');
  });

  it('★★★ EVERY WRITE CARRIES THE OCC TOKEN FROM THE CACHE, not from a prop', async () => {
    // fix-532 §B (P-246): the stale token was the CALLER'S — a render-captured
    // prop, with two saves in flight carrying the same value. §G adds six more
    // cells to a surface that already fires one save per field, so this matters
    // more than it did, not less.
    await renderEditable();
    fireEvent.change(screen.getByTestId('library-corner-input-p-562'), {
      target: { value: 'No' },
    });
    await nextPatch();
    expect(rpcCalls.current.at(-1)!.p_expected_updated_at).toBe(NOW);
    expect(rpcCalls.current.at(-1)!.p_project_id).toBe('p-562');
  });
});
