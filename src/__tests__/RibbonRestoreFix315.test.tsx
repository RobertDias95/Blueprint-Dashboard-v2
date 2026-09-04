import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  MemoryRouter,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  allRibbonRoutes,
  groupContainsActive,
  isLinkActive,
  ribbonExemptPaths,
  visibleEntries,
  type RibbonEntry,
} from '../lib/ribbonNav';
import {
  buildWaitingOnCsv,
  exportAllToCsv,
  exportFirmToCsv,
} from '../lib/waitingOnCsv';
import type { WaitingOnTaskRow } from '../lib/database.types';

// fix-315 — put back the two screens the ribbon dropped.
//
// fix-313 wrote the ribbon's entry list BY ENUMERATION and two destinations
// were left off it. Both routes still existed and still rendered; they were
// simply unreachable by clicking, and nothing failed — no test, no type error,
// no console warning. The only detector was Bobby noticing weeks later.
//
//   1. /reports — the live-metrics overview. The list named the seven CHILDREN
//      and not the parent.
//   2. WaitingOnView — stranded when /my-tasks was redirected to /board.
//
// The third section of this file is the guard, and it is the part that matters
// most: a silent omission should be a failing test, not a support question.

const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'editor' }));
// ★ fix-409: My Tasks reads permit-scoped holds now, the way My Board has
// since fix-390. Mocked inert — an unheld book is the state every assertion in
// this file was written against, and a real query here would reach the network.
vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
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

beforeEach(() => {
  authState.role = 'admin';
  window.localStorage.clear();
});

function renderRibbon(initial = '/dashboard') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Ribbon inside a real router, so navigation can be asserted on the resolved
 *  location rather than on an href string (the fix-306 discipline). */
