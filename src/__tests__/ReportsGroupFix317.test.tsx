import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  allRibbonRoutes,
  ribbonExemptPaths,
  visibleEntries,
} from '../lib/ribbonNav';
import {
  BUILTIN_REPORT_CATALOG,
  BUILTIN_REPORT_COMPONENTS,
} from '../lib/builtinReports';

// fix-317 (register #75) — the Reports group listed six things twice.
//
//   Bobby: "it's showing six things that are duplicates, essentially. So I
//   think it should maybe be Overview, Saved reports, and then within Saved
//   reports you can see the two categories."
//
// ★ THE LOAD-BEARING STEP WAS THE VERIFICATION, NOT THE DELETION. fix-315
// exists because fix-313 removed a destination without checking it was
// reachable elsewhere; this ticket had to not do that in reverse.
//
// The hub lists from public.saved_reports — the TABLE — not from
// builtinReports.ts, so "it is in the registry" is not evidence. Checked
// against prod, 2026-08-15:
//
//   weekly_da_update            shelf ✓  Weekly Updates  "Weekly DA Update"
//   weekly_updates              shelf ✓  Weekly Updates  "Weekly Updates"
//   vendor_schedule_forecast    shelf ✓  Weekly Updates  "Structural Schedule Forecast"
//   approved_awaiting_issuance  shelf ✓  Pipeline        "Approved – Awaiting Issuance"
//   corrections                 shelf ✓  Pipeline        "Corrections"
//   phase_durations             ★ NO ROW — not on the shelf at all
//
// So FIVE came out and phase_durations stayed. Removing it would have made
// /reports/phase-durations unreachable by clicking, which is precisely the
// defect fix-315 spent a ticket cleaning up.

const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'editor' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'u1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: authState.role }],
      activeTenantId: 't1',
    }),
}));

vi.mock('../lib/supabase', () => {
  const chain = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: {
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => chain),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
    supabaseUrl: 'http://test.local',
  };
});

import Ribbon from '../components/Ribbon';

/** The six the ribbon used to duplicate, with the shelf facts measured on prod. */
const THE_SIX = [
  { key: 'weekly_da_update', route: '/reports/weekly-da', onShelf: true, category: 'Weekly Updates' },
  { key: 'weekly_updates', route: '/reports/weekly-updates', onShelf: true, category: 'Weekly Updates' },
  { key: 'vendor_schedule_forecast', route: '/reports/vendor-forecast', onShelf: true, category: 'Weekly Updates' },
  { key: 'approved_awaiting_issuance', route: '/reports/approved-awaiting', onShelf: true, category: 'Pipeline' },
  { key: 'corrections', route: '/reports/corrections', onShelf: true, category: 'Pipeline' },
  { key: 'phase_durations', route: '/reports/phase-durations', onShelf: false, category: null },
] as const;

beforeEach(() => {
  authState.role = 'admin';
  window.localStorage.clear();
});

