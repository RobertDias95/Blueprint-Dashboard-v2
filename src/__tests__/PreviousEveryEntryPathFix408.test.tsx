import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import OriginLink from '../components/OriginLink';
import {
  clearPaneScroll,
  isInAppPath,
  makeOriginState,
  originLabelForPath,
  previousTarget,
  projectIdFromPath,
  recallPaneScroll,
  rememberPaneScroll,
  restoreScrollFrom,
  PREVIOUS_ORIGINS,
} from '../lib/previousOrigin';
import { allRibbonRoutes, ribbonExemptPaths } from '../lib/ribbonNav';

// ===========================================================================
// fix-408 — Previous works from EVERY entry path, not just Library/Pipeline
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-041):
//
//   "Previous is a site-wide smart function. Whenever you enter a page from
//    another page, Previous takes you back to that page in the state you left
//    it (filters, scroll position, active tab), and is labelled with that
//    page's name."
//
// ★★★ THE REPRODUCTION, and it is §3's first case: My Board → Notifications →
// click a notification → land in a project chat → the button read "← Search".
// You came from Notifications; it offered you Project View.
//
// ★★ WHAT fix-403 ACTUALLY BUILT, since the fix-408 brief had it the other way
// round and the difference is load-bearing: the ORIGIN travels in ROUTER STATE
// (only the click knows which list it came from) and the FILTERS live in
// sessionStorage (so the browser's back button and the ribbon restore them
// too). fix-408 changes neither of those homes. It changes how many origins
// there are — from a two-member enum to the app's whole route table — and adds
// the scroll offset, which lives in neither because a pixel offset must not
// survive a reload.

// ---------------------------------------------------------------------------
// §1 · THE HELPER
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearPaneScroll();
});

