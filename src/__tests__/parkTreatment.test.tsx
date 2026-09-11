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
import { HATCH_STRIPE_PX, hatch } from '../lib/retiredState';

// fix-263: the PARK palette — the legend that explains it, the shared badge that
// has to match it, and the invariant that keeps cancelled distinguishable from
// the Vacation / NP overlay.

describe('fix-263 park presentation', () => {
  // ★★★ AMENDED BY fix-524 §A, NOT WEAKENED. This read
  //     `expect(background).toContain('hatch')`, which was a check on the NAME
  //     of a CSS token — `--hatch-cancelled` — rather than on the paint. §A
  //     added a second retired state and ruled the hatch must be built ONCE and
  //     take its colours as arguments, so the literal token is gone and the
  //     gradient is built by `lib/retiredState.hatch()`. The property this test
  //     was protecting is stronger now and is asserted directly: it is a
  //     repeating gradient, not a flat fill.
  it('cancelled is a HATCH, not a flat fill — flat grey is already Vacation/NP', () => {
    expect(DS_PARK_PRESENTATION.cancelled.background).toContain(
      'repeating-linear-gradient',
    );
    // The NP overlay is a flat grey. If cancelled ever became a flat colour it
    // would collide with it across twelve columns; this is the guard.
    expect(DS_PARK_PRESENTATION.cancelled.background).not.toBe(NP_BLOCK_COLOR.bg);
    expect(DS_PARK_PRESENTATION.cancelled.border).not.toBe(NP_BLOCK_COLOR.border);
  });

  // ★★★ fix-524 §A — ONE HATCH, TWO COLOURS. The two retired states differ in
  //     NOTHING but their palette, and this is the assertion that says so: swap
  //     the colour tokens in one and you get the other, character for
  //     character. If somebody writes a second gradient by hand — a different
  //     angle, a 6px stripe — this fails.
  it('★★★ the two retired states are the SAME hatch with different colours', () => {
    const grey = DS_PARK_PRESENTATION.cancelled.background;
    const purple = DS_PARK_PRESENTATION.redesigned.background;
    expect(purple).not.toBe(grey);
    const normalise = (css: string) => css.replace(/cancelled|redesigned/g, 'X');
    expect(normalise(purple)).toBe(normalise(grey));
    // ★ And it is built by the one helper, from the one stripe width.
    expect(grey).toBe(hatch('var(--color-cancelled-a)', 'var(--color-cancelled-b)'));
    expect(grey).toContain(`${HATCH_STRIPE_PX}px`);
    expect(grey).toContain(`${HATCH_STRIPE_PX * 2}px`);
    expect(grey).toContain('45deg');
  });

  it('★★ a redesigned block has no live phase either, and is struck through', () => {
    // ★ Same reasoning as cancelled: the successor carries the phase. A pill
    //   saying "DD / Permit Set" on a superseded project names work nobody is
    //   doing.
    expect(DS_PARK_PRESENTATION.redesigned.showPhasePill).toBe(false);
    expect(DS_PARK_PRESENTATION.redesigned.strikeAddress).toBe(true);
    expect(DS_PARK_PRESENTATION.redesigned.label).toBe('Redesigned');
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

  // ★★ AMENDED BY fix-524 §A: a background is no longer a bare `var(--…)` — it
  //    is a gradient BUILT from them. The property is unchanged and still the
  //    point: **no literal hex anywhere in the park palette**, so index.css
  //    stays the one place a colour is chosen.
  it('every park colour resolves through a shared CSS token, not a literal hex', () => {
    for (const p of Object.values(DS_PARK_PRESENTATION)) {
      for (const v of [p.border, p.text, p.subtext]) {
        expect(v).toMatch(/^var\(--/);
      }
      for (const v of [p.background, p.border, p.text, p.subtext]) {
        expect(v).toContain('var(--');
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

    // ★★★ STRONGER THAN THE ASSERTION IT REPLACES. It used to check that both
    //     the chip and the block mentioned `var(--hatch-cancelled)`; it now
    //     checks the chip's background IS the block's background, so the legend
    //     cannot drift even by a pixel of stripe.
    const cancelled =
      screen.getByTestId('ds-legend-chip-Cancelled').getAttribute('style') ?? '';
    expect(cancelled).toContain(DS_PARK_PRESENTATION.cancelled.background);
    expect(cancelled).toContain('line-through');

    // ★ fix-524 §A: and the second retired state is in the legend beside it —
    //   the only place in the app where the grey and the purple appear
    //   together, which is the only place a reader can learn what they mean.
    const redesigned =
      screen.getByTestId('ds-legend-chip-Redesigned').getAttribute('style') ?? '';
    expect(redesigned).toContain(DS_PARK_PRESENTATION.redesigned.background);
    expect(redesigned).toContain('line-through');
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
    // ★★ Again stronger: the badge's background IS the block's, not merely a
    //    mention of the same token name.
    expect(style).toContain(DS_PARK_PRESENTATION.cancelled.background);
    expect(style).toContain('line-through');
    // ★ fix-524 §A: the text is unchanged to the character — the badge still
    //   names the reason. Only the paint moved into `RetiredBadge`.
    expect(screen.getByTestId('hb-cancelled').textContent).toContain('Cancelled');
    expect(screen.getByTestId('hb-cancelled').textContent).toContain('MHA');
  });

  it('a row with no kind still reads as a hold (pre-fix-262 rows)', () => {
    render(<HoldBadge hold={base} testid="hb" />);
    expect(screen.getByTestId('hb').textContent).toContain('On Hold');
  });
});
