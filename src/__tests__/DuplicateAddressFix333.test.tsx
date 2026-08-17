import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import {
  classifyMatch,
  findAddressMatches,
  normalizeAddress,
  verdictFor,
  type AddressCandidate,
} from '../lib/addressMatch';

// fix-333 — warn before someone creates a project that already exists.
//
// ★★ THE INCIDENT THESE TESTS EXIST FOR. On 2026-08-14 at 22:38 Shire created
// `3623 Othello Ave SW`. The project already existed as `3623 SW Othello St`,
// filed 9 June, with its `[Redesign 1]` beside it. The copy carried the SAME GO
// date and the SAME THREE PERMIT NUMBERS — 3043214-LU, 7100542-CN, 7100543-DM.
// He backfilled it for three minutes before anyone noticed.
//
// ★ The bug was A PERSON SEEING NO WARNING, so the tests are a person seeing
// one. The normalisation is asserted too, but only where it encodes a rule that
// was measured rather than guessed.

const T = 'test-tenant-uuid';

// --------------------------------------------------------------- fixtures --

const OTHELLO_ID = '5b9f1f24-c036-4714-bece-3f69c6011370';
const OTHELLO_REDESIGN_ID = '3ec8bc01-01fa-42df-b5d8-28cb2fb3c608';

/** The production rows as they actually stand, addresses and all. */
const PROJECT_ROWS = [
  {
    id: OTHELLO_ID,
    address: '3623 SW Othello St',
    go_date: '2025-07-11',
    archived: false,
    redesign_of_project_id: null,
  },
  {
    id: OTHELLO_REDESIGN_ID,
    address: '3623 SW Othello St [Redesign 1]',
    go_date: '2026-06-25',
    archived: false,
    redesign_of_project_id: OTHELLO_ID,
  },
  {
    id: 'p-5947',
    address: '5947 32nd Ave SW',
    go_date: '2026-01-05',
    archived: false,
    redesign_of_project_id: null,
  },
  {
    id: 'p-7708',
    address: '7708 131st Ave NE',
    go_date: '2026-02-02',
    archived: false,
    redesign_of_project_id: null,
  },
  {
    id: 'p-arch',
    address: '900 Retired Ave N',
    go_date: '2024-01-01',
    archived: true,
    redesign_of_project_id: null,
  },
];

const PERMIT_ROWS = [
  { project_id: OTHELLO_ID, num: '3043214-LU' },
  { project_id: OTHELLO_ID, num: '7100542-CN' },
  { project_id: OTHELLO_ID, num: '7100543-DM' },
];

const supa = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  permits: [] as Record<string, unknown>[],
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: { data: [] as unknown, error: null as Error | null },
}));

/** A chainable PostgREST stand-in: `.select().order().range()` and
 *  `.select().not().range()` both resolve to the table's rows. */
function table(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(res);
      }
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      supa.rpc.push({ name, args });
      return Promise.resolve(supa.rpcResult);
    },
    from: (t: string) => {
      if (t === 'projects') return table(supa.projects);
      if (t === 'permits') return table(supa.permits);
      // The create hook inserts the wizard note; anything else is inert.
      return {
        insert: () => Promise.resolve({ error: null }),
        ...(table([]) as object),
      };
    },
  },
}));

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [{ name: 'Building Permit', is_builtin: true, notes: null }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { id: 'da-1', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [], schematics: [],
    activeMemberNames: ['Trevor'],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [], subtasks: [], byScope: new Map(),
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import NewProjectWizard from '../components/NewProjectWizard';
import { makeEmptyWizardState } from '../components/wizard/wizardState';

function renderWizard(initialState?: import('../components/wizard/wizardState').WizardState) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <NewProjectWizard open onClose={vi.fn()} initialState={initialState} />,
    { wrapper },
  );
}

/**
 * ★ Type an address and wait for the check to SETTLE — never for a duration.
 *
 * fix-300b banned guessed sleeps and its ratchet enforces it, for exactly the
 * reason that bites here: a sleep guarding "no warning appeared" passes when the
 * debounce simply has not fired, which is a silent false pass on the assertions
 * this ticket cares most about. The slot always renders and carries the check's
 * state, so this waits on something that genuinely becomes true.
 */