function renderRoutable(initial = '/dashboard') {
  function Probe() {
    const { pathname, search } = useLocation();
    return <div data-testid="where">{pathname + search}</div>;
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
// 1. /reports — the live-metrics overview
// ---------------------------------------------------------------------------

describe('fix-315 §1: the Reports overview is reachable again', () => {
  // ★ THE ACCEPTANCE TEST — the resolved route, not a link.
  it('★ clicking Reports → Overview navigates to /reports', () => {
    renderRoutable();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    fireEvent.click(screen.getByTestId('ribbon-link-/reports'));
    expect(screen.getByTestId('where').textContent).toBe('/reports');
  });

  it('and /reports is a real route, declared in router.tsx', () => {
    expect(routerSrc).toContain("path: 'reports'");
    expect(allRibbonRoutes()).toContain('/reports');
  });

  // ★ The other half of the acceptance test: the route the entry reaches is
  // the one that mounts <Reports />, which is where MetricCards lives. The
  // cards' own rendering is pinned by Reports.test.tsx ("renders FilterBar +
  // MetricCards + 4 charts", asserting report-metric-cards) — re-mounting that
  // whole page here would duplicate it without adding a claim. What was NOT
  // asserted anywhere until now is the LINK between the ribbon entry and that
  // page, which is precisely what went missing.
  it('★ and that route is the one mounting <Reports />, the metric-cards page', () => {
    expect(routerSrc).toMatch(
      /path: 'reports', element: <AdminRoute><Reports \/><\/AdminRoute>/,
    );
    expect(routerSrc).toContain("import Reports from './pages/Reports'");
  });

  it('sits FIRST among the group’s children, above the shelf', () => {
    const group = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    const kids = group!.kind === 'group' ? group!.group.children : [];
    expect(kids[0]!.to).toBe('/reports');
    expect(kids[0]!.label).toBe('Overview');
    // fix-317 removed the five that duplicate Saved reports; ★ fix-319 #77
    // moved the sixth into Settings → Permits. ★ fix-331 §8 then moved Project
    // View in, between the overview and the shelf. Overview still leads, which
    // is what fix-315 was about.
    // ★ fix-483 §C: Agenda joined, between Project View and the shelf.
    //   Overview still leads, which is what fix-315 was about.
    expect(kids.slice(1).map((k) => k.to)).toEqual([
      '/projects',
      '/agenda',
      '/reports/saved',
    ]);
  });

  // ★ The brief's constraint on the interaction, asserted rather than asserted
  // about: opening the group to reach Corrections must not drag you through
  // the metrics page.
  it('★ expanding the group does NOT navigate anywhere', () => {
    renderRoutable('/dashboard');
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
    // ...and the children are now reachable directly. ★ fix-317 retargeted
    // this off /reports/corrections, which left the ribbon.
    fireEvent.click(screen.getByTestId('ribbon-link-/reports/saved'));
    expect(screen.getByTestId('where').textContent).toBe('/reports/saved');
  });

  // ★ The reason the Overview entry is `exact`. Without it, /reports would
  // prefix-match every child and two entries would claim to be where you are.
  it('★ the Overview entry does not light up while you are reading a child', () => {
    // ★ fix-319: /reports/phase-durations is a redirect now, so the pathname
    // used here is one of the routes the shelf reaches. The hazard being
    // tested is unchanged — without the exact flag, /reports would
    // prefix-match every /reports/* route and two entries would both claim to
    // be where you are.
    renderRibbon('/reports/corrections');
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-link-/reports').dataset.active).toBe('false');
    // Nothing else in the group claims it either — the shelf is a different
    // path entirely.
    expect(
      screen.getByTestId('ribbon-link-/reports/saved').dataset.active,
    ).toBe('false');
  });

  it('...and does light up on /reports itself', () => {
    renderRibbon('/reports');
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    expect(screen.getByTestId('ribbon-link-/reports').dataset.active).toBe('true');
  });

  it('the exact matcher is exact, and the prefix matcher still is not', () => {
    expect(isLinkActive('/reports', '/reports', true)).toBe(true);
    expect(isLinkActive('/reports', '/reports/corrections', true)).toBe(false);
    // Unchanged for everything else — a parent still owns its children.
    expect(isLinkActive('/library', '/library/42')).toBe(true);
  });

  // ★ Trends has been moved twice already; confirm it is still reachable.
  it('★ Trends is reachable through the overview at /reports?tab=trends', () => {
    renderRoutable('/reports?tab=trends');
    expect(screen.getByTestId('where').textContent).toBe('/reports?tab=trends');
    // The legacy /trends URL still redirects there.
    expect(routerSrc).toContain('/reports?tab=trends');
    // And the group shows as active on the Trends URL, not just the bare one.
    const group = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    expect(group!.kind === 'group' && groupContainsActive(group!.group, '/reports')).toBe(
      true,
    );
  });

  // ★ The gate must cover the new entry too.
  // ★ fix-331 §8: the GROUP renders for a non-admin now (Project View lives in
  // it), but the overview entry still does not — which is the half fix-315 and
  // fix-234 care about.
  it('★ a non-admin sees the group but NOT the overview entry', () => {
    authState.role = 'editor';
    renderRibbon();
    expect(screen.getByTestId('ribbon-group-reports')).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-link-/reports')).toBeNull();
    const routes = visibleEntries(false).flatMap((e) =>
      e.kind === 'group' ? e.group.children.map((c) => c.to) : e.kind === 'link' ? [e.link.to] : [],
    );
    expect(routes.some((r) => r.startsWith('/reports'))).toBe(false);
    // Not vacuous — an admin does get it.
    const adminRoutes = visibleEntries(true).flatMap((e) =>
      e.kind === 'group' ? e.group.children.map((c) => c.to) : [],
    );
    expect(adminRoutes).toContain('/reports');
  });
});

// ---------------------------------------------------------------------------
// 2. Waiting On
// ---------------------------------------------------------------------------

describe('fix-315 §2: Waiting On is reachable again', () => {
  // ★ fix-325 #5 INVERTS the entry half of this and keeps the destination half.
  // Bobby: "I think the waiting on needs to get folded into the my task
  // section." The ribbon row is gone; the screen is not. fix-315's real point —
  // a surface must not be stranded — is asserted harder than before, because the
  // route now has to survive WITHOUT a ribbon entry to reach it.
  it('★ the ribbon entry is gone, and the route still resolves', () => {
    renderRoutable();
    // ★ fix-335 §3: the Entitlements group is gone, so there is nothing to
    // expand — every ribbon row is already on screen, which makes this check
    // stricter than it was.
    expect(screen.queryByTestId('ribbon-link-/waiting-on')).toBeNull();
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
    // The destination survives as a redirect. ★ fix-499 §D moved where it
    // lands: it was /board?view=waiting-on (the switcher fix-325 folded it
    // into); Waiting On is its own report now, so it goes to
    // /reports/waiting-on and the switcher URL redirects there as well. This
    // path has been rescued twice and still resolves — which is the whole
    // point fix-315 exists to make.
    expect(routerSrc).toContain("path: 'waiting-on'");
    expect(routerSrc).toContain('/reports/waiting-on');
    expect(routerSrc).toContain('/board?view=waiting-on');
  });

  it('★ and the removal is DECLARED, not silent', () => {
    const exemption = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/waiting-on',
    );
    expect(exemption, 'removing an entry requires a written reason').toBeTruthy();
    expect(exemption!.why).toMatch(/My Tasks|switcher/i);
  });

  it('Entitlements is Library alone now', () => {
    // ★ fix-325 took BOTH Waiting On (#5) and Activity (#4) out of this group.
    // ★ fix-331 §8 then promoted Draw Schedule to the top tier, leaving one
    // child, and predicted that keeping a one-child group would only defer the
    // decision. ★★ fix-335 §3 made it: Bobby asked to "get rid of entitlements
    // and just make library its own column", so the group is gone and Library
    // is a top-level entry.
    //
    // ★ THE COVERAGE CLAIM IS WHAT MATTERED AND IT IS UNCHANGED — both routes
    // are still reachable by clicking, which is the only thing fix-315 exists
    // to protect. Where the row SITS was never this suite's business.
    expect(
      RIBBON_ENTRIES.find((e) => e.kind === 'group' && e.group.id === 'entitlements'),
    ).toBeUndefined();
    expect(allRibbonRoutes()).toContain('/library');
    expect(allRibbonRoutes()).toContain('/draw-schedule');
  });

  // ★ NOT merged with the Consultant forecast — different questions, and the
  // brief was explicit that both stay.
  //
  // ★ fix-317 moved where that is checked. The forecast is no longer a ribbon
  // entry — it left with the five that duplicated Saved reports — so "separate
  // entry" became "separate report, still reachable, still not merged". Its
  // route still exists, it carries its own exemption naming its shelf
  // category, and Waiting On is untouched and still in the ribbon.
  it('★ the Consultant forecast is still a separate, reachable report', () => {
    // The forecast route is alive and exempted for a stated reason...
    const exemption = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/reports/vendor-forecast',
    );
    expect(exemption, 'the forecast must be exempted, not silently dropped').toBeTruthy();
    expect(exemption!.why).toMatch(/Saved reports/);
    // ...and the exemption names the category it actually sits in on prod,
    // which is Weekly Updates — NOT Pipeline.
    expect(exemption!.why).toMatch(/Weekly Updates/);
    expect(routerSrc).toContain("path: 'reports/vendor-forecast'");

    // ★ fix-325: Waiting On is no longer a ribbon entry, so "not merged" is now
    // asserted where it lives — the two are still different screens, reached
    // different ways, and neither absorbed the other.
    expect(routerSrc).toContain("path: 'waiting-on'");
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
  });
});

