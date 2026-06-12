import { describe, it, expect } from 'vitest';
import {
  deriveBlockStatus,
  DS_STATUS_LIST,
  DS_STATUS_COLORS,
  STATUS_PRESENTATION,
} from '../lib/drawScheduleStatus';
import type { Permit, PermitCycle } from '../lib/database.types';

// Q9.5.g: precedence chain tests for deriveBlockStatus. One test per
// branch + manual_status respect + edge cases. Order mirrors v1 dsAutoStatus
// at index.html:8413-8444.

function permit(id: number, over: Partial<Permit> = {}): Permit {
  return {
    id,
    project_id: over.project_id ?? 'p1',
    type: 'Building Permit',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
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
    ...over,
  };
}

function cycle(permitId: number, over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: `c-${permitId}-${Math.random()}`,
    permit_id: permitId,
    cycle_index: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

const TODAY = new Date(2026, 4, 13); // 2026-05-13 (deterministic anchor)

describe('deriveBlockStatus', () => {
  it('no BPs → falls through to Scheduled (auto)', () => {
    const result = deriveBlockStatus({
      permits: [permit(1, { type: 'TRAO' })],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result).toEqual({ status: 'Scheduled', isAuto: true });
  });

  it('no BPs but manualStatus + valid currentStatus → respects manual', () => {
    const result = deriveBlockStatus({
      permits: [permit(1, { type: 'TRAO' })],
      cyclesByPermit: new Map(),
      currentStatus: 'Schematic',
      manualStatus: true,
      today: TODAY,
    });
    expect(result).toEqual({ status: 'Schematic', isAuto: false });
  });

  it('branch 1: corr_issued set + resubmitted null → Corrections', () => {
    const bp = permit(1);
    const cyclesByPermit = new Map([
      [1, [cycle(1, { corr_issued: '2026-05-01', resubmitted: null })]],
    ]);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit,
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Corrections');
    expect(result.isAuto).toBe(true);
  });

  it('branch 1 overrides manualStatus (Corrections always wins)', () => {
    const bp = permit(1);
    const cyclesByPermit = new Map([
      [1, [cycle(1, { corr_issued: '2026-05-01', resubmitted: null })]],
    ]);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit,
      currentStatus: 'Schematic',
      manualStatus: true,
      today: TODAY,
    });
    expect(result.status).toBe('Corrections');
    expect(result.isAuto).toBe(true);
  });

  it('branch 1: corr_issued + resubmitted both set → does NOT trigger Corrections', () => {
    const bp = permit(1, { dd_start: '2026-05-01' });
    const cyclesByPermit = new Map([
      [
        1,
        [
          cycle(1, {
            corr_issued: '2026-04-01',
            resubmitted: '2026-04-15',
            submitted: '2026-03-01',
          }),
        ],
      ],
    ]);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit,
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    // Falls through to branch 3 (any submitted)
    expect(result.status).toBe('Under Review');
  });

  it('branch 2: every BP approved → Approved', () => {
    const bps = [
      permit(1, { approval_date: '2026-04-01' }),
      permit(2, { actual_issue: '2026-04-15' }),
    ];
    const result = deriveBlockStatus({
      permits: bps,
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Approved');
  });

  it('branch 2 overrides manualStatus', () => {
    const bps = [permit(1, { approval_date: '2026-04-01' })];
    const result = deriveBlockStatus({
      permits: bps,
      cyclesByPermit: new Map(),
      currentStatus: 'Scheduled',
      manualStatus: true,
      today: TODAY,
    });
    expect(result.status).toBe('Approved');
  });

  it('branch 2: only one of two BPs approved → does NOT trigger Approved', () => {
    const bps = [
      permit(1, { approval_date: '2026-04-01' }),
      permit(2), // not approved
    ];
    const cyclesByPermit = new Map([
      [2, [cycle(2, { submitted: '2026-04-20' })]],
    ]);
    const result = deriveBlockStatus({
      permits: bps,
      cyclesByPermit,
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    // Falls through to branch 3
    expect(result.status).toBe('Under Review');
  });

  it('branch 3: any submitted cycle → Under Review', () => {
    const bp = permit(1);
    const cyclesByPermit = new Map([
      [1, [cycle(1, { submitted: '2026-04-20' })]],
    ]);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit,
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Under Review');
  });

  it('branch 3 overrides manualStatus', () => {
    const bp = permit(1);
    const cyclesByPermit = new Map([
      [1, [cycle(1, { submitted: '2026-04-20' })]],
    ]);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit,
      currentStatus: 'Scheduled',
      manualStatus: true,
      today: TODAY,
    });
    expect(result.status).toBe('Under Review');
  });

  it('branch 4 (DD phase): dd_end in the past → Pending Consultants', () => {
    const bp = permit(1, { dd_start: '2025-12-01', dd_end: '2026-04-01' });
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Pending Consultants');
  });

  it('branch 4 (DD phase): today >= dd_start, dd_end not past → DD / Permit Set', () => {
    const bp = permit(1, { dd_start: '2026-04-01', dd_end: '2026-07-01' });
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('DD / Permit Set');
  });

  it('branch 4 (DD phase): today within 28d before dd_start → Schematic', () => {
    const bp = permit(1, { dd_start: '2026-06-01' }); // 19 days after TODAY
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Schematic');
  });

  it('branch 4 (DD phase): today more than 28d before dd_start → Scheduled', () => {
    const bp = permit(1, { dd_start: '2026-08-01' }); // ~80 days out
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Scheduled');
  });

  it('branch 4 (DD phase): no dd_start set → Scheduled (when no manual)', () => {
    const bp = permit(1);
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result.status).toBe('Scheduled');
  });

  it('DD phase respects manualStatus when set', () => {
    const bp = permit(1, { dd_start: '2026-04-01' }); // would auto to DD / Permit Set
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: 'Schematic',
      manualStatus: true,
      today: TODAY,
    });
    expect(result).toEqual({ status: 'Schematic', isAuto: false });
  });

  it('manualStatus=true but currentStatus invalid → falls through to auto', () => {
    const bp = permit(1, { dd_start: '2026-04-01' });
    const result = deriveBlockStatus({
      permits: [bp],
      cyclesByPermit: new Map(),
      currentStatus: 'Garbage value',
      manualStatus: true,
      today: TODAY,
    });
    expect(result).toEqual({ status: 'DD / Permit Set', isAuto: true });
  });

  it('Non-BP permits at the project are ignored', () => {
    const permits = [
      permit(1, { type: 'TRAO' }),
      permit(2, { type: 'LSM', dd_start: '2025-01-01' }),
    ];
    // No BP at all → no-BPs branch fires
    const result = deriveBlockStatus({
      permits,
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY,
    });
    expect(result).toEqual({ status: 'Scheduled', isAuto: true });
  });
});

