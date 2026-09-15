import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import NpBlockEditPopup from '../components/NpBlockEditPopup';
import {
  NP_BLOCK_COLOR,
  PTO_BLOCK_COLOR,
  PTO_BLOCK_TYPE,
  npBlockColor,
} from '../lib/drawScheduleHelpers';
import { DS_STATUS_COLORS } from '../lib/drawScheduleStatus';
import type { DaTimeBlock } from '../lib/database.types';
import popupSrc from '../components/NpBlockEditPopup.tsx?raw';
import gridSrc from '../components/DrawScheduleGrid.tsx?raw';

// ===========================================================================
// fix-577 (P-281) — Ana can edit, and the NP picker says what the team says
// ===========================================================================
//
//   A  `schematic` joins the `project_details` capability
//   B  `Vacation` becomes `PTO` — the option AND the stored value
//   C  PTO gets a sand tint; Training / Corrections / Other stay grey
//   D  `Redesign` comes off the picker
//   E  the Draw Schedule search gets a clear button

const migrationSql = readFileSync(
  resolve(process.cwd(), 'migrations/fix_577_ana_and_pto_PENDING_APPROVAL.sql'),
  'utf8',
);

/** Source with comments stripped — JSX ones included. ★★★ THE GRAVESTONE TRAP.
 *  Every `not.toContain` below runs on this: the notes recording §B's rename
 *  and §D's removal both quote the words being removed, so an unstripped scan
 *  passes on its own explanation. This codebase has paid for that six times. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function block(over: Partial<DaTimeBlock> = {}): DaTimeBlock {
  return {
    id: 'np_1',
    da_name: 'Trevor',
    type: 'PTO',
    label: '',
    start_week: '2026-05-04',
    end_week: '2026-05-11',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-08T12:00:00Z',
    ...over,
  } as DaTimeBlock;
}

// ---------------------------------------------------------------------------
// §A · THE CAPABILITY
// ---------------------------------------------------------------------------

describe('fix-577 §A — `schematic` reaches `project_details`', () => {
  it('★★★ the staged function grants project_details to schematic', () => {
    // ★★★ ONE LINE. The arm gains `'schematic'`; nothing else in the function
    //     moves, which the two assertions below pin rather than trust.
    expect(migrationSql).toMatch(
      /case when r && array\['dm','director','ent','ent_lead','schematic'\]\s+then 'project_details'/,
    );
  });

  it('★★★ the OTHER TWO ARMS are re-emitted byte-identical', () => {
    // ★★★ A `CREATE OR REPLACE` REWRITES THE WHOLE BODY, so an arm retyped from
    //     memory is an arm silently changed. These are copied from the live
    //     `pg_get_functiondef` — the repo's rule since fix-410, and the reason
    //     this file patches by anchor rather than by recollection.
    expect(migrationSql).toMatch(
      /case when r && array\['dm','director','schematic'\]\s+then 'schematic_designer'/,
    );
    expect(migrationSql).toMatch(
      /case when r && array\['dm','director'\]\s+then 'reassign_da'/,
    );
  });

  it('★★★ `bp_may_write_project` and the `da` branch are NOT touched', () => {
    // ⚠️ The guardrail, asserted. One line in `bp_write_caps` reaches the RLS
    //    policy, the write RPC and every field in the modal, because all three
    //    already ask that one function — so widening the rule needs no second
    //    edit, and making one would be a second writer of one rule.
    const statements = migrationSql
      .split('\n')
      .filter((l) => l.startsWith('-- ') && /^-- (CREATE|UPDATE|ALTER|DROP|GRANT)/.test(l));
    expect(statements.join('\n')).not.toMatch(/bp_may_write_project/);
    expect(statements.join('\n')).not.toMatch(/may_edit_all_projects/);
    expect(statements.join('\n')).not.toMatch(/bp_project_has_no_da/);
  });

  it('★★ it records that exactly one person changes, and who', () => {
    // ★ The measurement is the justification. Dave, Derry, Jade and Lindsay all
    //   already hold the cap by another role; Ana holds `schematic` alone.
    expect(migrationSql).toContain('Ana');
    expect(migrationSql).toMatch(/false → \*\*true\*\*/);
    // ★★ ...and that a `da`-only login is unmoved, which is the half that says
    //    the grant did not widen past the ruling.
    expect(migrationSql).toMatch(/`da`-only login.*false → \*\*false\*\*/);
  });

  it('★★★ the `bp_project_has_no_da` observation is FLAGGED, with its number', () => {
    // ★★★ Out of scope and unruled — but a second, wider grant sitting under
    //     the narrow one Bobby described is exactly what a reader of this
    //     function needs told. Flag only; no statement changes it.
    expect(migrationSql).toContain('bp_project_has_no_da');
    expect(migrationSql).toMatch(/24 of 224 projects/);
  });
});

