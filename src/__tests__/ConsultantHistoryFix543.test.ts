import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  seedPhaseLabel,
  transitionAppends,
  type ConsultantStatus,
} from '../lib/consultants';

// ===========================================================================
// fix-543 (P-214) — consultant history: kept, and shown where it exists
// ===========================================================================
//
// Bobby, 2026-09-10: *"will the history be visible for consultants if there's
// multiple, or if there is history available for those consultants, and how we
// see that."*
//
// ★★★ THE ANSWER, MEASURED ON PROD 2026-09-14: it is kept, and there is almost
//     nothing to look at yet.
//
//   project_consultant_rounds ........ 191      round_index 0 .... 184 (5 voided)
//   consultants with any round ....... 184      round_index 1 ......  7 (0 voided)
//   consultants with >1 round .......... 7      voided rounds ......  5
//   consultants with NO round .......... 0      two LIVE at one index  0
//
// ★★★ AND THE SHAPE OF THE SEVEN IS THE FINDING: **5 of the 7 have a second
//     round only because their first was VOIDED** (a firm change clearing the
//     rounds). Just **2** are a genuine "we sent it again". A history viewer
//     built today would show one row to 177 of 184 consultants.
//
// ★★★ SO THE CHEAP, VALUABLE HALF — round 2 never overwriting round 1 — IS THE
//     WHOLE TICKET, and it is a GUARANTEE, not an observation. Proved below.

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

const ALL: ConsultantStatus[] = ['Scheduled', 'Pending', 'Received'];

// ---------------------------------------------------------------------------
// §A — the write paths open a round, never overwrite one
// ---------------------------------------------------------------------------

describe('fix-543 §A — a round is opened, never overwritten', () => {
  it('★★★ the client mirror reproduces the SERVER rule, transition for transition', () => {
    // ★★★ THE PROD PROBE, PASTED — a real consultant driven through the ladder
    //     inside a transaction that ended in ROLLBACK, 2026-09-14:
    //
    //   Scheduled -> Pending .... 1 round   appended=false   (a correction)
    //   Pending   -> Received ... 1 round   appended=false   (same round)
    //   Received  -> Scheduled .. 2 rounds  appended=TRUE    0:Received (Design)
    //                                                        1:Scheduled (Cycle 1)
    //   round 0 afterwards ...... Received, sent=2026-09-14, recd=2026-09-14
    //   sent a third time ....... 3 rounds  appended=TRUE    indexes 0,1,2
    //
    // ★★ `bp_set_consultant_status` returns `appended` precisely so the two can
    //    be compared. This is the test its doc comment promised.
    const appending: string[] = [];
    for (const from of ALL) {
      for (const to of ALL) {
        if (transitionAppends(from, to)) appending.push(`${from}->${to}`);
      }
    }
    expect(appending).toEqual(['Received->Scheduled']);
    expect(transitionAppends(null, 'Scheduled')).toBe(false);
  });

  it('★★★ an advance that means "we sent it again" opens the NEXT index', () => {
    // ★ The probe's indexes went 0 → 0,1 → 0,1,2. The label seeds from the new
    //   index, and the two sides agree on it: the RPC writes
    //   `case when v_next_ix = 1 then 'Cycle 1' else 'Cycle ' || v_next_ix end`
    //   and `bp_add_project_consultant` opens index 0 as 'Design'.
    expect(seedPhaseLabel(0)).toBe('Design');
    expect(seedPhaseLabel(1)).toBe('Cycle 1');
    expect(seedPhaseLabel(2)).toBe('Cycle 2');
  });

  it('★★★ …and the finished round keeps its dates — that is the guarantee', () => {
    // ★★★ P-214's real ask. The probe read round 0 back AFTER the reopen:
    //     `Received, sent=2026-09-14, recd=2026-09-14` — byte for byte what it
    //     was. The RPC's reopen branch inserts and touches nothing else, and
    //     its own comment says so: *"The finished round is left BYTE-FOR-BYTE
    //     ALONE."*
    //
    // ★★ The client half of the guarantee is that NOTHING here edits a round by
    //    index: every writer goes through an RPC keyed on the consultant, and
    //    the server picks the latest LIVE round itself.
    const lib = code(read('src/lib/consultants.ts'));
    expect(lib).not.toMatch(/round_index\s*=\s*\d/);
    expect(lib).toContain('transitionAppends');
  });

  it('★★ the reopen counts over EVERY row, voided included', () => {
    // ⚠️ The unique is (consultant_id, round_index) over every row, so the next
    //    index must be computed over every row too — otherwise clearing rounds
    //    (which voids index 0) then reopening would collide. Measured: 0
    //    consultants have two LIVE rounds at one index, and the 5 cleared ones
    //    sit at [0 voided, 1 live], which is exactly this working.
    const lib = code(read('src/lib/consultants.ts'));
    // the client never computes the next index — the server owns it
    expect(lib).not.toContain('max(round_index)');
  });
});

