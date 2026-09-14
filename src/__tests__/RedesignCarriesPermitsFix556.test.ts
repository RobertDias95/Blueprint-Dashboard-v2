import { describe, it, expect } from 'vitest';
import {
  effectivePermits,
  effectivePermitsFromMap,
  reusesOriginalPermits,
  permitSourceProjectId,
  asPermitOfProject,
  permitProvenanceLine,
} from '../lib/effectivePermits';
import { displayAddress, hasRedesignSuffix } from '../lib/displayAddress';
import { buildProjectRows } from '../lib/projectViewHelpers';

// ===========================================================================
// ★★★ fix-556 (P-263, and P-073 Ask 2 with it) — THE REDESIGN CARRIES ITS
//     PERMITS, AND THE ORIGINAL FOLDS UNDER IT
// ===========================================================================
//
// **MEASURED ON PROD 2026-09-14**, re-derived for this ticket rather than
// carried from the brief:
//
//   redesigns (`redesign_of_project_id` set)                            17
//   distinct originals                                                  17
//   `redesign_reuses_original_permit`   true 12 · false 3 · null 2
//   the 12 `true` redesigns' OWN permits                                 0
//   their originals' permits                                            41
//   originals carrying IN-FLIGHT permits            8 projects / 13 permits
//   the 3 `false` redesigns' own permits              4 (1–2 each)
//   the 2 `null` redesigns' own permits               2 (1 each)
//   `projects.address` rows literally carrying `[Redesign`              17
//
// ★★ THE EIGHT, and the one place my measurement and the brief's differ:
//    12238 4th Ave NW (3) · 4000 SW Concord St (3) · 548 3rd Ave N (2) ·
//    220 N 58th St · 2443 5th Ave W · 3623 SW Othello St · 5537 35th Ave NE ·
//    **725 N 92nd ST** (1 each). The brief's eighth is 12836 N 60th St.
//    Same count both ways — 8 projects, 13 permits — and the disagreement is
//    the definition, not the data:
//      · 12836's one permit reads status `Pre-Submittal — GO` but carries
//        `approval_date = 2026-04-03`, so **fix-221's rule calls it issued**
//        (approved-awaiting-issuance) while a person reading the status would
//        call it in flight.
//      · 725's ULS reads `Reviews Completed` with no approval or issue date,
//        so fix-221 calls it in flight.
//    ★ This suite follows `isEffectivelyIssued` — the app's own predicate —
//      because a ticket that measures "in flight" differently from the screen
//      it is fixing is measuring something else. **Neither list changes what
//      ships:** both projects are reuse-redesigns whose cards were missing.
//
// ★★★ THE CAUSE, which is the thing worth writing down: the Pipeline buckets
//     PERMIT ROWS, a reuse-redesign has none of its own, and fix-524 §B
//     `continue`s past the original that holds them. fix-150's parent-chase
//     exists — in `deriveLaneStatus`, which decides the LANE. Nothing chased
//     the parent for the CARDS. A correct lane with nothing on it is still an
//     empty board.

const ORIGINAL = 'p-orig';
const REDESIGN = 'p-redesign';

interface TestPermit {
  id: number;
  project_id: string;
  type: string;
}

const originalPermits: TestPermit[] = [
  { id: 101, project_id: ORIGINAL, type: 'Building Permit' },
  { id: 102, project_id: ORIGINAL, type: 'Demolition' },
  { id: 103, project_id: ORIGINAL, type: 'ULS' },
  { id: 104, project_id: ORIGINAL, type: 'PAR/Pre-Sub' },
];

function redesign(reuse: boolean | null) {
  return {
    id: REDESIGN,
    redesign_of_project_id: ORIGINAL,
    redesign_reuses_original_permit: reuse,
  };
}

