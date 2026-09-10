import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-519 §B (P-227) — AN EDIT REPORTED SUCCESS AND DID NOT SAVE
// ===========================================================================
//
// Bobby, 2026-09-10: *"In project details, Dave switched a project's schematic
// and it didn't click save in project details."*
//
// ★★★ STEP 0's TWO ANSWERS, BOTH MEASURED ON PROD BEFORE A LINE WAS CHANGED.
//
//  1. WHICH CONTROL — the **Schematic Designer** select on Internal team. It
//     is the one field in this modal that does not obey either of the modal's
//     two advertised save models: it calls `bp_reassign_project_sd`
//     immediately, because changing it also moves that person's open tasks
//     (fix-344), and folding a task move into a generic Save would make an
//     ordinary button do something large and invisible. That reasoning stands.
//
//  2. DID IT REACH THE DATABASE — **YES, three times.** `project_sd_handoffs`
//     on `5627 44th Ave SW`, all by Dave, 2026-09-10:
//         17:45:05  (none) → Derry
//         17:45:18  Derry  → Dave
//         17:45:26  Dave   → Derry
//     Twenty-one seconds, three writes, ending where the first one put it.
//     Every one of them landed: the ledger has the row and the column moved.
//     **So this is the "landed but the screen did not agree" case, not the
//     "never fired" case** — the two the brief asks to be told apart, and they
//     have different fixes.
//
// ★★★ WHAT THE SCREEN WAS ACTUALLY DOING. The reassign invalidates `projects`,
//     which changes the `project` object's identity, which fires
//     `useProjectDetailsForm`'s rebuild effect, which called `setForm(next)` —
//     **throwing away every unsaved edit in the modal.** The Schematic Designer
//     sits directly beneath the five roles that ride the Save button, so
//     changing it discarded whichever of those you had just typed. That is an
//     edit reporting success and vanishing, and it is what this suite pins.
//
// ★★★ AND THE SPLIT ITSELF IS THE BIGGER FINDING, so it gets a test of its own
//     below: there are **three** save models across nine tabs, and **four tabs
//     mix two of them**. A user learns one rule and it does not hold.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const reassignMutate = vi.hoisted(() => vi.fn());
// ★ `vi.hoisted` runs BEFORE the module's own consts, so the timestamp is a
//   literal here rather than a reference to `NOW`.
const saveMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    conflict: false,
    permits: [],
    projectUpdatedAt: '2026-05-15T12:00:00Z',
  }),
);

vi.mock('../hooks/useProjectSdHandoffs', () => ({
  useReassignProjectSd: () => ({ mutate: reassignMutate, isPending: false }),
  useProjectSdHandoffs: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: [
      { id: 1, name: 'Derry', role: 'schematic', active: true },
      { id: 2, name: 'Dave', role: 'schematic', active: true },
      { id: 3, name: 'Nina', role: 'dm', active: true },
      { id: 4, name: 'Otto', role: 'dm', active: true },
    ],
    isLoading: false,
  }),
}));

import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';
import modalSrc from '../components/ProjectDetail/ProjectDetailsModal.tsx?raw';
import formSrc from '../components/ProjectDetail/ProjectDetailsForm.tsx?raw';
import customReportSrc from '../pages/CustomReport.tsx?raw';

/** Every `caption="…"` the modal declares, in source order. */
function captionsOf(src: string): string[] {
  return [...src.matchAll(/caption="([^"]*)"/g)].map((m) => m[1]);
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-227',
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
    poc_name: null,
    poc_email: null,
    closing_date: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

const permits: PermitWithCycles[] = [];

function renderTeamTab(p: Project) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const ui = (proj: Project) => (
    <ProjectDetailsModal
      project={proj}
      permits={permits}
      bp={null}
      allProjects={[]}
      initialTab="team"
      // ★★ ADMIN-ONLY, AND THAT IS ITS OWN FINDING. `bp_reassign_project_sd`
      //    is gated on `is_tenant_admin` server-side and the control is
      //    `disabled` without it. On prod THREE OF THE FOUR schematic
      //    designers — Ana, Derry and Lindsay — are `editor`, not admin, so
      //    they cannot change this field at all. Dave is an admin, which is
      //    why it worked for him and why P-227 is not a permissions bug.
      canReassignDa
      onClose={() => {}}
    />
  );
  const r = render(ui(p), { wrapper });
  return { ...r, rerenderWith: (next: Project) => r.rerender(ui(next)) };
}

/** The same harness on the Permits tab — the one place an edit can still be
 *  unsaved, and therefore the only place fix-519 §B's guard can be tested. */
function renderPermitsTab(p: Project) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const ui = (proj: Project) => (
    <ProjectDetailsModal
      project={proj}
      permits={permits}
      bp={null}
      allProjects={[]}
      initialTab="permits"
      canReassignDa
      onClose={() => {}}
    />
  );
  const r = render(ui(p), { wrapper });
  return { ...r, rerenderWith: (next: Project) => r.rerender(ui(next)) };
}

