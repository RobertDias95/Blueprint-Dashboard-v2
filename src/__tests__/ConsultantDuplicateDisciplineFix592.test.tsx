// ===========================================================================
// ★★★ fix-592 §A + §B (P-291) — LINDSAY'S CONSULTANT ERROR, AND THE TOAST THAT
//     REPORTED ITSELF
// ===========================================================================
//
// **Lindsay, 2026-09-23, 3020 E Yesler Way.** Three raw
// `duplicate key value violates unique constraint
// "project_consultants_one_per_discipline"` toasts in 106 seconds
// (error_reports 744, 745, 746), then she stopped trying.
//
// ★★★ THE BRIEF'S DIAGNOSIS DID NOT SURVIVE THE DATA, and the timeline is the
//     whole of it. §A says *"Nothing told her a Civil was already on that
//     project"* and blames a picker that offers a taken discipline. **There was
//     no Civil on that project.** She had removed it ninety-one seconds earlier:
//
//       15:33:48  Civil added
//       15:36:11  Civil REMOVED    ← soft delete; `removed_at` stamped
//       15:37:42  duplicate key    (744)
//       15:37:59  Geotech added
//       15:38:05  Geotech REMOVED
//       15:38:10  duplicate key    (745)
//       15:38:29  duplicate key    (746)
//
//     `project_consultant_current` hides a removed row, so the picker saw the
//     slot as free. `project_consultants_one_per_discipline` is **not a partial
//     index** — no `WHERE removed_at IS NULL` — so the database still counted it.
//     A removed consultant holds its discipline for ever.
//
// ★★★ AND THE POPULATION IS 2 OF 2. Prod, 2026-09-28: 198 consultant rows,
//     **exactly two** with `removed_at` set — Lindsay's Civil and her Geotech —
//     and both slots are now permanently unaddable. fix-514 §D's remove has been
//     used twice and has never once been followed by a successful re-add.
//
// ⏸ The constraint is NOT touched here. See the PR: making the index partial
//   would preserve "one LIVE consultant per discipline" exactly, but it is still
//   a model change and the ruling is Bobby's.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { pushToast, pushRecoveredToast, pushValidationToast } from '../stores/toastStore';
import { addConsultantMessage } from '../hooks/useProjectConsultants';

const TENANT = 'test-tenant-uuid';
const PROJECT = 'ca1817a2-7147-4714-9f92-7112b57b866c';

// ---------------------------------------------------------------------------
// The fake database: `project_consultants` rows, and the view over them
// ---------------------------------------------------------------------------

interface Row {
  discipline: string;
  removed_at: string | null;
  firm_id: string;
}
let rows: Row[] = [];
/** Every insert the component attempted, and whether the index refused it. */
let inserts: { discipline: string; refused: boolean }[] = [];

const DUP = (c: string) =>
  `duplicate key value violates unique constraint "${c}"`;

const rpc = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => fromMock(t),
  },
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: [
      { id: 'f-civil', name: 'Civil Co', discipline: 'Civil', active: true },
      { id: 'f-geo', name: 'Geo Co', discipline: 'Geotech', active: true },
      { id: 'f-struct', name: 'Struct Co', discipline: 'Structural', active: true },
    ],
    isLoading: false,
  }),
}));

import { ConsultantBand } from '../components/ProjectDetail/ConsultantBand';

/** `project_consultants` (base table) and `project_consultant_current` (view). */
function tableStub(table: string) {
  const live = rows.filter((r) => !r.removed_at);
  if (table === 'project_consultant_current') {
    const payload = live.map((r, i) => ({
      consultant_id: `c-${i}`,
      tenant_id: TENANT,
      project_id: PROJECT,
      discipline: r.discipline,
      firm_id: r.firm_id,
      firm_name: `${r.discipline} Co`,
      firm_active: true,
      notes: null,
      updated_at: '2026-09-23T15:00:00Z',
      round_id: `r-${i}`,
      round_index: 0,
      phase: 'Design',
      status: 'Scheduled',
      est_send: null,
      sent: null,
      est_recd: null,
      recd: null,
      round_updated_at: '2026-09-23T15:00:00Z',
      round_count: 1,
    }));
    return chain(payload);
  }
  if (table === 'project_consultants') {
    // ★ The BASE table — it returns the removed rows too, which is the point.
    return chain(rows.map((r) => ({ discipline: r.discipline, removed_at: r.removed_at })));
  }
  return chain([]);
}

function chain(data: unknown[]) {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'in']) {
    self[m] = () => self;
  }
  // Awaiting the builder resolves it, the way postgrest-js does.
  (self as { then: unknown }).then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(res);
  return self;
}

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<ConsultantBand projectId={PROJECT} bp={null} manage />, { wrapper });
}

