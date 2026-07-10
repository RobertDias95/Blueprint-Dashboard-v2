import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import AdminRoute from '../components/AdminRoute';

// fix-234: the Reports routes are wrapped in <AdminRoute>. A non-admin (editor)
// navigating directly to a guarded path is redirected to /dashboard; an admin
// reaches the page. Guards the route itself — hiding the nav tab is insufficient.

const T = 'test-tenant';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reports"
          element={
            <AdminRoute>
              <div data-testid="reports-page">REPORTS</div>
            </AdminRoute>
          }
        />
        <Route path="/dashboard" element={<div data-testid="dashboard-page">DASH</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute (fix-234 Reports admin-only route guard)', () => {
  beforeEach(() => {
    useAuthStore.setState({ activeTenantId: T, memberships: [] });
  });

  it('an admin reaches the guarded Reports page', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'admin' }],
    });
    renderAt('/reports');
    expect(screen.getByTestId('reports-page')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('a non-admin (editor) is redirected to /dashboard, not shown the page', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderAt('/reports');
    expect(screen.queryByTestId('reports-page')).toBeNull();
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  it('a user with no membership for the active tenant is redirected', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: 'other-tenant', role: 'admin' }],
    });
    renderAt('/reports');
    expect(screen.queryByTestId('reports-page')).toBeNull();
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });
});
