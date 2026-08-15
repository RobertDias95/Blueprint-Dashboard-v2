import { NavLink, useLocation } from 'react-router-dom';
import AdminAccountTab from '../components/Settings/AdminAccountTab';
import AdminTeamTab from '../components/Settings/AdminTeamTab';
import AdminProjectsTab from '../components/Settings/AdminProjectsTab';
import AdminPermitsTab from '../components/Settings/AdminPermitsTab';
import AdminScheduleTab from '../components/Settings/AdminScheduleTab';
import AdminReportingTab from '../components/Settings/AdminReportingTab';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import {
  SETTINGS_SECTIONS,
  sectionForPath,
  visibleSettingsSections,
  type SettingsSectionId,
} from '../lib/settingsSections';

// fix-319 #76 — System Settings as a PAGE.
//
//   Bobby: "Settings should no longer be a pop-up screen — it should just use
//   the screen vs a pop-up."
//
// ★ EVERY SECTION COMPONENT IS LIFTED UNCHANGED. AdminAccountTab, AdminTeamTab,
// AdminProjectsTab, AdminPermitsTab, AdminScheduleTab and AdminReportingTab are
// the same components the modal rendered, with the same props. None of them
// needed a dialog to work — the only modal-coupled prop was AdminReportingTab's
// `onAfterRun`, which existed solely to CLOSE the modal after a "Run", and
// which a page does not need: Run navigates, and there is nothing to close.
//
// The layout follows fix-313's contract — the PAGE never scrolls, the panel
// does. The rail and the content are independent flex children of a
// full-height column, and only the content region owns overflow.

export default function SettingsPage() {
  const { pathname } = useLocation();
  const isAdmin = useIsTenantAdmin();
  const visible = visibleSettingsSections(isAdmin);

  // The route decides the section — that is the whole point of the move, and
  // it is what makes a section linkable and reload-proof.
  //
  // ★ Two fallbacks, both deliberate. A path that is not a section (bare
  // /settings, which redirects) falls back to the first VISIBLE one; and an
  // admin-only section resolved for a non-admin does too. AdminRoute already
  // redirects that case at the router, so this is defence in depth — but it is
  // the same refusal the modal made, and a role that changes mid-session is
  // exactly when a gate that exists in only one place fails.
  const routed = sectionForPath(pathname);
  const permitted = routed && (isAdmin || !routed.adminOnly) ? routed : null;
  const active = permitted ?? visible[0] ?? SETTINGS_SECTIONS[0]!;

  return (
    <div
      className="h-full flex flex-col"
      style={{ overflow: 'hidden' }}
      data-testid="settings-page"
    >
      <div className="flex items-baseline gap-3 flex-none mb-3">
        <h1 className="text-[15px] font-extrabold text-text">System Settings</h1>
      </div>

      <div className="flex flex-1 min-h-0 border border-border rounded-md overflow-hidden bg-surface">
        {/* ── the section rail ── */}
        <nav
          className="flex-shrink-0 border-r border-border overflow-y-auto py-2.5 bg-s2"
          style={{ width: 200 }}
          data-testid="settings-nav"
          aria-label="Settings sections"
        >
          {visible.map((s) => (
            <NavLink
              key={s.id}
              to={s.path}
              data-testid={`settings-nav-${s.id}`}
              data-active={s.id === active.id ? 'true' : 'false'}
              className={`flex items-center gap-2.5 px-4 py-2.5 no-underline transition ${
                s.id === active.id ? 'bg-surface' : 'bg-transparent hover:bg-s3'
              }`}
              style={{
                borderRight:
                  s.id === active.id
                    ? '2px solid var(--color-de, #2563eb)'
                    : '2px solid transparent',
              }}
            >
              <span className="text-base">{s.icon}</span>
              <span
                className={`text-xs ${
                  s.id === active.id ? 'font-bold text-de' : 'font-medium text-text'
                }`}
              >
                {s.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* ── ★ the only scroll container on this page ── */}
        <div
          className="flex-1 min-w-0 min-h-0 overflow-auto px-6 py-[22px]"
          data-testid="settings-content"
        >
          <div className="mb-4">
            <div className="text-base font-display font-extrabold text-text mb-0.5">
              {active.icon} {active.label}
            </div>
            <div className="text-xs text-dim">{active.desc}</div>
          </div>
          <SectionBody id={active.id} />
        </div>
      </div>
    </div>
  );
}

function SectionBody({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case 'account':
      return <AdminAccountTab />;
    case 'team':
      return <AdminTeamTab />;
    case 'projects':
      return <AdminProjectsTab />;
    case 'permits':
      return <AdminPermitsTab />;
    case 'schedule':
      return <AdminScheduleTab />;
    case 'reporting':
      // ★ The Saved reports shelf, unchanged. fix-317 routes the whole Reports
      // group here via the ribbon's "Saved reports"; the wrapper page that used
      // to render this same component is retired, since the Settings page now
      // supplies the heading it existed for.
      return <AdminReportingTab />;
  }
}
