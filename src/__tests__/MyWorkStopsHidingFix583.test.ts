import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildProjectLeadIndex,
  deriveSelfScope,
  permitMatchesSelf,
  projectIsMine,
  projectMatchesSelf,
  widenScopeWhenUnassigned,
} from '../lib/selfScope';
import type { Permit, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-583 (P-287) — MY WORK STOPS HIDING YOUR WORK
// ===========================================================================
//
// Bobby: *"derry is saying this project is not on his project list, but he is
// the DM and the schematic — huge problem… we already caught this with briana
// and 2443 redesign."*
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED ON PROD 2026-09-16 — "My Work" vs what it should show
// ---------------------------------------------------------------------------
//
//   person    sees today   hidden   of which schematic
//   Dave           0         69            69      ← saw NOTHING
//   Ana            0         15            15      ← saw NOTHING
//   Derry         44         10             5
//   Lindsay       64          7             3
//   Brittani      90          5             0
//   Jade          18          1             0
//   Miles        126          1             0
//   Briana        95          1             0
//
// **109 pairs across 8 people. 92 involve `schematic_designer` (cause A); the
// other 17 are the if/else (cause B).** The brief measured 105/8 a few hours
// earlier — Dave 65→69 and Ana 14→15 since.
//
// ★★★ AND `4137 54th Ave SW` IS HIDDEN FROM DERRY BY BOTH CAUSES AT ONCE:
//     `entitlement_lead = Briana`, `design_manager = Jade`,
//     `schematic_designer = ['Derry']`, Building Permit `dm = Derry`. The
//     predicate read neither field that names him. That exact pair is asserted
//     below by name, because it is the report.
//
// ---------------------------------------------------------------------------
// ★★★ WHY NOBODY REPORTED IT FOR A YEAR
// ---------------------------------------------------------------------------
//
// `deriveSelfScope` decides the TIER using the same narrow predicate. Dave has
// 65 schematic assignments and 0 permits, so it saw nothing, filed him
// permit-scope-with-no-permits, and **fix-428 then widened his default to
// Everyone** — so his empty My Work never showed. The hole hid itself.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

type P = Parameters<typeof projectMatchesSelf>[0] & { id?: string };

function proj(over: Partial<Project> = {}): P {
  return {
    entitlement_lead: null,
    design_manager: null,
    schematic_designer: null,
    construction_admin: null,
    redesign_of_project_id: null,
    ...over,
  } as P;
}
function permit(over: Partial<Permit> = {}): Pick<
  Permit,
  'ent_lead' | 'dm' | 'da' | 'dual_da' | 'ca'
> {
  return { ent_lead: null, dm: null, da: null, dual_da: null, ca: null, ...over };
}

// ---------------------------------------------------------------------------
// §0 · THE REPORT, BY NAME
// ---------------------------------------------------------------------------

/** `4137 54th Ave SW` exactly as prod holds it, 2026-09-16. */
const FOUR137 = proj({
  entitlement_lead: 'Briana',
  design_manager: 'Jade',
  schematic_designer: ['Derry'],
  construction_admin: 'Steve',
});
const FOUR137_PERMITS = [
  permit({ ent_lead: 'Bobby', da: 'Cam' }), // PAR/Pre-Sub
  permit({ ent_lead: 'Briana', da: 'Cam' }), // Demolition
  permit({ ent_lead: 'Briana' }), // ULS
  permit({ ent_lead: 'Briana' }), // IPR
  permit({ ent_lead: 'Bobby', da: 'Shire' }), // SDOT Tree
  permit({ ent_lead: 'Briana', dm: 'Derry', da: 'Erick' }), // Building Permit
];

describe('fix-583 §0 — Derry + 4137 54th Ave SW, the reported pair', () => {
  it('★★★ it is VISIBLE to Derry now', () => {
    expect(projectIsMine(FOUR137, FOUR137_PERMITS, 'Derry')).toBe(true);
  });

  it('★★★ …and it was hidden by BOTH causes, each proved separately', () => {
    // Cause A — the project header names him and the old predicate could not
    // see the field: `schematic_designer` was not even in `ProjectLeads`.
    expect(projectMatchesSelf(FOUR137, 'Derry')).toBe(true); // reads it now
    // Cause B — he is also the `dm` on its Building Permit, and Derry is
    // project-scope, so the old if/else never consulted the permits at all.
    expect(FOUR137_PERMITS.some((p) => permitMatchesSelf(p, 'Derry'))).toBe(true);
  });

  it('★★ the people already on it still are — nothing was taken away', () => {
    for (const who of ['Briana', 'Jade', 'Bobby', 'Cam', 'Erick', 'Shire']) {
      expect(projectIsMine(FOUR137, FOUR137_PERMITS, who), who).toBe(true);
    }
  });

  it('★★★ …and somebody on NEITHER still does not see it', () => {
    // ⚠️ THE FILTER MUST STILL FILTER. A union widened until it stops excluding
    //    is a worse bug than the one being fixed.
    expect(projectIsMine(FOUR137, FOUR137_PERMITS, 'Nobody')).toBe(false);
    expect(projectIsMine(FOUR137, FOUR137_PERMITS, null)).toBe(false);
    expect(projectIsMine(FOUR137, FOUR137_PERMITS, '   ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §A · THE UNION — both directions
// ---------------------------------------------------------------------------

describe('fix-583 §A — project OR permit, never one or the other', () => {
  const header = proj({ design_manager: 'Derry' });
  const mine = permit({ da: 'Erick' });

  it('★★★ on a permit but not the project header → visible', () => {
    expect(projectIsMine(proj(), [mine], 'Erick')).toBe(true);
  });

  it('★★★ on the project header but no permit → visible', () => {
    expect(projectIsMine(header, [permit({ da: 'Someone else' })], 'Derry')).toBe(true);
  });

  it('★★★ on neither → NOT visible', () => {
    expect(projectIsMine(proj(), [mine], 'Derry')).toBe(false);
  });

  it('★★ a project with no permits loaded degrades to the header half', () => {
    expect(projectIsMine(header, [], 'Derry')).toBe(true);
    expect(projectIsMine(proj(), [], 'Derry')).toBe(false);
  });

  it('★★★ the union does not consult the tier — it takes no tier argument', () => {
    // ★ The correction, enforced by the signature: `projectIsMine` cannot branch
    //   on a scope it is never given. The tier decides the toggle's DEFAULT
    //   POSITION and nothing else.
    expect(projectIsMine.length).toBe(4); // project, permits, name, originals
    const src = strip(read('src/lib/selfScope.ts'));
    const body = src.slice(src.indexOf('export function projectIsMine'));
    expect(body.slice(0, 400)).not.toMatch(/SelfScopeKind|identity\.scope|'permit'/);
  });
});

// ---------------------------------------------------------------------------
// §A2 · ONE PREDICATE, BOTH SCREENS
// ---------------------------------------------------------------------------

describe('fix-583 §A — one predicate serves both boards', () => {
  it('★★★ neither screen branches on the tier any more', () => {
    for (const f of ['src/pages/ProjectList.tsx', 'src/pages/Dashboard.tsx']) {
      const src = strip(read(f));
      expect(src, f).toContain('projectIsMine(');
      // ⚠️ The shape that WAS the bug: choosing a predicate by tier.
      expect(src, f).not.toMatch(/scope === 'permit'/);
      expect(src, f).not.toMatch(/selfScope === 'project'/);
    }
  });

  it('★★ the rule lives in selfScope.ts, not at the call sites', () => {
    // ★ Two call sites implementing one rule is how the two boards drift — this
    //   Brain has removed two-writers-of-one-rule four times.
    const lib = strip(read('src/lib/selfScope.ts'));
    expect(lib).toContain('export function projectIsMine');
  });
});

// ---------------------------------------------------------------------------
// §B · schematic_designer
// ---------------------------------------------------------------------------

describe('fix-583 §B — schematic_designer is read, and it is an array', () => {
  it('★★★ Dave sees his schematic projects — he saw 0 of 69', () => {
    const daves = proj({ entitlement_lead: 'Briana', schematic_designer: ['Dave'] });
    expect(projectMatchesSelf(daves, 'Dave')).toBe(true);
    expect(projectIsMine(daves, [], 'Dave')).toBe(true);
  });

  it('★★ ANY element matches, trimmed and case-insensitive', () => {
    const many = proj({ schematic_designer: ['Ana', ' derry ', 'Dave'] });
    for (const who of ['Ana', 'DERRY', 'dave', '  Derry  ']) {
      expect(projectMatchesSelf(many, who), who).toBe(true);
    }
    expect(projectMatchesSelf(many, 'Lindsay')).toBe(false);
  });

  it('★★ an empty array is not a match for anybody', () => {
    for (const sd of [[], null, ['', '  ']]) {
      expect(projectMatchesSelf(proj({ schematic_designer: sd }), 'Dave')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §B2 · THE REDESIGN FALLBACK IS PER FIELD — including the array
// ---------------------------------------------------------------------------

describe('fix-583 §B — a blank array inherits, a populated one never yields', () => {
  const ORIGINAL = 'orig-1';
  const originals = buildProjectLeadIndex([
    {
      id: ORIGINAL,
      entitlement_lead: 'Miles',
      design_manager: 'Brittani',
      schematic_designer: ['Dave'],
      construction_admin: 'Steve',
    } as Project,
  ]);

  it('★★★ blank on the redesign → inherits the original\'s schematic team', () => {
    const rd = proj({
      entitlement_lead: 'Briana',
      schematic_designer: [],
      redesign_of_project_id: ORIGINAL,
    });
    expect(projectMatchesSelf(rd, 'Dave', originals)).toBe(true);
  });

  it('★★★ populated on the redesign → it NEVER yields to the original', () => {
    // fix-386's rule: an explicit value wins. The redesign has said who draws
    // it, so the original's schematic team must not match.
    const rd = proj({
      schematic_designer: ['Ana'],
      redesign_of_project_id: ORIGINAL,
    });
    expect(projectMatchesSelf(rd, 'Ana', originals)).toBe(true);
    expect(projectMatchesSelf(rd, 'Dave', originals)).toBe(false);
  });

  it('★★★ all three spellings of "empty" inherit — `null`, `[]` and `[\'  \']`', () => {
    // ⚠️⚠️ THE TRAP THE BRIEF NAMED: an empty array must not read as "no value"
    //    in one branch and "a value" in the other. `normList` collapses all
    //    three to `[]` so both branches see one thing.
    for (const sd of [null, [], ['', '   ']]) {
      const rd = proj({ schematic_designer: sd, redesign_of_project_id: ORIGINAL });
      expect(projectMatchesSelf(rd, 'Dave', originals), JSON.stringify(sd)).toBe(true);
    }
  });

  it('★★ the other three fields still fall back per field (fix-573, kept)', () => {
    const rd = proj({
      entitlement_lead: 'Briana', // its own → Miles must NOT match
      redesign_of_project_id: ORIGINAL,
    });
    expect(projectMatchesSelf(rd, 'Miles', originals)).toBe(false);
    expect(projectMatchesSelf(rd, 'Brittani', originals)).toBe(true); // dm blank
    expect(projectMatchesSelf(rd, 'Briana', originals)).toBe(true);
  });

  it('★★ no index supplied → the chase does not happen at all', () => {
    const rd = proj({ schematic_designer: [], redesign_of_project_id: ORIGINAL });
    expect(projectMatchesSelf(rd, 'Dave')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C · construction_admin — in, and measured
// ---------------------------------------------------------------------------
//
// ⚠️⚠️ Bobby ruled it in and it is in. But fix-487 refused it for a reason that
//    is STILL TRUE and has got worse: prod 2026-09-16,
//    `projects.construction_admin` is **`'Steve'` on all 227 rows, zero nulls**.
//    So this rule adds **227 pairs for one person — 100% of the book** — and
//    Steve's "My Work" equals "Everyone" until the column is filled in per
//    project. `permits.ca` is empty on every permit too, so fix-487's own CA
//    rule has never matched a row either.
//
// ★ Shipped anyway: nothing Steve can SEE changes (fix-428 already defaulted him
//   to Everyone across all 227), the rule is right the day the column becomes
//   real, and special-casing one name here would be a hidden exception nobody
//   could find later. It is a data problem to raise, not a predicate to bend.

describe('fix-583 §C — construction_admin matches at project level', () => {
  it('★★★ the CA of a project matches it', () => {
    expect(projectMatchesSelf(proj({ construction_admin: 'Steve' }), 'Steve')).toBe(true);
  });

  it('★★ …and it does not match anybody else', () => {
    expect(projectMatchesSelf(proj({ construction_admin: 'Steve' }), 'Rice')).toBe(false);
  });

  it('★★★ the degenerate case is REAL and is recorded, not hidden', () => {
    // A column with one value on every row cannot scope anything. The next
    // person to read this predicate must find that written down.
    // ★ Whitespace-tolerant: the sentence wraps across comment lines, and a
    //   literal with a hard newline in it would pin the wrapping rather than the
    //   fact (fix-581's lesson, one ticket old).
    // ★ The jsdoc GUTTER is stripped before the whitespace collapse — a `*` at
    //   the start of a continuation line is not whitespace, so collapsing alone
    //   leaves it mid-sentence and the match fails for a reason that is about
    //   comment formatting rather than about the fact being recorded.
    const lib = read('src/lib/selfScope.ts')
      .replace(/^\s*\*\s?/gm, '')
      .replace(/\s+/g, ' ');
    expect(lib).toMatch(/all 227 rows, with zero nulls/);
    expect(lib).toMatch(/IS A \*\*DEFAULT\*\*, NOT AN ASSIGNMENT/);
    expect(lib).toMatch(/100% of the book/);
  });
});

// ---------------------------------------------------------------------------
// §D · TIERING MOVES, AND THAT IS THE INTENDED CONSEQUENCE
// ---------------------------------------------------------------------------
//
// `deriveSelfScope` calls `projectMatchesSelf`, so §B and §C re-tier people for
// free. **§A is what makes that safe** — a person promoted to project-scope used
// to stop seeing permit-only projects; under the union they no longer do.
//
// ★ Re-measured against fix-428's sixteen "unassigned" logins: **twelve are
//   still genuinely unassigned.** Ana and Dave stop being unassigned because of
//   this ticket (14 and 65 schematic projects); Gena and Lucas had already
//   stopped, having been given real project + permit work since 2026-08-28.
//   Do not quote "sixteen" again without re-running it.

describe('fix-583 §D — a schematic-only person is project-scope now', () => {
  const projects = [
    { entitlement_lead: 'Briana', design_manager: 'Jade', schematic_designer: ['Dave'], construction_admin: null },
    { entitlement_lead: 'Miles', design_manager: null, schematic_designer: null, construction_admin: null },
  ] as Project[];

  it('★★★ Dave tiers as `project`, not `permit`', () => {
    // Before: the tier was decided by a predicate that could not see his only
    // assignment, so he was filed 'permit' with zero permits — i.e. unassigned.
    expect(deriveSelfScope('Dave', projects)).toBe('project');
  });

  it('★★★ …so fix-428 no longer widens his default to Everyone', () => {
    // ⚠️ A VISIBLE CHANGE FOR HIM, and the intended one: his default flips from
    //    Everyone to My Work, and My Work now has his 69 projects in it.
    expect(widenScopeWhenUnassigned('project', 'Dave', [])).toBe('project');
  });

  it('★★ somebody genuinely on nothing is still widened to Everyone', () => {
    // Twelve of fix-428's sixteen are still here, and must stay here.
    expect(deriveSelfScope('Darin', projects)).toBe('permit');
    expect(widenScopeWhenUnassigned('permit', 'Darin', [])).toBe('all');
  });

  it('★★ an unmapped name is still `all`', () => {
    expect(deriveSelfScope(null, projects)).toBe('all');
    expect(deriveSelfScope('  ', projects)).toBe('all');
  });
});
