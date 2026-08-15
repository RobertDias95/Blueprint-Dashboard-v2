import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import dashboardSrc from '../pages/Dashboard.tsx?raw';
import {
  loadPipelineCollapsed,
  pipelineGroupKey,
  pipelineSubKey,
  savePipelineCollapsed,
} from '../lib/pipelinePrefs';

// fix-324 — register #66–#69. Four collapsible columns on the Pipeline, built
// to Pipeline_RightRail_Mockup.html, which Bobby signed off: "that's it."
//
// ★★ THE POINT OF THE TICKET IS SIBLINGHOOD. The first attempt nested Approved
// and Issued inside a shared 300px rail. Folded, they kept that width and each
// owned half the height — short and wide. Bobby: "we want approved and issued to
// look like permitting, vertical top to bottom of the screen." A column can only
// fold to a full-height spine if it is a DIRECT CHILD of the row, so every
// assertion below about folding is paired with one about parentage.
//
// ★ jsdom has NO LAYOUT ENGINE. Every getBoundingClientRect is 0, so "44px wide
// and full height" cannot be measured here and a pixel comparison would pass
// vacuously. What IS honest: the flex declaration that produces the width, and
// the structural facts that produce the height — the section is a direct child
// of a row-direction flex container, and it is not height-capped. Both are read
// back off the rendered DOM.

const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const userIdRef = vi.hoisted(() => ({ current: 'user-1' as string | null }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: projectsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: permitsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useNumberEntrySweep', () => ({ useNumberEntrySweep: () => undefined }));
vi.mock('../hooks/useAllProjectHolds', () => ({}));
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
// The collapse preference is keyed per user, like the ribbon's.
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: userIdRef.current ? { id: userIdRef.current, email: 'bobby@example.com' } : null,
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: 'admin' }],
      activeTenantId: 'test-tenant',
    }),
}));
// The roster lookup StageFilters gained in fix-321 — not this ticket's subject.
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

function cycle(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', permit_id: 0, cycle_index: 1, submitted: '2026-05-01',
    city_target: null, corr_issued: null, resubmitted: null, intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** A permit in "Under Review" unless the caller says otherwise. */
function permit(over: Record<string, unknown>) {
  return {
    id: 0, project_id: 'p1', type: 'Building Permit', num: null,
    status: 'Reviews In Process', stage: null, stage_override: null,
    da: null, dual_da: null, dm: null, ent_lead: null, permit_owner: null,
    nickname: null, struct_address: null, parent_permit_id: null,
    target_submit: null, approval_date: null, actual_issue: null, corr_issued: null,
    permit_cycles: [cycle()], extras: null,
    ...over,
  };
}

function renderDash() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
  userIdRef.current = 'user-1';
  projectsRef.current = [
    { id: 'p1', address: '10719 Phinney Ave N', juris: 'Seattle' },
    { id: 'p2', address: '1301 6th Ave N', juris: 'Seattle' },
    { id: 'p3', address: '3626 164th Pl SE', juris: 'Bellevue' },
  ];
  permitsRef.current = [
    // two Under Review
    permit({ id: 1, project_id: 'p1' }),
    permit({ id: 2, project_id: 'p2' }),
    // one in corrections
    permit({
      id: 3,
      project_id: 'p3',
      status: 'Corrections Required',
      permit_cycles: [cycle({ id: 'c3', corr_issued: '2026-06-01' })],
    }),
  ];
});

const COLUMN_ORDER = ['de', 'pm', 'ap', 'is'] as const;

function columnsRow(): HTMLElement {
  return screen.getByTestId('pipeline-columns');
}
function group(key: string): HTMLElement {
  return screen.getByTestId(`pipeline-group-${key}`);
}

// ------------------------------------------------------- one row, four kids --

