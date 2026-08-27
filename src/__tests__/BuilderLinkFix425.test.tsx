import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';
import migrationSql from '../../migrations/fix_425_builder_link.sql?raw';

// ===========================================================================
// fix-425 — the builder catalog exists and nothing links to it
// ===========================================================================
//
// ★★★ STEP 0, MEASURED READ-ONLY ON PROD 2026-08-28. Four claims, four
// answers, and two of them correct the brief.
//
//  1. NEITHER RPC WRITES builder_id — CONFIRMED. `pg_get_functiondef` on both
//     `bp_create_project_with_permits` and `bp_update_project_with_permits`
//     contains 'builders' and does NOT contain 'builder_id'. Both are defined
//     across many migrations (create: fix_91/96/107/141/143/144/153/158/163/
//     175/208/210/216b/222/244; update: fix_66/91/175/382) — migrations/ is
//     partial and prod is ahead, which is why fix-425 patches the LIVE
//     definition by anchor rather than retyping either one.
//
//  2. NO CLIENT PATH WRITES IT — CONFIRMED, and **it is a REGRESSION, not a
//     gap.** The brief did not know which; the history does. The write
//     existed for ONE DAY: Q9.5.f-fix-17 (e8a5aed, 2026-05-13) upserted a
//     builder and set `builder_id: builderId` in the project patch;
//     Q9.5.f-fix-22 (9d2269c, 2026-05-14) removed it along with the
//     project-level field migration, and nothing replaced it. The comment in
//     useUpdateProject was NOT aspirational — it outlived its code by three
//     and a half months.
//
//  3. `fillFromBuilder` FILLS TEXT AND NO ID — CONFIRMED in all three places
//     (ProjectSettingsModal ~309, Step1ProjectInfo ~342, ProjectDetailHeader
//     ~1882). Each fills five fields — name, company, email, phone and
//     fix-175's entity address. `BuilderAutocompleteField` already hands the
//     whole `Builder` (id included) to `onSelectBuilder`, so it needed no
//     change at all.
//
//  4. WHERE THE 33 LINKS CAME FROM — **all 33 projects were created
//     2026-05-01**, the initial import. Not the one-day client write, not a
//     live path: no trigger on `public.projects` touches builder_id (all
//     eight are logging, target-submit, lead cascade, DM co-assign, tenant
//     default, post seeding and the updated_at token). Nothing has linked a
//     project in four months. The brief's premise holds.
//
// ---------------------------------------------------------------------------
// ★★★ AND THE COUNTS MOVED. The brief predicted 201 projects / 168 with a
// company / 114 unlinked-with-text / 113 matchable. Measured 2026-08-28:
//
//     202 projects · 147 with a non-blank builder_company · 33 linked
//     115 unlinked with text · **114 exactly matchable** · 1 not
//
// The shape is exactly as briefed — one and only one exception — but the
// backfill writes **114**, not 113. "168 with a builder company" could not be
// reproduced under any reading (147 non-blank company, 150 non-blank name,
// 150 either). Reported rather than absorbed, per the brief's own rule.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

// ---------------------------------------------------------------------------
// §A · the backfill predicate, mirrored, against the REAL distinct values
// ---------------------------------------------------------------------------
//
// ★ There is no live database in CI (see the fix-153 pattern), so the SQL is
//   mirrored in TS here and probed for real against prod inside a rolled-back
//   transaction before the backfill runs. This half is the one that can fail
//   the build.

/** Case- and whitespace-insensitive, and nothing else. No trigram, no
 *  similarity, no "close enough" — a project that does not match exactly is
 *  reported for Bobby to decide, never guessed at. */
function norm(v: string | null | undefined): string | null {
  const k = (v ?? '').trim().toLowerCase();
  return k === '' ? null : k;
}

interface CatalogRow {
  id: string;
  name: string | null;
  company: string | null;
}

