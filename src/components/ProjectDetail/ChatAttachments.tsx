import { useEffect, useState } from 'react';
import { useSignedAttachmentUrl } from '../../hooks/useChatAttachments';
import {
  attachmentKind,
  attachmentMeta,
  humanSize,
  isImageAttachment,
  type AttachmentKind,
  type ChatAttachment,
} from '../../lib/chatAttachments';

// fix-330 — attachments as they appear once sent, in BOTH surfaces.
//
// ★ The bucket is private, so every render costs a signed URL. One query per
// PATH (not per message) means the same file rendered in the rail card and in
// the modal is signed once and shared — react-query dedupes on the key.
//
// ★ An image is a thumbnail; anything else is a named chip. A PDF rendered as a
// broken <img> is worse than a filename, and the mockup's own example is a
// named plan set.
//
// ════════════════════════════════════════════════════════════════════════
// ★★★ fix-563 (P-267) — A FILE IN CHAT LOOKS LIKE A FILE
// ════════════════════════════════════════════════════════════════════════
//
// Bobby: *"those kind of show up as, like, gray blobs… it would be nice if
// there was maybe a logo or something."* Four PDFs in a row were four
// identical grey rectangles.
//
// ★★ MOST OF §A AND §B WERE ALREADY HERE — fix-330 shipped the filename, the
//    human-readable size and the image thumbnail; fix-411 §4 shipped the
//    lightbox. Re-derived against origin/main, exactly two things were missing,
//    and both are below:
//
//      §A  a TYPE ICON. The card had no icon at all, so a PDF and a
//          spreadsheet were the same grey rectangle — Bobby's actual complaint.
//      §B  a fallback when the THUMBNAIL ITSELF FAILS TO LOAD. The signing
//          failure was handled; a minted URL whose object 404s was not, and it
//          left a broken <img> on screen. §B calls that *"the whole risk"* —
//          *"a thumbnail that 404s is worse than the grey blob it replaced."*
//
// ★★★ THAT SECOND GAP WAS PROVED BY A FAILING TEST BEFORE IT WAS FIXED, not by
//     reading this file — which is also how §B asks for it to be asserted:
//     *"with a broken path, not by reading the handler."*
//
// ⛔ NO PDF PREVIEWS (§C). Bobby chose *"file card now, preview later"*, and the
//    indexer's renderer is deliberately not reached for: fix-526 renders
//    plan-set covers from the FILE SHARE into `plan-thumbnails` on a schedule.
//    A chat upload is a different source with a different lifecycle. Real
//    ticket, not an extension of this one.

export default function ChatAttachments({
  attachments,
  compact = false,
}: {
  attachments: readonly ChatAttachment[];
  /** The rail card is 240px wide — one line per file, no thumbnails. */
  compact?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <div
      className={compact ? 'flex flex-col gap-0.5 mt-1' : 'flex flex-wrap gap-2 mt-2'}
      data-testid="chat-attachments"
    >
      {attachments.map((a) => (
        <AttachmentItem key={a.path} attachment={a} compact={compact} />
      ))}
    </div>
  );
}

