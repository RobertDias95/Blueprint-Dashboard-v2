// ===========================================================================
// ★★★ fix-604 (P-286 §B) — EVERY FAILED WRITE REACHES ERROR TRIAGE, NAMED
// ===========================================================================
//
// P-286, Bobby 2026-09-16: *"5829 104th Ave NE — tried to cancel but it wouldn't
// let me?"* — and the database had nothing: no hold row, no audit row, no
// `error_reports` row. `useProjectHolds` showed the reason in a toast for a few
// seconds and destroyed it.
//
// ★★★ AND THE FIRST THING THIS TICKET MEASURED SAYS THE DIAGNOSIS WAS WRONG.
//     `meta.write` is NOT the gate on whether a failure is recorded. App.tsx's
//     MutationCache.onError logs EVERY mutation rejection that clears
//     `shouldSkipBackendRpcLog`, and it calls `mutationErrorContext(key, meta,
//     …)` with whatever `meta` happens to be — undefined included. Measured on
//     prod (eibnmwthkcuumyclyxoe) at `d35ec2d`:
//
//       kind=mutation, context HAS 'write' :  16 rows   (2026-09-11 → 09-16)
//       kind=mutation, context has NO 'write': 83 rows  (2026-06-02 → 09-23)
//       kind=query                           : 35 rows
//
//     **83 failed writes reached triage already.** They arrived anonymous —
//     `{url, kind}` and nothing else — which is fix-511 §C's complaint, not a
//     missing row. So this ticket does NOT make failures recorded; they were.
//     It makes recorded failures ATTRIBUTABLE.
//
// ★★★ WHICH MEANS THE 5829 CANCEL IS STILL UNEXPLAINED, AND THE NUMBERS SAY SO.
//     If that cancel had rejected, there would be an anonymous row for it. The
//     project exists (e68de699-…), it holds ZERO project_holds rows, and no
//     mutation report on 09-15..09-18 mentions a cancel. A write that produced
//     no row, no audit entry AND no rejection did not fail — it never ran. That
//     is a component-level question (a gate, a disabled control, a handler that
//     was never wired) and this ticket is scoped to `src/hooks/`, so it is
//     reported rather than fixed. See the PR body.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE PINS
// ---------------------------------------------------------------------------
// §1.4's census: a write mutation that does not declare `meta.write`, and is not
// on the allow-list below, fails CI. The rule is deliberately TOTAL — every
// `useMutation` in `src/`, not "every one my scanner believes writes" — because
// "does this write?" is exactly the judgement a static scan gets wrong, and
// getting it wrong silently is how 83 anonymous rows happened in the first
// place. A mutation that writes nothing is listed, with a reason, by a person.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SRC = resolve(__dirname, '..');

// ===========================================================================
// THE ALLOW-LIST — §1.3
// ===========================================================================
//
// ★ One line of reason each, and the bar is high: not "its failure is not very
//   interesting" but "it performs no write at all". A best-effort write whose
//   failure nobody needs to see would also belong here; this app has none.
//
// ★★ EXPECT THIS TO STAY TINY. It is the escape hatch for a mutation that is
//    imperative rather than a save — and there is exactly one.
const ALLOW_LIST: Readonly<Record<string, string>> = {
  // Verified on prod, not assumed: `bp_preview_report_spec` is a 243-character
  // body with no INSERT / UPDATE / DELETE in it. The report builder runs it to
  // render a preview, so it is a READ expressed as a mutation (imperative, not
  // cached) — there is no write to name. Its failure still reaches triage
  // through the generic path, and the user still sees "Preview failed".
  usePreviewReportSpec: 'reads only — bp_preview_report_spec writes nothing',
};

// ===========================================================================
// THE SCANNER
// ===========================================================================
//
// ★★★ FOUR BUGS WERE WRITTEN AND FIXED GETTING THIS RIGHT, all the same mistake
//     wearing different clothes: regex over TypeScript needs the comments gone
//     and the brackets balanced BEFORE any brace is trusted. They are recorded
//     because each one produced a CONFIDENT WRONG COUNT, which is worse than a
//     crash:
//       1. A `//` comment containing a backtick swallowed the rest of the file
//          — 13 declarations measured as 2.
//       2. `useMutation` matched inside doc comments — 3 phantom hooks in
//          src/lib that do not exist.
//       3. A `{` inside a PARAMETER TYPE was mistaken for a function body, so
//          every helper that performs the write measured as writing nothing
//          (this is why useUpdateProject vanished from the census entirely).
//       4. A CALL SITE's options object is INSIDE its parens; a DECLARATION's
//          body is AFTER them. One skipper for both found 41 of 120 and named
//          none of them.
const BS = String.fromCharCode(92);