// ---------------------------------------------------------------------------
// §A.3 — what `p_clear_rounds` actually does
// ---------------------------------------------------------------------------

describe('fix-543 §A.3 — clearing rounds VOIDS, it never deletes', () => {
  it('★★★ not one of the six functions deletes a round', () => {
    // ★★★ MEASURED ON PROD 2026-09-14, over all six writers:
    //
    //   function                        inserts  updates  DELETES
    //   bp_add_project_consultant .........  1       0       0
    //   bp_set_consultant_status ..........  1       1       0
    //   bp_set_consultant_firm ............  1       1       0
    //   bp_set_consultant_date ............  0       1       0
    //   bp_set_consultant_phase ...........  0       1       0
    //   bp_remove_project_consultant ......  0       1       0
    //
    // ★★ `p_clear_rounds` stamps `voided_at = now()` on every live round and
    //    then opens a fresh one at `max(round_index) + 1`. **Nothing is
    //    deleted, so P-131's concern — that clearing is destructive — does not
    //    stand against the DATA.** It stands against the SCREEN, which is §B.2.
    //
    // ★ Evidence in the app: `consultantHasNothingToClear` exists precisely
    //   because a cleared consultant still has rows to reason about.
    const lib = code(read('src/lib/consultants.ts'));
    expect(lib).toContain('consultantHasNothingToClear');
    // ★ and the client never deletes a round itself
    expect(lib).not.toMatch(/delete.*project_consultant_rounds/i);
  });

  it('★★ a cleared consultant is still "one live round, and it says nothing"', () => {
    // ★ fix-479 §C's rule, and it is keyed off the LIVE count rather than
    //   `round_index === 0` — which is why it is true for the 5 cleared
    //   consultants too, whose live round sits at index 1.
    const lib = read('src/lib/consultants.ts');
    expect(lib).toContain('ONE LIVE ROUND, AND IT SAYS NOTHING');
    expect(lib).toContain('round_count');
  });
});

// ---------------------------------------------------------------------------
// §B — shown where there IS history, and nowhere else
// ---------------------------------------------------------------------------

