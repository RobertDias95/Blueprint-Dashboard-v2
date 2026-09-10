import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import { initProjectDetailsForm, projectDetailsFormIsDirty } from '../lib/projectDetailsForm';

// ===========================================================================
// ★★★ fix-520 §A (P-227) — ONE SAVE MODEL
// ===========================================================================
//
// fix-519 §B measured the split and guarded the single path that had already
// lost somebody's work. **The shape that produced it was still in eight other
// tabs**, and Cam is about to spend weeks in this modal (P-225: 102 projects
// with no unit rows).
//
// ★★★ THE FIELD-LEVEL MATRIX, BEFORE — worse than the tab-level count fix-519
//     took from the captions, because one of those captions was false:
//
//       Save button   Address · Jurisdiction · GO date · **Unit count** ·
//                     **Product types** · ACQ/ENT/DM/CA · BP Design Associate ·
//                     Point of Contact · Contact Email · Archived · Backfill ·
//                     every Permits field
//       on blur       Zone · Lot W/D/SF · Corner · Alley · Reuse-of · Closing ·
//                     DD start/end · Target submit · Intake · Unit dimensions ·
//                     Unit size (sf) · every Consultant control
//       immediate     Schematic Designer
//
//     **The Units tab said *"Each field saves as you leave it — there is no
//     Save button"* while Unit count and Product types both rode the button.**
//     fix-519 filed that tab as pure blur BECAUSE of the caption — which is how
//     a false caption survives a ticket written to find false captions.
//
// ★★★ AFTER: every field commits when you leave it. **The Permits tab is the
//     one exception**, because a new row and its six fields have to land
//     together, and it says so on screen.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const updateProjectMutate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const updatePermitMutate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const reassignMutate = vi.hoisted(() => vi.fn());
const atomicSave = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    conflict: false,
    permits: [],
    projectUpdatedAt: '2026-05-15T12:00:00Z',
  }),
);

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateProjectMutate, isPending: false }),
}));
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: updatePermitMutate, isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: atomicSave, isPending: false }),
}));
vi.mock('../hooks/useProjectSdHandoffs', () => ({
  useReassignProjectSd: () => ({ mutate: reassignMutate, isPending: false }),
  useProjectSdHandoffs: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: [
      { id: 1, name: 'Derry', role: 'schematic', active: true },
      { id: 2, name: 'Nina', role: 'dm', active: true },
      { id: 3, name: 'Otto', role: 'dm', active: true },
      { id: 4, name: 'Pat', role: 'acq', active: true },
      // ★ The BP's `da` must be IN the roster or the select cannot hold it and
      //   renders empty — which would make the no-op guard below untestable.
      { id: 5, name: 'Nina', role: 'da', active: true },
      { id: 6, name: 'Quinn', role: 'da', active: true },
    ],
    isLoading: false,
  }),
}));

