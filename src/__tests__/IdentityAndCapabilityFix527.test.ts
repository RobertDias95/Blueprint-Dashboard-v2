import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  WORK_DATA_COLUMNS,
  collectWorkDataNames,
  mayEditLibrary,
  resolveNameLinks,
  unmappedCount,
} from '../lib/workDataNames';

// ===========================================================================
// fix-527 — the app learns who you are (P-243 · P-225)
// ===========================================================================
//
// ★ Source assertions strip comments first — a "must not appear" grep matching
//   its own gravestone is now a nine-times-recorded trap in this repo.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

const member = (name: string, email: string | null, over = {}) =>
  ({ name, email, ...over }) as Parameters<typeof resolveNameLinks>[1][number];

// ---------------------------------------------------------------------------
// §A — collecting the names
// ---------------------------------------------------------------------------

describe('fix-527 §A — every name the work data holds, and what it costs', () => {
  const projects = [
    { id: 'p1', design_manager: 'Ainsley', schematic_designer: ['Jade', 'Marc'] },
    { id: 'p2', design_manager: null, schematic_designer: null },
  ] as unknown as Parameters<typeof collectWorkDataNames>[0];
  const permits = [
    { project_id: 'p1', da: 'Marc', ent_lead: 'Bobby', dm: null },
    { project_id: 'p1', da: 'Marc', ent_lead: 'Bobby', dm: null },
    { project_id: 'p2', da: 'Marc', ent_lead: null, dm: 'Ainsley' },
  ] as unknown as Parameters<typeof collectWorkDataNames>[1];
  const draw = [
    { project_id: 'p1', da_assigned: 'Marc' },
    { project_id: 'p2', da_assigned: '  ' },
  ];

  it('★★ counts DISTINCT PROJECTS, not rows', () => {
    // ★ `Marc` is on two of p1's permits AND p1's draw block. A list that said
    //   "4" would make a two-project decision look like a four-project one —
    //   and the count is there precisely so Bobby can see what a mapping
    //   decision COSTS.
    const names = collectWorkDataNames(projects, permits, draw);
    expect(names.find((n) => n.name === 'Marc')?.projects).toBe(2);
    expect(names.find((n) => n.name === 'Ainsley')?.projects).toBe(2);
    expect(names.find((n) => n.name === 'Bobby')?.projects).toBe(1);
  });

  it('★★ reads all six columns, including the ARRAY one', () => {
    // ★ `projects.schematic_designer` is a text[] — the one of the six that is.
    //   A loop that treated it as a string would silently drop every schematic
    //   designer, and the list would look complete.
    const names = collectWorkDataNames(projects, permits, draw);
    expect(names.map((n) => n.name).sort()).toEqual(['Ainsley', 'Bobby', 'Jade', 'Marc']);
    expect(names.find((n) => n.name === 'Jade')?.columns).toEqual([
      'projects.schematic_designer',
    ]);
    expect(WORK_DATA_COLUMNS).toHaveLength(6);
  });

  it('★ blanks and whitespace are not names', () => {
    expect(collectWorkDataNames([], [], [{ project_id: 'p', da_assigned: '   ' }])).toEqual([]);
    expect(collectWorkDataNames([], [], [{ project_id: 'p', da_assigned: null }])).toEqual([]);
  });

  it('★★ one person typed two ways is ONE row to map', () => {
    // ★ Case folds; the first spelling seen is what gets displayed. Two rows
    //   for `Marc` and `marc` would be two decisions for one human, and the
    //   second one would eventually be answered differently.
    const names = collectWorkDataNames(
      [],
      [],
      [
        { project_id: 'a', da_assigned: 'Marc' },
        { project_id: 'b', da_assigned: 'marc' },
      ],
    );
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({ name: 'Marc', projects: 2 });
  });
});

// ---------------------------------------------------------------------------
// §A — resolving them. FAIL CLOSED.
// ---------------------------------------------------------------------------

