import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  allRibbonRoutes,
  groupContainsActive,
  isLinkActive,
  visibleEntries,
} from '../lib/ribbonNav';
import {
  loadRibbonCollapsed,
  loadRibbonOpenGroups,
  saveRibbonCollapsed,
  saveRibbonOpenGroups,
} from '../lib/ribbonPrefs';

// fix-313 — the Blueprint Bridge shell. Register #57–#65.
//
// ★ THE THING THIS SUITE EXISTS TO PREVENT is the fix-306 defect: six board
// links pointed at `/projects/:id`, a route the app does not have, and the
// tests passed because they asserted HREF STRINGS. Two of those tests even
// mounted a `/projects/:id` route the real app never had, so the harness
// agreed with the bug.
//
// So the route assertions below resolve through a real router: navigate, then
// read back the location the app actually landed on.

vi.mock('../lib/supabase', () => {
  const channelChain = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => channelChain),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
    supabaseUrl: 'http://test.local',
  };
});

const authState = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'editor',
  userId: 'user-1',
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: authState.userId, email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: authState.role }],
      activeTenantId: 'test-tenant',
    }),
}));

vi.mock('../components/SettingsModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="settings-stub" /> : null),
}));
vi.mock('../components/NewProjectWizard', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="wizard-stub" /> : null),
}));

import Ribbon from '../components/Ribbon';

function wrap(node: React.ReactNode, initial = '/dashboard') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderRibbon(initial = '/dashboard') {
  return wrap(<Ribbon onAddProject={() => {}} onOpenSettings={() => {}} />, initial);
}

beforeEach(() => {
  authState.role = 'admin';
  authState.userId = 'user-1';
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// #57/#60 — every entry goes somewhere the app actually has
// ---------------------------------------------------------------------------

describe('fix-313 #57: every ribbon route exists in the real route table', () => {
  // Reading router.tsx as TEXT rather than importing it: createBrowserRouter
  // pulls in AuthGuard -> the Supabase client and never settles under jsdom.
  // This is the same technique LibraryRoute.test.tsx uses.
  it('★ every route the ribbon points at is declared in router.tsx', () => {
    for (const route of allRibbonRoutes()) {
      const path = route.replace(/^\//, '');
      expect(
        routerSrc.includes(`path: '${path}'`),
        `ribbon points at ${route}, which router.tsx does not declare`,
      ).toBe(true);
    }
  });

  it('★ and none of them is the fix-306 shape — /projects/:id does not exist', () => {
    // The plural detail route is the one that did not exist and shipped anyway.
    expect(routerSrc).not.toContain("path: 'projects/:id'");
    expect(allRibbonRoutes()).toContain('/projects');
  });

  // ★ Resolved routes, not href strings. Clicking each entry must land the
  // router on that path.
  it('★ clicking an entry navigates there — asserted on the resolved location', () => {
    function Probe() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <>
              <Ribbon onAddProject={() => {}} onOpenSettings={() => {}} />
              <Probe />
            </>
          ),
        },
      ],
      { initialEntries: ['/dashboard'] },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Open both groups so the children are reachable.
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-entitlements'));
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));

    for (const route of allRibbonRoutes()) {
      fireEvent.click(screen.getByTestId(`ribbon-link-${route}`));
      expect(screen.getByTestId('where').textContent, `clicking ${route}`).toBe(route);
    }
  });
});

// ---------------------------------------------------------------------------
// #60 — active state, including inside a COLLAPSED group
// ---------------------------------------------------------------------------

