import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PermitAssignmentRow from '../components/wizard/PermitAssignmentRow';
import { daHasRoutingFor } from '../hooks/useDaTeamRouting';
import type { DaTeamRoutingRow } from '../hooks/useDaTeamRouting';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-497 (P-157) — A FLOATING DA IS PICKABLE; THE LEAD IS ASKED FOR
// ===========================================================================
//
// Bobby, 2026-09-04, Settings → Team → DA Routing, seeing Cam and Shire each
// carrying `Default — everywhere → Miles`:
//
//   *"they arent really mapped to people… shire and cam work on generally all
//    projects… they float between all three of us [Bobby, Miles, Briana]."*
//
// Prod agreed: Cam's 27 open permits are led **Miles 15 / Briana 12**; Shire's
// two are Miles and Bobby. The rows are fix-72 SEED data, not a decision.
//
// ★★★ THE RULING: delete the rows, keep them pickable, ask for the lead. This
//     file covers the "ask" — the gate's own tests were inverted in place in
//     Step1ProjectInfo.test.tsx and Step3Permits.test.tsx.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER, WHICH IS WHY §B's VALIDATION EXISTS
// ---------------------------------------------------------------------------
// *Can a project be submitted with a permit whose `ent_lead` is empty?* **Yes.**
// `NewProjectWizard`'s `stepError` returned `null` for steps 3 and 4 — no
// check at all — and the submit path says so out loud: *"If the BP row's
// ent_lead is still blank (DA not in routing) we run one final lookup here
// defensively, then accept whatever the user typed"*, with the catch adding
// *"submit continues with a blank project-level ent_lead."*
//
// That was survivable while every pickable DA had a row to derive from. It is
// not survivable once floaters are pickable, because nothing would ever fill
// it in — `bp_ent_lead_for_da` returns NULL and the cascade skips NULL.

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], activeDas: [] }),
  activeMemberNamesOf: () => [],
}));

const member = (name: string, id: string): TeamMember =>
  ({ id, name, role: 'ent', active: true, former: false }) as TeamMember;

const ENT_OPTIONS = [member('Miles', 'e1'), member('Briana', 'e2')];
const DA_MEMBERS = [
  { id: 'd1', name: 'Cam', role: 'da', active: true, former: false },
  { id: 'd2', name: 'Nicky', role: 'da', active: true, former: false },
] as TeamMember[];

/** Nicky is routed everywhere; Cam has no row at all — the floater. */
const ROUTING: DaTeamRoutingRow[] = [
  // ★ `id` is a number on this row type — the fixture said 'r1'.
  { id: 1, da: 'Nicky', jurisdiction: null, ent_lead: 'Miles' } as DaTeamRoutingRow,
];

const permitRow = (over: Record<string, unknown> = {}) =>
  ({
    rowId: 'row-1',
    type: 'Building Permit',
    da: 'Cam',
    ent_lead: '',
    dm: '',
    num: '',
    target_submit: '',
    expected_issue: '',
    selected: true,
    ...over,
  }) as never;

function renderRow(over: Record<string, unknown> = {}, routed = new Set(['Nicky'])) {
  return render(
    <PermitAssignmentRow
      permit={permitRow(over)}
      entOptions={ENT_OPTIONS}
      daMembers={DA_MEMBERS}
      typeOptions={['Building Permit']}
      routedDas={routed}
      derivedDm=""
      daReadOnly={false}
      backfillMode={false}
      onChange={vi.fn()}
      onPickDa={vi.fn()}
      canRemove={false}
    />,
  );
}

