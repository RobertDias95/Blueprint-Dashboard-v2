// ===========================================================================
// ★★★ fix-588 (P-288) — A TAG THAT SAYS IT SAVED
// ===========================================================================
//
// Bobby, 2026-09-16, 403 W Dravus St: added **HVL** in Project Details, pressed
// Save, read *"Project details saved."* The tag is not in the row.
//
// ★★★ §1 INSTRUMENTED FIRST, AND THE CLIENT IS CLEAN AT EVERY HOP:
//
//       HOP 1  write(next)    ["ECA","HVL"]   ✔ matched by IDENTITY (`value={t}`)
//       HOP 2  commit()       proceeds        ✔ not swallowed as a no-op
//       HOP 3  draft entry    KEPT            ✔ both chips render
//       HOP 4  projectPatch   {"project_tags":["ECA","HVL"]}  ✔
//       HOP 5  the RPC        ✘ **DROPPED HERE**
//
//     `bp_update_project_with_permits` applies its jsonb patch through an
//     explicit 27-column `CASE WHEN v_patch ? 'col' … ELSE col END` list, and
//     `project_tags` is not in it — nor are `closing_date`, `num_lots` or
//     `is_corner_lot`. The UPDATE still runs, every column writes itself to
//     itself, `updated_at` bumps from the trigger and the audit trigger sees
//     `'{}'` so logs nothing. **That is §0's fact A exactly.**
//
// ★★★ SO THE FAKE SERVER IN THIS FILE HAS A COLUMN LIST, and the suite runs
//     against BOTH of its settings:
//
//       `SERVER_TODAY`            — prod on the day of the report
//       `SERVER_AFTER_MIGRATION`  — prod once fix-588's staged migration runs
//
//     Every tag test asserts **the stored row**, per the brief's *"assert the
//     stored value, not the absence of a toast"* — so these tests would have
//     failed on the day Bobby's tag vanished, and they pin the migration's
//     effect rather than restating the client's intent.
//
// ⚠️ §0's FACT B DOES NOT SURVIVE THE INSTRUMENT, and the nine-option test
//    below is why. "Only ECA has ever been written" suggested the CHOICE was
//    being lost to an index seam between `options` and `addable`. It is not:
//    the select carries `value={t}` and the handler reads `e.target.value`, so
//    all nine options reach the payload correctly. The three ECA rows came
//    through the per-field blur path and the sample size was 3. Said plainly
//    rather than quietly dropped.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

const TENANT = 'test-tenant-uuid';
const DRAVUS = '65269a66-74a2-4d8b-8d1b-49a8ff799fb9';
const LOADED_AT = '2026-09-16T21:00:00Z';

/** ★ The nine live options, in `app_config.projectTagOptions` order. The four
 *  after `Short Plat` were added 2026-09-10 and NONE of them has ever been
 *  stored on any project — which is what a tag editor nobody can save looks
 *  like from the outside. */
const TAG_OPTIONS = [
  'ECA',
  'SIP',
  'TRAO',
  'LBA',
  'Short Plat',
  'HVL',
  'Through Lot',
  'Trolley Lines',
  "Tree('s)",
];

// ---------------------------------------------------------------------------
// ★★★ THE FAKE SERVER — A COLUMN LIST, WHICH IS THE WHOLE BUG
// ---------------------------------------------------------------------------

/** The columns `bp_update_project_with_permits` applies TODAY, read off the
 *  live `pg_get_functiondef` on 2026-09-16. Twenty-seven of them; the four this
 *  ticket is about are conspicuously absent. */
const SERVER_TODAY = [
  'address', 'juris', 'acq_lead', 'notes', 'archived', 'go_date', 'units',
  'zone', 'lot_width', 'lot_depth', 'lot_size_sf', 'parking_type',
  'parking_stalls', 'alley', 'product_types', 'entitlement_lead',
  'design_manager', 'construction_admin', 'builder_name', 'builder_company',
  'builder_email', 'builder_phone', 'builder_address', 'poc_name', 'poc_email',
  'is_regular_shape', 'is_backfill',
];

/** …and with the staged migration applied. */
const SERVER_AFTER_MIGRATION = [
  ...SERVER_TODAY,
  'project_tags',
  'closing_date',
  'num_lots',
  'is_corner_lot',
];

/** The row, as the database holds it. Mutated by the fake RPC. */
let stored: Record<string, unknown> = {};
/** Which columns the fake RPC applies. Set per test. */
let applied: string[] = SERVER_AFTER_MIGRATION;
let stampSeq = 0;

const atomicSave = vi.hoisted(() => vi.fn());
const updateProjectMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({})));

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: atomicSave, isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateProjectMutate, isPending: false }),
}));
vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => true }));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  readAppConfigStringArray: (_m: unknown, key: string) =>
    key === 'projectTagOptions' ? TAG_OPTIONS : [],
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

import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';

function makeProject(over: Record<string, unknown> = {}): Project {
  return {
    id: DRAVUS,
    address: '403 W Dravus St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    construction_admin: null,
    go_date: null,
    closing_date: null,
    units: 4,
    zone: 'LR1',
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    num_lots: null,
    is_corner_lot: null,
    alley: null,
    product_types: [],
    project_tags: ['ECA'],
    poc_name: null,
    poc_email: null,
    is_backfill: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: LOADED_AT,
    updated_at: LOADED_AT,
    ...over,
  } as unknown as Project;
}

