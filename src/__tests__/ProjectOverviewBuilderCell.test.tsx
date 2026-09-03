import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// fix-24d: tests for the Builder/Owner autocomplete on Project Overview.
// Mirrors BuilderAutocomplete.test.tsx but exercises the surface where
// the picker is wired to useUpdateProject — picking a suggestion must
// fire ONE save with all four fields in a single patch (not four
// per-field saves) so OCC stays consistent.

const T = 'test-tenant-uuid';

const searchResults = vi.hoisted(() => ({
  current: [] as Builder[],
}));

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return { data: [], isLoading: false };
    const needle = trimmed.toLowerCase();
    const data = searchResults.current.filter(
      (b) =>
        (b.name ?? '').toLowerCase().includes(needle) ||
        (b.company ?? '').toLowerCase().includes(needle) ||
        (b.email ?? '').toLowerCase().includes(needle) ||
        (b.phone ?? '').toLowerCase().includes(needle),
    );
    return { data, isLoading: false };
  },
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

// Inert — the cell uses these only when bp is non-null, which we leave null.
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Inert — ExternalTeamEditor renders an "unconfigured" placeholder when empty.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
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


import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import { settle } from '../test/settle';

// ★★★ fix-475 (P-116) — BUILDER/OWNER IS BEHIND A DISCLOSURE NOW.
//
// Its own Overview column became CONSULTANTS; the card itself moved into the
// Team card as its top section, collapsed to Owner + Business with an
// `Expand ⌄` control (Bobby: *"Owner + Business visible, click to expand to the
// full card."*).
//
// ★★ SO EVERY TEST BELOW THAT READS THE CARD'S FIELDS OPENS IT FIRST, and that
// is the ONLY change to them. Not one assertion about what the card does was
// touched — the picker still writes the same patch, the OCC retry still
// recovers, the cached fields are still read-only. What moved is where the card
// lives, so what moved in the tests is one click before the reads.
function openBuilderCard() {
  fireEvent.click(screen.getByTestId('pd-builder-disclose'));
}


function builder(over: Partial<Builder>): Builder {
  return {
    id: 'b-' + Math.random().toString(36).slice(2, 8),
    name: 'X',
    company: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    ...over,
  };
}

const NOW = '2026-05-15T12:00:00Z';

function projectFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-24d',
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
    units: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
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
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function renderCell(projectOverride: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
    <ProjectDetailHeader
      project={projectFixture(projectOverride)}
      permits={[]}
      bp={null}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  searchResults.current = [];
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('Project Overview <BuilderOwnerCell /> — fix-24d', () => {
  it('typing in OWNER opens the autocomplete with matching catalog entries', () => {
    searchResults.current = [
      builder({ id: 'boyd-lybeck', name: 'Boyd Lybeck', company: "Jake'sD Corp" }),
      builder({ id: 'aaron', name: 'Aaron Cole', company: 'Cole Building' }),
    ];
    renderCell();
    openBuilderCard();
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'boyd' },
    });
    expect(screen.getByTestId('pd-builder-name-menu')).toBeInTheDocument();
    expect(
      screen.getByTestId('pd-builder-name-option-boyd-lybeck'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('pd-builder-name-option-aaron'),
    ).toBeNull();
  });

  it('selecting a suggestion fills all 4 fields AND fires ONE save with the full patch', async () => {
    searchResults.current = [
      builder({
        id: 'boyd-lybeck',
        name: 'Boyd Lybeck',
        company: "Jake'sD Corporation",
        email: 'jakesbd@comcast.net',
        phone: '(206) 387-6534',
        // fix-175: entity LLC address travels on pick.
        address: '123 Main St, Seattle WA',
      }),
    ];
    renderCell();
    openBuilderCard();
    // ★ fix-448: the picker opens on focus and searches as you type; the
    //   option ids are unchanged (`pd-builder-name-option-<id>`).
    fireEvent.focus(screen.getByTestId('pd-builder-name'));
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'boyd' },
    });
    fireEvent.click(screen.getByTestId('pd-builder-name-option-boyd-lybeck'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const call = mutateAsync.mock.calls[0][0];
    expect(call.projectId).toBe('p-24d');
    expect(call.expectedUpdatedAt).toBe(NOW);
    // fix-175: builder_address rides along in the single atomic patch; POC
    // (per-project) is intentionally NOT included.
    //
    // ★★ fix-425 ADDED `builder_id` TO THIS PATCH, and the RULE this test
    //    guards is unchanged: ONE save carrying everything, never six racing
    //    per-field commits, and never the per-project POC. What grew is the
    //    payload — picking a builder from the menu now records WHICH builder,
    //    which is the entire point of a catalog that 33 of 202 projects were
    //    linked to. Asserted with toEqual on purpose: a new key has to be
    //    added here deliberately rather than drifting in.
    expect(call.patch).toEqual({
      builder_id: 'boyd-lybeck',
      builder_name: 'Boyd Lybeck',
      builder_company: "Jake'sD Corporation",
      builder_email: 'jakesbd@comcast.net',
      builder_phone: '(206) 387-6534',
      builder_address: '123 Main St, Seattle WA',
    });
    expect(call.fieldLabel).toBe('Builder');

    // ★★★ fix-448: THE FIVE DISPLAY ASSERTIONS ARE GONE, AND THEIR ABSENCE IS
    //     THE PROPERTY.
    //
    // fix-24d asserted that picking filled five local `useState` drafts. Those
    // drafts no longer exist: the cell renders `project.builder_*` directly,
    // so what you see IS what is stored — there is no second copy to fall out
    // of step with the patch above. In this test the project prop is a fixture
    // the mutation mock never updates, so the card correctly keeps showing the
    // old row; asserting otherwise would be asserting the presence of exactly
    // the duplicate state this ticket removed.
    //
    // ★ The contract that matters — ONE save, carrying all six columns
    //   together — is the `toEqual` above, and it is unchanged.
    expect(screen.getByTestId('pd-builder-company').tagName).not.toBe('INPUT');
  });

  // ★★★ fix-448 (P-082) INVERTS THIS PIN, AND THE INVERSION IS THE RULING.
  //
  // fix-24d's title says the quiet part: "the auto-promote path in
  // useUpdateProject handles catalog insert". Typing a name and blurring
  // created a project field, and sometimes a catalogue row, from a value
  // nobody had confirmed — which is how "boy" got into the catalogue (fix-174)
  // and how text drifted away from `builder_id` (P-082).
  //
  // Bobby, 2026-08-29: *"Typing a name that is not in the catalog offers 'Add
  // new builder…' which creates the catalog row and links it."* The gesture is
  // still available — it is just explicit now, and it writes BOTH halves.
  it('fix-24d → fix-448: typing without selecting writes NOTHING, and offers Add new', async () => {
    searchResults.current = []; // no suggestions
    renderCell();
    openBuilderCard();
    const input = screen.getByTestId('pd-builder-name');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Brand New Builder' } });
    // ★ The escape hatch is on screen, named after what was typed.
    expect(
      screen.getByTestId('pd-builder-name-add-new').textContent,
    ).toContain('Brand New Builder');
    fireEvent.blur(input);
    // ★ Asserted SYNCHRONOUSLY, and that is the honest form for an absence:
    //   the only writers on this card are onPick / onCreated / onClear, all of
    //   which fire from a click handler. Waiting a guessed interval to watch
    //   nothing happen proves nothing that this does not (fix-300b).
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blurring without changes does not fire a save (idempotency)', async () => {
    renderCell({
      builder_name: 'Existing Name',
      builder_company: null,
      builder_email: null,
      builder_phone: null,
    });
    openBuilderCard();
    // Focus + blur with the original value — should be a no-op.
    fireEvent.focus(screen.getByTestId('pd-builder-name'));
    fireEvent.blur(screen.getByTestId('pd-builder-name'));
    // fix-300b: drain, then assert no save snuck through.
    await settle();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // fix-175 — owner LLC address + per-project point-of-contact.
  // ★★★ fix-448 §B4 INVERTS THIS TOO. `builder_address` is fix-175's CACHE of
  //     the catalogue row's address — it travels on pick. A card that can also
  //     type into it holds a second answer to a question the registry already
  //     answers, and the two drift the first time an LLC moves office.
  //     Editing happens in Settings → Lists & Catalogs → Builders & Owners.
  it('fix-175 → fix-448: LLC Address is DISPLAY, not an input', async () => {
    searchResults.current = [];
    renderCell({ builder_address: '900 Olive Way, Seattle' });
    openBuilderCard();
    const cell = screen.getByTestId('pd-builder-address');
    expect(cell.tagName).not.toBe('INPUT');
    // ★ It still SHOWS the cached value — read-only is not hidden.
    expect(cell.textContent).toBe('900 Olive Way, Seattle');
  });

  it('editing Point of Contact name + email each commit the per-project poc_* field on blur', async () => {
    renderCell();
    openBuilderCard();
    fireEvent.change(screen.getByTestId('pd-poc-name'), {
      target: { value: 'Dana Contact' },
    });
    fireEvent.blur(screen.getByTestId('pd-poc-name'));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync.mock.calls[0][0].patch).toEqual({ poc_name: 'Dana Contact' });
    expect(mutateAsync.mock.calls[0][0].fieldLabel).toBe('Point of Contact');

    fireEvent.change(screen.getByTestId('pd-poc-email'), {
      target: { value: 'dana@deal.test' },
    });
    fireEvent.blur(screen.getByTestId('pd-poc-email'));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(mutateAsync.mock.calls[1][0].patch).toEqual({ poc_email: 'dana@deal.test' });
    expect(mutateAsync.mock.calls[1][0].fieldLabel).toBe('Contact Email');
  });

  it('blank POC + address are optional — blurring empty fields fires no save', async () => {
    renderCell();
    openBuilderCard();
    fireEvent.focus(screen.getByTestId('pd-poc-name'));
    fireEvent.blur(screen.getByTestId('pd-poc-name'));
    fireEvent.focus(screen.getByTestId('pd-builder-address'));
    fireEvent.blur(screen.getByTestId('pd-builder-address'));
    await settle();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
