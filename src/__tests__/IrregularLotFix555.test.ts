import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import {
  LOT_VARIES_LABEL,
  lotSizeView,
  parseLotSizeSf,
  parseLotDimensionFt,
} from '../lib/lotDimensions';
import { makeEmptyWizardState, makeRedesignWizardState } from '../components/wizard/wizardState';

// ===========================================================================
// ★★★ fix-555 (P-261) — AN IRREGULAR LOT IS ONE YOU ONLY HALF MEASURED
// ===========================================================================
//
// Bobby, 2026-09-14:
//   · **Regular lot** — enter width and depth → the size computes. The size may
//     still be overridden by hand.
//   · **Irregular lot** — enter ONE of width/depth, plus the size. The blank one
//     displays `varies`.
//   · **`varies` IS the irregular indicator. No checkbox, no "is this
//     irregular?" question.**
//
// ---------------------------------------------------------------------------
// §0b — RE-MEASURED 2026-09-29. EVERY LINE OF THE BRIEF'S TABLE HAS MOVED.
// ---------------------------------------------------------------------------
//
//                                brief (09-14)      measured (09-29)
//   projects                     220                **271**
//   width AND depth both filled  214                **253**
//   width only                     0                **8**   ★ was impossible
//   depth only                     0                **1**   ★ was impossible
//   neither                        6                **9**
//   `lot_size_sf` filled          38                **237** ★ 6×
//   `is_regular_shape = false`     0                **4**   ★ the flag is alive
//   both dims + size, size ≠ w×d  35                **181** ★ 5×
//
// ★★★ THE GROWTH IS fix-562, NOT A NEW DEFECT. It wired `lot_size_sf` for
//     editing and people filled it in — 38 → 237 in fifteen days. So "size ≠
//     w × d" stopped meaning "contradiction" and started meaning "somebody typed
//     a real surveyed area next to a rounded rectangle", which is the normal
//     case for a real lot.
//
// ★★★ AND THE SHAPE OF THE DISAGREEMENT PROVES IT: of the 181, **119 are under
//     0.5 %**, 86 are within TEN SQUARE FEET and 23 are off by exactly 1 sq ft.
//     Only **24 are at or above 2 %**, and exactly **6 are at or above 30 %** —
//     which is the brief's own *"six are off by more than 30 %"*, unchanged
//     while everything around it multiplied. **The real disagreements were
//     always six; the other 175 are arithmetic.**

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
/** ★ Comments stripped — this suite asserts what the code DOES, and several of
 *  these files explain at length the very strings being banned. */
