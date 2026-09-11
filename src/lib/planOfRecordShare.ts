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

// ===========================================================================
// ★★★ fix-523 §A (P-187) — WHAT THE LINK NOW IS, AND WHAT THIS FILE STILL OWNS
// ===========================================================================
//
// Everything above describes a signed Storage URL to ONE PAGE IMAGE. That is
// what fix-506 shipped and what fix-522 wrapped in a menu and an email, and it
// is **superseded, not mistaken**: the reasoning was right for a ticket with no
// table, no RPC and no route. All three landed on prod on 2026-09-11, so Copy
// link and Email it now mint `/s/<token>` through `bp_create_plan_share` and
// the whole set travels instead of its first sheet.
//
// ★★★ THE THREE PROPERTIES STATED ABOVE ALL SURVIVE THE CHANGE, which is why
//     the note stays rather than being rewritten:
//
//       · minted against the CALLER'S OWN session — `bp_create_plan_share` is
//         granted to `authenticated` only and raises `42501` for a project
//         outside the caller's tenants;
//       · grants ONE SET, not a folder, not a listing, not a token that walks
//         to a sibling project's drawings;
//       · it EXPIRES, on the same `SHARE_TTL_DAYS` number, still one constant.
//
// ★★ AND `plan-thumbnails` STAYS PRIVATE. There is still no `getPublicUrl` for
//    this bucket anywhere in the repo. The shared page's images are signed
//    SERVER-SIDE by the `plan-share` Edge Function with the service-role key —
//    which is the only way an anonymous reader can see them, because `anon` has
//    no read policy on that bucket at all.
//
// ★ What is left in this file is the WORDS: the TTL constant, the toasts, and
//   the email's subject and body. The minting lives in `hooks/usePlanShare`,
//   the URL shape in `lib/planShare`, and the signing in the Edge Function.

/** ★★★ §A2: the token is a bearer credential, so *stop sharing* is a control
 *  and not a support request. `bp_revoke_plan_share` sets `revoked_at`, and a
 *  revoked token resolves to zero rows — indistinguishable from expired, from
 *  a deleted set and from one that never existed. */
export const UNSHARE_TOAST = 'Link stopped — it no longer opens for anyone';

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

// ===========================================================================
// ★★★ fix-522 §D4 (P-187) — COMPOSE THE EMAIL, WITH THE SET'S OWN NAME
// ===========================================================================
//
// Bobby: *"boom, create the email, open it, and it's already got the subject
// line, what you're sharing, and maybe a snip of the front page."*
//
// ★★★ THE SUBJECT NAMES WHAT IS BEING SENT — *"is this schematic, design
//     guidance, marketing internal or external?"* — because a recipient's inbox
//     shows the subject and nothing else, and "Plan" from four different senders
//     on four different projects is four identical rows.
//
// ⚠️⚠️ THE FRONT-PAGE SNIP IS OUT, AND NOT FOR EFFORT. **A `mailto:` cannot
//      carry an image.** There are exactly two ways to put one in an email and
//      both are their own ticket:
//
//        · a REAL SEND PATH — an Edge Function plus an email provider. A new
//          dependency, a new secret, a new deliverability story, and the app
//          starts sending mail as itself rather than opening the user's client.
//        · a PUBLICLY HOSTED image the recipient's client fetches. `planOf
//          RecordShare` says in as many words that `plan-thumbnails` stays
//          private and there must be no `getPublicUrl` for it: *"a public URL
//          would either 400 or — far worse — work, which would mean somebody had
//          made drawing content world-readable."*
//
//      So subject + link ships and works everywhere, and the picture is priced
//      separately rather than promised with the rest. §D asked for exactly that.
// ===========================================================================

/**
 * What a shared set is CALLED, in an inbox.
 *
 * ★★★ IT LEADS WITH THE SET'S OWN FILE NAME, which is what §D4 asks for —
 *     *"the subject line pre-filled from the set's own name — is this
 *     schematic, design guidance, marketing internal or external?"* On prod
 *     those names already answer it and carry the project besides:
 *
 *       `3505 - Marketing - External.pdf`
 *       `3505 - Marketing - Internal.pdf`
 *       `3505 - SD Preliminary 5.pdf`
 *       `3505 Densmore Ave N - Design Guidance.pdf`
 *
 * ★★ THE EXTENSION GOES. A subject is read by a person, and `.pdf` in one is
 *    the sender's file system leaking into somebody else's inbox.
 *
 * ★ The BUTTON's label is the fallback and the qualifier — it is what the
 *   sender just pressed and what §A put on the chip, so the subject, the chip
 *   and the button say one word. A set with no file name still gets a subject
 *   that names what it is rather than an empty one.
 */
export function planShareSubject(
  fileName: string | null | undefined,
  buttonLabel: string,
): string {
  const name = (fileName ?? '').trim().replace(/\.pdf$/i, '');
  return name ? `${name} — ${buttonLabel}` : buttonLabel;
}

/** The body: one line saying what it is, then the link on its own line. */
export function planShareBody(
  fileName: string | null | undefined,
  buttonLabel: string,
  url: string,
  pageCount: number,
): string {
  const pages = pageCount > 1 ? ` (${pageCount} pages)` : '';
  const name = (fileName ?? '').trim().replace(/\.pdf$/i, '') || buttonLabel;
  return [
    `${buttonLabel} — ${name}${pages}:`,
    '',
    url,
    '',
    // ★ The expiry is stated to the RECIPIENT, not just to the sender in a
    //   toast. They are the one it stops working for.
    `This link works for ${SHARE_TTL_DAYS} days and needs no login.`,
  ].join('\n');
}

/**
 * The `mailto:` a share menu opens.
 *
 * ★ `encodeURIComponent` on both parts, and newlines survive it as `%0A` —
 *   every mail client decodes them. A raw newline in a `mailto:` is what
 *   truncates the body in Outlook.
 */
export function planShareMailto(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
