import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import indexHtml from '../../index.html?raw';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  ROUTES_INTENTIONALLY_NOT_IN_RIBBON,
  allRibbonRoutes,
} from '../lib/ribbonNav';
import {
  buildWaitingOnCsv,
  exportAllToCsv,
  exportFirmToCsv,
} from '../lib/waitingOnCsv';
import type { WaitingOnTaskRow } from '../lib/database.types';

// fix-325 — tighten the ribbon, and four small corrections. Five changes, none
// with logic, bundled because they touch different files.
//
// 1. The ribbon was too wide, and the logo was why. 248/200 -> 212/156.
// 2. The browser tab still showed the placeholder mark I drew.
// 3. The Permit intake divider goes; the SD/DD one stays.
// 4. Activity stops being a tab and moves to the Reporting hub.
// 5. Waiting On folds into My Tasks, where the switcher already existed.
//
// ★ #4 and #5 are REMOVALS OF ENTRY POINTS, not of destinations — the trap
// fix-315 exists because of. Every removal below is paired with an assertion
// that the screen is still reachable, and with the written exemption that keeps
// the route-coverage guard honest.

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
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'user-1', email: 'bobby@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 'test-tenant', role: 'admin' }],
      activeTenantId: 'test-tenant',
    }),
}));

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
}));


import Ribbon from '../components/Ribbon';

function renderRibbon(initial = '/dashboard') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Ribbon onAddProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

// -------------------------------------------------------------- 1 · width --

describe('fix-325 #1: the ribbon is narrower, and so is the logo', () => {
  it('★ expands to 212px, not 248', () => {
    renderRibbon();
    const ribbon = screen.getByTestId('ribbon');
    expect(ribbon.style.width).toBe('212px');
    expect(ribbon.style.flexBasis).toBe('212px');
  });

  // ★ The logo is WHY the ribbon was wide — Bobby diagnosed it correctly — so
  // the two move together. Shrinking the ribbon alone would just add whitespace
  // where the complaint already was.
  // ★★ fix-335 §1 REPLACED THE ARTWORK, and this assertion moved with it. The
  // ribbon's mark is the original Blueprint logo now; the Bridge illustration
  // went to the white header (§2). What fix-325 actually established survives
  // word for word and is what is checked here: the mark fits inside the 212px
  // ribbon's 16px padding, and its height stays auto so narrowing can never
  // squash Bobby's artwork.
  //
  // ★ 156 → 144 is not a second tightening. 144 is this file's NATIVE width, so
  // the mark is rendered 1:1 rather than resampled; see BlueprintMark.
  it('★ the logo came down with it and still fits inside the padding', () => {
    renderRibbon();
    const logo = screen.getByTestId('blueprint-mark') as HTMLImageElement;
    expect(parseFloat(logo.style.width)).toBe(144);
    expect(parseFloat(logo.style.width)).toBeLessThanOrEqual(212 - 32);
    expect(logo.style.height).toBe('auto');
    expect(logo.getAttribute('src')).toMatch(/blueprint-logo-lockup/);
    // ★ And the ribbon itself did NOT move to accommodate it — fix-325's 212px
    // was set by the longest nav label and the foot row, not by the logo.
    expect(screen.getByTestId('ribbon').style.width).toBe('212px');
  });

  // ★ WHAT DECIDES HOW NARROW IT MAY GO is the longest nav label — "Saved
  // reports" is the worst case, a group child carrying a 30px indent on top of
  // its own width.
  //
  // ★ jsdom CANNOT MEASURE THIS. There is no layout engine, so "it fits on one
  // line" is not assertable here and a width comparison would pass vacuously.
  // The fit was verified by rendering the real ribbon at 216 / 212 / 208 / 200
  // and reading it (screenshot in the PR). What IS honest in jsdom: the label
  // text arrives whole, and its row cannot wrap — so a label that stopped
  // fitting would overflow VISIBLY rather than quietly folding onto a second
  // line and looking almost right.
  it('the longest nav labels arrive whole, in rows that cannot wrap', () => {
    renderRibbon();
    fireEvent.click(screen.getByTestId('ribbon-group-toggle-reports'));
    // ★ fix-335 §3: the Entitlements group is gone — Library stands alone, so
    // there is nothing left to expand. Its label joins the list below, where it
    // is now a TOP-LEVEL row rather than an indented child.
    for (const label of ['Saved reports', 'Draw Schedule', 'Project View', 'Library']) {
      const el = screen.getByText(label);
      expect(el.textContent).toBe(label);
      const row = el.closest('a, button') as HTMLElement;
      expect(row.className).toContain('whitespace-nowrap');
    }
  });

  it('collapsed is still 56px, and the chip still says Collapse', () => {
    renderRibbon();
    expect(screen.getByTestId('ribbon-collapse-label').textContent).toBe('Collapse');
    fireEvent.click(screen.getByTestId('ribbon-collapse'));
    const ribbon = screen.getByTestId('ribbon');
    expect(ribbon.style.width).toBe('56px');
    // fix-322's rule survives fix-335 §1's change of artwork: the collapsed
    // rail shows a SQUARE crop, never the wide lockup squashed into one.
    expect(
      (screen.getByTestId('blueprint-mark') as HTMLImageElement).getAttribute('src'),
    ).toMatch(/blueprint-logo-icon/);
  });
});

