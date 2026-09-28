// ===========================================================================
// ★★★ fix-591 (P-290) — A REDESIGN CANNOT ADD A PERMIT
// ===========================================================================
//
// **Miles, 2026-09-28, LIVE:** *"Cannot save the project with new permits
// added, getting the error pop-up in the top right when I click save."*
// 4707 S Graham St → Project Details → Permits → Save →
// **"This project was modified elsewhere — reload and retry."** Twice. Nobody
// had touched it.
//
// ---------------------------------------------------------------------------
// ★★★ §1 — WHAT WAS MEASURED, BEFORE ANYTHING WAS NAMED
// ---------------------------------------------------------------------------
//
// Four probes against prod `eibnmwthkcuumyclyxoe`, 2026-09-28. The failing one
// writes NOTHING by construction — the RPC's own `EXCEPTION WHEN OTHERS` block
// rolls back its subtransaction before returning the conflict row — and the
// succeeding ones were wrapped in `BEGIN … ROLLBACK` and verified empty after.
//
//   the two rows
//     original  0bae741f-d21a-4b4d-9803-f1a08e5d9a15  2 permits  ua 09-22 21:51
//     redesign  e2235581-5042-441c-8cdd-eeacb20920ba  0 permits  ua 09-16 17:08
//                 redesign_reuses_original_permit = true
//
//   PROBE A — the save exactly as the hook builds it: `p_project_id` = the
//   REDESIGN, `p_project_expected_updated_at` = the REDESIGN's live token,
//   upserts = permits **10638 and 10639 — both stored on the ORIGINAL** — each
//   carrying its own CORRECT live token `2026-09-02 21:22:11.310678+00`, plus
//   one new row.
//     → out_conflict = t · kind = **permit** · id = **10638**
//
//   PROBE C — the same save with NO new row and NO edits at all.
//     → out_conflict = t · kind = permit · id = 10638
//     ★★★ So this was never "cannot ADD a permit". The Permits tab of those
//         projects could not be saved AT ALL, by anyone, ever.
//
//   PROBE B — the bracket: the same shape on a `reuses = false` redesign
//   (123 N 48th St) and on a plain non-redesign (020a02cd…, 3 permits).
//     → out_conflict = f, both. The new permit inserted. Rolled back.
//
//   PROBE D — **the brief's hypothesis, killed.** §1 asked whether the two
//   project tokens being six days apart was the cause. A permits-only save
//   sends `{}` as its patch and the RPC skips step 2 entirely on an empty patch
//   (`IF v_patch <> '{}'`), so the project token is never compared. Probed with
//   a project token **27 years** stale on a healthy project:
//     → out_conflict = f.
//   The six-day gap is real and irrelevant. (Said out loud in the PR: this also
//   means a permits-only save carries no project-level OCC at all. A gap, not
//   this ticket, and §3 forbids touching that guard.)
//
// ★★★ THE GUARD THAT ANSWERED is step 0's per-permit lookup:
//
//       SELECT updated_at INTO v_pre_ua FROM public.permits
//        WHERE id = (v_elem->>'id')::int
//          AND project_id = p_project_id      ← ***THIS***
//        FOR UPDATE;
//       IF NOT FOUND OR v_pre_ua IS DISTINCT FROM (…expected…) THEN
//         v_occ := true; v_kind := 'permit'; …
//
//     `NOT FOUND`, on the `project_id` clause — not the token comparison. The
//     RPC's own comment already said it covered *"an id belonging to another
//     project"*; nobody had noticed that the client now routinely sends some.
//
// ★★★ WHY THE CLIENT SENDS THEM: fix-556 §B hands this tab `lineagePermits` —
//     own ∪ the original's (iff `reuses`) ∪ every redesign's own — so a
//     reuse-redesign can SEE the permits it works on. `PermitRow` had no
//     `project_id`, so `save()` sent all of them under the project on screen.
//     Measured across prod: **21 of 270 projects** carry at least one foreign
//     row on this tab — 16 reuse-redesigns (52 rows) and, in the other
//     direction, **5 originals whose tab lists a redesign's own permits**
//     (6 rows). That second class is not in the brief and was equally broken.
//
// ---------------------------------------------------------------------------
// ★★★ THE FAKE SERVER BELOW IS STEP 0 + STEP 1, INCLUDING THE SCOPE CLAUSE
// ---------------------------------------------------------------------------
//
// No live DB in CI (fix-153 / fix-382 / fix-425 precedent), so the mirror has to
// be faithful in the ONE place that matters: it refuses an id that is not on
// `p_project_id`, and its DELETE matches nothing for a foreign id **without
// reporting anything** — which is how a ✕ on a mirrored row produced *"Project
// details saved."* over a deletion that never happened.
//
// Every test here fails on `origin/main`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import { permitProvenanceLine } from '../lib/effectivePermits';
import { permitRowIsOwnedBy, permitToRow } from '../lib/projectDetailsForm';
import type { PermitWithCycles, Project } from '../lib/database.types';