describe('fix-556 §A — the effective permits of a project, defined once', () => {
  it('★★★ reuse = TRUE unions the original’s permits onto the redesign', () => {
    // ★ The prod shape: 12 of 17 redesigns, 0 own permits, 41 on the originals.
    const got = effectivePermits(redesign(true), [], originalPermits);
    expect(got.map((p) => p.id)).toEqual([101, 102, 103, 104]);
  });

  it('★★★ reuse = FALSE mirrors nothing — the redesign shows its own', () => {
    // ★ 5053 25th Ave SW: 2 of its own, 5 on the original, and the 5 stay put.
    const own: TestPermit[] = [
      { id: 201, project_id: REDESIGN, type: 'Building Permit' },
      { id: 202, project_id: REDESIGN, type: 'Demolition' },
    ];
    const got = effectivePermits(redesign(false), own, originalPermits);
    expect(got.map((p) => p.id)).toEqual([201, 202]);
  });

  it('★★★ reuse = NULL mirrors nothing either — asserted SEPARATELY from false', () => {
    // ★★ `null` is not `false`. They take the same branch and they are
    //    different facts: false is an answer, null is that nobody answered.
    //    Folding this into the `false` case would let a future edit that
    //    treats null as "probably yes" pass a green suite. 2 of 17 on prod.
    const own: TestPermit[] = [{ id: 301, project_id: REDESIGN, type: 'ULS' }];
    const got = effectivePermits(redesign(null), own, originalPermits);
    expect(got.map((p) => p.id)).toEqual([301]);
    expect(reusesOriginalPermits(redesign(null))).toBe(false);
    expect(reusesOriginalPermits(redesign(false))).toBe(false);
    expect(reusesOriginalPermits(redesign(true))).toBe(true);
  });

  it('★★ a redesign that later files its OWN permit keeps it — union, never replace', () => {
    // ★★★ `own.length ? own : parent` would have passed every other test here
    //     and lost this permit silently, on the day it first mattered.
    const own: TestPermit[] = [{ id: 401, project_id: REDESIGN, type: 'ULS' }];
    const got = effectivePermits(redesign(true), own, originalPermits);
    expect(got.map((p) => p.id)).toEqual([401, 101, 102, 103, 104]);
  });

  it('★★ reuse = true with NO parent is not a mirror', () => {
    const orphan = {
      id: REDESIGN,
      redesign_of_project_id: null,
      redesign_reuses_original_permit: true,
    };
    expect(reusesOriginalPermits(orphan)).toBe(false);
    expect(effectivePermits(orphan, [], originalPermits)).toEqual([]);
  });

  it('★ the permit SOURCE is the original when it mirrors, itself otherwise', () => {
    expect(permitSourceProjectId(redesign(true))).toBe(ORIGINAL);
    expect(permitSourceProjectId(redesign(false))).toBe(REDESIGN);
    expect(permitSourceProjectId(redesign(null))).toBe(REDESIGN);
  });

  it('★ the same permit is never listed twice', () => {
    const got = effectivePermits(redesign(true), originalPermits, originalPermits);
    expect(got.map((p) => p.id)).toEqual([101, 102, 103, 104]);
  });

  it('★★ a plain project is untouched — no flag, no chase', () => {
    const plain = { id: 'p-plain' };
    const own: TestPermit[] = [{ id: 501, project_id: 'p-plain', type: 'ULS' }];
    expect(effectivePermits(plain, own, originalPermits).map((p) => p.id)).toEqual([
      501,
    ]);
  });
});

describe('fix-556 §A — the Pipeline: one project, one card, and the original is off the board', () => {
  // ★ The board carries permits WRAPPED (`{ permit, cycles, reviewers }`),
  //   which is why the union takes a key function. This is the board's shape.
  const wrapped = new Map<string, { permit: TestPermit }[]>([
    [ORIGINAL, originalPermits.map((permit) => ({ permit }))],
  ]);

  it('★★★ the redesign lanes by the original’s permits — 2443 finds a card', () => {
    // ★★★ THE DEFECT: `2443` searched to 0 / 0 / 0 / 0 across every lane while
    //     four permits sat one row away.
    const got = effectivePermitsFromMap(redesign(true), wrapped, (b) => b.permit.id);
    expect(got.map((b) => b.permit.id)).toEqual([101, 102, 103, 104]);
  });

  it('★★★ each of the eight appears EXACTLY ONCE — never on both projects', () => {
    // ★★ The original is filtered off the board by fix-524 §B before this runs,
    //    so the union is the only place its permits enter. Asserting the count
    //    is what stops a future "also show the original" from double-listing.
    const cards = new Map<number, string[]>();
    for (const project of [redesign(true)]) {
      for (const b of effectivePermitsFromMap(project, wrapped, (x) => x.permit.id)) {
        const list = cards.get(b.permit.id) ?? [];
        list.push(project.id);
        cards.set(b.permit.id, list);
      }
    }
    for (const [, owners] of cards) expect(owners).toHaveLength(1);
    expect(cards.size).toBe(4);
  });

  it('★★★ a mirrored card is re-keyed to the project that renders it — and its ID is NOT', () => {
    // ★★★ The board reads `permit.project_id` in four places (the draw row that
    //     splits D&E, the address a card groups under, twice, and fix-383's
    //     distribution). For a mirrored permit the right answer in all four is
    //     the REDESIGN. The id is untouched, which is what keeps every write
    //     pointed at the one row that exists.
    const moved = asPermitOfProject(originalPermits[0], REDESIGN);
    expect(moved.project_id).toBe(REDESIGN);
    expect(moved.id).toBe(101);
    // ★ and the source row is not mutated — the Overview renders it unchanged.
    expect(originalPermits[0].project_id).toBe(ORIGINAL);
  });

  it('★ a permit already on the project is returned as-is, not cloned', () => {
    const p = originalPermits[0];
    expect(asPermitOfProject(p, ORIGINAL)).toBe(p);
  });
});