// ---------------------------------------------------------------------------
// §B · PTO
// ---------------------------------------------------------------------------

describe('fix-577 §B — `Vacation` becomes `PTO`, value and all', () => {
  it('★★★ the picker offers PTO and the default writes it', () => {
    const onAdd = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('np-popup-type-PTO').textContent).toMatch(/✓/);
    fireEvent.click(screen.getByTestId('np-popup-save'));
    // ★★★ THE STORED VALUE, not just the label. A control that shows one word
    //     and writes another is two vocabularies for one fact.
    expect(onAdd).toHaveBeenCalledWith('PTO', '', null);
  });

  it('★★★ `Vacation` is gone from the component entirely', () => {
    expect(code(popupSrc)).not.toContain('Vacation');
    expect(screen.queryByTestId('np-popup-type-Vacation')).toBeNull();
  });

  it('★★★ the migration renames 37 types and only the 16 ECHOED labels', () => {
    // ★★★ THE PARTIAL RENAME IS THE RULING. 21 of the 37 carry a label somebody
    //     typed; a blanket `SET label = 'PTO'` would erase 21 deliberate
    //     sentences to fix 16 automatic ones.
    expect(migrationSql).toMatch(/SET label = 'PTO'/);
    expect(migrationSql).toMatch(/AND label = 'Vacation'/);
    expect(migrationSql).toMatch(/SET type = 'PTO'/);
    // ★ The custom labels are named as untouched, not merely omitted.
    expect(migrationSql).toMatch(/21 custom labels are (deliberately )?left (exactly )?alone/i);
  });

  it('★★★ ORDER: the label statement runs BEFORE the type statement', () => {
    // ★★★ NOT INTERCHANGEABLE, AND THE FAILURE IS SILENT. Both filter on
    //     `type = 'Vacation'`. Reversed, the type update makes the label
    //     update's own WHERE clause match nothing, and 16 blocks print
    //     `Vacation` while typed `PTO` — the exact two-vocabularies defect §B
    //     exists to remove.
    const iLabel = migrationSql.indexOf("SET label = 'PTO'");
    const iType = migrationSql.indexOf("SET type = 'PTO'");
    expect(iLabel).toBeGreaterThan(-1);
    expect(iType).toBeGreaterThan(-1);
    expect(iLabel).toBeLessThan(iType);
    expect(migrationSql).toMatch(/MUST run FIRST|MUST RUN BEFORE/i);
  });

  it('★★ nothing compares against the old string any more', () => {
    // ★ `PTO_BLOCK_TYPE` exists so the colour resolver and the picker cannot
    //   drift onto different spellings of one type.
    expect(PTO_BLOCK_TYPE).toBe('PTO');
    expect(code(gridSrc)).not.toContain("'Vacation'");
  });
});

// ---------------------------------------------------------------------------
// §C · THE SAND TINT
// ---------------------------------------------------------------------------