describe('STATUS_PRESENTATION — single label+color source (fix-160)', () => {
  it('every derived status has exactly one {label, colors} entry (no parallel maps)', () => {
    for (const s of DS_STATUS_LIST) {
      const pres = STATUS_PRESENTATION[s];
      expect(pres).toBeDefined();
      expect(pres.label).toBe(s); // the pill shows the status word verbatim
      expect(pres.colors.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pres.colors.border).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pres.colors.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Exhaustive: no extra keys beyond the vocab, none missing.
    expect(Object.keys(STATUS_PRESENTATION).sort()).toEqual([...DS_STATUS_LIST].sort());
  });

  it('DS_STATUS_COLORS is the colors view of STATUS_PRESENTATION (derived, not a 2nd literal)', () => {
    for (const s of DS_STATUS_LIST) {
      expect(DS_STATUS_COLORS[s]).toEqual(STATUS_PRESENTATION[s].colors);
    }
  });

  it('Approved is green, Scheduled is white', () => {
    expect(STATUS_PRESENTATION.Approved.colors.bg).toBe('#5abf75');
    expect(STATUS_PRESENTATION.Scheduled.colors.bg).toBe('#ffffff');
  });
});

describe('deriveBlockStatus — no-BP projects derive off their own permits (fix-160)', () => {
  const TODAY_160 = new Date(2026, 4, 13);

  it('PPR-only project that is approved → Approved (was Scheduled/white before fix-160)', () => {
    const result = deriveBlockStatus({
      permits: [
        permit(1, {
          type: 'PPR',
          approval_date: '2026-05-11',
          actual_issue: '2026-05-22',
        }),
      ],
      cyclesByPermit: new Map(),
      currentStatus: 'Scheduled',
      manualStatus: false,
      today: TODAY_160,
    });
    expect(result).toEqual({ status: 'Approved', isAuto: true });
  });

  it('PPR-only project with NO approval data → still Scheduled (no false positives)', () => {
    const result = deriveBlockStatus({
      permits: [permit(1, { type: 'PPR' })],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY_160,
    });
    expect(result.status).toBe('Scheduled');
  });

  it('a Building Permit still takes precedence over a non-BP (derives off the BP only)', () => {
    const result = deriveBlockStatus({
      permits: [
        permit(1, { type: 'Building Permit' }), // BP, not approved
        permit(2, { type: 'PPR', approval_date: '2026-05-11' }), // approved PPR — ignored
      ],
      cyclesByPermit: new Map(),
      currentStatus: null,
      manualStatus: false,
      today: TODAY_160,
    });
    // The BP (no approval) drives it, so it is NOT 'Approved'.
    expect(result.status).not.toBe('Approved');
  });

  it('override unchanged: no-BP project with manual status set + no permit data → respects manual', () => {
    const result = deriveBlockStatus({
      permits: [permit(1, { type: 'PPR' })],
      cyclesByPermit: new Map(),
      currentStatus: 'Schematic',
      manualStatus: true,
      today: TODAY_160,
    });
    expect(result).toEqual({ status: 'Schematic', isAuto: false });
  });

  it('override unchanged: a non-BP approval still beats a stale manual status (data branch wins)', () => {
    const result = deriveBlockStatus({
      permits: [permit(1, { type: 'PPR', approval_date: '2026-05-11' })],
      cyclesByPermit: new Map(),
      currentStatus: 'Schematic',
      manualStatus: true, // stale manual choice — the Approved branch overrides it
      today: TODAY_160,
    });
    expect(result).toEqual({ status: 'Approved', isAuto: true });
  });
});
