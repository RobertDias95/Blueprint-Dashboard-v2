import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import { UNIT_ROW_COLUMNS } from '../lib/unitRowLayout';

// fix-205: Project Overview unit-types editor — W/D decimals (wider inputs +
// step 0.5), per-row Stories, product-type Label dropdown (multi) / auto-label
// (single → "unnamed" fix on save).

const T = 'test-tenant-uuid';
const TOKEN = '2026-05-15T12:00:00Z';
const NEW_TOKEN = '2026-05-15T12:05:00Z';

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
  // ★ fix-449 §C: the CANONICAL product-type registry, so the off-list mark
  //   has something to judge against. An empty map means "registry not loaded"
  //   and marks nothing — deliberately, or every row would wear a warning for
  //   the frame before app_config arrives.
  useAppConfig: () => ({
    map: new Map<string, unknown>([
      // ★ fix-486 (P-143): the registry is five values now.
      ['productTypeOptions', ['Detached', 'Attached', 'ADU', 'DADU', 'Remodel']],
    ]),
  }),
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

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
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
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: TOKEN,
    updated_at: TOKEN,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function setup(over: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const project = projectFixture(over);
  queryClient.setQueryData(queryKeys.projects(T), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {/* ★ fix-362: the Team card reads `?msg=` / `?chat=` from the URL now
          — a chat notification lands on the message, and §2's rule is that
          the deep-link state lives in the URL and nowhere else. So this
          header needs a router, where before it needed none. */}
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'p-test', updated_at: NEW_TOKEN });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// A single NAMED row forces the expanded grid (compact only renders for a lone
// unlabeled row).
const NAMED_ROW = [{ label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1 }];

describe('fix-205: W/D decimals in the expanded grid', () => {
  it('W/D inputs allow half-foot steps and persist a decimal width', async () => {
    setup({ product_types: ['Detached'], unit_types: NAMED_ROW });
    const wInput = screen.getByTestId('pd-unit-w') as HTMLInputElement;
    expect(wInput.getAttribute('step')).toBe('0.5');
    expect(
      (screen.getByTestId('pd-unit-d') as HTMLInputElement).getAttribute('step'),
    ).toBe('0.5');
    fireEvent.change(wInput, { target: { value: '17.5' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].width_ft).toBe(
      17.5,
    );
  });
});

describe('fix-205: per-row Stories', () => {
  it('Stories input persists onto the unit_types row', async () => {
    setup({ product_types: ['Detached'], unit_types: NAMED_ROW });
    const sty = screen.getByTestId('pd-unit-stories') as HTMLInputElement;
    fireEvent.change(sty, { target: { value: '3' } });
    fireEvent.blur(sty);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].stories).toBe(3);
  });
});