describe('fix-527 §A — an unmapped name grants NOTHING', () => {
  const names = [{ name: 'Alex', projects: 4, columns: [] as never[] }];

  it('★★★ a roster row with no email is UNMAPPED, not linked', () => {
    // ★★★ THE FOUR REAL ONES: `George · Alex · Chad · Nidhi`, every one a
    //     roster row with a blank email, holding 22 of 870 name→project hits.
    //     They must resolve to nothing.
    const links = resolveNameLinks(names, [member('Alex', null)], [{ id: 'u1', email: 'alex@x' }]);
    expect(links[0].status).toBe('unmapped');
    expect(links[0].accountId).toBeNull();
  });

  it('★★★ a name NOT IN THE ROSTER AT ALL is unmapped, and says so', () => {
    // ★ This is how a newly-typed name surfaces: it is derived from the live
    //   work data on every render, so a name typed into `permits.da` this
    //   afternoon appears here the next time the screen opens — flagged as not
    //   filed, and granting nothing until somebody vouches for it.
    const links = resolveNameLinks(names, [], [{ id: 'u1', email: 'alex@x' }]);
    expect(links[0].status).toBe('unmapped');
    expect(links[0].unknownToRoster).toBe(true);
  });

  it('★★★ NO GUESSING: an email that merely LOOKS right links nothing', () => {
    // ⚠️ §A: a drawing stamp reads `E. RUIVO` and there is an `eruivo@`
    //    account, so `Erick` is *probably* that person — **probably is not good
    //    enough to grant access to 33 projects.** Nothing here matches on a
    //    local-part, an initial or a substring.
    const links = resolveNameLinks(
      [{ name: 'Erick', projects: 4, columns: [] as never[] }],
      [member('Erick', null)],
      [{ id: 'u1', email: 'eruivo@blueprintcap.com' }],
    );
    expect(links[0].status).toBe('unmapped');
  });

  it('★★★ an UNREADABLE account list resolves to unmapped, never to linked', () => {
    // ★★★ An unknown is not a yes. `accounts` is undefined while the query is
    //     in flight and for any caller RLS has not given the list to — and
    //     "I could not check" must fail closed exactly like "I checked and no".
    const links = resolveNameLinks(names, [member('Alex', 'alex@x')], undefined);
    expect(links[0].status).toBe('unmapped');
    expect(links[0].accountId).toBeNull();
  });

  it('★★ an email with no account behind it is unmapped', () => {
    // ★ A roster email is not proof a login exists — somebody may have typed
    //   the address before the account was made.
    const links = resolveNameLinks(names, [member('Alex', 'alex@x')], []);
    expect(links[0].status).toBe('unmapped');
  });

  it('links only when there is an account', () => {
    const links = resolveNameLinks(names, [member('Alex', 'Alex@X')], [
      { id: 'u1', email: 'alex@x' },
    ]);
    expect(links[0]).toMatchObject({ status: 'linked', accountId: 'u1', email: 'alex@x' });
  });
});

describe('fix-527 §A — "no account" is a real answer, distinct from unmapped', () => {
  const names = [{ name: 'Chad', projects: 4, columns: [] as never[] }];

  it('★★★ it is storable, and it is NOT unmapped', () => {
    // ★★★ §A: *"a person with no login at all… this case must be
    //     representable."* A blank email cannot say whether nobody has filled
    //     it in yet or whether this person has no account — and a mapping that
    //     cannot say "nobody" invites a wrong guess.
    const links = resolveNameLinks(names, [member('Chad', null, { has_no_account: true })], []);
    expect(links[0].status).toBe('no-account');
    expect(links[0].status).not.toBe('unmapped');
  });

  it('★★★ but it still grants nothing', () => {
    const links = resolveNameLinks(names, [member('Chad', null, { has_no_account: true })], []);
    expect(links[0].accountId).toBeNull();
    // ★ …and it is not counted as a gap, because it is an answered question.
    expect(unmappedCount(links)).toBe(0);
  });

  it('★★ ANY of a person’s roster rows saying "no account" is the answer', () => {
    // ★ Jade holds THREE roster rows on prod, one per role. Asking somebody to
    //   set the flag three times is asking them to forget it once.
    const links = resolveNameLinks(names, [
      member('Chad', null),
      member('Chad', null, { has_no_account: true }),
    ], []);
    expect(links[0].status).toBe('no-account');
  });
});