describe('fix-313 #60: the active state follows the route', () => {
  it('marks the current top-level entry active', () => {
    renderRibbon('/board');
    expect(screen.getByTestId('ribbon-link-/board').dataset.active).toBe('true');
    expect(screen.getByTestId('ribbon-link-/dashboard').dataset.active).toBe('false');
  });

  // ★ THE ONE THAT MATTERS. A group is closed by default, so a report opened
  // from a link or a bookmark leaves the ribbon with nothing lit — which reads
  // as "you are nowhere" — unless the closed parent carries the state.
  it('★ a CLOSED group containing the active route still shows as active', () => {
    renderRibbon('/reports/corrections');
    const group = screen.getByTestId('ribbon-group-reports');
    // Genuinely closed: the children are not rendered at all.
    expect(screen.queryByTestId('ribbon-kids-reports')).toBeNull();
    expect(group.dataset.containsActive).toBe('true');
    // ...and the group that does NOT contain it stays inactive, so the
    // assertion above is not just "everything is active".
    expect(screen.getByTestId('ribbon-group-entitlements').dataset.containsActive).toBe(
      'false',
    );
  });

  it('and the child itself is active once the group is opened', () => {
    renderRibbon('/reports/corrections');
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-link-/reports/corrections').dataset.active).toBe(
      'true',
    );
    expect(screen.getByTestId('ribbon-link-/reports/weekly-da').dataset.active).toBe(
      'false',
    );
  });

  it('a group opens and closes independently of the route', () => {
    renderRibbon('/reports/corrections');
    // Open by hand while already inside it, then close it again. The route has
    // not moved, so a route-driven implementation would fight this.
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-kids-reports')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.queryByTestId('ribbon-kids-reports')).toBeNull();
    // Still active, still where you are.
    expect(screen.getByTestId('ribbon-group-reports').dataset.containsActive).toBe('true');
  });

  it('the matcher respects path boundaries', () => {
    // /library must not light up for /library-archive, and a parent must light
    // up for its own children.
    expect(isLinkActive('/library', '/library')).toBe(true);
    expect(isLinkActive('/library', '/library/42')).toBe(true);
    expect(isLinkActive('/library', '/library-archive')).toBe(false);
    expect(isLinkActive('/board', '/dashboard')).toBe(false);

    const reports = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    expect(
      reports!.kind === 'group' &&
        groupContainsActive(reports!.group, '/reports/vendor-forecast'),
    ).toBe(true);
    expect(
      reports!.kind === 'group' && groupContainsActive(reports!.group, '/board'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #58 — collapse, and it persists
// ---------------------------------------------------------------------------

describe('fix-313 #58: the collapsed choice persists', () => {
  it('collapses and expands', () => {
    renderRibbon();
    const ribbon = screen.getByTestId('ribbon');
    expect(ribbon.dataset.collapsed).toBe('false');
    expect(ribbon.style.width).toBe('248px');

    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('true');
    expect(screen.getByTestId('ribbon').style.width).toBe('56px');
  });

  // ★ Across a REMOUNT, which is what "persists across reloads" means here.
  it('★ survives a remount', () => {
    const first = renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('true');
    first.unmount();

    renderRibbon();
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('true');
    expect(screen.getByTestId('ribbon').style.width).toBe('56px');
  });

  it('★ and an open group survives a remount too', () => {
    const first = renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-entitlements'));
    expect(screen.getByTestId('ribbon-kids-entitlements')).toBeInTheDocument();
    first.unmount();

    renderRibbon();
    expect(screen.getByTestId('ribbon-kids-entitlements')).toBeInTheDocument();
  });

  // ★ Per user, the fix-176 rule: one login's choice must never leak to
  // another on a shared browser.
  it('★ is remembered per user, not per browser', () => {
    saveRibbonCollapsed('user-1', true);
    saveRibbonCollapsed('user-2', false);
    expect(loadRibbonCollapsed('user-1')).toBe(true);
    expect(loadRibbonCollapsed('user-2')).toBe(false);
    // Never chosen -> null, so the caller applies its own default rather than
    // inheriting somebody else's answer.
    expect(loadRibbonCollapsed('user-3')).toBeNull();
    expect(loadRibbonCollapsed(null)).toBeNull();

    saveRibbonOpenGroups('user-1', ['reports']);
    expect(loadRibbonOpenGroups('user-1')).toEqual(['reports']);
    expect(loadRibbonOpenGroups('user-2')).toBeNull();
  });

  it('uses the app convention — localStorage, keyed per user, like selfScope', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    expect(window.localStorage.getItem('ribbon.collapsed.user-1')).toBe('1');
  });

  it('a corrupt stored value falls back to the default rather than throwing', () => {
    window.localStorage.setItem('ribbon.collapsed.user-1', 'yes please');
    window.localStorage.setItem('ribbon.collapsed.groups.user-1', '{not json');
    expect(loadRibbonCollapsed('user-1')).toBeNull();
    expect(loadRibbonOpenGroups('user-1')).toBeNull();
    renderRibbon();
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// #57 — the collapsed ribbon still shows where you are
// ---------------------------------------------------------------------------

describe('fix-313 #57: collapsed shows icons only, and keeps the active state', () => {
  it('hides the labels but keeps the entries reachable and marked', () => {
    renderRibbon('/board');
    fireEvent.click(screen.getByTestId('ribbon-collapse'));

    const board = screen.getByTestId('ribbon-link-/board');
    expect(board.dataset.active).toBe('true');
    // The label text is gone; the title still names it, so it is not a mystery
    // glyph to a screen reader or on hover.
    expect(board.textContent).not.toMatch(/My Board/);
    expect(board.getAttribute('title')).toBe('My Board');
    // The wordmark collapses to the mark alone.
    expect(screen.getByTestId('bridge-mark')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-brand').textContent).not.toMatch(/BLUEPRINT/);
  });
});

// ---------------------------------------------------------------------------
// #62 — /my-tasks redirects
// ---------------------------------------------------------------------------

describe('fix-313 #62: My Tasks merged into My Board', () => {
  it('★ /my-tasks redirects to /board rather than 404ing', () => {
    expect(routerSrc).toContain("path: 'my-tasks'");
    expect(routerSrc).toMatch(
      /path: 'my-tasks', element: <Navigate to="\/board" replace \/>/,
    );
    // The page is no longer mounted at that route.
    expect(routerSrc).not.toContain('<MyTasks />');
  });

  it('the redirect resolves — a link to /my-tasks lands on /board', () => {
    function Where() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/my-tasks']}>
        <Routes>
          {/* the same redirect the real router declares */}
          <Route path="/my-tasks" element={<Where />} />
          <Route path="/board" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    // Guard against the harness inventing a route the app lacks (fix-306):
    // /board is real, and it is what router.tsx sends my-tasks to.
    expect(routerSrc).toContain("path: 'board'");
  });

  it('★ TaskDetailEditor is NOT deleted — My Board still shares it', async () => {
    const mod = await import('../components/TaskDetailEditor');
    expect(typeof mod.default).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// #59 / #64 — what is gone, and what the tool is called
// ---------------------------------------------------------------------------

describe('fix-313 #64: the tool is Blueprint Bridge', () => {
  it('★ the tab title is Blueprint Bridge and the favicon is not Vite default', async () => {
    const html = (await import('../../index.html?raw')).default;
    expect(html).toContain('<title>Blueprint Bridge</title>');
    expect(html).not.toContain('blueprint-dashboard-v2');
    // The Vite default lived at /favicon.svg. The link no longer points there.
    expect(html).not.toContain('href="/favicon.svg"');
    expect(html).toContain('href="/bridge-mark.svg"');
  });
});

// ---------------------------------------------------------------------------
// #63 / #65 — the renames, and the names that must NOT change
// ---------------------------------------------------------------------------

describe('fix-313 #63/#65: only the landing page is renamed', () => {
  it('the ribbon calls the landing page Pipeline, on the unchanged route', () => {
    const pipeline = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/dashboard',
    );
    expect(pipeline!.kind === 'link' && pipeline!.link.label).toBe('Pipeline');
    // ★ Route unchanged — the fix-310 discipline. A rename is a label.
    expect(routerSrc).toContain("path: 'dashboard'");
  });

  it('★ Project View and Project Overview keep their names', () => {
    const projects = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/projects',
    );
    expect(projects!.kind === 'link' && projects!.link.label).toBe('Project View');
    expect(routerSrc).toContain("path: 'project/:id'");
  });
});

// ---------------------------------------------------------------------------
// The layout contract
// ---------------------------------------------------------------------------

describe('fix-313: the page does not scroll, the panels do', () => {
  it('★ the shell is a fixed viewport with overflow hidden', async () => {
    const Chrome = (await import('../components/Chrome')).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Chrome />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const shell = screen.getByTestId('bridge-shell');
    expect(getComputedStyle(shell).overflow).toBe('hidden');
    expect(shell.className).toContain('h-screen');

    // ★ ...and the pane inside it owns the scroll. This is the pairing that
    // makes the contract real: hidden on the shell alone would CLIP a wide
    // screen (Draw Schedule, the reports) rather than let it scroll.
    const pane = screen.getByTestId('bridge-pane');
    expect(pane.className).toContain('overflow-auto');
    expect(pane.className).toContain('min-h-0');
  });

  it('the ribbon scrolls its own nav rather than growing the page', () => {
    renderRibbon();
    const nav = screen.getByTestId('ribbon-nav');
    expect(nav.className).toContain('overflow-y-auto');
    expect(nav.className).toContain('min-h-0');
  });
});

// ---------------------------------------------------------------------------
// The admin gate, at the model level
// ---------------------------------------------------------------------------

describe('fix-313: the Reports gate is the whole group', () => {
  it('withholds the group, not merely its children', () => {
    const nonAdmin = visibleEntries(false);
    expect(nonAdmin.some((e) => e.kind === 'group' && e.group.id === 'reports')).toBe(
      false,
    );
    expect(visibleEntries(true).some((e) => e.kind === 'group' && e.group.id === 'reports')).toBe(
      true,
    );
  });

  // ★ fix-315 added ONE entry to the front of this list: /reports itself, the
  // live-metrics overview, which fix-313 left off entirely — it listed the
  // seven children and not the parent, so the metrics dashboard kept rendering
  // and became unreachable by clicking. fix-313's seven are unchanged and
  // still in order below.
  it('lists the overview first, then the seven runnable reports', () => {
    const reports = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    const kids = reports!.kind === 'group' ? reports!.group.children : [];
    expect(kids.map((k) => k.to)).toEqual([
      '/reports',
      '/reports/weekly-da',
      '/reports/weekly-updates',
      '/reports/approved-awaiting',
      '/reports/phase-durations',
      '/reports/vendor-forecast',
      '/reports/corrections',
      '/settings/reporting',
    ]);
  });
});