const code = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-555 §B — the five cases of the form', () => {
  it('★★★ §B.1 · width + depth, no size → the size is COMPUTED, never stored', () => {
    const v = lotSizeView(60, 100, null);
    expect(v.sizeSf).toBe(6000);
    expect(v.sizeText).toBe('6,000 sf');
    // ★★★ THE ANSWER TO §B.1's QUESTION — *"say whether it is stored or computed
    //     at render"*. It is COMPUTED AT RENDER. `sizeDerived` is the flag every
    //     surface reads to tell arithmetic from a survey, and §C asserts below
    //     that no writer anywhere passes a product.
    expect(v.sizeDerived).toBe(true);
    expect(v.irregular).toBe(false); // a product cannot disagree with itself
  });

  it('★★★ §B.1 · changing either dimension changes the computed size', () => {
    expect(lotSizeView(60, 100, null).sizeSf).toBe(6000);
    expect(lotSizeView(70, 100, null).sizeSf).toBe(7000);
    expect(lotSizeView(60, 110, null).sizeSf).toBe(6600);
  });

  it('★★★ §B.2 · a hand-entered size that disagrees is KEPT, not flagged', () => {
    // ⚠️⚠️ SUPERSEDED BY fix-602 §C (2026-09-30) — AND NOT MISTAKEN.
    //
    //    fix-488 defined `irregular` as a MISMATCH: all three typed, and the
    //    rectangle more than 5% from the size. Both it and fix-555 said in
    //    their own PRs that **the 5% was Cowork's number, not Bobby's**.
    //
    // ★★★ HE HAS NOW RULED, AND HE REJECTED THE QUESTION RATHER THAN PICKING
    //     A NUMBER: *"irregular = only one of the two items input, width or
    //     depth … Or if both boxes are blank and just a lot size."*
    //     **Irregular is a missing dimension.** A lot with BOTH dimensions is
    //     never irregular, whatever the size says.
    //
    // ★★ THE KEEPING IS THE HALF THAT SURVIVES, and it is the half that
    //    mattered: the typed number is never overwritten by arithmetic. What
    //    changed is that a disagreement is DATA, not a shape — it lives in
    //    `data/reports/fix_555_lot_size_disagreements.md` for people to
    //    correct, and §C.4 forbids a second indicator for it.
    const v = lotSizeView(60, 100, 4500);
    expect(v.sizeSf).toBe(4500);        // ★ the typed number survives
    expect(v.sizeDerived).toBe(false);  // ★ and is known to be a survey
    expect(v.irregular).toBe(false);    // ★★ both dimensions → never irregular
    expect(v.pairText).toBe('60 × 100');
  });

  it('★★★ §C · NO size mismatch makes a two-dimension lot irregular', () => {
    // ★★★ THE TEST §C ASKS FOR BY NAME: *"both dims with a 40% size mismatch →
    //     NOT irregular."* The old rule flagged 20 such lots on prod; the new
    //     one flags none of them, because they are all fully measured.
    for (const size of [5990, 4500, 3600, 10000]) {
      expect(lotSizeView(60, 100, size).irregular, String(size)).toBe(false);
    }
    // a 40% gap on a 6,000 sf rectangle, named explicitly
    const forty = lotSizeView(60, 100, 3600);
    expect(forty.sizeSf).toBe(3600);
    expect(forty.irregular).toBe(false);
  });

  it('★★★ §B.3 · one dimension + size → the blank one reads `varies`', () => {
    const w = lotSizeView(60, null, 7200);
    expect(w.depthVaries).toBe(true);
    expect(w.widthVaries).toBe(false);
    expect(w.pairText).toBe(`60 × ${LOT_VARIES_LABEL}`);
    expect(w.sizeSf).toBe(7200);

    const d = lotSizeView(null, 100, 7200);
    expect(d.widthVaries).toBe(true);
    expect(d.depthVaries).toBe(false);
    expect(d.pairText).toBe(`${LOT_VARIES_LABEL} × 100`);
  });

  it('★★★ §B.4 · neither dimension + size → BOTH read `varies`', () => {
    // ★★★ THE ONE THING THIS TICKET CHANGES IN THE RULE. fix-488 rendered no
    //     pair here and called it *"Cowork's call, not Bobby's"*, flagging it in
    //     its own PR. §B.4 is his answer: *"allowed; BOTH read `varies`."*
    //
    // ★★ The brief said *"0 projects today; it will happen."* It has:
    //    `5616 E Argyle DR`, 14,136 sf, no width, no depth, created 2026-09-16.
    const v = lotSizeView(null, null, 14136);
    expect(v.widthVaries).toBe(true);
    expect(v.depthVaries).toBe(true);
    expect(v.pairText).toBe(`${LOT_VARIES_LABEL} × ${LOT_VARIES_LABEL}`);
    expect(v.sizeSf).toBe(14136);
    expect(v.sizeDerived).toBe(false);
    // ⚠️ fix-602 §C FLIPPED THIS. fix-555 reasoned that `irregular` was a
    //    DISAGREEMENT and there was no rectangle to disagree with, so it was
    //    false. Bobby's definition makes this case irregular BY NAME: *"if both
    //    boxes are blank and just a lot size, then that is irregular too."*
    expect(v.irregular).toBe(true);
  });

  it('★★★ §B.5 · nothing → blank, exactly as now', () => {
    const v = lotSizeView(null, null, null);
    expect(v.pairText).toBeNull();
    expect(v.sizeSf).toBeNull();
    expect(v.sizeText).toBeNull();
    expect(v.widthVaries).toBe(false);
    expect(v.depthVaries).toBe(false);
  });

  it('★★★ §C.2 · a blank dimension beside a FILLED one reads `varies`, size or not', () => {
    // ⚠️⚠️ SUPERSEDED BY fix-602 §C.2. fix-488 and fix-555 both required a typed
    //       SIZE before the word appeared, reasoning that a lone blank meant
    //       NOT RECORDED. Bobby's rule does not: *"If one is blank, it auto
    //       triggers irregular and inputs varies into the box."* The filled
    //       dimension beside it IS the statement.
    //
    // ★ 0 lots are in this state today, so nothing on screen moves — this is
    //   the rule the next one will meet.
    const v = lotSizeView(60, null, null);
    expect(v.depthVaries).toBe(true);
    expect(v.widthVaries).toBe(false);
    expect(v.pairText).toBe(`60 × ${LOT_VARIES_LABEL}`);
    expect(v.irregular).toBe(true);
  });

  it('★★★ §C.1 · NOTHING typed is not recorded, and NOT irregular', () => {
    // ★★ THE HALF THAT SURVIVES. Two blanks with no size is a row nobody has
    //    filled in — 6 projects — and inventing an irregular lot from an
    //    unfinished form would be the opposite of the ruling.
    const v = lotSizeView(null, null, null);
    expect(v.irregular).toBe(false);
    expect(v.widthVaries).toBe(false);
    expect(v.depthVaries).toBe(false);
    expect(v.pairText).toBeNull();
  });

  it('★★★ typing the missing dimension RETURNS the lot to regular', () => {
    // §B: *"The user must be able to get back from irregular to regular by
    // typing the missing dimension. Assert it."*
    const irregular = lotSizeView(60, null, 7200);
    expect(irregular.depthVaries).toBe(true);

    const back = lotSizeView(60, 120, 7200);
    expect(back.depthVaries).toBe(false);
    expect(back.widthVaries).toBe(false);
    expect(back.pairText).toBe('60 × 120');
    // ★ the typed size is STILL kept — typing a depth does not discard a survey
    expect(back.sizeSf).toBe(7200);
    expect(back.irregular).toBe(false); // 60 × 120 = 7,200 exactly

    // ★★ …and from the §B.4 state too, one dimension at a time.
    const none = lotSizeView(null, null, 7200);
    expect(none.widthVaries && none.depthVaries).toBe(true);
    const half = lotSizeView(60, null, 7200);
    expect(half.widthVaries).toBe(false);
    expect(half.depthVaries).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-555 §B — `varies` is DISPLAY, and never reaches the column', () => {
  it('★★★ the word cannot be parsed into a dimension', () => {
    // §B: *"Do not write the string `varies` into `lot_width` or `lot_depth` —
    // they are numeric and 9 projects already have nulls."*
    for (const raw of [LOT_VARIES_LABEL, 'Varies', 'VARIES', 'irregular', 'n/a', '—']) {
      const parsed = parseLotDimensionFt(raw);
      expect(parsed.ok, raw).toBe(false);
    }
  });

  it('★★★ …and neither can it become a lot size', () => {
    for (const raw of [LOT_VARIES_LABEL, 'Varies', 'abc']) {
      expect(parseLotSizeSf(raw).ok, raw).toBe(false);
    }
  });

  it('★★ a BLANK is still a legitimate way to clear a dimension', () => {
    // ★ The null state is how a lot becomes irregular in the first place, so
    //   clearing must stay possible — it is not the same as typing nonsense.
    const blank = parseLotDimensionFt('');
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value).toBeNull();
  });

  it('★★★ no source file writes the WORD into either numeric column', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== '__tests__') walk(full);
        } else if (
          /\.tsx?$/.test(ent.name) &&
          // ★ `savedPatchAudit` maps every column to a HUMAN LABEL
          //   (`lot_width: 'Lot width'`). It is a display dictionary, not a
          //   write payload — banning it would forbid naming the field.
          !/savedPatchAudit\.ts$/.test(ent.name)
        ) {
          const body = code(readFileSync(full, 'utf8'));
          // ★★ A NON-EMPTY STRING LITERAL ONLY. The wizard holds every field as
          //    a string while it is being typed — `lot_width: ''` in its state
          //    and `lot_width: string` in its type are both correct and neither
          //    is a column write. What must never appear is a WORD.
          if (/lot_(width|depth)\s*:\s*['"`][^'"`]+['"`]/.test(body)) {
            offenders.push(full.split(sep).pop()!);
          }
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-555 §C — every writer of `lot_size_sf`, as an exact list', () => {
  // ★★★ §C: *"Two writers of one derived rule is the most repeated defect in
  //     this Brain (P-207, P-179, P-244, fix-531, fix-541 §A). If the
  //     auto-computed size is stored anywhere, there must be exactly one place
  //     that computes it."*

  it('★★★ NOTHING anywhere writes width × depth into the column', () => {
    // ★★★ THE LOAD-BEARING ASSERTION OF §C, and the answer to §B.1: the computed
    //     size is RENDERED, never stored. So there is no second writer of a
    //     derived rule, because there is no writer of it at all.
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== '__tests__') walk(full);
        } else if (/\.tsx?$/.test(ent.name)) {
          const body = code(readFileSync(full, 'utf8'));
          if (/lot_size_sf\s*:\s*[^,;\n]*(lot_width|lotWidth)[^,;\n]*\*/.test(body)) {
            offenders.push(full.split(sep).pop()!);
          }
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });

  it('★★★ the writers, named — and they do NOT all share one parser', () => {
    // ★★★ §C ASKED FOR THE LIST AND THE LIST HAS A SPLIT IN IT, which is worth
    //     saying rather than smoothing over:
    //
    //       1. the wizard        NewProjectWizard        → `parseLotSizeSf`
    //       2. the Site card     ProjectDataEditors      → `parseLotSizeSf`
    //       3. the Details modal projectDetailsForm      → `parseLotSizeSf`
    //       4. the Library cell  LibraryMatrix           → **its own check**
    //
    //     The Library edits through `LibraryEditCell`'s whole-number field, which
    //     re-implements the bound as `/^\d+$/ && n <= max` with its own refusal
    //     toast instead of calling `parseLotSizeSf`.
    //
    // ★★ IT IS NOT A DEFECT TODAY — the ceiling it is handed is the same
    //    `LOT_SIZE_SF_MAX`, so the two agree. It is a SECOND IMPLEMENTATION of
    //    one rule, which is the shape §C names as this Brain's most repeated
    //    defect. Reported in the PR rather than refactored inside a display
    //    ticket, and pinned here so the two cannot drift apart unnoticed.
    expect(code(read('components/NewProjectWizard.tsx'))).toContain('parseLotSizeSf(');
    expect(code(read('components/ProjectDetail/ProjectDataEditors.tsx'))).toContain('parseLotSizeSf(');
    expect(code(read('components/LibraryMatrix.tsx'))).toContain('lot_size_sf: v');
    // ★ the Library cell's own bound, and the constant both sides read
    expect(code(read('components/LibraryEditCell.tsx'))).toMatch(/\^\\d\+\$/);
    expect(code(read('components/LibraryMatrix.tsx'))).toContain('LOT_SIZE_SF_MAX');
  });

  it('★★ and the redesign copier carries the size ACROSS, it does not derive one', () => {
    // It is the SAME PARCEL, so the stored size travels with the two dimensions.
    const src = code(read('components/wizard/wizardState.ts'));
    expect(src).toContain('lot_size_sf:');
    expect(src).not.toMatch(/lot_size_sf[^,;\n]*\*/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-555 §0b — `is_regular_shape` leaves the write path, keeps its column', () => {
  it('★★★ the wizard no longer ASKS the question', () => {
    // Bobby's model: *"`varies` is the indicator. No checkbox, no ‘is this
    // irregular?’ question."*
    const step1 = code(read('components/wizard/Step1ProjectInfo.tsx'));
    expect(step1).not.toContain('wizard-is-regular-shape');
    expect(step1).not.toContain('Regular Shape');
  });

  it('★★★ …and no longer WRITES it', () => {
    const wiz = code(read('components/NewProjectWizard.tsx'));
    expect(wiz).not.toContain('is_regular_shape');
    // ★★ `wizardState` KEEPS ONE MENTION, AND IT IS A READ: the `parentProject`
    //    parameter type mirrors the `projects` row, which still HAS the column.
    //    What must be gone is the state field, its default and the copier —
    //    asserted behaviourally above rather than by banning the identifier,
    //    which would forbid describing the row this function is handed.
    const state = code(read('components/wizard/wizardState.ts'));
    expect(state).not.toMatch(/^\s*is_regular_shape: /m);
    expect(state).toContain('is_regular_shape?: boolean | null;');
  });

  it('★★★ the wizard state has no such field, and a redesign inherits none', () => {
    const empty = makeEmptyWizardState() as unknown as Record<string, unknown>;
    expect('is_regular_shape' in empty).toBe(false);
    const redesign = makeRedesignWizardState({
      id: 'p1',
      address: '1 Main St',
      is_regular_shape: false,
    }) as unknown as Record<string, unknown>;
    expect('is_regular_shape' in redesign).toBe(false);
    // ★★ but the three fields the shape now lives in DO inherit — that is what
    //    keeps an irregular parent irregular on every redesign of it.
    for (const f of ['lot_width', 'lot_depth', 'lot_size_sf']) {
      expect(f in redesign, f).toBe(true);
    }
  });

  it('★★★ the READS all survive — ⛔ the column is NOT dropped', () => {
    // §0b: *"Do not drop the column in this ticket — read it out of the write
    // path first, drop it in a later one once nothing reads it."* fix-537b
    // dropped a column the same week its last reader went; that order is the
    // rule, not the exception.
    expect(code(read('hooks/useProjects.ts'))).toContain('is_regular_shape');
    expect(code(read('lib/libraryHelpers.ts'))).toContain('isRegularShape');
    expect(code(read('lib/savedPatchAudit.ts'))).toContain('is_regular_shape');
    expect(code(read('lib/database.types.ts'))).toContain('is_regular_shape');
  });

  it('★★★ no migration in this ticket drops or backfills it', () => {
    // ⛔ Do-NOT: *"Drop `is_regular_shape`."* And §A: change none of the rows.
    const migrations = readdirSync(resolve(ROOT, '..', 'migrations'));
    expect(migrations.filter((f) => /fix_555/i.test(f))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-555 §A — the read, and nothing but the read', () => {
  const REPORT = 'data/reports/fix_555_lot_size_disagreements.md';

  it('★★★ the disagreement report exists', () => {
    // §A: *"produce the list — with address, w, d, w×d, stored size, and percent
    // gap — in the PR, and as a file in `data/reports/`."*
    const src = readFileSync(resolve(ROOT, '..', REPORT), 'utf8');
    expect(src.length).toBeGreaterThan(500);
  });

  it('★★★ it carries every column §A asks for', () => {
    const src = readFileSync(resolve(ROOT, '..', REPORT), 'utf8');
    for (const col of ['address', 'width', 'depth', 'w × d', 'stored size', 'gap']) {
      expect(src.toLowerCase(), col).toContain(col.toLowerCase());
    }
  });

  it('★★★ it recommends a threshold and says it is a RECOMMENDATION', () => {
    // §A: *"Recommend a threshold in the PR — but do not act on it."*
    const src = readFileSync(resolve(ROOT, '..', REPORT), 'utf8');
    expect(src).toMatch(/recommend/i);
    expect(src).toMatch(/2\s*%/);
    // ⚠️⚠️ fix-555 LEFT THE TOLERANCE AT 5% AND SAID THE NUMBER WAS NOT
    //       BOBBY'S. fix-602 §C is his answer, and it is not a number at all:
    //       **the tolerance is retired** and irregular means a missing
    //       dimension. The report survives unchanged — the disagreement it
    //       lists is a DATA problem for people to correct, which is exactly
    //       what §C.4 says it should stay.
    const lib = readFileSync(resolve(ROOT, 'lib/lotDimensions.ts'), 'utf8');
    expect(lib).not.toContain('export const LOT_IRREGULAR_TOLERANCE');
  });

  it('★★★ it changes NOTHING — it is a report, not a migration', () => {
    // ⛔ *"Do not blank a dimension, do not recompute a size, do not backfill a
    //    flag. A display ticket that quietly rewrites 181 lot sizes is an
    //    incident, and this Brain has that scar twice (fix-541 §C, P-230)."*
    const src = readFileSync(resolve(ROOT, '..', REPORT), 'utf8');
    expect(src).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\s/im);
    expect(src).toMatch(/no rows? (were |was )?changed|nothing was changed|changes nothing/i);
  });
});
