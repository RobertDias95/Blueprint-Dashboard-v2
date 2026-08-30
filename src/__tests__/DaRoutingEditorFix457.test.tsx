import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  groupRoutingByDa,
  unroutedActiveDas,
  removeRuleConsequence,
} from '../lib/daRouting';
import type { DaTeamRoutingRow } from '../hooks/useDaTeamRouting';
import { daHasRoutingFor } from '../hooks/useDaTeamRouting';

// ===========================================================================
// ★★★ fix-457 (P-007) — THE DOOR da_team_routing NEVER HAD
// ===========================================================================
//
// fix-72 built the table in May 2026 with four RLS policies and no editor, so
// every routing change since needed a hand-written INSERT.
//
// ★★★ IT FIXES NO ROWS. Measured on prod 2026-08-30: 14 rows, 11 distinct DAs,
// 11 active DAs and NONE without a rule, no row pointing at an inactive or
// unknown person. The table is healthy; what was missing was the ability to
// keep it that way without Claude.
//
// ★★★ AND THE BRIEF'S BEHAVIOURAL CLAIM WAS WRONG, WHICH THIS SUITE PINS.
// "A DA with no row defaults to Miles" is not implemented anywhere:
// bp_ent_lead_for_da returns NULL for an unrouted DA, and
// bp_cascade_ent_lead_for_project carries
//   AND public.bp_ent_lead_for_da(p.da, pr.juris) IS NOT NULL
// so the cascade SKIPS that permit and ent_lead stays NULL. Every DA appearing
// to route to Miles is fix-72's SEED data. The real consequence is worse and is
// asserted below.

const R = (
  id: number,
  da: string,
  jurisdiction: string | null,
  ent_lead: string,
): DaTeamRoutingRow => ({
  id,
  da,
  jurisdiction,
  ent_lead,
  updated_at: `2026-08-30T00:00:0${id}Z`,
});

/** The prod shape on 2026-08-30, trimmed to the interesting DAs. */
const PROD_SHAPE: DaTeamRoutingRow[] = [
  R(1, 'Ainsley', null, 'Miles'),
  R(2, 'Fisk', null, 'Miles'),
  R(3, 'Fisk', 'Seattle', 'Briana'),
  R(4, 'Qisheng', null, 'Miles'),
  R(5, 'Qisheng', 'Phoenix', 'Briana'),
  R(6, 'Qisheng', 'Scottsdale', 'Briana'),
];

describe('fix-457 §A2 — the grouping IS the precedence rule', () => {
  it('★★★ default first, overrides beneath, alphabetical', () => {
    const groups = groupRoutingByDa(PROD_SHAPE);
    expect(groups.map((g) => g.da)).toEqual(['Ainsley', 'Fisk', 'Qisheng']);

    const qisheng = groups.find((g) => g.da === 'Qisheng')!;
    expect(qisheng.default?.ent_lead).toBe('Miles');
    expect(qisheng.overrides.map((r) => r.jurisdiction)).toEqual([
      'Phoenix',
      'Scottsdale',
    ]);

    const ainsley = groups.find((g) => g.da === 'Ainsley')!;
    expect(ainsley.overrides).toEqual([]);
  });

  it('★★★ most-specific-wins, mirroring bp_ent_lead_for_da', () => {
    // The function's own ordering, quoted from prod:
    //   WHERE da = p_da AND (jurisdiction = p_juris OR jurisdiction IS NULL)
    //   ORDER BY (jurisdiction IS NULL) ASC   -- non-NULL (specific) first
    //   LIMIT 1
    // The panel must not imply a precedence the function does not implement,
    // so the layout is asserted against that rule directly.
    const g = groupRoutingByDa(PROD_SHAPE).find((x) => x.da === 'Fisk')!;
    const resolve = (juris: string | null) =>
      (g.overrides.find((r) => r.jurisdiction === juris) ?? g.default)?.ent_lead;

    expect(resolve('Seattle')).toBe('Briana'); // the specific row wins
    expect(resolve('Bellevue')).toBe('Miles'); // …and the default elsewhere
    expect(resolve(null)).toBe('Miles');
  });

  it('★ a DA with only jurisdiction rules is shown as having no default', () => {
    const g = groupRoutingByDa([R(9, 'Nobody', 'Seattle', 'Briana')])[0];
    expect(g.default).toBeNull();
    expect(g.overrides).toHaveLength(1);
  });

  it('★★ two default rows do not crash the grouping', () => {
    // The UNIQUE (tenant_id, da, jurisdiction) constraint cannot prevent this —
    // NULL != NULL in Postgres, proved on a temp table: the constraint accepted
    // two. The RPC refuses to CREATE one; this function must still render data
    // that predates the guard rather than throwing.
    const g = groupRoutingByDa([
      R(1, 'Ainsley', null, 'Miles'),
      R(2, 'Ainsley', null, 'Briana'),
    ])[0];
    expect(g.default?.ent_lead).toBe('Miles');
    expect(g.overrides).toHaveLength(1);
  });
});

