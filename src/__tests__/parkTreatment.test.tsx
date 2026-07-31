import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusLegend from '../components/DrawSchedule/StatusLegend';
import { HoldBadge } from '../components/shared/HoldBadge';
import {
  DS_PARK_PRESENTATION,
  STATUS_PRESENTATION,
  DS_STATUS_LIST,
} from '../lib/drawScheduleStatus';
import { NP_BLOCK_COLOR } from '../lib/drawScheduleHelpers';

// fix-263: the PARK palette — the legend that explains it, the shared badge that
// has to match it, and the invariant that keeps cancelled distinguishable from
// the Vacation / NP overlay.

describe('fix-263 park presentation', () => {
  it('cancelled is a HATCH, not a flat fill — flat grey is already Vacation/NP', () => {
    expect(DS_PARK_PRESENTATION.cancelled.background).toContain('hatch');
    // The NP overlay is a flat grey. If cancelled ever became a flat colour it
    // would collide with it across twelve columns; this is the guard.
    expect(DS_PARK_PRESENTATION.cancelled.background).not.toBe(NP_BLOCK_COLOR.bg);
    expect(DS_PARK_PRESENTATION.cancelled.border).not.toBe(NP_BLOCK_COLOR.border);
  });

  it('cancelled drops the phase pill and strikes the address; hold does neither', () => {
    expect(DS_PARK_PRESENTATION.cancelled.showPhasePill).toBe(false);
    expect(DS_PARK_PRESENTATION.cancelled.strikeAddress).toBe(true);
    // A held project is still ACTIVE, so its phase still means something.
    expect(DS_PARK_PRESENTATION.hold.showPhasePill).toBe(true);
    expect(DS_PARK_PRESENTATION.hold.strikeAddress).toBe(false);
  });

  it('park is NOT a phase — it must never leak into the DsStatus union', () => {
    expect(DS_STATUS_LIST).not.toContain('Cancelled');
    expect(DS_STATUS_LIST).not.toContain('On hold');
    expect(Object.keys(STATUS_PRESENTATION)).not.toContain('cancelled');
  });

  it('every park colour resolves through a shared CSS token, not a literal hex', () => {
    for (const p of Object.values(DS_PARK_PRESENTATION)) {
      for (const v of [p.background, p.border, p.text, p.subtext]) {
        expect(v).toMatch(/^var\(--/);
        expect(v).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });
});

describe('fix-263 legend', () => {
  it('renders a chip for BOTH park states', () => {
    render(<StatusLegend />);
    expect(screen.getByTestId('ds-legend-chip-On hold')).toBeTruthy();
    expect(screen.getByTestId('ds-legend-chip-Cancelled')).toBeTruthy();
  });

  it('the chips paint from the same tokens as the blocks — a legend cannot drift', () => {
    render(<StatusLegend />);
    const hold = screen.getByTestId('ds-legend-chip-On hold').getAttribute('style') ?? '';
    expect(hold).toContain('var(--color-hold-bg)');
    expect(hold).toContain('var(--color-hold-border)');

    const cancelled =
      screen.getByTestId('ds-legend-chip-Cancelled').getAttribute('style') ?? '';
    expect(cancelled).toContain('var(--hatch-cancelled)');
    expect(cancelled).toContain('line-through');
  });

  it('keeps every pre-existing v1-parity chip', () => {
    render(<StatusLegend />);
    for (const label of [
      'Scheduled',
      'Schematic',
      'DD / Permit Set',
      'Pending Consultants',
      'Submitted / Under Review / Corrections',
      'Approved',
    ]) {
      expect(screen.getByTestId(`ds-legend-chip-${label}`)).toBeTruthy();
    }
  });
});

describe('fix-263 HoldBadge shares the park palette', () => {
  const base = {
    reason: 'MHA',
    hold_start: '2026-05-11',
    note: null,
  };

  it('the hold badge is the SAME amber the block uses', () => {
    render(<HoldBadge hold={{ ...base, kind: 'hold' }} testid="hb" />);
    const style = screen.getByTestId('hb').getAttribute('style') ?? '';
    expect(style).toContain('var(--color-hold-bg)');
    expect(style).toContain('var(--color-hold-border)');
    // and it is NO LONGER the corrections palette it borrowed pre-fix-263
    expect(screen.getByTestId('hb').className).not.toContain('bg-co-bg');
  });

  it('the cancelled badge is the SAME hatch the block uses', () => {
    render(<HoldBadge hold={{ ...base, kind: 'cancelled' }} testid="hb" />);
    const style = screen.getByTestId('hb-cancelled').getAttribute('style') ?? '';
    expect(style).toContain('var(--hatch-cancelled)');
    expect(style).toContain('line-through');
  });

  it('a row with no kind still reads as a hold (pre-fix-262 rows)', () => {
    render(<HoldBadge hold={base} testid="hb" />);
    expect(screen.getByTestId('hb').textContent).toContain('On Hold');
  });
});