/** Same length as the source, every comment replaced by spaces. */
function maskComments(s: string): string {
  const out = s.split('');
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && s[j] !== c) {
        if (s[j] === BS) j += 1;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (s.startsWith('//', i)) {
      let j = s.indexOf('\n', i);
      if (j < 0) j = n;
      for (let k = i; k < j; k += 1) out[k] = ' ';
      i = j;
      continue;
    }
    if (s.startsWith('/*', i)) {
      const found = s.indexOf('*/', i);
      const j = found < 0 ? n : found + 2;
      for (let k = i; k < j; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** `i` points at `open`; returns the index just past its match. */
function skipBalanced(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < n && s[i] !== c) {
        if (s[i] === BS) i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return n;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
}

/**
 * From just after a CALLEE's name: skip `<generics>`, step into the
 * `( arguments )` and return the index of the first `{` INSIDE them.
 *
 * ★ Returns -1 for `useMutation(someVariable)` — an options object that is not
 *   written inline cannot be checked here, and the test says so loudly rather
 *   than passing it silently.
 */
function callOptionsBrace(s: string, pos: number): number {
  let i = skipWs(s, pos);
  if (s[i] === '<') i = skipBalanced(s, i, '<', '>');
  i = skipWs(s, i);
  if (s[i] !== '(') return -1;
  const close = skipBalanced(s, i, '(', ')');
  const j = s.indexOf('{', i);
  return j >= 0 && j < close ? j : -1;
}

/** Keys at depth 1 of an object literal (body includes its braces). */
function topLevelKeys(body: string): string[] {
  const inner = body.slice(1, -1);
  const segs: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = inner.length;
  while (i < n) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < n && inner[i] !== c) {
        if (inner[i] === BS) i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      segs.push(inner.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  segs.push(inner.slice(start));
  const keys: string[] = [];
  for (const seg of segs) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(seg);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'harness') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Found {
  file: string;
  hook: string;
  line: number;
  write: string | null;
  inline: boolean;
}

function enclosingHook(masked: string, pos: number): string {
  const before = masked.slice(0, pos);
  let best = '(anonymous)';
  const re = /export\s+function\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) best = m[1];
  return best;
}

/** Every `useMutation` call site in src/, with the `meta.write` it declares. */
function scanMutations(): Found[] {
  const found: Found[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('useMutation')) continue;
    const masked = maskComments(src);
    const re = /\buseMutation\s*(?=[<(])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const j = callOptionsBrace(masked, m.index + m[0].length);
      const rel = relative(SRC, file).replace(/\\/g, '/');
      const line = src.slice(0, m.index).split('\n').length;
      const hook = enclosingHook(masked, m.index);
      if (j < 0) {
        found.push({ file: rel, hook, line, write: null, inline: false });
        continue;
      }
      const block = masked.slice(j, skipBalanced(masked, j, '{', '}'));
      let write: string | null = null;
      if (topLevelKeys(block).includes('meta')) {
        const mm = /meta\s*:\s*\{[^}]*?write\s*:\s*'([^']*)'/.exec(block);
        if (mm && mm[1] !== '') write = mm[1];
      }
      found.push({ file: rel, hook, line, write, inline: true });
    }
  }
  return found;
}

