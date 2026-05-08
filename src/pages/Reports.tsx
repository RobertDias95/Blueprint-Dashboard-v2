import { useState } from 'react';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { effectiveStage } from '../lib/permitStage';
import type { Stage } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';

// Q2: Reports tab shell. Two tabs (Overview, Trends). Overview shows
// counts by stage; Trends is a placeholder until Q7 ships the time-series
// implementation. Replicates v1's renderReports tab structure.

type ReportsTab = 'overview' | 'trends';

const STAGE_ORDER: Stage[] = ['de', 'pm', 'co', 'ap', 'is'];
const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

export default function Reports() {
  const [tab, setTab] = useState<ReportsTab>('overview');

  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-0">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={tab === 'trends'} onClick={() => setTab('trends')}>
          Trends
        </TabButton>
      </div>
      {tab === 'overview' ? <OverviewTab /> : <TrendsTab />}
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
          ? 'text-text border-jv'
          : 'text-muted hover:text-text border-transparent'
      }`}
    >
      {children}
    </button>
  );
}

function OverviewTab() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();

  if (projectsQ.isLoading || permitsQ.isLoading) {
    return <SkeletonRows count={5} rowClassName="h-12" />;
  }

  const projects = projectsQ.data ?? [];
  const permits = permitsQ.data ?? [];
  const counts: Record<Stage, number> = { de: 0, pm: 0, co: 0, ap: 0, is: 0 };
  for (const p of permits) {
    counts[effectiveStage(p, p.permit_cycles ?? [])]++;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Active projects" value={projects.length} />
        <Stat label="Permits tracked" value={permits.length} />
        <Stat
          label="Avg permits / project"
          value={
            projects.length === 0
              ? '—'
              : (permits.length / projects.length).toFixed(1)
          }
        />
      </div>
      <div>
        <h3 className="text-xs font-display font-extrabold uppercase tracking-wide text-text mb-2">
          Permits by stage
        </h3>
        <ul className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {STAGE_ORDER.map((stage) => (
            <li
              key={stage}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="text-xs text-text font-display font-semibold">
                {STAGE_LABEL[stage]}
              </span>
              <span className="text-sm font-display font-black text-text font-mono">
                {counts[stage]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TrendsTab() {
  return (
    <div className="bg-surface border border-border rounded-xl px-6 py-12 text-center">
      <div className="text-sm font-display font-bold text-text mb-1">
        Trends — coming in Q7
      </div>
      <div className="text-xs text-muted">
        Time-series of submissions, approvals, and issuances. Q2 ships the tab
        shell; the full implementation lands with the reporting harness in Q7.
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-display font-black text-text mt-1 font-mono">
        {value}
      </div>
    </div>
  );
}
