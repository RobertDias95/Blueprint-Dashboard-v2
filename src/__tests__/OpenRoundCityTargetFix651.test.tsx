import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Permit, PermitCycle, PermitCycleReviewer } from '../lib/database.types';
import type { ReviewerEstimate } from '../lib/reviewerDueEstimate';
import {
  openRoundCityTarget,
  openRoundCityTargetText,
  openRoundEstimateIds,
} from '../lib/openRoundCityTarget';
import { permitUrgency } from '../lib/urgencyHelpers';
import { bucketPermits } from '../lib/permitStage';

// ★★★ fix-651 (P-340): "City Target" on the board is the OPEN round's date —
// its own city_target, else the latest due among its open reviewers (city date
// or fix-640 estimate) — never a closed round's.

vi.mock('../hooks/useDashboardPermitCards', () => ({
  useDashboardPermitCards: () => ({ data: new Map(), isLoading: false, error: null }),
}));

import AddrGroup from '../components/Dashboard/AddrGroup';

const NOW = new Date(2026, 9, 12, 12, 0, 0); // 2026-10-12, local noon

function cycle(over: Partial<PermitCycle>): PermitCycle {
  return {
    permit_id: 253,
    cycle_index: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    ...over,
  } as PermitCycle;
}

function reviewer(over: Partial<PermitCycleReviewer> & { target_date?: string | null }): PermitCycleReviewer {
  return {
    id: 'r?',
    permit_id: 253,
    cycle_index: 4,
    discipline: 'building',
    reviewer_name: 'Someone',
    current_status: 'in_review',
    last_event_date: null,
    target_date: null,
    ...over,
  } as PermitCycleReviewer;
}

function estimate(id: string, due: string, days = 15): ReviewerEstimate {
  return {
    reviewer_id: id,
    round_start: '2026-09-29',
    estimated_due: due,
    typical_days: days,
    sample_n: 24,
    basis_level: 1,
    window_tier: 'all',
    juris: 'Bellevue',
    discipline: 'building',
    permit_type: 'Building Permit',
    round_label: 'round 2+',
  };
}

// The 10431 SE 19th St shape, measured on prod 2026-10-12 (permit 253, BP
// 26 110228 BS): cycle 2 carried city_target 2026-08-05 and closed with
// corrections; the open cycle 4 (submitted 09-29) has none. Its open reviewers
// are estimated 10-14, 10-14, 10-15; two have already approved.
const CYCLES_10431: PermitCycle[] = [
  cycle({ cycle_index: 1, submitted: '2026-05-01', corr_issued: '2026-06-01', resubmitted: '2026-06-20' }),
  cycle({ cycle_index: 2, submitted: '2026-06-20', city_target: '2026-08-05', corr_issued: '2026-08-14', resubmitted: '2026-08-26' }),
  cycle({ cycle_index: 3, submitted: '2026-08-26', corr_issued: '2026-09-15', resubmitted: '2026-09-29' }),
  cycle({ cycle_index: 4, submitted: '2026-09-29' }),
];
const REVIEWERS_10431: PermitCycleReviewer[] = [
  reviewer({ id: 'bldg', reviewer_name: 'Charles Miller', discipline: 'building' }),
  reviewer({ id: 'lu', reviewer_name: 'Angus Bevan', discipline: 'land_use' }),
  reviewer({ id: 'util', reviewer_name: 'Jason Felgar', discipline: 'utilities' }),
  reviewer({ id: 'civil', reviewer_name: 'Arturo Chi', discipline: 'civil', current_status: 'approved', last_event_date: '2026-10-09' }),
  reviewer({ id: 'row', reviewer_name: 'Andre Vuong', discipline: 'row', current_status: 'approved', last_event_date: '2026-10-09' }),
  // A CLOSED round's open-looking reviewer must never be read.
  reviewer({ id: 'old', cycle_index: 2, target_date: '2026-12-31' }),
];
const EST_10431 = new Map<string, ReviewerEstimate>([
  ['bldg', estimate('bldg', '2026-10-14')],
  ['lu', estimate('lu', '2026-10-14')],
  ['util', estimate('util', '2026-10-15', 16)],
]);

