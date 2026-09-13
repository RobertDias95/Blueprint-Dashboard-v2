import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  shouldShowLotsField,
  ADD_LOTS_LABEL,
  LOTS_COMPARISON_SURFACES,
} from '../lib/lotsVisibility';
import {
  DEFAULT_NUM_LOTS,
  makeEmptyWizardState,
  makeRedesignWizardState,
} from '../components/wizard/wizardState';
import { SEGMENTS, lotBand } from '../lib/correctionsSegments';

// ===========================================================================
// fix-541 (P-236) — `Lots` stops being a question, without becoming a lie
// ===========================================================================
//
// Bobby, 2026-09-10 (screenshot, `Lots` circled): *"moving forward, every
// project we enter will be one lot, so idk if we still need it in the project
// details/add a project screen?"*
//
// ★★★ THE RULE IS TRUE GOING FORWARD AND FALSE ABOUT THE BOOK WE HAVE.
//     Measured on prod 2026-09-13:
//
//       num_lots = 1     202
//       num_lots = 2      12
//       3 · 4 · 5          1 each
//       NULL               3
//       ────────────────  220
//
//     **15 projects genuinely hold more than one lot**, so the field cannot be
//     deleted: `Lots 1` on a project that has 5 is the app lying, and that
//     class (P-230) cost a day. And the forward rule is not yet the observed
//     past — of the **93** projects created in the last 90 days that were NOT
//     backfills, **11 are not 1**. About one in eight of what people enter.

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

// ---------------------------------------------------------------------------
// §A — add-a-project stops asking, and the default lives in ONE place
// ---------------------------------------------------------------------------

