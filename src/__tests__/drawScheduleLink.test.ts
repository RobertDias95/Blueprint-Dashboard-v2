import { describe, it, expect } from 'vitest';
import {
  drawScheduleTarget,
  humanQuarter,
  parseDrawScheduleFocus,
} from '../lib/drawScheduleLink';
import { quarterStringToOffset } from '../lib/teamQuarterHelpers';

// fix-335 §7 — the link from a project's Milestones card to its block.
//
// ★★ WHY THIS IS A LIBRARY AND NOT THREE LINES IN A COMPONENT: fix-182 renders
// a DIFFERENT BOARD PER QUARTER, so "go to the draw schedule" is an incomplete
// instruction and a link that omits the quarter is a link that can silently
// land on an empty grid. The naming rule and the no-block rule are the whole
// feature, and both are decided here where they can be checked.

// ★ Pinned "now" — quarter maths is relative to it, so a floating clock would
// make these tests mean something different every three months. The fix-206
// rule: quarter-relative tests get a fixed anchor.
const NOW = new Date('2026-08-17T12:00:00Z'); // Q3 2026
const PROJ = '9c2f0a1e-4d3b-4f2a-9a11-8e7d6c5b4a30';

describe('fix-335 §7: the link names the quarter its block starts in', () => {
  it('carries the project and an ABSOLUTE quarter', () => {
    const t = drawScheduleTarget(PROJ, '2026-09-07', NOW);
    expect(t.hasBlock).toBe(true);
    expect(t.quarter).toBe('2026-Q3');
    expect(t.quarterLabel).toBe('Q3 2026');
    expect(t.href).toBe(`/draw-schedule?project=${PROJ}&quarter=2026-Q3`);
  });

  // ★★ ABSOLUTE, NOT AN OFFSET, and this is the assertion that says why. The
  // grid's internal state is a delta from the current quarter — a number that
  // means somewhere else tomorrow. A link pasted into chat, or opened after the
  // quarter turns, has to land in the same place it did when it was made.
  it('★★ the quarter in the URL does not rot when the clock moves', () => {
    const t = drawScheduleTarget(PROJ, '2026-09-07', NOW);
    expect(t.href).toContain('quarter=2026-Q3');
    expect(t.href).not.toMatch(/quarter=-?\d+(&|$)/);

    // Read back two quarters later: still the same quarter, now at offset -2.
    const later = new Date('2027-02-10T12:00:00Z'); // Q1 2027
    const focus = parseDrawScheduleFocus(
      new URLSearchParams(t.href.split('?')[1]),
      later,
    );
    expect(focus.projectId).toBe(PROJ);
    expect(focus.quarterOffset).toBe(-2);
    expect(quarterStringToOffset('2026-Q3', later)).toBe(-2);
  });

  it('a block in a future quarter names that quarter, not today', () => {
    const t = drawScheduleTarget(PROJ, '2027-01-04', NOW);
    expect(t.quarterLabel).toBe('Q1 2027');
    expect(t.href).toContain('quarter=2027-Q1');
  });

  it('a block that started in a past quarter lands where it STARTS', () => {
    // ★ The rule that makes a dead link impossible: the quarter is derived from
    // the block's own start_week, so the link can never name a quarter the
    // block is absent from.
    const t = drawScheduleTarget(PROJ, '2026-02-02', NOW);
    expect(t.quarterLabel).toBe('Q1 2026');
    expect(t.href).toContain('quarter=2026-Q1');
  });

  // ★★ THE UNSCHEDULED PROJECT. fix-335 §8 allows exactly one inert control in
  // this ticket and it is the Connect button, so this stays a working link: it
  // drops both parameters and goes to the live board, where the button's own
  // second line explains there is nothing to jump to.
  it('★★ a project with no block still gets a working link', () => {
    for (const missing of [null, undefined, '']) {
      const t = drawScheduleTarget(PROJ, missing, NOW);
      expect(t.hasBlock).toBe(false);
      expect(t.quarter).toBeNull();
      expect(t.quarterLabel).toBeNull();
      expect(t.href).toBe('/draw-schedule');
    }
  });

  it('the project id is URL-encoded', () => {
    const t = drawScheduleTarget('a b/c', '2026-09-07', NOW);
    expect(t.href).toContain('project=a%20b%2Fc');
  });

  it('humanQuarter reads the way the grid navigator does', () => {
    expect(humanQuarter('2026-Q3')).toBe('Q3 2026');
    expect(humanQuarter('2027-Q1')).toBe('Q1 2027');
    // Unparseable input is echoed rather than turned into a wrong quarter.
    expect(humanQuarter('nonsense')).toBe('nonsense');
  });
});

describe('fix-335 §7: the grid reads the two parameters back', () => {
  it('round-trips what drawScheduleTarget produced', () => {
    const t = drawScheduleTarget(PROJ, '2026-09-07', NOW);
    const focus = parseDrawScheduleFocus(new URLSearchParams(t.href.split('?')[1]), NOW);
    expect(focus).toEqual({ projectId: PROJ, quarterOffset: 0 });
  });

  it('no parameters at all means this quarter, no focus', () => {
    expect(parseDrawScheduleFocus(new URLSearchParams(''), NOW)).toEqual({
      projectId: null,
      quarterOffset: 0,
    });
  });

  // ★ A hand-edited URL should land you on this quarter's board, not on a blank
  // screen or an exception.
  it('★ garbage is survivable', () => {
    expect(
      parseDrawScheduleFocus(new URLSearchParams('project=&quarter=banana'), NOW),
    ).toEqual({ projectId: null, quarterOffset: 0 });
    expect(
      parseDrawScheduleFocus(new URLSearchParams('quarter=2026-Q9'), NOW),
    ).toEqual({ projectId: null, quarterOffset: 0 });
  });

  it('a quarter with no project still moves the board', () => {
    expect(
      parseDrawScheduleFocus(new URLSearchParams('quarter=2027-Q1'), NOW),
    ).toEqual({ projectId: null, quarterOffset: 2 });
  });
});
