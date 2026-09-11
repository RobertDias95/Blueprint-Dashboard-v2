import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  HATCH_STRIPE_PX,
  RETIRED_PALETTE,
  excludeRetired,
  hatch,
  isRetiredProject,
  redesignedAwayProjectIds,
  retiredCause,
  retiredHatch,
} from '../lib/retiredState';
import { DS_PARK_PRESENTATION } from '../lib/drawScheduleStatus';

// ===========================================================================
// fix-524 — one hatch, two retired states (P-023 · P-220)
// ===========================================================================
//
// ★ Source assertions read the file with comments STRIPPED. Every "must not
//   appear" grep in this repo has at some point matched its own gravestone —
//   the comment explaining why the thing is absent. Seventh recording.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

const P = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  archived: false,
  redesign_of_project_id: null,
  ...over,
});

// ---------------------------------------------------------------------------
// §A — one predicate, one hatch
// ---------------------------------------------------------------------------

describe('fix-524 §A — the retired predicate is written once', () => {
  it('★★★ the direction is right: the ORIGINAL is retired, not the redesign', () => {
    // ★★★ EASY TO GET BACKWARDS, AND THE WHOLE SECTION DEPENDS ON IT. §B:
    //     *"the redesign itself: normal. No hatch, no badge, no 'this is a
    //     redesign' treatment."* The set is read off the CHILDREN's
    //     `redesign_of_project_id` and holds the PARENTS.
    const ids = redesignedAwayProjectIds([
      P('orig'),
      P('redesign', { redesign_of_project_id: 'orig' }),
    ]);
    expect(ids.has('orig')).toBe(true);
    expect(ids.has('redesign')).toBe(false);
  });

  it('★★ an ARCHIVED redesign does not retire its original', () => {
    // ★ If the successor has been filed away, the original is the live one
    //   again. Archived is false on all 220 today, so this is defensive — but
    //   the alternative is a project retired by a row nobody can see.
    const ids = redesignedAwayProjectIds([
      P('orig'),
      P('redesign', { redesign_of_project_id: 'orig', archived: true }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('★ a row naming itself does not retire itself forever', () => {
    expect(redesignedAwayProjectIds([P('a', { redesign_of_project_id: 'a' })]).size).toBe(0);
  });

  it('★★★ cancelled WINS when a project is somehow both', () => {
    // ★ 0 projects are in both on prod (measured 2026-09-11). The tie-break is
    //   written down so two surfaces cannot decide it differently later:
    //   cancelled is the stronger statement — a cancelled project is not coming
    //   back, a redesigned one has a successor doing its work.
    const sets = {
      cancelledIds: new Set(['x']),
      redesignedIds: new Set(['x']),
    };
    expect(retiredCause('x', sets)).toBe('cancelled');
  });

  it('an omitted set hides nothing — pre-fix-524 behaviour while holds load', () => {
    // ★ fix-264's rule, kept: a surface that has not loaded holds yet must not
    //   flicker 22 rows away and back.
    expect(isRetiredProject('x', undefined)).toBe(false);
    expect(isRetiredProject('x', {})).toBe(false);
    expect(retiredCause(null, { cancelledIds: new Set(['x']) })).toBeNull();
  });

  it('★★ excludeRetired returns the SAME array when nothing is retired', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(excludeRetired(rows, {})).toBe(rows);
    expect(excludeRetired(rows, { cancelledIds: new Set(['a']) })).toEqual([{ id: 'b' }]);
    // ★ Works on both shapes, exactly as fix-264's excludeCancelled does.
    expect(
      excludeRetired([{ project_id: 'a' }, { project_id: 'b' }], {
        redesignedIds: new Set(['b']),
      }),
    ).toEqual([{ project_id: 'a' }]);
  });

  it('★★★ every surface imports the predicate — asserted by SOURCE', () => {
    // ★★★ §A: *"Put that predicate in exactly one place and have every surface
    //     call it. Two writers of one rule is the defect this Brain has removed
    //     three times."* A behavioural test would pass against a second copy;
    //     this is what catches one being written.
    for (const f of [
      'src/components/DrawScheduleGrid.tsx',
      'src/pages/Dashboard.tsx',
      'src/components/LibraryMatrix.tsx',
      'src/pages/ProjectDetail.tsx',
    ]) {
      expect(code(read(f))).toContain("from '../lib/retiredState'");
    }
    // ★★ AND NOBODY RE-DERIVES IT. `redesign_of_project_id` is read in plenty
    //    of places for legitimate reasons (the wizard writes it, the badge
    //    names the original), but no SURFACE may build its own "is this
    //    retired" set beside the shared one.
    for (const f of [
      'src/pages/Dashboard.tsx',
      'src/components/LibraryMatrix.tsx',
    ]) {
      expect(code(read(f))).not.toContain('redesign_of_project_id ===');
    }
  });
});

describe('fix-524 §A — one hatch, two colours', () => {
  it('★★★ the two differ in NOTHING but their palette', () => {
    const grey = retiredHatch('cancelled');
    const purple = retiredHatch('redesigned');
    expect(purple).not.toBe(grey);
    const normalise = (css: string) => css.replace(/cancelled|redesigned/g, 'X');
    expect(normalise(purple)).toBe(normalise(grey));
  });

  it('★★★ built by ONE function, from ONE stripe width', () => {
    // ★ §A: *"If you find yourself writing the hatch twice, that is the ticket
    //   failing."* The recipe takes its colours as arguments; there is no
    //   second gradient literal to drift.
    expect(retiredHatch('cancelled')).toBe(hatch('var(--color-cancelled-a)', 'var(--color-cancelled-b)'));
    expect(retiredHatch('redesigned')).toBe(hatch('var(--color-redesigned-a)', 'var(--color-redesigned-b)'));
    expect(hatch('A', 'B')).toBe(
      `repeating-linear-gradient(45deg, A 0, A ${HATCH_STRIPE_PX}px, ` +
        `B ${HATCH_STRIPE_PX}px, B ${HATCH_STRIPE_PX * 2}px)`,
    );
  });

  it('★★★ index.css holds no gradient for either state any more', () => {
    // ★★ fix-263 put `--hatch-cancelled` in the stylesheet as a literal, and
    //    its reasoning was right for ONE state. A second literal beside it is
    //    the hatch written twice, and the second copy is where the stripe width
    //    drifts — so the recipe moved to TS, where it takes an argument, and
    //    only the COLOURS stayed.
    const css = read('src/index.css');
    expect(css).not.toContain('--hatch-cancelled');
    expect(css).not.toContain('--hatch-redesigned');
    // ★ The colour pairs are still there, still one definition each.
    for (const t of [
      '--color-cancelled-a',
      '--color-cancelled-b',
      '--color-redesigned-a',
      '--color-redesigned-b',
    ]) {
      expect(css.split(t).length - 1).toBeGreaterThanOrEqual(1);
    }
  });

  it('★★ no literal hex reaches the retired palette', () => {
    for (const p of Object.values(RETIRED_PALETTE)) {
      for (const v of [p.a, p.b, p.border, p.text]) {
        expect(v).toMatch(/^var\(--/);
      }
    }
  });

  it('★★ the purple is as readable as the grey — measured, not assumed', () => {
    // ★★★ fix-406's rule: darken the ink toward the text colour until it clears
    //     4.5:1 **on its own tint, measured** — never trust the raw token. Both
    //     retired states are read at the smallest row height the grid produces,
    //     so both are measured against the LIGHTER of their two stripes, which
    //     is the worst case for dark ink.
    const css = read('src/index.css');
    const tok = (name: string) => {
      const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
      expect(m).toBeTruthy();
      return m![1];
    };
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    for (const state of ['cancelled', 'redesigned']) {
      const light = ratio(tok(`--color-${state}-a`), tok(`--color-${state}-text`));
      const dark = ratio(tok(`--color-${state}-b`), tok(`--color-${state}-text`));
      expect(Math.min(light, dark)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ---------------------------------------------------------------------------
// §B — where a retired project appears. EIGHT assertions: four surfaces × two
//      causes, and every one of them written out.
// ---------------------------------------------------------------------------
//
// ★★★ §B: *"A one-sided guard tested one-sidedly is exactly how P-239
//     shipped."* fix-523 paid for that a week ago — a guard naming `external`
//     could only ever ask about `external`, and 74 of 167 projects were wrong
//     because the other direction was never asserted. So both causes are
//     written out for every surface, including the one where the answer is
//     currently NO.

describe('fix-524 §B — the four surfaces, both causes', () => {
  const dash = code(read('src/pages/Dashboard.tsx'));
  const lib = code(read('src/components/LibraryMatrix.tsx'));
  const grid = code(read('src/components/DrawScheduleGrid.tsx'));
  const detail = code(read('src/pages/ProjectDetail.tsx'));

  // ── 1 & 2 · PIPELINE — hidden, both causes ────────────────────────────
  it('★★★ 1 · Pipeline hides a CANCELLED project', () => {
    expect(dash).toContain('isRetiredProject(project.id, retiredSets)');
    expect(dash).toContain('cancelledIds');
  });

  it('★★★ 2 · Pipeline hides a REDESIGNED-AWAY project', () => {
    expect(dash).toContain('redesignedAwayProjectIds(projectsQ.data)');
    // ★ One filter, both causes — not a second `continue` beside the first.
    expect(dash.match(/isRetiredProject\(project\.id/g) ?? []).toHaveLength(1);
    expect(dash).not.toContain('isCancelledProject(project.id');
  });

  // ── 3 & 4 · LIBRARY — cancelled hidden; the redesign half is REPORTED ──
  it('★★★ 3 · Library hides a CANCELLED project', () => {
    expect(lib).toContain('excludeRetired(projects, { cancelledIds })');
    expect(lib).toContain('cancelledProjectIds(holdsQ.data)');
  });

  it('★★★ 4 · Library STILL SHOWS a redesigned-away original — reported, not shipped', () => {
    // ⚠️⚠️ THE ONE DEVIATION IN THIS TICKET, AND IT IS WRITTEN OUT RATHER THAN
    //      OMITTED. §0.3 gates the Library hide on §C mirroring the plan of
    //      record first. §C ships — and it does not unblock this, because
    //      **the Library does not render plan-of-record sets at all.** It
    //      renders `projects.unit_types`.
    //
    // ★★★ MEASURED 2026-09-11 over the 17 redesign pairs:
    //       original has unit data, redesign has none   11
    //       both have unit data                          4
    //       neither                                      2
    //       redesign has it and the original does not    0
    //     So hiding the originals empties **11 projects** out of the unit
    //     matrix, and mirroring drawings onto a card puts back exactly none of
    //     them. The two halves are different columns on different surfaces.
    //
    // ★★ AND THE OBVIOUS PATCH IS WORSE: the Library's unit table is an EDITOR
    //    (fix-206), so a read-through unit row on a redesign would be an
    //    editable control writing to the ORIGINAL — which §D has just declared
    //    frozen. This assertion is the record of that, and it flips the day
    //    Bobby rules on it.
    expect(lib).not.toContain('redesignedAwayProjectIds');
    expect(lib).toContain('excludeRetired(projects, { cancelledIds })');
  });

  // ── 5 & 6 · DRAW SCHEDULE — stays, hatched, both causes ───────────────
  it('★★★ 5 · a CANCELLED project keeps its block, hatched grey', () => {
    expect(DS_PARK_PRESENTATION.cancelled.background).toBe(retiredHatch('cancelled'));
    // ★ It is NOT filtered out of the board — only out of the list of things
    //   waiting to be placed.
    expect(grid).not.toContain('excludeRetired(draw');
  });

  it('★★★ 6 · a REDESIGNED-AWAY project keeps its block, hatched purple', () => {
    expect(DS_PARK_PRESENTATION.redesigned.background).toBe(retiredHatch('redesigned'));
    expect(grid).toContain("retired === 'redesigned'");
    expect(grid).toContain('block-redesigned-');
    // ★★★ The Draw Schedule is the ONE surface that keeps a retired project,
    //     and the reason is capacity: a cancelled or superseded block still
    //     consumed a designer's weeks.
    expect(grid).toContain('retiredCause(row.project_id, retiredSets)');
  });

  // ── 7 & 8 · THE REDESIGN ITSELF — normal, under both causes ───────────
  it('★★★ 7 · the redesign itself gets NO retired treatment', () => {
    // ★ It is the current work. §B is explicit: *"No hatch, no badge, no 'this
    //   is a redesign' treatment."* The only thing it carries is fix-126's
    //   "↗ Redesign of X" link, which is navigation, not a state.
    const ids = redesignedAwayProjectIds([
      P('orig'),
      P('rd', { redesign_of_project_id: 'orig' }),
    ]);
    expect(isRetiredProject('rd', { redesignedIds: ids })).toBe(false);
    expect(isRetiredProject('orig', { redesignedIds: ids })).toBe(true);
  });

  it('★★★ 8 · a redesign of a CANCELLED project is still normal', () => {
    // ★ The two causes do not propagate down the lineage. Cancelling a project
    //   says nothing about the one that replaced it.
    const sets = {
      cancelledIds: new Set(['orig']),
      redesignedIds: redesignedAwayProjectIds([
        P('orig'),
        P('rd', { redesign_of_project_id: 'orig' }),
      ]),
    };
    expect(retiredCause('rd', sets)).toBeNull();
    expect(retiredCause('orig', sets)).toBe('cancelled');
  });

  it('★★★ the Library SAYS its total dropped', () => {
    // ★★ §B: *"A number that changes because a filter changed, with nothing
    //    saying so, is a bug report waiting to happen."* fix-447 §B5 made
    //    exactly this argument about the unit view's project count; this is the
    //    same rule applied to a filter the reader did not set. 5 of 220 today.
    expect(lib).toContain('library-retired-hidden');
    expect(lib).toContain('cancelled hidden');
  });

  it('★★ the unscheduled lane drops retired projects too', () => {
    // ★ fix-262's argument for dropping a cancelled project from a list of
    //   things to go schedule is equally true of one already superseded.
    expect(grid).toContain('!isRetiredProject(project.id, retiredSets)');
  });

  it('★★ ProjectDetail keeps a retired project reachable — history matters', () => {
    // ★★★ The principle in Bobby's shape: *a retired project appears where
    //     history matters and disappears where current work is chosen.* There
    //     is no route guard and there must not be — every badge, block and
    //     report row links here.
    expect(detail).not.toContain('Navigate to="/projects"');
  });
});

// ---------------------------------------------------------------------------
// §C — the plan of record reads through
// ---------------------------------------------------------------------------

describe('fix-524 §C — a redesign shows its original’s set, and says so', () => {
  const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));

  it('★★★ read-through, not a copy — nothing writes a row', () => {
    // ★★★ THE RULING, AND WHY. Bobby's freeze is about the ORIGINAL being a
    //     snapshot, not about the redesign owning bytes. The files live under
    //     the original's prefix and the indexer keeps writing them there, so a
    //     "copy" would be a second row pointing at the first one's objects —
    //     stale the next time the folder changes. Read-through survives a
    //     re-index and is self-healing.
    expect(card).toContain('usePlanOfRecord(wantsFallback ? originalId! : undefined)');
    expect(card).not.toContain('.insert(');
    expect(card).not.toContain('.upsert(');
    // ★ And the indexer is untouched: this repo cannot write that table at all.
    expect(card).not.toContain('project_file_index');
  });

  it('★★★ it NAMES whose drawings they are', () => {
    // ★★ Without this the card asserts the drawings are this project's — the
    //    exact class of silent claim fix-358 spent a ticket removing from here.
    expect(card).toContain('plan-of-record-borrowed');
    expect(card).toContain('borrowedFromAddress');
    // ★ Asserted on a contiguous fragment: JSX wraps the sentence across lines.
    expect(card).toContain('has no set of its own yet');
  });

  it('★★★ the fallback waits for the project’s OWN answer', () => {
    // ★ Firing on the loading frame would flash the original's drawing and then
    //   replace it — a card that tells you two different things in 200ms.
    expect(card).toContain('!q.isLoading && !q.data && !!originalId');
  });

  it('★★ everything downstream keys off the SOURCE project', () => {
    // ★ The sets, the verdict and fix-523's share all read `sourceProjectId`,
    //   so a borrowed card shares the ORIGINAL's set rather than minting a link
    //   to a project with no drawings — `bp_create_plan_share` would raise
    //   P0002 for that.
    expect(card).toContain('usePlanOfRecordSets(sourceProjectId)');
    expect(card).toContain('usePlanOfRecordVerdict(sourceProjectId)');
  });

  it('★★ a project with its OWN set never borrows', () => {
    expect(card).toContain('const row = q.data ?? borrowed;');
    expect(card).toContain('const sourceProjectId = borrowed ? originalId! : projectId;');
  });
});

// ---------------------------------------------------------------------------
// §D — the switch, and the freeze
// ---------------------------------------------------------------------------

describe('fix-524 §D — the original is frozen, and points at the current one', () => {
  const detail = code(read('src/pages/ProjectDetail.tsx'));

  it('★★★ the switch runs BOTH ways now', () => {
    // ★ fix-126 shipped half of it: a redesign has carried "↗ Redesign of X"
    //   since then. The original carried nothing, so you could walk from the
    //   current work to the snapshot and not back — the wrong way round if the
    //   current one is the primary focus.
    expect(detail).toContain('pd-redesign-of-badge');
    expect(detail).toContain('pd-superseded-badge');
    expect(detail).toContain('Superseded by');
  });

  it('★★★ NO edit surface is reachable on a frozen original', () => {
    // ★★★ *"If an edit surface is still reachable on it, the freeze is
    //     decorative."* fix-331 §4 consolidated every project-level edit onto
    //     one button — Reassign DA and Delete live inside the modal it opens —
    //     and fix-517 §E added two more doors to the same modal: the permits
    //     table's hover ✎ and `?data=` as a deep link.
    //
    // ★★★ SO THE GATE IS ON THE READ, NOT ON THE BUTTON. Hiding the ⚙ would
    //     leave the other two open, including one somebody can bookmark.
    expect(detail).toContain('const dataOpen = supersededBy ? null : dataOpenState;');
    expect(detail).toContain('project-frozen-note');
  });

  it('★★ it says what is true rather than offering a disabled control', () => {
    // ★ A disabled ⚙ says *"you may not do this"*, which invites somebody to go
    //   looking for permission. fix-523 §B2's ruling generalised: do not render
    //   an affordance that cannot work.
    expect(detail).toContain('Snapshot — read only');
    expect(detail).not.toContain('<button\n          onClick={onSettings}\n          disabled');
  });

  it('★★★ there is NO side-by-side comparison view, and none is coming', () => {
    // ★★★ §D retires [[P-073]] ask 2 rather than answering it. That ask was
    //     *"how do we show both at once"* and produced three shapes and an
    //     unresolvable asymmetry — milestones compare, units supersede, team
    //     undecided. Bobby's answer dissolves it: **you do not show both.**
    expect(detail).not.toMatch(/compare|side-by-side|sideBySide/i);
  });

  it('★★ the PERMITS are deliberately NOT frozen, and the reason is measured', () => {
    // ⚠️ **12 of 17 redesigns REUSE the original's permits** (measured
    //    2026-09-11: 12 true · 3 false · 2 null). Those permit rows are LIVE
    //    work being done under the original's project. Freezing them would
    //    break the majority case — the freeze is about the project's own data,
    //    which is what the Project Details modal edits.
    // ★ The permit view is reached by selecting a permit, which is untouched.
    expect(detail).toContain('setSelectedPermitId');
    expect(detail).not.toContain('supersededBy ? null : selectedPermitId');
  });
});

// ---------------------------------------------------------------------------
// §0.4 — null is a third live state
// ---------------------------------------------------------------------------

describe('fix-524 §0.4 — reuse-of-original-permit has THREE states', () => {
  // ★★★ 12 true · 3 false · **2 null** (measured 2026-09-11). §0 warns that
  //     null must not render as No, and it *"has bitten this codebase before"*.
  //
  // ★★★ NOTHING NEEDED CHANGING — every render site already handles it, and
  //     this suite is what keeps that true. Reported rather than silently
  //     "fixed", because a diff that changes nothing is not a finding.
  it('★★★ every render site distinguishes null from false', () => {
    const detail = code(read('src/pages/ProjectDetail.tsx'));
    // `reuseNote` / `redesignEmptyLine`: an explicit `== null` branch.
    expect(detail).toContain("if (reuses == null) return 'Reuse of parent permits not answered';");
    expect(detail).toContain("if (reuses == null) return 'No permits yet.';");

    for (const [f, marker] of [
      ['src/components/ProjectDetail/ProjectDetailsModal.tsx', '=== false'],
      ['src/components/Reports/RedesignsTab.tsx', '=== false'],
    ] as const) {
      const src = code(read(f));
      // ★ A `=== true ? … : === false ? … : …` chain is the shape that CANNOT
      //   fold null into No. A bare truthiness test is the one that can.
      expect(src).toContain('=== true');
      expect(src).toContain(marker);
    }
  });

  it('★★ the empty line is keyed off the PERMIT COUNT, not the flag', () => {
    // ★ Those two happen to select the same 12 rows on prod today — and that
    //   coincidence is not a rule. A redesign whose reuse question is
    //   unanswered and whose permits have not been created yet is a real state.
    const detail = code(read('src/pages/ProjectDetail.tsx'));
    expect(detail).toContain('function redesignEmptyLine(');
  });
});
