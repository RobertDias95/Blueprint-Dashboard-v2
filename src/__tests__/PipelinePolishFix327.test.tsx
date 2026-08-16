import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Permit } from '../lib/database.types';
import type { PermitCardSummary } from '../lib/dashboardCardSummary';
import { permitUrgency } from '../lib/urgencyHelpers';

// fix-327 — give a project an edge, and the columns a visible fold.
//
// 1. A project was an address line plus a stack of chips, grouped by spacing and
//    a left rail. Bobby: "maybe a very clean way to kind of border around a
//    project." ★ The border is the RESTING state; the hover grey he explicitly
//    asked to keep is the HOVER state. Neither replaces the other.
// 2. fix-324 made every group foldable by clicking its header and nothing said
//    so. ★★ The same defect fix-320 fixed on the ribbon: a control with no
//    border, no background and no icon does not read as a control.

const mocks = vi.hoisted(() => ({ cards: new Map<number, PermitCardSummary>() }));
vi.mock('../hooks/useDashboardPermitCards', () => ({
  useDashboardPermitCards: () => ({ data: mocks.cards, isLoading: false, error: null }),
}));

import AddrGroup from '../components/Dashboard/AddrGroup';

const NOW = new Date('2026-08-14T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'proj-1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: 'BP-1',
    da: 'Cam',
    dm: 'Brittani',
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    extras: null,
    updated_at: '2026-08-10T12:00:00Z',
    ...over,
  } as Permit;
}

const RED_PERMIT = makePermit({ id: 1, num: 'BP-1', target_submit: '2026-07-01' });
const CALM_PERMIT = makePermit({
  id: 2,
  num: 'DEM-2',
  type: 'Demolition',
  target_submit: '2027-06-01',
});

function renderGroup(
  over: { permits?: Permit[]; isHighlighted?: boolean; isOpen?: boolean; onHover?: () => void } = {},
) {
  mocks.cards.clear();
  return render(
    <MemoryRouter>
      <AddrGroup
        address="123 Main St"
        juris="Seattle"
        projectId="proj-1"
        permits={over.permits ?? [RED_PERMIT, CALM_PERMIT]}
        stage="de"
        cyclesByPermit={new Map()}
        reviewersByPermit={new Map()}
        keyDateLabel="Target Submit"
        getKeyDate={(p) => p.target_submit}
        isOpen={over.isOpen ?? false}
        isHighlighted={over.isHighlighted ?? false}
        onToggle={() => {}}
        onHover={over.onHover ?? (() => {})}
        onLeave={() => {}}
      />
    </MemoryRouter>,
  );
}

const groupEl = () => screen.getByTestId('addr-group-de');

// --------------------------------------------------------- 1 · the edge -----

