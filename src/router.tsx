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
import MyTasks from './pages/MyTasks';
import DrawSchedule from './pages/DrawSchedule';
import LibraryMatrix from './components/LibraryMatrix';
import ActivityPage from './pages/ActivityPage';
import WeeklyDaReport from './pages/WeeklyDaReport';
import WeeklyUpdatesReport from './pages/WeeklyUpdatesReport';
import ApprovedAwaitingIssuanceReport from './pages/ApprovedAwaitingIssuanceReport';
import PhaseDurationsReport from './pages/PhaseDurationsReport';
import VendorScheduleForecastReport from './pages/VendorScheduleForecastReport';
import CorrectionsReport from './pages/CorrectionsReport';
import ReportingHubPage from './pages/ReportingHubPage';
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
      // fix-253: Phase Durations — city review vs our turnaround, per type,
      // jurisdiction and cycle. Read-only evidence for the phase model.
      {
        path: 'reports/phase-durations',
        element: (
          <AdminRoute>
            <PhaseDurationsReport />
          </AdminRoute>
        ),
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
      // fix-68: Reporting hub (Reports Phase 2). Also surfaced as a Settings
      // modal section; this route makes the hub deep-linkable. fix-234: renders
      // report data → admin-only, same as the Reports tab.
      { path: 'settings/reporting', element: <AdminRoute><ReportingHubPage /></AdminRoute> },
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
      { path: 'my-tasks', element: <MyTasks /> },
      // fix-28: scraper activity feed. NotificationBell links here;
      // page owns search / category / ent filters + per-row read state.
      { path: 'activity', element: <ActivityPage /> },
      // Q9.5.a: legacy /settings URLs land back on the dashboard since
      // Settings is now a modal. Bookmarks bouncing here is expected.
      { path: 'settings', element: <Navigate to="/dashboard" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
