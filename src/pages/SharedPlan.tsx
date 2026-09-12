import { useParams } from 'react-router-dom';
import { usePlanShareResolve } from '../hooks/usePlanShare';
import {
  PLAN_SHARE_UNAVAILABLE,
  PLAN_SHARE_UNAVAILABLE_HINT,
  planShareExpiryNote,
  planShareSetLabel,
} from '../lib/planShare';
import { formatPdfSize } from '../lib/planOfRecordShare';
import { ARCHIVED_FALLBACK_LABEL, isArchivedFallback } from '../lib/archivedFallback';
import { planOfRecordViewerMode } from '../lib/planOfRecord';

// ===========================================================================
// ★★★ fix-523 §A (P-187) — THE PAGE A BUILDER OPENS
// ===========================================================================
//
// P-187 was *"the share link is one page and unpresentable"*. fix-506 shipped a
// 500-character signed Storage URL to a single JPEG; this is what replaces it —
// `/s/<token>`, no login, thirty days.
//
// ★★★ WHAT IT IS ALLOWED TO BE (§A5): **one set's pages and nothing else.** No
//     ids in the URL, no address in the URL, no navigation into the app, no
//     other set, no link back to a logged-in surface, no menus, no ribbon. It
//     renders OUTSIDE `AuthGuard` and outside `Chrome`, which is not a routing
//     convenience — it is the reason none of that chrome can appear by
//     accident later.
//
// ★★ THE ADDRESS IS ON THE PAGE AND NOT IN THE URL, deliberately. A builder
//    looking at a site plan needs to know whose site it is, and `bp_resolve_
//    plan_share` returns it for exactly that. A URL is copied, logged, pasted
//    into tickets and read by proxies; a page is read by the person the link
//    was sent to.
//
// ★ THE FILE NAME IS NOT HERE. It is a path on `\\bpc-file` with our internal
//   naming in it, and the address plus the set's name already answer "what am I
//   looking at". fix-522's email subject carries the file name to a recipient
//   who was sent it on purpose; a page reachable by anyone holding the link is
//   a different audience.
//
// ★★★ AND IT RESOLVES THE **CURRENT** SET, ALWAYS (§A1, ruled 2026-09-11):
//     *a builder who bookmarks a marketing link must never be working off a
//     superseded drawing.* Nothing is cached into the route or the props — the
//     token names `(project, set_type, variant)` and the RPC joins the
//     `is_current` view at read time. The consequence is that the set can also
//     disappear, and that lands in the one state below.

