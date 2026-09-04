import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import routerSrc from '../router.tsx?raw';
import {
  BUILTIN_REPORT_CATALOG,
  BUILTIN_REPORT_COMPONENTS,
  builtinReportCatalogDrift,
  builtinReportsMissingHowItWorks,
  seededBuiltinKeys,
} from '../lib/builtinReports';
import {
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  allRibbonRoutes,
  ribbonExemptPaths,
} from '../lib/ribbonNav';
import {
  buildVendorEmailSubject,
  emlFilename,
  resolveForecastRecipients,
} from '../lib/vendorReportEmail';

// ===========================================================================
// ★★★ fix-499 (P-034) — the discipline parameter, and Waiting On as a report
// ===========================================================================
//
// Bobby, 2026-08-31: *"This vendor schedule forecast could then be applied to
// all of the other vendors we're using based on the same concept."* and
// *"Waiting on gets moved into reports."*
//
// The pure core of §A lives in vendorReport.test.ts, where the fix-268/269
// task-driven describes were re-homed onto the consultant round. This file
// covers the page, the catalog and the routes.

const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const drawRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const consultantsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const directoryRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const configRef = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
const ledgerKeys = vi.hoisted(() => ({ current: [] as string[] }));
const markSentMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useWaitingOnTasks', () => ({
  useWaitingOnTasks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: configRef.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/useConsultantCurrent', () => ({
  useConsultantCurrent: () => ({ data: consultantsRef.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: directoryRef.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/useVendorReportState', () => ({
  // ★ Records which ledger key the page asked for — the assertion that the
  //   six existing `structural` rows are still the ones being read.
  useVendorReportState: (key: string) => {
    ledgerKeys.current.push(key);
    return { data: [], isLoading: false, error: null, refetch: vi.fn() };
  },
  useMarkVendorReportSent: () => ({ mutate: markSentMutate, isPending: false }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});

import VendorScheduleForecastReport from '../pages/VendorScheduleForecastReport';

function project(over: Record<string, unknown> & { id: string }) {
  return { address: `${over.id} Main St`, juris: 'Seattle', archived: false, ...over };
}

function block(over: Record<string, unknown> & { project_id: string }) {
  return {
    start_week: '2026-08-10',
    end_week: '2026-09-14',
    status: 'Scheduled',
    dd_start: null,
    dd_end: '2026-09-18',
    ...over,
  };
}

function consultant(over: Record<string, unknown> & { project_id: string }) {
  return {
    consultant_id: `c-${over.project_id}`,
    discipline: 'Structural',
    firm_name: 'SSS',
    firm_active: true,
    status: 'Scheduled',
    est_send: null,
    sent: null,
    est_recd: null,
    recd: null,
    round_index: 1,
    round_count: 1,
    ...over,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VendorScheduleForecastReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
  ledgerKeys.current = [];
  projectsRef.current = [
    project({ id: 'p-str', address: '100 Structural St' }),
    project({ id: 'p-civ', address: '200 Civil Ave' }),
  ];
  drawRef.current = [block({ project_id: 'p-str' }), block({ project_id: 'p-civ' })];
  consultantsRef.current = [
    consultant({ project_id: 'p-str', discipline: 'Structural', firm_name: 'SSS' }),
    consultant({ project_id: 'p-civ', discipline: 'Civil', firm_name: 'Bluewater Civil' }),
  ];
  directoryRef.current = [];
  configRef.current = new Map<string, unknown>([
    [
      'vendorReportRecipients',
      {
        structural: {
          label: 'SSS Engineering',
          to: [{ name: 'Tawny Glenn', email: 't.glenn@ssseng.com' }],
          cc: [],
        },
      },
    ],
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §B — the discipline parameter, through the page
// ---------------------------------------------------------------------------

describe('fix-499 §B: ?discipline selects the report', () => {
  it('★★★ no parameter = Structural, and ONLY the structural project shows', () => {
    // ★★★ THE COMPATIBILITY GUARANTEE. Every link, bookmark and Weekly Update
    //     card written before this ticket carries no `?discipline`.
    renderAt('/reports/vendor-forecast');
    expect(screen.getByTestId('vsf-heading').textContent).toContain(
      'Structural Schedule Forecast',
    );
    expect(screen.getByTestId('vsf-pipeline-row-p-str')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-pipeline-row-p-civ')).toBeNull();
  });

  it('★★★ ?discipline=Civil renders Civil rows ONLY', () => {
    renderAt('/reports/vendor-forecast?discipline=Civil');
    expect(screen.getByTestId('vsf-heading').textContent).toContain(
      'Civil Schedule Forecast',
    );
    expect(screen.getByTestId('vsf-pipeline-row-p-civ')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-pipeline-row-p-str')).toBeNull();
  });

  it('★★★ the ledger key follows the discipline — structural keeps its 6 rows', () => {
    renderAt('/reports/vendor-forecast');
    expect(ledgerKeys.current).toContain('structural');
    ledgerKeys.current = [];
    renderAt('/reports/vendor-forecast?discipline=Civil');
    expect(ledgerKeys.current).toContain('civil');
    expect(ledgerKeys.current).not.toContain('structural');
  });

  it('★★★ an UNKNOWN discipline is an empty state listing the seven, not a throw', () => {
    renderAt('/reports/vendor-forecast?discipline=Plumbing');
    expect(screen.getByTestId('vsf-unknown-discipline')).toBeInTheDocument();
    for (const d of ['Structural', 'Civil', 'Surveyor', 'Arborist', 'Geotech', 'Energy', 'Landscape']) {
      expect(screen.getByTestId(`vsf-discipline-link-${d}`)).toBeInTheDocument();
    }
  });

  it('★★ the subject and the filename carry the discipline', () => {
    expect(buildVendorEmailSubject('SSS Engineering', '2026-08-03', 'Structural')).toBe(
      'SSS Engineering Structural schedule forecast - week of Aug 3, 2026',
    );
    expect(buildVendorEmailSubject('Bluewater Civil', '2026-08-03', 'Civil')).toBe(
      'Bluewater Civil Civil schedule forecast - week of Aug 3, 2026',
    );
    // The filename already keyed off the vendor key, which is the discipline now.
    expect(emlFilename('civil', '2026-08-03')).toBe('civil-schedule-forecast-2026-08-03.eml');
  });

  it('★★★ REGRESSION LOCK: default Structural output is unchanged for the common shape', () => {
    // ★★★ A Scheduled round with NO est_send — measured on prod, that is every
    //     Structural round there is (est_send is set on 1 of 165 records across
    //     all seven disciplines). So this fixture IS the common case, and its
    //     target send must still be the schedule-derived date fix-309 defined:
    //     dd_end 2026-09-18 minus the one-week send lead.
    renderAt('/reports/vendor-forecast');
    const row = screen.getByTestId('vsf-pipeline-row-p-str');
    expect(row.textContent).toContain('2026-09-11');
    expect(screen.queryByTestId('vsf-overdue-pipeline-p-str')).toBeNull();
  });

  it('★★ a stated est_send overrides the schedule-derived date on the page', () => {
    consultantsRef.current = [
      consultant({ project_id: 'p-str', est_send: '2026-09-02' }),
    ];
    renderAt('/reports/vendor-forecast');
    const row = screen.getByTestId('vsf-pipeline-row-p-str');
    expect(row.textContent).toContain('2026-09-02');
    expect(row.textContent).not.toContain('2026-09-11');
  });
});

// ---------------------------------------------------------------------------
// §B — recipients: Settings first, the directory second, and say which
// ---------------------------------------------------------------------------

describe('fix-499 §B: recipients name their source', () => {
  it('★★ Settings wins when it names anybody, and no banner is shown', () => {
    renderAt('/reports/vendor-forecast');
    expect(screen.queryByTestId('vsf-recipients-from-directory')).toBeNull();
    expect(screen.getByTestId('vsf-heading').textContent).toContain('SSS Engineering');
  });

  it('★★★ a discipline with no Settings entry falls back to the directory, and SAYS SO', () => {
    // ★★★ Settings holds ONE key (`structural`) — six of the seven forecasts
    //     have no recipient list at all. Without the fallback each would have
    //     opened with "No recipients are configured", which is true and useless
    //     when the directory has held that firm's address all along. And a
    //     draft addressed from a source the sender did not choose is how the
    //     wrong person gets a schedule, so the page names the source.
    directoryRef.current = [
      {
        discipline: 'Civil',
        name: 'Bluewater Civil',
        contact_name: 'Dana Reyes',
        contact_email: 'dana@bluewater.example',
        active: true,
      },
    ];
    renderAt('/reports/vendor-forecast?discipline=Civil');
    expect(screen.getByTestId('vsf-recipients-from-directory')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-heading').textContent).toContain('Bluewater Civil');
  });

  it('★★ the resolver: settings → directory → none, and inactive firms are skipped', () => {
    const firms = [
      { discipline: 'Civil', name: 'Bluewater', contact_email: 'a@b.c', active: true },
      { discipline: 'Civil', name: 'Retired Co', contact_email: 'x@y.z', active: false },
      { discipline: 'Geotech', name: 'Other', contact_email: 'g@h.i', active: true },
    ];
    const settings = { civil: { label: 'Chosen', to: [{ name: 'A', email: 'a@a.a' }], cc: [] } };

    expect(resolveForecastRecipients(settings, 'civil', 'Civil', firms).source).toBe('settings');
    const fromDir = resolveForecastRecipients({}, 'civil', 'Civil', firms);
    expect(fromDir.source).toBe('directory');
    expect(fromDir.to.map((p) => p.email)).toEqual(['a@b.c']);
    expect(fromDir.label).toBe('Bluewater');
    expect(resolveForecastRecipients({}, 'energy', 'Energy', firms).source).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// §B/§D — the catalog and the routes
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'migrations/fix_499_seed_discipline_forecast_reports.sql'),
  'utf8',
);

describe('fix-499: the catalog carries seven forecasts + Waiting On', () => {
  it('★★★ all seven disciplines are registered, and Structural KEEPS its key', () => {
    // ★★★ `vendor_schedule_forecast` is prod's builtin_key and fix_267's seeded
    //     row. Renaming it would orphan the card everyone already uses.
    expect(BUILTIN_REPORT_COMPONENTS.vendor_schedule_forecast.route).toBe(
      '/reports/vendor-forecast',
    );
    for (const [key, d] of [
      ['forecast_civil', 'Civil'],
      ['forecast_surveyor', 'Surveyor'],
      ['forecast_arborist', 'Arborist'],
      ['forecast_geotech', 'Geotech'],
      ['forecast_energy', 'Energy'],
      ['forecast_landscape', 'Landscape'],
    ] as const) {
      expect(BUILTIN_REPORT_COMPONENTS[key].route).toBe(
        `/reports/vendor-forecast?discipline=${d}`,
      );
      expect(BUILTIN_REPORT_COMPONENTS[key].label).toBe(`${d} Schedule Forecast`);
    }
  });

  it('★★★ the catalog guards still hold — no drift, no missing explanation', () => {
    expect(builtinReportCatalogDrift()).toEqual({ missingCatalog: [], orphanCatalog: [] });
    expect(builtinReportsMissingHowItWorks()).toEqual([]);
  });

  it('★★★ the SEEDED set is exactly what the migrations insert', () => {
    // ★★★ THE fix-267 GUARD, AND WHY FOUR DISCIPLINES ARE `null`. `seededBuiltinKeys`
    //     is defined as "the set the seed migration inserts". Arborist, Geotech,
    //     Energy and Landscape have 2–16 rows of work between them, so they are
    //     reachable by URL and NOT on the shelf — the same explicit `null` that
    //     phase_durations carries. Giving them a catalog entry would make this
    //     guard assert rows no migration writes: fix-267's failure, inverted.
    expect(seededBuiltinKeys()).toEqual([
      'approved_awaiting_issuance',
      'corrections',
      'forecast_civil',
      'forecast_surveyor',
      'vendor_schedule_forecast',
      'waiting_on',
      'weekly_da_update',
      'weekly_updates',
    ]);
    for (const key of ['forecast_arborist', 'forecast_geotech', 'forecast_energy', 'forecast_landscape']) {
      expect(BUILTIN_REPORT_CATALOG[key]).toBeNull();
    }
  });

  it('★★★ the migration seeds exactly the three new keys, idempotently', () => {
    expect(MIGRATION).toContain("'forecast_civil'");
    expect(MIGRATION).toContain("'forecast_surveyor'");
    expect(MIGRATION).toContain("'waiting_on'");
    // ★ Structural is NOT re-inserted — fix_267 already seeded it.
    expect(MIGRATION).not.toContain("'vendor_schedule_forecast',\n");
    // ★ …and the four unseeded ones stay out of the SQL as well as the catalog.
    for (const k of ['forecast_arborist', 'forecast_geotech', 'forecast_energy', 'forecast_landscape']) {
      expect(MIGRATION).not.toContain(`'${k}'`);
    }
    expect(MIGRATION).toContain('WHERE NOT EXISTS');
  });

  it('★★ the shelf order is Weekly Updates 0..5 with no collision', () => {
    const weekly = Object.entries(BUILTIN_REPORT_CATALOG)
      .filter(([, e]) => e?.category === 'Weekly Updates')
      .map(([, e]) => e!.position)
      .sort((a, b) => a - b);
    expect(weekly).toEqual([0, 1, 2, 3, 4, 5]);
    expect(BUILTIN_REPORT_CATALOG.waiting_on!.position).toBe(5);
  });
});

describe('fix-499 §D: Waiting On is a report, and every old link still lands', () => {
  it('★★★ /reports/waiting-on exists and is NOT wrapped in AdminRoute', () => {
    // ★★★ THE DELIBERATE ASYMMETRY. Every neighbouring report route is
    //     admin-gated; this one must not be. /my-tasks was never admin-only,
    //     fix-315's own comment says so, and moving a screen between two
    //     addresses must not quietly take it away from the people using it.
    expect(routerSrc).toContain("path: 'reports/waiting-on'");
    const seg = routerSrc.slice(
      routerSrc.indexOf("path: 'reports/waiting-on'"),
      routerSrc.indexOf("path: 'reports/waiting-on'") + 120,
    );
    expect(seg).not.toContain('AdminRoute');
    expect(seg).toContain('<WaitingOnView />');
  });

  it('★★★ /waiting-on redirects here, and /board?view=waiting-on does too', () => {
    expect(routerSrc).toMatch(
      /path: 'waiting-on'[\s\S]{0,160}<Navigate to="\/reports\/waiting-on" replace \/>/,
    );
    // ★★ A route cannot match a query string, so the second redirect is a
    //    COMPONENT that reads the parameter — and it lives in its own file
    //    because `react-refresh/only-export-components` is an error here: the
    //    module that exports the router may not also define a component.
    expect(routerSrc).toContain('<BoardOrWaitingOn />');
    const redirect = readFileSync(
      resolve(process.cwd(), 'src/components/BoardOrWaitingOn.tsx'),
      'utf8',
    );
    expect(redirect).toContain("params.get('view') === 'waiting-on'");
    expect(redirect).toContain('<Navigate to="/reports/waiting-on" replace />');
    expect(redirect).toContain('<PersonalBoard />');
  });

  it('★★ the new route is exempt from the ribbon with a reason naming its shelf', () => {
    const row = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/reports/waiting-on',
    );
    expect(row).toBeTruthy();
    expect(row!.why).toMatch(/Saved reports/);
    expect(row!.why).toMatch(/Weekly Updates/);
    // ★ A path may not be both exempt and in the ribbon — the guard would
    //   double-count it.
    expect(allRibbonRoutes()).not.toContain('/reports/waiting-on');
    expect(ribbonExemptPaths()).toContain('/reports/waiting-on');
  });

  it('★★★ the component MOVED FILE and did not change', () => {
    // ★★ The brief is explicit: no behavioural change. CSV (all + per firm),
    //    contacts, the scope toggle, include-completed and holds all carried.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/Reports/WaitingOnView.tsx'),
      'utf8',
    );
    expect(src).toContain('exportFirmToCsv');
    expect(src).toContain('exportAllToCsv');
    expect(src).toContain('useExternalTeamDirectory');
    expect(src).toContain("useScopeMode('mytasks')");
    expect(src).toContain('includeCompleted');
  });

  it('★★★ the My Tasks switcher is GONE, and the shell still renders the board', () => {
    const myTasks = readFileSync(
      resolve(process.cwd(), 'src/pages/MyTasks.tsx'),
      'utf8',
    );
    expect(myTasks).not.toContain('my-tasks-view-waiting-on');
    expect(myTasks).not.toContain('WaitingOnView');
    expect(myTasks).toContain('mytasks-shell');
    expect(myTasks).toContain('<MineTasks />');
  });

  it('★★ the shared scope key did NOT fork when the screen moved', () => {
    // ★★★ A person's Mine / All choice must not reset because the address
    //     changed. Both surfaces still persist under 'mytasks'.
    const view = readFileSync(
      resolve(process.cwd(), 'src/components/Reports/WaitingOnView.tsx'),
      'utf8',
    );
    const board = readFileSync(resolve(process.cwd(), 'src/pages/MyTasks.tsx'), 'utf8');
    expect(view).toContain("useScopeMode('mytasks')");
    expect(board).toContain("useScopeMode('mytasks')");
  });
});
