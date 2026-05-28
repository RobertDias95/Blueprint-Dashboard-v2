import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminAccountTab from './Settings/AdminAccountTab';
import AdminTeamTab from './Settings/AdminTeamTab';
import AdminProjectsTab from './Settings/AdminProjectsTab';
import AdminPermitsTab from './Settings/AdminPermitsTab';
import AdminScheduleTab from './Settings/AdminScheduleTab';
import AdminConsultantsTab from './Settings/AdminConsultantsTab';
import AdminReportingTab from './Settings/AdminReportingTab';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';

// Q9.5.a: System Settings modal. Restores v1's modal pattern
// (index.html:1469-1489) — 780px × 82vh container, two-column body
// with a 200px left nav rail + flex content area. Triggered from the
// gear button in Chrome.tsx.
//
// Non-admin users (tenant_memberships.role !== 'admin') see only the
// Account section. Section filtering matches v1's renderAdminPanel at
// line 6986. Data tab is intentionally absent — folded into Account's
// DB Tools card (Q9.5.a-sub decision).

interface Section {
  id: SectionId;
  icon: string;
  label: string;
  desc: string;
  adminOnly: boolean;
}

type SectionId =
  | 'account'
  | 'team'
  | 'projects'
  | 'permits'
  | 'schedule'
  | 'consultants'
  | 'reporting';

const SECTIONS: Section[] = [
  {
    id: 'account',
    icon: '👤',
    label: 'Account',
    desc: 'Your sign-in info + database tools',
    adminOnly: false,
  },
  {
    id: 'team',
    icon: '👥',
    label: 'Team',
    desc: 'Manage people + draw schedule groupings',
    adminOnly: true,
  },
  {
    id: 'projects',
    icon: '🏗️',
    label: 'Projects',
    desc: 'Jurisdictions, product types, project tags',
    adminOnly: true,
  },
  {
    id: 'permits',
    icon: '📄',
    label: 'Permits',
    desc: 'Permit types + task templates',
    adminOnly: true,
  },
  {
    id: 'schedule',
    icon: '📅',
    label: 'Schedule',
    desc: 'Per-juris learning windows',
    adminOnly: true,
  },
  {
    id: 'consultants',
    icon: '🤝',
    label: 'Consultants',
    desc: 'External consultant types + firms',
    adminOnly: true,
  },
  {
    id: 'reporting',
    icon: '📊',
    label: 'Reporting',
    desc: 'Saved reports library + categories',
    adminOnly: true,
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection?: SectionId;
}

export default function SettingsModal({
  open,
  onClose,
  initialSection = 'account',
}: Props) {
  const isAdmin = useIsTenantAdmin();
  const visibleSections = SECTIONS.filter((s) => isAdmin || !s.adminOnly);
  const [active, setActive] = useState<SectionId>(initialSection);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Derive the effective active section. If a non-admin somehow has an
  // admin-only section as their pick (e.g., role just changed), the
  // computed activeSection falls back to the first visible one without
  // a setState-in-effect cycle.
  const activeSection =
    visibleSections.find((s) => s.id === active) ?? visibleSections[0];
  const effectiveActive = activeSection.id;

  const body = (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'rgba(0,0,50,.5)' }}
      onClick={onClose}
      data-testid="settings-modal-overlay"
    >
      <div
        className="bg-surface border border-border rounded-xl flex flex-col overflow-hidden"
        style={{
          width: 780,
          maxWidth: '95vw',
          height: '82vh',
          minHeight: 520,
          maxHeight: 820,
          padding: 0,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[22px] py-[14px] pt-[18px] border-b border-border flex-shrink-0">
          <h2 className="m-0 text-base font-display font-extrabold text-text">
            System Settings
          </h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted text-xl leading-none cursor-pointer"
            aria-label="Close"
            data-testid="settings-modal-close"
          >
            ×
          </button>
        </div>

        {/* Two-column body: nav + content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left nav rail */}
          <div
            className="flex-shrink-0 border-r border-border overflow-y-auto py-2.5 bg-s2"
            style={{ width: 200 }}
            data-testid="settings-nav"
          >
            {visibleSections.map((s) => {
              const isActive = s.id === effectiveActive;
              return (
                <div
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition ${
                    isActive ? 'bg-surface' : 'bg-transparent hover:bg-s3'
                  }`}
                  style={{
                    borderRight: isActive
                      ? '2px solid var(--color-de, #2563eb)'
                      : '2px solid transparent',
                  }}
                  data-testid={`settings-nav-${s.id}`}
                >
                  <span className="text-base">{s.icon}</span>
                  <span
                    className={`text-xs ${isActive ? 'font-bold text-de' : 'font-medium text-text'}`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto px-6 py-[22px] min-w-0">
            <div className="mb-4">
              <div className="text-base font-display font-extrabold text-text mb-0.5">
                {activeSection.icon} {activeSection.label}
              </div>
              <div className="text-xs text-dim">{activeSection.desc}</div>
            </div>
            {effectiveActive === 'account' && <AdminAccountTab />}
            {effectiveActive === 'team' && <AdminTeamTab />}
            {effectiveActive === 'projects' && <AdminProjectsTab />}
            {effectiveActive === 'permits' && <AdminPermitsTab />}
            {effectiveActive === 'schedule' && <AdminScheduleTab />}
            {effectiveActive === 'consultants' && <AdminConsultantsTab />}
            {effectiveActive === 'reporting' && (
              <AdminReportingTab onAfterRun={onClose} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-[22px] py-3 border-t border-border flex-shrink-0 text-right">
          <button
            onClick={onClose}
            className="px-[18px] py-2 rounded-md border border-border bg-transparent text-muted text-[13px] font-display"
            data-testid="settings-modal-done"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