function renderRoutable(initial = '/dashboard') {
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
            <Ribbon onAddProject={() => {}} />
            <Probe />
          </>
        ),
      },
    ],
    { initialEntries: [initial] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// The group
// ---------------------------------------------------------------------------

describe('fix-317: the Reports group stops duplicating the shelf', () => {
  it('★ renders Overview and Saved reports, and none of the five shelved reports', () => {
    renderRoutable();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));

    expect(screen.getByTestId('ribbon-link-/reports')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-link-/reports/saved')).toBeInTheDocument();

    for (const r of THE_SIX.filter((r) => r.onShelf)) {
      expect(
        screen.queryByTestId(`ribbon-link-${r.route}`),
        `${r.key} is on the shelf and must not also be a ribbon entry`,
      ).toBeNull();
    }
  });

  // fix-317 kept Phase durations in the ribbon because the hub could not
  // reach it — and it still cannot: it has no saved_reports row and, per the
  // fix-319 brief, must not be given one. It is not a report you run.
  //
  // ★★ fix-319 #77 resolved that differently: it moved into Settings → Permits,
  // beside the per-type target formulas it is the evidence for, and the route
  // REDIRECTS there so bookmarks survive.
  it('★★ Phase durations left the ribbon for Settings → Permits', () => {
    renderRoutable();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.queryByTestId('ribbon-link-/reports/phase-durations')).toBeNull();

    // Still NOT on the shelf — the brief is explicit that seeding a row would
    // be the wrong answer.
    expect(BUILTIN_REPORT_CATALOG.phase_durations).toBeNull();
    // ...while the other five all declare a hub placement.
    for (const r of THE_SIX.filter((r) => r.onShelf)) {
      expect(BUILTIN_REPORT_CATALOG[r.key], `${r.key} must have a hub placement`).toBeTruthy();
    }
    // The route is a redirect, not a deletion.
    expect(routerSrc).toContain("path: 'reports/phase-durations'");
    expect(routerSrc).toMatch(/<Navigate to="\/settings\/permits" replace \/>/);
  });

  // ★★ THE SHAPE BOBBY ASKED FOR, finally.
  // ★ fix-331 §8 added a third: Project View. fix-317's point survives intact —
  // the six duplicated REPORTS are still gone and the shelf is still the one
  // way to them.
  // ★ fix-483 §C: Agenda joined the group between Project View and the shelf.
  //   fix-317's actual claim is what this still pins — the FIVE individual
  //   reports that duplicated the shelf are not here, and neither is a sixth.
  it('★★ the group is Overview, Project View, Agenda and Saved reports — no report duplicates', () => {
    const reports = RIBBON_ENTRIES.find((e) => e.kind === 'group' && e.group.id === 'reports');
    const kids = reports!.kind === 'group' ? reports!.group.children : [];
    expect(kids.map((k) => k.to)).toEqual([
      '/reports',
      '/projects',
      '/agenda',
      '/reports/saved',
    ]);
    // ★ No child is a /reports/<report> address — the duplication fix-317
    //   removed cannot come back through a differently-named entry either.
    expect(
      kids.filter((k) => k.to.startsWith('/reports/') && k.to !== '/reports/saved'),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ★ Still reachable in two clicks
// ---------------------------------------------------------------------------

describe('fix-317 ★ every removed report is still reachable', () => {
  // Click one: Saved reports. The hub is the destination that replaces five
  // ribbon entries, so it has to actually go there.
  it('★ Saved reports resolves to the hub', () => {
    renderRoutable();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    fireEvent.click(screen.getByTestId('ribbon-link-/reports/saved'));
    expect(screen.getByTestId('where').textContent).toBe('/reports/saved');
  });

  // Click two: the report itself. The hub renders a card per saved_reports row
  // and navigates to the builtin's route — so the contract that matters here
  // is that each of the five HAS a live route and a component behind it.
  it('★ and each of the five has a live route and a component behind it', () => {
    for (const r of THE_SIX.filter((r) => r.onShelf)) {
      const def = BUILTIN_REPORT_COMPONENTS[r.key];
      expect(def, `${r.key} must still be a registered builtin`).toBeTruthy();
      expect(def!.route).toBe(r.route);
      expect(typeof def!.component).toBe('function');
      // ...and router.tsx still declares it, so the hub's link lands somewhere.
      expect(routerSrc).toContain(`path: '${r.route.replace(/^\//, '')}'`);
    }
  });

  it('the hub placement names a real category for each of the five', () => {
    for (const r of THE_SIX.filter((r) => r.onShelf)) {
      const entry = BUILTIN_REPORT_CATALOG[r.key];
      expect(entry!.category, `${r.key}`).toBe(r.category);
    }
    // ★ Two categories, and only two — the shape Bobby described.
    const cats = new Set(
      THE_SIX.filter((r) => r.onShelf).map((r) => BUILTIN_REPORT_CATALOG[r.key]!.category),
    );
    expect([...cats].sort()).toEqual(['Pipeline', 'Weekly Updates']);
  });
});

// ---------------------------------------------------------------------------
// The coverage guard
// ---------------------------------------------------------------------------

describe('fix-317: the guard is satisfied, not bypassed', () => {
  function declaredRoutes(src: string): string[] {
    const out: string[] = [];
    const re = /path:\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const p = m[1]!;
      if (p === '*' || p === '/' || p.includes(':')) continue;
      out.push(p.startsWith('/') ? p : `/${p}`);
    }
    return [...new Set(out)];
  }

  it('★ every declared route is still in the ribbon or explicitly exempt', () => {
    const missing = declaredRoutes(routerSrc).filter(
      (r) => !allRibbonRoutes().includes(r) && !ribbonExemptPaths().includes(r),
    );
    expect(missing, `unreachable by clicking: ${missing.join(', ')}`).toEqual([]);
  });

  it('★ each of the five carries a specific reason naming its shelf category', () => {
    for (const r of THE_SIX.filter((r) => r.onShelf)) {
      const entry = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find((e) => e.path === r.route);
      expect(entry, `${r.route} must be exempted, not silently dropped`).toBeTruthy();
      // Not a placeholder — the existing guard requires >25 chars; this
      // requires it to actually say where the thing went.
      expect(entry!.why).toMatch(/Saved reports/);
      expect(entry!.why, `${r.route} must name its category`).toMatch(
        new RegExp(r.category!),
      );
    }
  });

  // ★ fix-319: phase-durations IS exempted now, with a reason saying where it
  // went — and it is out of the ribbon, so the two lists still do not overlap.
  it('★ phase-durations is exempted with a reason, and is not in both lists', () => {
    const entry = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (e) => e.path === '/reports/phase-durations',
    );
    expect(entry, 'the redirect must be exempted, not silently dropped').toBeTruthy();
    expect(entry!.why).toMatch(/Settings/);
    expect(allRibbonRoutes()).not.toContain('/reports/phase-durations');
    for (const p of ribbonExemptPaths()) {
      expect(allRibbonRoutes(), `${p} is both exempt and in the ribbon`).not.toContain(p);
    }
  });

  // Prove the guard would still catch this ticket's own mistake.
  it('★ and it would FAIL if a removed report had no exemption', () => {
    const withoutOne = ribbonExemptPaths().filter((p) => p !== '/reports/corrections');
    const missing = declaredRoutes(routerSrc).filter(
      (r) => !allRibbonRoutes().includes(r) && !withoutOne.includes(r),
    );
    expect(missing).toEqual(['/reports/corrections']);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-317: what must not have moved', () => {
  it('Overview still resolves to /reports', () => {
    renderRoutable();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    fireEvent.click(screen.getByTestId('ribbon-link-/reports'));
    expect(screen.getByTestId('where').textContent).toBe('/reports');
  });

  // fix-315's exact flag. ★ fix-319 retargeted the pathname — phase-durations
  // is a redirect now — but the hazard is the same: without `exact`, /reports
  // would prefix-match every /reports/* route.
  it('★ Overview does not light up while a /reports/* child is open', () => {
    renderRoutable('/reports/corrections');
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-link-/reports').dataset.active).toBe('false');
  });

  // ★★ fix-331 §8: the group is visible to a non-admin now, because Project
  // View lives in it and 23 of 29 users are editors who need that screen. What
  // fix-317 and fix-234 actually protect — no report is reachable — is
  // unchanged and asserted below.
  it('★ a non-admin can reach no report, though the group renders for Project View', () => {
    authState.role = 'editor';
    renderRoutable();
    expect(screen.getByTestId('ribbon-group-reports')).toBeInTheDocument();
    const routes = visibleEntries(false).flatMap((e) =>
      e.kind === 'group'
        ? e.group.children.map((c) => c.to)
        : e.kind === 'link'
          ? [e.link.to]
          : [],
    );
    expect(routes.some((r) => r.startsWith('/reports'))).toBe(false);
    expect(routes).not.toContain('/reports/saved');
    expect(routes).toContain('/projects');
  });

  // ★ fix-317 asserted Waiting On had NOT moved. fix-325 moved it, on Bobby's
  // instruction — so what this pins now is the thing fix-317 actually cared
  // about: an entry may leave the ribbon only with a written reason, never
  // silently.
  it('fix-325 took Waiting On out of the ribbon, and said why', () => {
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
    const exemption = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/waiting-on',
    );
    expect(exemption).toBeTruthy();
    expect(exemption!.why.length).toBeGreaterThan(40);
  });

  it('the hub itself was not restructured — only the ribbon changed', () => {
    // Same six builtins registered, same routes. This ticket moved navigation.
    expect(Object.keys(BUILTIN_REPORT_COMPONENTS).sort()).toEqual(
      [...THE_SIX].map((r) => r.key).sort(),
    );
  });
});