describe('fix-577 §C — PTO is sand, and only PTO', () => {
  it('★★★ PTO resolves sand; every other type keeps v1 grey', () => {
    expect(npBlockColor('PTO')).toBe(PTO_BLOCK_COLOR);
    for (const t of ['Training', 'Corrections', 'Other']) {
      expect(npBlockColor(t), t).toBe(NP_BLOCK_COLOR);
    }
  });

  it('★★★ an UNKNOWN type still paints something readable', () => {
    // ★★★ fix-406's LESSON: a lookup that returns `undefined` renders a
    //     transparent block with no border, which looks exactly like a styling
    //     choice. A legacy or hand-written value falls back to grey.
    expect(npBlockColor('Redesign')).toBe(NP_BLOCK_COLOR);
    expect(npBlockColor(null)).toBe(NP_BLOCK_COLOR);
    expect(npBlockColor(undefined)).toBe(NP_BLOCK_COLOR);
    expect(npBlockColor('')).toBe(NP_BLOCK_COLOR);
  });

  it('★★★ the text contrast clears AA — measured, not asserted by eye', () => {
    // Bobby: *"something light… that doesn't jump out."* "Subtle" is the hard
    // word in that sentence and it is the one this pins with a number.
    expect(contrast(PTO_BLOCK_COLOR.bg, PTO_BLOCK_COLOR.text)).toBeGreaterThan(4.5);
    // ★★ AAA too, and BETTER than the grey it replaces — a subtler fill must
    //    not cost legibility, which is the trade this could have made silently.
    expect(contrast(PTO_BLOCK_COLOR.bg, PTO_BLOCK_COLOR.text)).toBeGreaterThan(7);
    expect(contrast(PTO_BLOCK_COLOR.bg, PTO_BLOCK_COLOR.text)).toBeGreaterThan(
      contrast(NP_BLOCK_COLOR.bg, NP_BLOCK_COLOR.text),
    );
  });

  it('★★★ it is QUIETER against the grid than the grey it sits beside', () => {
    // ★★★ "Does not jump out", as arithmetic: a higher-luminance fill has LESS
    //     contrast against the light grid ground, so PTO recedes where grey
    //     asserts. This is the assertion that fails if somebody "improves" the
    //     colour into something saturated.
    const GRID = '#f0f4f8'; // --color-bg, index.css
    expect(contrast(PTO_BLOCK_COLOR.bg, GRID)).toBeLessThan(
      contrast(NP_BLOCK_COLOR.bg, GRID),
    );
    // ★★ ...but the BORDER still carries the edge, so a lighter fill does not
    //    dissolve into the grid.
    expect(contrast(PTO_BLOCK_COLOR.border, GRID)).toBeGreaterThan(2);
  });

  it('★★★ it does not enter the taught STATUS colour key', () => {
    // ★★★ fix-263 spent a ticket proving a flat fill nobody taught reads as a
    //     status. PTO must be legible as DIFFERENT without joining the key —
    //     so it is lighter than every status fill, by luminance, not by taste.
    const ptoL = luminance(PTO_BLOCK_COLOR.bg);
    for (const [name, c] of Object.entries(DS_STATUS_COLORS)) {
      if (name === 'Scheduled') continue; // white by design — the empty state
      expect(luminance(c.bg), name).toBeLessThan(ptoL);
    }
  });

  it('★★ the border is the fill DARKENED — fix-515 §B’s rule, unchanged', () => {
    // ★ PTO must not gain an edge treatment the other NP types lack, or the
    //   tint stops being subtle and starts being a chip.
    const strength = (c: typeof NP_BLOCK_COLOR) => contrast(c.bg, c.border);
    expect(Math.abs(strength(PTO_BLOCK_COLOR) - strength(NP_BLOCK_COLOR))).toBeLessThan(0.15);
  });

  it('★★★ ONE theme — checked, not assumed', () => {
    // ★★★ The brief asked for both. There is no dark theme in this app: a
    //     single palette in `index.css`, no `prefers-color-scheme` and no
    //     `data-theme` anywhere in `src/`. And every draw-schedule block paints
    //     LITERAL hexes rather than tokens, so these numbers are what a reader
    //     sees and would stay so if a second theme ever landed.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('data-theme');
    for (const v of Object.values(PTO_BLOCK_COLOR)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('★★ the grid renders through the resolver, not a second literal', () => {
    const g = code(gridSrc);
    expect(g).toContain('npBlockColor(np.type).bg');
    expect(g).toContain('npBlockColor(np.type).border');
    // ★ One resolver, so the block and anything else that paints an NP block
    //   cannot disagree — fix-160's rule about label and colour drifting.
    expect(g).not.toContain('#e3d5b8');
  });
});

// ---------------------------------------------------------------------------
// §D · REDESIGN COMES OFF
// ---------------------------------------------------------------------------

describe('fix-577 §D — a redesign is a project, not a grey rectangle', () => {
  it('★★★ `Redesign` is not offered, and no replacement took its slot', () => {
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('np-popup-type-Redesign')).toBeNull();
    for (const t of ['PTO', 'Training', 'Corrections', 'Other']) {
      expect(screen.getByTestId(`np-popup-type-${t}`)).toBeInTheDocument();
    }
    // ★ Four options, not five-minus-one-plus-something.
    expect(code(popupSrc)).toContain(
      "const TYPES = ['PTO', 'Training', 'Corrections', 'Other'] as const;",
    );
  });

  it('★★★ a STORED off-list type renders as a disabled legacy row', () => {
    // ★★★ THE DEFECT THIS PREVENTS, precisely: `selectedType` is seeded from
    //     `block.type` while the list renders from `TYPES`, so a retired value
    //     ticks NOTHING — and `commit()` writes it straight back unchanged. The
    //     person sees an apparently unanswered picker, presses Save, and the
    //     old value persists silently.
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ type: 'Redesign', label: 'Old block' })}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    const legacy = screen.getByTestId('np-popup-type-legacy');
    expect(legacy.textContent).toMatch(/Redesign/);
    expect(legacy.textContent).toMatch(/retired/);
    expect(legacy).toBeDisabled();
    // ★ It is ticked, because it IS what the block holds — fix-415's append
    //   rule: a control must be able to display what it holds.
    expect(legacy.textContent).toMatch(/✓/);
  });

  it('★★★ …and a LIVE type shows no legacy row at all', () => {
    // ★ The falsifiable half. Without it, a row that always rendered would
    //   satisfy the test above and lie about every normal block.
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ type: 'Training' })}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('np-popup-type-legacy')).toBeNull();
    expect(screen.getByTestId('np-popup-type-Training').textContent).toMatch(/✓/);
  });

  it('★★★ picking a live type REPLACES the retired one', () => {
    // ★ The only move out. The legacy row is disabled, so the retired value
    //   cannot be re-chosen — but it must not be a trap either.
    const onUpdate = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ type: 'Redesign', label: 'Old block' })}
        onUpdate={onUpdate}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-type-Other'));
    expect(screen.queryByTestId('np-popup-type-legacy')).toBeNull();
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onUpdate).toHaveBeenCalledWith('Other', 'Old block', null);
  });

  it('★★ §D moves no data — measured, so there is no statement for it', () => {
    // ★ All three Redesign blocks were removed on 2026-09-15 before this was
    //   written. Prod on that date: PTO(Vacation) 37 · Corrections 24 ·
    //   Other 17 · Training 13 · Redesign 0.
    expect(migrationSql).toMatch(/zero.*rows carrying it|Redesign\s+0/i);
    const statements = migrationSql
      .split('\n')
      .filter((l) => /^-- (UPDATE|DELETE|INSERT)/.test(l));
    expect(statements.join('\n')).not.toContain('Redesign');
  });
});

