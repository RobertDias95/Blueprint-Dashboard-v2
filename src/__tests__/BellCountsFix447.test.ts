import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildForecast, type BoardInput } from '../lib/myBoard';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-447 §C (P-097) — THE BELL AND THE BOARD COUNT THE SAME THING
// ===========================================================================
//
// Found by CC while extracting `useBoardInput` in fix-446: the two callers of
// the assembly disagreed. My Board passed `acks` and `showHeldWork`; BoardBell
// passed neither. So the bell's "Past due" and "Today" counters — the only two
// things it reads off the forecast — counted milestones somebody had already
// ACKNOWLEDGED, and could read HIGHER than the board they link to.
//
// ★★ fix-446 deliberately did not fix it (its brief required that caller to
// behave exactly as before) and declared the omission at the call site instead
// of leaving it as an absent field. This is the fix.

const bellSource = readFileSync(
  resolve(process.cwd(), 'src/components/BoardBell.tsx'),
  'utf8',
);
const boardSource = readFileSync(
  resolve(process.cwd(), 'src/pages/MyBoard.tsx'),
  'utf8',
);

/** A permit approved long ago and never issued → the `fees` milestone, whose
 *  anchor is the approval date. */
function approvedPermit(): PermitWithCycles {
  return {
    id: 901,
    project_id: 'p1',
    type: 'Building Permit',
    num: 'BLD2026-0001',
    status: 'Approved',
    da: null,
    dm: null,
    ent_lead: 'Bobby',
    target_submit: null,
    dd_start: null,
    dd_end: null,
    approval_date: '2026-01-05',
    actual_issue: null,
    parent_permit_id: null,
    permit_cycles: [],
  } as unknown as PermitWithCycles;
}

const PROJECTS = [
  { id: 'p1', address: '1 Ent St', is_backfill: false },
] as unknown as Project[];

function forecastWith(acks: BoardInput['acks']) {
  return buildForecast({
    viewer: { name: 'Bobby', isOversight: false },
    permits: [approvedPermit()],
    projects: PROJECTS,
    tasks: [],
    today: '2026-06-01',
    acks,
  } as BoardInput);
}

describe('fix-447 §C (P-097): the bell passes acks and showHeldWork', () => {
  it('★★★ an ACKED milestone is counted WITHOUT acks and not counted WITH them', () => {
    // ★★★ This is the discrepancy itself, reproduced on the builder: the same
    //     permit, the same day, two answers — which is exactly what the bell
    //     and the board were showing each other before this ticket.
    const withoutAcks = forecastWith(undefined);
    expect(withoutAcks.past_due.total).toBe(1);

    const withAcks = forecastWith([
      {
        id: 'a1',
        permit_id: 901,
        milestone: 'fees',
        anchor: '2026-01-05',
        acked_by_name: 'Bobby',
        acked_at: '2026-05-30T00:00:00Z',
      },
    ]);
    expect(withAcks.past_due.total).toBe(0);
  });

  it('★★★ BoardBell now calls useBoardInput exactly as My Board does', () => {
    // ★★ Asserted on the SOURCE because the difference was a call-site
    //    argument, not a rendered value — a test that only rendered the bell
    //    would have passed happily for as long as this bug existed.
    expect(bellSource).toContain('useBoardInput()');
    expect(bellSource).not.toContain('withAcks: false');
    expect(bellSource).not.toContain('withHeldWork: false');
    // ★ …and the board's call is the same one, so "the same input" is a fact
    //   about both files rather than a hope about one.
    expect(boardSource).toContain('useBoardInput()');
  });

  it('★★ the hook still DEFAULTS to the complete input', () => {
    // If the defaults ever flipped, both call sites above would silently go
    // back to the broken behaviour while still reading as fixed.
    const hookSource = readFileSync(
      resolve(process.cwd(), 'src/hooks/useBoardInput.ts'),
      'utf8',
    );
    expect(hookSource).toContain('withAcks = true');
    expect(hookSource).toContain('withHeldWork = true');
  });
});