describe('openRoundCityTarget — the rule', () => {
  it("10431's shape: old round dated, open round not → the open reviewers' latest estimate, never 08-05", () => {
    const t = openRoundCityTarget(CYCLES_10431, REVIEWERS_10431, EST_10431);
    expect(t).toMatchObject({ date: '2026-10-15', estimated: true, source: 'reviewers', cycleIndex: 4 });
    expect(openRoundCityTargetText(t)).toBe('~2026-10-15 (est.)');
    expect(t!.basis).toContain('Cycle 4 has no city target');
    expect(t!.basis).toContain('Jason Felgar: ~due 10/15/2026 (est.) — Typical for Bellevue');
    // Approved reviewers and the closed round's reviewer are not in it.
    expect(t!.basis).not.toContain('Arturo Chi');
    expect(t!.basis).not.toContain('12/31/2026');
  });

  it('before the estimates arrive it is blank — not the closed round', () => {
    expect(openRoundCityTarget(CYCLES_10431, REVIEWERS_10431)).toBeNull();
    expect(openRoundCityTarget(CYCLES_10431)).toBeNull();
  });

  it("open round dated → its own date, even when reviewers' dates are later", () => {
    const cycles = [...CYCLES_10431.slice(0, 3), cycle({ cycle_index: 4, submitted: '2026-09-29', city_target: '2026-10-20' })];
    const t = openRoundCityTarget(cycles, REVIEWERS_10431, new Map([['util', estimate('util', '2026-11-30')]]));
    expect(t).toEqual({ date: '2026-10-20', estimated: false, source: 'cycle', cycleIndex: 4, basis: null });
    expect(openRoundCityTargetText(t)).toBe('2026-10-20');
  });

  it('nothing on the open round → blank', () => {
    expect(openRoundCityTarget([cycle({ cycle_index: 1, city_target: '2026-07-01' }), cycle({ cycle_index: 2 })], [])).toBeNull();
    expect(openRoundCityTarget([], [])).toBeNull();
  });

  it("a reviewer's usable city date counts and is not an estimate; one estimate in the mix flags it", () => {
    const rs = [
      reviewer({ id: 'a', target_date: '2026-10-22', last_event_date: '2026-09-30' }),
      reviewer({ id: 'b' }),
    ];
    const cityOnly = openRoundCityTarget([cycle({ cycle_index: 4 })], [rs[0]!]);
    expect(cityOnly).toMatchObject({ date: '2026-10-22', estimated: false, source: 'reviewers' });
    const mixed = openRoundCityTarget([cycle({ cycle_index: 4 })], rs, new Map([['b', estimate('b', '2026-10-18')]]));
    expect(mixed).toMatchObject({ date: '2026-10-22', estimated: true });
  });

  it("a city date equal to the slot's open date is not a deadline (fix-640's test)", () => {
    const rs = [reviewer({ id: 'a', target_date: '2026-09-29', last_event_date: '2026-09-29' })];
    expect(openRoundCityTarget([cycle({ cycle_index: 4 })], rs)).toBeNull();
    expect(openRoundEstimateIds([cycle({ cycle_index: 4 })], rs)).toEqual(['a']);
  });

  it('asks for estimates only for the open round, only open reviewers with no usable city date, only when the round is undated', () => {
    expect(openRoundEstimateIds(CYCLES_10431, REVIEWERS_10431).sort()).toEqual(['bldg', 'lu', 'util']);
    const dated = [cycle({ cycle_index: 4, city_target: '2026-10-20' })];
    expect(openRoundEstimateIds(dated, REVIEWERS_10431)).toEqual([]);
  });
});

describe('urgency (pm) follows the value', () => {
  const permit = { id: 253, approval_date: null, target_submit: null } as unknown as Permit;

  it('a closed round past date no longer paints red', () => {
    expect(permitUrgency(permit, CYCLES_10431, 'pm', NOW)).toBe('ok');
  });
  it('the shown value drives the colour — past red, ≤5 business days yellow, later ok', () => {
    expect(permitUrgency(permit, CYCLES_10431, 'pm', NOW, false, '2026-10-09')).toBe('red');
    expect(permitUrgency(permit, CYCLES_10431, 'pm', NOW, false, '2026-10-15')).toBe('yellow');
    expect(permitUrgency(permit, CYCLES_10431, 'pm', NOW, false, '2026-11-15')).toBe('ok');
    expect(permitUrgency(permit, CYCLES_10431, 'pm', NOW, false, null)).toBe('ok');
  });
  it("without a resolved value it reads the open round's own city_target", () => {
    const cycles = [cycle({ cycle_index: 1, city_target: '2026-12-01' }), cycle({ cycle_index: 2, city_target: '2026-10-01' })];
    expect(permitUrgency(permit, cycles, 'pm', NOW)).toBe('red');
  });
});

