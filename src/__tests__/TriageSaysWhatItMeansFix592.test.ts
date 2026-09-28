// ===========================================================================
// ★★★ fix-592 (P-291) — TRIAGE SAYS WHAT IT MEANS
// ===========================================================================
//
// The queue on 2026-09-28: 13 open rows, 10 fingerprints, and only three of them
// were a defect anybody could act on. This file holds the two parts that are
// pure logic — §B's census and §C's naming. §A's picker and message are asserted
// in `ConsultantDuplicateDisciplineFix592.test.tsx`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  queryFailureContext,
  describeFailure,
} from '../lib/mutationErrorContext';
import { errorFingerprintKey, normalizeErrorMessage } from '../lib/errorGrouping';

// ═══════════════════════════════════════════════════════════════════════════
// §B — THE CENSUS
// ═══════════════════════════════════════════════════════════════════════════
//
// ★★★ WHAT THE CENSUS ACTUALLY POLICES, and why it is this and not a text
//     matcher: a toast inside a handled-conflict branch must go through
//     `pushRecoveredToast`. The condition is classified by the CODE THAT
//     HANDLED IT — fix-584 §A's rule — so the check reads structure (which
//     branch is this statement in?) rather than wording.
//
// ★★ 34 OF THE 36 SITES WERE ALREADY SILENT, BY ACCIDENT. `push` logs only when
//    `kind === 'error'`, and they all passed `'warn'`. That is why this test
//    exists rather than a one-line fix: the class's silence rested on a colour
//    choice, and two authors who had a good reason to choose the loud colour
//    (`useUpdatePermit`, fix-39 Track B; `useProjectConsultants`) each bought a
//    phantom defect report with it.

/**
 * Guards that open a branch which has ALREADY handled the condition.
 *
 * ★★★ A NEGATED GUARD IS THE SUCCESS PATH, NOT A HANDLED CONFLICT, and leaving
 *     that out was a real false positive rather than a hypothetical:
 *     `useCreateProjectWithPermits` has `if (!result.conflict) { pushToast('Project
 *     created', 'success') }` and `if (noteBody && !row.conflict)`. Both were
 *     flagged by the first version of this regex. Routing either through
 *     `pushRecoveredToast` would have been meaningless at best; the lookbehind is
 *     what keeps the census pointed at the branch that recovered from something.
 */
const CONFLICT_GUARD =
  /\bif\s*\(.*(?<![!\w])(isOCCConflict\s*\(|(?:row|result|res)\s*\??\.\s*(?:conflict|out_conflict)\b|conflictKind\b)/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'test' && entry !== 'harness') {
        out.push(...sourceFiles(p));
      }
    } else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  routed: boolean;
  text: string;
}

/**
 * Every toast that is the FIRST statement inside a handled-conflict branch.
 *
 * ★★★ SCANNED FORWARD FROM THE GUARD, WHICH IS WHAT MAKES IT SAFE. Walking
 *     BACKWARDS from each toast (the first thing I tried) swept up the
 *     `onSuccess` toast above the handler and the `else` branch's *"Could not
 *     save — <message>"* below it — and routing a real failure through
 *     `pushRecoveredToast` would silence exactly the reports this ticket exists
 *     to make useful. Forward from the guard, stopping at the branch's own `}`
 *     or at an `else`, excludes both by construction.
 */
export function censusOf(text: string, file = '<inline>'): Site[] {
  const lines = text.split('\n');
  const sites: Site[] = [];
  for (let g = 0; g < lines.length; g++) {
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[g])) continue;
    if (!CONFLICT_GUARD.test(lines[g])) continue;
    const indent = lines[g].match(/^\s*/)![0].length;
    for (let i = g + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
      const li = l.match(/^\s*/)![0].length;
      // The branch ended (its closing brace, or an `else` at or left of it).
      if (l.trim() !== '' && li <= indent && /^\s*\}/.test(l)) break;
      const m = l.match(/\b(pushRecoveredToast|pushValidationToast|pushToast)\(/);
      if (m) {
        sites.push({
          file,
          line: i + 1,
          routed: m[1] !== 'pushToast',
          text: l.trim(),
        });
        break; // one narration per branch
      }
    }
  }
  return sites;
}

