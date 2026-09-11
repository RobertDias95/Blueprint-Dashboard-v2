import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  PLAN_SHARE_PATH,
  PLAN_SHARE_UNAVAILABLE,
  planShareExpiryNote,
  planSharePagePaths,
  planShareSetLabel,
  planShareUrl,
} from '../lib/planShare';
import {
  firstAvailableVariant,
  planOfRecordSetAvailable,
  planOfRecordSetFor,
  planOfRecordViewerMode,
} from '../lib/planOfRecord';
import { findShareLink } from '../hooks/usePlanShare';
import {
  PAGE_SIGN_TTL_SECONDS,
  SHARE_BUCKET as FN_SHARE_BUCKET,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  normaliseToken,
  pagePaths as fnPagePaths,
  signShare,
  type ShareRow,
} from '../../supabase/functions/plan-share/handler';
import { SHARE_BUCKET, SHARE_TTL_DAYS } from '../lib/planOfRecordShare';
import SharedPlan from '../pages/SharedPlan';

// ===========================================================================
// fix-523 — the share link becomes a real thing (P-187 · P-237 · P-239)
// ===========================================================================
//
// ★ Source-text assertions read the file with comments STRIPPED. Every "must
//   not appear" grep in this repo has at some point matched its own gravestone
//   — the comment explaining why the thing is absent — and fix-521 and fix-522
//   both paid for it. Sixth recording.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------------------
// §B2 (P-239) — the empty plan button grays in only one direction
// ---------------------------------------------------------------------------

interface FakeSet {
  set_type: 'marketing' | 'schematic' | 'design_guidance';
  variant: string;
  page_count: number | null;
  thumb_path: string | null;
  thumb_status: string | null;
  file_name: string | null;
}

function set(
  set_type: FakeSet['set_type'],
  variant: string,
  over: Partial<FakeSet> = {},
): FakeSet {
  return {
    set_type,
    variant,
    page_count: 1,
    thumb_path: `p/${set_type}_${variant || 'none'}.jpg`,
    thumb_status: 'ok',
    file_name: `${set_type} ${variant}.pdf`,
    ...over,
  };
}

const sets = (rows: FakeSet[]) => ({ available: true, rows });

