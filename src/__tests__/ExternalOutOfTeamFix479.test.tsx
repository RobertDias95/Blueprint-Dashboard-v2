import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import headerSrc from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import modalSrc from '../components/ProjectDetail/ProjectSettingsModal.tsx?raw';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-479 §A + §B (P-132) — EXTERNAL LEAVES THE TEAM CARD, AND
//                                BUILDER/OWNER STOPS PUSHING
// ===========================================================================
//
// Bobby, 2026-09-02:
//   §A  *"under the team, under project overview, it's still showing the
//        external team here. That external team now, under team, is no longer
//        going to be there. We are going to move that external team over to
//        consultants."*
//   §B  *"when you click to expand, it pushes everything vertically down, and
//        maybe it would just overlap like the internal team when you expand and
//        collapse. That way the vertical height isn't pushing everything down."*
//
// ---------------------------------------------------------------------------
// ★★★ THIS FILE IS WHERE FOUR RETIRED SUITES LAND, so the assertions were
//     REPLACED rather than deleted:
//
//   · ProjectOverviewExternalTeam.test.tsx  — 11 tests, whole file removed:
//     every one addressed `pd-ext-*` testids inside a section that no longer
//     renders. Its subject (`ExternalTeamEditor`) is gone from the file.
//   · ProjectSettings.test.tsx              — 13 tests, whole file removed:
//     its subject was `ProjectExternalTeamPanel`, deleted in §D.
//   · OverviewRowFix423.test.tsx §C         — 4 tests, retired in place with
//     the note that the whole 251px left rather than collapsing to 51px.
//   · The Team-card ORDER lists in ChatPreviewFix346 / MilestonesCard /
//     OverviewUiPassFix331 / ProjectOverviewCards / ProjectOverviewLayout —
//     each lost ONE entry and still asserts the order whole.
//
// The replacement for all of them is below: the section is ABSENT, from both
// surfaces, and the blob's readers are untouched.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn().mockResolvedValue({ overlapKind: null }), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({ data: [], isLoading: false, error: null }),
    useMentionablePeople: () => ({ data: [], isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [], isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));
// ★ fix-475's rule, reused: the Consultants card READS, and these suites share
//   a supabase mock that shifts a queued response. Inert here.
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

/** ★ A project that WOULD have drawn a full External block before this ticket:
 *  five disciplines assigned, which fix-423 measured at 256px. */
const FIVE_EXTERNAL = {
  Civil: 'Prism',
  Surveyor: 'Emerald',
  Structural: 'Swenson Say',
  Arborist: 'Seattle Tree Consulting',
  Geotech: 'Nelson Geotechnical',
};

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-479',
    address: '224 2nd Ave N',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: 'Greg',
    external_team: {},
    builder_id: null,
    builder_name: 'Cam',
    builder_company: 'Blue Fern Development',
    builder_email: 'cam@bluefern.test',
    builder_phone: '206-555-0100',
    builder_address: '1000 4th Ave, Seattle',
    poc_name: 'Briana',
    poc_email: 'briana@bluefern.test',
    permit_order: [],
    entitlement_lead: 'Miles',
    design_manager: 'Jade',
    go_date: '2026-06-05',
    units: null,
    product_types: [],
    project_tags: null,
    schematic_designer: ['Ana'],
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function bpFixture(): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-479',
    type: 'Building Permit',
    num: '7133442-CN',
    da: 'Nicky',
    ent_lead: 'Miles',
    dd_start: null,
    dd_end: null,
    target_submit: null,
    target_submit_is_manual: false,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
  } as unknown as PermitWithCycles;
}