describe('fix-604 §0 — the scanner can be trusted', () => {
  const all = scanMutations();

  // ★★★ THE GUARD THAT MAKES EVERY COUNT BELOW MEAN SOMETHING. A scanner that
  //     silently finds nothing turns this whole file into a test that always
  //     passes — which is precisely the shape of bug it exists to catch.
  it('finds the mutations that exist, in the files that hold them', () => {
    expect(all.length).toBeGreaterThanOrEqual(110);
    const files = new Set(all.map((f) => f.file));
    expect(files.size).toBeGreaterThanOrEqual(80);
    // writes live in hooks; nothing in components or pages performs one
    const stray = all.filter(
      (f) => !f.file.startsWith('hooks/') && !f.file.startsWith('lib/'),
    );
    expect(stray.map((f) => `${f.file}:${f.line}`)).toEqual([]);
  });

  it('reads an options object written inline for every one of them', () => {
    // ★ `useMutation(opts)` with the options held in a variable cannot be read
    //   by a scan. None exist today; if one appears, this fails rather than
    //   waving it through, and the fix is to inline the `meta` or to say why.
    const indirect = all.filter((f) => !f.inline);
    expect(indirect.map((f) => `${f.hook} (${f.file}:${f.line})`)).toEqual([]);
  });

  it('★ sees a planted violation — the red proof §1.4 asks for', () => {
    // The scanner's own logic, run over a fixture rather than the tree, so the
    // red case is proven without editing a real hook. Three shapes that have
    // all been mis-read by an earlier draft of this scanner.
    const good = `export function useThing() {
      return useMutation<Row, Error, In>({
        meta: { write: 'bp_do_thing' },
        mutationFn: async () => supabase.rpc('bp_do_thing'),
      });
    }`;
    const bad = `export function useThing() {
      return useMutation<Row, Error, In>({
        mutationFn: async () => supabase.rpc('bp_do_thing'),
      });
    }`;
    // ★★ a `meta` that carries something else is NOT a declaration of a write
    const emptyMeta = `export function useThing() {
      return useMutation({
        meta: { invalidates: 'projects' },
        mutationFn: async () => supabase.rpc('bp_do_thing'),
      });
    }`;
    const read = (s: string): string | null => {
      const masked = maskComments(s);
      const m = /\buseMutation\s*(?=[<(])/.exec(masked);
      if (!m) return null;
      const j = callOptionsBrace(masked, m.index + m[0].length);
      if (j < 0) return null;
      const block = masked.slice(j, skipBalanced(masked, j, '{', '}'));
      if (!topLevelKeys(block).includes('meta')) return null;
      const mm = /meta\s*:\s*\{[^}]*?write\s*:\s*'([^']*)'/.exec(block);
      return mm && mm[1] !== '' ? mm[1] : null;
    };
    expect(read(good)).toBe('bp_do_thing');
    expect(read(bad)).toBeNull();
    expect(read(emptyMeta)).toBeNull();
  });

  it('★★ is not fooled by a `write:` that only appears in a COMMENT', () => {
    // ★★★ THE GRAVESTONE TRAP, which has bitten this repo six times: a comment
    //     quoting the thing it describes keeps an assertion green. The scanner
    //     masks comments first, so a hook that only TALKS about meta.write is
    //     still a violation.
    const commented = `export function useThing() {
      return useMutation({
        // meta: { write: 'bp_do_thing' },  <- left as a note, never enabled
        mutationFn: async () => supabase.rpc('bp_do_thing'),
      });
    }`;
    const masked = maskComments(commented);
    const m = /\buseMutation\s*(?=[<(])/.exec(masked) as RegExpExecArray;
    const j = callOptionsBrace(masked, m.index + m[0].length);
    const block = masked.slice(j, skipBalanced(masked, j, '{', '}'));
    expect(topLevelKeys(block)).not.toContain('meta');
  });
});