async function typeAddress(value: string) {
  fireEvent.change(screen.getByTestId('wizard-address'), { target: { value } });
  await settleCheck(value);
}

/** Wait until the slot says it has checked exactly this address. */
async function settleCheck(address: string) {
  await waitFor(() =>
    expect(
      screen.getByTestId('wizard-duplicate-slot').dataset.checked,
    ).toBe(address),
  );
}

beforeEach(() => {
  supa.projects = [...PROJECT_ROWS];
  supa.permits = [...PERMIT_ROWS];
  supa.rpc = [];
  supa.rpcResult = {
    data: [{ project_id: 'new-project-id', permit_ids: [1], conflict: false }],
    error: null,
  };
  navigate.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ===========================================================================
// ★★ THE REGRESSION TEST FOR THE INCIDENT
// ===========================================================================

describe('fix-333 ★★ REGRESSION — the 2026-08-14 Othello duplicate', () => {
  // ★★ THIS IS THE TEST THE TICKET EXISTS FOR. `3623 SW Othello St` is in the
  // tool; somebody types `3623 Othello Ave SW`. Before fix-333 they saw
  // nothing, created it, and backfilled it for three minutes.
  it('★★ typing `3623 Othello Ave SW` warns and NAMES the existing project', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');

    const warning = await screen.findByTestId('wizard-duplicate-warning');
    expect(warning.dataset.verdict).toBe('duplicate');
    expect(warning).toHaveTextContent('This address may already exist');

    const sameLot = screen.getByTestId('wizard-duplicate-same-lot');
    expect(sameLot).toHaveTextContent('Same lot, spelled differently');
    expect(
      within(sameLot).getByTestId(`wizard-duplicate-match-${OTHELLO_ID}`),
    ).toHaveTextContent('3623 SW Othello St');
  });

  // ★ The three identical permit numbers are what made it unmissable in
  // hindsight. Showing them is the difference between "some project" and "THAT
  // project".
  it('★ shows the permit numbers the copy would have duplicated', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    const permits = await screen.findByTestId(
      `wizard-duplicate-permits-${OTHELLO_ID}`,
    );
    expect(permits).toHaveTextContent('3043214-LU');
    expect(permits).toHaveTextContent('7100542-CN');
    expect(permits).toHaveTextContent('7100543-DM');
  });

  it('★ shows the GO date, which was also identical', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    expect(
      await screen.findByTestId(`wizard-duplicate-match-${OTHELLO_ID}`),
    ).toHaveTextContent('2025-07-11');
  });

  // ★ Somebody who realises "that's already here" needs to go and look — and
  // their half-typed wizard has to survive the trip.
  it('★ offers the existing project in a NEW TAB, so the form survives', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    const link = await screen.findByTestId(`wizard-duplicate-open-${OTHELLO_ID}`);
    expect(link.getAttribute('href')).toBe(`/project/${OTHELLO_ID}`);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  // The redesign shares the parent's key, so it surfaces too — which is right:
  // both are "already here".
  it('lists the parent AND its redesign, oldest-recognisable first', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    const sameLot = await screen.findByTestId('wizard-duplicate-same-lot');
    expect(
      within(sameLot).getByTestId(`wizard-duplicate-match-${OTHELLO_REDESIGN_ID}`),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// ★ It warns. It never blocks.
// ===========================================================================

describe('fix-333 ★ the warning never blocks', () => {
  async function fillAndSubmit() {
    fireEvent.change(screen.getByTestId('wizard-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('wizard-units'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByTestId('wizard-next')); // → 2
    fireEvent.click(screen.getByTestId('wizard-next')); // → 3
    fireEvent.click(screen.getByTestId('wizard-next')); // → 4
    fireEvent.click(screen.getByTestId('wizard-save'));
  }

  // ★★ THE PROJECT IS CREATED AFTER CONFIRMING. One deliberate acknowledgement,
  // inline — not a second modal, and not a wall.
  it('★★ creates the project once the person confirms', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    fireEvent.click(await screen.findByTestId('wizard-duplicate-acknowledge'));
    expect(screen.getByTestId('wizard-duplicate-acknowledged')).toBeInTheDocument();

    await fillAndSubmit();
    await waitFor(() =>
      expect(
        supa.rpc.some((c) => c.name === 'bp_create_project_with_permits'),
      ).toBe(true),
    );
  });

  // ★ The submit backstop — the address can change after the banner settled.
  // It sends them to the warning ONCE; it does not refuse.
  it('★ un-acknowledged submit returns to Step 1 with the warning, and does not write', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    await screen.findByTestId('wizard-duplicate-warning');

    await fillAndSubmit();
    expect(
      supa.rpc.some((c) => c.name === 'bp_create_project_with_permits'),
    ).toBe(false);
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-validation')).toHaveTextContent(
      /already exists/i,
    );
    // ...and then confirming lets the very next submit straight through.
    fireEvent.click(screen.getByTestId('wizard-duplicate-acknowledge'));
    await fillAndSubmit();
    await waitFor(() =>
      expect(
        supa.rpc.some((c) => c.name === 'bp_create_project_with_permits'),
      ).toBe(true),
    );
  });

  // ★★ Acknowledging ONE address must not license a DIFFERENT one. This is the
  // property that matters: the confirmation is bound to the address key it was
  // given for, so editing to another duplicate re-arms the warning and the
  // submit backstop bites again.
  it('★★ acknowledging one address does not license a different duplicate', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    fireEvent.click(await screen.findByTestId('wizard-duplicate-acknowledge'));
    expect(screen.getByTestId('wizard-duplicate-acknowledged')).toBeInTheDocument();

    // A different lot that is ALSO already in the tool.
    await typeAddress('900 Retired Ave N');
    expect(screen.getByTestId('wizard-duplicate-warning').dataset.verdict).toBe(
      'duplicate',
    );
    expect(screen.getByTestId('wizard-duplicate-acknowledge')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-duplicate-acknowledged')).toBeNull();
  });

  // ★ …and coming BACK to an address already confirmed does not ask again.
  // The acknowledgement is bound to the address, not to a visit, so wandering
  // off and returning is not treated as a fresh claim. Asked once, answered
  // once — which is what "one deliberate confirmation" means.
  it('★ returning to an already-confirmed address does not ask twice', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    fireEvent.click(await screen.findByTestId('wizard-duplicate-acknowledge'));
    await typeAddress('3623 Othello Ave SE');
    await typeAddress('3623 Othello Ave SW');
    expect(screen.getByTestId('wizard-duplicate-acknowledged')).toBeInTheDocument();
  });

  // ...but a trailing space is not a different address.
  it('a trailing space does not re-arm it', async () => {
    renderWizard();
    await typeAddress('3623 Othello Ave SW');
    fireEvent.click(await screen.findByTestId('wizard-duplicate-acknowledge'));
    await typeAddress('3623 Othello Ave SW ');
    expect(screen.getByTestId('wizard-duplicate-acknowledged')).toBeInTheDocument();
  });
});

// ===========================================================================
// ★★ Neighbours must stay creatable
// ===========================================================================

describe('fix-333 ★★ genuine neighbours are not fought with', () => {
  // ★★ THE BRIEF IS EXPLICIT: a same-lot CLAIM here would be wrong. These are
  // different lots — Bobby's draw schedule carries both shapes — and merging
  // them would be worse than the bug being fixed.
  it('★★ `5947 32nd Ave S` does NOT claim same lot as `5947 32nd Ave SW`', async () => {
    renderWizard();
    await typeAddress('5947 32nd Ave S');
    const warning = await screen.findByTestId('wizard-duplicate-warning');
    expect(warning.dataset.verdict).toBe('nearby');
    // A hint is fine...
    expect(screen.getByTestId('wizard-duplicate-nearby')).toHaveTextContent(
      'Similar address nearby',
    );
    // ...a same-lot claim is not.
    expect(screen.queryByTestId('wizard-duplicate-same-lot')).toBeNull();
    expect(warning).not.toHaveTextContent('Same lot, spelled differently');
    // And nothing to acknowledge — it is not a challenge.
    expect(screen.queryByTestId('wizard-duplicate-acknowledge')).toBeNull();
  });

  // ★ The house next door. No warning at all — this is routine.
  it('★ `5949 32nd Ave SW` beside `5947 32nd Ave SW` is unobstructed', async () => {
    renderWizard();
    await typeAddress('5949 32nd Ave SW');
    expect(screen.queryByTestId('wizard-duplicate-warning')).toBeNull();
  });

  // Same house number, different street. Not a match at all.
  it('`7708 44th Ave NE` does not match `7708 131st Ave NE`', async () => {
    renderWizard();
    await typeAddress('7708 44th Ave NE');
    expect(screen.queryByTestId('wizard-duplicate-warning')).toBeNull();
  });

  it('an address matching nothing produces no warning', async () => {
    renderWizard();
    await typeAddress('4242 Nowhere Blvd NW');
    expect(screen.queryByTestId('wizard-duplicate-warning')).toBeNull();
  });

  // ★ "No flicker": a half-typed address must not flash a verdict it is about
  // to change its mind about.
  it('★ nothing renders while the debounce is still settling', () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('wizard-address'), {
      target: { value: '3623 Othello Ave SW' },
    });
    // Synchronously after the keystroke — the debounce has not fired.
    expect(screen.queryByTestId('wizard-duplicate-warning')).toBeNull();
  });
});

