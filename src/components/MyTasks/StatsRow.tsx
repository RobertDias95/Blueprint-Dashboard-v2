import type { TaskStats } from '../../lib/myTasksHelpers';

// Q7.1.b: stats summary row. Mirrors v1's #mt-stats block (index.html
// line 4983-4992). OVERDUE + THIS WEEK only render when count > 0 —
// keeps the row tidy on slow weeks.

export default function StatsRow({ stats }: { stats: TaskStats }) {
  return (
    <div
      className="bg-surface border border-border rounded-lg px-4 py-2 flex items-center gap-4 flex-wrap"
      data-testid="mytasks-stats-row"
    >
      <Stat label="Open" value={stats.open} testId="stat-open" tone="de" />
      {stats.overdue > 0 && (
        <>
          <Divider />
          <Stat
            label="Overdue"
            value={stats.overdue}
            testId="stat-overdue"
            tone="overdue"
          />
        </>
      )}
      {stats.thisWeek > 0 && (
        <>
          <Divider />
          <Stat
            label="This Week"
            value={stats.thisWeek}
            testId="stat-this-week"
            tone="co"
          />
        </>
      )}
      <Divider />
      <Stat
        label="Projects"
        value={stats.projects}
        testId="stat-projects"
        tone="jv"
      />
      <div className="flex-1" />
      <div
        className="flex items-center gap-2"
        data-testid="mytasks-progress"
      >
        <span className="text-xs text-muted font-mono">{stats.done} done</span>
        <div className="w-20 h-1.5 bg-border rounded-sm overflow-hidden">
          <div
            className="h-full bg-pm rounded-sm transition-[width]"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
        <span className="text-xs font-bold text-pm font-mono">
          {stats.pct}%
        </span>
      </div>
    </div>
  );
}

const TONE_CLASS: Record<'de' | 'co' | 'jv' | 'overdue', string> = {
  de: 'text-de',
  co: 'text-co',
  jv: 'text-jv',
  overdue: 'text-[#dc2626]', // hard red — matches v1's overdue color
};

function Stat({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: number;
  testId: string;
  tone: 'de' | 'co' | 'jv' | 'overdue';
}) {
  return (
    <div className="text-center min-w-[44px]">
      <div
        className={`text-xl font-display font-extrabold ${TONE_CLASS[tone]}`}
        data-testid={testId}
      >
        {value}
      </div>
      <div className="text-[9px] text-dim uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-7 bg-border" />;
}
