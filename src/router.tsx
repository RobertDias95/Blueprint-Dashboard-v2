import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import Chrome from './components/Chrome';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

// Q2: routes wired to real read-side pages. /my-tasks stays a placeholder
// until Q7 ships the per-user task list. /admin retired — its features
// live under /settings now.
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
      { path: 'projects', element: <ProjectList /> },
      { path: 'project/:id', element: <ProjectDetail /> },
      { path: 'reports', element: <Reports /> },
      { path: 'settings', element: <Settings /> },
      {
        path: 'my-tasks',
        element: (
          <Placeholder
            title="My tasks"
            description="Per-user task list across permits. Q7."
          />
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
