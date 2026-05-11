import { useState } from 'react';
import DrawScheduleGrid from '../components/DrawScheduleGrid';
import LibraryMatrix from '../components/LibraryMatrix';
import IntakeTracker from '../components/IntakeTracker';
import AdminProjectsTab from '../components/Settings/AdminProjectsTab';
import AdminTeamTab from '../components/Settings/AdminTeamTab';
import AdminPermitsTab from '../components/Settings/AdminPermitsTab';
import AdminAccountTab from '../components/Settings/AdminAccountTab';
import AdminScheduleTab from '../components/Settings/AdminScheduleTab';
import AdminConsultantsTab from '../components/Settings/AdminConsultantsTab';

// Q2: Settings page shell — tabs: Draw Schedule, Library, Seattle Intakes.
// Q6.1: Draw Schedule tab renders the v1-parity grid.
// Q7.3.a: + "Projects" admin catalog tab.
// Q7.3.b: + "Team" tab (DAs/DMs/ENTs/ACQs + team structure + former DAs).
// Q7.3.c: + "Permits & Templates" tab (task templates editor).
// Q7.3.d: + "Account" / "Schedule" / "Consultants" tabs. Q7.3 epic ships
// the v1 admin-modal surface area except the Data tab (dropped per Q3
// design decision).

type SettingsTab =
  | 'schedule'
  | 'library'
  | 'intakes'
  | 'projects'
  | 'team'
  | 'permits'
  | 'sched_bench'
  | 'consultants'
  | 'account';

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('schedule');

  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-0">
        <TabButton active={tab === 'schedule'} onClick={() => setTab('schedule')}>
          Draw Schedule
        </TabButton>
        <TabButton active={tab === 'library'} onClick={() => setTab('library')}>
          Library
        </TabButton>
        <TabButton active={tab === 'intakes'} onClick={() => setTab('intakes')}>
          Seattle Intakes
        </TabButton>
        <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>
          Projects
        </TabButton>
        <TabButton active={tab === 'team'} onClick={() => setTab('team')}>
          Team
        </TabButton>
        <TabButton active={tab === 'permits'} onClick={() => setTab('permits')}>
          Permits & Templates
        </TabButton>
        <TabButton
          active={tab === 'sched_bench'}
          onClick={() => setTab('sched_bench')}
        >
          Schedule
        </TabButton>
        <TabButton
          active={tab === 'consultants'}
          onClick={() => setTab('consultants')}
        >
          Consultants
        </TabButton>
        <TabButton active={tab === 'account'} onClick={() => setTab('account')}>
          Account
        </TabButton>
      </div>
      {tab === 'schedule' && <DrawScheduleTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'intakes' && <IntakesTab />}
      {tab === 'projects' && <AdminProjectsTab />}
      {tab === 'team' && <AdminTeamTab />}
      {tab === 'permits' && <AdminPermitsTab />}
      {tab === 'sched_bench' && <AdminScheduleTab />}
      {tab === 'consultants' && <AdminConsultantsTab />}
      {tab === 'account' && <AdminAccountTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-semibold transition border-b-2 ${
        active
          ? 'text-text border-de'
          : 'text-muted hover:text-text border-transparent'
      }`}
    >
      {children}
    </button>
  );
}

function DrawScheduleTab() {
  return <DrawScheduleGrid />;
}

function LibraryTab() {
  return <LibraryMatrix />;
}

function IntakesTab() {
  return <IntakeTracker />;
}