describe('fix-556 §B — the provenance line names the project the rows belong to', () => {
  it('★★★ it says WHERE the permits are from, and why', () => {
    expect(permitProvenanceLine('2443 5th Ave W')).toBe(
      "Permits from 2443 5th Ave W — this project reuses the original's permits.",
    );
  });

  it('★★ nothing mirrored → no line (a reuse=false redesign prints none)', () => {
    expect(permitProvenanceLine(null)).toBeNull();
    expect(permitProvenanceLine('')).toBeNull();
    expect(permitProvenanceLine('   ')).toBeNull();
  });

  it('★★ the line carries the STRIPPED address — never `[Redesign 1]`', () => {
    // ★ The strip happens at the render edge and is passed in: this module must
    //   not become a second address-strip (fix-530 §C).
    expect(permitProvenanceLine(displayAddress('2443 5th Ave W [Redesign 1]'))).toBe(
      "Permits from 2443 5th Ave W — this project reuses the original's permits.",
    );
  });
});

describe('fix-556 §C — `[Redesign N]` never reaches a screen, and the DATA still has it', () => {
  // ★★★ 17 rows carry it literally in `projects.address`, and it is the key the
  //     indexer matches share folders on. The fixture asserts BOTH halves — a
  //     ticket that "fixed" this by rewriting the column would pass a display
  //     test and break the plan of record for exactly these 17 projects.
  const stored = '2443 5th Ave W [Redesign 1]';

  it('★★★ the stored string still carries the suffix', () => {
    expect(hasRedesignSuffix(stored)).toBe(true);
    expect(stored).toContain('[Redesign 1]');
  });

  it('★★★ every read surface shows the plain address', () => {
    expect(displayAddress(stored)).toBe('2443 5th Ave W');
    expect(displayAddress(stored)).not.toContain('Redesign');
  });

  it('★★ a bracket that means something else is kept', () => {
    expect(displayAddress('12 Main St [Lot 3]')).toBe('12 Main St [Lot 3]');
  });
});

// ---------------------------------------------------------------------------
// §D — Project View: one row per lineage
// ---------------------------------------------------------------------------

type Row = ReturnType<typeof buildProjectRows>[number];

function projectFixture(over: Record<string, unknown>) {
  return {
    id: 'x',
    address: 'x',
    juris: 'Seattle',
    archived: false,
    go_date: null,
    notes: null,
    project_tags: null,
    redesign_of_project_id: null,
    redesign_reuses_original_permit: null,
    ...over,
  } as unknown as Parameters<typeof buildProjectRows>[0][number];
}

function permitFixture(over: Record<string, unknown>) {
  return {
    id: 0,
    project_id: ORIGINAL,
    type: 'Building Permit',
    status: null,
    stage_override: null,
    parent_permit_id: null,
    approval_date: null,
    actual_issue: null,
    permit_cycles: [],
    ...over,
  } as unknown as Parameters<typeof buildProjectRows>[1][number];
}

const projects = [
  projectFixture({ id: ORIGINAL, address: '2443 5th Ave W' }),
  projectFixture({
    id: REDESIGN,
    address: '2443 5th Ave W [Redesign 1]',
    redesign_of_project_id: ORIGINAL,
    redesign_reuses_original_permit: true,
  }),
  projectFixture({ id: 'p-plain', address: '999 Elsewhere Ave' }),
];

