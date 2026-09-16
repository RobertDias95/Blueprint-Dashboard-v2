import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import { displayAddress, hasRedesignSuffix } from '../lib/displayAddress';
import { findAddressMatches, verdictFor } from '../lib/addressMatch';
import { makeRedesignWizardState } from '../components/wizard/wizardState';
import { redesignedAwayProjectIds, retiredCause } from '../lib/retiredState';

// ===========================================================================
// ★★★ fix-566 (P-270) — A REDESIGN KEEPS ITS OWN ADDRESS
// ===========================================================================
//
// Bobby, 2026-09-14: *"a redesign and the new version of that project should
// have the same address because the address is not changing. It's the metrics
// within it."*
//
// ★★★ `[Redesign N]` WAS NEVER A NAMING CHOICE. `makeRedesignWizardState`'s own
//     docstring said so: *"the address column has a global unique index
//     (projects_address_key); the suffix is the simplest way to keep redesign
//     rows linked to the same conceptual parcel while still satisfying the
//     constraint."* A constraint workaround wearing a label — and every ticket
//     since worked around the workaround (fix-530 §C strips it for display,
//     fix-524 and fix-556 §C refuse to edit the stored value).
//
// ---------------------------------------------------------------------------
// ★★★ §0 — RE-MEASURED 2026-09-16 16:30 UTC, AND IT MOVED **DURING** THIS
//     TICKET: 19 → 20.
// ---------------------------------------------------------------------------
//
//   226 projects · 226 distinct addresses · 20 redesigns
//   19 carry `… [Redesign 1]` · 1 carries a trailing period · 0 carry neither
//
// The first query of this session returned 224 projects and 19 redesigns — the
// brief's number. `4707 S Graham St [Redesign 1]` was created at 16:28 UTC,
// minutes later, by the wizard line this ticket deletes.
//
// ★★★ THE BRIEF SAID ITS OWN 18 WENT STALE IN 24 HOURS. OURS WENT STALE IN
//     UNDER AN HOUR. That is the argument for the migration deriving every
//     count instead of typing one — see §B below, and see fix-580 §C, which was
//     rolled back at apply time on 2026-09-15 for asserting `8` over a list of
//     nine. **This file's fixture table is prose and may go stale; nothing it
//     asserts depends on the number 20.**

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = read(
  'migrations/fix_566_redesign_keeps_its_address_PENDING_APPROVAL.sql',
);