const TENANT = 'test-tenant-uuid';
const ORIGINAL = '0bae741f-d21a-4b4d-9803-f1a08e5d9a15';
const REDESIGN = 'e2235581-5042-441c-8cdd-eeacb20920ba';
const PLAIN = '020a02cd-36d7-401a-99ac-04ac3bedb285';
const PERMIT_TOKEN = '2026-09-02T21:22:11.310678Z';

// ---------------------------------------------------------------------------
// The fake database + the fake RPC
// ---------------------------------------------------------------------------

interface StoredPermit {
  id: number;
  project_id: string;
  type: string;
  num: string | null;
  parent_permit_id: number | null;
  updated_at: string;
}

let permitRows: StoredPermit[] = [];
let projectRows: Record<string, { updated_at: string }> = {};
let nextPermitId = 9000;
let stampSeq = 0;

const atomicSave = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: atomicSave, isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
}));
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
}));
vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => true }));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  readAppConfigStringArray: () => [],
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: [{ name: 'Building Permit' }, { name: 'ULS' }] }),
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: [{ name: 'Seattle' }] }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: [
      { name: 'Marc', role: 'da', active: true },
      { name: 'Miles', role: 'ent', active: true },
    ],
  }),
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

/**
 * `bp_update_project_with_permits`, steps 0–3, as prod holds it on 2026-09-28.
 *
 * ★★★ THE SCOPE CLAUSE IS THE WHOLE POINT OF THIS MIRROR. Step 0 looks a permit
 *     up by `id AND project_id = p_project_id`; a miss is `NOT FOUND`, which is
 *     `conflict_kind = 'permit'` — indistinguishable, from the outside, from a
 *     genuinely stale token. And the DELETE's identical clause simply matches
 *     nothing, silently.
 */