describe('fix-523 §B2 (P-239) — the guard asks BOTH directions', () => {
  // ★★★ THIS IS THE WHOLE POINT OF THE SECTION. `SetButtons` read
  //     `disabled={b.variant === 'external' && !externalReady}` — ONE
  //     one-sided guard, not two that disagree: a single expression naming
  //     `external`, which can only ever ask about `external`. There was never a
  //     second guard to be inconsistent with; the other direction was never
  //     asked at all.
  //
  // ★★★ MEASURED ON PROD 2026-09-11 over the 167 projects with any set:
  //       Site Plan only  →  Marketing correctly grays        5
  //       Marketing only  →  BOTH stayed clickable           74
  //       both                                               53
  //       neither (schematic / design guidance only)         35
  //     **The direction that worked is the rare one**, by fifteen to one.
  //
  // ★ Same assertion, arguments swapped. A one-sided guard that only ever gets
  //   a one-sided test is how this class keeps shipping — fix-511 banked it,
  //   P-223 paid it again (a test asserting "Project Settings" was ABSENT was
  //   satisfied by a button reading "Project Data"), and this is the third.
  it('★★★ internal-only grays Marketing and leaves Site Plan live', () => {
    const s = sets([set('marketing', 'internal')]);
    expect(planOfRecordSetAvailable('marketing', s, 'external')).toBe(false);
    expect(planOfRecordSetAvailable('marketing', s, 'internal')).toBe(true);
  });

  it('★★★ external-only grays Site Plan and leaves Marketing live — the 74', () => {
    const s = sets([set('marketing', 'external', { page_count: 6 })]);
    expect(planOfRecordSetAvailable('marketing', s, 'internal')).toBe(false);
    expect(planOfRecordSetAvailable('marketing', s, 'external')).toBe(true);
  });

  it('both present → neither grays', () => {
    const s = sets([set('marketing', 'internal'), set('marketing', 'external')]);
    expect(planOfRecordSetAvailable('marketing', s, 'internal')).toBe(true);
    expect(planOfRecordSetAvailable('marketing', s, 'external')).toBe(true);
  });

  it('★★ a one-button stage is never grayed by a variant it does not have', () => {
    // ★ `variant` is NULL for all 101 schematics and all 48 design-guidance
    //   sets on prod. Asking a schematic about `external` must not gray its one
    //   button — which is what `findVariant` (marketing-only) would have caused
    //   the moment an availability guard read it.
    const s = sets([set('schematic', '')]);
    expect(planOfRecordSetAvailable('schematic', s, 'internal')).toBe(true);
    expect(planOfRecordSetAvailable('schematic', s, 'external')).toBe(true);
    expect(planOfRecordSetFor('schematic', s, 'external')?.set_type).toBe('schematic');
  });

  it('★★★ a gray button has exactly ONE cause: no current set of that type', () => {
    // ★★★ The old guard also folded in `pages_status === 'ok'` and
    //     `page_count > 0`, so "the pages failed to render" grayed identically
    //     to "there is no such set" — two causes wearing one colour. All 334
    //     current sets read `pages_status = 'ok'` on prod, so the second cause
    //     has never once fired; the guard must not quietly acquire one later.
    const broken = sets([
      set('marketing', 'internal', { page_count: 0, thumb_status: 'failed', thumb_path: null }),
    ]);
    expect(planOfRecordSetAvailable('marketing', broken, 'internal')).toBe(true);
    // ★ And the availability predicate reads NOTHING about rendering.
    const lib = code(read('src/lib/planOfRecord.ts'));
    const fn = lib.slice(
      lib.indexOf('export function planOfRecordSetAvailable'),
      lib.indexOf('export function firstAvailableVariant'),
    );
    expect(fn).not.toContain('pages_status');
    expect(fn).not.toContain('page_count');
    expect(fn).not.toContain('thumb_status');
  });

  it('★★ the card opens on a button that works', () => {
    expect(firstAvailableVariant('marketing', sets([set('marketing', 'external')]))).toBe(
      'external',
    );
    expect(firstAvailableVariant('marketing', sets([set('marketing', 'internal')]))).toBe(
      'internal',
    );
    // ★ Both present → the first button, which is Site Plan. Unchanged.
    expect(
      firstAvailableVariant(
        'marketing',
        sets([set('marketing', 'internal'), set('marketing', 'external')]),
      ),
    ).toBe('internal');
  });

  it('★★ a stage the sets view knows nothing about does not gray', () => {
    // ★ 0 of 167 plan-of-record rows lack a set row of their own stage
    //   (measured 2026-09-11), so this is defensive — but the card renders
    //   because a DOCUMENT exists, and "we have no set information" is not
    //   "there is no set". Absence of evidence.
    expect(planOfRecordSetAvailable('marketing', sets([set('schematic', '')]), 'internal')).toBe(
      true,
    );
    expect(planOfRecordSetAvailable('marketing', undefined, 'internal')).toBe(true);
    expect(planOfRecordSetAvailable('marketing', { available: false, rows: [] }, 'external')).toBe(
      true,
    );
  });

  it('★★★ NO EXPLANATORY TEXT for an unavailable set — ruled, not preferred', () => {
    // ⚠⚠ Bobby, 2026-09-11: *"just dont make it clickable if it isnt
    //    available, this way, we know and can go fix that. adding that
    //    additional text makes it more busy."* No tooltip, no caption, no
    //    helper line, no badge, no empty-state panel. **The gray IS the
    //    message**, and its audience is Blueprint rather than the builder.
    //
    // ★ Pinned as an ABSENCE so nobody adds one back later meaning well.
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).not.toContain('External pages arrive');
    expect(card).not.toMatch(/no set available/i);
    expect(card).not.toMatch(/coming soon/i);
    expect(card).not.toMatch(/not yet available/i);
  });

  it('★★★ the share glyph is ABSENT beside a set you cannot open', () => {
    // ★★★ `bp_create_plan_share` raises `P0002` when no current set matches, so
    //     a share control beside a gray button is a control that can only fail.
    //     By the SAME guard, not a second one — the menu is rendered inside
    //     `{!disabled && …}`.
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).toContain('{!disabled && (');
    const setButton = card.slice(card.indexOf('function SetButton('));
    expect(setButton.indexOf('{!disabled && (')).toBeLessThan(
      setButton.indexOf('<ShareMenu'),
    );
  });
});

// ---------------------------------------------------------------------------
// §A — the route
// ---------------------------------------------------------------------------

