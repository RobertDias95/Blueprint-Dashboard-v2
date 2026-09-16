import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import {
  SAVES_NOW_LABEL,
  SAVE_MODEL_CLEAN,
  SAVE_MODEL_DIRTY,
} from '../lib/saveModel';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// fix-575 (P-227) — Save and Cancel actually appear
// ===========================================================================
//
// Bobby, three times:
//
//   *"when editing in the modul, the save button doesnt appear when making a
//   change. so if i dont make any changes, it should be an exit button, if i
//   do make a change, then the options would be save and cancel."*
//
// ★★★ THE BUTTON WAS NEVER BROKEN. `projectDetailsFormIsDirty` returned
//     `permitsAreDirty(…)` and nothing else, ON PURPOSE, since fix-520 §A —
//     every other field committed on blur, so the footer could only ever say
//     `Exit`. This ticket changes the contract.
//
//   A  the 23 single-column scalars buffer behind Save
//   B  the footer shows Exit / Save+Cancel / Saving…
//   C  the boundary is stated in the footer AND on every immediate control
//   D  fix-572 §D's "Saved" flash

const T = 'test-tenant';
const NOW = '2026-09-16T10:00:00Z';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const atomicSave = vi.hoisted(() =>
  vi.fn((input: Record<string, unknown>) =>
    Promise.resolve({ conflict: false, sent: input }),
  ),
);
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
  readAppConfigStringArray: () => [],
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
import modalSrc from '../components/ProjectDetail/ProjectDetailsModal.tsx?raw';
import controllerSrc from '../hooks/useProjectDetailsForm.ts?raw';
import commitSrc from '../hooks/useProjectFieldCommit.ts?raw';