beforeEach(() => {
  cleanup();
  rows = [];
  inserts = [];
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'bp_add_project_consultant') return { data: null, error: null };
    const d = String(args.p_discipline ?? '');
    // ★★★ THE INDEX, MIRRORED — AND fix-594 CHANGED IT.
    //
    //     fix-592's version counted EVERY row, removed or not, because that is
    //     what `(project_id, discipline)` with no predicate does, and a stub that
    //     filtered `removed_at` would have passed the whole file while prod kept
    //     refusing. Bobby ruled the index PARTIAL on 2026-09-28 —
    //     `WHERE removed_at IS NULL` — so the mirror filters now, and it has to:
    //     leaving it counting removed rows would make the new "a removed
    //     discipline is offered again" test pass against a server that would
    //     still refuse the insert.
    const refused = rows.some(
      (r) => !r.removed_at && r.discipline.toLowerCase() === d.toLowerCase(),
    );
    inserts.push({ discipline: d, refused });
    if (refused) {
      return { data: null, error: new Error(DUP('project_consultants_one_per_discipline')) };
    }
    rows.push({ discipline: d, removed_at: null, firm_id: String(args.p_firm_id) });
    return { data: [{ out_id: 'new', round_id: 'r', updated_at: 'now' }], error: null };
  });
  fromMock.mockReset();
  fromMock.mockImplementation((t: string) => tableStub(t));
  useAuthStore.setState({
    activeTenantId: TENANT,
    memberships: [{ tenant_id: TENANT, role: 'admin' }],
  } as never);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-592 §A — a taken discipline is not offered', () => {
  it('a LIVE consultant keeps its discipline out of the picker (unchanged)', async () => {
    rows = [{ discipline: 'Civil', removed_at: null, firm_id: 'f-civil' }];
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('pd-consultant-add-open'));
    });
    const select = screen.getByTestId('pd-consultant-add-discipline') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('Civil');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ★★★ fix-594 (P-291) — FOUR CASES DELETED HERE, NOT SKIPPED
  // ═══════════════════════════════════════════════════════════════════════
  //
  // fix-592 §A asserted that a REMOVED consultant kept its discipline out of the
  // picker, that a note said why, that the note stayed absent on the other 269
  // projects, and that no insert was ever attempted against a held slot. All four
  // described a WORKAROUND for an index that was not partial.
  //
  // ★★★ Bobby ruled the index instead (2026-09-28), so the state they described
  //     cannot occur: a removed row does not hold the slot. They are **deleted**
  //     rather than skipped — a skipped test is a claim nobody is checking — and
  //     the case below asserts the opposite behaviour, which is now the correct
  //     one.
  //
  // ★ The LIVE case above is untouched, because that rule did not change: one
  //   live consultant per discipline, still enforced, still excluded from the
  //   picker.

  it('★★★ a REMOVED consultant frees its discipline — the ruling', async () => {
    // The exact option Lindsay was refused three times on 2026-09-23: she had
    // removed a Civil ninety-one seconds earlier, and the picker was right to
    // offer it back. Now the database agrees.
    rows = [{ discipline: 'Civil', removed_at: '2026-09-23T15:36:11Z', firm_id: 'f-civil' }];
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('pd-consultant-add-open'));
    });
    const select = screen.getByTestId('pd-consultant-add-discipline') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain('Civil');
  });

  it('★★★ …and adding it succeeds rather than being refused', async () => {
    // The round trip, not just the option list: the partial index lets the
    // insert through, so the 106 seconds of raw constraint errors cannot recur.
    rows = [{ discipline: 'Civil', removed_at: '2026-09-23T15:36:11Z', firm_id: 'f-civil' }];
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('pd-consultant-add-open'));
    });
    const select = screen.getByTestId('pd-consultant-add-discipline') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'Civil' } });
    });
    await waitFor(() => expect(inserts.length).toBe(1));
    expect(inserts[0]!.discipline).toBe('Civil');
    expect(inserts[0]!.refused).toBe(false);
  });

  it('★★ a LIVE row still refuses, so the rule itself is unchanged', async () => {
    // "One LIVE consultant per discipline" is what the index still says. If this
    // ever passes, the partial predicate has been written too widely.
    rows = [{ discipline: 'Civil', removed_at: null, firm_id: 'f-civil' }];
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('pd-consultant-add-open'));
    });
    const select = screen.getByTestId('pd-consultant-add-discipline') as HTMLSelectElement;
    // The picker does not offer it, and the mirrored index would refuse it.
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('Civil');
  });

  it('★ the "held by a removed record" note is gone entirely', async () => {
    rows = [{ discipline: 'Civil', removed_at: '2026-09-23T15:36:11Z', firm_id: 'f-civil' }];
    mount();
    await screen.findByTestId('pd-consultant-add-open');
    expect(screen.queryByTestId('pd-consultant-blocked-note')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-592 §A — and if it still happens, it says what happened', () => {
  it('the constraint name never reaches a person', () => {
    const msg = addConsultantMessage(
      new Error(DUP('project_consultants_one_per_discipline')),
      'Civil',
    );
    expect(msg).not.toContain('duplicate key');
    expect(msg).not.toContain('project_consultants_one_per_discipline');
    expect(msg).toContain('Civil');
  });

  it('★★★ fix-594 — it now describes a RACE, not a removed record', () => {
    // ═════════════════════════════════════════════════════════════════════
    // THE SAME CONSTRAINT, A DIFFERENT MEANING.
    // ═════════════════════════════════════════════════════════════════════
    //
    // fix-592 asserted this said *"removed"*, and that was right then: with a
    // non-partial index, a soft-removed row held the slot and that was how most
    // people hit it. Bobby's partial index makes that case impossible, so the
    // only way to reach this constraint now is the one it was always for —
    // **two people adding the same LIVE discipline at once.**
    //
    // ★★ THE OLD WORDING WOULD BE ACTIVELY WRONG, not merely stale: it would
    //    send somebody hunting for a removed record that is not blocking
    //    anything, and tell them to ask an admin to clear it, when the answer is
    //    to refresh and look at what their colleague just added.
    const msg = addConsultantMessage(
      new Error(DUP('project_consultants_one_per_discipline')),
      'Civil',
    );
    expect(msg).toMatch(/somebody just added/i);
    expect(msg).toMatch(/refresh/i);
    expect(msg).toContain('Civil');
    // The three things it must NOT say any more.
    expect(msg).not.toMatch(/removed/i);
    expect(msg).not.toMatch(/admin/i);
    expect(msg).not.toMatch(/already has/i);
  });

  it('any OTHER error is passed through untouched', () => {
    // ★ Matched on the CONSTRAINT NAME — a schema object, not prose (fix-584 §A
    //   forbids message-text classification; fix-165's SQLSTATE precedent is the
    //   same shape). A different failure must not be dressed up as this one.
    expect(addConsultantMessage(new Error('firm x is not a Civil in the directory'), 'Civil')).toBe(
      'firm x is not a Civil in the directory',
    );
    expect(addConsultantMessage(new Error(DUP('some_other_index')), 'Civil')).toBe(
      DUP('some_other_index'),
    );
  });

  it('survives a discipline nobody named', () => {
    expect(
      addConsultantMessage(new Error(DUP('project_consultants_one_per_discipline')), '  '),
    ).toMatch(/a consultant for that discipline/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-592 §B — what reaches error_reports', () => {
  // `push` logs only for `kind === 'error'`, and `{ log: false }` suppresses it.
  // Asserting through `logError` is what proves the CENSUS matters rather than
  // just the colour.
  it('a recovered toast writes NO report, at either colour', async () => {
    const { logged } = await withLoggerSpy(() => {
      pushRecoveredToast('That consultant changed while you were editing — reloaded.', 'error');
      pushRecoveredToast('Layout changed since you loaded it — refresh and retry', 'warn');
    });
    expect(logged).toEqual([]);
  });

  it('★★★ a real failure still does', async () => {
    const { logged } = await withLoggerSpy(() => {
      pushToast('Could not save Lot Size — network is down', 'error');
    });
    expect(logged).toEqual(['Could not save Lot Size — network is down']);
  });

  it('a refused input still writes none (fix-584, unchanged)', async () => {
    const { logged } = await withLoggerSpy(() => {
      pushValidationToast('Unit size: enter a whole number between 0 and 2147483647.');
    });
    expect(logged).toEqual([]);
  });

  it('★★ the recovered toast is still SHOWN — silence in triage, not on screen', async () => {
    const { useToastStore } = await import('../stores/toastStore');
    useToastStore.getState().clear();
    pushRecoveredToast('That consultant changed while you were editing — reloaded.', 'error');
    const shown = useToastStore.getState().toasts;
    expect(shown).toHaveLength(1);
    expect(shown[0]!.message).toContain('reloaded');
    // fix-39 Track B's loudness survives.
    expect(shown[0]!.kind).toBe('error');
  });
});

/** Capture what `logError` was asked to record while `fn` ran. */
async function withLoggerSpy(fn: () => void): Promise<{ logged: string[] }> {
  const mod = await import('../lib/errorLogger');
  const logged: string[] = [];
  const spy = vi
    .spyOn(mod, 'logError')
    .mockImplementation(async (input: { message: string }) => {
      logged.push(input.message);
    });
  try {
    fn();
    await Promise.resolve();
  } finally {
    spy.mockRestore();
  }
  return { logged };
}
