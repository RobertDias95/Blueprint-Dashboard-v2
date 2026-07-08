import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import Chrome from './components/Chrome';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Reports from './pages/Reports';
import ReportsTeamDetail from './pages/ReportsTeamDetail';
import MyTasks from './pages/MyTasks';
import DrawSchedule from './pages/DrawSchedule';
import ActivityPage from './pages/ActivityPage';
import WeeklyDaReport from './pages/WeeklyDaReport';
import ApprovedAwaitingIssuanceReport from './pages/ApprovedAwaitingIssuanceReport';
import ReportingHubPage from './pages/ReportingHubPage';
import CustomReport from './pages/CustomReport';
import ReportBuilder from './pages/ReportBuilder';
import ErrorsPage from './pages/Errors';

// Q2: routes wired to real read-side pages.
// Q9.5.a: structural realignment to v1's top-nav.
//   - /draw-schedule promoted to top-level (was a Settings sub-tab in
//     v2's misaligned shape). Hosts 3 sub-tabs: Draw Schedule / Library
//     / Seattle Intakes.
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
      { path: 'projects', element: <ProjectList /> },
      { path: 'project/:id', element: <ProjectDetail /> },
      { path: 'reports', element: <Reports /> },
      // fix-131: per-associate drill-down on the Team tab. Clicking an
      // associate's name in TeamPerformanceTable navigates here with the
      // role as a query param (so a name that appears in multiple roles
      // — e.g., Bobby as ENT — opens the right slice). URL-encoded name
      // handles spaces; the page falls back to a "not found" empty
      // state for any name not in the team_members roster.
      { path: 'reports/team/:name', element: <ReportsTeamDetail /> },
      // fix-67: Weekly DA Update report. Opened from the "Weekly DA Update"
      // card in the Reporting hub (Settings -> Reporting). URL stays stable.
      { path: 'reports/weekly-da', element: <WeeklyDaReport /> },
      // fix-221: Approved – Awaiting Issuance builtin report. Opened from its
      // card in the Reporting hub; rows deep-link to the permit in Project View.
      {
        path: 'reports/approved-awaiting',
        element: <ApprovedAwaitingIssuanceReport />,
      },
      // fix-68: Reporting hub (Reports Phase 2). Also surfaced as a Settings
      // modal section; this route makes the hub deep-linkable.
      { path: 'settings/reporting', element: <ReportingHubPage /> },
      // fix-87: Error triage page. Reached via the nav warning-triangle
      // badge or a direct URL share when triaging a specific group.
      { path: 'settings/errors', element: <ErrorsPage /> },
      // fix-69: report builder Phase 3 — freeform builder + custom viewer.
      { path: 'reports/builder', element: <ReportBuilder /> },
      { path: 'reports/builder/:id', element: <ReportBuilder /> },
      { path: 'reports/custom/:id', element: <CustomReport /> },
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