describe('fix-324: four columns, siblings in one row', () => {
  it('renders Design & Engineering · Permitting · Approved · Issued, in order', () => {
    renderDash();
    const kids = Array.from(columnsRow().children) as HTMLElement[];
    expect(kids.map((el) => el.dataset.testid ?? el.getAttribute('data-testid'))).toEqual(
      COLUMN_ORDER.map((k) => `pipeline-group-${k}`),
    );
    expect(group('de').textContent).toContain('Design & Engineering');
    expect(group('pm').textContent).toContain('Permitting');
    expect(group('ap').textContent).toContain('Approved');
    expect(group('is').textContent).toContain('Issued');
  });

  // ★★ The structural fact the ticket turns on. If a later hand wraps Approved
  // and Issued in a rail again, this fails before anyone notices on screen.
  it('★ each of the four is a DIRECT child of the row — nothing is nested in a rail', () => {
    renderDash();
    for (const key of COLUMN_ORDER) {
      expect(group(key).parentElement).toBe(columnsRow());
    }
    expect(columnsRow().children).toHaveLength(4);
    // Row direction, so children stretch to the row's full height. A column
    // direction here would give each column a share of the height instead —
    // which is exactly the short-and-wide bug.
    expect(columnsRow().className).toContain('flex');
    expect(columnsRow().className).not.toContain('flex-col');
  });

  it('Approved and Issued are narrower than the working columns when open', () => {
    renderDash();
    expect(group('ap').dataset.narrow).toBe('true');
    expect(group('is').dataset.narrow).toBe('true');
    expect(group('ap').style.flex).toContain('264px');
    expect(group('de').dataset.narrow).toBe('false');
    // The two working columns share what is left.
    expect(group('de').style.flex).toBe('1 1 0%');
    expect(group('pm').style.flex).toBe('1 1 0%');
  });
});

// ------------------------------------------------------------ folding -------

describe('fix-324: a folded column is a full-height spine', () => {
  it('★ folds to 44px AND keeps the full height', () => {
    renderDash();
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-is'));
    const issued = group('is');
    expect(issued.dataset.collapsed).toBe('true');
    // Width: the flex declaration that produces 44px.
    expect(issued.style.flex).toBe('0 0 44px');
    // Height: it is still a direct child of the row (so it stretches), its
    // header owns the whole column, and nothing caps it. jsdom cannot measure
    // the pixels; these are the three facts that produce them.
    expect(issued.parentElement).toBe(columnsRow());
    expect(issued.style.maxHeight).toBeFalsy();
    expect(issued.style.height).toBeFalsy();
    const header = screen.getByTestId('pipeline-group-toggle-is');
    expect(header.className).toContain('h-full');
  });

  it('folded, it shows its title and count and drops its lists', () => {
    renderDash();
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-is'));
    const issued = group('is');
    expect(issued.textContent).toContain('Issued');
    // The permit total stays — folding puts a column away, it does not hide
    // how much is in it.
    expect(issued.textContent).toMatch(/\d/);
    expect(within(issued).queryByTestId(/^pipeline-sub-/)).toBeNull();
    expect(issued.querySelector('[data-scroll-bucket]')).toBeNull();
  });

  it('all four fold, and opening one gives it the room back', () => {
    renderDash();
    for (const key of COLUMN_ORDER) {
      fireEvent.click(screen.getByTestId(`pipeline-group-toggle-${key}`));
    }
    for (const key of COLUMN_ORDER) {
      expect(group(key).style.flex).toBe('0 0 44px');
    }
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-pm'));
    expect(group('pm').style.flex).toBe('1 1 0%');
    expect(group('de').style.flex).toBe('0 0 44px');
  });
});

// ------------------------------------------------------ sub-columns ---------

