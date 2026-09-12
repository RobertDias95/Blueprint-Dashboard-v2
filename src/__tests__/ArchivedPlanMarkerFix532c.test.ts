import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  ARCHIVED_FALLBACK_LABEL,
  ARCHIVED_FALLBACK_SHORT,
  isArchivedFallback,
} from '../lib/archivedFallback';

// ===========================================================================
// fix-532 §C (P-247) — an archived plan of record must LOOK archived
// ===========================================================================
//
// ★ Source assertions strip comments first. Thirteenth recording.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

const SURFACES = {
  card: 'src/components/ProjectDetail/PlanOfRecordCard.tsx',
  library: 'src/components/LibraryMatrix.tsx',
  share: 'src/pages/SharedPlan.tsx',
} as const;

describe('fix-532 §C — the same words on every surface that shows a set', () => {
  it('★★★ WORDS, not only a colour', () => {
    // ★★★ §C is explicit, and the reason is the audience: the `/s/` page is read
    //     by a BUILDER who has never seen the legend, will never see it, and
    //     cannot ask what a tint means.
    expect(ARCHIVED_FALLBACK_LABEL).toBe('Archived — nothing current on file.');
    // ★ The actionable half. A bare "Archived" names the state and leaves the
    //   reader to work out the consequence; this one tells whoever can fix it
    //   what is missing.
    expect(ARCHIVED_FALLBACK_LABEL).toContain('nothing current on file');
  });

  it('★★★ ONE string, and every surface reads it', () => {
    // ★ Four surfaces wording this differently is four chances for one of them
    //   to sound optional.
    for (const f of Object.values(SURFACES)) {
      expect(code(read(f))).toContain('ARCHIVED_FALLBACK_LABEL');
    }
    // ★ The table cell has no room for a sentence, so the short form carries
    //   the long one as its `title` — the sentence is never unsaid.
    const lib = code(read(SURFACES.library));
    expect(lib).toContain('ARCHIVED_FALLBACK_SHORT');
    expect(lib).toContain('title={ARCHIVED_FALLBACK_LABEL}');
    expect(ARCHIVED_FALLBACK_SHORT).toBe('ARCHIVED');
  });

  it('★★★ the flag is READ, never recomputed', () => {
    // ⚠️ §C: *"The column is already on `project_plan_of_record_sets` — read it,
    //    do not recompute it."* The indexer decides what archived MEANS by where
    //    a file sits on the share; a second definition here would be a second
    //    answer waiting to disagree with fix-529's.
    const lib = code(read('src/lib/archivedFallback.ts'));
    expect(lib).toContain("row?.is_archived_fallback === true");
    expect(lib).not.toMatch(/archive.*folder|modified_at|indexed_at/i);
    // ★ And the card asks through the predicate rather than re-testing inline.
    expect(code(read(SURFACES.card))).toContain('isArchivedFallback(shown)');
  });

  it('★★★ `undefined` is NOT a fallback — a marker must not cry wolf', () => {
    expect(isArchivedFallback({ is_archived_fallback: true })).toBe(true);
    expect(isArchivedFallback({ is_archived_fallback: false })).toBe(false);
    expect(isArchivedFallback({ is_archived_fallback: null })).toBe(false);
    // ★★★ THE ONE THAT MATTERS TODAY: `bp_resolve_plan_share` does not return
    //     the field, so the share page reads `undefined` — and a warning on a
    //     set that may be perfectly current is worse than one that is late.
    expect(isArchivedFallback({})).toBe(false);
    expect(isArchivedFallback(null)).toBe(false);
    expect(isArchivedFallback(undefined)).toBe(false);
  });

  it('★★ the set is NOT hidden and the ranking does not move', () => {
    // ⚠️ §C: *"It is shown deliberately; the marker is the whole change."*
    for (const f of Object.values(SURFACES)) {
      const src = code(read(f));
      expect(src).not.toMatch(/is_archived_fallback\s*\?\s*null/);
      expect(src).not.toMatch(/filter\([^)]*archived/i);
    }
    // ★ The card still renders the set's caption beside the marker.
    expect(code(read(SURFACES.card))).toContain('planOfRecordSetCaption(row.set_type, shownVariant)');
  });

  it('★★ the Library asks ONE query for the screen, not one per row', () => {
    // ★ 220 subscriptions to answer one boolean each is the shape fix-434
    //   measured at 1.1 MB an invalidation.
    const hook = code(read('src/hooks/useArchivedFallbackProjects.ts'));
    expect(hook).toContain("from('project_plan_of_record_sets')");
    expect(hook).toContain("eq('is_archived_fallback', true)");
    expect(code(read(SURFACES.library))).toContain('useArchivedFallbackProjects()');
    expect(code(read(SURFACES.library))).not.toContain('usePlanOfRecordSets');
  });

  it('★★★ the select asks only for columns the VIEW is proven to expose', () => {
    // ⚠️ §C: *"do not add it to a hook's explicit select without checking the
    //    view exposes it — fix-523's `42703` cost a ticket."* Checked against
    //    `information_schema.columns` on prod 2026-09-12, and
    //    `usePlanOfRecordSets` has selected this column since fix-506.
    const hook = read('src/hooks/useArchivedFallbackProjects.ts');
    expect(hook).toContain("'project_id,is_archived_fallback'");
    expect(code(read('src/hooks/usePlanOfRecordSets.ts'))).toContain('is_archived_fallback');
  });
});