describe('fix-604 §1 — every write mutation names what it writes', () => {
  const all = scanMutations();

  it('★★★ no write mutation is anonymous', () => {
    const offenders = all
      .filter((f) => f.write === null)
      .filter((f) => !(f.hook in ALLOW_LIST))
      .map((f) => `${f.hook} — ${f.file}:${f.line}`);
    // ★ The message is the whole value of this test: it names the hook and the
    //   line, so the fix is one line and needs no investigation.
    expect(offenders).toEqual([]);
  });

  it('every allow-list entry is real, used, and carries a reason', () => {
    for (const [hook, reason] of Object.entries(ALLOW_LIST)) {
      // ★ a stale entry is a hole in the census that looks like a decision
      expect(all.some((f) => f.hook === hook), `${hook} no longer exists`).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
    // ★★ and it has not quietly become a dumping ground
    expect(Object.keys(ALLOW_LIST).length).toBeLessThanOrEqual(3);
  });

  it('★ an allow-listed mutation does NOT also declare a write', () => {
    // Listing it and naming it are contradictory claims about the same hook.
    for (const hook of Object.keys(ALLOW_LIST)) {
      for (const f of all.filter((x) => x.hook === hook)) {
        expect(f.write, `${hook} is allow-listed but declares a write`).toBeNull();
      }
    }
  });

  it('★★ the census covers the whole app: 121 mutations, 120 named, 1 listed', () => {
    // ★ Re-derived at d35ec2d, and pinned so a NEW hook cannot slip in without
    //   this number moving and someone noticing.
    // ★ fix-609: +1, `useAddTemplateTasks` (bp_add_template_tasks_to_permit) —
    //   named, so it moves both numbers together.
    const named = all.filter((f) => f.write !== null);
    const listed = all.filter((f) => f.hook in ALLOW_LIST);
    expect(all.length).toBe(121);
    expect(named.length).toBe(120);
    expect(listed.length).toBe(1);
    expect(named.length + listed.length).toBe(all.length);
  });

  it('★★ names follow the existing convention — an RPC, or table.verb', () => {
    // The 13 that pre-date this ticket set the shape; fix-511 §C's wording is
    // *"an RPC name (bp_upsert_da_time_block_row) or table.verb
    // (projects.update)"*. One third shape exists and is deliberate.
    const EDGE_FUNCTIONS = new Set(['admin-create-user']);
    for (const f of all) {
      if (f.write === null) continue;
      const ok =
        /^bp_[a-z0-9_]+$/.test(f.write) ||
        /^[a-z0-9_]+\.(insert|update|upsert|delete)$/.test(f.write) ||
        /^storage:[a-z0-9_-]+\.(upload|remove)$/.test(f.write) ||
        EDGE_FUNCTIONS.has(f.write);
      expect(ok, `${f.hook} declares a non-conforming name: ${f.write}`).toBe(true);
    }
  });

  it('★★★ the name matches what the hook actually calls', () => {
    // ★★★ THE ASSERTION THAT STOPS A COPY-PASTE LIE. 106 of these lines were
    //     added mechanically in one pass; a name that names the WRONG RPC is
    //     worse than no name, because triage would attribute a failure to a
    //     function that never ran. So for every hook whose declared name looks
    //     like an RPC, that RPC must appear in the file.
    const byFile = new Map<string, string>();
    for (const f of all) {
      if (f.write === null || !f.write.startsWith('bp_')) continue;
      if (!byFile.has(f.file)) {
        byFile.set(f.file, maskComments(readFileSync(join(SRC, f.file), 'utf8')));
      }
      const body = byFile.get(f.file) as string;
      expect(
        body.includes(`'${f.write}'`),
        `${f.hook} declares ${f.write}, which ${f.file} never calls`,
      ).toBe(true);
    }
  });

  it('★ the 13 that pre-date this ticket are untouched', () => {
    // §1.2: do not change user-facing behaviour, and do not rename what was
    // already right. These are the names fix-511 §C / fix-580 / fix-592 chose.
    const pinned: Record<string, string> = {
      useCreateProjectWithPermits: 'bp_create_project_with_permits',
      useDeleteDaTimeBlock: 'bp_delete_da_time_block_row',
      useDeleteIntakeRecord: 'bp_delete_intake_records_row',
      useRenameDA: 'bp_rename_da',
      useResizeDaTimeBlock: 'bp_resize_da_time_block',
      useRestoreAuditedRow: 'bp_restore_audited_row',
      useRestoreDeletedQuarterLayout: 'bp_restore_deleted_quarter_layout',
      useUpsertTeamTask: 'bp_upsert_team_task',
      useUpdateLibraryFields: 'bp_update_library_fields',
      useUpdateProject: 'projects.update',
      useUpdateProjectWithPermits: 'bp_update_project_with_permits',
      useUpsertDaTimeBlock: 'bp_upsert_da_time_block_row',
      useUpsertIntakeRecord: 'bp_upsert_intake_records_row',
    };
    for (const [hook, write] of Object.entries(pinned)) {
      const row = all.find((f) => f.hook === hook);
      expect(row?.write, hook).toBe(write);
    }
  });

  it('★★ the hook from P-286 itself now names its write', () => {
    // The cancel Bobby could not do. Naming it does not explain the incident
    // (see the header), but an anonymous row was never going to.
    const holds = all.filter((f) => f.file === 'hooks/useProjectHolds.ts');
    expect(holds.map((f) => f.write).sort()).toEqual([
      'bp_lift_project_hold',
      'bp_restore_project',
      'bp_set_project_cancel',
      'bp_set_project_hold',
      'bp_update_project_hold',
    ]);
  });
});

describe('fix-604 §0.1 — the mechanism that turns meta.write into a row', () => {
  const app = readFileSync(resolve(SRC, 'App.tsx'), 'utf8');

  it('★★★ App.tsx reports EVERY mutation failure, named or not', () => {
    // ★★★ QUOTED HERE BECAUSE IT IS THE WHOLE RE-DERIVATION. `meta` is an
    //     ARGUMENT to the context builder, not a condition guarding the call.
    //     The only gate is shouldSkipBackendRpcLog. This is why 83 prod rows
    //     exist with no `write` in them, and why this ticket cannot be
    //     described as "making failures recorded".
    expect(app).toContain('mutationCache: new MutationCache({');
    expect(app).toContain(
      'const wrote = mutationErrorContext(key, mutation.options.meta, vars, err);',
    );
    expect(app).toContain('if (shouldSkipBackendRpcLog(err, key)) return;');
    // the log call is NOT conditional on `wrote.write`
    expect(app).not.toMatch(/if\s*\(\s*!?\s*wrote\.write\s*\)/);
  });

  it('★ the person is told BEFORE the skip rules are consulted', () => {
    // fix-372 §6's ordering, pinned because this ticket must not change
    // user-facing behaviour (§1.2): the save-failure banner fires first, so a
    // quietened report can never also quieten the warning to the person.
    const report = app.indexOf('useSaveFailureStore.getState().report({');
    const skip = app.indexOf('if (shouldSkipBackendRpcLog(err, key)) return;');
    expect(report).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(report);
  });
});
