import { useSearchParams } from 'react-router-dom';
import TabStrip from '../components/shared/TabStrip';
import ReportsOverviewTab from '../components/Reports/ReportsOverviewTab';
import TeamTab from '../components/Reports/TeamTab';
import RedesignsTab from '../components/Reports/RedesignsTab';
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
// fix-134: fourth tab "Redesigns" — trigger-source breakdown, builder
// leaderboard with redesign rate, per-role associate leaderboards, and
// a recent-redesigns table. Diagnostic surface for "which builders are
// triggering all this rework?" (Bobby's brainstorm framing).
//
// The active tab lives in the URL (?tab=overview|trends|team|redesigns)
// so it's deep-linkable + back-button friendly. No param (or
// ?tab=overview) → Overview. The legacy /trends route still redirects
// to /reports?tab=trends.

type ReportsTab = 'overview' | 'trends' | 'team' | 'redesigns';

const TABS: { id: ReportsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'team', label: 'Team' },
  { id: 'redesigns', label: 'Redesigns' },
];

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const active: ReportsTab =
    raw === 'trends'
      ? 'trends'
      : raw === 'team'
        ? 'team'
        : raw === 'redesigns'
          ? 'redesigns'
          : 'overview';

  function selectTab(tab: ReportsTab) {
    // Overview is the default — keep the URL clean by dropping the param.
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: false });
  }
  // ★ fix-485 §B: `tabRefs` and the Left/Right `onKeyDown` moved INTO
  //   `shared/TabStrip`. This file wrote the roving-tabindex + Arrow-key
  //   contract and it is now what every converted strip inherits, rather than
  //   the only one that had it. `selectTab` stays — the URL is this page's own
  //   business, and the strip only reports the choice.

  return (
    <div className="space-y-4" data-testid="reports-tabs">
      {/* ★★★ fix-485 §B (P-137): this is the strip `shared/TabStrip` was
          extracted FROM — its treatment AND its keyboard contract — so the
          conversion is a move rather than a change. The test ids are unchanged
          (`reports-tab-<id>`), which is what lets every fix-317/319/367 pin
          keep pointing at the same elements. */}
      <TabStrip<ReportsTab>
        tabs={TABS.map((t) => ({
          id: t.id,
          label: t.label,
          testid: `reports-tab-${t.id}`,
        }))}
        active={active}
        onSelect={selectTab}
        ariaLabel="Reports sections"
        testIdPrefix="reports-subtab"
      />

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
        ) : active === 'redesigns' ? (
          <RedesignsTab />
        ) : (
          <ReportsOverviewTab />
        )}
      </div>
    </div>
  );
}
