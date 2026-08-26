import { useEffect, useState } from 'react';
import { useSignedAttachmentUrl } from '../../hooks/useChatAttachments';
import {
  humanSize,
  isImageAttachment,
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
  const image = isImageAttachment(attachment);
  /** ★ fix-411 §4: is the in-app viewer open for THIS attachment? Local to the
   *  item, so two snips in one message each own their own viewer. */
  const [viewing, setViewing] = useState(false);

  // ★ A signature that could not be minted says so. Rendering a dead thumbnail
  // would look like a corrupt file rather than a permission or network problem.
  const failed = !!urlQ.error;

  if (compact) {
    return (
      <span
        className="text-[10px] text-dim truncate"
        title={`${attachment.name} · ${humanSize(attachment.size)}`}
        data-testid={`chat-attachment-compact-${attachment.path}`}
      >
        {image ? '🖼' : '📄'} {attachment.name}
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
              : `${attachment.name} · ${humanSize(attachment.size)}`
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
          : `${attachment.name} · ${humanSize(attachment.size)}`
      }
      data-testid={`chat-attachment-${attachment.path}`}
      data-kind="file"
    >
      <div
        className="text-[10px] text-dim px-2 py-1 border-b truncate"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        {attachment.name}
        <span className="ml-1">· {humanSize(attachment.size)}</span>
      </div>
      <div className="text-[11px] text-text px-2 py-2">
        {failed ? 'Could not open this file' : 'Open file →'}
      </div>
    </a>
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