describe('fix-408 §1: the origin helper — set, read, fall back', () => {
  it('★★★ a recorded origin comes back as its page NAME and its own address', () => {
    const o = makeOriginState({ pathname: '/notifications', search: '' })!;
    expect(o).toEqual({ from: '/notifications' });
    expect(previousTarget(o)).toEqual({
      to: '/notifications',
      label: '← Notifications',
    });
  });

  it('★★★ the QUERY STRING travels, which is how the tab and the filters come back', () => {
    // Every tabbed surface in this app addresses its tab in the URL (fix-385),
    // so capturing the search string IS the "active tab" half of Bobby's ask —
    // there was no tab-restoring machinery to invent.
    const o = makeOriginState({
      pathname: '/notifications',
      search: '?kind=suppressed',
    })!;
    expect(o.from).toBe('/notifications?kind=suppressed');
    expect(previousTarget(o).to).toBe('/notifications?kind=suppressed');
    // ★ ...and `/board?tab=tasks` is My TASKS, not My Board.
    expect(
      previousTarget(makeOriginState({ pathname: '/board', search: '?tab=tasks' })),
    ).toEqual({ to: '/board?tab=tasks', label: '← My Tasks' });
    expect(
      previousTarget(makeOriginState({ pathname: '/board', search: '' })),
    ).toEqual({ to: '/board', label: '← My Board' });
  });

  it('★★★ NO ORIGIN → exactly the button fix-403 replaced, unchanged', () => {
    // fix-403's floor. A deep link, a refresh, a link pasted into Slack.
    // Widening the set of origins must not take a destination away from
    // anybody who arrived cold.
    for (const raw of [null, undefined, {}, 'nonsense', { from: 42 }]) {
      expect(previousTarget(raw)).toEqual({ to: '/projects', label: '← Search' });
    }
  });

  it('★★★ an UNKNOWN path is not an origin — the set is open, the validation is not', () => {
    // fix-403 guaranteed this with a two-member enum. fix-408 guarantees the
    // same property against the route table: a path this app does not have
    // cannot become a navigation.
    expect(previousTarget({ from: '/nope' }).to).toBe('/projects');
    expect(previousTarget({ from: '/reports/made-up' }).to).toBe('/projects');
    expect(makeOriginState({ pathname: '/nope', search: '' })).toBeUndefined();
  });

  it('★★★ "starts with a slash" is NOT the safe-URL rule — fix-387, again', () => {
    // `//evil.com` starts with a slash and is a protocol-relative URL to
    // somebody else's origin.
    expect(isInAppPath('//evil.com')).toBe(false);
    expect(isInAppPath('/\\evil.com')).toBe(false);
    expect(isInAppPath('https://evil.com')).toBe(false);
    expect(isInAppPath('/library')).toBe(true);
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com']) {
      expect(previousTarget({ from: bad }).to).toBe('/projects');
    }
  });

  it('★★ an origin EQUAL to where you are standing is declined', () => {
    // A Previous that reloads the page you are already looking at reads as
    // broken. This is the only reason the current location is passed in.
    const here = '/project/p1?permit=5';
    expect(previousTarget({ from: here }, here).to).toBe('/projects');
    expect(previousTarget({ from: here }, '/project/p1?chat=1').to).toBe(here);
  });

  it('★★ a LABEL override names the page, and can never pick the destination', () => {
    // The label is data (a project's address); `to` always comes from `from`,
    // which has already been validated. A label cannot navigate.
    const t = previousTarget({ from: '/project/p1', label: '4137 S Junction St' });
    expect(t).toEqual({ to: '/project/p1', label: '← 4137 S Junction St' });
    // ★ A hostile label changes the text and nothing else.
    expect(previousTarget({ from: '/library', label: '//evil.com' }).to).toBe(
      '/library',
    );
    // ★ A blank one falls back to the route's own name rather than to nothing.
    expect(previousTarget({ from: '/library', label: '   ' }).label).toBe(
      '← Library',
    );
  });

  it('★★★ CHAINED NAVIGATION keeps the IMMEDIATE previous page', () => {
    // Project A → its chat → a permit inside the chat. Previous on the permit
    // must offer the CHAT, not the first page of the chain. There is no stack
    // here at all: each link records where it was, so the newest record wins by
    // construction.
    const first = makeOriginState({ pathname: '/board', search: '' })!;
    const second = makeOriginState({
      pathname: '/project/pA',
      search: '?chat=1',
    })!;
    expect(previousTarget(second, '/project/pA?permit=5').to).toBe(
      '/project/pA?chat=1',
    );
    expect(previousTarget(first).to).toBe('/board');
  });

  it('★★★ a project origin is named by its ADDRESS, resolved where the data is', () => {
    // The linking surfaces sit four components deep inside ProjectDetail and
    // know only an id; the READING side holds the cached project list. So the
    // label is looked up on arrival rather than threaded down four props.
    const state = makeOriginState({ pathname: '/project/pA', search: '?chat=1' });
    const withName = previousTarget(state, '/project/pA?permit=5', {
      labelForProject: (id) => (id === 'pA' ? '4137 S Junction St' : null),
    });
    expect(withName.label).toBe('← 4137 S Junction St');
    // ★ An uncached or unknown project falls back to the generic route name
    //   rather than to a blank button.
    expect(
      previousTarget(state, '/project/pA?permit=5', {
        labelForProject: () => null,
      }).label,
    ).toBe('← Project');
    expect(projectIdFromPath('/project/pA?chat=1')).toBe('pA');
    expect(projectIdFromPath('/board')).toBeNull();
  });

  it('★★ fix-403\'s two origins behave EXACTLY as they did', () => {
    expect(previousTarget({ from: PREVIOUS_ORIGINS.library })).toEqual({
      to: '/library',
      label: '← Library',
    });
    expect(previousTarget({ from: PREVIOUS_ORIGINS.pipeline })).toEqual({
      to: '/dashboard',
      label: '← Pipeline',
    });
  });
});

// ---------------------------------------------------------------------------
// §2 · THE SCROLL OFFSET — a one-shot on the Previous click, not a store
// ---------------------------------------------------------------------------