// ===========================================================================
// ★★★ fix-449 §C (P-077) INVERTS fix-209 AND HALF OF fix-212 — BY RULING.
// ===========================================================================
//
// Both handled a stored label the app did not recognise, and both hid it:
// fix-209 blanked it on a multi-type project, fix-212 substituted the lone type
// on a single-type one. Neither showed the person what the row actually held,
// and `resolveUnitTypesForSave` meant editing any OTHER field wrote the
// substitute over the original.
//
// Bobby (P-077, inheriting fix-415's rule): an off-list value is SHOWN as
// off-list, never silently vanished or rewritten. 22 of prod's 235 unit rows
// carried one when that was measured.
//
// ★★★ fix-486 (P-143) SHARPENED THIS RULING RATHER THAN REVERSING IT. fix-449
// noted that "Type A–D" read like per-project unit NAMES and left the call to
// Bobby. He made it: they are the WIZARD'S PLACEHOLDERS — the intake habit is
// to add rows first and name them later — so they are not a name and not a
// type, they are an unanswered question. The remap deliberately left the label
// (a rule that guessed would have declared eleven unanswered rows answered) and
// the row now says *needs a type* rather than *not in the list*.
//
// ★★ THE UNDERLYING RULE IS UNTOUCHED AND IS WHAT THIS BLOCK STILL ASSERTS:
// the stored value is shown, it is selected, and editing another field does not
// rewrite it. Only the WORD in the mark changed, and only for placeholders — a
// label somebody deliberately typed still gets the off-list mark.
describe('fix-209 → fix-449: the Label dropdown SHOWS an off-list value', () => {
  it('★★★ the stored value is IN the options, beside "Other…"', () => {
    setup({
      product_types: ['Detached', 'Attached'],
      unit_types: NAMED_ROW, // legacy label "Type A"
    });
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    // ★ fix-415's append rule: a control must be able to display what it holds.
    expect(opts).toEqual([
      '',
      'Detached',
      'Attached',
      'Type A',
      '__other__',
    ]);
  });

  it('★★★ …and it is SELECTED, not left on "Pick type…"', () => {
    setup({ product_types: ['Detached', 'Attached'], unit_types: NAMED_ROW });
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    expect(select.value).toBe('Type A');
    // ★★ …and it says so — as fix-486's "needs a type", because `Type A` is a
    //    placeholder rather than a word somebody chose.
    expect(screen.getByTestId('pd-unit-label-needs-type')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-unit-label-offlist')).toBeNull();
  });

  it('★★★ fix-486: a DELIBERATE off-list label still gets the off-list mark', () => {
    // ★★★ THE HALF THAT WOULD OTHERWISE ROT. The two marks are different
    //     states, and a change that collapsed them would tell somebody who
    //     typed a real word that they had failed to answer a question. One
    //     fixture each, in the same suite, is what keeps them apart.
    setup({
      product_types: ['Detached', 'Attached'],
      unit_types: [{ label: 'Carriage House', width_ft: 20, depth_ft: 30, qty: 1 }],
    });
    expect(screen.getByTestId('pd-unit-label-offlist')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-unit-label-needs-type')).toBeNull();
  });

  it('picking a product type from the dropdown saves it as the label', () => {
    setup({ product_types: ['Detached', 'Attached'], unit_types: NAMED_ROW });
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Attached' } });
    return waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].label).toBe(
        'Attached',
      );
    });
  });

  it('★★★ editing a DIMENSION no longer rewrites the label', async () => {
    // ★★★ THE ONE THAT MATTERED MOST. `resolveUnitTypesForSave` runs on every
    //     save, so under fix-209 typing a width blanked "Type A" ON DISK — and
    //     under fix-212 it replaced it with the lone product type. Ten of
    //     prod's rows ("Type A" ×5, "Type B" ×5) were one keystroke from that.
    setup({ product_types: ['Detached', 'Attached'], unit_types: NAMED_ROW });
    const wInput = screen.getByTestId('pd-unit-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '21' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[0];
    expect(row.width_ft).toBe(21);
    expect(row.label).toBe('Type A');
  });

  it('★★★ a SINGLE product type no longer overrides a stored label either', () => {
    setup({ product_types: ['Detached'], unit_types: NAMED_ROW }); // stored "Type A"
    const select = screen.getByTestId('pd-unit-label-select') as HTMLSelectElement;
    expect(select.value).toBe('Type A');
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(['', 'Detached', 'Type A', '__other__']);
  });

  it('★★ fix-212\'s surviving half: a BLANK label still fills from a lone type', () => {
    // The only case where this control may supply a value — nothing is
    // displaced, because nothing was there.
    // ★ TWO rows, because a lone blank-label row renders the COMPACT control
    //   (`isCompact`), which has no label select at all.
    setup({
      product_types: ['Detached'],
      unit_types: [
        { label: '', width_ft: 20, depth_ft: 30, qty: 1 },
        { label: 'Detached', width_ft: 22, depth_ft: 33, qty: 1 },
      ],
    });
    const selects = screen.getAllByTestId('pd-unit-label-select') as HTMLSelectElement[];
    expect(selects[0]!.value).toBe('Detached');
    // ★ A filled blank is not off-list — nothing was displaced.
    expect(screen.queryByTestId('pd-unit-label-offlist')).toBeNull();
  });
});