describe('fix-532 §C — the share page needs a server change, and it is staged', () => {
  const sql = read(
    'migrations/fix_532c_resolve_returns_archived_flag_PENDING_APPROVAL.sql',
  );

  it('★★★ it is PENDING APPROVAL and nothing assumes it has run', () => {
    // ⚠️ The brief: *"No migration expected; if you find you need one, stage it
    //    as `_PENDING_APPROVAL.sql` and stop at that step only."*
    expect(sql).toContain('PENDING APPROVAL');
    expect(sql).toContain('NOT APPLIED');
    // ★ The page renders nothing until the field arrives — and needs no deploy
    //   when it does, because it is already read defensively.
    const share = code(read(SURFACES.share));
    expect(share).toContain('isArchivedFallback(row)');
    const lib = code(read('src/lib/planShare.ts'));
    expect(lib).toContain('is_archived_fallback?: boolean | null;');
  });

  it('★★★ DROP then CREATE, because the RESULT TYPE changes', () => {
    // ⚠️ `CREATE OR REPLACE` refuses to change a function's result type, and
    //    creating alongside would make an OVERLOAD that breaks PostgREST —
    //    fix-438's finding.
    expect(sql).toContain('drop function public.bp_resolve_plan_share(text)');
  });

  it('★★★ the grants come back, and the revoke names PUBLIC', () => {
    // ★★★ DROP takes the grants with it, and the `/s/` page is the ONLY
    //     anonymous door in this app: a lost `anon` grant is a dead share link
    //     for every recipient. And `revoke … from anon` alone reports success
    //     and does nothing, because `anon` inherits from PUBLIC — fix-523 §0
    //     cost an apply to exactly that.
    expect(sql).toContain('from public;');
    expect(sql).toContain('grant execute on function public.bp_resolve_plan_share(text) to anon, authenticated');
    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain('every share link is dead');
  });

  it('★★★ patched BY ANCHOR, counted before and asserted after', () => {
    // ★ `migrations/` is partial and prod is ahead; this function has been
    //   replaced twice since fix-523. Both anchors were verified unique against
    //   the live body on 2026-09-12 (1 and 1).
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('expected 1 RETURNS anchor, found %');
    expect(sql).toContain('expected 1 SELECT anchor, found %');
    expect(sql).toContain('the flag is not in the installed result type');
  });
});
