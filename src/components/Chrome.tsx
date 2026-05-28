import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import SettingsModal from './SettingsModal';
import NotificationBell from './NotificationBell';

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
  // fix-trends-subtab: Trends moved out of the top nav and back into Reports
  // as a sub-tab (/reports?tab=trends). The legacy /trends route redirects.
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
        {/* Left: Blueprint logo = home button (→ /dashboard).
            Q9.5.b: swapped from text-only to the v1 SVG logo at
            Webflow CDN (index.html:576). Padding + hover bg match
            v1's `.bp-home` class. Text fallback when img fails. */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 bg-transparent border-none rounded-lg hover:bg-s2 transition flex-shrink-0"
          style={{ padding: '5px 10px' }}
          title="Blueprint Capital — Home"
          data-testid="chrome-home"
        >
          <img
            src="https://cdn.prod.website-files.com/63541c8a0af27d5cafc89858/6358e4f2bd05f5417c7d88e7_Group%20891%20(3).svg"
            alt="Blueprint Capital"
            className="block w-auto"
            style={{ height: 26 }}
            onError={(e) => {
              // SVG load failed (offline, CDN gone, etc.) — degrade to
              // the v2 text label so the home button still works.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fallback = e.currentTarget
                .nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
          <span
            className="flex-col items-start leading-tight"
            style={{ display: 'none' }}
          >
            <span className="font-extrabold text-[13px] text-text tracking-tight">
              Blueprint Capital
            </span>
            <span className="text-[8px] uppercase tracking-widest text-dim font-medium">
              Entitlements
            </span>
          </span>
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
          {/* fix-27: notification center. Bell lives left of the gear
              per spec; its popover anchors right-aligned. */}
          <NotificationBell />
          <button
            onClick={() => setSettingsOpen(true)}
            className="bg-transparent border border-border text-muted hover:text-text px-3 py-1 rounded-md text-[11px] font-display font-semibold whitespace-nowrap transition ml-1.5"
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
