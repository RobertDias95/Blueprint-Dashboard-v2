import { useState } from 'react';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useIntakeRecords } from '../hooks/useIntakeRecords';
import { useProjects } from '../hooks/useProjects';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';

// Q2: Settings page shell — three tabs: Draw Schedule, Library, Seattle
// Intakes. Q6 ships drag-and-drop draw schedule editing; Q7 builds the
// intake tracker UI. Q2 establishes the tab shell + a read-only summary
// for each so Bobby can verify the pipes are flowing.

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
  const drawQ = useDrawSchedule();
  const projectsQ = useProjects();

  if (drawQ.error || projectsQ.error) {
    return (
      <QueryError
        title="Draw schedule failed to load"
        error={drawQ.error ?? projectsQ.error}
        onRetry={() => {
          drawQ.refetch();
          projectsQ.refetch();
        }}
      />
    );
  }

  if (drawQ.isLoading || projectsQ.isLoading) {
    return <SkeletonRows count={6} rowClassName="h-10" />;
  }

  const projectById = new Map((projectsQ.data ?? []).map((p) => [p.id, p]));
  const rows = drawQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        {rows.length} row{rows.length === 1 ? '' : 's'} · drag/drop editing
        ships in Q6
      </div>
      <ul className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {rows.map((row) => {
          const project = projectById.get(row.project_id);
          return (
            <li
              key={row.project_id}
              className="flex items-center gap-3 px-4 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text font-display font-semibold truncate">
                  {project?.address ?? row.project_id}
                </div>
                <div className="text-[10px] text-muted font-mono">
                  {row.da_assigned ?? '—'} · {row.start_week ?? '—'}
                  {row.end_week ? ` → ${row.end_week}` : ''}
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-s2 text-text font-semibold uppercase tracking-wide">
                {row.status ?? '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LibraryTab() {
  return (
    <div className="bg-surface border border-border rounded-xl px-6 py-12 text-center">
      <div className="text-sm font-display font-bold text-text mb-1">
        Library — coming in Q7
      </div>
      <div className="text-xs text-muted">
        Roster, jurisdictions, permit types, task templates. Q2 establishes
        the route; the editor UI ships with the admin harness in Q7.
      </div>
    </div>
  );
}

function IntakesTab() {
  const intakesQ = useIntakeRecords();

  if (intakesQ.error) {
    return (
      <QueryError
        title="Intake records failed to load"
        error={intakesQ.error}
        onRetry={() => intakesQ.refetch()}
      />
    );
  }

  if (intakesQ.isLoading) return <SkeletonRows count={6} rowClassName="h-10" />;

  const rows = intakesQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        {rows.length} record{rows.length === 1 ? '' : 's'} · full intake
        tracker UI lands in Q7
      </div>
      <ul className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {rows.slice(0, 50).map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text font-display font-semibold truncate">
                {r.address ?? '—'}
              </div>
              <div className="text-[10px] text-muted font-mono truncate">
                {r.permit_num ?? '—'} · {r.applicant ?? '—'}
              </div>
            </div>
            <span className="text-[10px] text-dim font-mono">
              {r.intake_date ?? '—'}
            </span>
          </li>
        ))}
        {rows.length > 50 && (
          <li className="px-4 py-2 text-[11px] text-dim italic text-center">
            … {rows.length - 50} more
          </li>
        )}
      </ul>
    </div>
  );
}
