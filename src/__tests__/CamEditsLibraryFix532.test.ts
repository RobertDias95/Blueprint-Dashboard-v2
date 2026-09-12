import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  LOT_DIMENSION_FT_MAX,
  LOT_SIZE_SF_MAX,
  parseLotDimensionFt,
} from '../lib/lotDimensions';
import { freshestProjectToken } from '../hooks/useUpdateProject';
import { mayEditLibrary } from '../lib/workDataNames';
import type { Project } from '../lib/database.types';

// ===========================================================================
// fix-532 — Cam can edit the Library, and the units save stops refusing itself
// ===========================================================================
//
// ★ Source assertions strip comments first. Twelfth recording of the gravestone
//   trap in this repo.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');
const lib = () => code(read('src/components/LibraryMatrix.tsx'));
const hook = () => code(read('src/hooks/useUpdateLibraryFields.ts'));

// ---------------------------------------------------------------------------
// §A — the capability, and where it is enforced
// ---------------------------------------------------------------------------

describe('fix-532 §A — the RPC is the gate; the browser check is cosmetic', () => {
  it('★★★ every Library write goes through bp_update_library_fields', () => {
    // ★★★ The direct table write fix-506 §H removed stays removed — that is the
    //     half no server rule could ever gate. `useUpdateProject` writes
    //     `projects` with `.update()`, and within a tenant every user may.
    expect(lib()).not.toContain('useUpdateProject');
    expect(lib()).not.toContain('.update(');
    expect(lib()).not.toContain('supabase');
    expect(hook()).toContain("supabase.rpc('bp_update_library_fields'");
  });

  it('★★★ a 42501 is the server winning, and it says something human', () => {
    // ⚠️⚠️ §A2: *"let a `42501` from the server be the truth if the two
    //      disagree — with a human message, not the driver's."* The server's own
    //      sentence names a function at somebody who was typing a lot width.
    expect(hook()).toContain("error.code === '42501'");
    expect(hook()).toContain('LIBRARY_DENIED_MESSAGE');
    expect(read('src/hooks/useUpdateLibraryFields.ts')).toContain(
      'You do not have permission to edit Library fields',
    );
    // ★ …and the driver's string is not what a person reads. Asserted on the
    //   COMMENT-STRIPPED source, because the note above the branch quotes the
    //   server's sentence in order to explain why it is replaced — the
    //   gravestone trap, twelfth recording and the first one I set for myself
    //   in the same file I was warning about it in.
    expect(hook()).not.toContain('caller may not edit Library fields');
  });

  it('★★★ NOT a twenty-first useIsTenantAdmin', () => {
    // ⚠️ §A2: ~20 of those exist and none enforce anything (P-243). The
    //    difference is not the shape of the check, it is that there is a server
    //    behind this one.
    expect(lib()).not.toContain('useIsTenantAdmin');
    expect(hook()).not.toContain('useIsTenantAdmin');
    // ★ ONE read of the capability, from `profiles`, of the caller's own row.
    expect(hook()).toContain("from('profiles')");
    expect(hook()).toContain('may_edit_library');
  });

  it('★★★ FAIL CLOSED — anything that is not literally true is no', () => {
    // ★ fix-527's rule carried forward: a missing row, a null, an error and a
    //   query still in flight all answer false.
    expect(mayEditLibrary({ may_edit_library: true })).toBe(true);
    expect(mayEditLibrary({ may_edit_library: false })).toBe(false);
    expect(mayEditLibrary({ may_edit_library: null })).toBe(false);
    expect(mayEditLibrary({})).toBe(false);
    expect(mayEditLibrary(null)).toBe(false);
    expect(mayEditLibrary(undefined)).toBe(false);
    // ★★ …and the hook returns it through that one predicate rather than
    //    re-deriving a truthiness test at the call site.
    expect(hook()).toContain('return mayEditLibrary(q.data)');
  });

  it('★★ a user without the capability sees the cell it always saw', () => {
    // ★ `editable` chooses between an input and TODAY'S markup — not a disabled
    //   input, and not a different-looking read-only cell. A cell that moves
    //   under the reader as they gain a capability is a cell they distrust.
    const cells = code(read('src/components/LibraryEditCell.tsx'));
    expect(cells).toContain('if (!editable) return <ReadOnly');
    expect(cells).not.toContain('disabled');
  });

  it('★★★ the five fields, and only the five the RPC accepts', () => {
    const h = read('src/hooks/useUpdateLibraryFields.ts');
    for (const f of ['p_zone', 'p_alley', 'p_lot_width', 'p_lot_depth', 'p_unit_types']) {
      expect(h).toContain(f);
    }
    // ★ Listed rather than a free patch: an RPC that applies whatever jsonb it
    //   is handed is an UPDATE with extra steps, and the capability would gate
    //   nothing.
    expect(h).not.toMatch(/p_patch|JSON\.stringify\(patch\)/);
  });
});

