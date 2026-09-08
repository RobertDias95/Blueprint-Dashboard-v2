import { supabase } from './supabase';

// ===========================================================================
// ★★★ fix-506 §E (P-148) — SHARE A PLAN, WITHOUT A LOGIN
// ===========================================================================
//
// Bobby's ruling: a **Bridge-hosted expiring link** — a signed URL, 30 days —
// copied to the clipboard, with the toast *"Link copied — works for 30 days,
// no login"*.
//
// ★★★ THIS IS THE ONE PLACE IN THE APP THAT DELIBERATELY MAKES TENANT CONTENT
//     REACHABLE WITHOUT A SESSION, so the properties are worth stating rather
//     than leaving to the reader of a one-line helper:
//
//       · It is minted against the CALLER'S OWN session, so the storage policy
//         (*"the first path segment is a project in one of my tenants"*) is
//         what authorises it. A user who cannot see the project cannot mint a
//         link to its plan.
//       · It grants ONE OBJECT. Not a folder, not a listing, not a token that
//         can be walked to a sibling project's drawings.
//       · It EXPIRES. Thirty days is Bobby's number; the constant is named so
//         the copy and the signature can never quote different periods, which
//         is the fix-306 defect class (a control whose words and behaviour
//         disagree) applied to a promise about access.
//
// ★★ AND `plan-thumbnails` STAYS PRIVATE. There is no `getPublicUrl` call for
//    this bucket anywhere in the repo and there must not be: a public URL would
//    either 400 or — far worse — work, which would mean somebody had made
//    drawing content world-readable.

export const SHARE_BUCKET = 'plan-thumbnails';

/** Thirty days, in seconds. ★ Named so the toast's words and the signature's
 *  expiry are one number. */
export const SHARE_TTL_DAYS = 30;
export const SHARE_TTL_SECONDS = SHARE_TTL_DAYS * 24 * 60 * 60;

/** The words that go with it. Declared beside the number for the same reason. */
export const SHARE_TOAST = `Link copied — works for ${SHARE_TTL_DAYS} days, no login`;

/**
 * ★★★ ONE PAGE, AND ONLY ONE, IN THIS TICKET.
 *
 * The brief considered sharing an external set as a list of signed links in the
 * copied text and ruled against it: *"keep it simple — share the FIRST page's
 * signed link only in this ticket; a multi-page share needs a landing page and
 * is a later item."*
 *
 * ★★ AND THE REASON IS NOT LAZINESS, IT IS THAT N LINKS IS NOT A SHARE. A
 *    recipient handed twelve URLs has to open twelve tabs in the right order,
 *    each expiring independently, with nothing telling them how many there
 *    were. A real multi-page share is a Bridge-hosted page that renders the set
 *    — which is a route, a public read path and its own auth story. Sharing
 *    page 1 is honest about what it is; sharing twelve links would look like
 *    the feature while being worse than not having it.
 */
export async function signPlanShareUrl(objectPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SHARE_BUCKET)
    .createSignedUrl(objectPath, SHARE_TTL_SECONDS);
  if (error) throw error;
  const url = data?.signedUrl;
  if (!url) throw new Error('No signed URL returned');
  return url;
}
