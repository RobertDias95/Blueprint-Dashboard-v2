import { useState } from 'react';
import DrawScheduleGrid from '../components/DrawScheduleGrid';
import LibraryMatrix from '../components/LibraryMatrix';
import IntakeTracker from '../components/IntakeTracker';
import StatusLegend from '../components/DrawSchedule/StatusLegend';

// Q9.5.a: Draw Schedule promoted to top-level route. 3 sub-tabs match v1
// index.html:9257-9261 — Draw Schedule / Library / Seattle Intakes.
// Sub-tabs are visually the same pattern as Reports' Overview/Trends
// (12px/700 Syne, var(--de) underline active, var(--muted) inactive).

type DSTab = 'schedule' | 'library' | 'intake';

export default function DrawSchedule() {
  const [tab, setTab] = useState<DSTab>('schedule');

  return (
    <div className="flex flex-col h-[calc(100vh-52px-48px)]" data-testid="draw-schedule-page">
      {/* Sub-tab bar — matches v1's ds-tab styling */}
      <div
        className="flex items-center gap-0 px-[18px] border-b border-border bg-surface flex-shrink-0"
        data-testid="ds-subtab-bar"
      >
        <SubTab active={tab === 'schedule'} onClick={() => setTab('schedule')} testId="ds-tab-schedule">
          Draw Schedule
        </SubTab>
        <SubTab active={tab === 'library'} onClick={() => setTab('library')} testId="ds-tab-library">
          Library
        </SubTab>
        <SubTab active={tab === 'intake'} onClick={() => setTab('intake')} testId="ds-tab-intake">
          Seattle Intakes
        </SubTab>
      </div>

      {tab === 'schedule' && (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex items-center gap-3 px-[18px] py-2.5 border-b border-border bg-surface flex-shrink-0">
            <StatusLegend />
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <DrawScheduleGrid />
          </div>
        </div>
      )}
      {tab === 'library' && (
        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          <LibraryMatrix />
        </div>
      )}
      {tab === 'intake' && (
        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          <IntakeTracker />
        </div>
      )}
    </div>
  );
}

function SubTab({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-[18px] py-2.5 text-xs font-bold font-display border-b-2 transition -mb-px ${
        active
          ? 'text-de border-de'
          : 'text-muted border-transparent hover:text-text'
      }`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