describe('fix-527 §A — one account, several names; a name, at most one account', () => {
  it('★★ two work-data names can resolve to the SAME account', () => {
    // ★ §A: *"A person appears as `Marc` on a block and `M. Divina` on a
    //   drawing stamp; one account, several aliases."* Two roster rows carrying
    //   one email is how the roster already spells that, and it needs no new
    //   column: `mdivina@blueprintcap.com` is `Marc` on prod today.
    const links = resolveNameLinks(
      [
        { name: 'Marc', projects: 33, columns: [] as never[] },
        { name: 'M. Divina', projects: 2, columns: [] as never[] },
      ],
      [member('Marc', 'mdivina@b.com'), member('M. Divina', 'mdivina@b.com')],
      [{ id: 'u-marc', email: 'mdivina@b.com' }],
    );
    expect(links.map((l) => l.accountId)).toEqual(['u-marc', 'u-marc']);
  });

  it('★★★ a name whose roster rows DISAGREE is unmapped, not arbitrated', () => {
    // ★★★ Picking one of two emails would grant 33 projects on a coin toss.
    //     Measured 2026-09-11: **0 names map to more than one account**, so
    //     this guards a case that does not exist yet rather than one it fixes —
    //     which is when a guard is cheapest to add.
    const links = resolveNameLinks(
      [{ name: 'Marc', projects: 33, columns: [] as never[] }],
      [member('Marc', 'a@b.com'), member('Marc', 'c@d.com')],
      [
        { id: 'u1', email: 'a@b.com' },
        { id: 'u2', email: 'c@d.com' },
      ],
    );
    expect(links[0].status).toBe('unmapped');
    expect(links[0].accountId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §B — the capability
// ---------------------------------------------------------------------------

describe('fix-527 §B — the capability fails closed, and the gate is the RPC', () => {
  it('★★★ anything that is not literally true is NO', () => {
    expect(mayEditLibrary({ may_edit_library: true })).toBe(true);
    expect(mayEditLibrary({ may_edit_library: false })).toBe(false);
    expect(mayEditLibrary({ may_edit_library: null })).toBe(false);
    // ★★★ THE COLUMN DOES NOT EXIST UNTIL COWORK APPLIES THE MIGRATION.
    //     `undefined` must read exactly like `false` — a capability that
    //     defaults to yes when the schema is behind is worse than no capability.
    expect(mayEditLibrary({})).toBe(false);
    expect(mayEditLibrary(null)).toBe(false);
    expect(mayEditLibrary(undefined)).toBe(false);
  });

  it('★★★ the RPC refuses an uncapable caller — MEASURED on prod, rolled back', () => {
    // ★★★ §B: *"do NOT model this as hide the button… call the RPC as a user
    //     without the capability and assert it is refused."* There is no live
    //     database in CI, so the call was made inside a transaction against
    //     prod and rolled back (the fix-153 pattern). Same user, same call,
    //     three times, 2026-09-11:
    //
    //       1 · no capability   → REFUSED  42501  "caller may not edit
    //                                             Library fields"   zone: NR
    //       2 · with capability → SUCCEEDED                  zone: PROBE-ZONE
    //       3 · revoked again   → REFUSED  42501              zone: PROBE-ZONE
    //
    //     ★★ STEP 3 IS THE CACHE ASSERTION. The revoke took effect on the very
    //        next call, because the check is a `select … from profiles` inside
    //        the function — there is nothing between the grant and the gate to
    //        hold a stale answer. `rollback;`
    //
    // ★ What this test can hold in CI is the SHAPE of the migration that was
    //   probed: the gate is first, unconditional, and raises 42501.
    // ★ COMMENTS STRIPPED FIRST — the note above the gate mentions
    //   `auth_tenant_ids` by name to explain why it is NOT called there, and an
    //   ordering assertion over raw text would read the gravestone as the body.
    //   Ninth recording of that trap, and the first one in SQL.
    const sql = read('migrations/fix_527_identity_and_capability.sql');
    const bare = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join(' ');
    const fn = bare.slice(
      bare.indexOf('create or replace function public.bp_update_library_fields'),
      bare.indexOf('create or replace function public.bp_set_library_capability'),
    );
    expect(fn).toContain('may_edit_library is true');
    expect(fn).toContain("errcode = '42501'");
    // ★★★ THE GATE IS FIRST. Not after the tenant check, not after the OCC
    //     read — a refusal must not depend on anything the caller controls.
    expect(fn.indexOf('may_edit_library is true')).toBeLessThan(fn.indexOf('auth_tenant_ids'));
    expect(fn).toContain('security definer');
  });

  it('★★★ granting the capability is itself enforced in the RPC', () => {
    // ★★★ A capability whose GRANT is browser-gated is not a capability.
    const sql = read('migrations/fix_527_identity_and_capability.sql');
    const fn = sql.slice(sql.indexOf('create or replace function public.bp_set_library_capability'));
    expect(fn).toContain('public.is_admin()');
    expect(fn).toContain("errcode = '42501'");
  });

  it('★★★ the revoke is FROM public, anon — not from anon alone', () => {
    // ★★★ fix-523 §0 cost an apply to exactly this: `revoke … from anon`
    //     reports success and does nothing, because Postgres grants EXECUTE on
    //     every new function to PUBLIC and `anon` inherits from PUBLIC.
    //     **A statement that succeeds is not a statement that did something.**
    const sql = read('migrations/fix_527_identity_and_capability.sql');
    const revokes = sql.match(/revoke all on function [^;]+;/g) ?? [];
    expect(revokes).toHaveLength(2);
    for (const r of revokes) expect(r).toContain('from public, anon');
    // ★★ …and the migration ASSERTS the result with has_function_privilege
    //    rather than trusting the statements it just ran.
    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain('the capability must start at nobody');
  });

  it('★★★ NO GATE IN THIS TICKET IS "hide the button"', () => {
    // ⚠️⚠️ §B, stated twice in the brief because it is the whole point. ~20
    //      `useIsTenantAdmin` sites hide a control in the BROWSER and within a
    //      tenant every user is equivalent server-side — those are decoration
    //      on an open door. Nothing added here may join them.
    for (const f of [
      'src/lib/workDataNames.ts',
      'src/hooks/useAccountLinks.ts',
      'src/components/Settings/WorkDataNamesPanel.tsx',
    ]) {
      expect(code(read(f))).not.toContain('useIsTenantAdmin');
    }
    // ★ `mayEditLibrary` exists to EXPLAIN a refusal, never to prevent one —
    //   nothing in the shipped client calls it as a gate, because nothing calls
    //   it at all yet. The RPC is the gate.
    const panel = code(read('src/components/Settings/WorkDataNamesPanel.tsx'));
    expect(panel).not.toContain('mayEditLibrary');
  });
});

// ---------------------------------------------------------------------------
// The migration is written, NOT applied
// ---------------------------------------------------------------------------

describe('fix-527 — the migration is Cowork’s, and nothing assumes it has run', () => {
  it('★★★ no shipped code calls the two new RPCs', () => {
    // ⚠️ *"Do not ship code that assumes it has run until Cowork confirms."*
    //    The client wiring for `bp_update_library_fields` lands in the ticket
    //    after it is applied; shipping a call to a missing function would be a
    //    404 on every Library edit.
    for (const f of [
      'src/lib/workDataNames.ts',
      'src/hooks/useAccountLinks.ts',
      'src/components/Settings/WorkDataNamesPanel.tsx',
      'src/components/Settings/AdminTeamTab.tsx',
    ]) {
      const src = code(read(f));
      expect(src).not.toContain('bp_update_library_fields');
      expect(src).not.toContain('bp_set_library_capability');
    }
  });

  it('★★★ the account read FEATURE-DETECTS the capability column', () => {
    // ★★★ An unlisted column makes PostgREST fail the WHOLE query with `42703`
    //     — the explicit-select trap, which this repo has now recorded seven
    //     times and which fix-523 ran into from the other direction. So the
    //     query asks for the column and retries without it, rather than taking
    //     the Settings screen away from everybody until Cowork runs the file.
    const hook = code(read('src/hooks/useAccountLinks.ts'));
    expect(hook).toContain("const UNDEFINED_COLUMN = '42703'");
    expect(hook).toContain('capabilityAvailable');
    expect(hook).toContain("select('id,email')");
    // ★ Anything that is not 42703 still throws: a table refusing to answer
    //   must not look like a column that has not shipped.
    expect(hook).toContain('if (withCapability.error.code !== UNDEFINED_COLUMN) throw');
  });

  it('★★ the panel says which world it is in', () => {
    const panel = code(read('src/components/Settings/WorkDataNamesPanel.tsx'));
    expect(panel).toContain('work-data-names-pending-migration');
    expect(panel).toContain('capabilityAvailable');
  });

  it('★★ it needs NO display-name column — profiles already has two, unused', () => {
    // ★★★ §A asks to *"add to profiles: a display name"*. `profiles.name` AND
    //     `profiles.full_name` both already exist and are NULL on all 37 rows
    //     (measured 2026-09-11). The migration adds neither.
    const sql = read('migrations/fix_527_identity_and_capability.sql');
    expect(sql).not.toMatch(/add column if not exists (name|full_name)/);
    const adds = sql.match(/add column if not exists \w+/g) ?? [];
    expect(adds.sort()).toEqual([
      'add column if not exists has_no_account',
      'add column if not exists may_edit_library',
    ]);
  });
});