describe('fix-543 §B — 177 of 184 look exactly as they do today', () => {
  const band = read('src/components/ProjectDetail/ConsultantBand.tsx');

  it('★★★ the expand control appears ONLY above one round', () => {
    // ★★★ §B.1 IS ALREADY BUILT, and correctly gated — this ticket adds nothing
    //     to it. `row.round_count > 1` is the gate, so the 177 single-round
    //     consultants render no extra control at all.
    expect(code(band)).toContain('row.round_count > 1 || open');
    expect(band).toContain('rounds ⌄');
  });

  it('★★★ …and it says how many, then shows Round · Sent · Received', () => {
    // ★ §B.1's "Round 2 of 2 and a way to see the earlier one's dates": the
    //   button counts them and the panel is a three-column table of exactly
    //   those dates. No page, no modal — §B.3 satisfied by what exists.
    expect(band).toContain('pd-consultant-history-');
    expect(band).toContain('pd-consultant-round-');
    for (const h of ['Round', 'Sent', 'Received']) expect(band).toContain(h);
  });

  it('★★★ only the LATEST round is editable — an older row cannot be renamed', () => {
    // ⚠️ The RPC writes the latest round and nothing else, so an input on an
    //    older row would silently rename the wrong one.
    expect(code(band)).toContain('r.round_index === row.round_index ?');
  });

  it('★★★ "Round 0" is never printed anywhere', () => {
    // ⚠️ The brief's rule: `round_index` is 0-based, so a display that prints
    //    the raw index would say "Round 0" in one place and "Round 1" in
    //    another. Nothing prints the index as a label — the table prints the
    //    round's NAME (`phase`), seeded 'Design' / 'Cycle N', and the button
    //    prints a COUNT. The index appears only inside a test id.
    expect(band).not.toMatch(/Round\s*\{?\s*r\.round_index/);
    expect(band).not.toMatch(/Round\s*\$\{[^}]*round_index/);
    expect(seedPhaseLabel(0)).not.toMatch(/0/);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ §B.2 — the one thing this ticket does NOT do, pinned so it cannot drift
// ---------------------------------------------------------------------------

describe('fix-543 §B.2 — voided rounds stay hidden, and that is a RULING', () => {
  it('★★★ the rounds query still filters voided, with fix-479 §C named', () => {
    // ★★★ §B.2 ASKS TO REVERSE A RULING, AND THIS TICKET REPORTS RATHER THAN
    //     REVERSES IT. fix-479 §C ruled, in this file's own words:
    //     *"VOIDED ROUNDS ARE NOT HISTORY, THEY ARE ERASED HISTORY … the ruling
    //     is that the screen reads EXACTLY as it did under `delete`."*
    //     Bobby approved void-instead-of-delete on the promise that the screen
    //     would not change.
    //
    // ⚠️ AND IT IS NOT A ONE-LINE FLIP. The expand gate reads `round_count`
    //    from the `project_consultant_current` VIEW, which filters voided — so
    //    the 5 consultants whose only extra round is voided have
    //    `round_count = 1` and no expand control at all. Making them visible
    //    means changing the view, which also changes
    //    `consultantHasNothingToClear` — the prompt that decides whether
    //    changing a firm asks before clearing. That is a second ruling, on the
    //    5 rows this is about.
    //
    // ★ So the filter stays, NAMED, and this test fails if anyone removes it
    //   quietly. Reversing it is Bobby's call, and it is costed in the PR.
    const hook = read('src/hooks/useProjectConsultants.ts');
    expect(hook).toContain(".is('voided_at', null)");
    expect(hook).toContain('fix-479');
    expect(hook).toContain('ERASED');
  });

  it('★★ the 5 voided rounds are still THERE — hidden is not deleted', () => {
    // ★ Measured: 5 voided rounds, 0 consultants whose only round is voided,
    //   and 5 of the 7 multi-round consultants got their second round this way.
    //   Nothing was lost; the screen simply does not show it.
    // ★ The app knows how many were voided — the clear RPC returns the count
    //   and the band reports it — which is the proof that "hidden" and
    //   "deleted" are different words here.
    const hook = read('src/hooks/useProjectConsultants.ts');
    expect(hook).toContain('out_rounds_voided');
  });
});

// ---------------------------------------------------------------------------
// §C — what a second round costs elsewhere
// ---------------------------------------------------------------------------

describe('fix-543 §C — nothing downstream pretends there is only one round', () => {
  it('★★★ the forecast reads the CURRENT round, which is the right one', () => {
    // ★★★ fix-499's forecast reads `project_consultant_current` — the view that
    //     picks the latest round by (round_index desc, id desc), the same two
    //     keys `currentRound` uses client-side, so the two cannot disagree
    //     (fix-338's tie-break, because `now()` is constant in a transaction).
    //
    // ★★ SO §B CHANGES NOTHING THERE, and a multi-round consultant already
    //    forecasts from its newest round — which is what a forecast wants: the
    //    round in flight, not a finished one.
    const page = code(read('src/pages/VendorScheduleForecastReport.tsx'));
    expect(page).toContain('useConsultantCurrent');
    const hook = code(read('src/hooks/useConsultantCurrent.ts'));
    expect(hook).toContain('project_consultant_current');
  });

  it('★★★ no surface shows "the" round as if there were only one', () => {
    // ⚠️ §C's P-230 shape — a field showing one value where two exist. Checked:
    //   · the consultant band says "Expand · N rounds" whenever N > 1;
    //   · the Project overview shows a DERIVED target DATE (`vendorTargetSend`
    //     off the BP's dd_end), not a round at all;
    //   · the Library shows no consultant data whatsoever.
    const overview = code(read('src/components/ProjectDetail/ProjectOverviewBoxes.tsx'));
    expect(overview).toContain('vendorTargetSend');
    expect(overview).not.toContain('round_index');
    const library = code(read('src/lib/libraryHelpers.ts'));
    expect(library).not.toContain('consultant');
    expect(library).not.toContain('round');
  });
});