// ===========================================================================
// ★ Redesigns
// ===========================================================================

describe('fix-333 ★ a redesign of its parent reads as expected', () => {
  // ★ Redesigns DO come through this wizard — makeRedesignWizardState seeds it
  // from Project Overview's "Spawn Redesign", address suffixed `[Redesign N]`
  // and `redesign_of_project_id` set. So the branch is real, not speculative.
  function redesignSeed() {
    return {
      ...makeEmptyWizardState(),
      address: '3623 SW Othello St [Redesign 2]',
      juris: 'Seattle',
      redesign_of_project_id: OTHELLO_ID,
      redesign_of_project_address: '3623 SW Othello St',
    };
  }

  it('★ says "expected", not "duplicate"', async () => {
    renderWizard(redesignSeed());
    await settleCheck('3623 SW Othello St [Redesign 2]');
    const warning = await screen.findByTestId('wizard-duplicate-warning');
    expect(warning.dataset.verdict).toBe('expected-redesign');
    expect(warning).toHaveTextContent('Redesign of an existing project');
    expect(warning).toHaveTextContent('This is expected');
  });

  it('★ and asks for no acknowledgement, because there is nothing to confirm', async () => {
    renderWizard(redesignSeed());
    await settleCheck('3623 SW Othello St [Redesign 2]');
    await screen.findByTestId('wizard-duplicate-warning');
    expect(screen.queryByTestId('wizard-duplicate-acknowledge')).toBeNull();
  });

  it('names the family rather than accusing it', async () => {
    renderWizard(redesignSeed());
    await settleCheck('3623 SW Othello St [Redesign 2]');
    expect(
      await screen.findByTestId('wizard-duplicate-same-lot'),
    ).toHaveTextContent('Its existing family');
  });

  // ★★ THE HOLE THE OBVIOUS VERSION LEAVES. "In redesign mode → everything is
  // expected" would wave through somebody who opened a redesign of A and then
  // hand-typed B's address. Expectedness is anchored to the PARENT'S key.
  it('★★ a redesign hand-edited onto a DIFFERENT project still warns', async () => {
    renderWizard({
      ...redesignSeed(),
      address: '5947 32nd Ave SW [Redesign 2]',
    });
    await settleCheck('5947 32nd Ave SW [Redesign 2]');
    const warning = await screen.findByTestId('wizard-duplicate-warning');
    expect(warning.dataset.verdict).toBe('duplicate');
  });
});

