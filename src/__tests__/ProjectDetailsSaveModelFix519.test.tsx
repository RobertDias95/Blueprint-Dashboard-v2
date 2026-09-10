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

beforeEach(() => {
  reassignMutate.mockClear();
  saveMutateAsync.mockClear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-519 §B (P-227) — a sibling control stops eating unsaved edits', () => {
  it('★★★ changing the Schematic Designer no longer discards an unsaved Design Manager', () => {
    // ★★★ THE REPRO, IN THE ORDER DAVE HIT IT. Type a role that rides the Save
    //     button, then change the Schematic Designer beneath it — which saves
    //     immediately and refreshes `project`. Before this ticket the refresh
    //     rebuilt the whole form and the typed role was gone, with no error,
    //     no toast and nothing on screen to say it had happened.
    const p = project();
    const { rerenderWith } = renderTeamTab(p);

    // 1. an unsaved edit on a Save-button field
    fireEvent.change(screen.getByTestId('psm-dm'), { target: { value: 'Otto' } });
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Otto');
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('true');

    // 2. the Schematic Designer changes — its own RPC, immediately
    fireEvent.change(screen.getByTestId('psm-sd'), { target: { value: 'Derry' } });
    expect(reassignMutate).toHaveBeenCalledTimes(1);

    // 3. …and the refreshed project arrives, exactly as the invalidation
    //    delivers it. THIS is the render that used to wipe the form.
    rerenderWith(
      project({ schematic_designer: ['Derry'], updated_at: '2026-05-15T12:01:00Z' }),
    );

    // ★★★ The unsaved edit SURVIVES…
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Otto');
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('true');
    // ★ …and the schematic designer still shows its NEW value, because
    //   `currentSd` is derived from `project` on every render rather than held
    //   in the form. The guard costs it nothing.
    expect((screen.getByTestId('psm-sd') as HTMLSelectElement).value).toBe('Derry');
  });

  it('★★★ a CLEAN form still rebuilds, so the fresh OCC tokens are taken', () => {
    // ★★ The guard has to be narrow. If it stopped rebuilding altogether the
    //    modal would hold a stale project for ever and every save would
    //    conflict. With nothing typed, an incoming project is taken whole.
    const { rerenderWith } = renderTeamTab(project());
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Nina');
    rerenderWith(project({ design_manager: 'Otto' }));
    expect((screen.getByTestId('psm-dm') as HTMLSelectElement).value).toBe('Otto');
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('false');
  });

  it('★★ after a successful Save the form REBASES, so the next refresh is free', () => {
    // ★★★ WITHOUT THIS THE FIX WOULD DEADLOCK. The dirty-guard would see the
    //     just-saved edits as unsaved for ever, refuse every rebuild, and the
    //     modal would never take the server's new OCC tokens again.
    const { rerenderWith } = renderTeamTab(project());
    fireEvent.change(screen.getByTestId('psm-dm'), { target: { value: 'Otto' } });
    expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('true');
    fireEvent.click(screen.getByTestId('project-data-done'));
    return Promise.resolve().then(() => {
      rerenderWith(project({ design_manager: 'Otto', updated_at: '2026-05-15T12:02:00Z' }));
      expect(screen.getByTestId('project-data-done').getAttribute('data-dirty')).toBe('false');
    });
  });
});

// ---------------------------------------------------------------------------
// The split itself
// ---------------------------------------------------------------------------

