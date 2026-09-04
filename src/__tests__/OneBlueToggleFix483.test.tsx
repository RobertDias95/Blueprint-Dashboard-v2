import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ScopeToggle from '../components/shared/ScopeToggle';
import TwoStateToggle, { ToggleChip } from '../components/shared/TwoStateToggle';
import { chipStyle } from '../lib/chipStyle';
import {
  RIBBON_ENTRIES,
  SHAREPOINT_URL,
  allRibbonExternals,
  allRibbonRoutes,
  activeRibbonTarget,
  isRibbonEntryActive,
  visibleChildren,
  visibleEntries,
} from '../lib/ribbonNav';

// ===========================================================================
// ★★★ fix-483 §B (P-137) + §C (P-138)
// ===========================================================================
//
// §B  Bobby: *"on pipeline it's like a blue highlight. We want that toggle
//     feature to be consistent whether we're on agenda or the library."*
// §C  Agenda moves under Reports, and SharePoint is renamed `D&E Studio`.

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The file with `//` line comments stripped: what actually runs. The
 *  fix-411 trap, sixth time — a `.toContain` that a header comment satisfies
 *  passes on a file whose CODE no longer does the thing. */
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');

// ---------------------------------------------------------------------------
// §B1 — the inventory, asserted rather than described
// ---------------------------------------------------------------------------
describe('fix-483 §B: one toggle, and the inventory is closed', () => {
  it('★★★ every two-state view switch in src/ renders the SHARED control', () => {
    // ★★★ THE BLANKET ASSERTION. The brief asks for an enumeration; an
    //     enumeration in a PR body rots, so it is written down as a rule the
    //     next one has to satisfy: the four surfaces that carry a two-state
    //     view switch all import `TwoStateToggle` (or its chip), and none of
    //     them draws a second pair of pills.
    //
    // ★ What was DELIBERATELY LEFT and why — the other half of the inventory:
    //     BoardLensControl        MULTI-state (group + N associates)
    //     WhatsNew kind filter    MULTI-state (N kinds)
    //     MyBoard queue scope     THREE-state (mine / team / a person select)
    //     HoldFilter              a single on/off chip, not a pair
    //     ProjectList activeOnly  a single on/off chip, not a pair
    //     MyTasks priority/quick  single chips and an N-role group
    //     PermitDetailV2 buckets  an N-bucket stage bar, stage-coloured
    //   Each is a different control answering a different question; forcing
    //   them into a two-half toggle would be a worse fit, not a consistency.
    // ★★ fix-499 §D removed one from this list: MyTasks' Mine / Waiting On
    //    switcher. Waiting On is its own report now, so the page has no view to
    //    switch between — the control was deleted, not un-shared. Its scope
    //    toggle (a different control) still comes from ScopeToggle.
    for (const f of [
      'src/components/shared/ScopeToggle.tsx',
      'src/components/WeeklyUpdate/AgendaBlock.tsx',
      'src/components/LibraryMatrix.tsx',
    ]) {
      expect(code(src(f)), f).toMatch(/from '[^']*TwoStateToggle'/);
    }
  });

  it('★★★ the Library and the Agenda render the PIPELINE\'s pill, byte for byte', () => {
    // ★★ Rendered and compared, not read off a class string. `chipStyle` is the
    //    one place either colour is decided, so this is the claim end to end:
    //    the same component, the same classes, the same computed style.
    render(
      <ScopeToggle mode="mine" onChange={() => {}} name="Bobby" testid="pipeline" />,
    );
    render(
      <ToggleChip active onClick={() => {}} testid="library" surface="surface">
        Site
      </ToggleChip>,
    );
    render(
      <TwoStateToggle
        value="open"
        onChange={() => {}}
        testid="agenda"
        ariaLabel="x"
        surface="surface"
        options={[
          { value: 'open', label: 'Open', testid: 'agenda-open' },
          { value: 'closed', label: 'Closed', testid: 'agenda-closed' },
        ]}
      />,
    );

    const pipeline = screen.getByTestId('pipeline-mine');
    for (const id of ['library', 'agenda-open']) {
      const el = screen.getByTestId(id);
      expect(el.tagName, id).toBe(pipeline.tagName);
      expect(el.className, id).toBe(pipeline.className);
      expect(el.style.background, id).toBe(pipeline.style.background);
      expect(el.style.borderColor, id).toBe(pipeline.style.borderColor);
      expect(el.style.color, id).toBe(pipeline.style.color);
      expect(el.getAttribute('aria-pressed'), id).toBe('true');
    }
  });

  it('★★★ …and the INACTIVE half matches too, which is the half that drifted', () => {
    render(
      <ScopeToggle mode="mine" onChange={() => {}} name="Bobby" testid="pipeline" />,
    );
    render(
      <ToggleChip active={false} onClick={() => {}} testid="library" surface="surface">
        Unit
      </ToggleChip>,
    );
    const inactive = screen.getByTestId('pipeline-all');
    const lib = screen.getByTestId('library');
    expect(lib.className).toBe(inactive.className);
    expect(lib.style.background).toBe(inactive.style.background);
    expect(lib.style.color).toBe(inactive.style.color);
  });

  it('★★ the two states really are different — or the test above is vacuous', () => {
    expect(chipStyle(true, 'surface').background).not.toBe(
      chipStyle(false, 'surface').background,
    );
    expect(chipStyle(true, 'surface').background).toBe('var(--color-de)');
  });

  it('★★★ ScopeToggle is BYTE-IDENTICAL on the Pipeline — asserted against a copy', () => {
    // ★★★ Against a HAND-BUILT COPY of what the file rendered before fix-483,
    //     not against itself: a refactor that changed both the component and
    //     the expectation would otherwise pass. Same technique fix-441 §D used
    //     when it unified the four chipStyles.
    function before(mode: 'mine' | 'all', name: string) {
      return (
        <div
          className="inline-flex items-center gap-1"
          data-testid="was"
          role="group"
          aria-label="Scope work to me or everyone"
        >
          <button
            type="button"
            className="text-[11px] px-3 py-1 rounded border font-bold"
            style={chipStyle(mode === 'mine', 'surface')}
            data-testid="was-mine"
            aria-pressed={mode === 'mine'}
            title={`Show only ${name}'s work`}
          >
            My Work
          </button>
          <button
            type="button"
            className="text-[11px] px-3 py-1 rounded border font-bold"
            style={chipStyle(mode === 'all', 'surface')}
            data-testid="was-all"
            aria-pressed={mode === 'all'}
          >
            Everyone
          </button>
        </div>
      );
    }
    for (const mode of ['mine', 'all'] as const) {
      const now = render(
        <ScopeToggle mode={mode} onChange={() => {}} name="Bobby" testid="now" />,
      );
      const was = render(before(mode, 'Bobby'));
      const norm = (html: string) => html.replace(/data-testid="(was|now)/g, 'data-testid="x');
      expect(norm(screen.getByTestId('now').outerHTML)).toBe(
        norm(screen.getByTestId('was').outerHTML),
      );
      now.unmount();
      was.unmount();
    }
  });

  it('★★ ScopeToggle still renders NOTHING for an unmapped login', () => {
    // ★ A SCOPE rule, not a toggle rule: there is nothing to scope to for a
    //   login the roster does not know. It must not have been lost in the move.
    const { container } = render(
      <ScopeToggle mode="mine" onChange={() => {}} name={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('★★ the Agenda tabs keep their COUNTS on the label', () => {
    // ★ The reason `TwoStateToggle` takes a ReactNode label rather than a
    //   string: "Open · 4" is the whole reason the reader never has to switch
    //   to find out whether the other list is worth switching to.
    const agenda = code(src('src/components/WeeklyUpdate/AgendaBlock.tsx'));
    expect(agenda).toContain('agenda-tab-open-count');
    expect(agenda).toContain('agenda-tab-closed-count');
    expect(agenda).toContain("testid: 'agenda-tab-open'");
    expect(agenda).toContain("testid: 'agenda-tab-closed'");
    // ★ …and the old `--color-s3` tab strip is gone, not merely recoloured.
    expect(agenda).not.toContain("background: 'var(--color-s3)'");
  });
});

// ---------------------------------------------------------------------------
// §C — Agenda under Reports, and D&E Studio
// ---------------------------------------------------------------------------
describe('fix-483 §C: Agenda is a child of Reports', () => {
  const reports = () => {
    const e = RIBBON_ENTRIES.find((x) => x.kind === 'group' && x.group.id === 'reports');
    return e!.kind === 'group' ? e!.group : null!;
  };

  it('★★★ the order is Overview · Project View · Agenda · Saved reports', () => {
    expect(reports().children.map((c) => c.label)).toEqual([
      'Overview',
      'Project View',
      'Agenda',
      'Saved reports',
    ]);
  });

  it('★★★ it is no longer a TOP-LEVEL entry — it lives in exactly one place', () => {
    const top = RIBBON_ENTRIES.filter(
      (e) => e.kind === 'link' && e.link.to === '/agenda',
    );
    expect(top).toEqual([]);
  });

  it('★★★ the ROUTE is unchanged, and the coverage guard still walks it', () => {
    // ★ A gate is not a hiding place: `allRibbonRoutes()` walks group children
    //   too, so /agenda is still checked against the real route table.
    expect(allRibbonRoutes()).toContain('/agenda');
  });

  it('★★★ a non-admin NON-MEMBER does not see it — the gate followed the entry', () => {
    // ★★★ THE BUG THIS MOVE COULD HAVE SHIPPED. `visibleChildren` filtered on
    //     `adminOnly` alone; an `agendaOnly` child would have been visible to
    //     all 23 non-admin editors. A gate enforced by only one code path stops
    //     being enforced the moment an entry takes the other path.
    const kidsFor = (isAdmin: boolean, isMember: boolean) => {
      const g = visibleEntries(isAdmin, isMember).find(
        (e) => e.kind === 'group' && e.group.id === 'reports',
      );
      return g && g.kind === 'group' ? g.group.children.map((c) => c.to) : [];
    };
    expect(kidsFor(false, false)).toEqual(['/projects']);
    expect(kidsFor(false, true)).toEqual(['/projects', '/agenda']);
    expect(kidsFor(true, false)).toEqual([
      '/reports',
      '/projects',
      '/agenda',
      '/reports/saved',
    ]);
  });

  it('★★ `visibleChildren` defaults `isAgendaMember` to false, like fix-462 did', () => {
    // Every pre-existing call site keeps compiling AND keeps answering exactly
    // what it answered before — a non-member never saw Agenda.
    expect(visibleChildren(reports(), false)).toEqual(
      visibleChildren(reports(), false, false),
    );
    expect(visibleChildren(reports(), false).map((c) => c.to)).toEqual(['/projects']);
  });

  it('★★ it carries BOTH gates, and `adminOnly: false` is not the same as absent', () => {
    const agenda = reports().children.find((c) => c.to === '/agenda')!;
    expect(agenda.agendaOnly).toBe(true);
    // ★ `undefined` would INHERIT the group's admin gate, taking the screen
    //   from the six non-admin members. fix-331 §8's undefined-vs-false
    //   distinction, doing real work.
    expect(agenda.adminOnly).toBe(false);
    expect(reports().adminOnly).toBe(true);
  });

  it('★★ /agenda still lights exactly ONE entry (fix-335 §5 specificity)', () => {
    expect(activeRibbonTarget('/agenda')).toBe('/agenda');
    expect(isRibbonEntryActive('/agenda', '/agenda')).toBe(true);
    expect(isRibbonEntryActive('/reports', '/agenda', true)).toBe(false);
  });
});

describe('fix-483 §C: SharePoint is called D&E Studio', () => {
  const sp = () => allRibbonExternals().find((e) => e.id === 'sharepoint')!;

  it('★★★ the LABEL changed and nothing else did', () => {
    expect(sp().label).toBe('D&E Studio');
    // ★ The href, the glyph and the id are untouched — the id is the test-id
    //   stem, so renaming it would move every selector for a label change.
    expect(sp().href).toBe(SHAREPOINT_URL);
    expect(sp().id).toBe('sharepoint');
    expect(sp().icon).toBe('▧');
  });

  it('★★ it is still ungated, and still an EXTERNAL kind', () => {
    // fix-335 §4: externals fall through `visibleEntries` ungated, and the type
    // keeps them out of the route-coverage guard. Both survive a rename.
    const forEditor = visibleEntries(false).filter((e) => e.kind === 'external');
    expect(forEditor.map((e) => e.external.label)).toContain('D&E Studio');
    expect(allRibbonRoutes()).not.toContain(SHAREPOINT_URL);
    expect(activeRibbonTarget(SHAREPOINT_URL)).toBeNull();
  });

  it('★★ the word SharePoint is gone from the ribbon a person reads', () => {
    // ★ …but not from the hint, which names the site it opens, nor from the id
    //   or the URL constant. The rename is what the RIBBON says.
    expect(
      allRibbonExternals().map((e) => e.label).join(' '),
    ).not.toContain('SharePoint');
  });
});
