import { describe, it, expect } from 'vitest';
import {
  daHasRoutingFor,
  type DaTeamRoutingRow,
} from '../hooks/useDaTeamRouting';

// fix-96-b: pure-helper unit tests for daHasRoutingFor, the predicate
// the wizard uses to decide whether a DA option is selectable. The
// frontend predicate MUST mirror bp_ent_lead_for_da's WHERE clause —
// otherwise the dropdown disagrees with the server's lookup result
// ("server returns Miles for Trevor + Seattle but the wizard greyed
// Trevor out").

describe('daHasRoutingFor (fix-96-b)', () => {
  it('returns true for a DA with a juris-specific row matching the project juris', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'Bri', jurisdiction: 'Seattle' },
    ];
    expect(daHasRoutingFor('Bri', 'Seattle', rows)).toBe(true);
  });

  it('returns true for a DA with a NULL-juris fallback row, for ANY project juris', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'Trevor', jurisdiction: null },
    ];
    expect(daHasRoutingFor('Trevor', 'Seattle', rows)).toBe(true);
    expect(daHasRoutingFor('Trevor', 'Bellevue', rows)).toBe(true);
    expect(daHasRoutingFor('Trevor', null, rows)).toBe(true);
  });

  it('returns true when both a NULL-juris and a specific-juris row exist (specific would win on the server)', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'Fisk', jurisdiction: null },
      { da: 'Fisk', jurisdiction: 'Seattle' },
    ];
    expect(daHasRoutingFor('Fisk', 'Seattle', rows)).toBe(true);
    expect(daHasRoutingFor('Fisk', 'Bellevue', rows)).toBe(true);
  });

  it('returns false for a DA whose only row is juris-specific to a DIFFERENT juris', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'OnlyBellevue', jurisdiction: 'Bellevue' },
    ];
    expect(daHasRoutingFor('OnlyBellevue', 'Seattle', rows)).toBe(false);
  });

  it('returns false for a DA with no routing rows at all (legitimate "not set up yet" state)', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'OtherDa', jurisdiction: null },
    ];
    expect(daHasRoutingFor('Unrouted', 'Seattle', rows)).toBe(false);
  });

  it('ignores rows for other DAs entirely', () => {
    const rows: DaTeamRoutingRow[] = [
      { da: 'Trevor', jurisdiction: null },
      { da: 'Bri', jurisdiction: 'Seattle' },
    ];
    // Bri has Seattle-specific; Trevor's NULL fallback doesn't help Bri.
    expect(daHasRoutingFor('Bri', 'Bellevue', rows)).toBe(false);
  });
});