/** The 20 real (before, after) pairs, measured on prod 2026-09-16 16:30 UTC.
 *  `after` is also each row's ORIGINAL's address — verified equal for all 20,
 *  which is what lets the migration assert the strong condition rather than
 *  trusting a regex. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['12836 N 60th St [Redesign 1]', '12836 N 60th St'],
  ['4120 49th Ave S [Redesign 1]', '4120 49th Ave S'],
  ['10150 NE 64th St [Redesign 1]', '10150 NE 64th St'],
  ['7603 8th Ave NW [Redesign 1]', '7603 8th Ave NW'],
  ['6505 21st Ave NW [Redesign 1]', '6505 21st Ave NW'],
  ['5053 25th Ave SW [Redesign 1]', '5053 25th Ave SW'],
  ['548 3rd Ave N [Redesign 1]', '548 3rd Ave N'],
  ['12238 4th Ave NW [Redesign 1]', '12238 4th Ave NW'],
  ['5537 35th Ave NE [Redesign 1]', '5537 35th Ave NE'],
  ['2443 5th Ave W [Redesign 1]', '2443 5th Ave W'],
  ['3623 SW Othello St [Redesign 1]', '3623 SW Othello St'],
  ['4000 SW Concord St [Redesign 1]', '4000 SW Concord St'],
  ['725 N 92nd ST [Redesign 1]', '725 N 92nd ST'],
  ['220 N 58th St [Redesign 1]', '220 N 58th St'],
  ['123 N 48th St [Redesign 1]', '123 N 48th St'],
  ['7200 54th Ave S [Redesign 1]', '7200 54th Ave S'],
  ['137 13th Ave [Redesign 1]', '137 13th Ave'],
  ['4409 S Holly ST.', '4409 S Holly ST'],
  ['5620 6th Ave NW [Redesign 1]', '5620 6th Ave NW'],
  ['4707 S Graham St [Redesign 1]', '4707 S Graham St'],
];

// ---------------------------------------------------------------------------
// §C1 · THE WIZARD STOPS INVENTING A NAME
// ---------------------------------------------------------------------------
//
// ★★★ THE BRIEF ASKED WHICH IT WAS, AND IT IS THE FIRST: **the wizard appended
//     the suffix itself.** `wizardState.ts` read
//     `` `${parentProject.address} [Redesign ${n}]` ``. It never relayed a
//     constraint error — by the time the RPC saw the address it was already
//     unique, so `projects_address_key` was never reached from this path at
//     all. That is also why the fix is not "stop surfacing the error": there
//     was no error.

describe('fix-566 §C — the redesign seed carries the parent address verbatim', () => {
  const parent = { id: 'p-1', address: '2443 5th Ave W', juris: 'Seattle' };

  it('★★★ no suffix, no counter — the address comes over unchanged', () => {
    expect(makeRedesignWizardState(parent).address).toBe('2443 5th Ave W');
  });

  it('★★★ …and the suffix cannot come back, because the counter is gone', () => {
    // ★ A parameter kept "in case" is how a deleted behaviour returns. The
    //   arity is the guard: `makeRedesignWizardState(parent, 3, 'Marc')` no
    //   longer compiles, so nothing can pass a redesign count to be numbered.
    expect(makeRedesignWizardState.length).toBeLessThanOrEqual(2);
    const src = strip(read('src/components/wizard/wizardState.ts'));
    expect(src).not.toMatch(/\[Redesign/);
    expect(src).not.toContain('existingRedesignCount');
  });

  it('★★ the second argument is still the parent BP DA (fix-158 is untouched)', () => {
    expect(makeRedesignWizardState(parent, 'Marc').redesign_dd_da).toBe('Marc');
    expect(makeRedesignWizardState(parent, null).redesign_dd_da).toBe('');
  });

  it('★★ no caller passes a count any more', () => {
    const src = strip(read('src/pages/ProjectDetail.tsx'));
    expect(src).not.toMatch(/makeRedesignWizardState\([^)]*redesignsQ/);
    // …and the hook whose only job here was numbering the suffix is no longer
    // called. `useProjectRedesignsWithPermits` is a DIFFERENT function and
    // still feeds the "Redesigns (N)" section.
    expect(src).not.toMatch(/\buseProjectRedesigns\(/);
    expect(src).toMatch(/useProjectRedesignsWithPermits\(/);
  });
});

// ---------------------------------------------------------------------------
// §C1b · THE BRIDGE IS GONE (fix-581 §D)
// ---------------------------------------------------------------------------
//
// fix-566 shipped a one-retry-with-the-old-suffix bridge to cover the window
// between merging and the migration being applied. **The migration was applied
// 2026-09-16** — verified on prod: `projects_address_key` gone, the partial
// index present, the pre-check redesign-aware, **0 of 227 addresses suffixed**,
// and a 21st redesign created since with none. fix-581 §D deletes the retry, and
// these assert it stayed deleted.

describe('fix-566 §C — the wizard posts the parent address and nothing else', () => {
  const src = strip(read('src/components/NewProjectWizard.tsx'));

  it('★★★ there is ONE create call and no suffix retry', () => {
    expect(src).toContain('const result = await create.mutateAsync(payload)');
    expect(src).not.toMatch(/\[Redesign \$\{/);
    expect(src).not.toMatch(/result\.conflict && isRedesign/);
    expect(src).not.toContain('redesignSiblingCount');
  });

  it('★★ a genuine duplicate still reaches the dead-end banner', () => {
    // The banner stays for the case it was written for — a non-redesign at an
    // address that already exists. Removing the bridge must not remove that.
    expect(src).toContain('setConflictExistingId(result.project_id)');
  });
});

// ---------------------------------------------------------------------------
// §C2 · THE DUPLICATE WARNING STILL TELLS THE TWO CASES APART
// ---------------------------------------------------------------------------
//
// ★★ THIS IS THE SAFETY NET THE SUFFIX USED TO PROVIDE, AND IT DOES NOT NEED
//    IT. `findAddressMatches` anchors `expectedRedesign` on the PARENT'S KEY,
//    not on the typed suffix — the suffix is only a fallback for a hand-typed
//    address with no parent id. So removing the suffix changes nothing here,
//    which is measured below rather than assumed.

describe('fix-566 §C — expected redesign vs genuine duplicate, BOTH directions', () => {
  const original = { id: 'p-1', address: '2443 5th Ave W' };
  const other = { id: 'p-9', address: '999 Elsewhere Ave' };

  it('★★★ a redesign at its parent\'s EXACT address is expected, not a duplicate', () => {
    const matches = findAddressMatches({
      address: '2443 5th Ave W',
      candidates: [original, other],
      redesignOfProjectId: 'p-1',
    });
    expect(verdictFor(matches)).toBe('expected-redesign');
  });

  it('★★★ …and a NON-redesign at that address is still a duplicate', () => {
    // ⚠️ The other direction. An invariant with two directions must be checked
    //    in both — and this is the one a "stop warning about redesigns" fix
    //    breaks silently.
    const matches = findAddressMatches({
      address: '2443 5th Ave W',
      candidates: [original, other],
    });
    expect(verdictFor(matches)).toBe('duplicate');
  });

  it('★★ a redesign pointed at SOMEBODY ELSE\'S address is still a duplicate', () => {
    // fix-333's rule, unchanged: expectedness is anchored to the family this
    // redesign belongs to, not to "we are in redesign mode".
    const matches = findAddressMatches({
      address: '999 Elsewhere Ave',
      candidates: [original, other],
      redesignOfProjectId: 'p-1',
    });
    expect(verdictFor(matches)).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------
// §A · THE CONSTRAINT, AND THE TWO OTHER JOBS IT WAS DOING
// ---------------------------------------------------------------------------
//
// 🚨 THE BRIEF NAMED ONLY THE UNIQUENESS RULE. Two more things depended on
//    `projects_address_key`, and both were found by enumeration on prod:
//
//    1. THREE `ON CONFLICT (address)` statements INFER the index. Against a
//       PARTIAL index the unrepaired form raises **42P10** — proved on prod on
//       a temp table, rolled back. That is a PostgREST 400 on the scraper's and
//       the wizard's project-creation paths. fix-536's failure mode exactly.
//    2. EIGHT `SELECT … INTO … WHERE address = …` lookups are unambiguous only
//       because the address is unique. Afterwards `SELECT … INTO` takes an
//       ARBITRARY row, silently.

describe('fix-566 §A — the swap, and the neighbours that infer the old index', () => {
  it('★★★ the constraint goes and a PARTIAL unique index replaces it', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE public\.projects DROP CONSTRAINT projects_address_key/,
    );
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX projects_address_unique_non_redesign/);
    expect(MIGRATION).toMatch(/WHERE redesign_of_project_id IS NULL/);
  });

  it('★★★ all THREE ON CONFLICT statements are repaired to infer the new index', () => {
    // ★ `ON CONFLICT` does not NAME an index, it INFERS one. The WHERE clause
    //   after the column list IS the inference predicate.
    for (const fn of [
      'bp_ensure_project',
      'bp_create_project_with_permits',
      'bp_replace_draw_schedule',
    ]) {
      expect(MIGRATION, fn).toContain(fn);
    }
    const repaired = MIGRATION.match(
      /on conflict \(address\) where redesign_of_project_id is null/gi,
    );
    expect(repaired?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('★★★ every bare `ON CONFLICT (address)` anchor is PAIRED with its repair', () => {
    // ⚠️ The unrepaired form necessarily appears in the file — it is the
    //    left-hand side of each anchor pair, and the header quotes all three.
    //    So what is asserted is the PAIRING: an anchor naming the bare form must
    //    be followed, inside the same job entry, by the inferring form. An
    //    anchor with no repair beside it is the 42P10.
    const lines = MIGRATION.slice(MIGRATION.indexOf('THE STATEMENTS')).split('\n');
    const unpaired: string[] = [];
    lines.forEach((l, i) => {
      if (!/on conflict \(address\)/i.test(l)) return;
      if (/redesign_of_project_id/i.test(l)) return;
      const window = lines.slice(i + 1, i + 4).join('\n');
      if (!/redesign_of_project_id/i.test(window)) unpaired.push(l.trim());
    });
    expect(unpaired, 'an unrepaired ON CONFLICT (address) would raise 42P10').toEqual([]);
  });

  it('★★★ every address lookup routes through ONE helper that prefers the ORIGINAL', () => {
    expect(MIGRATION).toContain('bp_project_id_for_address');
    // ★ `false` sorts before `true`, so a non-redesign comes first — the row
    //   these lookups matched BEFORE the rename, which is why preferring it
    //   changes nothing that works today.
    expect(MIGRATION).toMatch(
      /ORDER BY \(p\.redesign_of_project_id IS NOT NULL\), p\.created_at, p\.id/,
    );
    // ★ Same pairing rule as the ON CONFLICT check: the bare lookup IS the
    //   left-hand anchor, so what matters is that the helper sits beside it.
    const lines = MIGRATION.slice(MIGRATION.indexOf('THE STATEMENTS')).split('\n');
    const unpaired: string[] = [];
    lines.forEach((l, i) => {
      if (!/from public\.projects/i.test(l) || !/address\s*=/i.test(l)) return;
      const window = lines.slice(i + 1, i + 4).join('\n');
      if (!/bp_project_id_for_address/.test(window)) unpaired.push(l.trim());
    });
    expect(unpaired, 'a bare address lookup now matches two rows').toEqual([]);
    // ★★ …and all five functions that hold one are covered: four by anchor plus
    //    bp_ensure_project, which is re-emitted whole.
    for (const fn of [
      'bp_ensure_project',
      'bp_create_project_with_permits',
      'bp_replace_draw_schedule',
      'bp_replace_intake_records',
      'bp_replace_project_documents',
    ]) {
      expect(MIGRATION, fn).toContain(fn);
    }
  });

  it('★★★ the duplicate PRE-CHECK is redesign-aware — §A alone would not have been enough', () => {
    // ★★★ `bp_create_project_with_permits` refuses ANY existing address and
    //     returns `conflict := true` BEFORE the constraint is ever reached. The
    //     partial index would have been invisible to it.
    expect(MIGRATION).toMatch(
      /IF NULLIF\(v_pd->>''redesign_of_project_id'',''''\) IS NULL THEN/,
    );
  });

  it('★★ fix-547 rules 1 and 3 are both acknowledged (a unique index AND anchors)', () => {
    expect(MIGRATION).toContain('on_conflict_census');
  });
});

// ---------------------------------------------------------------------------
// §B · THE RENAME, AND THE STRIPPER IT REUSES
// ---------------------------------------------------------------------------

describe('fix-566 §B — the SQL stripper is fix-530 §C\'s rule, not a second one', () => {
  /** The migration's regex, transcribed. The test asserts it agrees with
   *  `displayAddress` over all 20 real pairs rather than trusting that two
   *  spellings of one rule stay in step. */
  const sqlStrip = (a: string) =>
    a
      .replace(/\s*\[\s*redesign\s*\d*\s*\]\s*$/i, '')
      .replace(/\.$/, '')
      .trim();

  it('★★★ the migration carries that exact regex', () => {
    expect(MIGRATION).toContain("(?i)\\s*\\[\\s*redesign\\s*\\d*\\s*\\]\\s*$");
  });

  it('★★★ it agrees with displayAddress on every one of the 20 real rows', () => {
    for (const [before, after] of PAIRS) {
      expect(sqlStrip(before), before).toBe(after);
      // displayAddress owns the SUFFIX half; the period is the migration's own
      // one-row data correction and is deliberately NOT a display rule.
      const expected = after === '4409 S Holly ST' ? '4409 S Holly ST.' : after;
      expect(displayAddress(before), before).toBe(expected);
    }
  });

  it('★★★ a bracket that means something else SURVIVES both', () => {
    // fix-530 §C's anchor, still load-bearing: anchored to the word AND to
    // end-of-string.
    expect(sqlStrip('12 Main St [Lot 3]')).toBe('12 Main St [Lot 3]');
    expect(displayAddress('12 Main St [Lot 3]')).toBe('12 Main St [Lot 3]');
    expect(hasRedesignSuffix('12 Main St [Lot 3]')).toBe(false);
  });

  it('★★ the trailing-period rule is applied only to redesigns', () => {
    // A period can be part of a real address ("St." / "Ave."). The migration
    // strips it inside a join on `redesign_of_project_id`, never across all
    // projects — and even then only when the result equals the original's.
    const rename = MIGRATION.slice(MIGRATION.indexOf('_fix566_redesign_address_rename'));
    expect(rename).toContain('JOIN public.projects o ON o.id = r.redesign_of_project_id');
    expect(rename).toContain("'\\.$', ''");
  });
});

