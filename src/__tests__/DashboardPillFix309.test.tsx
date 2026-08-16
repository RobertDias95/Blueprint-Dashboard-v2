import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Permit } from '../lib/database.types';
import type { PermitCardSummary } from '../lib/dashboardCardSummary';
import { permitUrgency, cardUrgency } from '../lib/urgencyHelpers';

// ★ fix-309 #50 — colour belongs to the PERMIT, not the project.
//
// "Get rid of how the projects show — the entire project pill shows solid red,
//  solid yellow. Keep the colour just to the permit status."
//
// A solid red project reads as "this whole project is in trouble" when the
// truth is usually one permit out of four. The replacement is NOT a blended or
// worst-case tint — that tells the same lie more quietly. It is no colour at
// all on the project element, with the permits inside it still coloured.

const mocks = vi.hoisted(() => ({
  cards: new Map<number, PermitCardSummary>(),
}));

vi.mock('../hooks/useDashboardPermitCards', () => ({
  useDashboardPermitCards: () => ({ data: mocks.cards, isLoading: false, error: null }),
}));

import AddrGroup from '../components/Dashboard/AddrGroup';

const NOW = new Date('2026-08-14T12:00:00Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'proj-1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: 'BP-1',
    da: 'Cam',
    dm: 'Brittani',
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
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
    updated_at: '2026-08-10T12:00:00Z',
    ...over,
  } as Permit;
}

// stage 'de' urgency is driven by target_submit: past → red, within 5 business
// days → yellow. Both are asserted below rather than assumed, so a change to
// the urgency rules fails loudly instead of quietly making this test vacuous.
const RED_PERMIT = makePermit({ id: 1, num: 'BP-1', target_submit: '2026-07-01' });
const YELLOW_PERMIT = makePermit({
  id: 2,
  num: 'DEM-2',
  type: 'Demolition',
  target_submit: '2026-08-17',
});

function renderGroup(permits: Permit[]) {
  mocks.cards.clear();
  return render(
    <MemoryRouter>
      <AddrGroup
        address="123 Main St"
        juris="Seattle"
        projectId="proj-1"
        permits={permits}
        stage="de"
        cyclesByPermit={new Map()}
        reviewersByPermit={new Map()}
        cardUrgency={cardUrgency(
          permits.map((p) => ({ permit: p, cycles: [] })),
          'de',
        )}
        keyDateLabel="Target Submit"
        getKeyDate={(p) => p.target_submit}
        isOpen={false}
        isHighlighted={false}
        onToggle={() => {}}
        onHover={() => {}}
        onLeave={() => {}}
      />
    </MemoryRouter>,
  );
}

/** Every colour actually painted on the project element itself. */
function pillColours(el: HTMLElement): string {
  const s = el.style;
  // ★ fix-327 gave a project ONE edge — the shorthand `border` — where it used
  // to have a 3px left rail and a bottom rule. Same question, new property: the
  // project's own edge must still be the neutral token and never an urgency
  // colour.
  return [
    s.background,
    s.backgroundColor,
    s.border,
    s.borderLeft,
    s.borderLeftColor,
    s.borderColor,
  ]
    .filter(Boolean)
    .join(' | ');
}

describe('fix-309 #50: the project pill carries no status colour', () => {
  // The fixture has to be genuinely mixed, or "no red on the project" would
  // pass because there was no red anywhere.
  it('the fixture really is one red permit and one yellow permit', () => {
    expect(permitUrgency(RED_PERMIT, [], 'de')).toBe('red');
    expect(permitUrgency(YELLOW_PERMIT, [], 'de')).toBe('yellow');
    // ...and the old project-level colour WOULD have been red.
    expect(
      cardUrgency(
        [RED_PERMIT, YELLOW_PERMIT].map((p) => ({ permit: p, cycles: [] })),
        'de',
      ),
    ).toBe('red');
  });

  it('renders a neutral project element — no urgency colour on it at all', () => {
    renderGroup([RED_PERMIT, YELLOW_PERMIT]);
    const group = screen.getByTestId('addr-group-de');
    const painted = pillColours(group);

    // The four literals the old URGENCY_BG / URGENCY_BORDER maps painted.
    expect(painted).not.toMatch(/#fee2e2|#fef9c3|#ef4444|#f59e0b|rgb\(254/i);
    // And no urgency token by any other name — including a blended or
    // worst-case tint, which is explicitly what must NOT replace it.
    expect(painted).not.toMatch(/red|yellow|amber|orange|--color-r\b/i);
    expect(painted).toContain('var(--color-border)');
    expect(painted).toContain('var(--color-surface)');
    expect(group.dataset.urgencyNeutral).toBe('true');
  });

  it('is neutral for an all-red project too, not just a mixed one', () => {
    renderGroup([RED_PERMIT, makePermit({ id: 3, num: 'BP-3', target_submit: '2026-06-01' })]);
    const group = screen.getByTestId('addr-group-de');
    expect(pillColours(group)).not.toMatch(/#fee2e2|#ef4444|red|rgb\(254/i);
  });

  it('but the permits INSIDE it are still coloured, red and yellow', () => {
    renderGroup([RED_PERMIT, YELLOW_PERMIT]);
    const group = screen.getByTestId('addr-group-de');
    const red = within(group).getByText('Building Permit').closest('span') as HTMLElement;
    const yellow = within(group).getByText('Demolition').closest('span') as HTMLElement;
    // jsdom normalises the hex the component sets to rgb().
    expect(red.style.background).toBe('rgb(254, 226, 226)');
    expect(yellow.style.background).toBe('rgb(254, 249, 195)');
  });

  it('a project whose permits are all fine looks the same as one with a red permit', () => {
    // The strongest form of "the project carries no colour": the project
    // element is byte-identical whatever is going on inside it.
    const first = renderGroup([makePermit({ id: 4, num: 'BP-4', target_submit: '2027-01-01' })]);
    const calm = pillColours(screen.getByTestId('addr-group-de'));
    first.unmount();

    renderGroup([RED_PERMIT, YELLOW_PERMIT]);
    const alarming = pillColours(screen.getByTestId('addr-group-de'));
    expect(alarming).toBe(calm);
  });
});
