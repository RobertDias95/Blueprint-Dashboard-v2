import { useState } from 'react';
import TabStrip from '../components/shared/TabStrip';
import DrawScheduleGrid from '../components/DrawScheduleGrid';
import IntakeTracker from '../components/IntakeTracker';
import StatusLegend from '../components/DrawSchedule/StatusLegend';

// Q9.5.a: Draw Schedule promoted to top-level route. v1 had 3 sub-tabs
// (index.html:9257-9261) — Draw Schedule / Library / Seattle Intakes.
//
// fix-297: TWO now. Library moved to its own top-level route at /library: it
// is not a view of the draw schedule, it was used on its own, and as a
// useState sub-tab it had no URL to bookmark or share. The sub-tab bar stays —
// Seattle Intakes still needs somewhere to live and the pattern still holds.
// Sub-tabs are visually the same pattern as Reports' Overview/Trends
// (12px/700 system-sans, var(--color-de) underline active, var(--color-muted) inactive).
// Q9.5.b: typography simplified — was Syne in earlier v1; now system-sans.

type DSTab = 'schedule' | 'intake';

export default function DrawSchedule() {
  const [tab, setTab] = useState<DSTab>('schedule');

  // ★ fix-313: the root was h-[calc(100vh-52px-48px)] — the old 52px header
  // plus Chrome's 48px vertical padding, hard-coded. The Bridge shell makes
  // <main> a fixed-height flex child that owns its own scroll, so this can
  // simply fill it. That also ends the drift: the number was going to be wrong
  // the moment the header changed height, which it just did.
  return (
    <div className="flex flex-col h-full" data-testid="draw-schedule-page">
      {/* ★★★ fix-485 §B (P-137): the shared `TabStrip`. This page's `SubTab`
          and the Reports sub-nav rendered the SAME class string character for
          character — Reports' own comment said so — so this conversion changes
          nothing on screen and everything about how many places that string
          lives.

          ★★ WHAT IT GAINS is the contract it never had: `role="tablist"`,
          `role="tab"`, `aria-selected`, a roving `tabIndex` and Arrow/Home/End
          movement. To a screen reader these were two anonymous buttons. */}
      <TabStrip<DSTab>
        tabs={[
          { id: 'schedule', label: 'Draw Schedule', testid: 'ds-tab-schedule' },
          { id: 'intake', label: 'Seattle Intakes', testid: 'ds-tab-intake' },
        ]}
        active={tab}
        onSelect={setTab}
        ariaLabel="Draw Schedule sections"
        testIdPrefix="ds-subtab"
        className="flex-shrink-0 px-[18px] bg-surface"
      />

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
      {tab === 'intake' && (
        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          <IntakeTracker />
        </div>
      )}
    </div>
  );
}

// ★★★ fix-485 §B: `SubTab` IS DELETED. It was this page's private copy of the
// Reports sub-nav's class string — identical, character for character, and with
// none of its accessibility. `shared/TabStrip` is the one that survived; see
// the note at the strip above for which treatment was chosen and why.