describe('fix-408 §2: landing where you were reading', () => {
  it('★★★ ONLY a Previous click restores — a ribbon click and the back button do not', () => {
    rememberPaneScroll('/notifications', 940);
    // The flag is what Previous sets. Anything else in router state — fix-403's
    // own `{ from }` included — reads as "no instruction".
    expect(restoreScrollFrom({ restoreScroll: true }, '/notifications')).toBe(940);
    expect(restoreScrollFrom(null, '/notifications')).toBeNull();
    expect(restoreScrollFrom({ from: '/library' }, '/notifications')).toBeNull();
    expect(restoreScrollFrom({ restoreScroll: 940 }, '/notifications')).toBeNull();
  });

  it('★★ the flag is only offered when there is something to restore', () => {
    expect(previousTarget({ from: '/notifications' }).state).toBeUndefined();
    rememberPaneScroll('/notifications', 12);
    expect(previousTarget({ from: '/notifications' }).state).toEqual({
      restoreScroll: true,
    });
  });

  it('★★ an offset belongs to ONE location, query string included', () => {
    rememberPaneScroll('/notifications?kind=suppressed', 300);
    expect(recallPaneScroll('/notifications?kind=suppressed')).toBe(300);
    expect(recallPaneScroll('/notifications')).toBeNull();
  });

  it('★★ scrolling back to the top FORGETS, rather than recording 0', () => {
    rememberPaneScroll('/library', 500);
    rememberPaneScroll('/library', 0);
    expect(recallPaneScroll('/library')).toBeNull();
    rememberPaneScroll('/library', undefined);
    expect(recallPaneScroll('/library')).toBeNull();
  });

  it('★★★ IN MEMORY, never in storage — a pixel offset must not survive a reload', () => {
    // A reload can change how long the list is, and fix-403's rule (a train of
    // thought is not a preference) applies twice over to a scroll position.
    rememberPaneScroll('/library', 500);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 · EVERY ENTRY PATH — the audit, as tests
// ---------------------------------------------------------------------------
//
// ★★ ONE ROW PER SURFACE, and each row asserts BOTH halves:
//
//   · the file really uses <OriginLink> (or useOriginState for the handful of
//     imperative ones) — a source pin, so deleting the wiring fails here;
//   · the ORIGIN PAGE that surface lives on produces the right LABEL — the
//     behaviour Bobby will actually see on the button.
//
// The label column is the point of the ticket: before fix-408 every row below
// except the last two read "← Search".

const ENTRY_PATHS: ReadonlyArray<{
  surface: string;
  originPath: string;
  label: string;
}> = [
  // (a) the reproduction
  { surface: 'Notifications list → a notification', originPath: '/notifications', label: '← Notifications' },
  { surface: 'Notifications → the suppressed list', originPath: '/notifications?kind=suppressed', label: '← Notifications' },
  { surface: 'the notification BELL (from anywhere)', originPath: '/board', label: '← My Board' },
  // (b) My Board — cards, task rows, milestone rows, focus block
  { surface: 'My Board cards / rows / focus block', originPath: '/board', label: '← My Board' },
  { surface: 'My Tasks rows and detail panel', originPath: '/board?tab=tasks', label: '← My Tasks' },
  { surface: 'Waiting On', originPath: '/board?view=waiting-on', label: '← My Board' },
  // (c) chat / CR threads
  { surface: 'a permit chip inside a chat message', originPath: '/project/pA?chat=1', label: '← Project' },
  // (d) reports
  { surface: 'Reports overview drill-in', originPath: '/reports', label: '← Reports' },
  { surface: 'Reports → Trends', originPath: '/reports?tab=trends', label: '← Reports' },
  { surface: 'Corrections report rows', originPath: '/reports/corrections', label: '← Corrections' },
  { surface: 'Recurring corrections (level 2/3)', originPath: '/reports/corrections/patterns', label: '← Recurring corrections' },
  { surface: 'Weekly DA Update rows', originPath: '/reports/weekly-da', label: '← Weekly DA Update' },
  { surface: 'Weekly Updates rows', originPath: '/reports/weekly-updates', label: '← Weekly Updates' },
  { surface: 'Approved – Awaiting Issuance rows', originPath: '/reports/approved-awaiting', label: '← Awaiting Issuance' },
  { surface: 'Team detail (per associate)', originPath: '/reports/team/Bobby', label: '← Team' },
  { surface: 'a saved custom report', originPath: '/reports/custom/r1', label: '← Report' },
  // (e) "Search" — Project View is what the ribbon calls it
  { surface: 'Project View rows', originPath: '/projects', label: '← Project View' },
  // (f) What's New
  { surface: "What's New — “Open it →”", originPath: '/whats-new', label: "← What's New" },
  // (g) + (h) fix-403's two, unchanged
  { surface: 'Library matrix rows', originPath: '/library', label: '← Library' },
  { surface: 'Pipeline address groups', originPath: '/dashboard', label: '← Pipeline' },
  // (i) everything else that links into a project
  { surface: 'Activity feed project groups', originPath: '/activity', label: '← Activity' },
  { surface: 'Draw Schedule block popup', originPath: '/draw-schedule', label: '← Draw Schedule' },
  { surface: 'the New Project wizard (a modal over any page)', originPath: '/dashboard', label: '← Pipeline' },
];

describe('fix-408 §3: every entry path records its own page', () => {
  for (const row of ENTRY_PATHS) {
    it(`★ ${row.surface} → "${row.label}"`, () => {
      const origin = makeOriginState({
        pathname: row.originPath.split('?')[0],
        search: row.originPath.includes('?')
          ? `?${row.originPath.split('?')[1]}`
          : '',
      });
      expect(origin, `no origin recorded for ${row.originPath}`).toBeTruthy();
      expect(previousTarget(origin, '/project/other').label).toBe(row.label);
      expect(previousTarget(origin, '/project/other').to).toBe(row.originPath);
    });
  }
});

// ★ The source pins. Every file that links into a project, named — the brief's
//   "do not write 'and the rest'". Deleting the wiring from any of them fails
//   here rather than being noticed weeks later by Bobby.
const WIRED_BY_LINK = [
  'components/activity/ActivityProjectGroup',
  'components/BoardBell',
  'components/Dashboard/AddrGroup',
  'components/DrawSchedule/ProjectBlockPopup',
  'components/LibraryMatrix',
  'components/MyTasks/TaskCard',
  'components/MyTasks/TaskDetailPanel',
  'components/MyTasks/WaitingOnView',
  'components/PermitCard',
  'components/ProjectDetail/ChatMessageRow',
  'components/ProjectDetail/ProjectDetailHeader',
  'components/ProjectDetail/ReuseEditor',
  'components/Reports/BenchmarkSourceModal',
  'components/Reports/CorrectionCommentList',
  'components/Reports/CorrectionsMissingWorklist',
  'components/Reports/MetricDrillIn',
  'components/Reports/RedesignsTab',
  'components/TaskDetailEditor',
  'components/wizard/DuplicateAddressWarning',
  'pages/ApprovedAwaitingIssuanceReport',
  'pages/CorrectionsReport',
  'pages/MyBoard',
  'pages/Notifications',
  'pages/ProjectDetail',
  'pages/ProjectList',
  'pages/ReportsTeamDetail',
  'pages/WeeklyDaReport',
  'pages/WeeklyUpdatesReport',
] as const;

// ★★ The four that CANNOT be a link, and why each one is imperative:
//    NewProjectWizard navigates after an RPC returns an id; MyBoard's focus
//    row may open a task panel instead of navigating; What's New navigates to
//    a stored href through react-router rather than an <a>.
const WIRED_BY_HOOK = [
  'components/NewProjectWizard',
  'pages/MyBoard',
  'pages/WhatsNew',
] as const;

const sources = import.meta.glob('../{components,pages}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('fix-408 §3b: the wiring is where the audit says it is', () => {
  for (const mod of WIRED_BY_LINK) {
    it(`★ ${mod} links with <OriginLink>`, () => {
      const src = sources[`../${mod}.tsx`];
      expect(src, `source not found for ${mod}`).toBeTruthy();
      expect(src).toContain('<OriginLink');
    });
  }

  for (const mod of WIRED_BY_HOOK) {
    it(`★ ${mod} navigates with useOriginState()`, () => {
      const src = sources[`../${mod}.tsx`];
      expect(src, `source not found for ${mod}`).toBeTruthy();
      expect(src).toContain('useOriginState');
      expect(src).toContain('state: originState()');
    });
  }

  it('★★★ NOTHING links into a project with a bare <Link> any more', () => {
    // ★ The guard that makes this ticket stay fixed. A new surface that links
    //   into a project with a plain <Link> is exactly how fix-403's coverage
    //   became a bug report; here it is a failing test instead.
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (file.includes('OriginLink')) continue;
      // Strip comments so a PROSE mention of the old shape does not fail.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const re = /<Link\b[^>]*?\/project\//gs;
      if (re.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 · THE ROUTE TABLE IS COVERAGE-GUARDED — the fix-315 shape
// ---------------------------------------------------------------------------

describe('fix-408 §4: every route this app has can name itself', () => {
  it('★★★ every ribbon route and every documented exemption has a page NAME', () => {
    // ★ Without this, adding a route to router.tsx and forgetting to name it
    //   would ship a page that silently reports itself as "← Search" — the
    //   exact defect fix-408 exists to remove, re-introduced one route at a
    //   time. fix-313 lost two screens to a hand-written list with nothing
    //   checking it.
    const routes = [...allRibbonRoutes(), ...ribbonExemptPaths()].filter(
      // /login has no shell, no ribbon and no Previous button. You cannot be
      // standing on it when you click into a project.
      (p) => p !== '/login',
    );
    const unnamed = routes.filter((p) => originLabelForPath(p) === null);
    expect(unnamed).toEqual([]);
  });

  it('★★ the parameterised routes are named too — they are not in that union', () => {
    expect(originLabelForPath('/project/abc')).toBe('Project');
    expect(originLabelForPath('/reports/team/Bobby%20Dias')).toBe('Team');
    expect(originLabelForPath('/reports/custom/r1')).toBe('Report');
    expect(originLabelForPath('/reports/builder/r1')).toBe('Report builder');
  });

  it('★★ a MORE SPECIFIC route wins — first match, longest pattern first', () => {
    // fix-335's ribbon rule, applied to the same problem in a different place.
    expect(originLabelForPath('/reports/corrections/patterns')).toBe(
      'Recurring corrections',
    );
    expect(originLabelForPath('/reports/corrections')).toBe('Corrections');
    expect(originLabelForPath('/settings/errors')).toBe('Error triage');
    expect(originLabelForPath('/settings/team')).toBe('Settings');
  });

  it('★ a trailing hash does not defeat the match', () => {
    expect(originLabelForPath('/library#top')).toBe('Library');
  });
});

// ---------------------------------------------------------------------------
// §5 · THE LINK ITSELF — mounted, clicked, read back
// ---------------------------------------------------------------------------

function Probe() {
  const loc = useLocation();
  const p = previousTarget(loc.state, `${loc.pathname}${loc.search}`);
  return <div data-testid="probe">{p.label}</div>;
}

function mountAt(from: string, to: string, originLabel?: string) {
  return render(
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <OriginLink to={to} originLabel={originLabel} data-testid="go">
                open
              </OriginLink>
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('fix-408 §5: <OriginLink>, mounted', () => {
  it('★★★ THE REPRODUCTION: Notifications → a project chat reads "← Notifications"', () => {
    mountAt('/notifications', '/project/pA?chat=1');
    expect(screen.getByTestId('probe').textContent).toBe('← Search');
    fireEvent.click(screen.getByTestId('go'));
    expect(screen.getByTestId('probe').textContent).toBe('← Notifications');
  });

  it('★★★ CHAINED: My Board → a chat → a permit inside it — the IMMEDIATE page wins', () => {
    // ★ Nothing is threaded and nothing is popped: each link reads
    //   `useLocation()`, so the second click records the CHAT and the first
    //   page of the chain is correctly gone.
    const first = mountAt('/board', '/project/pA?chat=1');
    fireEvent.click(screen.getByTestId('go'));
    expect(screen.getByTestId('probe').textContent).toBe('← My Board');
    first.unmount();

    // Hop two, from where hop one landed.
    mountAt('/project/pA?chat=1', '/project/pA?permit=5');
    fireEvent.click(screen.getByTestId('go'));
    // ★ The chat, NOT My Board. (Its label here is the generic route name;
    //   ProjectDetail resolves the project's address — §1 covers that.)
    expect(screen.getByTestId('probe').textContent).toBe('← Project');
  });

  it('★★ an explicit `state` from the caller is never overridden', () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <OriginLink
                  to="/project/pA"
                  state={{ from: '/dashboard' }}
                  data-testid="go"
                >
                  open
                </OriginLink>
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('go'));
    expect(screen.getByTestId('probe').textContent).toBe('← Pipeline');
  });

  it('★★ a page with NO name records nothing — the button stays "← Search"', () => {
    mountAt('/some/unknown/page', '/project/pA');
    fireEvent.click(screen.getByTestId('go'));
    expect(screen.getByTestId('probe').textContent).toBe('← Search');
  });

  it('★★ an originLabel overrides the route name', () => {
    mountAt('/project/pA', '/project/pB', '4137 S Junction St');
    fireEvent.click(screen.getByTestId('go'));
    expect(screen.getByTestId('probe').textContent).toBe('← 4137 S Junction St');
  });
});