/**
 * ★★★ THE BACKFILL MATCHES ON (name, company) — THE CATALOG'S OWN UNIQUE KEY —
 * AND THE BRIEF'S company-ONLY RULE WOULD HAVE COIN-FLIPPED TWO ROWS.
 *
 * The brief said *"Match on lower(btrim(builders.company)) = lower(btrim(
 * projects.builder_company)), exact only."* Measured on prod: the catalog holds
 * **two rows** whose company is `JMS Homes, Inc` — Bill Richmond and Will
 * Richmond, same email, same phone — because the table's unique index is
 * `(name, company)` and two people at one firm are two rows. Two projects match
 * both, and a plain `UPDATE … FROM builders` would have picked one arbitrarily.
 *
 * ★★ Two candidates is not an exact match, it is an ambiguity, and the brief's
 *    own rule forbids guessing. Using the FULL key is not fuzzier — it is
 *    stricter — and it resolves both: 7708 44th Ave NE names Will Richmond,
 *    6217 45th Ave NE names Bill Richmond. It is also the same key the RPCs'
 *    `ON CONFLICT (name, company)` uses, so the backfill and the live path
 *    agree by construction rather than by coincidence.
 *
 * ★ The company-only fallback stays for the rows whose builder_name does not
 *   match a catalog name — but ONLY where the company is unique in the
 *   catalog. Ambiguous company, no name match ⇒ reported.
 */
function linkFor(
  project: { builder_name?: string | null; builder_company?: string | null },
  catalog: ReadonlyArray<CatalogRow>,
): string | null {
  const company = norm(project.builder_company);
  if (company === null) return null;
  const name = norm(project.builder_name);
  const byCompany = catalog.filter((b) => norm(b.company) === company);
  if (byCompany.length === 0) return null;
  if (name !== null) {
    const exact = byCompany.filter((b) => norm(b.name) === name);
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return null; // cannot happen under the unique index
  }
  // ★ No name match: link only when the company alone is unambiguous.
  return byCompany.length === 1 ? byCompany[0].id : null;
}

/** ★ The real distinct `lower(btrim(builder_company))` values across the 115
 *  unlinked projects that carry builder text, with their project counts and
 *  whether the catalog holds them. Read off prod 2026-08-28. */
const UNLINKED_REAL: ReadonlyArray<[string, number, boolean]> = [
  ['pacific northwest siding and windows inc', 1, false],
  ['kuleana homes llc', 16, true],
  ['premier homes, llc', 7, true],
  ['roland development, llc', 6, true],
  ['cushing building group, inc.', 5, true],
  ['d & c homes llc', 4, true],
  ['haushund, llc', 4, true],
  ['imagine homes, inc', 4, true],
  ['orion nw development, llc', 4, true],
  ['seattle development, llc', 4, true],
  ['cooper thomas homes, llc', 3, true],
  ['ecoworks homes, inc', 3, true],
  ['granger and company', 3, true],
  ['kanebuilt llc', 3, true],
  ['pivotal homes llc', 3, true],
  ['tcl construction', 3, true],
  ['upper left living, llc', 3, true],
  ['5811 greenwood llc', 2, true],
  ['6825 seward llc', 2, true],
  ['collz, inc', 2, true],
  ['greenwalk construction, llc', 2, true],
  ['hauslebauer, llc', 2, true],
  ["jake'sd corporation", 2, true],
  ['jms homes, inc', 2, true],
  ['loyal development nw, llc', 2, true],
  ['swett equity llc', 2, true],
  ['westcost homes, llc', 2, true],
  ['6340 4th ave ne, llc', 1, true],
  ['av homes, llc', 1, true],
  ['baker investment partners, llc', 1, true],
  ['block ii, llc', 1, true],
  ['build sound, llc', 1, true],
  ['bungalow builders, llc', 1, true],
  ['bunny brigade llc', 1, true],
  ['domicile homes, llc', 1, true],
  ['forsyth homes, llc', 1, true],
  ['grechannyy llc', 1, true],
  ['lns construction, llc', 1, true],
  ['madrow homes, llc', 1, true],
  ['rk homes llc', 1, true],
  ['rk homes, llc', 1, true],
  ['roosevelt & 65th llc', 1, true],
  ['rosedale llc', 1, true],
  ['topography homes 3 lp', 1, true],
  ['upside homes, llc', 1, true],
  ['west coast building inc.', 1, true],
];

