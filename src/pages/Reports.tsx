import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReportsOverviewTab from '../components/Reports/ReportsOverviewTab';
import TeamTab from '../components/Reports/TeamTab';
import Trends from './Trends';

// fix-trends-subtab (2026-05-28): Reports hosts two analytics sub-tabs —
// Overview (the former Reports & Metrics body: charts + filter bar + CSV)
// and Trends (the former standalone /trends page, unchanged). Trends was a
// top-nav tab; it's folded back in here. Settings → Reporting (fix-68)
// remains the home for saved / categorized / custom reports.
//
// fix-127: third tab "Team" — per-associate volume + phase metrics for
// DA/DM/ENT. Managerial visibility tool, NOT a performance-review
// surface. Lives at /reports?tab=team.
//
// The active tab lives in the URL (?tab=overview|trends|team) so it's
// deep-linkable + back-button friendly. No param (or ?tab=overview) →
// Overview. The legacy /trends route still redirects to /reports?tab=trends.

type ReportsTab = 'overview' | 'trends' | 'team';

const TABS: { id: ReportsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'team', label: 'Team' },
];

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const active: ReportsTab =
    raw === 'trends' ? 'trends' : raw === 'team' ? 'team' : 'overview';
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectTab(tab: ReportsTab) {
    // Overview is the default — keep the URL clean by dropping the param.
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: false });
  }

  // role=tablist arrow-key navigation: Left/Right move focus + select.
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + TABS.length) % TABS.length;
    selectTab(TABS[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  }

  return (
    <div className="space-y-4" data-testid="reports-tabs">
      {/* Sub-tab bar — matches the DrawSchedule sub-tab styling. */}
      <div
        role="tablist"
        aria-label="Reports sections"
        className="flex items-center gap-0 border-b border-border"
        data-testid="reports-subtab-bar"
      >
        {TABS.map((t, i) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`reports-tab-${t.id}`}
              aria-selected={isActive}
              aria-controls={`reports-panel-${t.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`px-[18px] py-2.5 text-xs font-bold font-display border-b-2 transition -mb-px ${
                isActive
                  ? 'text-de border-de'
                  : 'text-muted border-transparent hover:text-text'
              }`}
              data-testid={`reports-tab-${t.id}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`reports-panel-${active}`}
        aria-labelledby={`reports-tab-${active}`}
        data-testid={`reports-panel-${active}`}
      >
        {active === 'trends' ? (
          <Trends />
        ) : active === 'team' ? (
          <TeamTab />
        ) : (
          <ReportsOverviewTab />
        )}
      </div>
    </div>
  );
}