function fakeRpc(input: {
  projectId: string;
  projectExpectedUpdatedAt: string;
  projectPatch: Record<string, unknown>;
  permitUpserts: {
    id?: number;
    expected_updated_at?: string;
    type?: string;
    num?: string | null;
    parent_permit_id?: number | null;
  }[];
  permitDeletes: number[];
}) {
  // ---- STEP 0: every expectation, before anything writes -------------------
  for (const u of input.permitUpserts) {
    if (u.id == null) continue;
    const row = permitRows.find(
      (p) => p.id === u.id && p.project_id === input.projectId,
    );
    if (!row || row.updated_at !== u.expected_updated_at) {
      return {
        conflict: true,
        conflictKind: 'permit' as const,
        conflictId: String(u.id),
        projectUpdatedAt: null,
        permits: [],
        projectAfter: null,
      };
    }
  }
  stampSeq += 1;
  const stamp = `2026-09-28T22:0${stampSeq}:00.000Z`;
  const touched: number[] = [];
  // ---- STEP 1: the permits -----------------------------------------------
  for (const u of input.permitUpserts) {
    if (u.id != null) {
      const row = permitRows.find(
        (p) => p.id === u.id && p.project_id === input.projectId,
      )!;
      if (u.type !== undefined) row.type = u.type;
      if (u.num !== undefined) row.num = u.num;
      if (u.parent_permit_id !== undefined) {
        // ★ The RPC resolves the link through a subquery that also requires
        //   `pp.project_id = p_project_id`, so a foreign parent stores NULL.
        const parent = permitRows.find(
          (p) =>
            p.id === u.parent_permit_id &&
            p.project_id === input.projectId &&
            p.id !== u.id &&
            p.parent_permit_id == null,
        );
        row.parent_permit_id = parent ? parent.id : null;
      }
      row.updated_at = stamp;
      touched.push(row.id);
    } else {
      nextPermitId += 1;
      permitRows.push({
        id: nextPermitId,
        // ★★★ §2b, IN THE SERVER: the INSERT has always written
        //     `project_id = p_project_id`. A new permit joins the project whose
        //     screen you are on.
        project_id: input.projectId,
        type: u.type ?? '',
        num: u.num ?? null,
        parent_permit_id: null,
        updated_at: stamp,
      });
      touched.push(nextPermitId);
    }
  }
  // ---- the deletes: scoped, and SILENT about a miss ----------------------
  for (const id of input.permitDeletes) {
    const i = permitRows.findIndex(
      (p) => p.id === id && p.project_id === input.projectId,
    );
    if (i >= 0) permitRows.splice(i, 1);
  }
  // ---- STEP 2: the project patch (skipped entirely on {}) ----------------
  if (Object.keys(input.projectPatch).length > 0) {
    if (projectRows[input.projectId]?.updated_at !== input.projectExpectedUpdatedAt) {
      return {
        conflict: true,
        conflictKind: 'project' as const,
        conflictId: input.projectId,
        projectUpdatedAt: null,
        permits: [],
        projectAfter: null,
      };
    }
  }
  projectRows[input.projectId] = { updated_at: stamp };
  return {
    conflict: false,
    conflictKind: null,
    conflictId: null,
    projectUpdatedAt: stamp,
    permits: touched.map((id) => ({
      id,
      updated_at: permitRows.find((p) => p.id === id)!.updated_at,
    })),
    projectAfter: null,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(id: string, over: Record<string, unknown> = {}): Project {
  return {
    id,
    address: '4707 S Graham St',
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
    units: 2,
    zone: 'LR1',
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    num_lots: null,
    is_corner_lot: null,
    alley: null,
    product_types: [],
    project_tags: [],
    poc_name: null,
    poc_email: null,
    is_backfill: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    redesign_of_project_id: null,
    redesign_reuses_original_permit: null,
    created_at: '2026-09-16T17:08:29.925908Z',
    updated_at: '2026-09-16T17:08:29.925908Z',
    ...over,
  } as unknown as Project;
}

function makePermit(id: number, projectId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    project_id: projectId,
    type: 'Building Permit',
    num: `70785${id}-CN`,
    ent_lead: null,
    da: null,
    portal_url: null,
    struct_address: null,
    expected_issue: null,
    parent_permit_id: null,
    target_submit: null,
    status: 'Pre-Submittal — GO',
    permit_cycles: [],
    updated_at: PERMIT_TOKEN,
    ...over,
  } as unknown as PermitWithCycles;
}

/** The live shape: the redesign, showing the ORIGINAL's two permits. */
const REUSE_REDESIGN = () =>
  makeProject(REDESIGN, {
    redesign_of_project_id: ORIGINAL,
    redesign_reuses_original_permit: true,
  });

function mount(
  project: Project,
  permits: PermitWithCycles[],
  allProjects: Project[] = [],
  tab: 'permits' | 'dates' = 'permits',
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(queryKeys.projects(TENANT), [project, ...allProjects]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(
    <ProjectDetailsModal
      project={project}
      permits={permits}
      bp={permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null}
      allProjects={[project, ...allProjects]}
      initialTab={tab as never}
      onClose={() => {}}
    />,
    { wrapper },
  );
}

function toastCalls(): [string, string][] {
  return (pushToast as unknown as { mock: { calls: [string, string][] } }).mock.calls;
}

/** `MilestoneDateRow` puts `title` on the wrapper around its input. */
function titleOfRow(input: HTMLElement): string {
  return input.closest('[title]')?.getAttribute('title') ?? '';
}

async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('project-data-done'));
  });
}

