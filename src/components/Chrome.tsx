import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// Q2: app chrome. Five top-level routes mirroring v1's structure (v1
// index.html line 581-590): logo→Dashboard + Project View + My Tasks +
// Reports + Settings (which absorbs v1's Draw Schedule, Library, and
// Seattle Intakes as sub-tabs).
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projects', label: 'Project View' },
  { to: '/my-tasks', label: 'My Tasks' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
] as const;

export default function Chrome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface border-b border-border h-[52px] sticky top-0 z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <span className="font-display font-extrabold text-sm text-text">
            Blueprint Capital
          </span>
          <span className="font-display text-[8px] uppercase tracking-widest text-dim">
            Entitlements · v2
          </span>
        </div>
        <nav className="flex items-center gap-0 h-full">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `h-full px-4 flex items-center text-xs font-semibold transition ${
                  isActive
                    ? 'text-text border-b-2 border-de'
                    : 'text-muted hover:text-text border-b-2 border-transparent'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted hidden sm:inline">
            {user?.email}
          </span>
          <button
            onClick={handleLogout}
            className="text-xs px-3 py-1 rounded-md border border-border bg-s2 hover:bg-s3 text-text transition"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