describe('fix-324: sub-columns fold independently', () => {
  it('★ folding Corrections leaves Under Review holding the width', () => {
    renderDash();
    fireEvent.click(screen.getByTestId('pipeline-sub-toggle-Corrections'));

    const corrections = screen.getByTestId('pipeline-sub-Corrections');
    const underReview = screen.getByTestId('pipeline-sub-Under Review');
    expect(corrections.dataset.collapsed).toBe('true');
    expect(corrections.style.flex).toBe('0 0 38px');
    // ★ The one that matters daily: the entitlements person's column is
    // untouched and still holds the room.
    expect(underReview.dataset.collapsed).toBe('false');
    expect(underReview.style.flex).toBe('1 1 0%');
    expect(underReview.querySelector('[data-scroll-bucket]')).not.toBeNull();
  });

  it("★ and Corrections' count is still visible on its spine", () => {
    renderDash();
    const before = screen.getByTestId('pipeline-sub-count-Corrections').textContent;
    fireEvent.click(screen.getByTestId('pipeline-sub-toggle-Corrections'));
    const after = screen.getByTestId('pipeline-sub-count-Corrections');
    expect(after).toBeInTheDocument();
    expect(after.textContent).toBe(before);
    expect(after.textContent).toBe('1'); // the fixture's single corrections permit
    // Its list is gone; the number is not.
    expect(
      screen.getByTestId('pipeline-sub-Corrections').querySelector('[data-scroll-bucket]'),
    ).toBeNull();
  });

  it('folding the parent group does not lose a sub-column choice', () => {
    renderDash();
    fireEvent.click(screen.getByTestId('pipeline-sub-toggle-Corrections'));
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-pm'));
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-pm'));
    expect(screen.getByTestId('pipeline-sub-Corrections').dataset.collapsed).toBe('true');
  });
});

// ------------------------------------------------------- persistence --------

describe('fix-324: the choice persists, per user', () => {
  // ★ SAME MECHANISM AS THE RIBBON (fix-313) — per-user localStorage, no second
  // invention. The key namespace is the only thing that differs.
  it('★ survives a remount', () => {
    const first = renderDash();
    fireEvent.click(screen.getByTestId('pipeline-group-toggle-ap'));
    fireEvent.click(screen.getByTestId('pipeline-sub-toggle-Corrections'));
    expect(group('ap').dataset.collapsed).toBe('true');
    first.unmount();

    renderDash();
    expect(group('ap').dataset.collapsed).toBe('true');
    expect(screen.getByTestId('pipeline-sub-Corrections').dataset.collapsed).toBe('true');
    expect(group('de').dataset.collapsed).toBe('false');
  });

  it('is stored per user, so one login cannot fold another\'s columns', () => {
    savePipelineCollapsed('user-1', [pipelineGroupKey('is')]);
    savePipelineCollapsed('user-2', []);
    expect(loadPipelineCollapsed('user-1')).toEqual(['g:is']);
    expect(loadPipelineCollapsed('user-2')).toEqual([]);
    // Never chosen → null, so the caller opens everything rather than
    // inheriting somebody else's answer.
    expect(loadPipelineCollapsed('user-3')).toBeNull();
    expect(loadPipelineCollapsed(null)).toBeNull();
  });

  it('a corrupt stored value opens everything rather than throwing', () => {
    window.localStorage.setItem('pipeline.collapsed.user-1', '{not json');
    expect(loadPipelineCollapsed('user-1')).toBeNull();
    renderDash();
    for (const key of COLUMN_ORDER) {
      expect(group(key).dataset.collapsed).toBe('false');
    }
  });

  it('the stored key is the STAGE CODE, so renaming a title cannot spring it open', () => {
    // fix-324 §4 renamed "Approve" to "Approved"; nobody's folded columns
    // should have re-opened because of a word.
    expect(pipelineGroupKey('ap')).toBe('g:ap');
    expect(pipelineSubKey('pm', 'Corrections')).toBe('s:pm:Corrections');
  });
});

// ------------------------------------------------------------ §4 rename -----