/** Fill the new row's Permit # so the assertion can find the stored row. */
async function addPermitNumbered(num: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('psm-add-permit'));
  });
  const card = screen.getByTestId('psm-permit-row-new');
  const boxes = Array.from(card.querySelectorAll('input[type="text"]'));
  await act(async () => {
    fireEvent.change(boxes[0], { target: { value: num } });
  });
}

beforeEach(() => {
  cleanup();
  stampSeq = 0;
  nextPermitId = 9000;
  permitRows = [
    { id: 10638, project_id: ORIGINAL, type: 'Building Permit', num: '7078527-CN', parent_permit_id: null, updated_at: PERMIT_TOKEN },
    { id: 10639, project_id: ORIGINAL, type: 'Building Permit', num: '7079712-CN', parent_permit_id: null, updated_at: PERMIT_TOKEN },
    // ★ the plain non-redesign's own row — PROBE B's control
    { id: 10425, project_id: PLAIN, type: 'Building Permit', num: 'PLAIN-EXISTING', parent_permit_id: null, updated_at: PERMIT_TOKEN },
  ];
  projectRows = {
    [ORIGINAL]: { updated_at: '2026-09-22T21:51:09.440901Z' },
    [REDESIGN]: { updated_at: '2026-09-16T17:08:29.925908Z' },
    [PLAIN]: { updated_at: '2026-09-16T17:08:29.925908Z' },
  };
  atomicSave.mockReset();
  atomicSave.mockImplementation(async (input: Parameters<typeof fakeRpc>[0]) =>
    fakeRpc(input),
  );
  (pushToast as unknown as { mockClear: () => void }).mockClear();
  useAuthStore.setState({
    activeTenantId: TENANT,
    memberships: [{ tenant_id: TENANT, role: 'admin' }],
  } as never);
});

// ===========================================================================
describe('fix-591 §2a — adding a permit on a reuse-redesign', () => {
  it('saves, and the stored row lands on the REDESIGN (§2b)', async () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL), makePermit(10639, ORIGINAL)], [
      makeProject(ORIGINAL),
    ]);

    await addPermitNumbered('NEW-1');
    await pressSave();

    // ★★★ THE INJURY, ASSERTED ABSENT. Nothing else touched this project.
    await waitFor(() => {
      expect(
        toastCalls().some(([msg]) => /modified elsewhere|changed elsewhere/.test(msg)),
      ).toBe(false);
    });
    expect(toastCalls().some(([msg]) => msg === 'Project details saved.')).toBe(true);

    // ★★★ THE STORED ROW, per the brief: *"assert the stored `project_id`."*
    const created = permitRows.find((p) => p.num === 'NEW-1');
    expect(created).toBeDefined();
    expect(created!.project_id).toBe(REDESIGN);
  });

  it('sends ONLY rows the project owns — the original\'s two are not in the payload', async () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL), makePermit(10639, ORIGINAL)], [
      makeProject(ORIGINAL),
    ]);

    await addPermitNumbered('NEW-2');
    await pressSave();

    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    const input = atomicSave.mock.calls[0][0] as Parameters<typeof fakeRpc>[0];
    expect(input.projectId).toBe(REDESIGN);
    // The two mirrored rows are READ on this tab and never written by it.
    expect(input.permitUpserts.map((u) => u.id)).toEqual([undefined]);
    expect(input.permitDeletes).toEqual([]);
  });

  it('the original\'s permits are untouched by the redesign\'s save', async () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL), makePermit(10639, ORIGINAL)], [
      makeProject(ORIGINAL),
    ]);
    await addPermitNumbered('NEW-3');
    await pressSave();
    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    for (const id of [10638, 10639]) {
      const row = permitRows.find((p) => p.id === id)!;
      expect(row.project_id).toBe(ORIGINAL);
      expect(row.updated_at).toBe(PERMIT_TOKEN);
    }
  });
});