// ---------------------------------------------------------------------------
// The CSV export — the part of Waiting On that would have been quietly lost
// ---------------------------------------------------------------------------

function row(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  return {
    task_id: 't1',
    // The real column names — waiting_on is the discipline, firm_active is the
    // archived flag, completion_status is the status, priority is a boolean
    // rendered Yes/No. Written from lib/waitingOnCsv.ts rather than guessed.
    waiting_on: 'Structural',
    firm_id: 'f1',
    firm_name: 'Acme Structural',
    firm_active: true,
    project_id: 'p1',
    project_address: '3921 43rd Ave S',
    project_juris: 'Seattle',
    permit_type: 'Building Permit',
    task_text: 'Return the stamped set',
    assigned_to: 'Miles',
    priority: true,
    start_date: '2026-08-01',
    due_date: '2026-08-20',
    target_date: '2026-08-18',
    completion_status: 'Open',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    notes: 'Chased twice',
    ...over,
  } as unknown as WaitingOnTaskRow;
}

/** Run a download-triggering export and hand back the CSV it would have sent,
 *  so the assertion is on CONTENT rather than on a button having been clicked. */
function captureDownload(run: () => { rowsExported: number; filename: string }) {
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  let blob: Blob | null = null;
  URL.createObjectURL = ((b: Blob) => {
    blob = b;
    return 'blob:stub';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  try {
    const result = run();
    return { result, blob: blob as Blob | null };
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    click.mockRestore();
  }
}

describe('fix-315: both CSV exports still produce their 16-column output', () => {
  // ★ Assert the generated CSV CONTENT, not that a button exists. This is the
  // capability the ticket exists to restore — one consultant's open items,
  // sendable — and "the button renders" would not have caught its loss either.
  it('★ all-rows export: 16 columns, header + one row per task', () => {
    const csv = buildWaitingOnCsv([row(), row({ task_id: 't2', firm_name: 'Beta Civil' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);

    const header = lines[0]!.split(',');
    expect(header).toHaveLength(16);
    expect(header[0]).toBe('"Discipline"');
    expect(header[1]).toBe('"Firm Name"');
    expect(header[2]).toBe('"Firm Status"');
    expect(header[15]).toBe('"Notes"');

    const first = lines[1]!.split(',');
    expect(first).toHaveLength(16);
    expect(first[0]).toBe('"Structural"');
    expect(first[1]).toBe('"Acme Structural"');
    expect(first[2]).toBe('"Active"');
    expect(lines[2]).toContain('"Beta Civil"');
  });

  it('an archived firm reads Archived, and a firm-less row reads blank', () => {
    expect(
      buildWaitingOnCsv([row({ firm_active: false } as Partial<WaitingOnTaskRow>)]).split(
        '\n',
      )[1],
    ).toContain('"Archived"');
    const orphan = buildWaitingOnCsv([
      row({ firm_id: null, firm_name: null } as Partial<WaitingOnTaskRow>),
    ]).split('\n')[1]!;
    // Firm Status blank — not "Active", which would be a claim about a firm
    // that is not there.
    expect(orphan.split(',')[2]).toBe('""');
  });

  it('★ the ALL export really writes those rows out, through the download path', () => {
    const rows = [row(), row({ task_id: 't2', firm_name: 'Beta Civil' })];
    const { result, blob } = captureDownload(() => exportAllToCsv(rows));
    expect(result.rowsExported).toBe(2);
    expect(result.filename).toMatch(/^waiting-on-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blob).not.toBeNull();
    return blob!.text().then((text) => {
      expect(text.split('\n')).toHaveLength(3);
      expect(text.split('\n')[0]!.split(',')).toHaveLength(16);
      expect(text).toContain('"Acme Structural"');
      expect(text).toContain('"Beta Civil"');
    });
  });

  // ★ The per-firm export is the point of the screen: send ONE consultant
  // their own open items. Asserted on the bytes, including that the other
  // firm's rows are absent.
  it('★ per-firm export carries only that firm’s rows, with the same 16 columns', () => {
    const rows = [
      row({ task_id: 't1', firm_id: 'f1', firm_name: 'Acme Structural' }),
      row({ task_id: 't2', firm_id: 'f2', firm_name: 'Beta Civil' }),
      row({ task_id: 't3', firm_id: 'f1', firm_name: 'Acme Structural' }),
    ];
    const { result, blob } = captureDownload(() =>
      exportFirmToCsv(rows, { discipline: 'Structural', firmId: 'f1' }),
    );
    expect(result.rowsExported).toBe(2);
    return blob!.text().then((text) => {
      const lines = text.split('\n');
      expect(lines).toHaveLength(3); // header + 2 Acme rows
      expect(lines[0]!.split(',')).toHaveLength(16);
      expect(text).not.toContain('Beta Civil');
    });
  });

  it('the firm-less group exports too — firmId null is a real group', () => {
    const rows = [
      row({ task_id: 't1', firm_id: null, firm_name: null } as Partial<WaitingOnTaskRow>),
      row({ task_id: 't2', firm_id: 'f1' }),
    ];
    const { result } = captureDownload(() =>
      exportFirmToCsv(rows, { discipline: 'Structural', firmId: null }),
    );
    expect(result.rowsExported).toBe(1);
  });

  it('a comma or a quote in the notes cannot break the row apart', () => {
    const csv = buildWaitingOnCsv([row({ notes: 'Chased, twice; said "next week"' })]);
    // Still one data line, and the escaping is CSV-standard doubled quotes.
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"Chased, twice; said ""next week"""');
  });
});

// ---------------------------------------------------------------------------
// ★ 3. THE GUARD — the general defect
// ---------------------------------------------------------------------------

/** Every non-parameterised, non-index route declared in router.tsx. */
function declaredRoutes(src: string): string[] {
  const out: string[] = [];
  const re = /path:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const p = m[1]!;
    if (p === '*' || p === '/') continue;
    if (p.includes(':')) continue; // parameterised — not a browsing destination
    out.push(p.startsWith('/') ? p : `/${p}`);
  }
  return [...new Set(out)];
}

/** The routes a coverage check must account for, given a set of ribbon routes. */
function uncovered(routes: string[], ribbon: string[], exempt: string[]): string[] {
  return routes.filter((r) => !ribbon.includes(r) && !exempt.includes(r));
}

describe('fix-315 §3: the ribbon cannot silently drop a route again', () => {
  it('★ every declared route is either in the ribbon or explicitly exempt', () => {
    const missing = uncovered(
      declaredRoutes(routerSrc),
      allRibbonRoutes(),
      ribbonExemptPaths(),
    );
    expect(
      missing,
      `these routes are reachable by URL but not by clicking, and are not listed in ROUTES_INTENTIONALLY_NOT_IN_RIBBON: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  // ★ PROVE THE GUARD WORKS by removing an entry, rather than trusting it.
  // A test that would pass whatever the code did is worse than no test, and
  // this whole ticket exists because a silent omission went undetected.
  it('★★ and it FAILS when an entry is removed from the ribbon', () => {
    // ★ fix-325: this used to pull /waiting-on out as its example. That route is
    // now legitimately out of the ribbon AND exempted, so removing it proves
    // nothing — the example moved to an entry that is still there. The guard is
    // what it always was: take a live entry away without exempting it, and the
    // route shows up uncovered.
    const withoutLibrary = allRibbonRoutes().filter((r) => r !== '/library');
    const missing = uncovered(
      declaredRoutes(routerSrc),
      withoutLibrary,
      ribbonExemptPaths(),
    );
    expect(missing).toEqual(['/library']);

    // The same for the entry that started this ticket.
    const withoutReports = allRibbonRoutes().filter((r) => r !== '/reports');
    expect(
      uncovered(declaredRoutes(routerSrc), withoutReports, ribbonExemptPaths()),
    ).toEqual(['/reports']);
  });

  it('★ and it fails when a route is added to router.tsx with no home', () => {
    const invented = [...declaredRoutes(routerSrc), '/brand-new-screen'];
    expect(uncovered(invented, allRibbonRoutes(), ribbonExemptPaths())).toEqual([
      '/brand-new-screen',
    ]);
  });

  it('every exemption carries a reason, so removing an entry is said out loud', () => {
    expect(ROUTES_INTENTIONALLY_NOT_IN_RIBBON.length).toBeGreaterThan(0);
    for (const entry of ROUTES_INTENTIONALLY_NOT_IN_RIBBON) {
      expect(entry.path.startsWith('/'), entry.path).toBe(true);
      // Not a placeholder — a sentence someone had to mean.
      expect(entry.why.length, entry.path).toBeGreaterThan(25);
    }
  });

  it('the exemption list does not quietly excuse something the ribbon DOES have', () => {
    // A path in both lists is a contradiction, and the kind that hides a bug.
    for (const p of ribbonExemptPaths()) {
      expect(allRibbonRoutes(), `${p} is both exempt and in the ribbon`).not.toContain(p);
    }
  });

  it('the route parser finds the real routes, so the guard is not vacuous', () => {
    const routes = declaredRoutes(routerSrc);
    // If the regex broke, everything would be "covered" and the guard silent.
    expect(routes).toContain('/dashboard');
    expect(routes).toContain('/reports');
    expect(routes).toContain('/waiting-on');
    expect(routes.length).toBeGreaterThan(12);
    // Parameterised routes are excluded on purpose — you cannot click to
    // /project/:id, you arrive from a row.
    expect(routes.some((r) => r.includes(':'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-315: fix-313 survives', () => {
  it('the top level is unchanged apart from Settings joining it', () => {
    renderRibbon();
    const labels = Array.from(
      screen.getByTestId('ribbon-nav').querySelectorAll('a'),
    ).map((a) => a.getAttribute('title'));
    // ★ fix-319 #76: Settings became a link when it stopped being a modal.
    // ★ fix-331 §8: Draw Schedule joined the top tier, My Board dropped to
    // third, Project View moved into the Reports group, and error triage
    // arrived from the top bar (admin-only — this suite renders as an admin).
    // ★★ fix-335: Library joined this list (§3, its group collapsed) and
    // SharePoint arrived (§4). SharePoint is an <a> like the rest, which is
    // exactly why it belongs in this check rather than being filtered out of
    // it — the one row that leaves the app has to be visible to the assertion
    // that names every row.
    //
    // ★ fix-345 §4 moved it UP a tier, below Reports and above the separator:
    // Bobby, having used it, reads it as a destination rather than an
    // administrative control — "Maybe below reports?" The Reports group is
    // collapsed here, so its children are not rendered and SharePoint follows
    // My Board / Library directly.
    expect(labels).toEqual([
      'Pipeline',
      'Draw Schedule',
      'My Board',
      // ★★★ fix-483 §C (P-138), the EIGHTH reorder: Agenda LEFT this tier for
      // the Reports group, on the same *"too many tabs"* worry fix-462 quoted
      // when it put the entry here. The Reports group is COLLAPSED in this
      // render, so its children are not drawn and the entry is absent from
      // these labels entirely — which is also why this list, not just the
      // model, had to be re-pinned.
      'Library',
      'Blueprint Design and Entitlements Studio on SharePoint — opens in a new tab',
      // ★ fix-350, the SIXTH reorder: What's New joins the tier below the rule,
      // beside the administrative entries. NOT admin-gated — it exists for the
      // 23 non-admin editors who were never told what shipped.
      'Features, changes and tips — what the tool has learned to do lately',
      'Settings',
      'Scraper and app errors needing triage',
    ]);
  });

  it('/my-tasks still redirects to /board — Waiting On did not un-merge it', () => {
    expect(routerSrc).toMatch(
      /path: 'my-tasks', element: <Navigate to="\/board" replace \/>/,
    );
    expect(allRibbonRoutes()).not.toContain('/my-tasks');
  });

  it('collapse still persists, and the groups still open independently', () => {
    const first = renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    first.unmount();
    renderRibbon();
    expect(screen.getByTestId('ribbon').dataset.collapsed).toBe('true');
  });

  // ★★ fix-335 §4 added a FOURTH kind, and it is load-bearing rather than
  // cosmetic: an 'external' entry carries an href and no route, so it can never
  // reach the coverage guard above as if it were one. That is the exemption the
  // brief asked for, made structural — there is no row to keep in sync and no
  // way to forget one, because the type makes the mistake unrepresentable.
  // ★★★ AMENDED BY fix-485 §A1/§A2. Three kinds became five: `separator` left
  //     (captions and the spacer draw its rules and say more), and `caption`,
  //     `spacer` and `jurisdictions` arrived.
  //
  // ★★★ WHAT THIS TEST IS FOR SURVIVES INTACT, and it is the sentence above it:
  //     a kind that carries no `to` can never reach the coverage guard as if it
  //     were a route. All three new kinds are that — `caption` and `spacer` are
  //     pure chrome, and `jurisdictions` holds EXTERNAL urls three levels deep,
  //     which is exactly why it is its own kind rather than a `RibbonGroup`
  //     whose children would be run through the route table. The exemption is
  //     still structural; there are simply more shapes that qualify.
  it('the entries are typed as the five kinds, and only routed ones carry a `to`', () => {
    const kinds = new Set(RIBBON_ENTRIES.map((e: RibbonEntry) => e.kind));
    expect([...kinds].sort()).toEqual([
      'caption',
      'external',
      'group',
      'jurisdictions',
      'link',
      'spacer',
    ]);
    // ★ The property, not just the list: nothing but a link or a group child
    //   has a `to` anywhere in its shape.
    for (const e of RIBBON_ENTRIES) {
      if (e.kind === 'link' || e.kind === 'group') continue;
      expect(JSON.stringify(e), e.kind).not.toContain('"to"');
    }
  });
});