// ===========================================================================
// ★ The 1000-row cap
// ===========================================================================

describe('fix-333 ★ a check that cannot see everything says so', () => {
  // ★★ fix-189's trap: an un-ranged PostgREST select silently stops at 1000
  // rows. A LIST that shortens is bad; a DUPLICATE CHECK that shortens reports
  // "no match" and is believed. So truncation is detected and surfaced.
  it('★★ says the check is incomplete rather than implying "clear"', async () => {
    const { ADDRESS_INDEX_LIMIT } = await import('../hooks/useProjectAddressIndex');
    supa.projects = Array.from({ length: ADDRESS_INDEX_LIMIT + 1 }, (_, i) => ({
      id: `p-${i}`,
      address: `${1000 + i} Filler St N`,
      go_date: null,
      archived: false,
      redesign_of_project_id: null,
    }));
    renderWizard();
    await typeAddress('4242 Nowhere Blvd NW');
    expect(
      await screen.findByTestId('wizard-duplicate-truncated'),
    ).toHaveTextContent(/not been fully checked/i);
  });

  it('the index asks for one row more than the window, so truncation is visible', async () => {
    const src = (await import('../hooks/useProjectAddressIndex.ts?raw')).default as string;
    expect(src).toMatch(/\.range\(0, ADDRESS_INDEX_LIMIT\)/);
    expect(src).toMatch(/rows\.length > ADDRESS_INDEX_LIMIT/);
  });

  // ★ An ARCHIVED duplicate is still a duplicate. useProjects filters them out,
  // which is why this check does not reuse it.
  it('★ sees archived projects too', async () => {
    renderWizard();
    await typeAddress('900 Retired Ave N');
    const warning = await screen.findByTestId('wizard-duplicate-warning');
    expect(warning.dataset.verdict).toBe('duplicate');
    expect(screen.getByTestId('wizard-duplicate-archived-p-arch')).toHaveTextContent(
      'Archived',
    );
  });
});