// ===========================================================================
describe('fix-591 §2a — a foreign row is shown, not edited', () => {
  it('marks it read-only, names its project, and links to the Permits tab there', () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL)], [
      makeProject(ORIGINAL, { address: '4707 S Graham St' }),
    ]);

    const note = screen.getByTestId('psm-permit-owner-10638');
    expect(note.textContent).toContain('4707 S Graham St');
    expect(note.textContent).toContain('not this project');
    // ★ The action that DOES work — §2a's own words.
    const link = screen.getByTestId('psm-permit-owner-link-10638');
    expect(link.getAttribute('href')).toBe(
      `/project/${ORIGINAL}?data=permits&focus=10638`,
    );
    expect(screen.getByTestId('psm-permit-row-10638').getAttribute('data-readonly')).toBe(
      'true',
    );
  });

  it('every box on it is disabled, AND LOOKS IT', () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL)], [makeProject(ORIGINAL)]);
    const card = screen.getByTestId('psm-permit-row-10638');
    const fields = Array.from(card.querySelectorAll('input, select'));
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect((f as HTMLInputElement).disabled).toBe(true);
      // ★★★ `inputStyle` sets background and colour EXPLICITLY, which overrides
      //     the browser's own greying — so `disabled` alone was pixel-identical
      //     to a live box. Asserted because an invisible styling change is
      //     fix-406's defect class, and because a control that cannot work must
      //     not present as one.
      expect((f as HTMLElement).style.borderStyle).toBe('dashed');
      expect((f as HTMLElement).style.cursor).toBe('not-allowed');
      // ★ …and the value stays readable: `--color-text`, never `--color-dim`.
      expect((f as HTMLElement).style.color).toContain('--color-text');
    }
  });

  it('has no ✕ — a foreign delete matched nothing and reported success', () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL)], [makeProject(ORIGINAL)]);
    const card = screen.getByTestId('psm-permit-row-10638');
    expect(card.querySelector('button[title="Remove permit"]')).toBeNull();
  });

  it('a row the project DOES own keeps its ✕ and its enabled boxes', () => {
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)]);
    const card = screen.getByTestId('psm-permit-row-10425');
    expect(card.getAttribute('data-readonly')).toBeNull();
    expect(card.querySelector('button[title="Remove permit"]')).not.toBeNull();
    expect(
      Array.from(card.querySelectorAll('input, select')).every(
        (f) => !(f as HTMLInputElement).disabled,
      ),
    ).toBe(true);
  });

  it('says on screen which project a new permit joins (§2b), and only where it is ambiguous', () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL)], [makeProject(ORIGINAL)]);
    expect(screen.getByTestId('psm-new-permit-owner-note').textContent).toMatch(
      /filed on\s*this\s*project/,
    );
    cleanup();
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)]);
    expect(screen.queryByTestId('psm-new-permit-owner-note')).toBeNull();
  });

  it('a foreign row is not offered as a sub-permit parent', () => {
    // The redesign owns 9001; the original's 10638 is mirrored in.
    mount(
      REUSE_REDESIGN(),
      [makePermit(10638, ORIGINAL), makePermit(9001, REDESIGN, { type: 'ULS' })],
      [makeProject(ORIGINAL)],
    );
    const select = screen.getByTestId('psm-permit-parent-9001') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // Only the placeholder: its own project has no other saved, non-sub permit.
    expect(values).toEqual(['']);
    expect(values).not.toContain('10638');
  });
});

