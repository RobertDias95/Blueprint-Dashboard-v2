import { useState } from 'react';
import DrawScheduleGrid from '../components/DrawScheduleGrid';
import LibraryMatrix from '../components/LibraryMatrix';
import IntakeTracker from '../components/IntakeTracker';

// Q2: Settings page shell — three tabs: Draw Schedule, Library, Seattle
// Intakes. Q6 ships drag-and-drop draw schedule editing; Q7 builds the
// intake tracker UI. Q2 establishes the tab shell + a read-only summary
// for each so Bobby can verify the pipes are flowing.
//
// Q6.1: Draw Schedule tab now renders the v1-parity grid (read-only).
// Q6.2 will wire drag-to-edit; Q6.3 fills in Library + Intakes content.

type SettingsTab = 'schedule' | 'library' | 'intakes';

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
      </div>
      {tab === 'schedule' && <DrawScheduleTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'intakes' && <IntakesTab />}
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
