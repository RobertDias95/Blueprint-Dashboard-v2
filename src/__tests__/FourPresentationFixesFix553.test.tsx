import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StatusLegend from '../components/DrawSchedule/StatusLegend';
import {
  DS_PARK_PRESENTATION,
  type DsParkKind,
} from '../lib/drawScheduleStatus';
import { hatch } from '../lib/retiredState';
import {
  TASK_STATUS_PAINT,
  TASK_STATUS_CONTRAST,
  type TaskStatus,
} from '../lib/taskStatus';
import { LIBRARY_SITE_SHARED_FIELDS } from '../lib/librarySiteFields';

// ===========================================================================
// ★★★ fix-553 — FOUR THINGS HARD TO READ OR IN THE WRONG PLACE (P-259, P-260),
//     plus §D (P-247 accepted) and §F (the hold hatch)
// ===========================================================================
//
// ★★★ §A's FINDING IS THE SHAPE OF THE WHOLE TICKET: *the rule was applied in
//     one place and not the other.* fix-530 §D removed the strikethrough from
//     the BLOCKS; the legend kept striking, because the legend held a SECOND
//     copy of the park colours with a `strike` flag of its own. Removing the
//     flag alone would have fixed today's symptom and left tomorrow's — so the
//     COPY is gone: the legend renders `DS_PARK_PRESENTATION`.
//
// ★★★ AND THE SAME SHAPE TURNED UP TWICE MORE WHILE LOOKING:
//       · a THIRD strikethrough, added by fix-556 §D one week ago (Project
//         View's folded original row) — the brief predicted a third instance
//         "in two weeks"; it took one.
//       · a SECOND `STATUS_BG` literal (§B) in the Waiting On report, with the
//         same failing contrast values as the one that was reported.

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}
/** Comments stripped — the gravestone trap: an assertion that a treatment is
 *  GONE must not be satisfied by the note explaining its removal.
 *
 *  ★★★ JSX BLOCK COMMENTS TOO, and that is not optional here. This file's
 *      subject is code that was REMOVED, and every removal left a JSX comment
 *      recording what went and why — those quote the very tokens being
 *      asserted absent. A line-prefix filter alone let the record satisfy the
 *      assertion, which is the eighteenth time this Brain has met the trap. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

describe('fix-553 §A — nothing struck through for a retired state', () => {
  it('★★★ the LEGEND does not strike, and no longer even asks', () => {
    const src = code(read('components/DrawSchedule/StatusLegend.tsx'));
    expect(src).not.toContain('line-through');
    // ★★ The flag is gone, not just false — a `strike` field is an invitation.
    expect(src).not.toContain('strike');
  });

  it('★★★ the BLOCK does not strike either — all three park states', () => {
    for (const k of ['hold', 'cancelled', 'redesigned'] as DsParkKind[]) {
      expect(DS_PARK_PRESENTATION[k].strikeAddress).toBe(false);
    }
  });

  it('★★★ the THIRD instance is gone — Project View’s folded original row', () => {
    // ★★★ fix-556 §D added it on 2026-09-14, one day before this ticket, struck
    //     through — unaware fix-530 §D had retired the treatment. The brief
    //     said *"a third instance turning up in two weeks is the failure
    //     mode."* It took one week.
    const src = code(read('pages/ProjectList.tsx'));
    expect(src).not.toContain('line-through');
  });

  it('★★★ …and the distinction survives WITHOUT the line', () => {
    // ★ Three carriers, none of them colour alone: the hatch TEXTURE (every
    //   live status is flat), the hue, and the word — every chip is labelled.
    render(<StatusLegend />);
    for (const k of ['hold', 'cancelled', 'redesigned'] as DsParkKind[]) {
      const p = DS_PARK_PRESENTATION[k];
      const chip = screen.getByTestId(`ds-legend-chip-${p.label}`);
      expect(chip.getAttribute('style')).toContain('repeating-linear-gradient');
      expect(chip.textContent).toBe(p.label);
    }
    // ★ and Project View's folded original keeps its hatch and its chip.
    const list = code(read('pages/ProjectList.tsx'));
    expect(list).toContain("retiredHatch('redesigned')");
    expect(list).toContain('project-view-original-chip-');
  });

  it('★★★ the legend holds NO second copy of the park colours', () => {
    // ★★★ This is the fix, as opposed to the symptom. The legend paints from
    //     the block's own record, so "the legend matches the block" is true by
    //     construction rather than by two lists agreeing.
    const src = code(read('components/DrawSchedule/StatusLegend.tsx'));
    expect(src).toContain('DS_PARK_PRESENTATION');
    expect(src).not.toContain('RETIRED_PALETTE');
    expect(src).not.toContain('retiredHatch(');
  });
});

describe('fix-553 §F — On hold joins the hatch family, without the line', () => {
  it('★★★ it is the SAME hatch, taking a third colour — not a third pattern', () => {
    // ★ fix-524 §A built `hatch(a, b)` parameterised precisely so a third state
    //   is two more colours. Asserted by identity against the primitive.
    expect(DS_PARK_PRESENTATION.hold.background).toBe(
      hatch('var(--color-hold-a)', 'var(--color-hold-b)'),
    );
  });

  it('★★★ the three backgrounds differ ONLY by their colour arguments', () => {
    // ★ Same stripe width, same angle — one recipe. Swap the tokens out and the
    //   three strings are identical.
    const shape = (k: DsParkKind) =>
      DS_PARK_PRESENTATION[k].background.replace(/var\(--color-[a-z]+-[ab]\)/g, 'C');
    expect(shape('hold')).toBe(shape('cancelled'));
    expect(shape('cancelled')).toBe(shape('redesigned'));
  });

  it('★★★ a hold takes NO strikethrough — it is a PAUSE, not an ending', () => {
    // ★★★ MEASURED prod 2026-09-14: `project_holds` kind `hold` — 7 rows, SIX
    //     ALREADY ENDED, one open. `cancelled` — 5 rows, all five open-ended.
    //     Striking a project through and un-striking it a fortnight later is
    //     the display lying in both directions.
    expect(DS_PARK_PRESENTATION.hold.strikeAddress).toBe(false);
  });

  it('★★★ a hold KEEPS its phase pill — it is still live work', () => {
    expect(DS_PARK_PRESENTATION.hold.showPhasePill).toBe(true);
    expect(DS_PARK_PRESENTATION.cancelled.showPhasePill).toBe(false);
    expect(DS_PARK_PRESENTATION.redesigned.showPhasePill).toBe(false);
  });

  it('★★★ a hold is NOT retired — it must not start being hidden', () => {
    // ⚠️ The brief's warning: only the COLOUR changes. `RetiredCause` is still
    //    the two ENDINGS, so nothing in Pipeline or Library visibility moved.
    const src = code(read('lib/retiredState.ts'));
    expect(src).toContain("export type RetiredCause = 'cancelled' | 'redesigned'");
    expect(src).not.toContain("'hold' | 'cancelled'");
  });

  it('★★ the legend’s three entries are one family', () => {
    render(<StatusLegend />);
    const bg = (label: string) =>
      screen.getByTestId(`ds-legend-chip-${label}`).getAttribute('style') ?? '';
    for (const k of ['hold', 'cancelled', 'redesigned'] as DsParkKind[]) {
      expect(bg(DS_PARK_PRESENTATION[k].label)).toContain('repeating-linear-gradient');
    }
  });
});

describe('fix-553 §B — the status chips are legible, measured', () => {
  it('★★★ every chip clears WCAG AA on its own ground', () => {
    // ★★★ BEFORE: `--color-text` #1a2540 painted on the SATURATED colours —
    //       Open        on --color-s2 #e8edf3  12.90:1  passed
    //       In Progress on --color-de #2563eb   2.94:1  FAILED  ← reported
    //       Resolved    on --color-pm #059669   4.03:1  FAILED  ← found here
    //     TWO of the three failed, not one.
    for (const s of Object.keys(TASK_STATUS_CONTRAST) as TaskStatus[]) {
      expect(TASK_STATUS_CONTRAST[s]).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('★★★ the ground lightened to a tint that already existed — no new blue', () => {
    // ★ §B's own first option. White ink was the alternative and does NOT work:
    //   #ffffff is 5.17 on --color-de but **3.77 on --color-pm**, so there is
    //   no single ink that clears both saturated grounds.
    expect(TASK_STATUS_PAINT['In Progress'].background).toBe('var(--color-de-bg)');
    expect(TASK_STATUS_PAINT.Resolved.background).toBe('var(--color-pm-bg)');
    const css = read('index.css');
    expect(css).toContain('--color-de-bg');
    expect(css).toContain('--color-pm-bg');
  });

  it('★★★ distinctness does not rest on three pale tints', () => {
    // ★ Each chip also carries its own border, plus the dot glyph and the word.
    const borders = (Object.keys(TASK_STATUS_PAINT) as TaskStatus[]).map(
      (k) => TASK_STATUS_PAINT[k].border,
    );
    expect(new Set(borders).size).toBeGreaterThan(1);
    const chip = code(read('components/MyTasks/TaskStatusChip.tsx'));
    expect(chip).toContain('borderColor');
    expect(chip).toContain('OPTION_DOT');
  });

  it('★★★ ONE map — the second literal is gone from the Waiting On report', () => {
    // ★★★ There were TWO `STATUS_BG` literals with identical failing values.
    //     Fixing the reported one would have left the report dark-on-dark.
    for (const f of ['pages/MyTasks.tsx', 'components/Reports/WaitingOnView.tsx']) {
      const src = code(read(f));
      expect(src).toContain('TASK_STATUS_PAINT');
      expect(src).not.toContain("'In Progress': 'var(--color-de)'");
    }
  });

  it('★★ both chip render sites take the paint — the card and the panel', () => {
    const chip = code(read('components/MyTasks/TaskStatusChip.tsx'));
    // the cancelled span and the button branch
    expect(chip.match(/borderColor: border \?\? 'var\(--color-border\)'/g)?.length).toBe(2);
  });
});

describe('fix-553 §C — jurisdiction and zone moved right, beside stage', () => {
  it('★★★ the Site header reads address · dimensions · corner · juris · zone · alley · stage', () => {
    const lib = read('components/LibraryMatrix.tsx');
    const site = lib
      .slice(lib.indexOf('data-testid="library-table"'))
      .replace(
        /\{LIBRARY_SITE_SHARED_FIELDS\.map[\s\S]*?\)\)\}/,
        LIBRARY_SITE_SHARED_FIELDS.map((f) => `col="${f.key}"`).join(' '),
      );
    const order = [...site.matchAll(/col="(\w+)"/g)]
      .map((m) => m[1])
      .filter((c, i, a) => a.indexOf(c) === i);
    const idx = (c: string) => order.indexOf(c);
    expect(idx('lotSizeSf')).toBeLessThan(idx('isCornerLot'));
    expect(idx('isCornerLot')).toBeLessThan(idx('juris'));
    expect(idx('juris')).toBeLessThan(idx('zone'));
    expect(idx('zone')).toBeLessThan(idx('stage'));
  });

  it('★★★ the UNIT header puts Juris after the dimensions too', () => {
    const lib = read('components/LibraryMatrix.tsx');
    const unit = lib.slice(0, lib.indexOf('data-testid="library-table"'));
    const order = [...unit.matchAll(/col="(\w+)"/g)]
      .map((m) => m[1])
      .filter((c, i, a) => a.indexOf(c) === i);
    expect(order.indexOf('address')).toBeLessThan(order.indexOf('juris'));
    expect(order.indexOf('size')).toBeLessThan(order.indexOf('juris'));
    expect(order.indexOf('juris')).toBeLessThan(order.indexOf('stage'));
  });

  it('★★★ moved, not dropped — both still sort and both still filter', () => {
    // ★ Same `col` keys through the same `toggleSort`; the filter box reads the
    //   same declared list, so filtering is untouched by construction.
    const lib = code(read('components/LibraryMatrix.tsx'));
    expect(lib).toContain('col="juris"');
    expect(lib).toContain('LIBRARY_SITE_SHARED_FIELDS.map');
    expect(LIBRARY_SITE_SHARED_FIELDS.map((f) => f.key)).toEqual([
      'juris',
      'zone',
      'alley',
    ]);
  });

  it('★★★ column order is NOT persisted per user — nothing to reset', () => {
    // ★★★ §C asked. The Library persists FILTERS only (`library.filters`,
    //     decoded field by field); no column order is stored anywhere, so the
    //     new order is what everyone sees on their next load and no version
    //     bump is needed.
    const prefs = code(read('lib/surfaceFilterPrefs.ts'));
    expect(prefs).toContain("'library.filters'");
    expect(prefs).not.toContain('columnOrder');
  });
});

describe('fix-553 §D — the two badges come off, the data does not', () => {
  it('★★★ no ARCHIVED badge renders in the Library', () => {
    const lib = code(read('components/LibraryMatrix.tsx'));
    expect(lib).not.toContain('ARCHIVED_FALLBACK_SHORT');
    expect(lib).not.toContain('library-archived-');
  });

  it('★★★ no REDESIGNED badge renders in the Library — site row or unit row', () => {
    const lib = code(read('components/LibraryMatrix.tsx'));
    expect(lib).not.toContain('RetiredBadge');
    // ★ The two ROW badges, by their own testids — the site row's
    //   `library-retired-${projectId}` and the unit row's
    //   `library-retired-unit-${key}`.
    expect(lib).not.toContain('library-retired-unit-');
    expect(lib).not.toContain('library-retired-${row.projectId}');
    // ★★ AND THE HEADER'S COUNTS SURVIVE, which is the distinction that
    //    remains: `· N superseded` still says how many are here. Asserting it
    //    positively is what stops a later sweep taking the count as well.
    expect(lib).toContain('library-retired-hidden');
    expect(lib).toContain('library-retired-shown');
  });

  it('★★★ the plan-of-record card KEEPS its explanation — §D protects it', () => {
    // ⚠️ *"Remove the BADGE only … that sentence is the surviving trace and it
    //    stays."* The card says the SENTENCE ("Archived — nothing current on
    //    file."), never the bare word.
    const card = code(read('components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).toContain('ARCHIVED_FALLBACK_LABEL');
    expect(card).toContain('plan-of-record-archived');
  });

  it('★★★ the DATA is untouched — the flag, the index and the resolver', () => {
    // ★ `is_archived_fallback` (60 projects) and `redesign_of_project_id` (18)
    //   are read exactly as before; only two markers stopped rendering.
    const fallback = code(read('lib/archivedFallback.ts'));
    expect(fallback).toContain('ARCHIVED_FALLBACK_LABEL');
    expect(fallback).toContain('ARCHIVED_FALLBACK_SHORT');
    const hook = code(read('hooks/useArchivedFallbackProjects.ts'));
    expect(hook).toContain("eq('is_archived_fallback', true)");
  });

  it('★★ the redesign RELATIONSHIP still shows where it is described', () => {
    // ★ §D: *"Do not remove the link between a redesign and its original."*
    const list = code(read('pages/ProjectList.tsx'));
    expect(list).toContain('project-view-original-link-');
    const lib = code(read('components/LibraryMatrix.tsx'));
    // the Library still KEEPS them and still counts them in its header
    expect(lib).toContain('redesignedAwayProjectIds');
    expect(lib).toContain('superseded');
  });
});