function AttachmentItem({
  attachment,
  compact,
}: {
  attachment: ChatAttachment;
  compact: boolean;
}) {
  const urlQ = useSignedAttachmentUrl(attachment.path);
  const url = urlQ.data ?? null;
  const kind = attachmentKind(attachment);
  // ★★★ fix-563 §B — THE LOAD-FAILURE LATCH, AND WHY IT IS SEPARATE FROM
  //     `urlQ.error`.
  //
  //     Those are two different failures and only one of them was handled. A
  //     signature that cannot be MINTED is a permission or network problem, and
  //     fix-330 already says so. A signature that mints fine over an object that
  //     is **gone, moved, or whose signature expired while the tab sat open**
  //     produced a valid `<img src>` that 404s — and the browser's own broken
  //     image glyph, which reads as a corrupt file.
  //
  // ★★ ONE-WAY, ON PURPOSE. Once a thumbnail has failed for this item it stays
  //    failed for the life of the component. Retrying on the next render would
  //    be a request loop against an object that is not coming back, and the
  //    fallback card can still open the file in a tab — where the browser gives
  //    its own, better error.
  const [thumbFailed, setThumbFailed] = useState(false);
  //★ An image that could not be DRAWN is rendered as a file card, which is
  //  precisely what §B asks for: *"fall back to the §A card on any load error."*
  const image = isImageAttachment(attachment) && !thumbFailed;
  /** ★ fix-411 §4: is the in-app viewer open for THIS attachment? Local to the
   *  item, so two snips in one message each own their own viewer. */
  const [viewing, setViewing] = useState(false);

  // ★ A signature that could not be minted says so. Rendering a dead thumbnail
  // would look like a corrupt file rather than a permission or network problem.
  const failed = !!urlQ.error;

  if (compact) {
    // ★★ fix-563: the rail chip used a TWO-way emoji split (image vs
    //    everything), so a PDF and a spreadsheet were the same glyph here as
    //    well. It now reads the SAME `attachmentKind` the card does — one
    //    derivation, two sizes — rather than a second vocabulary that can drift
    //    from the card's. Emoji are gone with it: they render differently on
    //    every platform, and the card's icons are already themeable SVG.
    return (
      <span
        className="text-[10px] text-dim truncate flex items-center gap-1"
        title={`${attachment.name} · ${attachmentMeta(attachment)}`}
        data-testid={`chat-attachment-compact-${attachment.path}`}
        data-kind={kind}
      >
        <AttachmentIcon kind={kind} size={10} />
        <span className="truncate">{attachment.name}</span>
      </span>
    );
  }

  // ===========================================================================
  // ★★★ fix-411 §4 (P-054) — A SNIP OPENS IN-APP, NOT IN A NEW TAB
  // ===========================================================================
  //
  // Bobby, 2026-08-26: *"when we are adding snips from the project chat into
  // the project overview, it opens as a new tab. If we could have it just open
  // just like the design worker, that would be great, so we're not opening an
  // additional tab."*
  //
  // ★★ "LIKE THE DESIGN WORKER" IS THE PLAN OF RECORD CARD'S LIGHTBOX
  // (PlanOfRecordCard.tsx:436) — the app's one existing in-app file viewer, and
  // the one place design documents already enlarge without leaving the page.
  // `SnipLightbox` below follows it rather than inventing a third pattern:
  // same overlay geometry, same backdrop-and-Close dismissal, same no-upscale
  // rule capped at the image's own natural width.
  //
  // ★★★ IMAGES OPEN IN-APP; A NON-IMAGE STILL OPENS A TAB, ON PURPOSE.
  // A snip is a Ctrl+V paste (fix-330) and is therefore always an image, so
  // Bobby's case is fully covered by the branch below. The other kind of
  // attachment is a plan set — a PDF — and this app has nothing that can render
  // one. A modal saying "no preview available" would be strictly worse than the
  // browser tab that renders it natively, so the file branch keeps the anchor
  // it has always had. Reported in the fix-411 PR rather than quietly widened.
  //
  // ★ NO ORIGIN IS RECORDED, and none is needed: this is an OVERLAY over the
  // page you are already on, not a route change, so fix-408's Previous button
  // never sees it and the page behind keeps whatever origin brought you there.
  if (image) {
    return (
      <>
        <button
          type="button"
          // Without a signature there is nothing to open; a control that does
          // nothing is the disabled-control failure again.
          disabled={!url}
          onClick={() => {
            if (url) setViewing(true);
          }}
          className="rounded-lg border overflow-hidden bg-bg block p-0 text-left"
          style={{
            borderColor: 'var(--color-border)',
            maxWidth: 300,
            cursor: url ? 'zoom-in' : 'default',
          }}
          title={
            failed
              ? 'This attachment could not be opened'
              : `${attachment.name} · ${attachmentMeta(attachment)}`
          }
          data-testid={`chat-attachment-${attachment.path}`}
          data-kind="image"
        >
          <div
            className="text-[10px] text-dim px-2 py-1 border-b truncate"
            style={{ borderBottomColor: 'var(--color-border)' }}
          >
            {attachment.name}
            <span className="ml-1">· {humanSize(attachment.size)}</span>
          </div>
          {url ? (
            <img
              src={url}
              alt={attachment.name}
              // ★★★ §B: THE ONE LINE THIS TICKET TURNS ON. Without it a dead
              //     object leaves the browser's broken-image glyph inside a card
              //     that still says "zoom-in" — worse than the grey blob it
              //     replaced. Proved by a failing test before it was written.
              onError={() => setThumbFailed(true)}
              style={{ display: 'block', maxHeight: 180, maxWidth: '100%' }}
            />
          ) : (
            <div
              className="text-[10px] text-dim px-2 py-4 text-center"
              data-testid={`chat-attachment-pending-${attachment.path}`}
            >
              {failed ? 'Could not open this image' : 'Loading…'}
            </div>
          )}
        </button>
        {viewing && url && (
          <SnipLightbox
            url={url}
            name={attachment.name}
            size={attachment.size}
            onClose={() => setViewing(false)}
          />
        )}
      </>
    );
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      // Without a signature there is nothing to open; a link that navigates
      // nowhere is the disabled-control failure again.
      aria-disabled={!url}
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      className="rounded-lg border overflow-hidden bg-bg no-underline block"
      style={{
        borderColor: 'var(--color-border)',
        maxWidth: 300,
        cursor: url ? 'pointer' : 'default',
      }}
      title={
        failed
          ? 'This attachment could not be opened'
          : `${attachment.name} · ${attachmentMeta(attachment)}`
      }
      data-testid={`chat-attachment-${attachment.path}`}
      data-kind="file"
      // ★ So a test can tell "this is a PDF card" from "this is an image whose
      //   thumbnail died" without reading the handler that decided it.
      data-file-kind={kind}
      data-thumb-failed={thumbFailed ? 'true' : undefined}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-b"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        {/* ★★ THE ICON — §A's missing half. `flex-shrink-0` because the
            filename next to it is the thing allowed to truncate; an icon that
            squashes is the one element on the card that cannot be read at all. */}
        <AttachmentIcon kind={kind} size={14} />
        <span className="text-[10px] text-dim truncate min-w-0">
          {attachment.name}
        </span>
      </div>
      <div className="text-[11px] text-text px-2 py-2 flex items-baseline gap-1.5">
        <span>{failed ? 'Could not open this file' : 'Open file →'}</span>
        {/* ★★★ §A: *"the size is the cheapest useful signal on the card"* — a
            17 MB correction letter and a 200 KB one are different objects and
            currently look identical. `attachmentMeta` drops the separator when
            the size is missing, so this never renders a dangling middle dot. */}
        <span className="text-[10px] text-dim ml-auto flex-shrink-0"
          data-testid={`chat-attachment-meta-${attachment.path}`}>
          {attachmentMeta(attachment)}
        </span>
      </div>
    </a>
  );
}

