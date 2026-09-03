import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import TabStrip from '../components/shared/TabStrip';

// ===========================================================================
// ★★★ fix-485 §B (P-137, the tab-strip half) — ONE TAB STRIP, EVERYWHERE
// ===========================================================================
//
// Bobby, 2026-09-02: *"My Board / My Tasks / Notifications doesn't have the
// same view as Draw Schedule / Seattle Intakes or Reports / Overview… we want
// to keep the consistency consistent."*
//
// ---------------------------------------------------------------------------
// ★★★ THE INVENTORY — every sibling-view strip in `src/`, and the family that
//     is NOT one
// ---------------------------------------------------------------------------
// SIBLING-VIEW STRIPS (which view of this page am I on) — all three converted:
//   pages/PersonalBoard   My Board · My Tasks · Notifications   route-driven
//   pages/DrawSchedule    Draw Schedule · Seattle Intakes       state-driven
//   pages/Reports         Overview · Trends · Team · Redesigns  state-driven
//
// FILTER CHIPS WEARING `role="tablist"` — role CORRECTED, not converted:
//   pages/Errors                 Active · Resolved · All
//   components/Reports/TeamTab   the role selector
//   pages/ReportsTeamDetail      the trend range
// Each chooses a FILTER over one view rather than one of several views, and
// none has a `tabpanel` — `role="tab"` was a promise to a screen reader the app
// did not keep. They are `role="group"` + `aria-pressed` now, with no pixel
// moved. This is fix-483's own inventory reasoning: a chip group and a strip
// are different controls, and forcing one into the other costs meaning.
//
// LEGITIMATE `aria-selected` THAT IS NOT A TAB — untouched:
//   components/MyTasks/TaskStatusChip and ProjectDetail/MentionTextarea use it
//   on listbox OPTIONS, which is what `aria-selected` is for.
//
// ★ The brief also named `Settings/AdminPermitsTab`, `pages/Agenda` and
//   `pages/CorrectionsReport`. None of the three contains a tab strip or a
//   `role="tablist"` — checked, and reported rather than quietly skipped.

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The "no second implementation" grep — the fix-484 §A3 technique
// ---------------------------------------------------------------------------
describe('fix-485 §B: there is exactly ONE tab strip', () => {
  it('★★★ no file but TabStrip.tsx renders `role="tablist"`', () => {
    // ★★ Matched as an ATTRIBUTE — a line that is only `role="tablist"` after
    //    its indent. Three of the files below discuss the attribute in prose
    //    (the notes explaining why a filter chip stopped claiming it), and a
    //    substring grep would count those. The fix-484 lesson, applied at the
    //    point it would have bitten.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.includes('__tests__')) continue;
      if (file.endsWith('TabStrip.tsx')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      if (lines.some((l) => /^\s*role="tablist"\s*$/.test(l))) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders, `these render their own tablist:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('★★★ …and no file but TabStrip.tsx renders `role="tab"` either', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.includes('__tests__')) continue;
      if (file.endsWith('TabStrip.tsx')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      if (lines.some((l) => /^\s*role="tab"\s*$/.test(l))) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★★★ the three sibling-view pages all import the shared strip', () => {
    for (const f of [
      'src/pages/PersonalBoard.tsx',
      'src/pages/DrawSchedule.tsx',
      'src/pages/Reports.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(src, f).toMatch(/from '[^']*shared\/TabStrip'/);
    }
  });

  it("★★ Draw Schedule's private `SubTab` is deleted", () => {
    // It was this page's copy of the Reports class string — identical character
    // for character, with none of its accessibility.
    const ds = readFileSync(resolve(process.cwd(), 'src/pages/DrawSchedule.tsx'), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    expect(ds).not.toContain('function SubTab');
    expect(ds).not.toContain('<SubTab');
  });
});

// ---------------------------------------------------------------------------
// The treatment it adopted, and that it is one treatment
// ---------------------------------------------------------------------------
describe('fix-485 §B: the Reports / Draw Schedule treatment, everywhere', () => {
  const tabs = [
    { id: 'a' as const, label: 'Alpha' },
    { id: 'b' as const, label: 'Beta' },
  ];

  it('★★★ it renders the underline treatment the two agreeing strips used', () => {
    // ★★★ WHICH ONE AND WHY: Reports and Draw Schedule already rendered the SAME
    //     class string character for character (Reports' own comment said
    //     "matches the DrawSchedule sub-tab styling"), and Bobby named the third
    //     — My Board — as the odd one out. Two of three agreeing and the
    //     complaint landing on the third is not a judgement call.
    render(<TabStrip tabs={tabs} active="a" ariaLabel="x" testIdPrefix="t" />);
    const active = screen.getByTestId('t-a');
    const inactive = screen.getByTestId('t-b');
    for (const c of ['px-[18px]', 'py-2.5', 'text-xs', 'font-bold', 'font-display', 'border-b-2', '-mb-px']) {
      expect(active.className, c).toContain(c);
      expect(inactive.className, c).toContain(c);
    }
    expect(active.className).toContain('text-de');
    expect(active.className).toContain('border-de');
    expect(inactive.className).toContain('text-muted');
    expect(inactive.className).toContain('border-transparent');
    // ★ My Board's old treatment is gone: no uppercase, no filled active tab.
    expect(active.className).not.toContain('uppercase');
  });

  it('★★★ every converted page renders IDENTICAL tab classes', () => {
    // ★★ The claim Bobby made — "we want to keep the consistency consistent" —
    //    asserted as one comparison rather than three copies of a class string.
    const { container } = render(
      <MemoryRouter>
        <>
          <TabStrip tabs={tabs} active="a" ariaLabel="x" testIdPrefix="state" />
          <TabStrip
            tabs={[
              { id: 'a' as const, label: 'Alpha', to: '/a' },
              { id: 'b' as const, label: 'Beta', to: '/b' },
            ]}
            active="a"
            ariaLabel="y"
            testIdPrefix="routed"
          />
        </>
      </MemoryRouter>,
    );
    expect(container).toBeTruthy();
    // ★★★ A ROUTED tab and a STATE tab are the same control wearing different
    //     elements — the class string must not diverge, which is the whole
    //     reason `to` is a prop rather than a second component.
    expect(screen.getByTestId('routed-a').className).toBe(
      screen.getByTestId('state-a').className,
    );
    expect(screen.getByTestId('routed-b').className).toBe(
      screen.getByTestId('state-b').className,
    );
    expect(screen.getByTestId('routed-a').tagName).toBe('A');
    expect(screen.getByTestId('state-a').tagName).toBe('BUTTON');
  });

  it('★★ a routed tab is a real link — middle-click and back still work', () => {
    render(
      <MemoryRouter>
        <TabStrip
          tabs={[{ id: 'a' as const, label: 'Alpha', to: '/board?tab=tasks' }]}
          active="a"
          ariaLabel="x"
          testIdPrefix="t"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('t-a').getAttribute('href')).toBe('/board?tab=tasks');
  });
});

// ---------------------------------------------------------------------------
// The contract it took from Reports
// ---------------------------------------------------------------------------
describe('fix-485 §B: the accessibility contract, on all of them', () => {
  const tabs = [
    { id: 'a' as const, label: 'Alpha' },
    { id: 'b' as const, label: 'Beta' },
    { id: 'c' as const, label: 'Gamma' },
  ];

  it('★★★ tablist / tab / aria-selected, and a ROVING tabIndex', () => {
    render(<TabStrip tabs={tabs} active="b" ariaLabel="Sections" testIdPrefix="t" />);
    const strip = screen.getByTestId('t-bar');
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe('Sections');
    const list = screen.getAllByRole('tab');
    expect(list).toHaveLength(3);
    // ★ Exactly one is selected, and it is the only one Tab can reach — so Tab
    //   enters the strip once and lands on where you ARE.
    expect(list.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByTestId('t-b').getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId('t-a').getAttribute('tabindex')).toBe('-1');
  });

  it('★★★ Arrow keys move, and they wrap', () => {
    const seen: string[] = [];
    render(
      <TabStrip
        tabs={tabs}
        active="a"
        onSelect={(id) => seen.push(id)}
        ariaLabel="x"
        testIdPrefix="t"
      />,
    );
    fireEvent.keyDown(screen.getByTestId('t-a'), { key: 'ArrowRight' });
    expect(seen).toEqual(['b']);
    // ★ Left from the first wraps to the last — the WAI-ARIA tabs pattern, and
    //   the half Draw Schedule's `SubTab` never had at all.
    fireEvent.keyDown(screen.getByTestId('t-a'), { key: 'ArrowLeft' });
    expect(seen).toEqual(['b', 'c']);
  });

  it('★★ Home and End jump to the ends', () => {
    const seen: string[] = [];
    render(
      <TabStrip
        tabs={tabs}
        active="b"
        onSelect={(id) => seen.push(id)}
        ariaLabel="x"
        testIdPrefix="t"
      />,
    );
    fireEvent.keyDown(screen.getByTestId('t-b'), { key: 'Home' });
    fireEvent.keyDown(screen.getByTestId('t-b'), { key: 'End' });
    expect(seen).toEqual(['a', 'c']);
  });

  it('★★ an unrelated key is left alone', () => {
    const seen: string[] = [];
    render(
      <TabStrip
        tabs={tabs}
        active="a"
        onSelect={(id) => seen.push(id)}
        ariaLabel="x"
        testIdPrefix="t"
      />,
    );
    fireEvent.keyDown(screen.getByTestId('t-a'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('t-a'), { key: 'a' });
    expect(seen).toEqual([]);
  });

  it('★★ a tab may carry a badge, and the badge is a SLOT', () => {
    // My Board's counts. `TabStrip` has no opinion about what a page counts —
    // fix-324's asymmetry ("0 open" is an answer, a "0" on a bell is not) stays
    // the page's decision.
    render(
      <TabStrip
        tabs={[{ id: 'a' as const, label: 'Alpha', right: <span data-testid="badge">7</span> }]}
        active="a"
        ariaLabel="x"
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('7');
    expect(screen.getByTestId('t-a').textContent).toContain('Alpha');
  });

  it('★ a page may name its own test ids, so no existing pin moved', () => {
    render(
      <TabStrip
        tabs={[{ id: 'a' as const, label: 'Alpha', testid: 'reports-tab-overview' }]}
        active="a"
        ariaLabel="x"
        testIdPrefix="reports-subtab"
      />,
    );
    expect(screen.getByTestId('reports-tab-overview')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The family that is NOT a tab strip
// ---------------------------------------------------------------------------
describe('fix-485 §B: the filter chips stopped claiming to be tabs', () => {
  const code = (p: string) =>
    readFileSync(resolve(process.cwd(), p), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

  it('★★★ all three are `role="group"` + `aria-pressed` now', () => {
    for (const f of [
      'src/pages/Errors.tsx',
      'src/components/Reports/TeamTab.tsx',
      'src/pages/ReportsTeamDetail.tsx',
    ]) {
      const src = code(f);
      expect(src, f).toContain('role="group"');
      expect(src, f).toContain('aria-pressed=');
      expect(src, f).not.toContain('aria-selected=');
    }
  });

  it('★★★ …and NOT converted to TabStrip — they are a different control', () => {
    // ★★ fix-483's inventory made the same call about the same family. A chip
    //    group selects a FILTER over one view; a strip selects one of several
    //    VIEWS. Consistency that erases that distinction is not consistency.
    for (const f of [
      'src/pages/Errors.tsx',
      'src/components/Reports/TeamTab.tsx',
      'src/pages/ReportsTeamDetail.tsx',
    ]) {
      // ★ `<TabStrip` — the RENDER, not the word. Each of the three carries a
      //   note naming `TabStrip` to say why it is not one, and a bare-word grep
      //   would forbid writing the reason down (the fix-484 §A3 trap, again).
      expect(code(f), f).not.toContain('<TabStrip');
      expect(code(f), f).not.toContain("from '../components/shared/TabStrip'");
      expect(code(f), f).not.toContain("from '../shared/TabStrip'");
    }
  });

  it('★★ the listbox options that legitimately use aria-selected are untouched', () => {
    // `aria-selected` on a listbox OPTION is correct usage and always was.
    for (const f of [
      'src/components/MyTasks/TaskStatusChip.tsx',
      'src/components/ProjectDetail/MentionTextarea.tsx',
    ]) {
      expect(code(f), f).toContain('aria-selected=');
    }
  });
});