const permits = [
  permitFixture({ id: 101, type: 'Building Permit' }),
  permitFixture({ id: 102, type: 'Demolition' }),
  permitFixture({ id: 103, type: 'ULS' }),
  permitFixture({ id: 104, type: 'PAR/Pre-Sub' }),
  permitFixture({ id: 900, project_id: 'p-plain' }),
];

function rowsById(): Map<string, Row> {
  return new Map(
    buildProjectRows(projects, permits, []).map((r) => [r.project.id, r]),
  );
}

describe('fix-556 §D — Project View lists the current project, and the original folds under it', () => {
  it('★★★ the CURRENT project carries the permits — it read 0 before', () => {
    const r = rowsById().get(REDESIGN)!;
    expect(r.permits.map((p) => p.permit.id)).toEqual([101, 102, 103, 104]);
  });

  it('★★★ the original is marked superseded, so it never counts as a peer', () => {
    const rows = rowsById();
    expect(rows.get(ORIGINAL)!.supersededBy).toBe(REDESIGN);
    expect(rows.get(REDESIGN)!.supersededBy).toBeNull();
    expect(rows.get('p-plain')!.supersededBy).toBeNull();
  });

  it('★★★ `N total · M match` counts CURRENT projects — searching 2443 finds one', () => {
    // ★★ The page filters `currentRows`, not `allRows`, which is what makes the
    //    count, the Stage/Ent/DA options, the Active toggle and every sort agree.
    //    Hiding the original at render time would have left it in all four.
    const all = buildProjectRows(projects, permits, []);
    const current = all.filter((r) => !r.supersededBy);
    expect(all).toHaveLength(3);
    expect(current).toHaveLength(2);
    const matching2443 = current.filter((r) =>
      displayAddress(r.project.address).includes('2443'),
    );
    expect(matching2443).toHaveLength(1);
    expect(matching2443[0].project.id).toBe(REDESIGN);
  });

  it('★★ the folded original is INDEXED by its successor, not dropped', () => {
    // ★ It is the way back to the frozen snapshot fix-524 §D built.
    const all = buildProjectRows(projects, permits, []);
    const bySuccessor = new Map<string, Row>();
    for (const r of all) if (r.supersededBy) bySuccessor.set(r.supersededBy, r);
    expect(bySuccessor.get(REDESIGN)!.project.id).toBe(ORIGINAL);
  });

  it('★★ the BP anchor resolves through the union — Ent Lead and DA stop reading —', () => {
    // ★★★ A reuse-redesign has no BP of its own, so every project-level field
    //     anchored on the BP read null. fix-146 patched ONE of them with its
    //     own query; the union closes all of them from one place.
    const r = rowsById().get(REDESIGN)!;
    expect(r.bpAnchor?.id).toBe(101);
  });

  it('★ a project that superseded nothing is completely unchanged', () => {
    const r = rowsById().get('p-plain')!;
    expect(r.permits.map((p) => p.permit.id)).toEqual([900]);
    expect(r.supersededBy).toBeNull();
  });

  it('★★★ a reuse=FALSE redesign does not take its original’s rows here either', () => {
    const own = [
      projectFixture({ id: ORIGINAL, address: '5053 25th Ave SW' }),
      projectFixture({
        id: REDESIGN,
        address: '5053 25th Ave SW [Redesign 1]',
        redesign_of_project_id: ORIGINAL,
        redesign_reuses_original_permit: false,
      }),
    ];
    const ps = [
      permitFixture({ id: 11 }),
      permitFixture({ id: 12, type: 'Demolition' }),
      permitFixture({ id: 21, project_id: REDESIGN }),
      permitFixture({ id: 22, project_id: REDESIGN, type: 'Demolition' }),
    ];
    const rows = new Map(
      buildProjectRows(own, ps, []).map((r) => [r.project.id, r]),
    );
    expect(rows.get(REDESIGN)!.permits.map((p) => p.permit.id)).toEqual([21, 22]);
    // ★ and the original still holds its own — nothing was moved.
    expect(rows.get(ORIGINAL)!.permits.map((p) => p.permit.id)).toEqual([11, 12]);
  });
});
