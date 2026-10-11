import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { signShare, pagePaths, SHARE_BUCKET, type Deps } from '../../supabase/functions/plan-share/handler';

// ===========================================================================
// fix-574 (P-279) — a shared page is readable by the person it was shared with
// ===========================================================================
//
// 🚨 LIVE, EXTERNAL-FACING. Every plan share link ever sent showed
//    "The pages could not be loaded."
//
// ---------------------------------------------------------------------------
// ★★★ THE BRIEF'S DIAGNOSIS WAS RIGHT ABOUT EVERY ROW IT MEASURED AND WRONG
//     ABOUT THE CAUSE — IT OMITTED THE ROW THAT DECIDES IT
// ---------------------------------------------------------------------------
//
// §0 established: the link is healthy, the file index is healthy,
// `bp_resolve_plan_share` is `SECURITY DEFINER` and `anon` may execute it, the
// bucket is private, and its only read policy is `authenticated`-only. **Every
// one of those is true** — re-measured on prod 2026-09-15.
//
// ★★★ THE MISSING ROW: **does the shared page read Storage as `anon`?**
//     **It does not.** It calls the `plan-share` Edge Function, which signs
//     with the SERVICE-ROLE key — and a service-role client **bypasses RLS
//     entirely**. So the proposed anon SELECT policy on `storage.objects`
//     would have been evaluated by nobody.
//
// ★★★ THE ACTUAL CAUSE: **`plan-share` IS NOT DEPLOYED.** Prod has exactly one
//     Edge Function, `admin-create-user`. Measured the same day:
//
//       function_edge_logs   12 requests to …/functions/v1/plan-share,
//                            ALL 404, in 24 hours
//       plan_share_links     view_count climbing on 6 live links (17 resolves,
//                            newest 19:49 UTC)
//
//     Real visitors arrive, the RPC answers — which is why the title, the page
//     count and the expiry all render — and the signing call 404s.
//
// ★★ AND fix-523 SAID SO, IN THE RIGHT FILE, ON THE DAY IT MERGED:
//    *"Not deployed at merge. Until it is, `/s/<token>` renders the set's name,
//    page count and expiry and says the pages could not be loaded."* That is
//    P-279, written down four days early, in a README nobody had a reason to
//    open. `supabase/functions/DEPLOY_STATUS.md` is the page that would have
//    been opened, and the guard at the foot of this file keeps it honest.
//
// ---------------------------------------------------------------------------
// ★★★ SO §B's INSTRUCTION APPLIES AND THE POLICY IS NOT IN THIS PR
// ---------------------------------------------------------------------------
//
// *"If A turns out not to work, STOP and report rather than improvising a
// hybrid."* It does not work, so there is no migration here. The tests below
// pin the two things that make that a finding rather than an opinion: the
// dependency chain the pictures actually travel, and the reason the policy
// would have been dead code.
// ===========================================================================

const repo = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

/** ★ Comments stripped — JSX blocks too. Half these files EXPLAIN the storage
 *  path they do not take, so a raw grep would pass on the explanation (the
 *  gravestone trap, 22nd recording). */
const code = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// §1 · THE DEPENDENCY CHAIN — where the pictures actually come from
// ---------------------------------------------------------------------------