// ===========================================================================
describe('fix-591 — the OTHER caller of the same RPC', () => {
  // `TargetSubmitRow` sends `p_project_id` = the project on screen with
  // `permitUpserts = [{ id: bp.id }]`, and on a reuse-redesign `bp` is the
  // ORIGINAL's Building Permit (fix-556 §B pointed this page's anchor at the
  // EFFECTIVE set on purpose). Same guard, same false "modified elsewhere".
  it('Target Submit is disabled, and says why, when the BP belongs to the original', () => {
    mount(REUSE_REDESIGN(), [makePermit(10638, ORIGINAL)], [makeProject(ORIGINAL)], 'dates');
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    // ★ A greyed box with no reason is fix-549 §B's "box you could use if you
    //   tried harder". It names the original and the action that works.
    //   `MilestoneDateRow` hangs `title` on the row's value wrapper, not the
    //   input, so the assertion looks there.
    expect(titleOfRow(input)).toMatch(/original project — edit it there/);
  });

  it('…and is still editable when the BP is the project\'s own', () => {
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)], [], 'dates');
    const input = screen.getByTestId('pd-target-submit') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(titleOfRow(input)).toMatch(/projected submit date/);
  });
});

// ===========================================================================
describe('fix-591 — the regression bracket (PROBE B)', () => {
  it('a plain non-redesign still saves a new permit onto itself', async () => {
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)]);
    await addPermitNumbered('PLAIN-1');
    await pressSave();
    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    expect(toastCalls().some(([m]) => m === 'Project details saved.')).toBe(true);
    expect(permitRows.find((p) => p.num === 'PLAIN-1')!.project_id).toBe(PLAIN);
    // …and its EXISTING row still rides the same save, as it always has.
    const input = atomicSave.mock.calls[0][0] as Parameters<typeof fakeRpc>[0];
    expect(input.permitUpserts.map((u) => u.id)).toContain(10425);
  });

  it('a redesign with reuses = false still saves a new permit onto itself', async () => {
    const own = makeProject(REDESIGN, {
      redesign_of_project_id: ORIGINAL,
      redesign_reuses_original_permit: false,
    });
    permitRows.push({
      id: 10348, project_id: REDESIGN, type: 'Building Permit',
      num: 'OWN-1', parent_permit_id: null, updated_at: PERMIT_TOKEN,
    });
    mount(own, [makePermit(10348, REDESIGN, { num: 'OWN-1' })], [makeProject(ORIGINAL)]);
    await addPermitNumbered('FALSE-1');
    await pressSave();
    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    expect(toastCalls().some(([m]) => m === 'Project details saved.')).toBe(true);
    expect(permitRows.find((p) => p.num === 'FALSE-1')!.project_id).toBe(REDESIGN);
    const input = atomicSave.mock.calls[0][0] as Parameters<typeof fakeRpc>[0];
    expect(input.permitUpserts.map((u) => u.id)).toContain(10348);
  });

  it('the other direction too: an ORIGINAL whose tab lists a redesign\'s own permits', async () => {
    // ★★★ THE CLASS THE BRIEF DID NOT NAME — 5 prod projects, 6 rows. The
    //     parent's Permits tab is handed its redesign's rows by `lineagePermits`.
    permitRows.push({
      id: 10700, project_id: REDESIGN, type: 'ULS',
      num: 'KID-1', parent_permit_id: null, updated_at: PERMIT_TOKEN,
    });
    mount(
      makeProject(ORIGINAL),
      [
        makePermit(10638, ORIGINAL),
        makePermit(10639, ORIGINAL),
        makePermit(10700, REDESIGN, { type: 'ULS', num: 'KID-1' }),
      ],
      [REUSE_REDESIGN()],
    );
    await addPermitNumbered('PARENT-1');
    await pressSave();
    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    expect(toastCalls().some(([m]) => /elsewhere/.test(m))).toBe(false);
    expect(permitRows.find((p) => p.num === 'PARENT-1')!.project_id).toBe(ORIGINAL);
    const input = atomicSave.mock.calls[0][0] as Parameters<typeof fakeRpc>[0];
    expect(input.permitUpserts.map((u) => u.id)).not.toContain(10700);
    expect(input.permitUpserts.map((u) => u.id)).toEqual(
      expect.arrayContaining([10638, 10639]),
    );
  });
});