/**
 * Mount the modal on the Site tab with a fake database behind Save.
 *
 * ★ The fake applies the patch through {@link applied} and then reports the row
 *   back the way `useUpdateProjectWithPermits` does — **the write and the
 *   read-back are the same row**, so a column the list ignores comes back
 *   unchanged, exactly as it did on prod.
 */
function setup(
  over: Record<string, unknown> = {},
  columns: string[] = SERVER_AFTER_MIGRATION,
) {
  applied = columns;
  const project = makeProject(over);
  stored = { ...(project as unknown as Record<string, unknown>) };
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(queryKeys.projects(TENANT), [project]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(
    <ProjectDetailsModal
      project={project}
      permits={[] as PermitWithCycles[]}
      bp={null}
      initialTab={'site' as never}
      onClose={() => {}}
    />,
    { wrapper },
  );
  return project;
}

function chips(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="pd-tag-chip-"]')).map(
    (n) => (n.getAttribute('data-testid') as string).replace('pd-tag-chip-', ''),
  );
}

async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('project-data-done'));
  });
}

function toastCalls(): [string, string][] {
  return (pushToast as unknown as { mock: { calls: [string, string][] } }).mock.calls;
}

beforeEach(() => {
  stampSeq = 0;
  atomicSave.mockReset();
  atomicSave.mockImplementation(async (input: Record<string, unknown>) => {
    const patch = (input.projectPatch ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      // ★★★ THE DEFECT, IN ONE LINE. A key the list does not know is silently
      //     skipped — the statement still runs, so `updated_at` still moves.
      if (applied.includes(key)) stored[key] = value;
    }
    stampSeq += 1;
    stored.updated_at = `2026-09-16T21:0${stampSeq}:00Z`;
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) after[key] = stored[key] ?? null;
    return {
      conflict: false,
      conflictKind: null,
      conflictId: null,
      projectUpdatedAt: stored.updated_at as string,
      permits: [],
      projectAfter: Object.keys(after).length > 0 ? after : null,
    };
  });
  updateProjectMutate.mockClear();
  (pushToast as unknown as { mockClear: () => void }).mockClear();
  useAuthStore.setState({
    activeTenantId: TENANT,
    memberships: [{ tenant_id: TENANT, role: 'admin' }],
  } as never);
});

// ===========================================================================
// §2b — ANY OF THE NINE, ON A PROJECT THAT ALREADY HAS ONE
// ===========================================================================

describe('fix-588 §2b — a tag can be added to a project that already has one', () => {
  it('★★★ THE REPORT: HVL on a project carrying ECA stores ["ECA","HVL"]', async () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: 'HVL' } });
    // HOP 3 — the draft kept it, so both chips render before Save.
    expect(chips()).toEqual(['ECA', 'HVL']);
    await pressSave();
    // ★ THE STORED ROW, not the toast and not the payload.
    expect(stored.project_tags).toEqual(['ECA', 'HVL']);
  });

  it('★★★ every one of the nine options stores THE TAG YOU CHOSE', async () => {
    // ★ This is the test that would have caught §0's fact B — and the one that
    //   kills it. An index seam between `options` and `addable` would show up
    //   as a neighbour arriving instead, and it never does.
    for (const tag of TAG_OPTIONS) {
      cleanup();
      // ★ Seed with a tag that is NOT the one under test, so every case is an
      //   ADD TO A NON-EMPTY LIST — the reported shape, not a first tag.
      const seed = tag === 'SIP' ? 'ECA' : 'SIP';
      setup({ project_tags: [seed] });
      fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: tag } });
      await pressSave();
      expect(stored.project_tags).toEqual([seed, tag]);
    }
  });

  it('★ the tag the person did NOT pick is never the one stored', async () => {
    setup({ project_tags: ['ECA'] });
    // `addable` drops ECA, so `addable[0]` is SIP while `options[0]` is ECA.
    // Picking the LAST option is the loudest possible off-by-something.
    fireEvent.change(screen.getByTestId('pd-tag-add'), {
      target: { value: "Tree('s)" },
    });
    await pressSave();
    expect(stored.project_tags).toEqual(['ECA', "Tree('s)"]);
  });
});

describe('fix-588 — removing tags, unchanged rules kept', () => {
  it('removing one of two tags leaves the other', async () => {
    setup({ project_tags: ['ECA', 'HVL'] });
    fireEvent.click(screen.getByTestId('pd-tag-remove-ECA'));
    await pressSave();
    expect(stored.project_tags).toEqual(['HVL']);
  });

  it('★ removing the LAST tag stores null, never []', async () => {
    // The existing rule: "nobody has tagged this" and "somebody removed the
    // last tag" are the same fact, and only one of them survives a round-trip.
    setup({ project_tags: ['HVL'] });
    fireEvent.click(screen.getByTestId('pd-tag-remove-HVL'));
    await pressSave();
    expect(stored.project_tags).toBeNull();
    expect(stored.project_tags).not.toEqual([]);
  });
});