function renderHeader(project = projectFixture()) {
  const permits = [bpFixture()];
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={permits[0]} />,
    { wrapper },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ---------------------------------------------------------------------------
// §A — the section is gone
// ---------------------------------------------------------------------------
describe('fix-479 §A: External has left the Team card', () => {
  it('★★★ the Team card renders Builder/Owner → Internal → Chat → button', () => {
    // ★ Asserted as an ORDERED LIST, not as "External is absent" — four presence
    //   checks would pass on a card that had grown a fifth section back.
    renderHeader();
    const ids = Array.from(
      screen.getByTestId('project-overview-team').querySelectorAll(':scope > section'),
    ).map((s) => (s as HTMLElement).dataset.testid);
    expect(ids).toEqual([
      'project-overview-team-builder',
      'project-overview-team-internal',
      'project-overview-team-chat',
      'pd-chat-section',
    ]);
  });

  it('★★★ …even on a project with FIVE firms recorded', () => {
    // ★★ THE CASE THAT WOULD HAVE FAILED A LAZY IMPLEMENTATION. Hiding the
    //    section when the blob is empty would have passed the test above and
    //    left the 256px block on exactly the 54 projects that have one.
    renderHeader(projectFixture({ external_team: FIVE_EXTERNAL } as Partial<Project>));
    expect(screen.queryByTestId('project-overview-team-external')).toBeNull();
    expect(screen.queryByTestId('pd-ext-section')).toBeNull();
    for (const d of Object.keys(FIVE_EXTERNAL)) {
      expect(screen.queryByTestId(`pd-ext-row-${d}`)).toBeNull();
    }
    // ★ And the firm names are nowhere on the card — not merely unlabelled.
    const team = screen.getByTestId('project-overview-team');
    for (const firm of Object.values(FIVE_EXTERNAL)) {
      expect(within(team).queryByText(firm)).toBeNull();
    }
  });

  it('★★★ the editor is gone from the FILE, not just from the render', () => {
    expect(headerSrc).not.toContain('function ExternalTeamEditor');
    expect(headerSrc).not.toContain('<ExternalTeamEditor');
    // ★ …and so are the five imports it was the only user of. A dead import is
    //   how the next reader concludes the feature is still here.
    //
    // ★★ ASSERTED ON THE IMPORT STATEMENTS, NOT ON THE BARE NAMES. The file
    //    still NAMES three of these — in the fix-479 §A note explaining that
    //    `lib/externalTeam`, `ExternalFirmSelect` and `useExternalTeamShowRules`
    //    deliberately survive elsewhere. A `not.toContain('useExternal…')` would
    //    forbid writing that note down, which is the opposite of what is wanted.
    expect(headerSrc).not.toContain("import ExternalFirmSelect from");
    expect(headerSrc).not.toContain("import { useExternalTeamShowRules }");
    expect(headerSrc).not.toContain("import { useExternalTeamDirectory }");
    expect(headerSrc).not.toContain("import { WAITING_ON_OPTIONS }");
    expect(headerSrc).not.toContain("} from '../../lib/externalTeam';");
    // ★ …and nothing in the file CALLS them.
    expect(headerSrc).not.toContain('useExternalTeamShowRules(');
    expect(headerSrc).not.toContain('useExternalTeamDirectory(');
    expect(headerSrc).not.toContain('<ExternalFirmSelect');
  });

  it('★★★ but the BLOB and its shared vocabulary are NOT deleted', async () => {
    // ★★★ THE POINT OF THE WHOLE TICKET. `projects.external_team` has five live
    //     readers that fix-479 does not touch; deleting the module would have
    //     taken My Tasks → Waiting and the vendor forecast with it.
    const externalTeam = await import('../lib/externalTeam');
    expect(typeof externalTeam.asExternalTeamBlob).toBe('function');
    expect(typeof externalTeam.resolveExternalFirm).toBe('function');
    const showRules = await import('../hooks/useExternalTeamShowRules');
    expect(typeof showRules.useExternalTeamShowRules).toBe('function');
    const select = await import('../components/ProjectDetail/ExternalFirmSelect');
    expect(typeof select.default).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// §B — the expanded Builder/Owner floats
// ---------------------------------------------------------------------------
describe('fix-479 §B: Builder/Owner expands over the roster, not through it', () => {
  it('★ collapsed, it is Owner + Business and nothing else', () => {
    renderHeader();
    const btn = screen.getByTestId('pd-builder-disclose');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(within(btn).getByText('Cam')).toBeInTheDocument();
    expect(within(btn).getByText('Blue Fern Development')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-builder-expanded')).toBeNull();
  });

  it('★★★ the Team card takes NO extra height when it opens — the whole ask', () => {
    // ★★★ MEASURED, NOT ASSERTED, AND jsdom CANNOT MEASURE. Every rect and
    //     every offsetHeight in jsdom is 0, so "412 === 412" here would prove
    //     nothing. What CAN be proven in jsdom is the mechanism that makes the
    //     heights identical: the panel is OUT OF FLOW. A `position: fixed` box
    //     contributes nothing to any ancestor's layout, so the Team card's
    //     height cannot move whatever the panel contains.
    //
    // ★★ The real numbers are in docs/FIX_479_OVERVIEW_HEIGHT_MEASUREMENT.md,
    //    measured in Chrome at 1920 and 1440: Team 412px closed and 412px open,
    //    row 412px closed and 412px open.
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    const panel = screen.getByTestId('pd-builder-expanded');
    expect(panel.style.position).toBe('fixed');
    // ★ …and it is a sibling of the trigger inside the Team card, not a portal:
    //   OVERVIEW_CELL_ATTR measurements and fix-423's row logic see the same
    //   tree they saw before.
    expect(screen.getByTestId('project-overview-team')).toContainElement(panel);
  });

  it('★★★ the panel is CAPPED and scrolls rather than clipping', () => {
    // ★ On a short viewport the card is taller than the space under the
    //   trigger. The hook caps maxHeight against the viewport and the panel
    //   scrolls internally — the fix-64 lesson, where a 6-reviewer popup near
    //   the page bottom rendered five.
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    const panel = screen.getByTestId('pd-builder-expanded');
    expect(panel.style.overflowY).toBe('auto');
    expect(panel.style.maxHeight).not.toBe('');
  });

  it('★★★ every field inside is still editable — it MOVED, it did not become a preview', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    const panel = screen.getByTestId('pd-builder-expanded');
    // The picker, the four read-only catalogue lines, and the two per-project
    // free-text fields — exactly the card fix-475 rendered inline.
    expect(within(panel).getByTestId('pd-builder-name')).toBeInTheDocument();
    expect(within(panel).getByTestId('pd-builder-company')).toBeInTheDocument();
    expect(within(panel).getByTestId('pd-builder-email')).toBeInTheDocument();
    expect(within(panel).getByTestId('pd-builder-phone')).toBeInTheDocument();
    expect(within(panel).getByTestId('pd-builder-address')).toBeInTheDocument();
    const poc = within(panel).getByTestId('pd-poc-name') as HTMLInputElement;
    const pocEmail = within(panel).getByTestId('pd-poc-email') as HTMLInputElement;
    expect(poc.disabled).toBe(false);
    expect(pocEmail.disabled).toBe(false);
    fireEvent.change(poc, { target: { value: 'Dana' } });
    expect(poc.value).toBe('Dana');
  });

  it('★★ it closes on Collapse, on Escape, and on a click outside', () => {
    renderHeader();
    const btn = screen.getByTestId('pd-builder-disclose');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(btn);
    expect(screen.queryByTestId('pd-builder-expanded')).toBeNull();

    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('pd-builder-expanded')).toBeNull();

    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByTestId('project-overview-team-internal'));
    expect(screen.queryByTestId('pd-builder-expanded')).toBeNull();
  });

  it('★★ a click INSIDE the panel does not close it', () => {
    // ★ `mousedown` on the layer must be ignored, or every field in it would
    //   dismiss the thing you are trying to edit.
    renderHeader();
    fireEvent.click(screen.getByTestId('pd-builder-disclose'));
    fireEvent.mouseDown(screen.getByTestId('pd-poc-name'));
    expect(screen.getByTestId('pd-builder-expanded')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §D — one place picks a firm
// ---------------------------------------------------------------------------
describe('fix-479 §D: Project Settings no longer picks a consultant firm', () => {
  it('★★★ the External Team section is gone from the Settings modal', () => {
    expect(modalSrc).not.toContain('<Section title="External Team"');
    expect(modalSrc).not.toContain('<ProjectExternalTeamPanel');
    expect(modalSrc).not.toContain("import ProjectExternalTeamPanel");
  });

  it('★★★ the panel component itself is deleted — this was its only call site', () => {
    // ★ Asserted with `import.meta.glob` rather than a dynamic `import()`: Vite
    //   resolves a literal import path at TRANSFORM time, so a test that tried
    //   to import the missing module failed the whole FILE rather than passing.
    const modules = import.meta.glob('../components/ProjectDetail/*.tsx');
    const names = Object.keys(modules).map((k) => k.split('/').pop());
    expect(names).not.toContain('ProjectExternalTeamPanel.tsx');
    // ★ …and the glob really is looking in the right place.
    expect(names).toContain('ExternalFirmSelect.tsx');
    expect(names).toContain('ConsultantsCard.tsx');
  });

  it('★★ the DIRECTORY editor is a different screen and is untouched', async () => {
    // Settings → Lists & Catalogs → External Team is the firm CATALOGUE, not a
    // per-project picker. Removing the per-project editor must not take it.
    const dir = await import('../components/Settings/ExternalTeamDirectoryEditor');
    expect(typeof dir.default).toBe('function');
  });
});
