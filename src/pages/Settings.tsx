import { useState } from 'react';
import DrawScheduleGrid from '../components/DrawScheduleGrid';
import LibraryMatrix from '../components/LibraryMatrix';
import IntakeTracker from '../components/IntakeTracker';
import AdminProjectsTab from '../components/Settings/AdminProjectsTab';
import AdminTeamTab from '../components/Settings/AdminTeamTab';
import AdminPermitsTab from '../components/Settings/AdminPermitsTab';

// Q2: Settings page shell — tabs: Draw Schedule, Library, Seattle Intakes.
// Q6.1: Draw Schedule tab renders the v1-parity grid.
// Q7.3.a: + "Projects" admin catalog tab (jurisdictions, permit types,
// product types, project tags).
// Q7.3.b: + "Team" tab (DAs/DMs/ENTs/ACQs + team structure + former DAs).
// Q7.3.c: + "Permits & Templates" tab (task templates editor with
// per-(type, juris, stage) scope).

type SettingsTab =
  | 'schedule'
  | 'library'
  | 'intakes'
  | 'projects'
  | 'team'
  | 'permits';

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
      </div>
      {tab === 'schedule' && <DrawScheduleTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'intakes' && <IntakesTab />}
      {tab === 'projects' && <AdminProjectsTab />}
      {tab === 'team' && <AdminTeamTab />}
      {tab === 'permits' && <AdminPermitsTab />}
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