// ===========================================================================
// The match key — the parts that were measured
// ===========================================================================

describe('fix-333: the match key', () => {
  // ★★ THE MEASURED TABLE FROM THE BRIEF, pinned. Every simpler approach fails
  // on the real pair; only "number + street + directional, street type dropped"
  // succeeds.
  it('★★ the Othello pair collapses to one key', () => {
    expect(normalizeAddress('3623 Othello Ave SW').key).toBe('3623|othello|sw');
    expect(normalizeAddress('3623 SW Othello St').key).toBe('3623|othello|sw');
  });

  it('★ the street TYPE is what had to be dropped — Ave vs St', () => {
    // Token-sort alone still fails, because `ave` !== `st`.
    const withType = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).sort().join(' ');
    expect(withType('3623 Othello Ave SW')).not.toBe(withType('3623 SW Othello St'));
    // Dropping it is what makes them one address.
    expect(normalizeAddress('3623 Othello Ave SW').key).toBe(
      normalizeAddress('3623 SW Othello St').key,
    );
  });

  // ★★ AND THE DIRECTIONAL STAYS IN. Dropping it "to be safer" merges two real
  // lots, which is worse than the bug.
  it('★★ the directional stays in the key', () => {
    expect(normalizeAddress('5947 32nd Ave S').key).not.toBe(
      normalizeAddress('5947 32nd Ave SW').key,
    );
    expect(classifyMatch(
      normalizeAddress('5947 32nd Ave S'),
      normalizeAddress('5947 32nd Ave SW'),
    )).toBe('nearby');
  });

  it('word order stops mattering', () => {
    expect(normalizeAddress('3623 SW Othello St').key).toBe(
      normalizeAddress('3623 Othello St SW').key,
    );
  });

  it('★ the draw schedule\'s trailing free text is cut', () => {
    expect(normalizeAddress('7708 131st Ave NE                    SFR').key).toBe(
      normalizeAddress('7708 131st Ave NE').key,
    );
    expect(normalizeAddress('8542 Interlake Ave N   3 SFR').key).toBe(
      normalizeAddress('8542 Interlake Ave N').key,
    );
    expect(normalizeAddress('12238 4th Ave NW    Redesign').key).toBe(
      normalizeAddress('12238 4th Ave NW').key,
    );
  });

  // ★ The wizard's own placeholder is "123 Maple St, Seattle WA". Somebody
  // following it types a city no stored address has. Measured: not one of the
  // 146 production addresses contains a comma, so cutting there is free.
  it('★ a typed city/state does not break the match', () => {
    expect(normalizeAddress('123 Maple St, Seattle WA').key).toBe(
      normalizeAddress('123 Maple St').key,
    );
  });

  it('the `[Redesign N]` suffix is stripped and recorded', () => {
    const k = normalizeAddress('3623 SW Othello St [Redesign 1]');
    expect(k.key).toBe('3623|othello|sw');
    expect(k.hadRedesignSuffix).toBe(true);
    expect(k.redesignIndex).toBe(1);
  });

  it('case and punctuation do not matter', () => {
    expect(normalizeAddress('4113 SW Ida ST').key).toBe(
      normalizeAddress('4113 sw ida st.').key,
    );
  });

  // ★ An empty or punctuation-only address matches NOTHING. An empty key
  // matching every other empty key would warn on every half-typed address.
  it('★ an empty address matches nothing', () => {
    expect(normalizeAddress('').empty).toBe(true);
    expect(normalizeAddress('   ,,  ').empty).toBe(true);
    expect(classifyMatch(normalizeAddress(''), normalizeAddress(''))).toBeNull();
  });

  // ★ Different house number on the same street is NOT flagged. Production
  // holds a dozen such pairs and a warning that fires constantly gets clicked
  // through without reading.
  it('★ neighbours on the same street are not matches', () => {
    for (const [a, b] of [
      ['5949 32nd Ave SW', '5947 32nd Ave SW'],
      ['4222 Latona Ave NE', '4228 Latona Ave NE'],
      ['2039 N 78th St', '2043 N 78th St'],
      ['1515 Martin Luther King Jr Way', '1524 Martin Luther King Jr Way'],
    ]) {
      expect(
        classifyMatch(normalizeAddress(a!), normalizeAddress(b!)),
        `${a} vs ${b}`,
      ).toBeNull();
    }
  });

  it('a multi-word street survives having its type removed', () => {
    // `Way` is the street type here; the name is what is left.
    expect(normalizeAddress('1515 Martin Luther King Jr Way').key).toBe(
      '1515|jr king luther martin|',
    );
  });

  it('an address with no street type at all still keys', () => {
    expect(normalizeAddress('4040 E Via Estrella').key).toBe('4040|estrella via|e');
  });
});

