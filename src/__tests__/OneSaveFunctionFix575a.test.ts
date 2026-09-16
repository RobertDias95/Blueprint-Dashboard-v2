import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ===========================================================================
// fix-575a (P-227, prerequisite to fix-575) — one save function, not four
// ===========================================================================
//
// `useProjectFieldCommit`'s header has claimed since fix-520 §A:
//
//   *"One definition, so the next field added cannot invent a third."*
//
// ★★★ THAT CLAIM WAS FALSE FOR A YEAR. Three more were invented — `SiteEditor`
//     (a byte-identical generic copy), `ClosingRow` (the same, hard-coded to
//     `closing_date`) and `ProjectTagsEditor` — so 9 of 23 single-column
//     project fields wrote through a copy the hook knew nothing about.
//
// ★★★ AND THAT IS THE ENTIRE LESSON OF THIS TICKET: **a comment cannot enforce
//     anything.** §B below is the same sentence, rewritten as something that
//     fails a build.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Comments blanked, NEWLINES PRESERVED.
 *
 * ★★ The preservation is not cosmetic — this guard reports `file:line`, and a
 *    stripper that collapsed lines would point the next reader at the wrong
 *    one. That is worse than not reporting a line at all.
 *
 * ★ And the blanking itself is the gravestone trap, seventh time: the notes
 *   recording what fix-575a folded away quote the very shape being banned, so
 *   an unstripped scan flags its own explanation.
 */
function code(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      walk(rel, out);
    } else if (/\.tsx?$/.test(ent.name)) {
      out.push(rel);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// §A — the three copies are gone
// ---------------------------------------------------------------------------

describe('fix-575a §A — three copies folded into one', () => {
  const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));

  it('★★★ SiteEditor, ClosingRow and ProjectTagsEditor all use the hook', () => {
    expect(editors.split('useProjectFieldCommit(project)').length - 1).toBe(3);
  });

  it('★★★ none of them declares a local commit any more', () => {
    // ★ The copies were `async function commit<K extends keyof Project>(…)`,
    //   `async function commit(next: string | null)` and `async function
    //   write(next: string[])`. What catches a FOURTH is §B; this pins that
    //   these three specifically are gone.
    expect(editors).not.toMatch(/async function commit<K extends keyof Project>/);
    expect(editors).not.toMatch(/async function commit\(next: string \| null\)/);
    expect(editors).not.toMatch(/async function write\(next: string\[\]\)/);
  });

  it('★★ the lock is the hook’s answer, not a fourth arithmetic', () => {
    // ★★★ ALL THREE ALREADY COMPUTED `!updated_at || !mayWrite`, by hand, in
    //     three places. The hook returns exactly that as `occMissing`, so this
    //     is the same two values by the same arithmetic — read once.
    expect(editors.split('occMissing: locked').length - 1).toBe(3);
    const hook = code(read('src/hooks/useProjectFieldCommit.ts'));
    expect(hook).toContain('const occMissing = !project.updated_at || !mayWrite;');
  });
});

// ---------------------------------------------------------------------------
// §B — a FOURTH copy cannot be made silently
// ---------------------------------------------------------------------------

/**
 * ★★★ EVERY LEGITIMATE PROJECT-PATCH WRITER OUTSIDE THE HOOK, WITH ITS REASON.
 *
 * A new entry here is the point: you may still write one, but you must say why
 * in the same commit, and a reviewer sees it. That is the fix-450 shelf guard's
 * shape (add a file → the test makes you add a row) applied to a code shape
 * rather than to a migration.
 *
 * ⚠️ NONE OF THESE IS A SINGLE-COLUMN SCALAR BLUR COMMIT, which is the thing
 *    `useProjectFieldCommit` owns. Every one writes something the hook's model
 *    genuinely does not cover.
 */
const ALLOWED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'src/hooks/useProjectFieldCommit.ts',
    why: 'THE definition. Everything below is an exception to this.',
  },
  {
    file: 'src/components/ProjectDetail/ProjectDataEditors.tsx',
    why:
      '`unit_types` — a JSONB array rebuilt through `resolveUnitTypesForSave`, ' +
      'a whitelist model, not a scalar. fix-572 §D also makes it return ' +
      '`Promise<boolean>` so a field can confirm only a write that landed.',
  },
  {
    file: 'src/components/ProjectDetail/ProjectDetailHeader.tsx',
    why:
      'Builder/Owner — MULTI-COLUMN by necessity: clearing a name must clear ' +
      '`builder_id` in the same patch, or the card shows a company with no ' +
      'link (fix-425). A per-column commit cannot express that.',
  },
  {
    file: 'src/components/ProjectDetail/ReuseEditor.tsx',
    why:
      'Applying a reuse source overwrites `product_types` AND `unit_types` ' +
      'together behind a confirm(). Three columns, one decision.',
  },
  {
    file: 'src/components/ProjectDetail/EditRedesignModal.tsx',
    why:
      'A modal Save button writing three redesign columns at once — a ' +
      'buffered form, not a blur commit.',
  },
];