describe('fix-497 §B: an unrouted DA means the lead is ASKED FOR', () => {
  it('★★★ the placeholder says "pick", not "none"', () => {
    // ★★★ "— none —" reads as a legitimate empty on a routed DA, where the
    //     lookup simply has not fired yet. On a floater there IS no default
    //     coming, ever, so the placeholder has to say so.
    renderRow();
    const sel = screen.getByTestId('wizard-perm-ent-row-1') as HTMLSelectElement;
    expect(sel.options[0]!.textContent).toBe('— pick the ENT lead —');
  });

  it('★★★ the caption names the person and says what to do', () => {
    // ★★ "Cam floats" is the FACT; "choose who leads this permit" is the
    //    instruction. Without the first half the empty box reads as a bug.
    renderRow();
    expect(screen.getByTestId('wizard-perm-ent-floats-row-1').textContent).toBe(
      'Cam floats — choose who leads this permit',
    );
  });

  it('★★★ a ROUTED DA is untouched — no placeholder change, no caption', () => {
    // ★★★ THE PIN THAT PROVES THE DERIVE PATH IS NOT DISTURBED. Nicky routes
    //     everywhere, so this row behaves exactly as it did before fix-497.
    renderRow({ da: 'Nicky' });
    const sel = screen.getByTestId('wizard-perm-ent-row-1') as HTMLSelectElement;
    expect(sel.options[0]!.textContent).toBe('— none —');
    expect(screen.queryByTestId('wizard-perm-ent-floats-row-1')).toBeNull();
  });

  it('★★ once a lead is picked the caption goes — it asked and was answered', () => {
    renderRow({ ent_lead: 'Briana' });
    expect(screen.queryByTestId('wizard-perm-ent-floats-row-1')).toBeNull();
  });

  it('★★ a row with NO DA asks nothing', () => {
    // ★ "No DA yet" is not "this DA floats". Demanding a lead before anybody
    //   has picked a DA would be the fallback borrowing a confident voice.
    renderRow({ da: '' });
    expect(screen.queryByTestId('wizard-perm-ent-floats-row-1')).toBeNull();
  });

  it('★★★ backfill mode asks nothing — a historical lead is whatever it was', () => {
    render(
      <PermitAssignmentRow
        permit={permitRow()}
        entOptions={ENT_OPTIONS}
        daMembers={DA_MEMBERS}
        typeOptions={['Building Permit']}
        routedDas={new Set(['Nicky'])}
        derivedDm=""
        daReadOnly={false}
        backfillMode
        onChange={vi.fn()}
        onPickDa={vi.fn()}
        canRemove={false}
      />,
    );
    expect(screen.queryByTestId('wizard-perm-ent-floats-row-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE PREDICATE, AND THE SUBMIT GATE THAT SHARES IT
// ---------------------------------------------------------------------------

describe('fix-497 §B: submit blocks a floater with no lead', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/components/NewProjectWizard.tsx'),
    'utf8',
  );

  it('★★★ steps 3 and 4 no longer return an unconditional null', () => {
    // ★★★ FAILS ON origin/main. `stepError` had `if (step === 3 || step === 4)
    //     { return null; }` — no ent_lead check anywhere in the wizard.
    expect(src).toContain('floatingDaPermits');
    expect(src).toContain('pick the ENT lead —');
    expect(src).toContain('has no default');
  });

  it('★★★ the gate uses the SAME predicate the caption does', () => {
    // ★★ Two definitions of "floats" would let the row say one thing and the
    //    submit button do another — the fix-494 failure mode, one ticket later.
    expect(src).toContain('daHasRoutingFor(');
    expect(src).toContain("!daHasRoutingFor(p.da, state.juris || null, rows)");
  });

  it('★★ backfill is exempt from the gate too', () => {
    expect(src).toMatch(/if \(state\.backfill_mode\) return \[\];/);
  });

  it('★★★ `daHasRoutingFor` itself is UNCHANGED — a null juris row is a wildcard', () => {
    // ★ The predicate was correct all along; what was wrong was the conclusion
    //   drawn from it. Pinned so the fix stays in the UI layer.
    expect(daHasRoutingFor('Nicky', 'Seattle', ROUTING)).toBe(true);
    expect(daHasRoutingFor('Nicky', 'Bellevue', ROUTING)).toBe(true);
    expect(daHasRoutingFor('Cam', 'Seattle', ROUTING)).toBe(false);
    expect(daHasRoutingFor('Cam', null, ROUTING)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C — THE SETTINGS COPY
// ---------------------------------------------------------------------------

describe('fix-497 §C: Settings stops claiming they cannot be picked', () => {
  it('★★★ the gap list says the lead is chosen by hand', () => {
    const editor = readFileSync(
      resolve(process.cwd(), 'src/components/Settings/DaRoutingEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('chosen by hand on each new');
    expect(editor).toContain('the cascade leaves them alone');
    // ★ The sentence that is no longer true.
    expect(stripComments(editor)).not.toContain(
      'they cannot be picked as lead DA on a new project',
    );
  });

  it('★★ the LIST itself stays — it still catches a real new joiner', () => {
    // ★ Bobby's ruling is about Cam and Shire, not about the panel. A DA who
    //   genuinely has not been set up yet is still worth surfacing; what
    //   changed is what the absence MEANS, not whether to show it.
    const editor = readFileSync(
      resolve(process.cwd(), 'src/components/Settings/DaRoutingEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('da-routing-unrouted');
    expect(editor).toContain('no routing rule');
  });

  it('★★★ lib/daRouting records the superseded claim rather than deleting it', () => {
    // ★★ fix-400's rule: a re-ruled decision is an EVOLUTION. The old note said
    //    the DA "cannot be picked… at all" — true when written, and the reason
    //    two real people were stuck. Kept as the record.
    const lib = readFileSync(
      resolve(process.cwd(), 'src/lib/daRouting.ts'),
      'utf8',
    );
    expect(lib).toContain('POINT 2 CHANGED IN fix-497');
    // ★ …and the half that did NOT change is still stated: there is no
    //   "defaults to Miles" rule, which is what makes deleting a row safe.
    expect(lib).toContain('POINT 1 IS UNCHANGED');
    // ★ Cased as the source writes it — the original note shouts it.
    expect(lib).toContain('THERE IS NO "DEFAULTS TO MILES" RULE');
  });
});

/** ★ Comments stripped — the notes recording a removed sentence have to quote
 *  it. The eleventh time this repo has met that trap. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