describe('fix-232: proposal unit-row label is dropdown-only (no free-text)', () => {
  it('with product types, the label is the dropdown — there is NO free-text label input', () => {
    setup({ product_types: ['Detached', 'Attached'], unit_types: NAMED_ROW });
    expect(screen.getByTestId('pd-unit-label-select')).toBeInTheDocument();
    // No read-only fallback + no free-typing: the ONLY label control is the select.
    expect(screen.queryByTestId('pd-unit-label-readonly')).toBeNull();
  });

  it('with NO product types, the label is READ-ONLY (no free-text) but still DISPLAYS the stored value', () => {
    // fix-232: the old free-text fallback is gone — a no-product-type project
    // can't type an ad-hoc label. The stored value is shown read-only (item 3:
    // not silently blanked); the user adds a product type to enable the picker.
    setup({ product_types: [], unit_types: [{ label: 'Legacy Combo', width_ft: 20, depth_ft: 30, qty: 1 }] });
    const ro = screen.getByTestId('pd-unit-label-readonly');
    expect(ro.tagName).toBe('SPAN'); // not an <input> — cannot be free-typed
    expect(ro.textContent).toBe('Legacy Combo'); // backward display of the stored value
    // The editable dropdown is absent when there are no product types to pick.
    expect(screen.queryByTestId('pd-unit-label-select')).toBeNull();
  });
});

describe('fix-209: narrower Qty + Stories inputs', () => {
  // =========================================================================
  // ★★★ SUPERSEDED BY fix-412 SCOPE C — AND THIS TEST IS WHY IT WAS NEEDED
  // =========================================================================
  //
  // fix-209 narrowed Qty and Sty to `w-7` (28px) and pinned it here. What it
  // could not see is that the HEADER strip above the row declared **18px for
  // Qty and 30px for Sty** — two independent lists of widths, already disagreeing
  // in both columns on the day this was written. Two more drifted later
  // (Parking and Roof Deck, whose selects had no width at all), and the visible
  // result was Bobby's report: *"RD did not sit over its own box, and Stalls
  // drifted toward Parking."*
  //
  // ★★ fix-412 deletes the second list. The header and the row are now grid
  // children of ONE `gridTemplateColumns` (lib/unitRowLayout), so the cells
  // fill their column with `w-full` and a header cannot sit over the wrong
  // control. Asserting a fixed width class here would re-create the very
  // duplication that caused the defect.
  //
  // ★ WHAT fix-209 ACTUALLY WANTED IS STILL TRUE and is asserted instead: Qty
  //   and Sty are the row's two NARROWEST columns, and both are narrower than
  //   W and D. That is the ruling ("single-digit, occasionally 2"); `w-7` was
  //   only ever how it was expressed.
  it('Qty and Sty are still the narrowest columns (fix-209, via fix-412 grid)', () => {
    const col = (k: string) =>
      UNIT_ROW_COLUMNS.find((c) => c.key === k)!.width;
    expect(col('qty')).toBe(col('stories'));
    expect(col('qty')).toBeLessThan(col('width_ft'));
    expect(col('stories')).toBeLessThan(col('depth_ft'));
    // ...and the cells fill their column rather than carrying their own width.
    setup({ product_types: ['Detached'], unit_types: NAMED_ROW });
    expect(screen.getByTestId('pd-unit-qty').className).toContain('w-full');
    expect(screen.getByTestId('pd-unit-stories').className).toContain('w-full');
  });
});

describe('fix-205: "unnamed" fix on save (single product type)', () => {
  it('a blank-label row saved under a single product type persists that type as its label', async () => {
    // A lone unlabeled row renders the COMPACT editor; editing a dimension
    // saves the row, and writeTypes resolves the blank label to the type.
    setup({
      product_types: ['Detached'],
      unit_types: [{ label: '', width_ft: null, depth_ft: null, qty: 1 }],
    });
    const wInput = screen.getByTestId('pd-units-compact-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '96' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[0];
    expect(row.label).toBe('Detached');
    expect(row.width_ft).toBe(96);
  });

  it('fix-212 → fix-449: a single product type no longer overrides a stored label on save', async () => {
    // ★★★ The save-path half of the same inversion. This is the path that
    //     would have quietly rewritten prod's ten "Type A"/"Type B" rows.
    setup({ product_types: ['Detached'], unit_types: NAMED_ROW }); // stored "Type A"
    const wInput = screen.getByTestId('pd-unit-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '21' } });
    fireEvent.blur(wInput);
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].label).toBe(
      'Type A',
    );
  });
});
