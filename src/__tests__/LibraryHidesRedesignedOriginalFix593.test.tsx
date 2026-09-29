// ===========================================================================
// ★★★ fix-593 (D-2026-09-28) — THE LIBRARY SHOWS THE CURRENT DESIGN
// ===========================================================================
//
// **Dave, via Bobby:** *"On the library, only show the current unit option, not
// the original, when a redesign is triggered… we are using the current unit
// dimensions, not the original, so we should not visibly show the original in
// the library matrix. A bunch of the original projects that were redesigned are
// blank in the library, as the current version has the unit data."*
//
// ---------------------------------------------------------------------------
// ★★★ THE THIRD RULING ON ONE FLAG, AND THE EVIDENCE MOVED UNDER IT
// ---------------------------------------------------------------------------
//
//   09-10  fix-524 briefed  hidden
//   09-11  fix-525 shipped  hatched  ← reversed ON EVIDENCE
//   09-28  fix-593 ships    hidden   ← this ticket
//
// fix-525 did not overrule anybody on taste. It measured that **11 of 17 pairs
// held their only `unit_types` on the ORIGINAL**, so hiding it emptied 65% of
// the redesign pairs out of the matrix the Library exists to be.
//
// ★★★ RE-MEASURED ON PROD 2026-09-28 — the objection has largely dissolved:
//
//       redesign pairs                                21  (was 17)
//       redesign carries its own units                16
//       ORIGINAL is the only copy                      3  ← 14%, was 11/17 = 65%
//       neither side has units                         2
//       chains (a redesign of a redesign)              0
//       originals with more than one redesign          0
//
//     16 of 21 redesigns now carry unit data they did not carry in September.
//     **That is why Dave's ask is safe now and was not seventeen days ago.**
//
// ⏸ §2 — THE THREE THAT STILL LOSE THEIR DATA ARE NAMED IN THE PR AND NOT
//   PATCHED: 12238 4th Ave NW (4 → 0) · 12836 N 60th St (1 → 0) ·
//   137 13th Ave (2 → 0). A fallback to the original when the redesign is blank
//   is a DIFFERENT rule with a different meaning and it is Bobby's to make.
//   **This file deliberately asserts that no such fallback exists** — see the
//   last describe block — so nobody adds one by accident.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Project, UnitType } from '../lib/database.types';
import LibraryMatrix from '../components/LibraryMatrix';
import {
  RETIRED_VISIBILITY,
  redesignedAwayProjectIds,
  retiredHiddenCounts,
  retiredHiddenFrom,
  retiredHiddenLabel,
} from '../lib/retiredState';

const T = 'test-tenant-uuid';
const NOW = '2026-09-28T12:00:00Z';

const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));
const cfgMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false, error: null }),
}));
// ★ The partial-mock trap, recorded in fix-407/514/519/562 and paid for again in
//   fix-592: `useAppConfig` returns a MAP and several readers call `.get` on it.
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: cfgMap.current, isLoading: false }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map?.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  },
}));

const unit = (over: Partial<UnitType> = {}): UnitType =>
  ({
    label: 'Detached',
    width_ft: 20,
    depth_ft: 40,
    qty: 1,
    stories: null,
    basement: null,
    parking_kind: null,
    parking_count: null,
    roof_deck: null,
    penthouse: null,
    ...over,
  }) as UnitType;