/**
 * ★★★ fix-563 §A — THE TYPE ICON.
 *
 * Three glyphs, matching §A's *"PDF · image · generic"* exactly. They follow the
 * house SVG shape (`PlanOfRecordCard`'s): a 24-unit viewBox, `currentColor`
 * strokes so they theme with the text beside them, and `aria-hidden` because the
 * kind is already in the card's `title` and its visible meta line — a screen
 * reader should not hear "PDF" twice.
 *
 * ★ DELIBERATELY NOT EMOJI. The rail chip used 🖼/📄, which render as a different
 *   picture on every platform and cannot take a colour. These are one
 *   vocabulary at two sizes.
 */
function AttachmentIcon({ kind, size }: { kind: AttachmentKind; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
    focusable: 'false' as const,
    className: 'flex-shrink-0',
    style: { display: 'block' },
    'data-testid': `attachment-icon-${kind}`,
  };
  // ★ A sheet with a folded corner is the shared base; what sits ON it is the
  //   kind. Same silhouette means the three read as one family at 10px.
  const page = (
    <path
      d="M6 2.75h7.5L19.25 8.5v12.75H6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  );
  const fold = (
    <path d="M13.5 2.75V8.5h5.75" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  );

  if (kind === 'image') {
    // ★ A framed picture with a horizon and a sun — the one glyph that is NOT a
    //   page, because an image is the one kind that usually renders as itself.
    return (
      <svg {...common} style={{ display: 'block', color: 'var(--color-de)' }}>
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8.5" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 16.5 9 12l4 3.5 3-2.5 4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'pdf') {
    // ⚠️⚠️ THIS DREW THE WORD "PDF" AT FIRST, AND THE HARNESS KILLED IT.
    //
    //    Three letters inside a 14px box is a smudge — and 10px in the rail chip
    //    is worse. Every one of the 22 assertions passed on the illegible
    //    version, because a test can see a <text> node and cannot see that
    //    nobody could read it. That is exactly what the harness is for
    //    (fix-406's rule: a styling change nothing renders is indistinguishable
    //    from one that does nothing).
    //
    // ★★★ SO THE MARK IS A SOLID BAND, NOT A WORD. At 14px it reads as
    //     "page with a heavy label" against generic's "page with thin rules" —
    //     a difference of WEIGHT, which survives being small in a way letterforms
    //     do not.
    //
    // ★★ AND THE SHAPE CARRIES IT, NOT THE COLOUR. The first version leaned on
    //    `--color-co` to tell a PDF from a spreadsheet, which is no help to
    //    anyone who cannot separate those two hues, and no help at all in the
    //    rail where both are 10px. The colour is still there; it is now the
    //    second signal rather than the only one.
    return (
      <svg {...common} style={{ display: 'block', color: 'var(--color-co)' }}>
        {page}
        {fold}
        <rect
          x="8.2"
          y="13.4"
          width="8.6"
          height="4.6"
          rx="1"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    );
  }

  // ★ Generic: the page, with ruled lines. Reached by the 5 XLSX files in chat
  //   today and by anything the three-way split does not name.
  return (
    <svg {...common} style={{ display: 'block', color: 'var(--color-muted)' }}>
      {page}
      {fold}
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * ★★★ fix-411 §4: the in-app snip viewer.
 *
 * A deliberate copy of PlanOfRecordCard's `Lightbox` shape — the app's existing
 * in-app file viewer — rather than a new overlay vocabulary: same
 * `fixed inset-0 z-50` geometry, same dark backdrop that closes on click, same
 * explicit Close button, same "never upscale past the source" rule.
 *
 * ★★ ESCAPE CLOSES THIS ONE, unlike fix-411 §1's Add New Project dialog. That
 * is not an inconsistency, it is the same rule applied to a different cost: a
 * dismissed VIEWER loses nothing — the snip is still in the chat, one click
 * away — whereas a dismissed wizard loses four steps of typing. Closing is
 * cheap here and expensive there.
 */
function SnipLightbox({
  url,
  name,
  size,
  onClose,
}: {
  url: string;
  name: string;
  size: number;
  onClose: () => void;
}) {
  // ★ Capped at the image's OWN width, read from the loaded bitmap. A snip is
  //   whatever resolution the person's screen was; blowing a 600px paste up to
  //   fill a 1400px dialog makes it blurrier, not bigger — fix-295's finding on
  //   the plan thumbnails, and it applies identically here.
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,28,38,.72)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Snip: ${name}`}
      data-testid="chat-attachment-lightbox"
    >
      <div
        className="bg-surface rounded-lg p-3.5 w-full max-w-[min(96vw,1400px)] max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-text truncate">{name}</div>
            <div className="text-[10px] text-muted">{humanSize(size)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded border border-border bg-surface text-text hover:bg-s2 transition"
            data-testid="chat-attachment-lightbox-close"
          >
            Close
          </button>
        </div>
        <img
          src={url}
          alt={name}
          className="block w-full h-auto rounded border mx-auto"
          onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth || null)}
          style={{
            borderColor: 'var(--color-border)',
            maxWidth: naturalWidth ? `${naturalWidth}px` : undefined,
          }}
          data-testid="chat-attachment-lightbox-img"
        />
      </div>
    </div>
  );
}