describe('fix-566 §B — every count is DERIVED, not typed', () => {
  const statements = MIGRATION.slice(MIGRATION.indexOf('THE STATEMENTS'));

  it('★★★ no statement asserts a literal row count', () => {
    // ★★★ fix-580 §C was rolled back at apply time for exactly this: it looped
    //     over nine functions and asserted eight. The redesign set grew 19 → 20
    //     DURING this ticket and not one statement needed an edit.
    const typed = statements
      .split('\n')
      .filter((l) => /RAISE EXCEPTION/i.test(l) && /<>\s*\d+/.test(l));
    expect(typed, 'a typed count goes stale between writing and applying').toEqual([]);
  });

  it('★★★ the expectations compare against values captured in the same transaction', () => {
    expect(statements).toMatch(/v_done <> v_need/);
    expect(statements).toMatch(/v_projects_a <> v_projects_b/);
    // Each renamed row collapses onto its original, so the distinct count falls
    // by exactly the number renamed. Never "205", never "206".
    expect(statements).toMatch(/v_distinct_a <> v_distinct_b - v_done/);
  });

  it('★★★ a redesign whose strip does NOT land on its original refuses the file', () => {
    // ★ The gate. `v_need <> v_safe` means a redesign genuinely moved address
    //   rather than carrying a workaround — a human has to say what it should
    //   be, and renaming the other 19 around it would be worse than stopping.
    expect(statements).toMatch(/IF v_need <> v_safe THEN/);
    expect(statements).toMatch(/address_after = original_address/);
  });

  it('★★ the before/after pairs are snapshotted (the fix-537 pattern)', () => {
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS public._fix566_redesign_address_rename');
    expect(statements).toContain('address_before');
    expect(statements).toContain('address_after');
  });

  it('★★ fix-580\'s staged file was repaired too — it asserted 8 over nine functions', () => {
    const f580 = read('migrations/fix_580_empty_string_timestamp_PENDING_APPROVAL.sql');
    // ★ The STATEMENT form, not the prose. §C's header quotes `v_hits <> 8`
    //   deliberately, as the record of why the file was rolled back — so what
    //   must be gone is the executable `IF … THEN`, and scoping by section
    //   would not have distinguished the two (the narrative sits below "THE
    //   STATEMENTS" heading).
    expect(f580).not.toMatch(/IF v_hits <> 8 THEN/);
    expect(f580).toMatch(/SELECT count\(DISTINCT v_jobs\[i\]\[1\]\) INTO v_expect/);
    expect(f580).toMatch(/v_hits <> v_expect/);
  });
});

