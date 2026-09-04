import SavedReports from './pages/SavedReports';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import AdminRoute from './components/AdminRoute';
import Chrome from './components/Chrome';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import RouteErrorFallback from './components/RouteErrorFallback';
import Reports from './pages/Reports';
import ReportsTeamDetail from './pages/ReportsTeamDetail';
import PersonalBoard from './pages/PersonalBoard';
import DrawSchedule from './pages/DrawSchedule';
import LibraryMatrix from './components/LibraryMatrix';
import ActivityPage from './pages/ActivityPage';
import WhatsNewPage from './pages/WhatsNew';
import WeeklyDaReport from './pages/WeeklyDaReport';
import WeeklyUpdatesReport from './pages/WeeklyUpdatesReport';
import ApprovedAwaitingIssuanceReport from './pages/ApprovedAwaitingIssuanceReport';
import VendorScheduleForecastReport from './pages/VendorScheduleForecastReport';
import CorrectionsReport from './pages/CorrectionsReport';
import WaitingOnView from './components/Reports/WaitingOnView';
import BoardOrWaitingOn from './components/BoardOrWaitingOn';
import CorrectionPatterns from './pages/CorrectionPatterns';
import SettingsPage from './pages/SettingsPage';
import CustomReport from './pages/CustomReport';
import ReportBuilder from './pages/ReportBuilder';
import ErrorsPage from './pages/Errors';