describe('fix-324 §4: Approve became Approved', () => {
  it('★ the third column reads Approved, and the bare word is gone', () => {
    renderDash();
    expect(group('ap').textContent).toContain('Approved');
    expect(screen.queryByText('Approve')).toBeNull();
  });

  it('the stage code, the testids and the sub-column wording are untouched', () => {
    renderDash();
    // The stage code is still `ap` — a rename that reached it would be a data
    // change dressed as a label.
    expect(screen.getByTestId('pipeline-group-ap')).toBeInTheDocument();
    expect(screen.getByTestId('dash-strip-projcount-ap')).toBeInTheDocument();
    expect(screen.getByTestId('dash-strip-projcount-is')).toBeInTheDocument();
    expect(group('ap').textContent).toContain('approved, pending issue');
  });
});

// ---------------------------------------------------- the layout contract ---

describe('fix-324: the page does not scroll — the lists do', () => {
  it('★ the page is a fixed-height column and owns no scrollbar', () => {
    renderDash();
    const page = screen.getByTestId('pipeline-page');
    expect(page.className).toContain('h-full');
    expect(page.className).toContain('flex-col');
    // The page itself must never be the scroller — <main> is the shell's only
    // one (fix-313), and this page fits inside it.
    expect(page.className).not.toMatch(/overflow-(auto|y-auto|scroll)/);
    expect(columnsRow().className).toContain('min-h-0');
    expect(columnsRow().className).toContain('flex-1');
  });

  it('★ every scroller is a sub-column list, and nothing above it can grow', () => {
    renderDash();
    const scrollers = Array.from(
      columnsRow().querySelectorAll('[class*="overflow-y-auto"]'),
    );
    expect(scrollers.length).toBeGreaterThan(0);
    for (const el of scrollers) {
      expect(el.getAttribute('data-scroll-bucket')).toBe('true');
      // A scroller must be a bounded flex child, or it grows the page instead
      // of scrolling itself.
      expect(el.className).toContain('flex-1');
      expect(el.className).toContain('min-h-0');
    }
  });

  it('★ the viewport-guessing maxHeight is gone', () => {
    // The old layout capped each list at `calc(100vh - 220px)` — a number that
    // drifted every time the furniture above it changed height. Flex bounds it
    // now, so the guess must not come back.
    // The comment that explains the removal is allowed to name it; a live
    // style value is not.
    const code = dashboardSrc.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('100vh');
  });
});

// ------------------------------------------------ nothing else moved --------

describe('fix-324: the contents are untouched', () => {
  it('counts are unchanged — two under review, one in corrections', () => {
    renderDash();
    expect(screen.getByTestId('pipeline-sub-count-Under Review').textContent).toBe('2');
    expect(screen.getByTestId('pipeline-sub-count-Corrections').textContent).toBe('1');
    // The badge fix-264 pins, with its title attribute, exactly as before.
    const badge = screen.getByTestId('dash-subbucket-projcount-Under Review');
    expect(badge.textContent).toMatch(/2 proj/);
    expect(badge).toHaveAttribute('title', '2 projects · 2 permits');
  });

  it('the cards still render through AddrGroup', () => {
    renderDash();
    const cards = screen.getAllByTestId(/^addr-group-/);
    expect(cards.length).toBeGreaterThan(0);
    expect(
      cards.map((el) => el.getAttribute('data-addr')),
    ).toEqual(expect.arrayContaining(['10719 Phinney Ave N', '3626 164th Pl SE']));
  });

  it('the sub-columns are the same four, in the same order', () => {
    renderDash();
    const subs = Array.from(columnsRow().querySelectorAll('[data-testid^="pipeline-sub-toggle-"]'))
      .map((el) => el.getAttribute('data-testid')?.replace('pipeline-sub-toggle-', ''));
    expect(subs).toEqual([
      'Scheduled & Schematic',
      'DD & Pending Consultants',
      'Under Review',
      'Corrections',
      'approved, pending issue',
      'active issued permits at this address',
    ]);
  });
});