function project(id: string, units: UnitType[], over: Partial<Project> = {}): Project {
  return {
    id,
    address: `${id} Main St`,
    juris: 'Kirkland',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    product_types: ['Detached'],
    project_tags: [],
    units: units.length,
    zone: 'RM 3.6',
    alley: 'Yes',
    lot_width: 40,
    lot_depth: 90,
    lot_size_sf: 3600,
    is_corner_lot: true,
    is_regular_shape: true,
    num_lots: 1,
    redesign_of_project_id: null,
    unit_types: units as unknown as Project['unit_types'],
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

/**
 * The projects handed to the render, DEEP-FROZEN.
 *
 * ★★★ §3's *"no data moves"* asserted by construction rather than by comparing
 *     afterwards: a render that tried to write `unit_types` would THROW here in
 *     strict mode instead of quietly mutating and passing a later `toEqual`.
 *     The snapshot comparison is kept as well, because a non-strict write is
 *     silently dropped rather than thrown.
 */
function renderLibrary(projects: Project[]) {
  for (const p of projects) {
    Object.freeze(p);
    if (Array.isArray(p.unit_types)) {
      for (const u of p.unit_types) Object.freeze(u);
      Object.freeze(p.unit_types);
    }
  }
  refsProjects.current = projects;
  refsPermits.current = projects.map((p) => ({
    id: `perm-${p.id}`,
    project_id: p.id,
    type: 'Building Permit',
    stage: 'de',
    cycle: 1,
    corr_rounds: 0,
    submitted: null,
    status: null,
    portal_url: null,
    struct_address: null,
    parent_permit_id: null,
    expected_issue: null,
    approval_date: null,
    actual_issue: null,
    extras: null,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<LibraryMatrix />, { wrapper });
}

function rowIds(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="library-row-"]')).map(
    (n) => (n.getAttribute('data-testid') as string).replace('library-row-', ''),
  );
}

beforeEach(() => {
  // ★ The Library remembers its filters in sessionStorage (fix-403); without
  //   this the first test to switch views strands every later one.
  window.sessionStorage.clear();
  cfgMap.current = new Map<string, unknown>();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 §1 — an original with a redesign is absent; its redesign is present', () => {
  it('★★★ Dave\'s case: the blank original goes, the current design stays', () => {
    // The shape Dave is looking at — original blank, redesign carries the units.
    renderLibrary([
      project('orig', []),
      project('redesign', [unit({ width_ft: 22, depth_ft: 44 })], {
        redesign_of_project_id: 'orig',
      }),
    ]);
    expect(rowIds()).toEqual(['redesign']);
    expect(screen.queryByTestId('library-row-orig')).toBeNull();
  });

  it('★★★ …and it is the REDESIGN RELATIONSHIP that hides it, not a blank cell', () => {
    // ★★★ §1's ⛔: *"Do not key off `unit_types` being empty — blank is the
    //     SYMPTOM Dave described, not the rule."* So an original that carries
    //     units is hidden just the same (13 of the 21 pairs are this shape), and
    //     a project with no units and no redesign STAYS.
    renderLibrary([
      project('orig-with-units', [unit()], {}),
      project('rd', [unit()], { redesign_of_project_id: 'orig-with-units' }),
      project('lonely-blank', []),
    ]);
    const ids = rowIds();
    expect(ids).not.toContain('orig-with-units'); // hidden despite HAVING units
    expect(ids).toContain('rd');
    expect(ids).toContain('lonely-blank'); // blank but not redesigned — stays
  });

  it('★★★ a project with NO redesign is untouched — the 249-of-270 normal case', () => {
    renderLibrary([
      project('a', [unit()]),
      project('b', [unit()]),
      project('c', []),
    ]);
    expect(rowIds().sort()).toEqual(['a', 'b', 'c']);
  });

  it('★ an ARCHIVED redesign does not retire its original', () => {
    // fix-524's rule, unchanged and re-asserted here because fix-593 makes it
    // load-bearing: if the successor is filed away, the original is the live one
    // again — and hiding a project because of a row nobody can see would be the
    // worst version of this ticket.
    renderLibrary([
      project('orig', [unit()]),
      project('rd', [unit()], { redesign_of_project_id: 'orig', archived: true }),
    ]);
    expect(rowIds()).toContain('orig');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 §1 ★★ — a chain shows only the newest link', () => {
  it('★★★ the middle link is hidden too, with no chain-walking anywhere', () => {
    // ★★★ 0 chains exist on prod (measured 2026-09-28), and §1 ★★ says assert it
    //     anyway. It falls out of the rule for free: "has a live redesign →
    //     hidden" is recursive by construction, so `middle` is hidden because
    //     `newest` names it, exactly as `orig` is hidden because `middle` does.
    //     **Nothing walks the chain** — a depth-limited walk is what would have
    //     left the middle one visible.
    renderLibrary([
      project('orig', [unit({ width_ft: 10 })]),
      project('middle', [unit({ width_ft: 20 })], {
        redesign_of_project_id: 'orig',
      }),
      project('newest', [unit({ width_ft: 30 })], {
        redesign_of_project_id: 'middle',
      }),
    ]);
    expect(rowIds()).toEqual(['newest']);
  });

  it('★ two redesigns of ONE original: both stay, the original goes', () => {
    // Not a chain — a fork. 0 on prod, and the rule handles it without a
    // "newest" tie-break because neither sibling is named by anything.
    renderLibrary([
      project('orig', [unit()]),
      project('rd-1', [unit()], { redesign_of_project_id: 'orig' }),
      project('rd-2', [unit()], { redesign_of_project_id: 'orig' }),
    ]);
    expect(rowIds().sort()).toEqual(['rd-1', 'rd-2']);
  });

  it('★ a row naming ITSELF does not erase itself', () => {
    // `redesignedAwayProjectIds` guards this; asserted because a self-reference
    // would now HIDE the project rather than merely hatch it.
    renderLibrary([project('self', [unit()], { redesign_of_project_id: 'self' })]);
    expect(rowIds()).toEqual(['self']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 §3 — the totals agree with the visible rows', () => {
  it('★★★ the header count is the number of rows actually drawn', () => {
    renderLibrary([
      project('orig', []),
      project('rd', [unit()], { redesign_of_project_id: 'orig' }),
      project('plain', [unit()]),
    ]);
    // 3 projects in, 1 hidden, 2 rows out — and the headline says 2.
    expect(rowIds()).toHaveLength(2);
    expect(screen.getByTestId('library-count').textContent).toContain('2 projects');
  });

  it('★★★ the hide SAYS SO, and names the cause rather than calling it "cancelled"', () => {
    renderLibrary([
      project('orig', []),
      project('rd', [unit()], { redesign_of_project_id: 'orig' }),
      project('plain', [unit()]),
    ]);
    const hidden = screen.getByTestId('library-retired-hidden').textContent ?? '';
    // ★★★ fix-524's copy was `"N cancelled hidden"`. Calling a redesign original
    //     "cancelled" is the header disagreeing with its own rows — the class the
    //     brief's ★ warns about (Bobby has caught it twice: 50-vs-48, 332-vs-65).
    expect(hidden).toContain('1 redesigned');
    expect(hidden).not.toContain('cancelled');
    expect(hidden).toContain('hidden');
  });

  it('★★★ the enumerated causes SUM to what actually vanished', () => {
    // The invariant `hiddenRetiredCount` used to carry, asserted against the DOM
    // instead: every project that went missing is accounted for by name. A third
    // cause added to RETIRED_VISIBILITY with no label fails HERE.
    const projects = [
      project('o1', []),
      project('r1', [unit()], { redesign_of_project_id: 'o1' }),
      project('o2', [unit()]),
      project('r2', [unit()], { redesign_of_project_id: 'o2' }),
      project('plain-1', [unit()]),
      project('plain-2', []),
    ];
    renderLibrary(projects);
    const drawn = rowIds().length;
    const hidden = screen.getByTestId('library-retired-hidden').textContent ?? '';
    const enumerated = Array.from(hidden.matchAll(/(\d+)\s+\w+/g)).reduce(
      (s, m) => s + Number(m[1]),
      0,
    );
    expect(enumerated).toBe(projects.length - drawn);
    expect(drawn).toBe(4);
  });

  it('★★★ the UNIT view agrees too — it is derived from the same population', () => {
    // §3 ★: *"A hidden row that still counts is the discrepancy class Bobby has
    // caught twice."* The unit view reshapes `filtered`, which comes off
    // `visibleProjects`, so the original's units must not appear as unit rows.
    renderLibrary([
      project('orig', [unit({ width_ft: 99, depth_ft: 99 })]),
      project('rd', [unit({ width_ft: 22, depth_ft: 44 })], {
        redesign_of_project_id: 'orig',
      }),
    ]);
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    const table = screen.getByTestId('library-table-unit');
    // The original's 99×99 unit is not in the matrix at all…
    expect(within(table).queryByText('99')).toBeNull();
    // …and the headline counts one unit across one project, not two.
    expect(screen.getByTestId('library-count').textContent).toContain('1 unit');
    expect(screen.getByTestId('library-count').textContent).toContain('1 project');
  });

  it('★ nothing is said when nothing is hidden', () => {
    renderLibrary([project('a', [unit()])]);
    expect(screen.queryByTestId('library-retired-hidden')).toBeNull();
    // ★ …and the `· N superseded` span is gone with the ruling, because nothing
    //   is hatched in the Library any more.
    expect(screen.queryByTestId('library-retired-shown')).toBeNull();
  });

  it('★★ the superseded-shown span is absent even WITH a redesign pair', () => {
    // Both causes are `library: 'hidden'` now, so `hatchedIds` is empty by
    // ruling. The span self-hides rather than printing `· 0 superseded`.
    renderLibrary([
      project('orig', [unit()]),
      project('rd', [unit()], { redesign_of_project_id: 'orig' }),
    ]);
    expect(screen.queryByTestId('library-retired-shown')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 §3 — no data moves, and no other surface changes', () => {
  it('★★★ `unit_types` is byte-identical across the render', () => {
    const before = [
      project('orig', [unit({ width_ft: 16, depth_ft: 36, qty: 2 })]),
      project('rd', [unit({ width_ft: 22, depth_ft: 44 })], {
        redesign_of_project_id: 'orig',
      }),
    ];
    const snapshot = JSON.stringify(before.map((p) => p.unit_types));
    renderLibrary(before);
    // ★ The fixtures are deep-frozen by `renderLibrary`, so a write would have
    //   thrown; this catches the non-strict case, where a write is dropped.
    expect(JSON.stringify(before.map((p) => p.unit_types))).toBe(snapshot);
    // ★★ And the ROW COUNT of the source list is unchanged — §3's *"assert the
    //    row count before and after"*. This is a display rule; `projects` is an
    //    input, not a thing the Library edits.
    expect(before).toHaveLength(2);
  });

  it('★★★ the hide reaches the LIBRARY ONLY', () => {
    // §3's ⛔: *"Do not hide originals anywhere else — not Projects, not Reports,
    // not the Draw Schedule, not search. A project that vanishes from a screen
    // somebody uses is a worse bug than the one being fixed."*
    const sets = {
      redesignedIds: redesignedAwayProjectIds([
        { id: 'orig', archived: false, redesign_of_project_id: null },
        { id: 'rd', archived: false, redesign_of_project_id: 'orig' },
      ]),
    };
    expect(retiredHiddenFrom('library', 'orig', sets)).toBe(true);
    // ★★★ THE BOARD IS THE ONE THAT MATTERS: a retired block still consumed a
    //     designer's weeks, and hiding it would make the schedule lie about
    //     capacity. Unchanged by this ticket.
    expect(retiredHiddenFrom('drawSchedule', 'orig', sets)).toBe(false);
    expect(RETIRED_VISIBILITY.redesigned.drawSchedule).toBe('hatched');
    // ★ Pipeline was ALREADY hidden — fix-524 — so this is not a change either.
    expect(RETIRED_VISIBILITY.redesigned.pipeline).toBe('hidden');
    // ★ And there is exactly one surface key that says 'hidden' newly. The other
    //   two are what they were.
    expect(RETIRED_VISIBILITY.redesigned).toEqual({
      pipeline: 'hidden',
      library: 'hidden',
      drawSchedule: 'hatched',
    });
  });

  it('★★ one caller, so the rule cannot leak to a second surface', () => {
    // The hide is consulted in exactly one place. A second caller asking
    // `retiredHiddenFrom('library', …)` from another screen would be this
    // ticket's ⛔ arriving sideways.
    const files = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const callers = Object.entries(files)
      .filter(
        ([path, src]) =>
          // ★ `.test.` as well as `__tests__`: this file's own directory IS
          //   `__tests__`, so its siblings resolve as `./Foo.test.ts` with the
          //   directory name nowhere in the path. Caught by this assertion
          //   listing two of its own neighbours.
          !path.includes('__tests__') &&
          !/\.test\.tsx?$/.test(path) &&
          !path.includes('/retiredState.ts') &&
          /retiredHiddenFrom\(\s*'library'/.test(src),
      )
      .map(([path]) => path);
    expect(callers).toEqual(['../components/LibraryMatrix.tsx']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 §2 — the three that lose their data, and the fallback that is NOT here', () => {
  it('★★★ a blank redesign over a unit-carrying original empties the address', () => {
    // ⏸ **THIS IS THE STOP-AND-REPORT CASE, ASSERTED AS IT SHIPS.** 3 prod pairs:
    //   12238 4th Ave NW (4 unit types → 0) · 12836 N 60th St (1 → 0) ·
    //   137 13th Ave (2 → 0). Dave's fix, applied to them, makes the Library
    //   emptier rather than truer.
    //
    // ★★★ IT IS A TEST RATHER THAN A TODO because the behaviour is intentional
    //     and somebody will otherwise "fix" it. If Bobby rules for a fallback,
    //     THIS test is the one that should fail and be rewritten — deliberately,
    //     not by accident.
    renderLibrary([
      project('orig', [unit({ width_ft: 16, depth_ft: 36 })]),
      project('rd', [], { redesign_of_project_id: 'orig' }),
    ]);
    expect(rowIds()).toEqual(['rd']);
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    // No unit rows at all for that address: the only copy was on the original.
    expect(screen.getByTestId('library-count').textContent).toContain('0 units');
  });

  it('★★★ and nothing reads the original through as a fallback', () => {
    // §2: *"do not invent a fallback."* Asserted against the source, because the
    // temptation is a one-liner in `buildLibraryRows` and it would be invisible
    // in behaviour until somebody checked these three addresses.
    const files = import.meta.glob('../{lib,components}/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const src = Object.entries(files)
      .filter(([p]) => /libraryHelpers|libraryUnitRows|LibraryMatrix/.test(p))
      .map(([, s]) => s)
      .join('\n');
    // Nothing in the Library's own modules resolves the original's id.
    expect(src).not.toMatch(/redesign_of_project_id\s*\)?\s*\?\?/);
    expect(src).not.toContain('unitsFromOriginal');
    expect(src).not.toContain('fallbackUnitTypes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-593 — the label helper, at the grain a reader sees', () => {
  const sets = {
    cancelledIds: new Set(['c1', 'c2']),
    redesignedIds: new Set(['o1', 'o2', 'o3']),
  };
  const ids = ['c1', 'c2', 'o1', 'o2', 'o3', 'live'];

  it('counts each cause separately', () => {
    const counts = retiredHiddenCounts('library', ids, sets);
    expect(counts.get('cancelled')).toBe(2);
    expect(counts.get('redesigned')).toBe(3);
  });

  it('★★ names both, in a fixed order, with the shared vocabulary', () => {
    // ★ The words come from `RETIRED_PALETTE`, so the header cannot drift from
    //   the Draw Schedule's legend — the header used to say "superseded" while
    //   every other surface said "Redesigned".
    expect(retiredHiddenLabel(retiredHiddenCounts('library', ids, sets))).toBe(
      '2 cancelled, 3 redesigned hidden',
    );
  });

  it('★ a single cause reads as it always did', () => {
    expect(
      retiredHiddenLabel(
        retiredHiddenCounts('library', ['c1'], { cancelledIds: new Set(['c1']) }),
      ),
    ).toBe('1 cancelled hidden');
  });

  it('★ null when nothing is hidden, so the span can be absent', () => {
    expect(retiredHiddenLabel(new Map())).toBeNull();
    expect(retiredHiddenLabel(retiredHiddenCounts('library', ['live'], sets))).toBeNull();
  });

  it('★★ a surface where the cause is NOT hidden contributes nothing', () => {
    // The same ids, asked about the board: nothing is hidden there, so the
    // helper cannot be used to report a hide that did not happen.
    expect(retiredHiddenCounts('drawSchedule', ids, sets).size).toBe(0);
  });
});
