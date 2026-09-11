import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  blockMetaFitsOneLine,
  chipState,
  dateLabelState,
  phaseChipIsRedundant,
} from '../lib/drawScheduleHelpers';

// ===========================================================================
// ★★★ fix-521 §B (P-224) + §C (P-222) — THE BLOCK'S META LINE, AND A DEAD FIELD
// ===========================================================================

// ---------------------------------------------------------------------------
// §B RULE 1 — jurisdiction never truncates
// ---------------------------------------------------------------------------

describe('fix-521 §B (P-224) — the pair stacks rather than truncating the city', () => {
  // ★ The three Bobby named, at the widths they render at. `daColW` minus the
  //   block's 2px insets and 6px padding a side is the text box.
  const NARROW = 90 - 4 - 12; // a 90px column → 74px of text
  const WIDE = 200 - 4 - 12; // a 200px column → 184px

  it('★★★ a NARROW block stacks — `Edmonds` + `Corrections` do not fit on one line', () => {
    // Bobby: *"Edmonds partially cut off, and then corrections, estimated
    // approval. It needs to be able to stack these vertically."*
    expect(blockMetaFitsOneLine('Edmonds', 'Corrections', 7, 6, NARROW)).toBe(false);
  });

  it('★★★ a WIDE block does NOT stack — fix-515 was right about those', () => {
    // ★★ fix-515 §A put these on one row because it made them fit AND bought a
    //    line of height back: *"the tallest case got SHORTER rather than
    //    taller"*. That is still true where there is room, and §B does not
    //    undo it — it makes the one-line case conditional instead of assumed.
    expect(blockMetaFitsOneLine('Edmonds', 'Corrections', 7, 6, WIDE)).toBe(true);
  });

  it('★★★ the three prod blocks that were truncating all stack now', () => {
    for (const [juris, chip] of [
      ['Edmonds', 'Corrections'], // 548 3rd Ave N
      ['Seattle', 'Corrections'], // 5623 44th Ave SW
      ['Phoenix', 'Corrections'], // 4040 E Via Estrella
    ] as const) {
      expect(
        blockMetaFitsOneLine(juris, chip, 7, 6, NARROW),
        `${juris} + ${chip} must not share a line on a narrow block`,
      ).toBe(false);
    }
  });

  it('★★ a SHORT jurisdiction and a SHORT chip still share a line when narrow', () => {
    // ★ The rule is about width, not about "narrow blocks always stack" — a
    //   block that fits keeps fix-515's saved line.
    expect(blockMetaFitsOneLine('Kent', 'Approved', 7, 6, NARROW)).toBe(true);
  });

  it('★★ it errs WIDE, like the address ramp it borrows its advance from', () => {
    // ★★★ `BLOCK_ADDRESS_CHAR_EM` is 0.58, above every advance measured in
    //     `harness/draw-block-fit-484.html`. Over-estimating stacks one notch
    //     sooner than strictly necessary, which costs a line; under-estimating
    //     leaves the city name clipped, which is the defect. fix-484 §A2
    //     settled that asymmetry and this inherits it.
    //     `Edmonds` + `Corrections` measures ~74.6px at these sizes, so a box
    //     of exactly 74 must refuse.
    expect(blockMetaFitsOneLine('Edmonds', 'Corrections', 7, 6, 74)).toBe(false);
    expect(blockMetaFitsOneLine('Edmonds', 'Corrections', 7, 6, 400)).toBe(true);
  });

  it('★ an unmeasured box (jsdom, first paint) does not stack everything', () => {
    expect(blockMetaFitsOneLine('Edmonds', 'Corrections', 7, 6, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §B RULE 2 — collapse only a genuine duplicate
// ---------------------------------------------------------------------------

describe('fix-521 §B — the chip collapses only when it says what the date says', () => {
  it('★★★ COLLAPSES: `Cancelled` beside `✕ CANCELLED` is one word twice', () => {
    // `1953 10th Ave W` read `Cancelled` and then `✕ CANCELLED 09-04-26`.
    expect(phaseChipIsRedundant('Cancelled', '✕ CANCELLED')).toBe(true);
  });

  it('★★★ COLLAPSES: `On hold` beside `⏸ On hold — <reason>`', () => {
    expect(phaseChipIsRedundant('On hold', '⏸ On hold — Client paused')).toBe(true);
  });

  it('★★★ COLLAPSES: `Approved` beside `Approval` — the date IS the approval', () => {
    // `1602 41st Ave E` read `Seattle Approved` then `Approval 06-12-26`.
    expect(phaseChipIsRedundant('Approved', 'Approval')).toBe(true);
  });

  it('★★★ STAYS: `Corrections` beside `Est. Approval` — TWO different facts', () => {
    // ★★★ THE ASSERTION THAT STOPS THE OBVIOUS FIX. `548 3rd Ave N` reads
    //     `Corrections` then `Est. Approval 10-31-26`: what it is doing now,
    //     and when it is expected to finish. **A fix that just deletes the chip
    //     strips the first from every in-flight block.**
    expect(phaseChipIsRedundant('Corrections', 'Est. Approval')).toBe(false);
  });

  it('★★★ STAYS: `Approved` beside `Est. Approval` — because they DISAGREE', () => {
    // ★★★ The subtle one. An `Approved` chip beside an `Approval` date is one
    //     fact stated twice. An `Approved` chip beside an **Est.** Approval is
    //     the lane saying approved while the projection is still forecasting —
    //     and **a block that quietly resolves a contradiction is worse than one
    //     that shows it.**
    expect(phaseChipIsRedundant('Approved', 'Est. Approval')).toBe(false);
  });

  it('★★ STAYS: every other phase, against every date label', () => {
    for (const chip of [
      'Scheduled',
      'Schematic',
      'DD / Permit Set',
      'Pending Consultants',
      'Under Review',
      'Corrections',
    ]) {
      for (const date of ['Est. Approval', 'Approval', '✕ CANCELLED', '⏸ On hold — x']) {
        expect(
          phaseChipIsRedundant(chip, date),
          `${chip} must survive beside ${date}`,
        ).toBe(false);
      }
    }
  });

  it('★★ both sides are CLOSED VOCABULARIES, mapped — not stemmed', () => {
    // ★ "approved" ≈ "approval" by stemming would be a guess that breaks the
    //   first time somebody adds a status. Each side maps to a state token.
    expect(chipState('Cancelled')).toBe('cancelled');
    expect(chipState('On hold')).toBe('held');
    expect(chipState('Approved')).toBe('approved');
    expect(chipState('Corrections')).toBe('other');
    expect(dateLabelState('✕ CANCELLED')).toBe('cancelled');
    expect(dateLabelState('⏸ On hold — anything')).toBe('held');
    expect(dateLabelState('Approval')).toBe('approved');
    expect(dateLabelState('Est. Approval')).toBe('other');
    // ★ `other` never collapses with `other` — two unnamed states are not the
    //   same state.
    expect(phaseChipIsRedundant('Under Review', 'Est. Approval')).toBe(false);
  });
});

describe('fix-521 §B — the block wires both rules, and pays for the line', () => {
  const grid = readFileSync(
    resolve(process.cwd(), 'src/components/DrawScheduleGrid.tsx'),
    'utf8',
  );

  it('★★★ a collapsed chip means there is nothing to stack', () => {
    // ★★★ THE BUDGET RULE — *"to add a line, remove a line."* Stacking costs a
    //     line; collapsing a duplicate chip saves one. Wiring `metaStacks` to
    //     `!chipRedundant` is what makes them pay for each other rather than
    //     both landing on the same block.
    expect(grid).toContain('!chipRedundant &&');
    expect(grid).toContain('blockMetaFitsOneLine(');
  });

  it('★★★ the stack height KNOWS about the extra line', () => {
    // ★★ fix-515 made `blockDetailLines` a constant so *"the height arithmetic
    //    and the markup cannot drift"*. A stacked meta line is one more detail
    //    line and the anchor decision has to be told, or the block centres
    //    itself around a height it does not have.
    // ★★ SUPERSEDED BY fix-530 §A. fix-521 paid for a stacked meta line by
    //    adding one to a CONSTANT; §A replaced the constant with a measured
    //    plan, because the block also has to be able to drop the row entirely.
    //    The property is unchanged and is stronger: the anchor decision reads
    //    the same line count the markup will draw.
    expect(grid).toContain('fieldPlan.detailLines');
  });

  it('★★ the date label is derived ONCE and handed to the collapse rule', () => {
    // ★ fix-512's lesson on two strings: a rule that re-derived the label
    //   could compare against something the block does not print.
    expect(grid).toContain('const dateLabel = heldForMeta');
    expect(grid).toContain('phaseChipIsRedundant(chipLabel, dateLabel)');
  });
});

// ---------------------------------------------------------------------------
// §C — the field written as '' where it means nothing
// ---------------------------------------------------------------------------

describe('fix-521 §C (P-222) — no save path writes `` to a nullable column', () => {
  const writer = readFileSync(resolve(process.cwd(), 'src/hooks/useUpdateDsRow.ts'), 'utf8');

  it('★★★ a null goes to the RPC as `null`, not as an empty string', () => {
    // ★★★ THE WRITER, FOUND. `useUpdateDsRow` serialised every null as `''`
    //     before calling `bp_upsert_draw_schedule_row`, which writes the text
    //     columns RAW while wrapping the date columns in `NULLIF(…,'')`. So a
    //     row that never had a colour got an empty string saying it had.
    expect(writer).toContain('payload[key] = null;');
    expect(writer).not.toContain("payload[key] = '';");
    expect(writer).toContain("Record<string, string | null>");
  });

  it('★★★ P-222 UNDERSTATED IT — three columns, not two', () => {
    // Prod, 2026-09-10, on the SAME 14 rows (13 `manually_placed`):
    //   color_override 14 × ''  ·  status_override 14 × ''  ·  notes 14 × ''
    // `da_assigned`, `start_week`, `end_week` and `status` are never empty —
    // not because they were treated differently, but because the editor always
    // sets them. The bug was in all eleven columns and visible in the three
    // that are allowed to be absent.
    expect(writer).toContain('notes');
    expect(writer).toContain('color_override');
    expect(writer).toContain('status_override');
  });

  it('★★ nothing in the app READS either override column', () => {
    // ★ The claim behind the drop. Checked over `src/` here; the server side —
    //   every `pg_proc` in `public` — was checked against prod and only the
    //   writer names them.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/DrawScheduleGrid.tsx'),
      'utf8',
    );
    expect(src).not.toContain('color_override');
    expect(src).not.toContain('status_override');
  });

  it('★★★ the drop migration exists, patches the writer FIRST, and is NOT applied', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_521_drop_draw_schedule_color_override.sql'),
      'utf8',
    );
    expect(sql).toContain('NOT APPLIED');
    // ⚠️ The order is the whole risk: `bp_upsert_draw_schedule_row` WRITES the
    //    column, so dropping it first leaves every save raising
    //    `column "color_override" does not exist`.
    expect(sql.indexOf('bp_upsert_draw_schedule_row')).toBeLessThan(
      sql.indexOf('ALTER TABLE public.draw_schedule DROP COLUMN'),
    );
    // ★ …and it refuses to proceed if its anchors miss.
    expect(sql).toContain('still names color_override after patching');
  });

  it('★★ `status_override` is reported, NOT dropped', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_521_drop_draw_schedule_color_override.sql'),
      'utf8',
    );
    expect(sql).toContain('DOES NOT RIDE ALONG');
    expect(sql).not.toContain('DROP COLUMN IF EXISTS status_override');
  });
});
