// ===========================================================================
// ★★★ fix-523 §A5 (P-187) — TURNING A TOKEN INTO PIXELS, WITHOUT A SESSION
// ===========================================================================
//
// `plan-thumbnails` is a PRIVATE bucket. Its only read policy is
// `plan_thumbnails_tenant_read`, granted to `authenticated` and scoped to the
// caller's tenants; **`anon` has no policy on it at all** (measured on prod
// 2026-09-11). Postgres cannot sign a Storage URL, so `bp_resolve_plan_share`
// hands out `pages_prefix` and `page_count` and stops there. Something with the
// service-role key has to do the signing, and this is that something — so that
// the key stays on the server and the browser gets an endpoint instead.
//
// ★★★ IT TAKES A TOKEN AND NOTHING ELSE. The object paths are DERIVED here,
//     from the row the token resolves to. A signing endpoint that signs a path
//     it was handed is an open proxy onto the bucket no matter what it checks
//     first: pass it `<other-project>/marketing_external/p001.jpg` with any
//     valid token and it would sign somebody else's drawings.
//
// ★★★ AND A DEAD TOKEN GETS THE SAME ANSWER AS A LIVE ONE WITH NO PAGES:
//     `{ pages: [], thumb: null }`, status 200. Expired, revoked, set gone and
//     never-existed are indistinguishable at the RPC by design (§A1), and this
//     function must not undo that by answering 404 to one of them and 200 to
//     another. The PAGE decides what to say; this only says what it could sign.
//
// ★★★ THIS FILE IS DELIBERATELY FREE OF DENO, OF `fetch`, AND OF THE SUPABASE
//     CLIENT — the fix-436 split. Everything arrives through `Deps`, so CI
//     (which has neither a Deno runtime nor a database) exercises the whole
//     decision tree. `index.ts` next door is the wiring.

/** The private bucket. ★ Mirrors `SHARE_BUCKET` in src/lib/planOfRecordShare.ts;
 *  a twin test asserts the two strings are identical, because this file cannot
 *  import from `src/` (Deno would have to resolve the whole app tree). */
export const SHARE_BUCKET = 'plan-thumbnails';

/** How long a signed page URL lives. ★ NOT the link's 30 days: these are minted
 *  fresh on every page load, and a signature that outlives the visit is one
 *  more copy of the drawing loose in the world. Long enough to read a 13-page
 *  set without it going stale underneath the reader. */
export const PAGE_SIGN_TTL_SECONDS = 60 * 60;

/** One row of `bp_resolve_plan_share`. ★ Mirrors `PlanShareRow` in
 *  src/lib/planShare.ts; the twin test pins the field names. */
export interface ShareRow {
  project_address: string | null;
  set_type: string;
  variant: string | null;
  file_name: string | null;
  page_count: number | null;
  pages_prefix: string | null;
  thumb_path: string | null;
  expires_at: string;
}

export interface Deps {
  /** Calls `bp_resolve_plan_share`. Zero rows → null. */
  resolve(token: string): Promise<ShareRow | null>;
  /** Signs one object path in `SHARE_BUCKET`, or returns null. ★ Never throws
   *  for a missing object: a page the indexer has not written yet must not take
   *  the pages either side of it down with it. */
  sign(objectPath: string): Promise<string | null>;
}

export interface SignedShare {
  pages: string[];
  thumb: string | null;
}

/**
 * The page objects for a set, in order.
 *
 * ★★ A DELIBERATE COPY of `planSharePagePaths` in src/lib/planShare.ts, because
 *    this module cannot import from `src/`. The twin test replays both over the
 *    same inputs — the same device fix-436 uses for `TEAM_ROLES`, and the
 *    reason it is a test rather than a comment is that `pNNN` padded to three
 *    is exactly the kind of detail that drifts to `pN` in one copy and then
 *    sorts page 10 before page 2 for one reader and not the other.
 */
export function pagePaths(
  pagesPrefix: string | null | undefined,
  pageCount: number | null | undefined,
): string[] {
  if (!pagesPrefix || !pageCount || pageCount < 1) return [];
  const prefix = pagesPrefix.endsWith('/') ? pagesPrefix : `${pagesPrefix}/`;
  return Array.from(
    { length: pageCount },
    (_, i) => `${prefix}p${String(i + 1).padStart(3, '0')}.jpg`,
  );
}

/** The `plan_share_links_token_len` CHECK, mirrored. ★ Measured off prod
 *  2026-09-11: `char_length(token) >= 16 and <= 64`. `bp_create_plan_share`
 *  mints 22 url-safe base64 characters, comfortably inside it. */
export const TOKEN_MIN_LENGTH = 16;
export const TOKEN_MAX_LENGTH = 64;

/** A token, as it may arrive. ★ Bounded and character-checked BEFORE it reaches
 *  the database, so a hand-typed `/s/x` never becomes a query. Anything outside
 *  the shape this app issues is not a token this app issued. */
export function normaliseToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length < TOKEN_MIN_LENGTH || t.length > TOKEN_MAX_LENGTH) return null;
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

/**
 * Resolve a token and sign what it points at.
 *
 * ★ Signs page objects when the set has them and the THUMBNAIL as well —
 *   fix-522 §C's rule is that a one-page set opens as a single drawing, and on
 *   prod 122 of 334 sets are one page with no `pages_prefix` at all. A shared
 *   site plan with no image would be the commonest case, not the edge one.
 */
export async function signShare(
  deps: Deps,
  body: unknown,
): Promise<SignedShare> {
  const token = normaliseToken(
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).token
      : null,
  );
  // ★ An unusable token gets the SAME shape as a dead one. See the header.
  if (!token) return { pages: [], thumb: null };

  const row = await deps.resolve(token);
  if (!row) return { pages: [], thumb: null };

  const paths = pagePaths(row.pages_prefix, row.page_count);
  const signed = await Promise.all(paths.map((p) => deps.sign(p)));
  // ★★ A page that will not sign is DROPPED, not rendered as an empty string —
  //    an `<img src="">` re-requests the page it is on in several browsers.
  const pages = signed.filter((u): u is string => typeof u === 'string' && u !== '');

  const thumb = row.thumb_path ? await deps.sign(row.thumb_path) : null;
  return { pages, thumb: thumb ?? null };
}