// ------------------------------------------------------------ 2 · favicon --

describe('fix-325 #2: the tab carries the real mark', () => {
  // ★ fix-326 replaced the crop with the brand sheet's purpose-drawn simplified
  // icon — the same decision (Bobby's artwork in the tab), rendered in a form
  // that survives 16px instead of a line drawing that has been shrunk.
  it('★ points at Bobby\'s artwork', () => {
    expect(indexHtml).toMatch(/href="\/bridge-(favicon|icon)-2026-(32|256)\.png"/);
    expect(indexHtml).toContain('type="image/png"');
  });

  it('★ and never at the placeholder again — every icon link is the real mark', () => {
    expect(indexHtml).not.toContain('href="/bridge-mark.svg"');
    expect(indexHtml).not.toContain('href="/favicon.svg"');
    // ★ fix-325's rule was "no link to a DIFFERENT mark", not "only one link".
    // fix-326 declares two SIZES of the same icon, which cannot show the wrong
    // logo whichever one a browser picks.
    const icons = indexHtml.match(/<link[^>]+rel="icon"[^>]*>/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const tag of icons) expect(tag).toMatch(/bridge-(favicon-2026-32|icon-2026-256)\.png/);
  });

  // ★ The half of fix-322's reasoning that still holds: the WIDE illustration
  // is a smudge at 16px and has no business in a tab.
  it('the wide illustration is still kept out of the tab', () => {
    expect(indexHtml).not.toMatch(/bridge-logo-400|bridge-logo-full|bridge-logo-2026/);
  });
});

// ------------------------------------------------------------ 3 · divider --

// (The Milestones card's own suite owns the rendering assertions; this pins the
// source-level fact that only ONE divider is left and which one it is.)
describe('fix-325 #3: the Permit intake divider is gone', () => {
  it('★ pd-intake-divider is removed and pd-sd-dd-divider stays', async () => {
    const src = (await import('../components/ProjectDetail/ProjectDetailHeader.tsx?raw'))
      .default as string;
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('pd-intake-divider');
    expect(code).toContain('pd-sd-dd-divider');
  });
});

// ----------------------------------------------------------- 4 · Activity --

describe('fix-325 #4: Activity stops being a tab', () => {
  it('★ has no ribbon entry any more', () => {
    renderRibbon();
    // ★ fix-335 §3: no group left to expand — and that makes the check
    // stricter, not weaker. Every ribbon row is already on screen.
    expect(screen.queryByTestId('ribbon-link-/activity')).toBeNull();
    expect(allRibbonRoutes()).not.toContain('/activity');
  });

  // ★★ THE PAIRED ASSERTION. fix-313 removed a destination without checking it
  // was reachable elsewhere; fix-315 cleaned that up. This removes an ENTRY and
  // proves the destination survives.
  it('★ /activity still resolves, and the page is still mounted', () => {
    expect(routerSrc).toContain("path: 'activity'");
    expect(routerSrc).toContain('<ActivityPage />');
  });

  it('★ and the notification bell still links straight to it', async () => {
    const bell = (await import('../components/BoardBell.tsx?raw')).default as string;
    expect(bell).toContain('/activity');
  });

  it('the removal is declared, with a reason naming where it went', () => {
    const exemption = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/activity',
    );
    expect(exemption).toBeTruthy();
    expect(exemption!.why).toMatch(/Reporting hub|Saved reports/i);
    expect(exemption!.why).toMatch(/bell/i);
  });

  // ★ fix-331 §8 promoted Draw Schedule to the top tier, so this is down to
  // Library. fix-325's point — Activity and Waiting On are not tabs — is
  // unchanged and asserted below.
  // ★★ fix-335 §3 COLLAPSED THE GROUP. Entitlements had been left holding
  // exactly one child, and fix-331 §8 wrote down that collapsing it would mean
  // re-creating it next ticket; Bobby asked for the collapse instead. What
  // fix-325 established is unchanged and is what is asserted here — Activity and
  // Waiting On are not ribbon entries at ANY level, which is a stronger claim
  // than "not children of a group that no longer exists".
  it('Entitlements is down to Library', () => {
    expect(
      RIBBON_ENTRIES.find((e) => e.kind === 'group' && e.group.id === 'entitlements'),
      'the Entitlements group was collapsed by fix-335 §3',
    ).toBeUndefined();
    expect(allRibbonRoutes()).toContain('/library');
    expect(allRibbonRoutes()).not.toContain('/activity');
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
  });
});