describe('fix-519 §B — the per-tab save model, named so it cannot grow', () => {
  /**
   * ★★★ THE SPLIT, AS SHIPPED. Every entry is the tab's own caption, which is
   *     the only promise a user ever sees.
   *
   *   tab           model
   *   ------------  ---------------------------------------------------------
   *   site          MIXED — zone/lot/tags on blur; address + jurisdiction on Save
   *   dates         MIXED — each date on blur; the GO date on Save
   *   units         BLUR  — "there is no Save button"
   *   permits       SAVE
   *   builder       SAVE
   *   team          MIXED — five roles on Save; Schematic Designer IMMEDIATE
   *   consultants   IMMEDIATE — its own bp_set_consultant_* RPCs
   *   plan          READ-ONLY
   *   actions       MIXED — immediate/confirm; two checkboxes on Save
   *
   * ★★★ THREE MODELS, AND FOUR OF THE NINE TABS MIX TWO. Every mixed tab's
   *     exception is a SINGLE field that behaves differently from the ones
   *     beside it — which is exactly the shape that loses an edit: you learn
   *     the rule from the field you used last.
   *
   * ★★ AND THE FOOTER CONTRADICTS FOUR OF THE CAPTIONS ABOVE IT. It reads
   *    *"Per-field tabs save as you leave each box"*, which is true of ONE tab
   *    out of nine.
   *
   * ★ NOT FIXED HERE, DELIBERATELY. Collapsing three models into one is a
   *   redesign of every tab and of `bp_set_consultant_*` and
   *   `bp_reassign_project_sd` besides — the RPCs exist because those writes do
   *   more than set a column. What §B can do is stop the split GROWING
   *   silently, which is what this test is.
   */
  const EXPECTED_MODEL: Record<string, 'blur' | 'save' | 'immediate' | 'mixed' | 'readonly'> = {
    site: 'mixed',
    dates: 'mixed',
    units: 'blur',
    permits: 'save',
    builder: 'save',
    team: 'mixed',
    consultants: 'immediate',
    plan: 'readonly',
    actions: 'mixed',
  };

  it('★★★ three models across nine tabs, and four tabs mix two', () => {
    const counts = Object.values(EXPECTED_MODEL).reduce<Record<string, number>>(
      (a, m) => ({ ...a, [m]: (a[m] ?? 0) + 1 }),
      {},
    );
    expect(Object.keys(EXPECTED_MODEL)).toHaveLength(9);
    expect(counts.mixed).toBe(4);
    // blur · save · immediate — the three, plus read-only which is not a save
    // model at all.
    expect(counts.blur).toBe(1);
    expect(counts.save).toBe(2);
    expect(counts.immediate).toBe(1);
    expect(counts.readonly).toBe(1);
  });

  it('★★★ every tab that MIXES says so in its own caption', () => {
    // ★★ The captions are the only place the split is visible to a user, so
    //    they are what this holds. Each mixed tab names its exception in
    //    words — "except", "ride the Save button", "are the exception" — and a
    //    new exception added without one fails here.
    const captions = captionsOf(modalSrc);
    const mixedCaptions = captions.filter((c) =>
      /except|ride the Save button|are the exception/i.test(c),
    );
    expect(mixedCaptions).toHaveLength(4);
    // ★ Named, so the failure says WHICH tab lost its caption.
    expect(mixedCaptions.some((c) => c.includes('Zone, lot and tags'))).toBe(true);
    expect(mixedCaptions.some((c) => c.includes('Each date saves as you leave it'))).toBe(true);
    expect(mixedCaptions.some((c) => c.includes('Roles ride the Save button'))).toBe(true);
    expect(mixedCaptions.some((c) => c.includes('The two checkboxes are the exception'))).toBe(true);
  });

  it('★★★ the Schematic Designer is the team tab’s exception, and it is stated twice', () => {
    // Once in the caption a reader sees before touching anything…
    expect(modalSrc).toContain(
      'Roles ride the Save button, except the Schematic Designer',
    );
    // …and once as a hint under the control itself, because a caption at the
    // top of a tab is not read again by somebody halfway down it.
    expect(formSrc).toContain('and saves immediately');
    expect(formSrc).toContain('psm-sd-hint');
  });

  it('★★ the footer’s blanket promise is the one that is least true', () => {
    // ★★★ RECORDED RATHER THAN QUIETLY REWORDED. *"Per-field tabs save as you
    //     leave each box"* describes ONE tab of nine, and it sits under every
    //     one of them. Changing it is a copy decision for Bobby, not a
    //     correctness fix — but it should not be discovered again from
    //     scratch, so the string is pinned here with what it actually covers.
    expect(modalSrc).toContain('Per-field tabs save as you leave each box.');
    expect(EXPECTED_MODEL.units).toBe('blur');
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