// ---------------------------------------------------------------------------
// §E · THE CLEAR BUTTON
// ---------------------------------------------------------------------------

describe('fix-577 §E — the search box can be emptied', () => {
  it('★★★ the clear control renders only when there is text', () => {
    const g = code(gridSrc);
    // Conditional on the value, so the toolbar is unchanged for somebody who
    // never searches.
    expect(g).toMatch(/\{search && \(/);
    expect(g).toContain('data-testid="schedule-search-clear"');
    expect(g).toContain("onClick={() => setSearch('')}");
  });

  it('★★★ it MATCHES the existing affordance rather than inventing one', () => {
    // §E: *"find the existing one and match it."* `ScheduleEstimator`'s clear
    // is the one that clears a VALUE — a bare `✕` at `text-[10px]` in
    // `--color-dim` with a `title`. `ProjectLinkPicker`'s is a bordered chip
    // action, a different job.
    const estimator = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/ScheduleEstimator.tsx'),
      'utf8',
    );
    const shape = 'w-4 h-4 text-[10px] flex items-center justify-center';
    expect(estimator).toContain(shape);
    expect(gridSrc).toContain(shape);
    expect(gridSrc).toContain("style={{ color: 'var(--color-dim)' }}");
    expect(gridSrc).toContain('title="Clear search"');
  });

  it('★★ it is reachable by assistive tech, not only by sight', () => {
    // ★ A `title` is not an accessible name for everyone; the glyph alone is
    //   an unlabelled button.
    expect(gridSrc).toContain('aria-label="Clear search"');
  });

  it('★★ the input reserves room for it instead of overlapping the text', () => {
    // ★ `pr-7` only while the button is there, so an empty box keeps its
    //   original padding and the toolbar does not reflow on the first
    //   keystroke — which a sibling button would have done.
    expect(gridSrc).toMatch(/search \? 'pl-3 pr-7' : 'px-3'/);
  });
});

// ---------------------------------------------------------------------------
// contrast helpers — WCAG 2.x relative luminance, the same arithmetic
// `index.css` uses for its own palette notes.
// ---------------------------------------------------------------------------

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