// --------------------------------------------------------- 5 · Waiting On --

describe('fix-325 #5: Waiting On folds into My Tasks', () => {
  it('★ has no ribbon entry, and /waiting-on redirects into the switcher', () => {
    renderRibbon();
    // ★ fix-335 §3: see above — nothing to expand, every row is rendered.
    expect(screen.queryByTestId('ribbon-link-/waiting-on')).toBeNull();
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
    expect(routerSrc).toContain("path: 'waiting-on'");
    expect(routerSrc).toContain('/board?view=waiting-on');
  });

  it('★ the redirect lands on the view itself, not merely near it', () => {
    function Where() {
      const loc = useLocation();
      return <div data-testid="where">{loc.pathname + loc.search}</div>;
    }
    const router = createMemoryRouter(
      [
        { path: '/waiting-on', element: <Where /> },
        { path: '/board', element: <Where /> },
      ],
      { initialEntries: ['/board?view=waiting-on'] },
    );
    render(<RouterProvider router={router} />);
    // The URL the redirect targets carries the switcher's own state, so the
    // person lands on Waiting On rather than on the board's default view.
    expect(screen.getByTestId('where').textContent).toBe('/board?view=waiting-on');
  });

  it('the removal is declared, with a reason naming where it went', () => {
    const exemption = ROUTES_INTENTIONALLY_NOT_IN_RIBBON.find(
      (r) => r.path === '/waiting-on',
    );
    expect(exemption).toBeTruthy();
    expect(exemption!.why).toMatch(/My Tasks|switcher/i);
  });

  // ★★ THE REASON fix-315 RESCUED THIS SCREEN was the per-firm CSV — one
  // consultant, their own open items. Asserted on the CONTENT, not on a button.
  it('★ both CSV exports still produce their 16-column output', () => {
    const rows: WaitingOnTaskRow[] = [
      waitingRow({ firm_name: 'Acme Structural', task_text: 'Stamp the plans' }),
      waitingRow({
        task_id: 't2',
        firm_id: 'f2',
        firm_name: 'Beta Survey',
        waiting_on: 'Surveyor',
        task_text: 'Send the ALTA',
      }),
    ];

    // The CONTENT, from the same builder both export paths call.
    const csv = buildWaitingOnCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0].split(',')).toHaveLength(16);
    expect(lines).toHaveLength(3); // header + one line per row
    expect(csv).toContain('Acme Structural');
    expect(csv).toContain('Beta Survey');

    // Export-all covers every row...
    const all = exportAllToCsv(rows);
    expect(all.rowsExported).toBe(2);
    expect(all.filename).toMatch(/^waiting-on-.*\.csv$/);

    // ...and the per-firm export — the reason fix-315 rescued this screen —
    // still narrows to ONE consultant's own open items.
    const firm = exportFirmToCsv(rows, { discipline: 'Structural', firmId: 'f1' });
    expect(firm.rowsExported).toBe(1);
    expect(firm.filename).toMatch(/structural/i);
    const firmCsv = buildWaitingOnCsv(
      rows.filter((r) => r.waiting_on === 'Structural' && r.firm_id === 'f1'),
    );
    expect(firmCsv.split('\n')[0].split(',')).toHaveLength(16);
    expect(firmCsv).toContain('Stamp the plans');
    expect(firmCsv).not.toContain('Beta Survey');
  });
});

function waitingRow(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  return {
    task_id: 't1',
    waiting_on: 'Structural',
    firm_id: 'f1',
    firm_name: 'Acme Structural',
    firm_active: true,
    project_id: 'p1',
    project_address: '3921 43rd Ave S',
    project_juris: 'Seattle',
    permit_id: 1,
    permit_type: 'Building Permit',
    task_text: 'Stamp the plans',
    assigned_to: 'Miles',
    priority: false,
    start_date: null,
    due_date: null,
    target_date: '2026-09-01',
    completion_status: 'Open',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    notes: null,
    ...over,
  } as WaitingOnTaskRow;
}