export default function SharedPlan() {
  const { token } = useParams<{ token: string }>();
  const q = usePlanShareResolve(token);

  if (q.isLoading) {
    return (
      <Shell>
        <div
          className="h-[320px] rounded animate-pulse"
          style={{ background: 'var(--color-s2)' }}
          data-testid="shared-plan-loading"
        />
      </Shell>
    );
  }

  // ★★★ ONE STATE FOR FOUR CAUSES — expired, revoked, the set has been
  //     replaced by nothing, and never existed. `bp_resolve_plan_share` returns
  //     zero rows for all four BY DESIGN, so a probe cannot tell them apart,
  //     and this page must not undo that by wording them differently, taking
  //     different amounts of time, or rendering a different shape. A query
  //     ERROR lands here too: a reader cannot act on the difference between
  //     "your link is dead" and "our database is unhappy", and the second one
  //     is not their problem to diagnose.
  //
  // ★ The four are asserted byte-identical by the test. That is the assertion,
  //   not the wording.
  if (q.isError || !q.data) {
    return (
      <Shell>
        <div className="text-center py-16" data-testid="shared-plan-unavailable">
          <div className="text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>
            {PLAN_SHARE_UNAVAILABLE}
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: 'var(--color-muted)' }}>
            {PLAN_SHARE_UNAVAILABLE_HINT}
          </div>
        </div>
      </Shell>
    );
  }

  const { row, pageUrls, thumbUrl, pdfUrl, pdfBytes } = q.data;
  const pageCount = Math.max(1, row.page_count ?? 1);
  // ★★★ §A6 — THE SAME TWO VIEWERS AS THE CARD, DRIVEN BY THE SAME FIELD.
  //     fix-522 §C measured that keying off the LABEL instead would mis-route
  //     **102 of 334** sets, so the rule is imported rather than re-derived: a
  //     second copy here would be a second answer waiting to disagree with the
  //     one a designer sees on the card.
  const mode = planOfRecordViewerMode(pageCount);
  const label = planShareSetLabel(row.set_type, row.variant);
  // ★★★ fix-528 §C — AND IT RENDERS NOW, BECAUSE THE FILE EXISTS.
  //
  //     fix-523 wrote this control against a `pdf_path` that was NULL on every
  //     row and said so. fix-526's backfill has since uploaded **336 of 336**
  //     current sets and Cowork extended `bp_resolve_plan_share` to return
  //     `pdf_path` and `pdf_bytes` (both verified on prod 2026-09-11). So the
  //     "appears on its own with no Bridge deploy" claim was half right: the
  //     data arrived, but the control it fed was broken.
  //
  // ★★★ THE BUG fix-523 SHIPPED, FIXED HERE: this was `href={pdfPath}` — an
  //     OBJECT PATH in an `href`, which resolves against the app's own origin
  //     and 404s. The button rendered, looked correct, and handed over nothing.
  //     §C's line: **"the button exists" is not "the file arrives."** It is a
  //     SIGNED url now, minted server-side by the `plan-share` function, which
  //     is the only thing that can sign for an anonymous reader.
  //
  // ★ Still absent rather than disabled when there is no signed url — the same
  //   rule, and the state an undeployed function produces.
  const pdfPath = pdfUrl;

  return (
    <Shell>
      <header className="mb-4" data-testid="shared-plan-header">
        <div
          className="text-[10px] font-extrabold uppercase tracking-wider"
          style={{ color: 'var(--color-muted)' }}
          data-testid="shared-plan-label"
        >
          {label}
        </div>
        {row.project_address && (
          <h1
            className="text-[18px] font-bold mt-0.5"
            style={{ color: 'var(--color-text)' }}
            data-testid="shared-plan-address"
          >
            {row.project_address}
          </h1>
        )}
        <div
          className="text-[11px] mt-1"
          style={{ color: 'var(--color-muted)' }}
          data-testid="shared-plan-meta"
        >
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </div>
        {/* ★★★ fix-532 §C (P-247) — AND THIS IS THE SURFACE THE RULE WAS
            WRITTEN FOR. The reader here is a BUILDER: they have never seen the
            legend, they will never see it, and they cannot ask what a tint
            means. 60 projects now show a superseded drawing as their plan of
            record, and a link to one that does not say so is the app handing
            somebody an old drawing with a straight face.
            ★★ Absent until `bp_resolve_plan_share` returns the flag — the
               migration is staged, not applied — and absent is the right
               default: a marker that cries wolf is worse than one that is
               late. */}
        {isArchivedFallback(row) && (
          <div
            className="text-[11px] font-bold mt-1"
            style={{ color: 'var(--color-co)' }}
            data-testid="shared-plan-archived"
          >
            {ARCHIVED_FALLBACK_LABEL}
          </div>
        )}
        {pdfPath && (
          <a
            href={pdfPath}
            className="inline-block mt-2 text-[11px] font-bold rounded border px-2.5 py-1"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid="shared-plan-download-pdf"
          >
            Download PDF
            {pdfBytes ? ` · ${formatPdfSize(pdfBytes)}` : ''}
          </a>
        )}
      </header>

      {mode === 'pager' && pageUrls.length > 0 ? (
        // ★ Several pages SCROLL. fix-506 §E's ruling, and fix-522 §C's reason
        //   for keying it off the count: a reader flipping through a set wants
        //   to scroll it the way they scroll the PDF, and a Next button turns
        //   thirteen pages into thirteen deliberate clicks.
        <div className="flex flex-col gap-4" data-viewer-mode="pager" data-testid="shared-plan-pages">
          {pageUrls.map((url, i) => (
            <figure className="m-0" key={url} data-testid={`shared-plan-page-${i + 1}`}>
              <figcaption className="text-[10px] mb-1" style={{ color: 'var(--color-muted)' }}>
                Page {i + 1} of {pageCount}
              </figcaption>
              <img
                src={url}
                alt={`Page ${i + 1} of ${pageCount}`}
                className="block w-full h-auto rounded border"
                style={{ borderColor: 'var(--color-border)' }}
              />
            </figure>
          ))}
        </div>
      ) : thumbUrl || pageUrls[0] ? (
        // ★ One sheet, opened large enough to study — never a pager offering
        //   "page 1 of 1", which would be inventing a sequence.
        <div data-viewer-mode="drawing" data-testid="shared-plan-drawing">
          <img
            src={thumbUrl ?? pageUrls[0]}
            alt={label}
            className="block w-full h-auto rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          />
        </div>
      ) : (
        // ★★ A LIVE LINK WHOSE PICTURES WOULD NOT LOAD IS NOT A DEAD LINK, and
        //    it must not read like one. The set is named above, the expiry is
        //    below, and this says only what is true. Today it is also what an
        //    undeployed `plan-share` function produces — see its README.
        <div
          className="rounded border border-dashed px-4 py-14 text-center text-[12px]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          data-testid="shared-plan-no-pages"
        >
          The pages could not be loaded.
        </div>
      )}

      {/* ★★★ §A3 — THE EXPIRY IS TOLD TO THE **RECIPIENT**. fix-522 put it in
          the email; a link gets forwarded, bookmarked and opened weeks later by
          somebody who never saw the email, and they are the one it stops
          working for. */}
      <footer
        className="mt-6 pt-3 border-t text-[11px]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        data-testid="shared-plan-expiry"
      >
        {planShareExpiryNote(row.expires_at)}
      </footer>
    </Shell>
  );
}

/** ★ The whole chrome this page has, and it is deliberately not much: no
 *  ribbon, no header, no account menu, no link home. Every one of those would
 *  be a route back into a logged-in surface from a page anybody holding a link
 *  can open. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen w-full py-8 px-4"
      style={{ background: 'var(--color-bg)' }}
      data-testid="shared-plan"
    >
      <div className="mx-auto" style={{ maxWidth: 980 }}>
        {children}
      </div>
    </div>
  );
}