// ===========================================================================
// §2a — A SAVE THAT CHANGED NOTHING MUST NOT SAY IT SAVED
// ===========================================================================

describe('fix-588 §2a — a dropped column cannot report success', () => {
  it('★★★ THE DAY OF THE REPORT: the server drops project_tags and the person is TOLD', async () => {
    // ★ The whole injury, reconstructed: the same click, against the column
    //   list prod actually had. Before this ticket the next line was
    //   "Project details saved." and the edit was gone.
    setup({ project_tags: ['ECA'] }, SERVER_TODAY);
    fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: 'HVL' } });
    await pressSave();

    expect(stored.project_tags).toEqual(['ECA']); // the drop really happened
    const calls = toastCalls();
    expect(calls.some(([, kind]) => kind === 'success')).toBe(false);
    const told = calls.find(([, kind]) => kind === 'error');
    expect(told).toBeTruthy();
    expect(told?.[0]).toContain('Project Tags');
    expect(told?.[0]).toContain('did not save');
  });

  it('★★ the dropped edit STAYS on screen, so the toast is about something you can still see', async () => {
    setup({ project_tags: ['ECA'] }, SERVER_TODAY);
    fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: 'HVL' } });
    await pressSave();
    // The chip is still there, and the modal is still dirty — Save, not Exit.
    expect(chips()).toEqual(['ECA', 'HVL']);
    await waitFor(() =>
      expect(screen.getByTestId('project-data-done').textContent).toBe('Save'),
    );
  });

  it('★★★ the OTHER three columns the same list drops are caught by the same audit', async () => {
    // `closing_date` has **zero** audited changes in the history of the table.
    // That is not a column nobody uses; it is a column nobody can save.
    setup({ project_tags: ['ECA'] }, SERVER_TODAY);
    fireEvent.change(screen.getByTestId('pd-site-lots'), { target: { value: '3' } });
    await pressSave();
    expect(stored.num_lots).toBeNull();
    const told = toastCalls().find(([, kind]) => kind === 'error');
    expect(told?.[0]).toContain('Number of Lots');
  });

  it('★★★ …and with the staged migration applied, all four land and NOTHING is reported', async () => {
    setup({ project_tags: ['ECA'] }, SERVER_AFTER_MIGRATION);
    fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: 'HVL' } });
    fireEvent.change(screen.getByTestId('pd-site-lots'), { target: { value: '3' } });
    await pressSave();
    expect(stored.project_tags).toEqual(['ECA', 'HVL']);
    expect(stored.num_lots).toBe(3);
    const calls = toastCalls();
    expect(calls.some(([, kind]) => kind === 'error')).toBe(false);
    expect(calls.some(([msg]) => msg === 'Project details saved.')).toBe(true);
  });

  it('⚠️ a column the server NORMALISES is not a dropped column', async () => {
    // The guard is narrow on purpose: reporting every value that came back
    // different would fire on every date the server reformats, and a warning
    // that cries wolf is how the real one gets ignored.
    setup({ num_lots: null }, SERVER_AFTER_MIGRATION);
    atomicSave.mockImplementationOnce(async (input: Record<string, unknown>) => {
      const patch = input.projectPatch as Record<string, unknown>;
      // The write landed and then a trigger had an opinion about it. Different
      // from what we sent AND different from what was there — so a value was
      // stored, and there is nothing to warn anybody about.
      stored.num_lots = 4;
      return {
        conflict: false,
        conflictKind: null,
        conflictId: null,
        projectUpdatedAt: '2026-09-16T21:05:00Z',
        permits: [],
        projectAfter: Object.fromEntries(
          Object.keys(patch).map((k) => [k, stored[k] ?? null]),
        ),
      };
    });
    fireEvent.change(screen.getByTestId('pd-site-lots'), { target: { value: '3' } });
    await pressSave();
    const calls = toastCalls();
    expect(calls.some(([, kind]) => kind === 'error')).toBe(false);
    expect(calls.some(([msg]) => msg === 'Project details saved.')).toBe(true);
  });
});

// ===========================================================================
// §3 — THE MODEL THE BRIEF FORBIDS BREAKING
// ===========================================================================

describe('fix-588 §3 — the tag editor still goes through the draft', () => {
  it('★ Cancel discards a buffered tag edit and writes nothing', async () => {
    setup({ project_tags: ['ECA'] });
    fireEvent.change(screen.getByTestId('pd-tag-add'), { target: { value: 'HVL' } });
    expect(chips()).toEqual(['ECA', 'HVL']);

    fireEvent.click(screen.getByTestId('project-data-cancel'));

    expect(chips()).toEqual(['ECA']);
    expect(atomicSave).not.toHaveBeenCalled();
    // ★★ The brief's §3: *"do not fix it by making the tag editor bypass the
    //    draft"*. The per-field write path must stay unused here — if the
    //    editor committed immediately, Cancel would stop meaning anything.
    expect(updateProjectMutate).not.toHaveBeenCalled();
    expect(stored.project_tags).toEqual(['ECA']);
  });
});
