// ===========================================================================
// ★★★ fix-523 §A (P-187) — THE SHARE LINK BECOMES A REAL THING
// ===========================================================================
//
// fix-506 §E shipped a share that is a **signed Storage URL to one page image**
// — 500-odd characters of query string, one sheet out of a set that averages
// four. fix-522 §D3/§D4 wrapped it in a menu and an email and reported the
// whole-set route rather than building it, because it needed a table, an RPC
// and an access ruling. All three exist on prod now (applied from Cowork,
// 2026-09-11), so this is that half.
//
// ★★★ THE LINK NAMES A **SET**, NOT A FILE. `plan_share_links` stores
//     `(project_id, set_type, variant)` and `bp_resolve_plan_share` joins the
//     `is_current` view at READ time. Ruled by Bobby 2026-09-11, asked whether
//     a live link should show what was shared or the newest version:
//
//       *a builder who bookmarks a marketing link must never be working off a
//        superseded drawing.*
//
//     So **nothing here caches the set's identity** — not the token, not the
//     route, not the page's props. If the indexer replaces the file tomorrow,
//     the same URL serves the new one tomorrow. The consequence is that the set
//     can also disappear, and that is handled below rather than hidden.
//
// ★★★ WHAT THE PAGE IS ALLOWED TO BE (§A5): one set's pages and nothing else.
//     No project id and no address IN the url — the address may appear ON the
//     page, because `bp_resolve_plan_share` returns it and a builder looking at
//     a site plan needs to know whose site it is. No navigation into the app,
//     no other set, no link back to a logged-in surface.

/** The public route's prefix. One constant, so the router, the URL builder and
 *  the test that asserts what the URL does NOT contain all read it. */
export const PLAN_SHARE_PATH = '/s';

/** `https://bridge…/s/a7Kd92…` — the whole shared URL.
 *
 *  ★ The origin is an ARGUMENT rather than a read of `window.location`, so the
 *    URL a test asserts is the URL a person is handed. */
export function planShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${PLAN_SHARE_PATH}/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// ★★★ ONE HONEST STATE FOR FOUR CAUSES — AND THE FOUR MUST BE INDISTINGUISHABLE
// ---------------------------------------------------------------------------
//
// `bp_resolve_plan_share` returns **zero rows** for a token that is expired,
// one that has been revoked, one whose set has since disappeared, and one that
// never existed. That is the RPC's design, not an accident of it: a probe that
// could tell "revoked" from "never existed" is a probe that confirms a token
// was once real, and a probe that could tell "expired" from "revoked" tells a
// recipient whether somebody cut them off deliberately.
//
// ★★★ SO THE PAGE RENDERS **ONE** STATE FOR ALL FOUR — same words, same HTTP
//     status (there is only one: the SPA is served the same way for every
//     path), and the same amount of work, because the page does exactly one
//     round trip either way and never branches before it. The test asserts the
//     four produce byte-identical output.

/** The only thing a dead token ever says. Never "expired", never "revoked",
 *  never "not found" — see above. */
export const PLAN_SHARE_UNAVAILABLE = 'This link is no longer available.';

/** The second line. It gives a person somewhere to go without naming a cause
 *  and without linking into the app. */
export const PLAN_SHARE_UNAVAILABLE_HINT =
  'Ask whoever sent it for a new one.';

// ---------------------------------------------------------------------------
// Page objects
// ---------------------------------------------------------------------------

/**
 * The object paths for a set's pages, in order.
 *
 * ★ `pNNN.jpg`, zero-padded to three — fix-504's own naming, and the padding is
 *   what stops page 10 sorting before page 2.
 *
 * ★★ This is the same rule `usePlanOfRecordSets.pagePaths` applies, expressed
 *    over the two FIELDS rather than over a row, because three callers need it
 *    from three different shapes: the card (a set row), this app's shared page
 *    (an RPC result) and the Edge Function (a Deno module that cannot import
 *    from `src/` at all). `pagePaths` delegates here; the Edge Function carries
 *    its own copy with a twin test, exactly as `TEAM_ROLES` does for fix-436.
 */