describe('fix-327 #1: a project reads as one bordered object', () => {
  it('★ the address and its permits sit inside ONE bordered block', () => {
    renderGroup();
    const el = groupEl();
    // A contained edge on all four sides, with a radius — not a rail on one.
    expect(el.style.border).toBe('1px solid var(--color-border)');
    expect(parseFloat(el.style.borderRadius)).toBeGreaterThan(0);
    // ...and the address and the permit chips are both INSIDE it, which is what
    // makes it one object rather than a box around part of one.
    expect(within(el).getByText('123 Main St')).toBeInTheDocument();
    expect(within(el).getByText('Building Permit')).toBeInTheDocument();
    expect(within(el).getByText('Demolition')).toBeInTheDocument();
  });

  // ★ Bobby named the furniture: "a gray bar that runs vertically, and then
  // these thinner gray bars that run horizontally". Once the block has its own
  // edge, a rail AND a rule AND a gap are three things saying "new project".
  it('★ the 3px left rail and the bottom rule are gone', () => {
    renderGroup();
    const el = groupEl();
    expect(el.style.borderLeft).toBeFalsy();
    expect(el.style.borderBottom).toBeFalsy();
    // The separation the bottom rule used to do is now a gap between blocks.
    expect(parseFloat(el.style.marginBottom)).toBeGreaterThan(0);
  });

  // ★ THE LIGHTEST EDGE THAT CONTAINS. A dozen projects to a column means a
  // heavy border turns the list into a grid of boxes.
  it('★ the edge is a 1px hairline in the existing token, not a heavy line', () => {
    renderGroup();
    const border = groupEl().style.border;
    expect(border).toContain('1px');
    expect(border).toContain('var(--color-border)');
    // No second, heavier edge sneaking in as a shadow.
    expect(groupEl().style.boxShadow).toBeFalsy();
  });

  // ★★ THE BEHAVIOUR BOBBY ASKED TO KEEP: "when you hover over a project I do
  // like how it goes gray and that identifies other projects as well."
  it('★ the hover grey still fires, and still distinguishes the hovered project', () => {
    const onHover = vi.fn();
    const { rerender } = renderGroup({ onHover });

    // Resting: the surface colour, and the hover handler is wired.
    expect(groupEl().style.background).toBe('var(--color-surface)');
    fireEvent.mouseEnter(groupEl());
    expect(onHover).toHaveBeenCalled();

    // Highlighted (what the parent does in response): the grey, on THIS project.
    rerender(
      <MemoryRouter>
        <AddrGroup
          address="123 Main St"
          juris="Seattle"
          projectId="proj-1"
          permits={[RED_PERMIT, CALM_PERMIT]}
          stage="de"
          cyclesByPermit={new Map()}
          reviewersByPermit={new Map()}
          keyDateLabel="Target Submit"
          getKeyDate={(p) => p.target_submit}
          isOpen={false}
          isHighlighted
          onToggle={() => {}}
          onHover={onHover}
          onLeave={() => {}}
        />
      </MemoryRouter>,
    );
    expect(groupEl().style.background).toBe('var(--color-s2)');
    // ★ And the border did NOT become the hover state — it is unchanged, which
    // is what keeps the two jobs separate.
    expect(groupEl().style.border).toBe('1px solid var(--color-border)');
    expect(groupEl().style.transition).toContain('background');
  });

  // ★ fix-309's rule, re-asserted on the new edge: the project is neutral even
  // when it holds a red permit.
  it('★ the border carries no status colour, with a red permit inside it', () => {
    expect(permitUrgency(RED_PERMIT, [], 'de')).toBe('red');
    expect(permitUrgency(CALM_PERMIT, [], 'de')).toBe('ok');
    renderGroup();
    const el = groupEl();
    const painted = [el.style.border, el.style.background, el.style.borderColor]
      .filter(Boolean)
      .join(' | ');
    expect(painted).not.toMatch(/#fee2e2|#fef9c3|#ef4444|red|yellow|amber|rgb\(254/i);
    expect(el.dataset.urgencyNeutral).toBe('true');
    // ...while the permit chip inside it is still red, so this is not vacuous.
    const chip = within(el).getByText('Building Permit').closest('span') as HTMLElement;
    expect(chip.style.background).toBe('rgb(254, 226, 226)');
  });

  it('the opened ring still fires on top of the new edge', () => {
    renderGroup({ isOpen: true });
    expect(groupEl().style.outline).toContain('var(--color-de)');
  });
});

// ------------------------------------------------ 2 · the collapse control --

const dashMocks = vi.hoisted(() => ({
  projects: [] as unknown[],
  permits: [] as unknown[],
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: dashMocks.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: dashMocks.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useNumberEntrySweep', () => ({ useNumberEntrySweep: () => undefined }));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
vi.mock('../hooks/useSelfScope', () => ({
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: null, scope: 'all' },
    ready: true,
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'user-1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const real = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...real,
    useTeamMembers: () => ({
      all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
      schematics: [], activeMemberNames: [], isLoading: false, error: null,
    }),
  };
});

import Dashboard from '../pages/Dashboard';

function renderDash() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
  dashMocks.projects = [{ id: 'p1', address: '10719 Phinney Ave N', juris: 'Seattle' }];
  dashMocks.permits = [
    {
      id: 1, project_id: 'p1', type: 'Building Permit', num: null,
      status: 'Reviews In Process', stage: null, stage_override: null,
      da: null, dual_da: null, dm: null, ent_lead: null, permit_owner: null,
      nickname: null, struct_address: null, parent_permit_id: null,
      target_submit: null, approval_date: null, actual_issue: null, corr_issued: null,
      extras: null,
      permit_cycles: [
        {
          id: 'c1', permit_id: 1, cycle_index: 1, submitted: '2026-05-01',
          city_target: null, corr_issued: null, resubmitted: null, intake_accepted: null,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
  ];
});

const GROUPS = ['de', 'pm', 'ap', 'is'] as const;

describe('fix-327 #2: every group header says it folds', () => {
  it('★ all four groups carry a visible collapse control', () => {
    renderDash();
    for (const key of GROUPS) {
      const chip = screen.getByTestId(`pipeline-group-collapse-${key}`);
      expect(chip).toBeInTheDocument();
      // ★ The three things a bare glyph was missing (fix-320's diagnosis):
      // a border, a background, and a mark that reads as a control.
      expect(chip.style.border).toContain('1px solid');
      expect(chip.style.background).toBeTruthy();
      expect(chip.style.background).not.toBe('transparent');
      expect(chip.textContent).toBeTruthy();
    }
  });

  it('★ the control folds the group, and the header still folds it too', () => {
    renderDash();
    // Clicking the chip: it lives inside the header button, so the header is
    // what receives the click — one action, one hit target, no double-toggle.
    fireEvent.click(screen.getByTestId('pipeline-group-collapse-de'));
    expect(screen.getByTestId('pipeline-group-de').dataset.collapsed).toBe('true');
    // The whole header is still the control it always was.
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-de'));
    expect(screen.getByTestId('pipeline-group-de').dataset.collapsed).toBe('false');
  });

  it('★ collapsed, the control is still there on the spine, and expands it', () => {
    renderDash();
    // ap and is start folded (fix-324b / register #68).
    const chip = screen.getByTestId('pipeline-group-collapse-ap');
    expect(chip).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-group-ap').dataset.collapsed).toBe('true');
    fireEvent.click(chip);
    expect(screen.getByTestId('pipeline-group-ap').dataset.collapsed).toBe('false');
  });

  // ★ NO MOTION. fix-320 rejected the pulse and that decision stands; the glyph
  // turns on a state change, which is a transform, not something moving at rest.
  it('★ nothing about the control animates', () => {
    renderDash();
    for (const key of GROUPS) {
      const chip = screen.getByTestId(`pipeline-group-collapse-${key}`);
      const cs = getComputedStyle(chip);
      expect(['', 'none']).toContain(cs.animation ?? '');
      expect(['', 'none']).toContain(cs.animationName ?? '');
      expect(chip.outerHTML).not.toMatch(/animate|pulse|keyframes|blink/i);
    }
  });

  // ★ THE DECISION THE BRIEF ASKED FOR: sub-columns get a QUIETER affordance —
  // the same glyph, no tint, no border. Eight tinted chips on one screen, in
  // headers that already carry a dot, a title and two numbers, is more furniture
  // than the header can hold; the group chip teaches the interaction and the
  // sub-header only has to confirm it.
  it('★ sub-columns get a quieter mark, not a second chip', () => {
    renderDash();
    const sub = screen.getByTestId('pipeline-sub-collapse-Under Review');
    expect(sub).toBeInTheDocument();
    expect(sub.style.border).toBeFalsy();
    expect(sub.style.background).toBeFalsy();
    expect(sub.className).toContain('text-dim');
    // The group's is the loud one, by design.
    expect(screen.getByTestId('pipeline-group-collapse-pm').style.border).toContain('1px solid');
  });

  it('sub-columns still fold independently', () => {
    renderDash();
    fireEvent.click(screen.getByTestId('pipeline-sub-toggle-Corrections'));
    expect(screen.getByTestId('pipeline-sub-Corrections').dataset.collapsed).toBe('true');
    expect(screen.getByTestId('pipeline-sub-Under Review').dataset.collapsed).toBe('false');
    // fix-324's rule: the count stays on a folded spine.
    expect(screen.getByTestId('pipeline-sub-count-Corrections')).toBeInTheDocument();
  });
});

// --------------------------------------------------- prior contracts -------

describe('fix-327: what must not have moved', () => {
  it('fix-324b still folds Approved and Issued by default', () => {
    renderDash();
    expect(screen.getByTestId('pipeline-group-de').dataset.collapsed).toBe('false');
    expect(screen.getByTestId('pipeline-group-pm').dataset.collapsed).toBe('false');
    expect(screen.getByTestId('pipeline-group-ap').dataset.collapsed).toBe('true');
    expect(screen.getByTestId('pipeline-group-is').dataset.collapsed).toBe('true');
  });

  it('the four columns are still siblings in one row', () => {
    renderDash();
    const row = screen.getByTestId('pipeline-columns');
    expect(row.children).toHaveLength(4);
    for (const key of GROUPS) {
      expect(screen.getByTestId(`pipeline-group-${key}`).parentElement).toBe(row);
    }
  });

  // ★ The borders add height per project, so the page-does-not-scroll contract
  // is re-checked rather than assumed. jsdom cannot measure it — what it CAN
  // check is that the ownership is unchanged: the page is a bounded column and
  // every scroller is still a sub-column list. The pixel check was done in
  // headless Chrome at 1440x900 (screenshot in the PR).
  it('★ the page still owns no scrollbar; the lists do', () => {
    renderDash();
    const page = screen.getByTestId('pipeline-page');
    expect(page.className).toContain('h-full');
    expect(page.className).not.toMatch(/overflow-(auto|y-auto|scroll)/);
    const scrollers = Array.from(
      screen.getByTestId('pipeline-columns').querySelectorAll('[class*="overflow-y-auto"]'),
    );
    expect(scrollers.length).toBeGreaterThan(0);
    for (const el of scrollers) {
      expect(el.getAttribute('data-scroll-bucket')).toBe('true');
    }
  });

  it('no count, grouping or card content changed', () => {
    renderDash();
    expect(screen.getByTestId('pipeline-sub-count-Under Review').textContent).toBe('1');
    expect(screen.getAllByTestId(/^addr-group-/).length).toBeGreaterThan(0);
    expect(screen.getByText('10719 Phinney Ave N')).toBeInTheDocument();
  });
});