describe('fix-574 §1 — the shared page never reads Storage as anon', () => {
  it('★★★ THE WHOLE DIAGNOSIS: the images come from the FUNCTION, not the bucket', () => {
    // ★★★ THIS IS THE ASSERTION THE BRIEF'S §0 TABLE NEEDED A ROW FOR. If the
    //     page read Storage directly, an anon SELECT policy would be the fix.
    //     It does not — it invokes an Edge Function and renders what comes
    //     back. Three files, one chain, no `supabase.storage` anywhere on it.
    for (const f of [
      'src/pages/SharedPlan.tsx',
      'src/hooks/usePlanShare.ts',
      'src/lib/planShare.ts',
    ]) {
      expect(code(repo(f)), `${f} must not read Storage on the share path`)
        .not.toMatch(/supabase\s*\.\s*storage|from\(['"]plan-thumbnails['"]\)/);
    }
    // ★ …and the one call it DOES make.
    const hook = code(repo('src/hooks/usePlanShare.ts'));
    expect(hook).toContain('functions.invoke');
    expect(hook).toContain('PLAN_SHARE_FUNCTION');
    expect(repo('src/hooks/usePlanShare.ts')).toContain("PLAN_SHARE_FUNCTION = 'plan-share'");
  });

  it('★★★ …and the function signs with the SERVICE-ROLE key, which bypasses RLS', () => {
    // ★★★ THE SECOND HALF OF WHY OPTION A WAS DEAD CODE. Even with an `anon`
    //     policy on `storage.objects`, the only client that touches this bucket
    //     on the share path authenticates as `service_role` — and RLS is not
    //     consulted for it at all. The policy would have had no evaluator.
    const index = repo('supabase/functions/plan-share/index.ts');
    expect(index).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(code(index)).toContain('createSignedUrl');
    expect(SHARE_BUCKET).toBe('plan-thumbnails');
  });

  it('★★★ an unsignable set produces EXACTLY the reported symptom', () => {
    // ★★★ THE SYMPTOM REPRODUCED FROM THE CODE, not inferred. A 404 on the
    //     function means `pageUrls = []` and `thumbUrl = null`, and
    //     `SharedPlan` renders "The pages could not be loaded." while the set
    //     name, page count and expiry above it still render from the RPC.
    //     That is P-279's description, word for word.
    const page = repo('src/pages/SharedPlan.tsx');
    expect(page).toContain('The pages could not be loaded.');
    expect(page).toContain('shared-plan-no-pages');
    // ★ The branch it sits in: no thumb AND no first page.
    expect(code(page)).toMatch(/thumbUrl \|\| pageUrls\[0\]/);
  });

  it('★★ a signing failure is caught, so a dead function is not a dead page', () => {
    // ★ The set is still named, counted and dated. fix-358's rule — *a missing
    //   picture must never look like a missing document* — is why P-279 is a
    //   broken feature rather than a broken link, and why nobody noticed for
    //   four days.
    const hook = code(repo('src/hooks/usePlanShare.ts'));
    expect(hook).toMatch(/catch\s*\{[\s\S]*?pageUrls = \[\];/);
  });
});

// ---------------------------------------------------------------------------
// §2 · THE HANDLER IS CORRECT, SO THE DEPLOY IS THE WHOLE FIX
// ---------------------------------------------------------------------------

describe('fix-574 §2 — nothing in the function needs changing', () => {
  const row = {
    project_address: '1 Main St',
    set_type: 'marketing',
    variant: 'external',
    file_name: 'Marketing set.pdf',
    page_count: 6,
    // ★ A REAL prod prefix, read off the live share on 2026-09-15.
    pages_prefix: '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/',
    thumb_path: '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external.jpg',
    expires_at: '2026-10-11T01:38:46.900752+00:00',
    pdf_path: '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/source.pdf',
    pdf_bytes: 4_000_000,
  };

  const deps = (resolved: typeof row | null): Deps => ({
    resolve: async () => resolved,
    sign: async (p) => `https://signed.example/${p}?token=x`,
  });

  it('★★★ a live token signs every page, the thumb and the PDF', async () => {
    const out = await signShare(deps(row), { token: 'a'.repeat(22) });
    expect(out.pages).toHaveLength(6);
    expect(out.pages[0]).toContain('marketing_external/p001.jpg');
    expect(out.pages[5]).toContain('marketing_external/p006.jpg');
    expect(out.thumb).toContain('marketing_external.jpg');
    expect(out.pdf).toContain('source.pdf');
    expect(out.pdfBytes).toBe(4_000_000);
  });

  it('★★★ the paths it derives are the paths that EXIST on prod', () => {
    // ★★★ The three shapes, verified against `storage.objects` on 2026-09-15:
    //       pages  <project>/<set_folder>/pNNN.jpg
    //       thumb  <project>/<set_folder>.jpg
    //       pdf    <project>/<set_folder>/source.pdf
    //     A deploy of a function that derived a different path would 404 just
    //     as quietly as no deploy at all.
    expect(pagePaths(row.pages_prefix, 6)).toEqual([
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p001.jpg',
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p002.jpg',
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p003.jpg',
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p004.jpg',
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p005.jpg',
      '3fa454fc-007c-496a-bbe3-4dce5a61e891/marketing_external/p006.jpg',
    ]);
  });

  it('★★★ THE PDF LIVES INSIDE THE SET FOLDER — the brief said otherwise', () => {
    // ★★★ §A's note predicted the proposed policy would DENY the PDF because
    //     `pdf_path` sat outside the set folder. Measured: it does not.
    //     `…/marketing_external/source.pdf` has the set folder at segment 2,
    //     exactly like a page, so the policy's clause would have covered it.
    //     **Only the THUMB (`…/marketing_external.jpg`) sits outside**, and the
    //     shared page needs the thumb for the 122-of-334 one-page sets that
    //     have no `pages_prefix` at all.
    //
    // ★★ Recorded because it is the kind of premise that survives a rewrite:
    //    had option A shipped, it would have been widened for the PDF it
    //    already covered, and left broken for the thumb it did not.
    const seg2 = (p: string) => p.split('/')[1];
    expect(seg2(row.pdf_path)).toBe('marketing_external');
    expect(seg2(row.thumb_path)).toBe('marketing_external.jpg');
    expect(seg2(row.thumb_path)).not.toBe('marketing_external');
  });

  it('★★ a dead token and a live set with nothing signable answer identically', () => {
    // fix-523 §A1's rule, untouched by this ticket: expired, revoked, set gone
    // and never-existed must be indistinguishable.
    return Promise.all([
      signShare(deps(null), { token: 'a'.repeat(22) }),
      signShare(deps(row), { token: 'short' }),
    ]).then(([dead, malformed]) => {
      expect(dead).toEqual({ pages: [], thumb: null, pdf: null, pdfBytes: null });
      expect(malformed).toEqual(dead);
    });
  });
});

// ---------------------------------------------------------------------------
// §3 · NO STORAGE POLICY SHIPPED, AND NO MIGRATION
// ---------------------------------------------------------------------------

describe('fix-574 §3 — option A is deliberately absent', () => {
  it('★★★ this ticket added NO migration', () => {
    // ★★★ §B: *"If A turns out not to work, STOP and report rather than
    //     improvising a hybrid."* There is nothing to apply, and a file named
    //     for this fix would be a loaded gun for a policy that fixes nothing.
    const dir = resolvePath(process.cwd(), 'migrations');
    const mine = readdirSync(dir).filter((f) => /fix_574/i.test(f));
    expect(mine).toEqual([]);
  });

  it('★★★ …and the reason is written where the next person will look', () => {
    // ⚠️ A policy that would be dead code is ALSO a permanent widening: it
    //    authorises by PATH, so a path-holder could read a set for as long as
    //    ANY live share existed on that project — including after their own
    //    link was revoked. Dead code with a real cost is the worst trade
    //    available, and "just in case" is exactly how it gets added later.
    const status = repo('supabase/functions/DEPLOY_STATUS.md');
    expect(status).toContain('What is NOT the fix');
    expect(status).toMatch(/bypasses RLS entirely/);
    // ★ Whitespace-tolerant: the sentence wraps in the markdown, and a literal
    //   anchor would encode somebody's line breaks as if they were syntax
    //   (fix-537's lesson, in a test).
    expect(status.replace(/\s+/g, ' ')).toContain(
      'because **nothing reads that bucket as `anon`**',
    );
  });
});

// ---------------------------------------------------------------------------
// §4 · THE GUARD — a merged function is not a shipped function
// ---------------------------------------------------------------------------

describe('fix-574 §4 — every Edge Function is listed as deployed or not', () => {
  const FUNCTIONS_DIR = resolvePath(process.cwd(), 'supabase/functions');
  const STATUS = resolvePath(FUNCTIONS_DIR, 'DEPLOY_STATUS.md');

  // ★★★ fix-638: THIS GUARD CHECKS THE PAGE'S SHAPE, NEVER ITS VERDICTS.
  //     Until fix-638 it also pinned literal strings — "plan-share … NOT
  //     DEPLOYED", "admin-create-user … DEPLOYED, BUT STALE", "hook is also NOT
  //     enabled". All three had been false for days, and correcting the page
  //     failed CI, so the page kept saying them. A status test that forbids the
  //     status from changing is the stale README with extra steps. What stays
  //     pinned is what can be checked without prod: every function has a row, a
  //     deploy command and a README, and `_`-prefixed folders are not functions.
  //
  // ★★ `_shared/` (fix-628) is shared code: Supabase bundles it into whatever
  //    imports it and never deploys it alone, so it gets no row and no command.
  function functionDirs(): string[] {
    return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();
  }

  /** The functions the page has a table row for: lines starting "| `name` |". */
  function rowNames(status: string): string[] {
    return [...status.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]!);
  }

  /** ★ The structural rule, as a pure function so it can be tested failing. */
  function structuralProblems(dirs: readonly string[], status: string): string[] {
    const rows = new Set(rowNames(status));
    const problems: string[] = [];
    for (const d of dirs) {
      if (!rows.has(d)) problems.push(`${d}: no row in DEPLOY_STATUS.md`);
      if (!status.includes(`supabase functions deploy ${d} `)) {
        problems.push(`${d}: no deploy command`);
      }
    }
    for (const r of rows) {
      if (!dirs.includes(r)) problems.push(`${r}: row for a function that does not exist`);
    }
    return problems;
  }

  it('★★ the folder is not empty (the test would pass vacuously otherwise)', () => {
    expect(functionDirs().length).toBeGreaterThan(0);
  });

  it('★★★ every function directory has a row and a deploy command, and every row a directory', () => {
    const status = readFileSync(STATUS, 'utf8');
    const problems = structuralProblems(functionDirs(), status);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('★★★ fix-638: a function folder with NO row is caught (the guard can fail)', () => {
    // A guard nobody has seen fail is a guard nobody knows works. Feed it the
    // real page plus a function that is not on it.
    const status = readFileSync(STATUS, 'utf8');
    const problems = structuralProblems([...functionDirs(), 'brand-new-fn'], status);
    expect(problems).toContain('brand-new-fn: no row in DEPLOY_STATUS.md');
    expect(problems).toContain('brand-new-fn: no deploy command');
  });

  it('★★★ _-prefixed folders are shared code, not functions — and no row asks to deploy one', () => {
    const dirs = functionDirs();
    expect(dirs.some((d) => d.startsWith('_'))).toBe(false);
    expect(existsSync(resolvePath(FUNCTIONS_DIR, '_shared', 'README.md'))).toBe(true);
    const status = readFileSync(STATUS, 'utf8');
    expect(status).not.toMatch(/supabase functions deploy _/);
  });

  it('★★ every function has its own README beside its row', () => {
    for (const d of functionDirs()) {
      expect(existsSync(resolvePath(FUNCTIONS_DIR, d, 'README.md')), `${d} has no README`).toBe(true);
    }
  });

  it('★★ the page says when it was read, so a reader can tell how old its verdicts are', () => {
    const status = readFileSync(STATUS, 'utf8');
    expect(status).toMatch(/Read from prod \(`eibnmwthkcuumyclyxoe`\) on \d{4}-\d{2}-\d{2}/);
  });

  it('★★ the one flag to get right is still written down', () => {
    // A rule, not a verdict: it is true whatever is or is not deployed today.
    const status = readFileSync(STATUS, 'utf8');
    expect(status).toContain('`--no-verify-jwt` is the one flag to get right');
  });
});