describe('fix-457 §A5 — the gap the table cannot show', () => {
  it('★★★ derived from ACTIVE DAs, and a DA who gains a row leaves it', () => {
    const active = ['Ainsley', 'Fisk', 'Newcomer'];
    expect(unroutedActiveDas(active, PROD_SHAPE)).toEqual(['Newcomer']);

    const withRow = [...PROD_SHAPE, R(7, 'Newcomer', null, 'Miles')];
    expect(unroutedActiveDas(active, withRow)).toEqual([]);
  });

  it('★ matched trimmed + case-folded, like unmappedActiveDas', () => {
    expect(unroutedActiveDas(['ainsley'], PROD_SHAPE)).toEqual([]);
    expect(unroutedActiveDas([' Fisk '], PROD_SHAPE)).toEqual([]);
    expect(unroutedActiveDas([''], PROD_SHAPE)).toEqual([]);
  });

  it('★★★ prod has NO gap today — 11 active DAs, all routed', () => {
    // Measured 2026-08-30. The list renders nothing now and appears the moment
    // somebody joins, which is the entire point of building it.
    const prodDas = [
      'Ahmadi', 'Ainsley', 'Cam', 'Erick', 'Fisk', 'Francesca',
      'Marc', 'Nicky', 'Qisheng', 'Shire', 'Trevor',
    ];
    const allRows = prodDas.map((d, i) => R(i + 1, d, null, 'Miles'));
    expect(unroutedActiveDas(prodDas, allRows)).toEqual([]);
  });

  it('★★★ an unrouted DA is a DISABLED wizard option — the real consequence', () => {
    // Step1ProjectInfo: `disabled = !backfillMode && !routedDaSet.has(m.name)`,
    // and routedDaSet is built from daHasRoutingFor. This is what "no rule"
    // actually costs — not a fallback to Miles.
    expect(daHasRoutingFor('Newcomer', 'Seattle', PROD_SHAPE)).toBe(false);
    expect(daHasRoutingFor('Ainsley', 'Seattle', PROD_SHAPE)).toBe(true);
  });
});

describe('fix-457 §A4 — the confirm names the TRUE consequence', () => {
  const groups = groupRoutingByDa(PROD_SHAPE);
  const fisk = groups.find((g) => g.da === 'Fisk')!;
  const ainsley = groups.find((g) => g.da === 'Ainsley')!;

  it('★★★ removing a DEFAULT never claims a fallback to Miles', () => {
    const msg = removeRuleConsequence('Ainsley', null, ainsley);
    expect(msg).not.toMatch(/Miles/);
    expect(msg).toMatch(/no routed entitlement lead/);
    expect(msg).toMatch(/anywhere/);
    // The two things that actually happen, both verified against prod SQL.
    expect(msg).toMatch(/cascade will leave/i);
    expect(msg).toMatch(/cannot be picked as lead DA/i);
  });

  it('★★ …and it counts the jurisdiction rules that survive', () => {
    const msg = removeRuleConsequence('Fisk', null, fisk);
    expect(msg).toMatch(/outside their 1 jurisdiction rule/);
  });

  it('★★ removing an OVERRIDE says which rule takes over', () => {
    const msg = removeRuleConsequence('Fisk', 'Seattle', fisk);
    expect(msg).toMatch(/fall back to their default rule \(Miles\) in Seattle/);
  });

  it('★ an override with no default says so instead of inventing one', () => {
    const g = groupRoutingByDa([R(9, 'Nobody', 'Seattle', 'Briana')])[0];
    const msg = removeRuleConsequence('Nobody', 'Seattle', g);
    expect(msg).toMatch(/no default rule to fall back to/);
  });
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  rows: [] as DaTeamRoutingRow[],
  upsert: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../hooks/useDaTeamRouting', async (orig) => {
  const actual = await orig<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual,
    useDaTeamRouting: () => ({ data: state.rows, isLoading: false }),
  };
});
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle' }, { name: 'Phoenix' }],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useDaRoutingWrite', () => ({
  useUpsertDaRouting: () => ({ mutate: state.upsert, isPending: false }),
  useDeleteDaRouting: () => ({ mutate: state.del, isPending: false }),
}));