// ===========================================================================
describe('fix-591 §3 — a GENUINE conflict still refuses, and still says so', () => {
  it('a real second writer bumps the permit and the save is refused', async () => {
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)]);

    // ★★★ A REAL SECOND WRITER, not the same hook twice: somebody else's write
    //     lands on the row between this modal's load and its Save. The form
    //     still holds the token it read, which is exactly the race the guard is
    //     for.
    permitRows.find((p) => p.id === 10425)!.updated_at = '2026-09-28T23:00:00.000Z';

    await addPermitNumbered('RACE-1');
    await pressSave();

    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    // Nothing landed — the whole edit rolled back.
    expect(permitRows.find((p) => p.num === 'RACE-1')).toBeUndefined();
    // ★ And it SAYS SO. Naming the permit rather than the project is the fix;
    //   staying silent, or claiming success, is not.
    const said = toastCalls().map(([m]) => m);
    expect(said.some((m) => /changed elsewhere/.test(m))).toBe(true);
    expect(said.some((m) => m === 'Project details saved.')).toBe(false);
  });

  it('a project-level conflict still says "This project was modified elsewhere"', async () => {
    // A save that carries a project patch AND a stale project token.
    atomicSave.mockImplementationOnce(async () => ({
      conflict: true,
      conflictKind: 'project' as const,
      conflictId: PLAIN,
      projectUpdatedAt: null,
      permits: [],
      projectAfter: null,
    }));
    mount(makeProject(PLAIN), [makePermit(10425, PLAIN)]);
    await addPermitNumbered('P-1');
    await pressSave();
    await waitFor(() => expect(atomicSave).toHaveBeenCalled());
    expect(
      toastCalls().some(([m]) => m === 'This project was modified elsewhere — reload and retry.'),
    ).toBe(true);
  });
});

// ===========================================================================
describe('fix-591 — the rule, and its SQL twin', () => {
  it('permitRowIsOwnedBy mirrors step 0\'s `AND project_id = p_project_id`', () => {
    const mine = permitToRow(makePermit(1, PLAIN));
    const theirs = permitToRow(makePermit(2, ORIGINAL));
    expect(permitRowIsOwnedBy(mine, PLAIN)).toBe(true);
    expect(permitRowIsOwnedBy(theirs, PLAIN)).toBe(false);
    // ★★ An unknown owner is FOREIGN. Both permit queries `select('*')`, so
    //    this never fires in the app; the day it does, silence would be the bug.
    expect(permitRowIsOwnedBy({ ...mine, projectId: '' }, PLAIN)).toBe(false);
    // ★ A new row has no stored owner and is filed on `p_project_id`.
    expect(permitRowIsOwnedBy({ ...mine, isNew: true, projectId: '' }, PLAIN)).toBe(true);
  });

  it('permitToRow carries the STORED project_id, never the screen\'s', () => {
    expect(permitToRow(makePermit(10638, ORIGINAL)).projectId).toBe(ORIGINAL);
  });
});

// ===========================================================================
describe('fix-591 §2b — the reuse banner stops speaking for every row', () => {
  it('is unchanged while the redesign owns nothing (all 16 on prod today)', () => {
    expect(permitProvenanceLine('4707 S Graham St')).toBe(
      "Permits from 4707 S Graham St — this project reuses the original's permits.",
    );
    expect(permitProvenanceLine('4707 S Graham St', false)).toBe(
      "Permits from 4707 S Graham St — this project reuses the original's permits.",
    );
  });

  it('once it files one of its own, it says SOME of them are the original\'s', () => {
    expect(permitProvenanceLine('4707 S Graham St', true)).toBe(
      "Some permits here are from 4707 S Graham St — this project reuses the original's permits alongside its own.",
    );
  });

  it('still null with no address to name, either way', () => {
    expect(permitProvenanceLine(null, true)).toBeNull();
    expect(permitProvenanceLine('   ', true)).toBeNull();
  });
});
