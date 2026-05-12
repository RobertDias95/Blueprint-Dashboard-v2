import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import SettingsModal from './SettingsModal';

// Q9.5.a: top-nav restructured to v1 parity (index.html:573-591).
//   - Blueprint logo on the left IS the home button (clicks → /dashboard).
//     No separate "Dashboard" nav item.
//   - 4 nav tabs in v1 order: Draw Schedule | Project View | My Tasks |
//     Reports. Each tab has a stage-themed active underline color.
//   - Vertical divider (1px × 24px, var(--border)) before the gear button.
//   - ⚙ Settings button (outlined chip style) opens the System Settings
//     modal. v1's Settings was always a modal; Q7.3 page-Settings was
//     wrong per the preserve-v1-layout rule.
//   - Sign-out moved into Settings → Account (not in the topbar). v1's
//     #bpLogoutBtn is display:none and only invoked from the Account
//     section.

interface NavItem {
  to: string;
  label: string;
  /** Active-state underline color. v1's nav-tab[data-view="*"].active
   *  CSS sets different border-bottom colors per tab. */
  activeColor: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/draw-schedule', label: 'Draw Schedule', activeColor: '#5a84c0' },
  { to: '/projects', label: 'Project View', activeColor: 'var(--color-pm, #059669)' },
  { to: '/my-tasks', label: 'My Tasks', activeColor: 'var(--color-co, #d97706)' },
  { to: '/reports', label: 'Reports', activeColor: 'var(--color-jv, #7c3aed)' },
];

export default function Chrome() {
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="bg-surface border-b border-border h-[52px] sticky top-0 z-50 flex items-center px-6"
        data-testid="chrome-header"
      >
        {/* Left: Blueprint logo = home button (→ /dashboard) */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 cursor-pointer bg-transparent border-none rounded-md px-2.5 py-1 hover:bg-s2 transition flex-shrink-0"
          title="Blueprint Capital — Home"
          data-testid="chrome-home"
        >
          <div className="flex flex-col items-start leading-tight">
            <span className="font-display font-extrabold text-[13px] text-text tracking-tight">
              Blueprint Capital
            </span>
            <span className="font-display text-[8px] uppercase tracking-widest text-dim font-medium">
              Entitlements
            </span>
          </div>
        </button>

        {/* Right: nav tabs + divider + gear */}
        <div className="flex items-center ml-auto h-full">
          <nav className="flex items-center gap-0 h-full" data-testid="chrome-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `h-full px-3.5 flex items-center text-xs font-semibold transition border-b-2 whitespace-nowrap ${
                    isActive
                      ? 'text-text'
                      : 'text-muted hover:text-text border-transparent'
                  }`
                }
                style={({ isActive }) =>
                  isActive ? { borderBottomColor: item.activeColor } : undefined
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div
            className="bg-border flex-shrink-0 mx-2"
            style={{ width: 1, height: 24 }}
          />
          <button
            onClick={() => setSettingsOpen(true)}
            className="bg-transparent border border-border text-muted hover:text-text px-3 py-1 rounded-md text-[11px] font-display font-semibold whitespace-nowrap transition"
            title="Settings"
            data-testid="chrome-settings-gear"
          >
            ⚙ Settings
          </button>
        </div>
      </header>
      {/* Keep p-6 on main for now — existing pages (Dashboard/Reports/
          MyTasks) rely on it. Q9.5.c moves padding to per-view per v1's
          `.view { padding: 24px 28px }` pattern. DrawSchedule's height
          math already accounts for the 48px vertical padding here. */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