import DaRoutingEditor from '../components/Settings/DaRoutingEditor';

const DAS = [
  { id: 'd1', name: 'Ainsley', role: 'da', active: true },
  { id: 'd2', name: 'Fisk', role: 'da', active: true },
  { id: 'd3', name: 'Newcomer', role: 'da', active: true },
] as unknown as Parameters<typeof DaRoutingEditor>[0]['activeDas'];

const ENTS = [
  { id: 'e1', name: 'Miles', role: 'ent_lead', active: true },
  { id: 'e2', name: 'Briana', role: 'ent_lead', active: true },
] as unknown as Parameters<typeof DaRoutingEditor>[0]['ents'];

beforeEach(() => {
  state.rows = [...PROD_SHAPE];
  state.upsert.mockReset();
  state.del.mockReset();
});

describe('fix-457 §A1/A3 — the panel', () => {
  it('★★ renders a group per DA with the default above its overrides', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    expect(screen.getByTestId('da-routing-group-Fisk')).toBeTruthy();
    expect(screen.getByTestId('da-routing-group-Qisheng')).toBeTruthy();
  });

  it('★★★ the unrouted list names the active DA with no rule', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    expect(screen.getByTestId('da-routing-unrouted')).toBeTruthy();
    expect(screen.getByTestId('da-routing-route-Newcomer')).toBeTruthy();
    // …and only that one — Ainsley and Fisk have rules.
    expect(screen.queryByTestId('da-routing-route-Ainsley')).toBeNull();
  });

  it('★★ "Route X" opens the draft pre-filled with that DA', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    fireEvent.click(screen.getByTestId('da-routing-route-Newcomer'));
    const da = screen.getByTestId('da-routing-draft-da') as HTMLSelectElement;
    expect(da.value).toBe('Newcomer');
  });

  it('★★★ adding a rule calls the writer with a NULL jurisdiction for a blank', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    fireEvent.click(screen.getByTestId('da-routing-route-Newcomer'));
    fireEvent.change(screen.getByTestId('da-routing-draft-lead'), {
      target: { value: 'Briana' },
    });
    fireEvent.click(screen.getByTestId('da-routing-draft-save'));

    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(state.upsert.mock.calls[0]![0]).toEqual({
      op: 'insert',
      patch: { da: 'Newcomer', jurisdiction: null, ent_lead: 'Briana' },
    });
  });

  it('★★★ changing a lead sends the id AND the OCC token', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    fireEvent.change(screen.getByTestId('da-routing-lead-3'), {
      target: { value: 'Miles' },
    });
    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(state.upsert.mock.calls[0]![0]).toEqual({
      op: 'update',
      id: 3,
      updated_at: '2026-08-30T00:00:03Z',
      patch: { da: 'Fisk', jurisdiction: 'Seattle', ent_lead: 'Miles' },
    });
  });

  it('★★★ removing a DEFAULT warns before it deletes', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={false} />);
    fireEvent.click(screen.getByTestId('da-routing-remove-1'));

    const confirm = screen.getByTestId('da-routing-confirm-1');
    expect(confirm.textContent).toMatch(/no routed entitlement lead/);
    expect(confirm.textContent).not.toMatch(/Miles/); // ★ no invented fallback
    expect(state.del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('da-routing-confirm-remove-1'));
    expect(state.del).toHaveBeenCalledWith(
      { id: 1, updated_at: '2026-08-30T00:00:01Z' },
      expect.anything(),
    );
  });

  it('★★ readOnly: the routing is readable and nothing can be changed', () => {
    render(<DaRoutingEditor activeDas={DAS} ents={ENTS} readOnly={true} />);
    // The rules are still on screen…
    expect(screen.getByTestId('da-routing-group-Fisk')).toBeTruthy();
    expect(screen.getByTestId('da-routing-lead-3').textContent).toBe('Briana');
    // …and every editing affordance is gone.
    expect(screen.queryByTestId('da-routing-add')).toBeNull();
    expect(screen.queryByTestId('da-routing-remove-1')).toBeNull();
    expect(screen.queryByTestId('da-routing-add-for-Fisk')).toBeNull();
    // ★ The gap is still SHOWN to a non-admin — it is information, not an
    //   action — but its button is disabled rather than absent.
    expect(
      (screen.getByTestId('da-routing-route-Newcomer') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