describe('fix-592 §B — the recovered-toast census', () => {
  const sites = sourceFiles('src').flatMap((f) =>
    censusOf(readFileSync(f, 'utf8'), f.split('\\').join('/')),
  );

  it('found the whole class, not one string', () => {
    // ★ A floor, not an equality: the class may grow, and a new member that is
    //   routed correctly must not fail. What must never grow is the unrouted set.
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it('every handled-conflict toast is routed through pushRecoveredToast', () => {
    const unrouted = sites.filter((s) => !s.routed);
    // ★ The message names the offenders, because "expected 1 to be 0" on a
    //   whole-tree scan is not a finding anybody can act on.
    expect(
      unrouted.map((s) => `${s.file}:${s.line}  ${s.text}`),
      'a handled-and-recovered condition must not file itself as a defect',
    ).toEqual([]);
  });

  it('the two that were REPORTING keep their loud colour', () => {
    // ★★★ fix-39 Track B's judgement survives: `'error'` is the right colour for
    //     a field commit that did not land. What changed is that the colour no
    //     longer decides whether an engineer is paged.
    for (const f of [
      'src/hooks/useUpdatePermit.ts',
      'src/hooks/useProjectConsultants.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      const site = censusOf(src, f).find((s) => s.routed);
      expect(site, `${f} should still have a routed conflict toast`).toBeDefined();
      // the call spans lines; the kind is on one of the next few
      const after = src.split('\n').slice(site!.line - 1, site!.line + 4).join(' ');
      expect(after).toContain("'error'");
    }
  });

  // ★★★ THE BRIEF'S OWN TEST: *"Add a new recovered toast and watch the census
  //     fail."* Run against a snippet rather than by editing a real hook, so the
  //     detector is proved to catch it without leaving a broken file behind.
  it('catches a NEW recovered toast that bypasses the helper', () => {
    const added = [
      '  onError: (error) => {',
      '    if (isOCCConflict(error)) {',
      "      pushToast('Widget changed since you loaded it — refresh', 'error');",
      '      queryClient.invalidateQueries({ queryKey: k });',
      '    } else {',
      "      pushToast(`Could not save — ${error.message}`, 'error');",
      '    }',
      '  },',
    ].join('\n');
    const found = censusOf(added);
    expect(found).toHaveLength(1);
    expect(found[0]!.routed).toBe(false);
    expect(found[0]!.text).toContain('Widget changed');
  });

  it('…and leaves the `else` branch alone — a real failure is still reported', () => {
    const snippet = [
      '  onError: (error) => {',
      '    if (isOCCConflict(error)) {',
      "      pushRecoveredToast(error.message, 'warn');",
      '      queryClient.invalidateQueries({ queryKey: k });',
      '    } else {',
      "      pushToast(`Could not save — ${error.message}`, 'error');",
      '    }',
      '  },',
    ].join('\n');
    const found = censusOf(snippet);
    expect(found).toHaveLength(1);
    expect(found[0]!.routed).toBe(true);
    // The "Could not save" toast is NOT a census member — it must keep logging.
    expect(found.some((s) => s.text.includes('Could not save'))).toBe(false);
  });

  it('a success toast in onSuccess is not a census member', () => {
    const snippet = [
      '  onSuccess: (result) => {',
      '    if (!result.conflict) {',
      "      pushToast('Project created', 'success');",
      '    }',
      '  },',
    ].join('\n');
    // ★★★ `!result.conflict` IS THE SUCCESS PATH. Nothing was handled, so this
    //     is not a member of the class at all — and that is the assertion,
    //     because the first version of the detector DID flag it (both real cases
    //     live in `useCreateProjectWithPermits`) and "route it anyway" would have
    //     been a silent no-op hiding a broken census.
    expect(censusOf(snippet)).toEqual([]);
  });

  it('…and the real file that proved it stays out of the class', () => {
    const src = readFileSync('src/hooks/useCreateProjectWithPermits.ts', 'utf8');
    // Its two toasts sit behind `if (!result.conflict)` / `if (noteBody &&
    // !row.conflict)`. One of them — "Project created, but its note could not be
    // saved" — is a REAL partial failure and must keep reporting.
    expect(censusOf(src)).toEqual([]);
    expect(src).toContain('could not be saved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §C — THE OPERATION AND THE RECORD
// ═══════════════════════════════════════════════════════════════════════════

describe('fix-592 §C — a reported failure names what it was doing', () => {
  // The four real keys, copied from the open rows on 2026-09-28.
  const TENANT = '00000000-0000-0000-0000-000000000001';

  it('names the object on a storage miss (743, 741)', () => {
    const key = ['avatar_url', `${TENANT}/b74ca59f-3b57-4139-af63-b85e5297118d.jpg`];
    const ctx = queryFailureContext(key);
    expect(ctx.operation).toBe('avatar_url');
    expect(ctx.record).toContain('b74ca59f-3b57-4139-af63-b85e5297118d.jpg');
    // ★★★ §C: *"a missing file is a real defect wearing a transport costume."*
    //     The message says which file.
    expect(describeFailure('Object not found', ctx)).toBe(
      `Object not found — avatar_url (${TENANT}/b74ca59f-3b57-4139-af63-b85e5297118d.jpg)`,
    );
  });

  it('names the operation on a transport failure (747, 742, 738)', () => {
    expect(
      describeFailure(
        'TypeError: Failed to fetch',
        queryFailureContext(['avatar_paths', TENANT]),
      ),
    ).toBe(`TypeError: Failed to fetch — avatar_paths (${TENANT})`);

    // 738's key carries its object in a trailing object segment.
    const thumb = queryFailureContext([
      'plan_of_record_thumb',
      TENANT,
      { objectPath: 'c2f2aaea-6a85-4392-9b75-0f965f2bf43b/marketing_internal.jpg' },
    ]);
    expect(thumb.operation).toBe('plan_of_record_thumb');
    expect(describeFailure('HTTP 502 error', thumb)).toContain(
      'objectPath=c2f2aaea-6a85-4392-9b75-0f965f2bf43b/marketing_internal.jpg',
    );
  });

  it('a 502 and a storage miss stop sharing a sentence', () => {
    // ⛔ §C: do not suppress transport failures — just stop them being
    //    indistinguishable from a missing file.
    const miss = describeFailure(
      'Object not found',
      queryFailureContext(['avatar_url', `${TENANT}/x.jpg`]),
    );
    const gateway = describeFailure(
      'HTTP 502 error',
      queryFailureContext(['plan_of_record_thumb', TENANT, { objectPath: 'p/y.jpg' }]),
    );
    expect(miss).not.toBe(gateway);
    expect(normalizeErrorMessage(miss)).not.toBe(normalizeErrorMessage(gateway));
  });

  it('the write side uses the SAME shape, from meta.write', () => {
    // ★ §C: *"extend that, do not invent a second shape."* One formatter, two
    //   callers — the mutation reporter passes `meta.write` as the operation.
    expect(
      describeFailure(
        'duplicate key value violates unique constraint "project_consultants_one_per_discipline"',
        { operation: 'bp_add_project_consultant' },
      ),
    ).toBe(
      'duplicate key value violates unique constraint "project_consultants_one_per_discipline" — bp_add_project_consultant',
    );
  });

  it('assert the SHAPE, not the wording', () => {
    // The brief's instruction. A caller that declares nothing must produce
    // byte-identical text to today's — otherwise this would be a migration of
    // every message in the app.
    expect(describeFailure('Failed to fetch', {})).toBe('Failed to fetch');
    expect(queryFailureContext(undefined)).toEqual({});
    expect(queryFailureContext([])).toEqual({});
    expect(queryFailureContext([{ notAString: 1 }])).toEqual({});
    // An operation with no record still names the operation.
    expect(describeFailure('boom', { operation: 'notes' })).toBe('boom — notes');
  });

  it('carries ids and paths, never typed content', () => {
    // ★ fix-511 §C's rule on the read side: a record identifier is a key. The
    //   values here already travel in `queryKey`; naming them exposes nothing new.
    const ctx = queryFailureContext([
      'notes',
      TENANT,
      { projectId: 'abc', body: 'a private note nobody should log' },
    ]);
    // Every string leaf of the tail is included, which is why the guard is on
    // what this app's keys CONTAIN — they carry ids, not content.
    expect(ctx.operation).toBe('notes');
    expect(ctx.record).toContain('projectId=abc');
  });

  it('the record is bounded', () => {
    const ctx = queryFailureContext(['x', 'y'.repeat(5000)]);
    expect(ctx.record!.length).toBeLessThanOrEqual(200);
  });

  it('the fingerprint still keys off queryKey[0], unchanged', () => {
    // ★★ fix-338's discriminator is untouched: §C adds to the MESSAGE and the
    //    CONTEXT, and leaves `queryKey` exactly as it was, so grouping still
    //    separates two queries that share a message.
    const a = errorFingerprintKey('backend_rpc', 'Object not found', {
      queryKey: ['avatar_url', 'p'],
    });
    const b = errorFingerprintKey('backend_rpc', 'Object not found', {
      queryKey: ['plan_of_record_thumb', 'p'],
    });
    expect(a).not.toBe(b);
  });
});