describe('fix-523 §A5 — the URL is a token and nothing else', () => {
  const TOKEN = 'a7Kd92xQrTvB1nM0pLwZuY';
  const PROJECT = '3e1f84c4-92fe-4c70-aaa2-2758c5f13d68';

  it('★★★ no project id, no set id, no address', () => {
    const url = planShareUrl('https://bridge.example.com', TOKEN);
    expect(url).toBe(`https://bridge.example.com${PLAN_SHARE_PATH}/${TOKEN}`);
    expect(url).not.toContain(PROJECT);
    expect(url).not.toMatch(/marketing|schematic|design_guidance/i);
    expect(url).not.toMatch(/densmore|ave|street/i);
    // ★ A trailing slash on the origin must not double up — a `//s/` path is a
    //   different route to every router that has ever existed.
    expect(planShareUrl('https://bridge.example.com/', TOKEN)).toBe(url);
  });

  it('★★ the route sits OUTSIDE AuthGuard and outside Chrome', () => {
    // ★★★ This is a structural property, not a styling one. Inside the `/`
    //     subtree the page would be wrapped in `AuthGuard` (which bounces a
    //     builder to the login screen) and in `Chrome` (which would hand a page
    //     anybody holding a link can open a ribbon into every project in the
    //     tenant).
    const router = read('src/router.tsx');
    const line = router
      .split('\n')
      .find((l) => l.includes("path: '/s/:token'"))!;
    expect(line).toBeTruthy();
    // ★ It is declared at the TOP level of the route array, beside /login, at
    //   the same indentation — two spaces, not the six of a child route.
    expect(line.startsWith('  { path:')).toBe(true);
    expect(line).not.toContain('AuthGuard');
    expect(line).not.toContain('Chrome');
  });

  it('★★ the page offers no way back into the app', () => {
    const page = code(read('src/pages/SharedPlan.tsx'));
    expect(page).not.toContain('<Link');
    expect(page).not.toContain('useNavigate');
    expect(page).not.toContain('Chrome');
    expect(page).not.toContain('unc_path');
  });
});

describe('fix-523 §A1 — the link resolves to the CURRENT set, always', () => {
  // ★★★ RULED BY BOBBY 2026-09-11, asked whether a live link should show what
  //     was shared or the newest version: *a builder who bookmarks a marketing
  //     link must never be working off a superseded drawing.*
  //
  // ★★★ PROVEN ON PROD IN A ROLLED-BACK TRANSACTION (the fix-153 pattern —
  //     there is no live database in CI). Minted a token against a live
  //     `marketing/external` set, then renamed the current file underneath it:
  //
  //       before  →  <the indexed name>
  //       after   →  'PROBE - Marketing - External - v2.pdf'   ← same token
  //
  //     The token names `(project_id, set_type, variant)` and
  //     `bp_resolve_plan_share` joins the `is_current` view at READ time, so
  //     the same URL serves tomorrow's file tomorrow. `rollback;`
  it('★★★ nothing caches the set identity into the link, route or props', () => {
    const hook = code(read('src/hooks/usePlanShare.ts'));
    // ★ The mint sends the three names and NO set id, no file name, no path.
    const create = hook.slice(hook.indexOf('export function useCreatePlanShare'));
    expect(create).toContain('p_project_id');
    expect(create).toContain('p_set_type');
    expect(create).toContain('p_variant');
    expect(create).not.toContain('file_index_id');
    expect(create).not.toContain('file_name');
    expect(create).not.toContain('thumb_path');
    // ★★ And the resolve sends the token alone.
    const resolveFn = hook.slice(hook.indexOf('export function usePlanShareResolve'));
    expect(resolveFn).toContain('p_token: token');
    expect(resolveFn).not.toContain('p_project_id');
  });

  it('★★★ expired, revoked, set-gone and never-existed are ONE state', () => {
    // ★★★ ALSO PROVEN ON PROD, ROLLED BACK, 2026-09-11:
    //
    //       revoked_rows 0 · expired_rows 0 · set_gone_rows 0 · unknown_rows 0
    //
    //     Zero rows for all four, BY DESIGN — a probe that could tell "revoked"
    //     from "never existed" confirms a token was once real, and one that
    //     could tell "expired" from "revoked" tells a recipient whether
    //     somebody cut them off deliberately.
    const outputs = [
      renderShare(null),
      renderShare(null),
      renderShare(null),
      renderShare(null),
    ];
    // ★ Byte-identical. Four cases, one assertion.
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toContain(PLAN_SHARE_UNAVAILABLE);
    // ★ …and it names no cause.
    expect(outputs[0]).not.toMatch(/expired|revoked|not found|deleted|invalid/i);
  });
});

