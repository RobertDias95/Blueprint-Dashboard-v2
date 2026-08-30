import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HoldFilter from '../components/shared/HoldFilter';
import { HOLD_FILTER_DEFAULT, passesHoldFilter } from '../lib/holdFilter';
import { STAGE_LABEL } from '../lib/stageLabel';

// ===========================================================================
// ★★★ fix-451 PART ONE (P-099/P-100/P-101) — THE FILTER ROWS LOSE THEIR
//     BUTTON ROWS
// ===========================================================================
//
// Bobby, 2026-08-30: *"can we merge all and holds too into a drop down,
// declutter this view"* and *"4 buttons floating that all are categorically
// the same"*.
//
// ★★★ THE RULE THE WHOLE PART TURNS ON: a control that picks one of a list of
// PEERS is a dropdown; a control that flips ONE state stays a button. Holds
// (3 peers) and Stage (5 peers) became dropdowns. My Work/Everyone, Active
// only, BOT, Show held work, Co-assigned and Clear each flip one state and are
// all still buttons.

describe('fix-451 §C: Holds is one dropdown', () => {
  it('★★★ it is a SELECT, and the three modes are its options', () => {
    const onChange = vi.fn();
    render(<HoldFilter mode="all" onChange={onChange} testid="hf" />);
    const el = screen.getByTestId('hf') as HTMLSelectElement;
    expect(el.tagName).toBe('SELECT');
    expect(Array.from(el.options).map((o) => o.value)).toEqual([
      'all',
      'only',
      'exclude',
    ]);
    // ★ The per-mode ids the three buttons carried ride on the options, so a
    //   suite reaching for them still resolves an element.
    for (const m of ['all', 'only', 'exclude']) {
      expect(screen.getByTestId(`hf-${m}`), m).toBeInTheDocument();
    }
  });

  it('★★ choosing a mode reports it unchanged', () => {
    const onChange = vi.fn();
    render(<HoldFilter mode="all" onChange={onChange} testid="hf" />);
    fireEvent.change(screen.getByTestId('hf'), { target: { value: 'only' } });
    expect(onChange).toHaveBeenCalledWith('only');
  });

  it('★★★ §C4: a non-default state is visible WITHOUT opening the control', () => {
    // ★★★ This is the cost a dropdown charges that three chips did not — the
    //     choice leaves the screen. It is paid twice: the closed control reads
    //     the mode as its own label, and it carries the active tint.
    const { rerender } = render(
      <HoldFilter mode="all" onChange={vi.fn()} testid="hf" />,
    );
    const closed = screen.getByTestId('hf') as HTMLSelectElement;
    expect(closed.value).toBe('all');
    const plain = closed.style.background;

    rerender(<HoldFilter mode="exclude" onChange={vi.fn()} testid="hf" />);
    const active = screen.getByTestId('hf') as HTMLSelectElement;
    expect(active.value).toBe('exclude');
    expect(
      (active.selectedOptions[0] as HTMLOptionElement).textContent,
    ).toBe('Exclude holds');
    // ★ …and it does not look like the unfiltered state.
    expect(active.style.background).not.toBe(plain);
  });

  it('★★★ the PREDICATE is untouched — this was presentation only', () => {
    // lib/holdFilter is pinned by holdFilter.test.ts; asserted here too so a
    // future "tidy-up" of the control cannot quietly take the rule with it.
    expect(HOLD_FILTER_DEFAULT).toBe('all');
    expect(passesHoldFilter(true, 'all')).toBe(true);
    expect(passesHoldFilter(true, 'only')).toBe(true);
    expect(passesHoldFilter(false, 'only')).toBe(false);
    expect(passesHoldFilter(true, 'exclude')).toBe(false);
    expect(passesHoldFilter(false, 'exclude')).toBe(true);
  });
});

describe('fix-451 §D: Stage is one dropdown, still multi-select', () => {
  it('★★★ §D2: the options render through STAGE_LABEL, in QUICK_STAGES order', () => {
    // ★ Not a second stage→label map: fix-104 centralised it, and §D2 says so
    //   explicitly. `QUICK_STAGES` stays LOCAL to ProjectList — exporting a
    //   const from a page trips react-refresh/only-export-components, which is
    //   an error in this repo — so the order is asserted off the source and the
    //   words off the shared map.
    const src = readProjectList();
    expect(src).toContain("const QUICK_STAGES: Stage[] = ['de', 'pm', 'co', 'ap', 'is'];");
    expect(src).toContain('labelOf={(v) => STAGE_LABEL[v as Stage]}');
    expect((['de', 'pm', 'co', 'ap', 'is'] as const).map((s) => STAGE_LABEL[s])).toEqual([
      'D&E',
      'Permitting',
      'Corrections',
      'Approved',
      'Issued',
    ]);
  });

  it('★★★ §D3: the word is "Stage" and never "Status"', () => {
    // A permit already carries a free-text Status/notes field. Two controls one
    // click apart sharing a word is how somebody filters the wrong thing.
    const src = readProjectList();
    expect(src).toContain('label="Stage"');
    expect(src).not.toMatch(/label="(Project )?Status"/);
  });

  it('★★ §D1: it is the SAME MultiSelect its Ent/DA/Juris neighbours use', () => {
    const src = readProjectList();
    // One component, four call sites — the chips were the odd one out.
    const uses = src.match(/<MultiSelect/g) ?? [];
    expect(uses.length).toBe(4);
    expect(src).not.toContain('project-view-stage-chip-${s}');
  });
});

function readProjectList(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), 'src/pages/ProjectList.tsx'), 'utf8');
}
