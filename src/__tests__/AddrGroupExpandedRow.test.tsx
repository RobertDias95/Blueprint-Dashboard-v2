import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Permit } from '../lib/database.types';
import type { PermitCardSummary } from '../lib/dashboardCardSummary';

// fix-notes-2: the dashboard expanded permit row now shows the "waiting on"
// summary instead of the team-names + phase/stage lines. Confirms the removed
// lines are gone and the discipline chip + Target Submit remain.

const mocks = vi.hoisted(() => ({
  cards: new Map<number, PermitCardSummary>(),
}));

vi.mock('../hooks/useDashboardPermitCards', () => ({
  useDashboardPermitCards: () => ({ data: mocks.cards, isLoading: false, error: null }),
}));

import AddrGroup from '../components/Dashboard/AddrGroup';

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 7,
    project_id: 'proj-1',
    type: 'Demolition',
    stage: 'de',
    stage_override: null,
    status: null,
    num: 'DEM-7',
    da: 'Cam',
    dm: 'Brittani',
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: '2026-08-01',
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    extras: null,
    updated_at: '2026-05-15T12:00:00Z',
    ...over,
  } as Permit;
}

function renderGroup(cards: Map<number, PermitCardSummary>) {
  mocks.cards.clear();
  for (const [k, v] of cards) mocks.cards.set(k, v);
  const permit = makePermit();
  return render(
    <MemoryRouter>
      <AddrGroup
        address="123 Main St"
        juris="Seattle"
        projectId="proj-1"
        permits={[permit]}
        stage="de"
        cyclesByPermit={new Map()}
        reviewersByPermit={new Map()}
        cardUrgency="ok"
        keyDateLabel="Target Submit"
        getKeyDate={(p) => p.target_submit}
        isOpen={true}
        isHighlighted={false}
        onToggle={() => {}}
        onHover={() => {}}
        onLeave={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('AddrGroup ExpandedRow (fix-notes-2)', () => {
  it('removes the team-names line and the phase/stage line', () => {
    renderGroup(new Map([[7, { entTask: 'Order survey', archTask: null, note: null }]]));
    const row = screen.getByTestId('addr-group-expanded-7');
    // team names (Miles · Cam · Brittani) gone
    expect(row.textContent).not.toContain('Miles');
    expect(row.textContent).not.toContain('Brittani');
    // derived phase/stage label gone (e.g. "Pre-Submittal")
    expect(row.textContent).not.toContain('Pre-Submittal');
  });

  it('keeps the discipline chip and the Target Submit date', () => {
    renderGroup(new Map([[7, { entTask: 'Order survey', archTask: null, note: null }]]));
    const row = screen.getByTestId('addr-group-expanded-7');
    expect(row.textContent).toContain('Demolition'); // discipline chip
    expect(row.textContent).toContain('Target Submit');
    expect(row.textContent).toContain('2026-08-01');
  });

  it('renders the waiting-on summary for the permit', () => {
    renderGroup(
      new Map([[7, { entTask: 'Order survey', archTask: 'Redline plans', note: null }]]),
    );
    expect(screen.getByTestId('permit-waiting-on-slot-ent').textContent).toContain(
      'Order survey',
    );
    expect(screen.getByTestId('permit-waiting-on-slot-arch').textContent).toContain(
      'Redline plans',
    );
  });

  it('shows "Nothing pending" for a permit with no open tasks or notes', () => {
    renderGroup(new Map());
    expect(screen.getByTestId('permit-waiting-on-empty').textContent).toBe(
      'Nothing pending',
    );
  });
});