// ---------------------------------------------------------------------------
// §B2 · THE PLAN OF RECORD CANNOT MOVE
// ---------------------------------------------------------------------------

describe('fix-566 §B — a shared address cannot reach a plan of record', () => {
  it('★★★ nothing in the plan-of-record path reads `address` to resolve a project', () => {
    // ★★★ THE INVARIANT, ASSERTED RATHER THAN THE CARD RENDERING. A redesign
    //     borrows its original's drawings through `redesign_of_project_id`
    //     (PlanOfRecordCard's `sourceProjectId`), and every set, verdict and
    //     share keys off THAT id. Two projects sharing one address therefore
    //     cannot hand a plan of record to the wrong row — measured support:
    //     all 20 redesigns hold 0 sets and 0 indexed files, their originals
    //     hold 1–4 and 7–51.
    const card = strip(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).toMatch(/redesign_of_project_id/);
    expect(card).toMatch(/const sourceProjectId = borrowed \? originalId! : projectId/);

    const dir = resolve(process.cwd(), 'src/lib');
    const planModules = readdirSync(dir).filter((f) => /^planOfRecord/.test(f));
    expect(planModules.length).toBeGreaterThan(0);
    for (const f of planModules) {
      const src = strip(read(`src/lib/${f}`));
      expect(src, `${f} must not resolve a project by address`).not.toMatch(
        /\.address\s*===/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §D · WHAT NOW TELLS TWO PROJECTS APART
// ---------------------------------------------------------------------------
//
// ⚠️ THESE WERE WRITTEN WHEN THE SUFFIX STILL DISAMBIGUATED. This ticket
//    removes that safety net, so they become the ONLY answer — and every
//    fixture below uses the **identical** address on both rows, which is what
//    the old tests could not do.

const T = 'test-tenant-uuid';
const ORIGINAL = 'f89fce48-4ef4-400d-a096-2e0612043201';
const REDESIGN = '95c72aeb-65db-4b46-b2af-12704a7b8128';
const OTHER = 'p-other';
const NOW = '2026-09-16T12:00:00Z';
const SHARED = '2443 5th Ave W';

const fixtures = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  permits: [] as Record<string, unknown>[],
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [], activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));

import ProjectList from '../pages/ProjectList';

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x', address: 'addr', juris: 'Seattle', archived: false, notes: null,
    project_tags: null, go_date: null,
    redesign_of_project_id: null, redesign_reuses_original_permit: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}
function permit(id: number, projectId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, project_id: projectId, type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: 'Nicky', dm: null,
    ent_lead: null, dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null,
    parent_permit_id: null, updated_at: NOW, permit_cycles: [], ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function visibleRowIds(): string[] {
  return Array.from(
    document.querySelectorAll('tr[data-testid^="project-view-row-"]'),
  ).map((el) => (el.getAttribute('data-testid') ?? '').replace('project-view-row-', ''));
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T });
  fixtures.projects = [
    project({ id: ORIGINAL, address: SHARED }),
    // ★★★ THE SAME STRING. Not `${SHARED} [Redesign 1]` — that is the whole
    //     point of this ticket, and no test asserted this shape before.
    project({
      id: REDESIGN,
      address: SHARED,
      redesign_of_project_id: ORIGINAL,
      redesign_reuses_original_permit: true,
    }),
    project({ id: OTHER, address: '999 Elsewhere Ave' }),
  ];
  fixtures.permits = [
    permit(10499, ORIGINAL, { type: 'Building Permit', status: 'Ready for Issuance' }),
    permit(10500, ORIGINAL, { type: 'Demolition', status: 'Issued' }),
    permit(10501, ORIGINAL, { type: 'ULS', status: 'Ready for Intake' }),
    permit(10502, ORIGINAL, { type: 'PAR/Pre-Sub', status: 'Completed' }),
    permit(900, OTHER),
  ];
});

describe('fix-566 §D — two projects, one address, one row', () => {
  it('★★★ searching the SHARED address returns exactly ONE row', () => {
    // ★★★ THE ASSERTION THE SUFFIX USED TO MAKE UNNECESSARY. fix-556 §D folds
    //     the original out BEFORE filtering, so the count and the rows agree.
    renderIt();
    fireEvent.change(screen.getByTestId('project-view-search'), {
      target: { value: '2443' },
    });
    expect(visibleRowIds()).toEqual([REDESIGN]);
    expect(screen.getByText(/2 total · 1 match/)).toBeTruthy();
  });

  it('★★★ …and it is the CURRENT project, carrying the permits', () => {
    renderIt();
    const ids = visibleRowIds();
    expect(ids).toContain(REDESIGN);
    expect(ids).not.toContain(ORIGINAL);
    expect(screen.getByTestId(`project-view-row-${REDESIGN}`).textContent).toContain('4');
  });

  it('★★★ the caret unfolds the original, and the ORIGINAL chip is the marker', () => {
    // ⚠️ With the addresses identical the chip is no longer a convenience — it
    //    is the only thing on the row that says which of the two this is.
    renderIt();
    expect(screen.queryByTestId(`project-view-original-row-${REDESIGN}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`project-view-original-toggle-${REDESIGN}`));
    const folded = screen.getByTestId(`project-view-original-row-${REDESIGN}`);
    expect(folded.textContent).toContain(SHARED);
    expect(
      screen.getByTestId(`project-view-original-chip-${ORIGINAL}`).textContent,
    ).toBe('Original');
  });
});

describe('fix-566 §D — the hatch and the Pipeline/Library exclusion are id-based', () => {
  const rows = [
    { id: ORIGINAL, archived: false, redesign_of_project_id: null },
    { id: REDESIGN, archived: false, redesign_of_project_id: ORIGINAL },
    { id: OTHER, archived: false, redesign_of_project_id: null },
  ];

  it('★★★ the ORIGINAL is retired and the REDESIGN is not — address plays no part', () => {
    const ids = redesignedAwayProjectIds(rows);
    expect([...ids]).toEqual([ORIGINAL]);
    expect(retiredCause(ORIGINAL, { redesignedIds: ids })).toBe('redesigned');
    // ★ The direction is easy to get backwards: the redesign is current work.
    expect(retiredCause(REDESIGN, { redesignedIds: ids })).toBeNull();
    expect(retiredCause(OTHER, { redesignedIds: ids })).toBeNull();
  });

  it('★★★ …and it stays true when both rows carry the identical address', () => {
    // The function never sees an address, which is exactly why this ticket is
    // safe. Asserted rather than argued: the same rows with the same string.
    const withAddresses = rows.map((r) => ({
      ...r,
      address: r.id === OTHER ? '999 Elsewhere Ave' : SHARED,
    }));
    expect([...redesignedAwayProjectIds(withAddresses)]).toEqual([ORIGINAL]);
  });

  it('★★ an ARCHIVED redesign does not retire its original (fix-524, kept)', () => {
    const archived = rows.map((r) =>
      r.id === REDESIGN ? { ...r, archived: true } : r,
    );
    expect([...redesignedAwayProjectIds(archived)]).toEqual([]);
  });
});

describe('fix-566 — displayAddress stays, and still works', () => {
  it('★★★ it still strips a suffix on a row created before this shipped', () => {
    // ⚠️ THE MIGRATION IS STAGED, NOT APPLIED — and `5620 6th Ave NW` and
    //    `4707 S Graham St` were both minted by the deleted wizard line on
    //    2026-09-15 and 2026-09-16. Deleting this helper first would put
    //    `[Redesign 1]` back on 17 call sites' worth of screens.
    expect(displayAddress('5620 6th Ave NW [Redesign 1]')).toBe('5620 6th Ave NW');
    expect(hasRedesignSuffix('4707 S Graham St [Redesign 1]')).toBe(true);
  });

  it('★★★ it is a NO-OP on an address that never had one — so it is safe to leave', () => {
    for (const [, after] of PAIRS) {
      expect(displayAddress(after)).toBe(after);
    }
  });

  it('★★ the helper and its call sites are still there', () => {
    const src = strip(read('src/lib/displayAddress.ts'));
    expect(src).toContain('export function displayAddress');
    expect(src).toContain('export function hasRedesignSuffix');
  });
});