describe('fix-575a §B — the claim is enforceable now', () => {
  /** Every project-scoped single-mutation patch write in `src/`. */
  function projectPatchWriters(): { file: string; line: number }[] {
    const found: { file: string; line: number }[] = [];
    for (const file of walk('src')) {
      const body = code(read(file));
      const re = /mutateAsync\(\{|\.mutate\(\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const seg = body.slice(m.index, m.index + 500);
        // ★ `projectId` without `permitId` is what separates a PROJECT write
        //   from `useUpdatePermit`, which takes the identical input shape and
        //   is a different hook with a different owner.
        if (
          seg.includes('expectedUpdatedAt') &&
          seg.includes('patch') &&
          /\bprojectId\b/.test(seg) &&
          !seg.includes('permitId')
        ) {
          found.push({
            file,
            line: body.slice(0, m.index).split('\n').length,
          });
        }
      }
    }
    return found;
  }

  it('★★★ no file writes a project patch without being on the list', () => {
    const allowed = new Set(ALLOWED.map((a) => a.file));
    const offenders = projectPatchWriters().filter((w) => !allowed.has(w.file));
    // ★★ The message IS the feature. A bare `toEqual([])` tells the next person
    //    a rule exists; it does not tell them which line or what to do.
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'A project field is being written outside `useProjectFieldCommit`:',
            ...offenders.map((o) => `  · ${o.file}:${o.line}`),
            '',
            'Single-column blur commits belong in the hook — that is what this',
            'ticket folded three copies into. If this write genuinely cannot',
            'use it (multi-column, JSONB rebuild, buffered form), add it to',
            'ALLOWED in this file WITH THE REASON.',
          ].join('\n'),
    ).toEqual([]);
  });

  it('★★★ every ALLOWED entry still writes — no stale exemptions', () => {
    // ★★★ THE HALF THAT ROTS. An allowlist nobody prunes becomes a list of
    //     permissions for code that left, and the next real offender lands in a
    //     file that is already waved through. So the list is checked BOTH ways.
    const writers = new Set(projectPatchWriters().map((w) => w.file));
    for (const a of ALLOWED) {
      expect(writers.has(a.file), `${a.file} is exempt but no longer writes`).toBe(
        true,
      );
    }
  });

  it('★★★ every exemption states a reason a person can weigh', () => {
    for (const a of ALLOWED) {
      expect(a.why.length, a.file).toBeGreaterThan(40);
    }
  });

  it('★★ it would have caught the three this ticket folded', () => {
    // ★★★ FALSIFIABLE: a guard that cannot fail proves nothing, and the first
    //     draft of fix-422 §2's parentage test passed against pre-fix code.
    //     This replays one of the deleted copies through the same detector and
    //     requires it to be seen.
    const revived = `
      async function commit(next: string | null) {
        await updateMutation.mutateAsync({
          projectId: project.id,
          expectedUpdatedAt: project.updated_at,
          patch: { closing_date: next },
          fieldLabel: 'Closing Date',
        });
      }`;
    const body = code(revived);
    const m = /mutateAsync\(\{/.exec(body)!;
    const seg = body.slice(m.index, m.index + 500);
    expect(
      seg.includes('expectedUpdatedAt') &&
        seg.includes('patch') &&
        /\bprojectId\b/.test(seg) &&
        !seg.includes('permitId'),
    ).toBe(true);
  });

  it('★★ …and does NOT flag a permit write, which shares the input shape', () => {
    // ★ `useUpdatePermit` takes `{ projectId, permitId, expectedUpdatedAt,
    //   patch, fieldLabel }`. Without the `permitId` exclusion this guard would
    //   demand `PermitDetailV2` join a project-field allowlist.
    const permitWrite = `
      void updatePermit.mutateAsync({
        projectId: project.id,
        permitId: bp.id,
        expectedUpdatedAt: bp.updated_at,
        patch: { da: v || null },
        fieldLabel: 'BP Design Associate',
      });`;
    const body = code(permitWrite);
    const m = /mutateAsync\(\{/.exec(body)!;
    const seg = body.slice(m.index, m.index + 500);
    expect(seg.includes('permitId')).toBe(true);
  });

  it('★★★ the comments are BLANKED, so no guard passes on its own gravestone', () => {
    // ★ Seventh time in this codebase. `ProjectDataEditors` now carries notes
    //   quoting the exact shape being banned.
    const withComment = `// await updateMutation.mutateAsync({ projectId, expectedUpdatedAt, patch, fieldLabel })`;
    expect(code(withComment).trim()).toBe('');
    // ★★ ...and a blanked block comment keeps its line count, so `file:line`
    //    in the failure message points where the reader is sent.
    expect(code('/* a\nb\nc */\nx').split('\n')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// §A2 — the swallowed catch, and what it actually was
// ---------------------------------------------------------------------------

describe('fix-575a — the catch moved INTO the hook rather than being deleted', () => {
  const hook = code(read('src/hooks/useProjectFieldCommit.ts'));

  it('★★★ `commit` never rejects, because every caller writes `void commit(…)`', () => {
    // ★★★ MEASURED BEFORE THE CHANGE: the hook's `commit` DID reject on a
    //     failed write, and all 14 of its own call sites discarded it with
    //     `void` — so a refused write left an unhandled rejection behind. The
    //     copy the brief called a silent-data-loss path was the only one that
    //     handled it.
    expect(hook).toMatch(/try \{[\s\S]*mutateAsync[\s\S]*\} catch \{/);
  });

  it('★★★ and it hides nothing — onError has already spoken', () => {
    // ★★★ THE CLAIM THIS RESTS ON, ASSERTED AGAINST THE SOURCE rather than
    //     trusted: `useUpdateProject.onError` fires first, unconditionally. It
    //     rolls the optimistic patch back out of the cache (so the control
    //     visibly reverts) and pushes one of three toasts.
    const mutation = code(read('src/hooks/useUpdateProject.ts'));
    const onError = mutation.slice(
      mutation.indexOf('onError:'),
      mutation.indexOf('onSuccess:'),
    );
    expect(onError).toContain('queryClient.setQueryData'); // rollback
    expect(onError).toContain('isWriteDenied(error)');
    expect(onError).toContain('isOCCConflict(error)');
    // ★ Three branches, three toasts — there is no path that says nothing.
    expect(onError.split('pushToast').length - 1).toBe(3);
  });

  it('★★ nothing swallows it a SECOND time at a call site', () => {
    // ★ A caller-side `.catch(() => {})` on top of the hook's would be the
    //   duplication again, one layer down.
    const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));
    const form = code(read('src/components/ProjectDetail/ProjectDetailsForm.tsx'));
    for (const src of [editors, form]) {
      expect(src).not.toMatch(/commit\([^)]*\)\s*\.catch\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// §A3 — the no-op guard learned about arrays
// ---------------------------------------------------------------------------

describe('fix-575a — the guard can short-circuit an array', () => {
  const hook = code(read('src/hooks/useProjectFieldCommit.ts'));

  it('★★★ it is value-aware, because `[] === []` is false', () => {
    // ★★★ `project_tags` is the first array column through this hook, and its
    //     editor builds a FRESH array every call — so reference equality would
    //     have declared every write a change.
    expect(hook).toContain('function projectValuesEqual');
    expect(hook).toContain('projectValuesEqual(next, original ?? null)');
    expect(hook).not.toContain('if (next === (original ?? null)) return;');
  });

  it('★★★ SHALLOW, and order-sensitive — both deliberate', () => {
    // ★ Order is a real edit: the stored order is the chip render order, so a
    //   reorder must not be swallowed as a no-op.
    expect(hook).toMatch(/a\.length === b\.length && a\.every\(\(v, i\) => v === b\[i\]\)/);
  });

  it('★★ the tag editor sends NULL for an empty list, not `[]`', () => {
    // ★ "Nobody has tagged this" and "somebody removed the last tag" are the
    //   same fact, and only one of them survives a round-trip.
    const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(editors).toContain('next.length > 0 ? next : null');
  });
});

// ---------------------------------------------------------------------------
// The divergence this surfaced
// ---------------------------------------------------------------------------

describe('fix-575a — the tag ADD select gated on the wrong condition', () => {
  const editors = code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'));

  it('★★★ add and remove now gate identically', () => {
    // ★★★ THE ONE REAL BEHAVIOURAL DIVERGENCE FOUND. The remove `×` on each
    //     chip read `locked` (which includes `bp_may_write_project`); the add
    //     `<select>` six lines below read `occMissing` alone. Somebody the
    //     server will refuse could ADD a tag but not REMOVE one — the add
    //     landed as a failed write with a toast, where fix-549 §B says it
    //     should have been a control they could see was not theirs.
    expect(editors).toContain('disabled={locked || addable.length === 0}');
    expect(editors).not.toContain('disabled={occMissing || addable.length === 0}');
  });
});