export function planSharePagePaths(
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

// ---------------------------------------------------------------------------
// What the shared page is told
// ---------------------------------------------------------------------------

/** One row of `bp_resolve_plan_share`. Hand-typed like the rest of
 *  database.types — see the standing rule about never regenerating it.
 *
 *  ★ fix-528: `pdf_path` and `pdf_bytes` ARE in this signature now. fix-523
 *  noted their absence loudly and read the field defensively instead; Cowork's
 *  fix-526 apply added both to the RPC's result type and to the view it reads
 *  (verified on prod 2026-09-11), so the caveat expired. */
export interface PlanShareRow {
  project_address: string | null;
  set_type: string;
  variant: string | null;
  file_name: string | null;
  page_count: number | null;
  pages_prefix: string | null;
  thumb_path: string | null;
  expires_at: string;
  /** ★★★ fix-528 §C: the source PDF's object path — **not** a URL. Returned by
   *  `bp_resolve_plan_share` as of Cowork's fix-526 apply. The page never uses
   *  it directly; the `plan-share` function signs it. */
  pdf_path: string | null;
  pdf_bytes: number | null;
  /** ★★★ fix-532 §C (P-247): is the shared set a superseded drawing?
   *
   *  ⚠️ **OPTIONAL, because `bp_resolve_plan_share` does not return it yet.**
   *  Verified on prod 2026-09-12 — the function's result type ends at
   *  `pdf_bytes`, and the column is on the VIEW it reads but not in its
   *  signature. The migration that adds it is staged for Cowork as
   *  `fix_532c_resolve_returns_archived_flag_PENDING_APPROVAL.sql`.
   *
   *  ★ Read defensively until then, exactly as fix-523 read `pdf_path` before
   *  its own server half landed: an unlisted field arrives as `undefined`, and
   *  `isArchivedFallback` treats that as **not a fallback** — the direction
   *  that does not put a warning on a set that may be perfectly current. */
  is_archived_fallback?: boolean | null;
}

// ★★★ fix-528 §C — `planSharePdfPath` IS GONE, AND ITS REASON EXPIRED RATHER
//     THAN BEING WRONG.
//
//     fix-523 read `pdf_path` off the row WITHOUT declaring it, because the RPC
//     did not return it and the `is_current` view did not carry it: declaring
//     it would have meant asking the server for a column that does not exist,
//     and an unknown column in an explicit select fails the WHOLE query with
//     `42703`. Reading it defensively was the right call for that week.
//
// ★★★ BOTH SERVER HALVES LANDED. Cowork's fix-526 apply added `pdf_path` and
//     `pdf_bytes` to the view AND to `bp_resolve_plan_share`'s result type
//     (verified on prod 2026-09-11), so the field is DECLARED on `PlanShareRow`
//     above and read normally.
//
// ★★ AND THE PAGE NO LONGER WANTS A PATH ANYWAY. A path in an `href` resolves
//    against the app's own origin and 404s — the bug fix-523 shipped. The page
//    renders the SIGNED url the `plan-share` function returns, because an
//    anonymous reader cannot sign a private object. See `usePlanShareResolve`.

/** What the shared page says the set is. The set type and variant in the words
 *  the app already uses on the card, so a builder and a designer are looking at
 *  the same name for the same document. */
export function planShareSetLabel(
  setType: string | null | undefined,
  variant: string | null | undefined,
): string {
  const v = (variant ?? '').toLowerCase();
  if (setType === 'marketing') return v === 'external' ? 'Marketing' : 'Site Plan';
  if (setType === 'schematic') return 'Schematic';
  if (setType === 'design_guidance') return 'Design Guidance';
  return setType ?? '';
}

/** "This link works until Oct 11, 2026." — §A3: the TTL is told to the
 *  recipient on the page, not only in the email fix-522 shipped.
 *
 *  ★ UTC, for the same reason `formatModified` is: the same link must not
 *    appear to expire on two different days for two readers. */
export function planShareExpiryNote(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return '';
  const when = d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `This link works until ${when} and needs no login.`;
}