describe('fix-523 §A2 — Unshare exists only when there is a live link', () => {
  const link = {
    token: 'a7Kd92xQrTvB1nM0pLwZuY',
    set_type: 'marketing',
    variant: 'external',
    expires_at: '2026-10-11T00:00:00Z',
  };

  it('matches the set it belongs to, and only that one', () => {
    expect(findShareLink([link], 'marketing', 'external')?.token).toBe(link.token);
    expect(findShareLink([link], 'marketing', 'internal')).toBeNull();
    expect(findShareLink([link], 'schematic', null)).toBeNull();
    expect(findShareLink([], 'marketing', 'external')).toBeNull();
    expect(findShareLink(undefined, 'marketing', 'external')).toBeNull();
  });

  it('★★ a stage with no variant matches its own NULL row', () => {
    // ★ `variant` is NULL for all 101 schematics on prod, and the RPCs compare
    //   `coalesce(variant, '')`. A client that sent `'internal'` for a
    //   schematic would get `P0002` — correctly, because no such set exists.
    const s = { ...link, set_type: 'schematic', variant: null };
    expect(findShareLink([s], 'schematic', null)?.token).toBe(link.token);
  });

  it('★★★ the menu item renders only when a link is passed', () => {
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).toContain('{shareLink && (');
    expect(card).toContain('-share-unshare');
    // ★ …and revoking is what it calls.
    expect(card).toContain('onUnshare(shareLink.token)');
  });

  it('★★ the query only ever asks for LIVE links', () => {
    const hook = code(read('src/hooks/usePlanShare.ts'));
    const q = hook.slice(hook.indexOf('export function usePlanShareLinks'));
    expect(q).toContain(".is('revoked_at', null)");
    expect(q).toContain(".gt('expires_at'");
  });
});

describe('fix-523 §A3/§A4 — thirty days, told to the recipient, one link per set', () => {
  it('★★ the TTL constant is unchanged and the page states it', () => {
    expect(SHARE_TTL_DAYS).toBe(30);
    expect(planShareExpiryNote('2026-10-11T00:00:00Z')).toBe(
      'This link works until Oct 11, 2026 and needs no login.',
    );
    // ★ UTC, so the same link does not appear to expire on two different days
    //   for two readers — the rule `formatModified` already follows.
    expect(planShareExpiryNote('2026-10-11T02:00:00Z')).toContain('Oct 11');
    expect(planShareExpiryNote(null)).toBe('');
    expect(planShareExpiryNote('nonsense')).toBe('');
  });

  it('★★★ the client never sends its own TTL', () => {
    // ★ The RPC defaults to 30 and caps at 90 server-side. A client number
    //   would be a second place for the copy and the expiry to disagree.
    const hook = code(read('src/hooks/usePlanShare.ts'));
    expect(hook).not.toContain('p_ttl_days');
  });

  it('★★★ minting happens on the PICK, never on the menu opening', () => {
    // ★ Otherwise a row is written every time a card is looked at — and the row
    //   is what `Unshare` keys off, so the menu would start reporting that
    //   everything is shared the moment anybody opened it.
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    const menu = card.slice(card.indexOf('function ShareMenu('));
    expect(menu).not.toContain('share.copy(');
    expect(menu).not.toContain('mutateAsync');
    expect(menu).not.toContain('useCreatePlanShare');
  });
});

describe('fix-523 §A6 — the same two viewers, driven by the same field', () => {
  // ★★★ fix-522 §C measured that keying off the LABEL instead of the page count
  //     would mis-route 102 of 334 sets. The rule is IMPORTED here rather than
  //     re-derived: a second copy would be a second answer waiting to disagree
  //     with the one a designer sees on the card.
  it('one page → drawing, several → pager', () => {
    expect(planOfRecordViewerMode(1)).toBe('drawing');
    expect(planOfRecordViewerMode(6)).toBe('pager');
    expect(planOfRecordViewerMode(13)).toBe('pager');
  });

  it('★★ the shared page imports the rule, it does not restate it', () => {
    const page = code(read('src/pages/SharedPlan.tsx'));
    expect(page).toContain("from '../lib/planOfRecord'");
    expect(page).toContain('planOfRecordViewerMode(pageCount)');
    expect(page).not.toMatch(/pageCount\s*>\s*1\s*\?/);
  });

  it('★★ a one-page set renders a drawing; a 13-page schematic pages', () => {
    const one = renderShare({
      row: shareRow({ page_count: 1, pages_prefix: null }),
      pageUrls: [],
      thumbUrl: 'https://signed/thumb.jpg',
    });
    expect(one).toContain('data-viewer-mode="drawing"');
    expect(one).not.toContain('data-viewer-mode="pager"');

    const many = renderShare({
      row: shareRow({ set_type: 'schematic', variant: null, page_count: 13 }),
      pageUrls: Array.from({ length: 13 }, (_, i) => `https://signed/p${i + 1}.jpg`),
      thumbUrl: null,
    });
    expect(many).toContain('data-viewer-mode="pager"');
    expect(many).toContain('Page 13 of 13');
  });
});