describe('fix-333: the verdict', () => {
  const candidates: AddressCandidate[] = [
    { id: 'a', address: '3623 SW Othello St' },
    { id: 'b', address: '3623 SW Othello St [Redesign 1]', redesign_of_project_id: 'a' },
    { id: 'c', address: '5947 32nd Ave SW' },
  ];

  it('a plain project over a plain project is a duplicate', () => {
    const m = findAddressMatches({ address: '3623 Othello Ave SW', candidates });
    expect(verdictFor(m)).toBe('duplicate');
  });

  it('a redesign over its parent is expected', () => {
    const m = findAddressMatches({
      address: '3623 SW Othello St [Redesign 2]',
      candidates,
      redesignOfProjectId: 'a',
    });
    expect(verdictFor(m)).toBe('expected-redesign');
  });

  it('a different directional is nearby, never a duplicate', () => {
    const m = findAddressMatches({ address: '5947 32nd Ave S', candidates });
    expect(verdictFor(m)).toBe('nearby');
  });

  it('nothing matching is clear', () => {
    const m = findAddressMatches({ address: '1 Nowhere Rd', candidates });
    expect(verdictFor(m)).toBe('clear');
    expect(m).toEqual([]);
  });

  it('★ same-lot matches rank above nearby ones', () => {
    const mixed: AddressCandidate[] = [
      { id: 'near', address: '3623 Othello Ave SE' },
      { id: 'same', address: '3623 SW Othello St' },
    ];
    const m = findAddressMatches({ address: '3623 Othello Ave SW', candidates: mixed });
    expect(m.map((x) => x.kind)).toEqual(['same-lot', 'nearby']);
  });
});