// Q2: routes wired to real read-side pages.
// Q9.5.a: structural realignment to v1's top-nav.
//   - /draw-schedule promoted to top-level (was a Settings sub-tab in
//     v2's misaligned shape). fix-297: it now hosts TWO sub-tabs, Draw
//     Schedule / Seattle Intakes -- Library moved out to /library.
//   - fix-297: /library is its own top-level route. It is the per-project
//     matrix (units, lots, product types, stage), used on its own rather
//     than while reading the schedule, and as a useState sub-tab it had NO
//     URL at all -- nobody could bookmark it, link to it, or send it to
//     anyone. That, more than the tidiness, is what this fixes.
//   - /settings removed as a route — System Settings is a MODAL opened
//     from the gear button in Chrome, not a page. Legacy /settings URLs
//     redirect to /dashboard since the modal is stateful inside Chrome.

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <AuthGuard>
        <Chrome />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'draw-schedule', element: <DrawSchedule /> },
      // ★ NOT wrapped in AdminRoute, deliberately: /draw-schedule is not
      // either, and the Library has been reachable by everyone for as long as
      // it has existed. Gating it here would silently take a screen away from
      // the people already using it -- the kind of change nobody notices until
      // somebody cannot do their job. LibraryMatrix's own root is already
      // `space-y-3`, the same shape ProjectList uses, so it needs no page
      // wrapper: Chrome's <main className="flex-1 p-6"> supplies the padding
      // and the matrix keeps its own overflow-x-auto.
      { path: 'library', element: <LibraryMatrix /> },
      { path: 'projects', element: <ProjectList /> },
      // fix-260: errorElement scoped to ProjectDetail only (no broad routing
      // refactor). Without it React Router swallows a route render crash into
      // its built-in "Unexpected Application Error" page and logs NOTHING —
      // the app-level fix-87 boundary sits outside the router and never sees
      // it. This routes the crash through logError instead.
      {
        path: 'project/:id',
        element: <ProjectDetail />,
        errorElement: <RouteErrorFallback />,
      },
      // fix-234: the Reports hub + every report route is admin-only. A non-admin
      // navigating directly to any /reports path (or the Settings → Reporting
      // hub, which renders report data) is redirected to /dashboard by
      // AdminRoute. The nav tab is also hidden in Chrome for non-admins.
      { path: 'reports', element: <AdminRoute><Reports /></AdminRoute> },
      // ★★ fix-367 §1: the Saved reports shelf, at a reporting address and
      // WITHOUT the Settings chrome. It renders the same AdminReportingTab the
      // Settings section rendered — the component was never the problem — with
      // its own heading, which is what the retired ReportingHubPage existed for.
      //
      // ★ Admin-gated exactly as it was at /settings/reporting: fix-234's rule
      // that the Reports hub is admin-only, enforced on the ROUTE and not only
      // by hiding a ribbon entry.
      { path: 'reports/saved', element: <AdminRoute><SavedReports /></AdminRoute> },
      // fix-131: per-associate drill-down on the Team tab. Clicking an
      // associate's name in TeamPerformanceTable navigates here with the
      // role as a query param (so a name that appears in multiple roles
      // — e.g., Bobby as ENT — opens the right slice). URL-encoded name
      // handles spaces; the page falls back to a "not found" empty
      // state for any name not in the team_members roster.
      { path: 'reports/team/:name', element: <AdminRoute><ReportsTeamDetail /></AdminRoute> },
      // fix-67: Weekly DA Update report. Opened from the "Weekly DA Update"
      // card in the Reporting hub (Settings -> Reporting). URL stays stable.
      { path: 'reports/weekly-da', element: <AdminRoute><WeeklyDaReport /></AdminRoute> },
      // fix-notes-3: Weekly Updates — grouped, editable project/permit notes
      // (public.notes single source). Opened from its card in the Reporting hub.
      { path: 'reports/weekly-updates', element: <AdminRoute><WeeklyUpdatesReport /></AdminRoute> },
      // fix-221: Approved – Awaiting Issuance builtin report. Opened from its
      // card in the Reporting hub; rows deep-link to the permit in Project View.
      {
        path: 'reports/approved-awaiting',
        element: (
          <AdminRoute>
            <ApprovedAwaitingIssuanceReport />
          </AdminRoute>
        ),
      },
      // fix-253 put city-review vs our-turnaround durations here as a report.
      //
      // ★ fix-319 #77 MOVED IT into Settings → Permits. Bobby: "Technically
      // this belongs in the Settings, in the permit info." It is not something
      // you run — it is reference data about permit types, and it is the
      // evidence the per-type targets are read against.
      //
      // The route is REDIRECTED rather than deleted so bookmarks and saved
      // links survive, and the component is untouched — AdminPermitsTab mounts
      // it. Removing this route would have been the fix-315 defect again.
      {
        path: 'reports/phase-durations',
        element: <Navigate to="/settings/permits" replace />,
      },
      // fix-265: the weekly schedule forecast owed to an outside consultant.
      // Composes an Outlook draft; "Mark as sent" is separate.
      //
      // ★★★ fix-499 §B: ONE PATH, SEVEN REPORTS. The discipline is
      // `?discipline=<name>` and ABSENT MEANS STRUCTURAL, so every link and
      // bookmark that predates the change lands exactly where it always did.
      // A second path per discipline would be six more entries for the ribbon
      // coverage guard to account for and no behaviour at all.
      {
        path: 'reports/vendor-forecast',
        element: (
          <AdminRoute>
            <VendorScheduleForecastReport />
          </AdminRoute>
        ),
      },
      // fix-277: Corrections — every indexed correction-letter comment across
      // every project, with the consecutive-cycle repeat rate. Read-only.
      {
        path: 'reports/corrections',
        element: (
          <AdminRoute>
            <CorrectionsReport />
          </AdminRoute>
        ),
      },
      // fix-372: LEVELS TWO AND THREE. The corrections report above is level
      // one and is untouched; its rows link here. A separate static route so a
      // pattern is linkable and survives a reload, like every other report.
      {
        path: 'reports/corrections/patterns',
        element: (
          <AdminRoute>
            <CorrectionPatterns />
          </AdminRoute>
        ),
      },
      // ★ fix-319 #76: SETTINGS IS A PAGE. Every section is its own STATIC
      // route, so a section is linkable and survives a reload — and so that no
      // dynamic /settings/:id segment can ever swallow the two pre-existing
      // /settings/* routes below.
      //
      // ★ The collision the brief warned about turned out not to exist:
      // ReportingHubPage was a heading around <AdminReportingTab />, the SAME
      // component the modal's Reporting section rendered. So /settings/reporting
      // keeps its meaning exactly — the Saved reports shelf fix-317 routes the
      // whole Reports group through — it simply renders inside the Settings
      // chrome now. The wrapper page is retired, not moved.
      //
      // ★ Admin gating is preserved EXACTLY as the modal had it: Account is
      // open to everyone, the other five are admin-only. A route is guessable
      // in a way a modal tab was not, so the gate is enforced by AdminRoute
      // here as well as by hiding the rail entry.
      { path: 'settings/account', element: <SettingsPage /> },
      { path: 'settings/team', element: <AdminRoute><SettingsPage /></AdminRoute> },
      { path: 'settings/projects', element: <AdminRoute><SettingsPage /></AdminRoute> },
      { path: 'settings/permits', element: <AdminRoute><SettingsPage /></AdminRoute> },
      { path: 'settings/schedule', element: <AdminRoute><SettingsPage /></AdminRoute> },
      // ★★★ fix-367 §1: Saved Reports IS NOT A SETTING, and it was behaving
      // exactly as its address said.
      //
      // Bobby: "when you click Saved Reports under the Reporting tab it shows
      // Account, Team, Projects, Permits, Schedule. But the moment you click
      // any of those it takes you to Settings. I think Saved Reports should
      // just be the reporting feature, and then system settings would lose the
      // Reporting tab."
      //
      // ★ Nothing was broken. `/settings/reporting` renders <SettingsPage />,
      // so the whole Settings rail renders beside it and every item in that
      // rail is a Settings link. The page was in the wrong place.
      //
      // ★★ THE OLD ADDRESS IS KEPT AS A REDIRECT, not orphaned: people have it
      // bookmarked, fix-317 routed the entire Reports ribbon group through it,
      // and fix-319's own comment promised it "keeps its meaning exactly". It
      // still does — it just arrives somewhere that is not a settings screen.
      {
        path: 'settings/reporting',
        element: <Navigate to="/reports/saved" replace />,
      },
      // fix-87: Error triage page. ★ fix-331 §6: ADMIN ONLY now, and gated on
      // the ROUTE rather than only on the control that reaches it. It used to
      // be reachable by anyone who typed the URL, on the reasoning that it is
      // "not report data" — but it is a page of raw scraper failures and stack
      // traces, and 23 of this tenant's 29 people are editors who can do nothing
      // with it. Hiding the ribbon entry without gating the route would be the
      // hidden-link-over-an-open-door shape fix-234 already ruled out.
      { path: 'settings/errors', element: <AdminRoute><ErrorsPage /></AdminRoute> },
      // fix-69: report builder Phase 3 — freeform builder + custom viewer.
      { path: 'reports/builder', element: <AdminRoute><ReportBuilder /></AdminRoute> },
      { path: 'reports/builder/:id', element: <AdminRoute><ReportBuilder /></AdminRoute> },
      { path: 'reports/custom/:id', element: <AdminRoute><CustomReport /></AdminRoute> },
      // fix-trends-subtab: Trends folded into Reports as a sub-tab. Keep the
      // legacy /trends URL working by redirecting to the Reports Trends tab.
      { path: 'trends', element: <Navigate to="/reports?tab=trends" replace /> },
      // ★ fix-313 #62: My Tasks is no longer a destination — My Board is the
      // single personal view. Bobby: "My Tasks and the My Board are going to
      // get merged into one." Closes register #28.
      //
      // The route REDIRECTS rather than 404s so existing links and bookmarks
      // survive, including the ones the board itself emits. src/pages/MyTasks.tsx
      // and src/components/MyTasks/* are left in place, NOT deleted: TaskDetailEditor
      // was lifted out of MyTasks in fix-303 precisely so both screens could
      // share it and My Board still uses it, and WaitingOnView (fix-236) is a
      // real surface that may want a home on the board later. What is dead is
      // the ROUTE, and that is what this removes.
      { path: 'my-tasks', element: <Navigate to="/board" replace /> },
      // fix-298 Phase 1 made My Board its own route and page, deliberately
      // separate from My Tasks.
      //
      // ★ fix-318 (register #62) MERGES them, which is what Bobby asked for
      // and what fix-313 removed My Tasks without delivering: "the top half is
      // vertically fixed for My Board, and then the bottom half is fixed
      // vertically and horizontally for My Task." /board now renders both,
      // stacked. MyBoard and MineTasks are mounted as they are — nothing was
      // rebuilt, and both read the SAME useAllTasks query, so a tick in one
      // half re-renders the other from one invalidation.
      // ★★ fix-499 §D: `/board?view=waiting-on` was the way in while Waiting
      //    On lived inside the My Tasks shell (fix-325). The switcher is gone;
      //    the bookmark is not. A route cannot match a query string, so
      //    BoardOrWaitingOn reads it and sends those visits to
      //    /reports/waiting-on. Everything else is <PersonalBoard /> as before.
      { path: 'board', element: <BoardOrWaitingOn /> },
      // ★★★ fix-462 (P-045): the Agenda. NOT wrapped in a guard, deliberately —
      // agenda membership hides a ribbon ENTRY, it is not a permission, and the
      // screen is of no use rather than secret to somebody outside the meeting.
      // Contrast /settings/errors, which IS route-gated because it is
      // privileged: fix-234's "a hidden link over an open door" applies to
      // privileged screens, and this is not one.
      { path: 'agenda', element: <Agenda /> },
      // ★ fix-315: Waiting On gets its own route. fix-313 folded My Tasks into
      // My Board and redirected /my-tasks -> /board, which stranded this view —
      // it kept working and became unreachable. It is not a small panel: firm
      // grouping, firm status, a scope filter, an include-completed toggle and
      // CSV export both for all rows and per firm.
      //
      // ★ NOT the same thing as /reports/vendor-forecast ("Consultant
      // forecast"): that forecasts upcoming SENDS, this is what each firm
      // currently OWES US. Both stay.
      //
      // Ungated, matching where it came from — /my-tasks was never admin-only.
      // The component is mounted exactly as it was, with no props and no
      // rewrite; it needed a route, not a redesign.
      // ★★★ fix-499 §D — WAITING ON IS A REPORT. Bobby, 2026-08-31: *"Waiting
      // on gets moved into reports."*
      //
      // ★★★ UNGATED, AND THAT IS A DECISION, NOT AN OVERSIGHT. Every route
      // around it here is wrapped in <AdminRoute>, and this one must not be:
      // /my-tasks was never admin-only, fix-315's own comment says so, and 23
      // of 29 logins are non-admin editors. Moving a screen between two
      // addresses must not quietly take it away from the people using it.
      { path: 'reports/waiting-on', element: <WaitingOnView /> },
      // ★ fix-315 → fix-325 → fix-499: this path has now been rescued twice and
      // moved twice, and it still resolves. fix-315 exists because fix-313
      // removed a destination and stranded a real surface; the per-firm CSV is
      // the reason that screen was rescued. Every link and bookmark still
      // arrives — the address at the end of the chain is what changed.
      {
        path: 'waiting-on',
        element: <Navigate to="/reports/waiting-on" replace />,
      },
      // fix-28: scraper activity feed. The page owns search / category / ent
      // filters + per-row read state.
      //
      // ★ fix-326: this comment used to credit the old scraper bell as the way
      // in. That component is deleted; what reaches this route now is the
      // Reporting hub's "From the scraper" entry (fix-325) and the "Full scraper
      // activity →" link on My Board's health panel.
      { path: 'activity', element: <ActivityPage /> },
      // ★★★ fix-336 §2: the notification centre. Bobby: "if you got four
      // notifications and you go to My Board, there's nowhere that shows, hey,
      // here are your notifications."
      //
      // ★ Reached from the bell (two links: the list, and the "Not shown" line
      // that has been naming this destination since fix-298) and from My
      // Board's header. NOT a ribbon entry: the ribbon is navigation between
      // areas of work, and this is where a bell takes you — adding a rail item
      // would put a third entry point on a thing whose whole problem was
      // having none, and would touch fix-335's specificity rules for no gain.
      //
      // Ungated, like /board and /activity: everyone has notifications.
      // ★★★ fix-385: the notification centre is now a TAB of /board, and this
      // route is what makes that tab addressable. It renders the same tabbed
      // page with the Notifications tab pinned and LEAVES THE URL ALONE, so
      // `/notifications?kind=suppressed` still reaches Notifications.tsx's own
      // useSearchParams — fix-298's honesty line and fix-336 §2's destination
      // keep working with no parameter plumbing. Every standing link (the
      // bell's "see all" and its suppressed link, MyBoard's header link,
      // ribbonNav.ts's exemption entry) stays literally correct.
      { path: 'notifications', element: <PersonalBoard pinnedTab="notifications" /> },
      // ★★★ fix-350 — WHAT'S NEW. A ribbon entry, deliberately NOT admin-gated:
      // 23 of the 29 logins are non-admin editors and they are exactly the
      // people who have not been told that any of the last five days exists.
      // Writing an entry is admins-only, and that is enforced by RLS rather
      // than by this route.
      { path: 'whats-new', element: <WhatsNewPage /> },
      // Q9.5.a sent bare /settings to /dashboard because Settings was a modal.
      // ★ fix-319 #76: it is a page now, so /settings goes to the page —
      // landing on Account, the one section every role can read.
      { path: 'settings', element: <Navigate to="/settings/account" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
