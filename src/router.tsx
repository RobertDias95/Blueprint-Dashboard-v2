import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import Chrome from './components/Chrome';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Reports from './pages/Reports';
import MyTasks from './pages/MyTasks';
import DrawSchedule from './pages/DrawSchedule';
import Trends from './pages/Trends';
import ActivityPage from './pages/ActivityPage';

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
      { path: 'trends', element: <Trends /> },
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