describe('the Under Review column sorts on the open round', () => {
  it('a permit whose only date is a closed round sorts as undated (last)', () => {
    const mk = (id: number) =>
      ({ id, project_id: 'p', type: 'Building Permit', status: 'Reviews In Process', approval_date: null, actual_issue: null, target_submit: null, parent_permit_id: null } as unknown as Permit);
    const a = { permit: mk(1), cycles: [cycle({ permit_id: 1, cycle_index: 1, submitted: '2026-01-01', city_target: '2026-02-01', corr_issued: '2026-02-05', resubmitted: '2026-03-01' }), cycle({ permit_id: 1, cycle_index: 2, submitted: '2026-03-01' })] };
    const b = { permit: mk(2), cycles: [cycle({ permit_id: 2, cycle_index: 1, submitted: '2026-09-01', city_target: '2026-11-01' })] };
    const out = bucketPermits([a, b], new Map());
    expect(out.pm.map((p) => p.id)).toEqual([2, 1]);
  });
});

describe('the board card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  function renderCard(cycles: PermitCycle[], target: ReturnType<typeof openRoundCityTarget>) {
    const permit = { id: 253, project_id: 'proj', type: 'Building Permit', num: '26 110228 BS', approval_date: null, target_submit: null } as unknown as Permit;
    return render(
      <MemoryRouter>
        <AddrGroup
          address="10431 SE 19th St"
          juris="Bellevue"
          projectId="proj"
          permits={[permit]}
          stage="pm"
          cyclesByPermit={new Map([[253, cycles]])}
          reviewersByPermit={new Map()}
          keyDateLabel="City Target"
          getKeyDate={() => openRoundCityTargetText(target)}
          getCityTarget={() => target}
          isOpen={true}
          isHighlighted={false}
          onToggle={() => {}}
          onHover={() => {}}
          onLeave={() => {}}
        />
      </MemoryRouter>,
    );
  }

  it("10431: shows ~2026-10-15 (est.) with the pop-up's basis, not 2026-08-05 in red", () => {
    const t = openRoundCityTarget(CYCLES_10431, REVIEWERS_10431, EST_10431);
    renderCard(CYCLES_10431, t);
    const pill = screen.getByTestId('addr-group-keydate-253');
    expect(pill.textContent).toBe('~2026-10-15 (est.)');
    expect(pill.getAttribute('title')).toContain('Typical for Bellevue');
    const row = screen.getByTestId('addr-group-expanded-keydate-253');
    expect(row.textContent).toBe('~2026-10-15 (est.)');
    // 10-15 is three business days out → yellow, the estimate colours like a date.
    expect(row.style.color).toBe('var(--color-co)');
    expect(document.body.textContent).not.toContain('2026-08-05');
  });

  it('nothing → a dash and no colour', () => {
    renderCard(CYCLES_10431, null);
    expect(screen.queryByTestId('addr-group-keydate-253')).toBeNull();
    const row = screen.getByTestId('addr-group-expanded-keydate-253');
    expect(row.textContent).toBe('—');
    expect(row.style.color).toBe('var(--color-text)');
  });
});

describe('no "latest across all cycles" reader is left on the board', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('Dashboard, urgency and the pm sort read the open round', () => {
    expect(src('pages/Dashboard.tsx')).not.toMatch(/mostRecent\([^)]*city_target/);
    expect(src('lib/permitStage.ts')).not.toMatch(/mostRecent\([^)]*city_target/);
    expect(src('lib/urgencyHelpers.ts')).not.toMatch(/\.map\(\(c\) => c\.city_target/);
  });
});