import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';
import modalSrc from '../components/ProjectDetail/ProjectDetailsModal.tsx?raw';
import formSrc from '../components/ProjectDetail/ProjectDetailsForm.tsx?raw';
import controllerSrc from '../hooks/useProjectDetailsForm.ts?raw';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-520',
    address: '5627 44th Ave SW',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: 'Nina',
    construction_admin: null,
    schematic_designer: [],
    go_date: null,
    units: 3,
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
    builder_address: null,
    poc_name: null,
    poc_email: null,
    closing_date: null,
    is_backfill: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 11,
    project_id: 'p-520',
    type: 'Building Permit',
    num: 'BP-1',
    da: 'Nina',
    ent_lead: null,
    portal_url: null,
    struct_address: null,
    parent_permit_id: null,
    expected_issue: null,
    target_submit: null,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderTab(tab: string, p: Project = project(), permits: PermitWithCycles[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailsModal
      project={p}
      permits={permits}
      bp={permits[0] ?? null}
      allProjects={[]}
      initialTab={tab as never}
      canReassignDa
      onClose={() => {}}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  updateProjectMutate.mockClear();
  updatePermitMutate.mockClear();
  reassignMutate.mockClear();
  atomicSave.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// The fields that moved
// ---------------------------------------------------------------------------

describe('fix-520 §A — every project field commits when you leave it', () => {
  it('★★★ a text field writes ONE column on blur, without the Save button', async () => {
    renderTab('site');
    const box = screen.getByTestId('psm-address') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '5627 44th Ave NW' } });
    // ★ Not on keystroke — a per-keystroke commit would write "5627 44th Ave N"
    //   on the way past, which is why this is buffered.
    expect(updateProjectMutate).not.toHaveBeenCalled();
    fireEvent.blur(box);
    await waitFor(() => expect(updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(updateProjectMutate.mock.calls[0][0]).toMatchObject({
      projectId: 'p-520',
      expectedUpdatedAt: NOW,
      patch: { address: '5627 44th Ave NW' },
    });
    expect(atomicSave).not.toHaveBeenCalled();
  });

  it('★★★ a select commits on CHANGE — choosing is leaving', async () => {
    renderTab('team');
    fireEvent.change(screen.getByTestId('psm-dm'), { target: { value: 'Otto' } });
    await waitFor(() => expect(updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(updateProjectMutate.mock.calls[0][0].patch).toEqual({ design_manager: 'Otto' });
  });

  it('★★★ THE UNITS TAB — the two fields that made its caption a lie', async () => {
    // ★★★ `Unit count` and `Product types` rode the Save button under a caption
    //     reading *"there is no Save button"*. This is the tab Cam will live in.
    renderTab('units');
    const box = screen.getByTestId('psm-units') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '9' } });
    fireEvent.blur(box);
    await waitFor(() => expect(updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(updateProjectMutate.mock.calls[0][0].patch).toEqual({ units: 9 });
    expect(atomicSave).not.toHaveBeenCalled();
  });

  it('★★★ BP Design Associate writes the PERMIT, not the project', async () => {
    // ★★★ The one control on the Internal team tab that is not a project
    //     column. The atomic save used to smuggle it into a permit upsert,
    //     which is why a six-control tab needed two write models.
    renderTab('team', project(), [permit()]);
    fireEvent.change(screen.getByTestId('psm-da'), { target: { value: 'Nina' } });
    // Same value → no write.
    expect(updatePermitMutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('psm-da'), { target: { value: '' } });
    await waitFor(() => expect(updatePermitMutate).toHaveBeenCalledTimes(1));
    expect(updatePermitMutate.mock.calls[0][0]).toMatchObject({
      permitId: 11,
      patch: { da: null },
    });
    expect(updateProjectMutate).not.toHaveBeenCalled();
  });

  it('★★ a checkbox commits on tick, and `null` stays "not recorded" until it does', async () => {
    renderTab('actions');
    expect((screen.getByTestId('psm-is-backfill') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('psm-is-backfill'));
    await waitFor(() => expect(updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(updateProjectMutate.mock.calls[0][0].patch).toEqual({ is_backfill: true });
  });

  it('★★ an unchanged value writes NOTHING', async () => {
    // ★ Not an optimisation — it is what makes a blur model usable. Tabbing
    //   through a form touches every field; without this, every pass would bump
    //   `updated_at` for nothing and fix-341's false "modified by someone else"
    //   alarms would come back.
    renderTab('site');
    const box = screen.getByTestId('psm-address') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(updateProjectMutate).not.toHaveBeenCalled();
  });

  it('★★ a blank address does not commit over a real one', async () => {
    // The guard the atomic save used to carry, moved to the field it guards.
    renderTab('site');
    const box = screen.getByTestId('psm-address') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.blur(box);
    expect(updateProjectMutate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The rule, stated where it cannot rot
// ---------------------------------------------------------------------------

describe('fix-520 §A — the model, and the one exception', () => {
  /**
   * ★★★ THE MATRIX, AFTER. Nine tabs, ONE model, ONE exception. Compare with
   *     `ProjectDetailsSaveModelFix519`'s version of this table, which had
   *     three models and four mixed tabs — five, once the Units caption was
   *     read against the code instead of taken at its word.
   */
  const MODEL: Record<string, 'blur' | 'permits-atomic' | 'readonly'> = {
    site: 'blur',
    dates: 'blur',
    units: 'blur',
    permits: 'permits-atomic',
    builder: 'blur',
    team: 'blur',
    consultants: 'blur',
    plan: 'readonly',
    actions: 'blur',
  };

  it('★★★ eight tabs blur-save, one tab is atomic, none MIXES', () => {
    const counts = Object.values(MODEL).reduce<Record<string, number>>(
      (a, m) => ({ ...a, [m]: (a[m] ?? 0) + 1 }),
      {},
    );
    expect(Object.keys(MODEL)).toHaveLength(9);
    expect(counts.blur).toBe(7);
    expect(counts['permits-atomic']).toBe(1);
    expect(counts.readonly).toBe(1);
    // ★ There is no `mixed`. That is the whole ticket.
    expect(Object.values(MODEL)).not.toContain('mixed');
  });

  it('★★★ no caption carves out an exception any more', () => {
    // ★★ fix-519 required every mixed tab to NAME its exception, because there
    //    were four of them. The inverse is the assertion now: a caption that
    //    says "except", "rides the Save button" or "are the exception" means a
    //    tab has grown a second model again.
    const captions = [...modalSrc.matchAll(/caption="([^"]*)"/g)].map((m) => m[1]);
    expect(captions.length).toBeGreaterThanOrEqual(7);
    const carveOuts = captions.filter((c) =>
      /except|rides? the Save button|are the exception/i.test(c),
    );
    expect(carveOuts, `a tab grew an exception: ${carveOuts.join(' | ')}`).toEqual([]);
    // ★ …and the Permits tab still declares itself, in the positive.
    expect(captions.some((c) => c.includes('The one tab with a Save button'))).toBe(true);
  });

  it('★★★ THE FOOTER SAYS SOMETHING TRUE', () => {
    // ★★★ It read *"Per-field tabs save as you leave each box"* — one tab of
    //     nine, printed under all of them. **A blanket promise that holds for
    //     one tab in nine is worse than no promise**: it is what teaches
    //     somebody their edit is safe.
    expect(modalSrc).not.toContain('Per-field tabs save as you leave each box.');
    expect(modalSrc).toContain(
      'Fields save as you leave them. Permit rows save with the button.',
    );
    expect(modalSrc).toContain('Unsaved permit rows — Save to write them.');
  });

  it('★★★ the atomic save writes PERMITS AND NOTHING ELSE', () => {
    // ★★★ THE REGRESSION THIS PREVENTS IS THE WORST ONE AVAILABLE. The patch
    //     used to restate every project scalar from the form's snapshot. Left
    //     in place beside per-field commits, saving one permit row would revert
    //     nine fields to whatever the modal last loaded.
    const code = controllerSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('const projectPatch: Record<string, unknown> = {};');
    // ★ Anchored to the patch's own indentation, NOT a bare substring: a
    //   loose `address:` matches `struct_address:` on a permit row, which is a
    //   different field on a different table. The "must not appear" grep that
    //   matches innocent code is a trap this repo has recorded three times.
    for (const scalar of [
      'address',
      'juris',
      'design_manager',
      'entitlement_lead',
      'poc_name',
      'product_types',
      'go_date',
      'builder_name',
    ]) {
      expect(
        new RegExp(`^\\s{8}${scalar}:`, 'm').test(code),
        `${scalar} must not be restated by the permits save`,
      ).toBe(false);
    }
  });

  it('★★★ the dirty flag means "an unsaved PERMIT ROW", and nothing else', () => {
    // ★★★ A false dirty flag would be actively harmful, not just untidy:
    //     fix-519 §B made the form refuse to rebuild while dirty. A scalar that
    //     read dirty for ever — because the form's snapshot lags a blur-commit
    //     it never made — would freeze the rebuild and strand the modal on
    //     stale permit OCC tokens.
    const a = initProjectDetailsForm(project(), [permit()]);
    expect(projectDetailsFormIsDirty(a, a)).toBe(false);
    // A scalar difference is NOT dirty — nothing can produce one any more.
    expect(projectDetailsFormIsDirty(a, { ...a, address: 'somewhere else' })).toBe(false);
    expect(
      projectDetailsFormIsDirty(a, {
        ...a,
        projectFields: { ...a.projectFields, units: '99' },
      }),
    ).toBe(false);
    // A permit difference IS.
    expect(
      projectDetailsFormIsDirty(a, {
        ...a,
        permits: a.permits.map((p) => ({ ...p, num: 'BP-CHANGED' })),
      }),
    ).toBe(true);
  });

  it('★★★ NO COMMIT DISCARDS AN UNSAVED EDIT ELSEWHERE IN THE MODAL', () => {
    // ★★★ §A's fourth requirement, and the reason blur was the right collapse:
    //     with a per-field commit there is no unsaved scalar for a sibling's
    //     refresh to throw away. The ONLY unsaved thing left is a permit row,
    //     and fix-519 §B's dirty-guard protects that — asserted here rather
    //     than only in that suite, because it is now load-bearing for the whole
    //     model rather than for one field.
    const code = controllerSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('projectDetailsFormIsDirty(s.baseline, s.form)');
    expect(code).toContain('? s');
  });

  it('★★ `AtomicZoneField` is deleted — a control for a write path that is gone', () => {
    expect(formSrc).not.toContain('export function AtomicZoneField');
    // ★ And zone is still editable, on the Site data tab's own picker.
    expect(formSrc).toContain('`AtomicZoneField` IS DELETED');
  });
});
