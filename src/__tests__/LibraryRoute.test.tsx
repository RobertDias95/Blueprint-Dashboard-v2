import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-297: the Library became its own top-level route.
//
// It was the third sub-tab of Draw Schedule, driven by useState. It is not a
// view of the draw schedule — it is the per-project matrix, used on its own —
// and, more importantly, ★ A useState SUB-TAB HAS NO URL. Nobody could
// bookmark the Library, link to it, or send it to anyone; every visit was "go
// to Draw Schedule, then click Library". That is what this fixes.
//
// This suite covers the move: the route exists, the nav reaches it, the access
// level did NOT change, and Draw Schedule is left with exactly two sub-tabs.
// LibraryMatrix's own behaviour — filters, sorting, unit-type editing, stage
// badges — is untouched by this ticket and stays covered by LibraryMatrix.test.

const T = 'test-tenant';

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map(), isLoading: false, error: null, refetch: vi.fn() }),
  readAppConfigStringArray: () => [] as string[],
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../components/DrawScheduleGrid', () => ({
  default: () => <div data-testid="draw-schedule-grid" />,
}));
vi.mock('../components/IntakeTracker', () => ({
  default: () => <div data-testid="intake-tracker" />,
}));

// ?raw gives the file's TEXT without executing it — vite/client already
// declares the suffix, so this needs no @types/node. Importing router.tsx
// normally is what we must avoid: createBrowserRouter pulls in AuthGuard ->
// the Supabase client and never settles under jsdom.
import routerSrc from '../router.tsx?raw';
import chromeSrc from '../components/Chrome.tsx?raw';
import DrawSchedule from '../pages/DrawSchedule';
import LibraryMatrix from '../components/LibraryMatrix';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ------------------------------------------------------------- the new route --

describe('fix-297 /library is a real route', () => {
  // Asserted against the SOURCE: the route table is what has to stay true, and
  // reading it keeps the assertion exact.

  it('is registered at the top level, beside draw-schedule', () => {
    expect(routerSrc).toMatch(/path:\s*'library'/);
    expect(routerSrc).toMatch(/path:\s*'draw-schedule'/);
    // Beside it, not nested inside it: the draw-schedule entry is a one-liner
    // with no children of its own.
    expect(routerSrc).toMatch(
      /\{\s*path:\s*'draw-schedule',\s*element:\s*<DrawSchedule\s*\/>\s*\}/,
    );
  });

  it('renders LibraryMatrix', () => {
    expect(routerSrc).toMatch(
      /path:\s*'library',\s*element:\s*<LibraryMatrix\s*\/>/,
    );
  });

  // ★ THE ACCESS LEVEL MUST NOT DRIFT. /draw-schedule is not wrapped in
  // AdminRoute and the Library has been reachable by everyone for as long as it
  // has existed. Silently narrowing who can open an existing screen is the kind
  // of change nobody notices until somebody cannot do their job.
  it('is NOT admin-gated — same as /draw-schedule', () => {
    const routeLine = (path: string) => {
      const m = routerSrc.match(
        new RegExp(String.raw`\{\s*path:\s*'${path}',[^}]*\}`),
      );
      expect(m, `no route entry found for '${path}'`).toBeTruthy();
      return m![0];
    };
    expect(routeLine('library')).not.toContain('AdminRoute');
    // Pinned against its reference point, so if draw-schedule ever becomes
    // guarded this is re-examined rather than silently diverging.
    expect(routeLine('draw-schedule')).not.toContain('AdminRoute');
  });

  it('the matrix itself renders for a non-admin', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    wrap(<LibraryMatrix />);
    expect(screen.getByTestId('library-matrix')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------- the nav --

describe('fix-297 the nav reaches it', () => {
  it('lists Library immediately after Draw Schedule', () => {
    const drawAt = chromeSrc.indexOf("to: '/draw-schedule'");
    const libAt = chromeSrc.indexOf("to: '/library'");
    const projectsAt = chromeSrc.indexOf("to: '/projects'");
    expect(drawAt).toBeGreaterThan(-1);
    expect(libAt).toBeGreaterThan(drawAt);
    expect(libAt).toBeLessThan(projectsAt);
  });

  // The rendered order (and that a non-admin still sees it) is asserted in
  // Chrome.test.tsx, which drives the real component.
  it('is not filtered out for non-admins the way Reports is', () => {
    expect(chromeSrc).toMatch(/filter\(\(item\) => item\.to !== '\/reports'\)/);
    expect(chromeSrc).not.toMatch(/item\.to !== '\/library'/);
  });
});

// ------------------------------------------------- Draw Schedule after the move --

describe('fix-297 Draw Schedule keeps two sub-tabs', () => {
  it('renders Draw Schedule and Seattle Intakes, and no Library tab', () => {
    wrap(<DrawSchedule />);
    expect(screen.getByTestId('ds-tab-schedule')).toBeInTheDocument();
    expect(screen.getByTestId('ds-tab-intake')).toBeInTheDocument();
    expect(screen.queryByTestId('ds-tab-library')).toBeNull();

    const bar = screen.getByTestId('ds-subtab-bar');
    expect(bar.querySelectorAll('button')).toHaveLength(2);
    expect(bar.textContent).not.toContain('Library');
  });

  it('still switches between the two remaining sub-tabs', () => {
    wrap(<DrawSchedule />);
    // Schedule is the default.
    expect(screen.getByTestId('draw-schedule-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('intake-tracker')).toBeNull();

    fireEvent.click(screen.getByTestId('ds-tab-intake'));
    expect(screen.getByTestId('intake-tracker')).toBeInTheDocument();
    expect(screen.queryByTestId('draw-schedule-grid')).toBeNull();

    fireEvent.click(screen.getByTestId('ds-tab-schedule'));
    expect(screen.getByTestId('draw-schedule-grid')).toBeInTheDocument();
  });

  it('no longer renders the matrix anywhere inside Draw Schedule', () => {
    wrap(<DrawSchedule />);
    expect(screen.queryByTestId('library-matrix')).toBeNull();
    fireEvent.click(screen.getByTestId('ds-tab-intake'));
    expect(screen.queryByTestId('library-matrix')).toBeNull();
  });
});