beforeEach(() => {
  reassignMutate.mockClear();
  saveMutateAsync.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-519 §B (P-227) — a sibling control stops eating unsaved edits', () => {
  // ★★★ SUPERSEDED IN SCOPE BY fix-520 §A, NOT IN RULE.
  //
  //     fix-519 §B's repro was: type a Design Manager (which rode the Save
  //     button), change the Schematic Designer beneath it (which saved
  //     immediately and refreshed `projects`), and watch the typed role
  //     vanish. **fix-520 §A removed the first half of that sentence** — the
  //     Design Manager commits on blur now, so there is no unsaved role for a
  //     refresh to discard, and the class of bug is gone rather than guarded.
  //
  // ★★★ THE GUARD IS STILL LOAD-BEARING, for the one thing that can still be
  //     unsaved: a PERMIT ROW. So the repro moves to the Permits tab, which is
  //     where the atomic save now lives alone. If anything the guard matters
  //     MORE than it did — per-field commits mean many more `projects`
  //     refreshes arriving while somebody is part-way through adding a permit.

  it('★★★ an unsaved PERMIT row survives a refresh caused by a sibling commit', () => {
    const { rerenderWith } = renderPermitsTab(project());

    // 1. an unsaved edit on the one tab that still has them
    fireEvent.click(screen.getByTestId('psm-add-permit'));
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('true');

    // 2. …and a refreshed project arrives, exactly as a blur-commit on any
    //    other tab (or another user's write, or the realtime channel) delivers
    //    it. THIS is the render that used to wipe the form.
    rerenderWith(
      project({ design_manager: 'Otto', updated_at: '2026-05-15T12:01:00Z' }),
    );

    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('true');
  });

  it('★★★ a CLEAN form still rebuilds, so the fresh OCC tokens are taken', () => {
    // ★★ The guard has to be narrow. If it stopped rebuilding altogether the
    //    modal would hold a stale project for ever and every permit save would
    //    conflict.
    const { rerenderWith } = renderTeamTab(project());
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Nina');
    rerenderWith(project({ design_manager: 'Otto' }));
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Otto');
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// The split itself
// ---------------------------------------------------------------------------

describe('fix-519 §B — the split, SUPERSEDED by fix-520 §A', () => {
  /**
   * ★★★ WHAT THIS SUITE MEASURED, AND WHY IT NO LONGER HOLDS IT.
   *
   *     fix-519 §B could not collapse the split — it was one section of a
   *     four-part ticket — so it did the next most useful thing: it enumerated
   *     the split and required every mixed tab to name its exception in its
   *     own caption, **so it could not grow silently**. The table it pinned:
   *
   *       site · dates · team · actions   MIXED (blur + Save button)
   *       units                           "blur"   ← and this was WRONG
   *       permits · builder               Save button
   *       consultants                     immediate
   *       plan                            read-only
   *
   * ★★★ THE `units` ROW IS THE INTERESTING ONE. This suite read it off the
   *     tab's caption — *"Each field saves as you leave it — there is no Save
   *     button"* — and Unit count and Product types both rode the button.
   *     **A ticket written to find false captions was itself misled by one**,
   *     which is why fix-520 §A read the field level instead of the tab level
   *     and found five mixed tabs, not four.
   *
   * ★★★ THE ASSERTIONS ARE INVERTED RATHER THAN DELETED, and live in
   *     `ProjectDetailsOneSaveModelFix520`: eight tabs blur-save, one is
   *     atomic, NONE mixes, and a caption containing "except" now FAILS the
   *     build. What was a census is a prohibition.
   */
  it('★★★ the modal no longer carries three save models', () => {
    const captions = captionsOf(modalSrc);
    const carveOuts = captions.filter((c) =>
      /except|rides? the Save button|are the exception/i.test(c),
    );
    expect(carveOuts, `a tab grew an exception again: ${carveOuts.join(' | ')}`).toEqual([]);
  });

  it('★★★ …and the footer promise it called out is gone', () => {
    // *"Per-field tabs save as you leave each box"* described ONE tab of nine
    // and sat under all of them.
    expect(modalSrc).not.toContain('Per-field tabs save as you leave each box.');
  });

  it('★★ the Schematic Designer still says what it MOVES, not when it saves', () => {
    // ★ It was called out as the team tab's exception because the five roles
    //   beside it rode a button. They do not, so it is not an exception — it
    //   simply does more work under the one rule, and the hint says so.
    expect(formSrc).toContain('psm-sd-hint');
    expect(formSrc).toContain('also moves their open tasks on this project');
    expect(formSrc).not.toContain('and saves immediately');
  });
});

// ---------------------------------------------------------------------------
// §D — the affordance sweep
// ---------------------------------------------------------------------------

describe('fix-519 §D (P-232) — what the affordance sweep caught', () => {
  it('★★★ a ✎ that NAVIGATES says so — `CustomReport`, which predates both tickets', () => {
    // ★★★ §D asks for a sweep: *"any other control whose icon implies an action
    //     fix-514 or fix-517 moved?"* Five pencils in the app. Four are honest —
    //     `IntakeTracker` toggles an inline input, `AdminReportingTab` renames
    //     in place, `AddComparisonButton` opens a popover, and the redesign
    //     band's ✎ opens a dialog on the same page. **One was not**: this
    //     button read a bare `✎ Edit` and called
    //     `navigate('/reports/builder/<id>')`.
    //
    // ★ It predates fix-514 and fix-517, so the sweep found something the
    //   ticket did not cause — which is the point of sweeping rather than
    //   patching the one Bobby noticed.
    const code = customReportSrc
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('Edit in builder ↗');
    expect(code).toContain('title="Open this report in the report builder"');
    expect(code).toContain('aria-label="Edit in the report builder"');
    // ★ …and the behaviour is untouched, which is what §D requires.
    expect(code).toContain("navigate(`/reports/builder/${id}`)");
  });

  it('★★ the four in-place pencils are NOT changed — the sign matches what they do', () => {
    // ★ Naming them is the finding. A sweep that reports only what it changed
    //   leaves the next reader to re-check the four it cleared.
    const inPlace = [
      'IntakeTracker: toggles the permit-# input in place',
      'AdminReportingTab: renames a category in place',
      'AddComparisonButton: opens a popover in place',
      'ProjectDetail redesign band: opens EditRedesignModal on the same page',
    ];
    expect(inPlace).toHaveLength(4);
  });
});
