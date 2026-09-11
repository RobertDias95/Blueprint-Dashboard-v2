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
 *  ⚠️ **`pdf_path` IS NOT IN THIS SIGNATURE.** §B1 asked for it to be added to
 *  the RPC's consumers; the RPC does not return it and the `is_current` view it
 *  reads does not carry it either (measured 2026-09-11 — `project_file_index`
 *  has `pdf_path`, `project_plan_of_record_sets` does not). Both are server
 *  changes and neither is in the applied migration, so the field is read
 *  DEFENSIVELY below rather than declared here: the moment the server returns
 *  it, the Download PDF control appears with no Bridge deploy. See §B. */
export interface PlanShareRow {
  project_address: string | null;
  set_type: string;
  variant: string | null;
  file_name: string | null;
  page_count: number | null;
  pages_prefix: string | null;
  thumb_path: string | null;
  expires_at: string;
}

/**
 * ★★★ §B3 — `pdf_path`, READ WITHOUT BEING DECLARED, AND THAT IS DELIBERATE.
 *
 * Bobby, 2026-09-11: *"can the share button create the item into a pdf? … are
 * we able to share a link + pdf?"* The PDF already exists — every one of the
 * 334 current sets IS a PDF on `\\bpc-file` and `unc_path` is populated on all
 * of them. Uploading it is a scraper ticket; `project_file_index` already
 * carries `pdf_path · pdf_bytes · pdf_status · pdf_uploaded_at`, all NULL.
 *
 * ★★★ SO THE CORRECT RESULT OF THIS TICKET IS THAT NO DOWNLOAD BUTTON RENDERS
 *     ANYWHERE, and the moment the column is populated and exposed they appear
 *     on their own. **Never a disabled affordance and never a promise** — that
 *     is the P-032 placeholder this card already had removed from it once.
 *
 * ★ Reading a field the type does not promise is normally a smell. Here it is
 *   the whole mechanism: declaring it would require the server to return it,
 *   and adding it to an explicit select list for a column the view does not
 *   have makes PostgREST fail the WHOLE query with `42703` — which would take
 *   the card away from every project to add a button nobody can see yet.
 */
export function planSharePdfPath(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const v = (row as Record<string, unknown>).pdf_path;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

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