// ---------------------------------------------------------------------------
// §A5 — where the signing happens
// ---------------------------------------------------------------------------

describe('fix-523 §A5 — the Edge Function signs, and it takes a token only', () => {
  const row: ShareRow = {
    project_address: '3505 Densmore Ave N',
    set_type: 'marketing',
    variant: 'external',
    file_name: '3505 - Marketing - External.pdf',
    page_count: 3,
    pages_prefix: 'proj/marketing_external/',
    thumb_path: 'proj/marketing_external.jpg',
    expires_at: '2026-10-11T00:00:00Z',
  };

  function deps(over: Partial<{ row: ShareRow | null; sign: (p: string) => string | null }> = {}) {
    const signed: string[] = [];
    const d = {
      resolve: () => Promise.resolve(over.row === undefined ? row : over.row),
      sign: (p: string) => {
        signed.push(p);
        return Promise.resolve(over.sign ? over.sign(p) : `https://signed/${p}`);
      },
    };
    return { d, signed };
  }

  it('★★★ derives every path itself — a caller-supplied path is never signed', async () => {
    const { d, signed } = deps();
    await signShare(d, {
      token: 'a7Kd92xQrTvB1nM0pLwZuY',
      // ★★★ The attack this shape exists to refuse: a valid token plus somebody
      //     else's object. A signing endpoint that signs what it is handed is an
      //     open proxy onto the bucket, whatever it checks first.
      path: 'other-project/marketing_external/p001.jpg',
      paths: ['other-project/marketing_external/p002.jpg'],
    });
    expect(signed).toEqual([
      'proj/marketing_external/p001.jpg',
      'proj/marketing_external/p002.jpg',
      'proj/marketing_external/p003.jpg',
      'proj/marketing_external.jpg',
    ]);
    expect(signed.some((p) => p.startsWith('other-project'))).toBe(false);
  });

  it('★★★ a bad token, a dead token and a live set with no pages are ONE answer', async () => {
    // ★ fix-528 §C: the shape gained `pdf`/`pdfBytes` when the function learned
    //   to sign the source PDF. The PROPERTY is unchanged and is the point —
    //   all four causes still produce ONE answer, so the endpoint cannot be
    //   used to probe which tokens are real.
    const empty = { pages: [], thumb: null, pdf: null, pdfBytes: null };
    expect(await signShare(deps().d, { token: 'short' })).toEqual(empty);
    expect(await signShare(deps().d, { token: 'has spaces in it here' })).toEqual(empty);
    expect(await signShare(deps().d, null)).toEqual(empty);
    expect(await signShare(deps({ row: null }).d, { token: 'a7Kd92xQrTvB1nM0pLwZuY' })).toEqual(
      empty,
    );
  });

  it('★★ a page that will not sign is dropped, not rendered as an empty src', async () => {
    const { d } = deps({ sign: (p) => (p.endsWith('p002.jpg') ? null : `https://signed/${p}`) });
    const out = await signShare(d, { token: 'a7Kd92xQrTvB1nM0pLwZuY' });
    expect(out.pages).toHaveLength(2);
    expect(out.pages.every((u) => u !== '')).toBe(true);
  });

  it('★★★ the signatures are SHORT — not the link’s thirty days', () => {
    // ★ Minted fresh on every page load. A signature that outlives the visit is
    //   one more copy of the drawing loose in the world.
    expect(PAGE_SIGN_TTL_SECONDS).toBe(3600);
    expect(PAGE_SIGN_TTL_SECONDS).toBeLessThan(SHARE_TTL_DAYS * 24 * 60 * 60);
  });

  it('★★★ the service-role key is read in index.ts and never in src/', () => {
    const index = read('supabase/functions/plan-share/index.ts');
    expect(index).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    // ★★★ It must not appear anywhere the browser can reach.
    const app = ['src/hooks/usePlanShare.ts', 'src/pages/SharedPlan.tsx', 'src/lib/planShare.ts'];
    for (const f of app) {
      expect(read(f)).not.toContain('SERVICE_ROLE');
      expect(read(f)).not.toContain('service_role');
    }
  });

  it('★★★ `plan-thumbnails` stays private — still no getPublicUrl anywhere', () => {
    for (const f of [
      'src/lib/planOfRecordShare.ts',
      'src/lib/planShare.ts',
      'src/pages/SharedPlan.tsx',
      'src/hooks/usePlanShare.ts',
      'supabase/functions/plan-share/handler.ts',
      'supabase/functions/plan-share/index.ts',
    ]) {
      expect(code(read(f))).not.toContain('getPublicUrl');
    }
  });

  it('★★ TWIN: the function’s copies match the app’s originals', () => {
    // ★ The function cannot import from `src/` — Deno would have to resolve the
    //   whole app tree — so the page-path rule and the bucket name are copies.
    //   `pNNN` padded to three is exactly the detail that drifts to `pN` in one
    //   copy and sorts page 10 before page 2 for one reader and not the other.
    expect(FN_SHARE_BUCKET).toBe(SHARE_BUCKET);
    for (const [prefix, n] of [
      ['proj/marketing_external/', 13],
      ['proj/marketing_external', 1],
      [null, 4],
      ['proj/x/', 0],
    ] as Array<[string | null, number]>) {
      expect(fnPagePaths(prefix, n)).toEqual(planSharePagePaths(prefix, n));
    }
    expect(planSharePagePaths('p/', 10)[9]).toBe('p/p010.jpg');
  });

  it('★★ the token shape mirrors the CHECK constraint', () => {
    // ★ `plan_share_links_token_len`, measured off prod 2026-09-11:
    //   `char_length(token) >= 16 and <= 64`.
    expect(TOKEN_MIN_LENGTH).toBe(16);
    expect(TOKEN_MAX_LENGTH).toBe(64);
    expect(normaliseToken('a7Kd92xQrTvB1nM0pLwZuY')).toBe('a7Kd92xQrTvB1nM0pLwZuY');
    expect(normaliseToken('tooshort')).toBeNull();
    expect(normaliseToken('x'.repeat(65))).toBeNull();
    expect(normaliseToken('has/slashes/in/it/here')).toBeNull();
    expect(normaliseToken(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §B — Download PDF
// ---------------------------------------------------------------------------

describe('fix-523 §B3 — no Download PDF renders anywhere, and that is correct', () => {
  // ★★★ THE PDF ALREADY EXISTS: every one of the 334 current sets IS a PDF on
  //     `\\bpc-file` and `unc_path` is populated on all of them. The indexer
  //     opens it daily to render pages and has never uploaded it. **This is a
  //     delivery problem, not a generation problem** — and emphatically not a
  //     job for stitching the rendered page images back together, which would
  //     be a raster photograph of a drawing that blurs at the first zoom and
  //     cannot be searched.
  //
  // ★★★ SO THE CORRECT RESULT OF THIS TICKET IS THAT NEITHER BUTTON IS VISIBLE.
  //     Never a disabled or "coming soon" affordance — that is the P-032
  //     placeholder this card already had removed from it once.
  // ★★★ SUPERSEDED BY fix-528 §C — THE FILE EXISTS NOW, SO THE CONTROL DOES.
  //
  //     This asserted the ABSENCE of a download, and it was right: fix-523
  //     measured `pdf_path` NULL on every row and the sets view without the
  //     column at all, and said the correct result of that ticket was that no
  //     button renders anywhere. **The prediction it made was also right** —
  //     *"the moment the scraper uploads and the server exposes the column, the
  //     button appears"* — and fix-526's backfill did exactly that: **336 of
  //     336** current sets carry a PDF, `pdf_status = 'ok'`, and
  //     `bp_resolve_plan_share` now returns `pdf_path` and `pdf_bytes`
  //     (verified on prod 2026-09-11).
  //
  // ★★ WHAT fix-523 GOT WRONG, and this records it: it predicted the button
  //    would appear *"with no Bridge deploy"*. It could not have — the card had
  //    no control at all, and the shared page's put an OBJECT PATH in an
  //    `href`. Both needed code.
  it('★★★ fix-528: the card’s share menu offers the PDF', () => {
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).toContain('-share-download');
    expect(card).toContain('signPlanPdfUrl');
    // ★ Only when the set HAS one — 336 of 336 today, but the guard is about
    //   the control rather than about today's data.
    expect(card).toContain('{pdfPath && (');
  });

  it('★★★ the shared page hands over a SIGNED url, never the object path', () => {
    // ★★★ THE BUG fix-523 SHIPPED. `pdf_path` is an object path; it went
    //     straight into an `href`, where it resolves against the app's own
    //     origin and 404s. The control rendered, looked correct and handed over
    //     nothing — and no test saw it, because a jsdom anchor with a bad href
    //     is indistinguishable from a good one. §C's line: **"the button
    //     exists" is not "the file arrives."**
    const page = code(read('src/pages/SharedPlan.tsx'));
    expect(page).toContain('const pdfPath = pdfUrl;');
    expect(page).not.toContain('planSharePdfPath');

    const html = renderShare({
      row: shareRow({ page_count: 1, pages_prefix: null }),
      pageUrls: [],
      thumbUrl: 'https://signed/thumb.jpg',
      pdfUrl: 'https://signed/set.pdf?token=abc',
      pdfBytes: 2_774_619,
    });
    expect(html).toContain('shared-plan-download-pdf');
    expect(html).toContain('https://signed/set.pdf?token=abc');
    // ★ …and it says how big it is, because a builder on a phone deserves to
    //   know before pressing it.
    expect(html).toContain('2.6 MB');
  });

  it('★★★ …and it is ABSENT when nothing could be signed', () => {
    // ★ Which is also what an undeployed `plan-share` function produces. Absent
    //   rather than disabled — P-239's rule.
    const html = renderShare({
      row: shareRow({ page_count: 1, pages_prefix: null }),
      pageUrls: [],
      thumbUrl: 'https://signed/thumb.jpg',
      pdfUrl: null,
      pdfBytes: null,
    });
    expect(html).not.toContain('shared-plan-download-pdf');
    expect(html).not.toMatch(/download pdf/i);
  });

  // ★★★ SUPERSEDED BY fix-528 §0 — AND THIS ONE IS THE LESSON OF THE TICKET.
  //
  //     It asserted that the email promises no attachment, on the reasoning
  //     that *"a `mailto:` cannot carry one."* The reasoning is correct and the
  //     conclusion was wrong: **`mailto:` was never a requirement.** It is what
  //     this app happened to use, and three tickets restated it as a law while
  //     Bobby asked for the same thing four times.
  //
  // ★★★ WHAT SURVIVES IS THE HONESTY RULE — do not promise a file the control
  //     cannot hand over. The menu does not mention email at all now, and the
  //     item that WILL carry an attachment (§A's Graph draft) is behind an IT
  //     gate and is not built.
  it('★★★ nothing promises an email attachment it cannot send', () => {
    const card = code(read('src/components/ProjectDetail/PlanOfRecordCard.tsx'));
    expect(card).not.toMatch(/attach/i);
    expect(card).not.toContain('-share-email');
    // ★ No Graph, no draft, no send — §A4 says report the shape and STOP.
    expect(card).not.toMatch(/graph|microsoft|Mail\.Send/i);
  });
});

// ---------------------------------------------------------------------------
// §C — a project with DD dates always gets a block
// ---------------------------------------------------------------------------

describe('fix-523 §C (P-237) — the fourth branch', () => {
  const sql = read('migrations/fix_523_draw_schedule_fourth_branch.sql');

  /**
   * ★★★ A PURE-TS MIRROR OF THE FOUR BRANCHES. There is no live database in CI
   *     (the fix-153 pattern), so the RULE is tested here and the SQL is
   *     patched by anchor. The mirror is faithful including its guards —
   *     fix-521 mis-measured a divergence by dropping one.
   */
  function mintsBlock(p: {
    redesignPhase: boolean;
    autoPlaced: boolean;
    manualDdStart: string | null;
    manualDdEnd: string | null;
    leadDa: string | null;
  }): { inserts: boolean; daAssigned: string | null } {
    if (p.redesignPhase) return { inserts: true, daAssigned: p.leadDa };
    if (p.autoPlaced) return { inserts: true, daAssigned: p.leadDa };
    // ★★★ THE FOURTH BRANCH: the `AND v_lead_da IS NOT NULL` clause is gone.
    if (p.manualDdStart !== null && p.manualDdEnd !== null) {
      return { inserts: true, daAssigned: p.leadDa };
    }
    return { inserts: false, daAssigned: null };
  }

  it('★★★ DD dates and NO DA mint an UNASSIGNED block', () => {
    const r = mintsBlock({
      redesignPhase: false,
      autoPlaced: false,
      manualDdStart: '2026-10-05',
      manualDdEnd: '2026-10-30',
      leadDa: null,
    });
    expect(r.inserts).toBe(true);
    expect(r.daAssigned).toBeNull();
  });

  it('★★ DD dates WITH a DA are unchanged', () => {
    expect(
      mintsBlock({
        redesignPhase: false,
        autoPlaced: false,
        manualDdStart: '2026-10-05',
        manualDdEnd: '2026-10-30',
        leadDa: 'Caleb',
      }),
    ).toEqual({ inserts: true, daAssigned: 'Caleb' });
  });

  it('★★ no DD dates still mints nothing — the change is not "always insert"', () => {
    expect(
      mintsBlock({
        redesignPhase: false,
        autoPlaced: false,
        manualDdStart: null,
        manualDdEnd: null,
        leadDa: 'Caleb',
      }).inserts,
    ).toBe(false);
    // ★ Half a range is still no range. Both dates or neither.
    expect(
      mintsBlock({
        redesignPhase: false,
        autoPlaced: false,
        manualDdStart: '2026-10-05',
        manualDdEnd: null,
        leadDa: null,
      }).inserts,
    ).toBe(false);
  });

  it('★★★ the migration is patched BY ANCHOR and asserts its own result', () => {
    // ★ `migrations/` is partial and prod is ahead of it, so the body comes
    //   from the live `pg_get_functiondef` and one clause is removed from it.
    //   Retyping a 15 kB function would silently revert whatever else has
    //   landed on it.
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('AND v_lead_da IS NOT NULL THEN');
    // ★★ It counts before replacing — 0 means somebody already changed it, 2
    //    means the anchor is not unique. Both are stop conditions and neither
    //    is visible if you just call `replace`.
    expect(sql).toContain('found %');
    // ★★★ …and re-reads the installed body afterwards. §0: **a statement that
    //     succeeds is not a statement that did something.**
    expect(sql).toContain('is still there after the replace');
  });

  it('★★★ falling back to the permit’s DA is NOT what it does', () => {
    // ⚠️ Rejected, and the reason matters: a project with permits under two DAs
    //    would land in whichever column the query returned first, with nothing
    //    on the block saying it was inferred. **An unassigned block is honest;
    //    a wrongly-assigned one is not.**
    expect(code(sql)).not.toContain('SELECT p.da');
    expect(code(sql)).not.toContain('permits p');
  });

  it('★★ an unassigned row is visible — fix-521’s invariant already covers it', () => {
    // ★ The grid's columns ARE DAs, so there is no column for an unassigned
    //   block; the unscheduled lane is where it renders, and it names the week.
    //   That is why §C needs no client change.
    const grid = code(read('src/components/DrawScheduleGrid.tsx'));
    expect(grid).toContain('!row.da_assigned');
    expect(grid).toContain("'no DA'");
  });
});

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const resolved = vi.hoisted(() => ({ data: null as unknown, isError: false }));

vi.mock('../hooks/usePlanShare', async (orig) => {
  const actual = await orig<typeof import('../hooks/usePlanShare')>();
  return {
    ...actual,
    usePlanShareResolve: () => ({
      data: resolved.data,
      isLoading: false,
      isError: resolved.isError,
    }),
  };
});

function shareRow(over: Record<string, unknown> = {}) {
  return {
    project_address: '3505 Densmore Ave N',
    set_type: 'marketing',
    variant: 'external',
    file_name: '3505 - Marketing - External.pdf',
    page_count: 6,
    pages_prefix: 'proj/marketing_external/',
    thumb_path: 'proj/marketing_external.jpg',
    expires_at: '2026-10-11T00:00:00Z',
    ...over,
  };
}

/** Renders the shared page for one resolve outcome and returns its markup. */
function renderShare(data: unknown): string {
  resolved.data = data;
  resolved.isError = false;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/s/a7Kd92xQrTvB1nM0pLwZuY']}>
        <Routes>
          <Route path="/s/:token" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(<SharedPlan />, { wrapper });
  const html = view.container.innerHTML;
  view.unmount();
  return html;
}

beforeEach(() => {
  resolved.data = null;
  resolved.isError = false;
});

describe('fix-523 §A — what the shared page says', () => {
  it('names the set and the address, and never the file name', () => {
    const html = renderShare({
      row: shareRow(),
      pageUrls: ['https://signed/p1.jpg'],
      thumbUrl: null,
    });
    expect(html).toContain('Marketing');
    expect(html).toContain('3505 Densmore Ave N');
    // ★ The file name is a path on `\\bpc-file` with our internal naming in it.
    //   The address plus the set's name already answer "what am I looking at".
    expect(html).not.toContain('3505 - Marketing - External.pdf');
    expect(screen.queryByText(/bpc-file/)).toBeNull();
  });

  it('★★ says the same words for a set type as the card does', () => {
    expect(planShareSetLabel('marketing', 'internal')).toBe('Site Plan');
    expect(planShareSetLabel('marketing', 'external')).toBe('Marketing');
    expect(planShareSetLabel('schematic', null)).toBe('Schematic');
    expect(planShareSetLabel('design_guidance', null)).toBe('Design Guidance');
  });

  it('★★ a live link whose pictures will not load is not a dead link', () => {
    // ★ Today this is also what an undeployed `plan-share` function produces.
    const html = renderShare({ row: shareRow(), pageUrls: [], thumbUrl: null });
    expect(html).toContain('The pages could not be loaded.');
    expect(html).not.toContain(PLAN_SHARE_UNAVAILABLE);
    expect(html).toContain('3505 Densmore Ave N');
  });
});