describe('fix-425 §A: the backfill links 114 and reports 1', () => {
  // One catalog row per in-catalog company, with a distinct contact name.
  const catalog: CatalogRow[] = UNLINKED_REAL.filter(([, , c]) => c).map(
    ([key], i) => ({ id: `b-${i}`, name: `Contact ${i}`, company: key }),
  );
  const nameFor = (key: string) =>
    catalog.find((b) => b.company === key)?.name ?? 'Somebody Else';
  const projects = UNLINKED_REAL.flatMap(([key, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${key}#${i}`,
      builder_name: nameFor(key),
      builder_company: key,
    })),
  );

  it('★★★ 114 link and 1 is reported — NOT the 113 the brief predicted', () => {
    expect(projects).toHaveLength(115);
    const linked = projects.filter((p) => linkFor(p, catalog) !== null);
    const unmatched = projects.filter((p) => linkFor(p, catalog) === null);
    expect(linked).toHaveLength(114);
    expect(unmatched).toHaveLength(1);
    // ★ The one exception, by name. 4000 SW Concord St on prod.
    expect(unmatched[0].builder_company).toBe(
      'pacific northwest siding and windows inc',
    );
  });

  it('★★★ TWO PEOPLE AT ONE FIRM RESOLVE BY NAME, not by a coin flip', () => {
    // ★★★ THE REAL CASE THE BRIEF DID NOT ANTICIPATE. The catalog holds two
    //     `JMS Homes, Inc` rows — Bill Richmond and Will Richmond, same email,
    //     same phone — because its unique index is (name, company). Two
    //     projects match both on company alone, and the brief's company-only
    //     `UPDATE … FROM builders` would have picked one ARBITRARILY.
    const cat: CatalogRow[] = [
      { id: 'jms-bill', name: 'Bill Richmond', company: 'JMS Homes, Inc' },
      { id: 'jms-will', name: 'Will Richmond', company: 'JMS Homes, Inc' },
    ];
    expect(
      linkFor({ builder_name: 'Will Richmond', builder_company: 'JMS Homes, Inc' }, cat),
    ).toBe('jms-will');
    expect(
      linkFor({ builder_name: 'Bill Richmond', builder_company: 'JMS Homes, Inc' }, cat),
    ).toBe('jms-bill');
    // ★★ And an ambiguous company with NO name match is REPORTED, never
    //    guessed — which is the brief's own rule applied to a case it did not
    //    know about.
    expect(
      linkFor({ builder_name: 'Someone Else', builder_company: 'JMS Homes, Inc' }, cat),
    ).toBeNull();
    expect(
      linkFor({ builder_name: null, builder_company: 'JMS Homes, Inc' }, cat),
    ).toBeNull();
  });

  it('★★ a unique company links even when the contact name differs', () => {
    // The common case: one row for the firm, and the project records a
    // different person there. Unambiguous, so it links.
    const cat: CatalogRow[] = [
      { id: 'b1', name: 'Boyd Lybeck', company: 'Kuleana Homes LLC' },
    ];
    expect(
      linkFor({ builder_name: 'Someone New', builder_company: 'Kuleana Homes LLC' }, cat),
    ).toBe('b1');
  });

  it('★★★ it matches on case and whitespace ONLY — never on similarity', () => {
    const cat: CatalogRow[] = [
      { id: 'b1', name: 'Boyd Lybeck', company: '  Kuleana Homes LLC ' },
    ];
    const at = (company: string) => linkFor({ builder_name: null, builder_company: company }, cat);
    // Case and padding are normalised away…
    expect(at('kuleana homes llc')).toBe('b1');
    expect(at('  KULEANA HOMES LLC')).toBe('b1');
    // …and nothing else is. These are the near-duplicates the brief put out
    // of scope, and a fuzzy matcher would silently merge them.
    expect(at('Kuleana Homes')).toBeNull();
    expect(at('Kuleana Homes, LLC')).toBeNull();
  });

  it('★★ `rk homes llc` and `rk homes, llc` stay two builders', () => {
    // ★ Both are real, both are in the catalog, and one project names each.
    //   Out of scope by ruling: this ticket does not merge, rename or
    //   deactivate a catalog row, even one that looks like a duplicate.
    const cat: CatalogRow[] = [
      { id: 'rk-a', name: 'A', company: 'RK Homes LLC' },
      { id: 'rk-b', name: 'B', company: 'RK Homes, LLC' },
    ];
    expect(linkFor({ builder_name: null, builder_company: 'rk homes llc' }, cat)).toBe('rk-a');
    expect(linkFor({ builder_name: null, builder_company: 'rk homes, llc' }, cat)).toBe('rk-b');
  });

  it('★ a project with no builder text is never linked', () => {
    const cat: CatalogRow[] = [{ id: 'b1', name: 'A', company: 'Anything' }];
    for (const company of [null, '', '   ']) {
      expect(linkFor({ builder_name: 'A', builder_company: company }, cat)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §B · the RPC's three-state rule, mirrored
// ---------------------------------------------------------------------------

/** ★★★ THE RULE THE MIGRATION INSTALLS, in the shape the SQL implements it.
 *  Three states, and conflating any two of them is the bug:
 *    · the patch names a builder      → link to the resolved catalog row
 *    · the patch CLEARS the name      → drop the link (never dangle)
 *    · the patch never mentions it    → leave the link exactly as it was */
function rpcBuilderLink(
  patch: Record<string, unknown>,
  existing: string | null,
  resolve: (name: string, company: string | null) => string,
): { builderId: string | null; createdCatalogRow: boolean } {
  const hasName = Object.prototype.hasOwnProperty.call(patch, 'builder_name');
  const name = String(patch.builder_name ?? '').trim();
  if (name !== '') {
    const company = (patch.builder_company as string | null) ?? null;
    return { builderId: resolve(name, company), createdCatalogRow: true };
  }
  if (hasName) return { builderId: null, createdCatalogRow: false };
  return { builderId: existing, createdCatalogRow: false };
}

describe('fix-425 §B: what the RPCs now do with builder_id', () => {
  const resolve = (name: string, company: string | null) =>
    `catalog:${name}|${company ?? ''}`;

  it('★★★ an existing builder is linked, not duplicated', () => {
    const r = rpcBuilderLink(
      { builder_name: 'Boyd Lybeck', builder_company: "Jake'sD Corporation" },
      null,
      resolve,
    );
    // ON CONFLICT (name, company) DO UPDATE always returns a row, so the id
    // comes back on the conflict path exactly as on the insert path.
    expect(r.builderId).toBe("catalog:Boyd Lybeck|Jake'sD Corporation");
  });

  it('★★★ a NEW builder becomes a catalog row AND the project links to it', () => {
    // Bobby, 2026-08-28: a typed name that is not in the list becomes a new
    // catalog row and the project links to it. The RPCs already did the first
    // half; fix-425 keeps the id instead of throwing it away, so there is no
    // separate "Add to list" button to build.
    const r = rpcBuilderLink({ builder_name: 'Brand New Homes' }, null, resolve);
    expect(r.createdCatalogRow).toBe(true);
    expect(r.builderId).toBe('catalog:Brand New Homes|');
  });

  it('★★★ a save that never mentions the builder leaves the link ALONE', () => {
    const r = rpcBuilderLink({ zone: 'NR3', units: 4 }, 'b-existing', resolve);
    expect(r.builderId).toBe('b-existing');
    expect(r.createdCatalogRow).toBe(false);
  });

  it('★★★ clearing the builder CLEARS the link rather than dangling', () => {
    // A project that names no builder must not still point at one — that is
    // worse for "group by builder" than no reference at all.
    const r = rpcBuilderLink({ builder_name: '' }, 'b-existing', resolve);
    expect(r.builderId).toBeNull();
    expect(r.createdCatalogRow).toBe(false);
  });

  it('★★★ fix-174 IS UNTOUCHED: no name ⇒ no catalog row, ever', () => {
    // ★ The regression guard, asserted as an ABSENCE. fix-24b promoted a
    //   builder whenever a patch carried a name, and the Overview cell commits
    //   on blur, so "boy" and "stas" became catalog rows. fix-174 moved
    //   creation to an explicit complete commit; fix-425 adds a link at that
    //   same moment and does not widen it by one case.
    for (const patch of [{}, { builder_name: '' }, { builder_name: '   ' }, { builder_company: 'X Homes' }]) {
      expect(rpcBuilderLink(patch, null, resolve).createdCatalogRow).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §C · the migration itself
// ---------------------------------------------------------------------------

/** ★ SQL line comments removed, so an assertion about what the migration DOES
 *  cannot be satisfied — or defeated — by what its header SAYS. */
function stripSqlComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '');
}

describe('fix-425 §C: the migration patches by anchor and is idempotent', () => {
  it('★★★ it never retypes either function', () => {
    // ★ migrations/ is partial and prod is ahead — both functions have been
    //   re-defined by more than a dozen tickets since. Retyping 15KB of live
    //   PL/pgSQL to add four lines is how a fix silently reverts fourteen
    //   others, so this reads pg_get_functiondef and substitutes.
    expect(migrationSql.length).toBeGreaterThan(500); // ?raw actually loaded
    expect(migrationSql).toContain('pg_get_functiondef');
    expect(migrationSql).toContain('EXECUTE v_def');
    // Not a hand-written CREATE OR REPLACE of either function.
    expect(migrationSql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.bp_(create|update)_project_with_permits\(/);
  });

  it('★★★ every anchor is asserted to appear EXACTLY ONCE', () => {
    // A missing or duplicated anchor must raise, not silently patch nothing
    // or patch the wrong place.
    const guards = migrationSql.match(/expected 1', v_n/g) ?? [];
    expect(guards.length).toBe(4); // two anchors x two functions
    expect(migrationSql).toContain('RAISE EXCEPTION');
  });

  it('★★ it is idempotent — a second run is a no-op', () => {
    expect(
      (migrationSql.match(/position\('builder_id' IN v_def\) > 0/g) ?? []).length,
    ).toBe(2);
  });

  it('★★ it links and it clears, and it does not widen catalog creation', () => {
    expect(migrationSql).toContain('RETURNING id INTO v_builder_id');
    expect(migrationSql).toContain('SET builder_id = v_builder_id');
    expect(migrationSql).toContain('SET builder_id = NULL');
    // ★ The IF gate that decides when a catalog row is created is fix-174's
    //   and is not part of any anchor's replacement text.
    //
    // ★★ ASSERTED ON THE EXECUTABLE TEXT, NOT THE FILE. The header comment
    //    QUOTES fix-174's insert in order to explain what is being preserved,
    //    and prose that contains SQL is counted as SQL by a naive `toContain`.
    //    This is the seventh time that trap has been hit in this repo; the
    //    strip is the fix, not a looser assertion.
    expect(stripSqlComments(migrationSql)).not.toContain('INSERT INTO public.builders');
  });
});

// ---------------------------------------------------------------------------
// §D · the Project Overview Builder/Owner cell
// ---------------------------------------------------------------------------

const searchResults = vi.hoisted(() => ({ current: [] as Builder[] }));
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return { data: [], isLoading: false };
    return {
      data: searchResults.current.filter(
        (b) =>
          (b.name ?? '').toLowerCase().includes(needle) ||
          (b.company ?? '').toLowerCase().includes(needle),
      ),
      isLoading: false,
    };
  },
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function builder(over: Partial<Builder>): Builder {
  return {
    id: 'b-x', name: 'X', company: null, email: null, phone: null,
    address: null, notes: null, active: true, ...over,
  };
}

function projectFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'p-425', address: '500 Pike St', juris: 'Seattle', archived: false,
    notes: null, acq_lead: null, external_team: {}, builder_id: null,
    permit_order: [], entitlement_lead: null, design_manager: null,
    go_date: null, units: null, zone: null, lot_width: null, lot_depth: null,
    unit_types: null, parking_type: null, parking_stalls: null, alley: null,
    product_types: [], project_tags: null, builder_name: null,
    builder_company: null, builder_email: null, builder_phone: null,
    created_at: NOW, updated_at: NOW, ...over,
  } as unknown as Parameters<typeof ProjectDetailHeader>[0]['project'];
}

function renderCell(over: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={projectFixture(over)} permits={[]} bp={null} />,
    { wrapper },
  );
}

beforeEach(() => {
  searchResults.current = [];
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-425 §D: the Overview picker records which builder', () => {
  it('★★★ picking a catalog builder carries its id in the SAME patch', async () => {
    // ★★ THIS IS THE ONE PICK PATH THAT NEEDS THE ID CLIENT-SIDE. The Settings
    //    modal and the wizard both save through the two RPCs, which now
    //    resolve the builder server-side from the name + company they are
    //    given — the same (name, company) key the catalog's unique index uses,
    //    and strictly more correct than a carried id, because somebody who
    //    picks a builder and then edits the name has chosen a different one.
    //    This cell writes the projects table directly (fix-99's
    //    useUpdateProject), so here the id must travel with the pick.
    searchResults.current = [
      builder({ id: 'b-kuleana', name: 'Boyd Lybeck', company: 'Kuleana Homes LLC' }),
    ];
    renderCell();
    fireEvent.change(screen.getByTestId('pd-builder-name'), {
      target: { value: 'boyd' },
    });
    fireEvent.click(screen.getByTestId('pd-builder-name-option-b-kuleana'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.builder_id).toBe('b-kuleana');
    // ★ The five text fields still travel with it — this ticket ADDS the id
    //   beside them, it does not replace them with a join.
    expect(patch.builder_name).toBe('Boyd Lybeck');
    expect(patch.builder_company).toBe('Kuleana Homes LLC');
    // ONE save, not six: fix-24d's atomic-patch rule is untouched.
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('★★★ a blur-committed partial name writes NO id and NO catalog row', async () => {
    // ★ fix-174's regression, asserted as an absence on the surface that
    //   caused it. "boy" is exactly the fragment that littered the catalog.
    renderCell();
    const input = screen.getByTestId('pd-builder-name');
    fireEvent.change(input, { target: { value: 'boy' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.builder_name).toBe('boy');
    expect('builder_id' in patch).toBe(false);
  });

  it('★★★ clearing the name on the cell drops the link', async () => {
    // The dangling-reference case, on the one surface that can produce it.
    renderCell({ builder_name: 'Boyd Lybeck', builder_id: 'b-kuleana' });
    const input = screen.getByTestId('pd-builder-name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.builder_name).toBeNull();
    expect(patch.builder_id).toBeNull();
  });

  it('★★ editing an UNRELATED builder field leaves the link alone', async () => {
    renderCell({ builder_name: 'Boyd Lybeck', builder_id: 'b-kuleana' });
    const phone = screen.getByTestId('pd-builder-phone');
    fireEvent.change(phone, { target: { value: '(206) 555-0100' } });
    fireEvent.blur(phone);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(patch.builder_phone).toBe('(206) 555-0100');
    expect('builder_id' in patch).toBe(false);
  });
});