function project(over: Partial<Record<string, unknown>> = {}): Project {
  return {
    id: 'p-575',
    address: '5627 44th Ave SW',
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
    project_tags: null,
    poc_name: null,
    poc_email: null,
    is_backfill: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function setup(
  tab = 'site',
  over: Partial<Record<string, unknown>> = {},
  permits: PermitWithCycles[] = [],
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const p = project(over);
  qc.setQueryData(queryKeys.projects(T), [p]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailsModal
      project={p}
      permits={permits}
      bp={null}
      initialTab={tab as never}
      onClose={() => {}}
    />,
    { wrapper },
  );
}

const footerBtn = () => screen.getByTestId('project-data-done');
const footerText = () =>
  screen.getByTestId('project-data-done').closest('footer')!.textContent ?? '';

beforeEach(() => {
  atomicSave.mockClear();
  atomicSave.mockResolvedValue({ conflict: false, sent: {} });
  updateProjectMutate.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// §B — the footer
// ---------------------------------------------------------------------------

describe('fix-575 §B — Exit alone, then Save and Cancel', () => {
  it('★★★ clean: ONE button, and it says Exit', () => {
    setup();
    expect(footerBtn().textContent).toBe('Exit');
    expect(footerBtn().dataset.dirty).toBe('false');
    expect(screen.queryByTestId('project-data-cancel')).toBeNull();
  });

  it('★★★ dirty: Save AND Cancel — the ask, three times over', () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    expect(footerBtn().textContent).toBe('Save');
    expect(footerBtn().dataset.dirty).toBe('true');
    expect(screen.getByTestId('project-data-cancel')).toBeInTheDocument();
  });

  it('★★★ ONE FLAG FOR THE WHOLE MODAL — an edit on a tab you left still counts', () => {
    // ★★★ fix-514 §B's rule, and the reason it is not per-tab: a per-tab flag
    //     shows `Exit` while an unsaved edit sits on the tab you are not
    //     looking at, which is how somebody closes over their own work.
    setup('site');
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    // Walk away from the tab that holds the edit.
    fireEvent.click(screen.getByTestId('project-data-tab-team'));
    expect(screen.queryByTestId('pd-site-zone')).toBeNull();
    // ★★★ THE FOOTER STILL SAYS SAVE. A per-tab flag would read `Exit` here,
    //     which is how somebody closes over work they cannot currently see.
    expect(footerBtn().textContent).toBe('Save');
    expect(screen.getByTestId('project-data-cancel')).toBeInTheDocument();

    // ★★ ...and the edit is still there when you come back — the draft is
    //    modal-wide, not owned by the tab that took it.
    fireEvent.click(screen.getByTestId('project-data-tab-site'));
    expect((screen.getByTestId('pd-site-zone') as HTMLSelectElement).value).toBe('NR');
  });

  it('★★ Cancel throws the edit away and the control goes back', () => {
    setup();
    const zone = screen.getByTestId('pd-site-zone') as HTMLSelectElement;
    fireEvent.change(zone, { target: { value: 'NR' } });
    expect((screen.getByTestId('pd-site-zone') as HTMLSelectElement).value).toBe('NR');

    fireEvent.click(screen.getByTestId('project-data-cancel'));
    // ★★★ THE CONTROL REVERTS, which is the half a person can see. The draft is
    //     overlaid on the project the editors render from, so dropping it puts
    //     the stored value back with no re-fetch and no write.
    expect((screen.getByTestId('pd-site-zone') as HTMLSelectElement).value).toBe('LR1');
    expect(footerBtn().textContent).toBe('Exit');
    // ★★ NOTHING WAS WRITTEN, so nothing is undone — Cancel issues no RPC.
    expect(atomicSave).not.toHaveBeenCalled();
    expect(updateProjectMutate).not.toHaveBeenCalled();
  });

  it('★★★ typing a value BACK to what is stored reads clean again', () => {
    // ★★★ NOT POLITENESS — LOAD-BEARING. fix-519 §B freezes the rebuild while
    //     dirty; a draft entry that could never clear would freeze it FOR EVER
    //     and strand the modal on stale permit OCC tokens. This is the third
    //     exit from dirty, beside Save and Cancel.
    setup();
    const zone = screen.getByTestId('pd-site-zone');
    fireEvent.change(zone, { target: { value: 'NR' } });
    expect(footerBtn().textContent).toBe('Save');
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'LR1' } });
    expect(footerBtn().textContent).toBe('Exit');
  });

  it('★★ ✕ while dirty discards explicitly, and says so', () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    const x = screen.getByTestId('project-data-close');
    expect(x.getAttribute('title')).toBe('Discard changes and close');
    fireEvent.click(x);
    expect(atomicSave).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §A — the buffer
// ---------------------------------------------------------------------------

describe('fix-575 §A — the 23 scalars buffer, and Save writes them at once', () => {
  it('★★★ a blur writes NOTHING; Save writes one multi-column patch', async () => {
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    fireEvent.change(screen.getByTestId('pd-site-corner'), { target: { value: 'Yes' } });
    // ★★★ THE TICKET, IN ONE ASSERTION: the per-field write path is silent.
    expect(updateProjectMutate).not.toHaveBeenCalled();

    fireEvent.click(footerBtn());
    await waitFor(() => expect(atomicSave).toHaveBeenCalledTimes(1));
    // ★★ ONE call, BOTH columns — not two calls, and not two round trips.
    expect(atomicSave.mock.calls[0][0]).toMatchObject({
      projectPatch: { zone: 'NR', is_corner_lot: true },
    });
  });

  it('★★★ an untouched column is ABSENT from the patch, not restated', () => {
    // ★★★ fix-520 §A's warning, still honoured: a patch built by restating the
    //     form's snapshot would revert every other field to whatever the modal
    //     last loaded. The draft is not a snapshot.
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    fireEvent.click(footerBtn());
    return waitFor(() => {
      const patch = atomicSave.mock.calls[0][0].projectPatch as Record<string, unknown>;
      expect(Object.keys(patch)).toEqual(['zone']);
      expect(patch).not.toHaveProperty('is_backfill');
      expect(patch).not.toHaveProperty('address');
    });
  });

  it('★★★ the OCC token is the LIVE project’s, not one held in the draft', () => {
    // ★ The rebuild is frozen while dirty, so a token carried in the form would
    //   be exactly as old as the edit. It is read from the prop at save time.
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    fireEvent.click(footerBtn());
    return waitFor(() => {
      expect(atomicSave.mock.calls[0][0]).toMatchObject({
        projectId: 'p-575',
        projectExpectedUpdatedAt: NOW,
      });
    });
  });

  it('★★★ THE fix-519 §B TRAP — the flag CLEARS after a successful save', async () => {
    // ★★★ THE ONE THAT MATTERS MOST. Widening `dirty` extends fix-519 §B's
    //     rebuild freeze to the scalars, which is what makes the buffer safe
    //     beside the immediate writers — but a flag that could never clear
    //     would freeze the rebuild PERMANENTLY and strand the modal on stale
    //     permit OCC tokens. Asserting that it SETS proves nothing.
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    expect(footerBtn().textContent).toBe('Save');
    fireEvent.click(footerBtn());
    await waitFor(() => expect(atomicSave).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(footerBtn().textContent).toBe('Exit');
    expect(screen.queryByTestId('project-data-cancel')).toBeNull();
  });

  it('★★★ …and the draft joins that guard rather than bypassing it', () => {
    // ★ A cascading control invalidates `projects` and changes the prop's
    //   identity. Without the draft in the rebuild condition, the buffered
    //   scalars would be thrown away — fix-519 §B's defect through a new door.
    const c = controllerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(c).toContain('projectDetailsFormIsDirty(s.baseline, s.form) || draftIsDirty');
    expect(c).toContain('draftIsDirty || projectDetailsFormIsDirty(baseline, form)');
  });

  it('★★ the array columns use the array-aware comparator, not ===', () => {
    // ★★★ `project_tags` and `product_types` are arrays. Reference equality
    //     would hold them dirty for ever — the same permanent freeze, arriving
    //     by a different door. `projectValuesEqual` is fix-575a's.
    const c = controllerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(c).toContain('projectValuesEqual(value ?? null, stored)');
  });

  it('★★ outside the provider a field still writes on blur', () => {
    // ★★★ THE FALLBACK IS THE OLD BEHAVIOUR EXACTLY. Every consumer of
    //     `useProjectFieldCommit` mounts inside this modal today, so it is
    //     never taken — it exists so that mounting one of these editors on
    //     another surface degrades to a blur commit rather than to a buffer
    //     with no Save button, which is the worst of the three behaviours.
    const c = commitSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(c).toContain('if (draftSink) {');
    expect(c).toContain('draftSink.setDraft(field, next);');
  });
});

// ---------------------------------------------------------------------------
// §C — the boundary, said twice
// ---------------------------------------------------------------------------

describe('fix-575 §C — the promise names where it stops', () => {
  it('★★★ the footer sentence is true for all nine tabs at once', () => {
    setup();
    expect(footerText()).toContain(SAVE_MODEL_CLEAN);
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    expect(footerText()).toContain(SAVE_MODEL_DIRTY);
  });

  it('★★★ it points at the MARKER rather than listing nine controls', () => {
    // ★★ A list is unreadable at 9.5px and goes stale the first time a control
    //    moves; the marker is ON the control, so the footer teaches the word.
    expect(SAVE_MODEL_CLEAN).toContain(SAVES_NOW_LABEL);
    expect(SAVE_MODEL_CLEAN.length).toBeLessThan(90);
    expect(SAVE_MODEL_DIRTY).toContain('Cancel');
  });

  it('★★★ every immediate control carries a marker — the nine, by name', () => {
    // ★★★ THE HALF THAT MAKES §0's RULING SAFE RATHER THAN MERELY DEFENSIBLE.
    //     A footer sentence is not read by somebody looking at the hold panel.
    const src =
      modalSrc + read('src/components/ProjectDetail/ProjectDataEditors.tsx') +
      read('src/components/ProjectDetail/ProjectDetailsForm.tsx');
    for (const testid of [
      'saves-now-units', // writeTypes — a JSONB whitelist rebuild
      'saves-now-consultants', // project_consultants, five RPCs
      'saves-now-hold', // project_holds + a task sweep
      'saves-now-reuse', // multi-column overwrite behind a confirm()
      'saves-now-reuse-dd', // the draw_schedule lane
    ]) {
      expect(src, testid).toContain(testid);
    }
    // the DD window and target submit, through MilestoneDateRow's flag
    expect(src).toContain('savesNow');
    // ★ RENDERED, not just present in source. The Units tab always carries one
    //   (the `Unit configuration` heading), whatever the fixture — the Dates
    //   tab's markers need a Building Permit to exist at all, which would make
    //   this assert the fixture rather than the marker.
    setup('units');
    expect(screen.getByTestId('saves-now-units')).toBeInTheDocument();
  });

  it('★★★ the two team controls that do NOT write a project column', () => {
    setup('team');
    expect(screen.getByTestId('saves-now-BP Design Associate')).toBeInTheDocument();
    expect(screen.getByTestId('saves-now-Schematic Designer')).toBeInTheDocument();
  });

  it('★★ ONE string, not nine literals', () => {
    // ★★★ Nine copies of a sentence is how the two Library surfaces came to say
    //     different words about one unit (fix-519 §A), and how this modal's own
    //     Units caption came to contradict its tab (fix-520 §A).
    const all =
      modalSrc + read('src/components/ProjectDetail/ProjectDataEditors.tsx') +
      read('src/components/ProjectDetail/ProjectDetailsForm.tsx');
    expect(all.split(SAVES_NOW_LABEL).length - 1).toBe(0);
    expect(read('src/lib/saveModel.ts')).toContain(SAVES_NOW_LABEL);
  });

  it('★★ the marker is a quiet note, not a warning chip', () => {
    // ★ `--color-dim`, matching the "irregular lot" mark. Writing immediately is
    //   not a problem; a coloured chip would say the hold panel is broken.
    // ⚠️ COMMENTS STRIPPED FIRST — the note in that file explains why the mark
    //    is NOT `--color-co`, so an unstripped scan fails on its own reasoning.
    //    Seventh time in this codebase.
    const mark = read('src/components/shared/SavesNowMark.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(mark).toContain('text-[9px] italic');
    expect(mark).toContain("color: 'var(--color-dim)'");
    expect(mark).not.toContain('--color-co');
    expect(mark).toContain('title=');
  });
});

// ---------------------------------------------------------------------------
// §D — fix-572 §D's flash
// ---------------------------------------------------------------------------

describe('fix-575 §D — the "Saved" flash stays where a blur commit still happens', () => {
  it('★★★ it lives ONLY on the unit fields, which still write immediately', () => {
    // ★★★ THE DECISION, AND IT MADE ITSELF. fix-572 §D fires the flash from the
    //     resolved side of a blur commit. §A removes the blur commit for the 23
    //     scalars — but the flash was never on any of them: it is on
    //     `UnitConfigBlock`, whose writes go through `writeTypes`, which §A
    //     leaves immediate. So nothing became a lie, and the honest move is to
    //     leave it exactly where it is.
    //
    // ★★ AND §C's MARKER NOW PROMISES PRECISELY THAT: the Unit configuration
    //    heading says `saves now`, so the tick and the marker tell one story.
    const editors = read('src/components/ProjectDetail/ProjectDataEditors.tsx');
    const flashOwner = editors.slice(
      editors.indexOf('function UnitConfigBlock('),
      editors.indexOf('function AddUnitTypeButton('),
    );
    expect(flashOwner).toContain('markSaved()');
    // ★ It is not on any buffered control — the 23 scalars have no flash.
    expect(editors.indexOf('markSaved()')).toBeGreaterThan(
      editors.indexOf('function UnitConfigBlock('),
    );
    expect(editors.split('markSaved()').length - 1).toBe(1);
  });

  it('★★★ a buffered field shows NO tick — it has not saved yet', () => {
    // ★ The falsifiable half: if the flash ever migrated onto a buffered field
    //   it would fire on blur and claim a write that has not happened.
    setup();
    fireEvent.change(screen.getByTestId('pd-site-zone'), { target: { value: 'NR' } });
    expect(screen.queryAllByText('Saved')).toHaveLength(0);
  });
});
