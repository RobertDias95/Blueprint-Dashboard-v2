import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import AdminRoute from './components/AdminRoute';
import Chrome from './components/Chrome';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import RouteErrorFallback from './components/RouteErrorFallback';
import Reports from './pages/Reports';
import ReportsTeamDetail from './pages/ReportsTeamDetail';
import PersonalBoard from './pages/PersonalBoard';
import DrawSchedule from './pages/DrawSchedule';
import LibraryMatrix from './components/LibraryMatrix';
import ActivityPage from './pages/ActivityPage';
import WeeklyDaReport from './pages/WeeklyDaReport';
import WeeklyUpdatesReport from './pages/WeeklyUpdatesReport';
import ApprovedAwaitingIssuanceReport from './pages/ApprovedAwaitingIssuanceReport';
import VendorScheduleForecastReport from './pages/VendorScheduleForecastReport';
import CorrectionsReport from './pages/CorrectionsReport';
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
      // fix-265: Vendor Schedule Forecast — the weekly note to the structural
      // engineer. Composes an Outlook draft; "Mark as sent" is separate.
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
      { path: 'settings/reporting', element: <AdminRoute><SettingsPage /></AdminRoute> },
      // fix-87: Error triage page. Reached via the nav warning-triangle
      // badge or a direct URL share when triaging a specific group. (Not report
      // data — left ungated.)
      { path: 'settings/errors', element: <ErrorsPage /> },
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
      { path: 'board', element: <PersonalBoard /> },
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
      // ★ fix-325 #5: Waiting On folded into My Tasks. Bobby: "I think the
      // waiting on needs to get folded into the my task section." /board mounts
      // the full MyTasks shell now, whose Mine / Waiting On switcher is URL-
      // backed — so this redirect lands on the view itself, not merely near it.
      //
      // ★ The route is KEPT rather than deleted: fix-315 exists because fix-313
      // removed a destination and stranded a real surface. The per-firm CSV is
      // the reason that screen was rescued, and every link and bookmark to it
      // still arrives.
      {
        path: 'waiting-on',
        element: <Navigate to="/board?view=waiting-on" replace />,
      },
      // fix-28: scraper activity feed. NotificationBell links here;
      // page owns search / category / ent filters + per-row read state.
      { path: 'activity', element: <ActivityPage /> },
      // Q9.5.a sent bare /settings to /dashboard because Settings was a modal.
      // ★ fix-319 #76: it is a page now, so /settings goes to the page —
      // landing on Account, the one section every role can read.
      { path: 'settings', element: <Navigate to="/settings/account" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