describe('fix-532 §A3 — the fresh token reaches every cache', () => {
  it('★★★ the returned updated_at is written back, not just invalidated', () => {
    // ⚠️ §A3: *"fix-442 taught one cache and fix-511 found everybody else still
    //    stale; do not repeat it."* The Library list and the project card read
    //    the SAME `projects` query, so one `setQueryData` reaches both — and the
    //    bare prefix is invalidated behind it for anything keyed differently.
    expect(hook()).toContain('setQueryData');
    expect(hook()).toContain('updated_at: result.updatedAt');
    expect(hook()).toContain('queryKeys.projectsAll');
  });

  it('★★ a conflict changes no cache and says so', () => {
    // ★ `out_conflict` is a normal return, not an error: the server rolled the
    //   whole edit back, so patching the cache would show a value that is not
    //   in the database.
    expect(hook()).toContain('if (result.conflict)');
    expect(hook()).toContain('changed since you loaded it');
  });
});

// ---------------------------------------------------------------------------
// §A4 — bounded before it reaches the server
// ---------------------------------------------------------------------------

describe('fix-532 §A4 — a lot dimension is bounded in the browser', () => {
  it('★★★ scientific notation is refused, whatever its magnitude', () => {
    // ★★ THE NOTATION IS THE THING REFUSED, not the size: `Number('1e400')` is
    //    Infinity and `Number('1e2')` is an ordinary 100. Somebody who meant
    //    100 should be told to type it.
    for (const bad of ['1.05e2', '1e400', '5E3']) {
      const r = parseLotDimensionFt(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('exponent');
    }
  });

  it('★★★ the ceiling is DERIVED from the integer column, not chosen', () => {
    // ★★★ `lot_size_sf` is an `integer` (P-198), so the largest dimension whose
    //     SQUARE still fits is √2,147,483,647 — 46,340 ft, about nine miles.
    //     Picking a "sensible" 1,000 instead would be a policy nobody ruled on.
    expect(LOT_DIMENSION_FT_MAX).toBe(Math.floor(Math.sqrt(LOT_SIZE_SF_MAX)));
    expect(LOT_DIMENSION_FT_MAX).toBe(46340);
    const over = parseLotDimensionFt(String(LOT_DIMENSION_FT_MAX + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe('range');
    expect(parseLotDimensionFt(String(LOT_DIMENSION_FT_MAX)).ok).toBe(true);
  });

  it('★★ feet are not whole, and clearing is an answer', () => {
    // ★ A 36.5 ft lot is ordinary, so this keeps the decimal where
    //   `parseLotSizeSf` rounds. And empty / zero / negative CLEAR, which is the
    //   behaviour the lot-size box already had — turning a long-standing silent
    //   clear into a new error is a separate decision.
    expect(parseLotDimensionFt('36.5')).toEqual({ ok: true, value: 36.5 });
    expect(parseLotDimensionFt('')).toEqual({ ok: true, value: null });
    expect(parseLotDimensionFt('0')).toEqual({ ok: true, value: null });
    expect(parseLotDimensionFt('-4')).toEqual({ ok: true, value: null });
    expect(parseLotDimensionFt('abc').ok).toBe(false);
  });

  it('★★★ it is refused BEFORE the server — nothing is sent', () => {
    const cells = code(read('src/components/LibraryEditCell.tsx'));
    const commit = cells.slice(cells.indexOf('function commit()'));
    // ★ The rejection returns; `onCommit` is only reached on `ok`.
    expect(commit.indexOf('if (!parsed.ok)')).toBeLessThan(commit.indexOf('onCommit('));
    expect(commit).toContain('return;');
  });

  it('★★ the cell commits on blur and Enter, never per keystroke', () => {
    // ★★★ THE UNIT DIMENSIONS EDITOR SAVES ON EVERY CHANGE, and that is what
    //     put three writes in flight for one row (§B). A table cell doing the
    //     same would do it thirty times, and §B's token fix should not be the
    //     only thing between a typist and a queue of writes.
    const cells = code(read('src/components/LibraryEditCell.tsx'));
    expect(cells).toContain('onBlur={commit}');
    expect(cells).toContain("e.key === 'Enter'");
    expect(cells).toContain("e.key === 'Escape'");
    expect(cells).not.toContain('onChange={() => commit');
  });
});

// ---------------------------------------------------------------------------
// §B — P-246
// ---------------------------------------------------------------------------

describe('fix-532 §B (P-246) — the stale token was the caller’s', () => {
  const rows = [
    { id: 'p1', updated_at: '2026-09-11T18:05:12Z' },
    { id: 'p2', updated_at: '2026-09-11T10:00:00Z' },
  ] as unknown as Project[];

  it('★★★ the token is read from the CACHE, not from a render-captured prop', () => {
    // ★★★ Gena's row #717: `writeTypes` sends `project.updated_at` off a PROP,
    //     and the Unit Dimensions editor calls it on EVERY field change. Type a
    //     width then a depth and two saves are in flight carrying the same
    //     token, because the second was composed before the first's `onSuccess`
    //     re-rendered its prop. Two survives on fix-99's single retry; three
    //     does not.
    expect(freshestProjectToken(rows, 'p1', 'STALE')).toBe('2026-09-11T18:05:12Z');
  });

  it('★★★ a project the cache does not hold keeps the caller’s token', () => {
    // ★ Never a token the caller has not seen. A surface that loads a project
    //   outside the `projects` query is unaffected.
    expect(freshestProjectToken(rows, 'unknown', 'CALLER')).toBe('CALLER');
    expect(freshestProjectToken(undefined, 'p1', 'CALLER')).toBe('CALLER');
  });

  it('★★★ it does NOT weaken OCC, which is the thing to get right', () => {
    // ★★★ The cached token is always a REAL server token: `onMutate`'s
    //     optimistic patch deliberately keeps the old `updated_at`, and
    //     `onSuccess` replaces the row with the server's. So a write by SOMEBODY
    //     ELSE still refuses — it reaches this cache through
    //     `REALTIME_TABLES.projects` (`projects` IS published — verified on prod
    //     2026-09-11) or through the invalidation every other writer fires.
    //     What stops happening is a tab refusing ITSELF.
    const src = code(read('src/hooks/useUpdateProject.ts'));
    const onMutate = src.slice(src.indexOf('onMutate:'), src.indexOf('onError:'));
    expect(onMutate).not.toContain('updated_at');
    const onSuccess = src.slice(src.indexOf('onSuccess: (project)'));
    expect(onSuccess).toContain('p.id === project.id ? project : p');
    // ★ …and `projects` really is wired for realtime.
    const keys = code(read('src/lib/queryKeys.ts'));
    expect(keys).toContain('projects: [queryKeys.projectsAll, queryKeys.permitsAll]');
  });

  it('★★★ the retry uses the same freshest token, not the caller’s again', () => {
    // ★ Retrying with the value that just failed is how a second attempt
    //   becomes a second identical failure.
    const src = code(read('src/hooks/useUpdateProject.ts'));
    expect(src).toContain('tryUpdateProject(input, token)');
    expect(src).not.toContain('input.expectedUpdatedAt,\n        );');
  });

  it('★★ the Library save reads its token the same way, from the first line', () => {
    // ★ Built in rather than retrofitted: the Library's cells have the same
    //   several-in-flight shape the units editor has.
    expect(hook()).toContain('queryClient.getQueryData<Project[]>(queryKeys.projects(tenantId))');
    expect(hook()).toContain('p_expected_updated_at: expected');
  });
});