describe('fix-541 §A — the question is gone and the default is singular', () => {
  it('★★★ add-a-project has no Lots input; the REDESIGN path still does', () => {
    // ★★★ THERE WERE TWO INPUTS AND ONLY ONE WAS THE SUBJECT. fix-191 ruled a
    //     redesign's scope can differ from its original, and a redesign is
    //     spawned from a project rather than entered on this screen. Removing
    //     both would have reversed that ruling without saying so.
    const step1 = read('src/components/wizard/Step1ProjectInfo.tsx');
    const hits = step1.match(/data-testid="wizard-num-lots"/g) ?? [];
    expect(hits).toHaveLength(1);
    // ★ and the one that survives is inside the `isRedesign` branch
    const at = step1.indexOf('data-testid="wizard-num-lots"');
    const before = step1.slice(0, at);
    expect(before.lastIndexOf('{isRedesign && (')).toBeGreaterThan(
      before.lastIndexOf('{!isRedesign && ('),
    );
  });

  it('★★★ the default is 1, and it is written down exactly once', () => {
    // ⚠️ §A: *"Default it in ONE place."* `projects.num_lots` has NO DDL
    //    default (checked on prod) and the creation RPC passes the wizard's
    //    value through `NULLIF(…,'')::int`, so this constant is the only thing
    //    standing between "every new project is 1 lot" and a table of NULLs.
    expect(DEFAULT_NUM_LOTS).toBe('1');
    expect(makeEmptyWizardState().num_lots).toBe(DEFAULT_NUM_LOTS);

    // ★★★ ONE PLACE, ASSERTED AS ONE PLACE. The literal may be written in the
    //     constant and nowhere else — every other site reads the constant.
    const state = code(read('src/components/wizard/wizardState.ts'));
    const literals = state.match(/num_lots:\s*'1'/g) ?? [];
    expect(literals).toHaveLength(0);
    expect(state).toContain("export const DEFAULT_NUM_LOTS = '1'");
    expect(state).toContain('num_lots: DEFAULT_NUM_LOTS');
  });

  it('★★★ a project created through the wizard sends a NUMBER 1, not a blank', () => {
    // ★★★ THE FAILURE THIS PREVENTS. Before fix-541 an untouched Lots landed as
    //     NULL on the wire. Remove the input and leave the default at '' and
    //     **every new project becomes a NULL** — the exact state §C found on
    //     three redesigns, and the opposite of the ruling.
    const send = code(read('src/components/NewProjectWizard.tsx'));
    expect(send).toContain('num_lots: intOrNull(state.num_lots)');
    expect(Number(makeEmptyWizardState().num_lots)).toBe(1);
  });

  it('★★★ a redesign of a parent with NO recorded count falls back to the same place', () => {
    // ★★ This is how §C's three NULLs were made: the redesign seeder used `''`
    //    when the parent had nothing, and `''` becomes NULL. All three are
    //    redesigns of parents that say 1.
    const parent = {
      id: 'p1',
      address: '1 Main St',
      juris: 'Seattle',
      num_lots: null,
      units: 3,
    } as unknown as Parameters<typeof makeRedesignWizardState>[0];
    const st = makeRedesignWizardState(parent, 1, null);
    expect(st.num_lots).toBe(DEFAULT_NUM_LOTS);

    // ★ …and a parent that DOES have a count is still inherited verbatim.
    const parent5 = { ...parent, num_lots: 5 } as typeof parent;
    expect(makeRedesignWizardState(parent5, 1, null).num_lots).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// §B — Project Details shows it only when it is not 1
// ---------------------------------------------------------------------------

describe('fix-541 §B — visible when it matters, reachable when it does not', () => {
  it('★★★ the predicate is "not 1", which is why NULL stays visible', () => {
    // ★★★ A NULL IS NOT A 1. Nobody recorded an answer, so the field stays
    //     visible and empty rather than hidden behind an assumption — hiding it
    //     would render "unknown" as agreement. §C says the three NULLs are
    //     almost certainly 1, and they are still not being treated as 1 here.
    expect(shouldShowLotsField(1)).toBe(false);
    expect(shouldShowLotsField(2)).toBe(true);
    expect(shouldShowLotsField(5)).toBe(true);
    expect(shouldShowLotsField(null)).toBe(true);
    expect(shouldShowLotsField(undefined)).toBe(true);
    // ★ 0 cannot occur (`num_lots_positive` rejects it) and is not 1 either,
    //   so it shows — the right answer for a value that should not exist.
    expect(shouldShowLotsField(0)).toBe(true);
  });

  it('★★★ the field and the route back are mutually exclusive, in the component', () => {
    const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(editors).toContain('shouldShowLotsField(project.num_lots) || lotsRevealed');
    expect(editors).toContain('!shouldShowLotsField(project.num_lots) && !lotsRevealed');
    expect(editors).toContain('data-testid="site-add-lots"');
    expect(ADD_LOTS_LABEL).toBe('More than one lot?');
  });

  it('★★ the reveal is visit-local, because the predicate takes over afterwards', () => {
    // ★ Once a real count is committed `shouldShowLotsField` keeps the field
    //   visible on its own, so there is nothing to persist and no second
    //   source of truth about whether to show it.
    const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(editors).toContain('useState(false)');
    expect(editors).not.toContain('localStorage');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ Where it must NOT be hidden
// ---------------------------------------------------------------------------

describe('fix-541 — a hidden 1 is fine in a form and wrong in a table', () => {
  it('★★★ every comparison surface still shows the number for all 220', () => {
    // ⚠️ §B: *"Do not hide it in the Library, exports, or anywhere a number is
    //    compared across projects — a hidden 1 is fine in a form, wrong in a
    //    table where the neighbouring row says 5."*
    for (const f of [
      'src/lib/libraryHelpers.ts',
      'src/lib/correctionsSegments.ts',
      'src/lib/teamPerformance.ts',
    ]) {
      const src = code(read(f));
      expect(src, f).toContain('num_lots');
      // ★★ THE LOAD-BEARING HALF: none of them may consult the form-only
      //    predicate. If a later change imports it here, this fails.
      expect(src, f).not.toContain('shouldShowLotsField');
    }
    expect(LOTS_COMPARISON_SURFACES).toEqual([
      'libraryHelpers',
      'correctionsSegments',
      'teamPerformance',
    ]);
  });

  it('★★★ the Lots report segment is untouched, bands and all', () => {
    // ★ The segment compares projects against each other (1 / 2–3 / 4+), so a
    //   blank there would be a worse lie than the question fix-541 removed.
    const seg = SEGMENTS.find((s) => s.key === 'num_lots');
    expect(seg).toBeTruthy();
    expect(seg!.label).toBe('Lots');
    expect(seg!.order).toEqual(['1', '2–3', '4+']);
    expect(seg!.valueOf({ num_lots: 1 } as never)).toBe('1');
    expect(lotBand(1)).toBe('1');
    expect(seg!.valueOf({ num_lots: 5 } as never)).toBe('4+');
  });

  it('★★ the Library still carries the number', () => {
    const lib = code(read('src/lib/libraryHelpers.ts'));
    expect(lib).toContain('numLots: proj.num_lots ?? null');
  });
});

// ---------------------------------------------------------------------------
// §C — the three NULLs, reported not written
// ---------------------------------------------------------------------------

describe('fix-541 §C — nothing was backfilled', () => {
  it('★★★ no migration, and no data rewritten', () => {
    // ⚠️ §C: *"A display ticket that quietly writes rows is how a display
    //    ticket becomes an incident."* The three NULLs are reported in the PR
    //    with a recommendation and left exactly as they are.
    //
    // ★★★ WHAT THEY ARE, measured: all three are `[Redesign 1]` projects
    //     created on 2026-06-25, 80 days old, with ZERO permits — and **all
    //     three parents say `num_lots = 1`**, with units matching exactly
    //     (2/2, 3/3, 4/4). Every one of the 203 originals has a value; only 3
    //     of 17 redesigns do not. So NULL here means *"the redesign seeder
    //     never copied it"*, not *"unknown"* — and the seeder is fixed above,
    //     which is the durable half.
    const migrations = readFileSync(
      resolvePath(process.cwd(), 'migrations/PENDING_APPROVAL_INDEX.md'),
      'utf8',
    );
    expect(migrations).not.toContain('fix_541');
  });
});
